"""MCP tool server over real HTTP, and the decision agent that drives it (D-22, §10.3-§10.6)."""

from __future__ import annotations

import asyncio
import json
import secrets
from datetime import UTC, datetime

import httpx2
import pytest
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

from interdict import agent, mcp_server
from interdict.agent import run_agent
from interdict.events import Timeline
from interdict.investigation import DirectInvoker, McpInvoker
from interdict.sandbox_ops import apply_operation
from interdict.session import SessionKeys
from interdict.tools import TOOL_NAMES
from service_helpers import (
    AUTH_CLUSTER,
    DEEP_CLUSTER,
    STORM,
    ServerThread,
    app_settings,
    cleanup_session,
    free_port,
    tool_context,
)


@pytest.fixture
def mcp_http(store, template):
    port = free_port()
    settings = app_settings(template, mcp_port=port)
    mcp_server.configure(store, settings)
    with ServerThread(mcp_server.build_app(settings), port):
        yield settings, f"http://127.0.0.1:{port}/mcp"


def run(coro):
    return asyncio.run(coro)


# --- the MCP server ----------------------------------------------------------------------------


def test_exactly_the_seven_tools_with_strict_schemas(mcp_http, store) -> None:
    settings, url = mcp_http
    session = secrets.token_urlsafe(24)

    async def listing():
        async with McpInvoker.connect(url, settings.internal_token, session) as invoker:
            return await invoker.list_tools()

    tools = run(listing())
    assert sorted(t["name"] for t in tools) == sorted(TOOL_NAMES)
    for tool in tools:
        schema = tool["input_schema"]
        assert schema["additionalProperties"] is False, tool["name"]
        assert not {"query", "cypher", "graph", "label"} & set(schema["properties"]), tool["name"]
    assert "EXPOSE_WORKLOAD" not in json.dumps(tools), "sandbox operations are not tools"


def test_tool_calls_need_the_internal_token_and_a_session(mcp_http, store) -> None:
    settings, url = mcp_http
    session = secrets.token_urlsafe(24)
    keys = SessionKeys.derive(session, settings.session_secret)

    async def call(token: str, session_id: str, arguments: dict):
        async with McpInvoker.connect(url, token, session_id) as invoker:
            return await invoker.call("triage_alert_storm", arguments)

    try:
        denied = run(call("wrong-token", session, {"storm_id": STORM}))
        assert not denied["ok"] and denied["error"]["code"] == "UNAUTHORIZED"
        assert (
            run(call(settings.internal_token, "x", {"storm_id": STORM}))["error"]["code"]
            == "UNAUTHORIZED"
        )
        extra = run(
            call(
                settings.internal_token,
                session,
                {"storm_id": STORM, "cypher": "MATCH (n) RETURN n"},
            )
        )
        assert not extra["ok"], "unknown arguments are rejected"
        ok = run(call(settings.internal_token, session, {"storm_id": STORM}))
        assert ok["ok"] and ok["brief"]["total_alerts"] == 200
        assert ok["data"]["counts"] == ok["brief"]["counts"] and ok["evidence"]
        assert json.loads(ok["text"])["summary"] == ok["summary"], (
            "the model reads the compact text"
        )
    finally:
        cleanup_session(store, keys)


def test_dns_rebinding_protection_checks_host_and_origin(mcp_http) -> None:
    _, url = mcp_http
    body = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    bad_host = httpx2.post(url, json=body, headers={**headers, "Host": "evil.example"})
    bad_origin = httpx2.post(url, json=body, headers={**headers, "Origin": "https://evil.example"})
    assert bad_host.status_code >= 400 and bad_origin.status_code >= 400


def test_the_sdk_client_sees_structured_results(mcp_http, store) -> None:
    settings, url = mcp_http
    session = secrets.token_urlsafe(24)

    async def call():
        http = httpx2.AsyncClient(
            headers={
                "Authorization": f"Bearer {settings.internal_token}",
                "X-Interdict-Session": session,
            }
        )
        async with http, Client(streamable_http_client(url, http_client=http)) as client:
            return await client.call_tool(
                "find_attack_paths_to_asset", {"target_db_id": "prod-payments-db"}
            )

    try:
        result = run(call())
        assert not result.is_error
        assert len(result.structured_content["data"]["chains"]) == 3
    finally:
        cleanup_session(store, SessionKeys.derive(session, settings.session_secret))


# --- the decision agent ------------------------------------------------------------------------


def investigate(ctx, cluster_id: str = AUTH_CLUSTER, run_id: str = "inv-agent-test", invoker=None):
    events = Timeline()
    report = run(
        run_agent(
            invoker or DirectInvoker(ctx),
            events,
            cluster_id=cluster_id,
            storm_id=STORM,
            investigation_id=run_id,
        )
    )
    return report, events


def calls(events: Timeline) -> list[tuple[str, dict]]:
    return [(e["tool"], e["input"]) for e in events.events if e["type"] == "tool_call"]


def known_impact(events: Timeline) -> list[bool]:
    return [i["require_known_impact"] for tool, i in calls(events) if tool == "plan_remediation"]


def why(events: Timeline, tool: str) -> str:
    return next(e["why"] for e in events.events if e["type"] == "tool_call" and e["tool"] == tool)


def test_the_agent_prefers_known_impact_and_flags_the_fallback(store, template) -> None:
    ctx = tool_context(store, app_settings(template))
    try:
        report, events = investigate(ctx)
        assert [tool for tool, _ in calls(events)] == [
            "triage_alert_storm",
            "recall_incident_memory",
            "find_evidence_by_workload",
            "find_attack_paths_to_asset",
            "plan_remediation",
            "hunt_residual_paths",
            "plan_remediation",
            "hunt_residual_paths",
            "submit_remediation_execution",
        ]
        # A fix with fully known impact cuts the cluster's own chain, but not the paths the
        # hunt adds; only then does the agent accept unknown impact, and the report says so.
        assert known_impact(events) == [True, False]
        assert report["status"] == "SIMULATED_CONTAINMENT" and report["mode"] == "agent"
        assert report["certificate_id"] and report["receipt_id"]
        assert any(note.startswith("Accepted unknown impact on") for note in report["notes"])
        hunts = [
            e
            for e in events.events
            if e["type"] == "tool_result" and e["tool"] == "hunt_residual_paths"
        ]
        assert report["certificate_id"] in hunts[-1]["summary"], (
            "the certificate comes from the tool"
        )
        assert "Nothing learned yet" in why(events, "find_evidence_by_workload")
    finally:
        cleanup_session(store, ctx.keys)


def test_memory_changes_the_second_run(store, template) -> None:
    ctx = tool_context(store, app_settings(template))
    try:
        investigate(ctx, run_id="inv-agent-first")
        report, events = investigate(ctx, run_id="inv-agent-second")
        # The known-impact attempt failed at this revision, and memory says so: skip it.
        assert known_impact(events) == [False]
        assert "Memory: no fully known fix" in why(events, "plan_remediation")
        assert "still holds" in why(events, "find_evidence_by_workload"), "and verify again"
        assert report["status"] == "SIMULATED_CONTAINMENT" and report["receipt_id"]
    finally:
        cleanup_session(store, ctx.keys)


def test_a_fix_with_fully_known_impact_needs_no_compromise(store, template) -> None:
    ctx = tool_context(store, app_settings(template))
    try:
        report, events = investigate(ctx, cluster_id=DEEP_CLUSTER)
        assert known_impact(events) == [True]
        assert report["status"] == "SIMULATED_CONTAINMENT" and report["receipt_id"]
        assert not any("unknown impact" in note for note in report["notes"])
    finally:
        cleanup_session(store, ctx.keys)


def test_stale_evidence_stops_the_agent_before_any_plan(store, template) -> None:
    ctx = tool_context(store, app_settings(template))
    try:
        ctx.ensure_sandbox()
        expired = apply_operation(
            ctx.store,
            ctx.keys.sandbox,
            "EXPIRE_EVIDENCE",
            {"edge_ref": "ev-reach-auth-1-kube-dns-53-udp"},
            datetime.now(UTC),
        )
        assert expired.result.value == "APPLIED"
        report, events = investigate(ctx)
        assert report["status"] == "INCONCLUSIVE", "never safe, never a plan on stale evidence"
        assert not {"plan_remediation", "hunt_residual_paths", "submit_remediation_execution"} & {
            tool for tool, _ in calls(events)
        }
        assert any(
            e["type"] == "narration" and "never treated as safe" in e["text"] for e in events.events
        )
    finally:
        cleanup_session(store, ctx.keys)


def test_a_cluster_absent_from_the_graph_is_reported_as_such(store, template) -> None:
    ctx = tool_context(store, app_settings(template))
    try:
        report, events = investigate(ctx, cluster_id="cluster-not-in-the-graph")
        assert report["status"] == "NOT_FOUND"
        assert [tool for tool, _ in calls(events)] == ["triage_alert_storm"]
    finally:
        cleanup_session(store, ctx.keys)


def test_the_tool_budget_is_enforced_in_code(store, template, monkeypatch) -> None:
    monkeypatch.setattr(agent, "MAX_TOOL_CALLS", 3)
    ctx = tool_context(store, app_settings(template))
    try:
        report, events = investigate(ctx)
        assert len(calls(events)) == 3 and report["status"] == "INCONCLUSIVE"
        assert report["receipt_id"] is None and "3-call budget" in report["notes"][-1]
    finally:
        cleanup_session(store, ctx.keys)


class GraphMovesBeforeTheFirstHunt(DirectInvoker):
    """Changes the sandbox once, just before the first hunt, as a concurrent visitor might."""

    moved = False

    async def call(self, name, arguments):
        if name == "hunt_residual_paths" and not self.moved:
            self.moved = True
            apply_operation(
                self.context.store,
                self.context.keys.sandbox,
                "EXPOSE_WORKLOAD",
                {"pod_id": "batch-1"},
                datetime.now(UTC),
            )
        return await super().call(name, arguments)


def test_the_agent_plans_again_once_when_the_graph_moves(store, template) -> None:
    ctx = tool_context(store, app_settings(template))
    try:
        ctx.ensure_sandbox()
        report, events = investigate(ctx, invoker=GraphMovesBeforeTheFirstHunt(ctx))
        results = [e for e in events.events if e["type"] == "tool_result"]
        hunts = [r for r in results if r["tool"] == "hunt_residual_paths"]
        assert not hunts[0]["ok"], "the first hunt saw the revision move"
        assert any(
            e["type"] == "narration" and "planning again" in e["text"] for e in events.events
        )
        assert len(hunts) >= 2 and report["status"] != "FAILED"
    finally:
        cleanup_session(store, ctx.keys)
