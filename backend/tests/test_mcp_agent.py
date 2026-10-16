"""MCP tool server over real HTTP, and the Claude agent loop (issues #14-#15, §10.3-§10.6)."""

from __future__ import annotations

import asyncio
import json
import secrets

import httpx2
import pytest
from fastapi.testclient import TestClient
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

from interdict import mcp_server
from interdict.agent import AgentUnavailableError, run_agent, strict_schema
from interdict.api import COOKIE, create_app
from interdict.events import Timeline
from interdict.investigation import DirectInvoker, McpInvoker
from interdict.session import SessionKeys
from interdict.tools import TOOL_NAMES
from service_helpers import (
    AUTH_CLUSTER,
    STORM,
    Block,
    Message,
    ScriptedClaude,
    ServerThread,
    app_settings,
    cleanup_session,
    direct_factory,
    free_port,
    last_result,
    tool_context,
    tool_use,
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


# --- the agent loop ----------------------------------------------------------------------------


def happy_script() -> list:
    return [
        tool_use("triage_alert_storm", {"storm_id": STORM}, "Start with the whole storm."),
        lambda m: tool_use(
            "plan_remediation", {"cluster_id": AUTH_CLUSTER}, "Plan the cheapest fix."
        ),
        lambda m: tool_use(
            "hunt_residual_paths", {"plan_id": last_result(m)["result"]["plan_id"]}, "Verify it."
        ),
        lambda m: tool_use(
            "submit_remediation_execution",
            {
                "plan_id": last_result(m)["result"]["certificate"]["certified_plan_id"],
                "certificate_id": last_result(m)["result"]["certificate"]["certificate_id"],
                "execution_mode": "SIMULATION",
                "idempotency_key": "inv-agent-test-1",
            },
            "Record it through the gateway.",
        ),
        Message(
            [Block("text", text="Model-verified containment (simulation) for prod-payments-db.")],
            "end_turn",
        ),
    ]


def test_the_agent_drives_the_tools_and_the_engine_decides(store, template) -> None:
    ctx = tool_context(store, app_settings(template))
    claude = ScriptedClaude(happy_script())
    events = Timeline()
    try:
        report = run(
            run_agent(
                DirectInvoker(ctx),
                events,
                claude,
                model="claude-opus-5-5",
                cluster_id=AUTH_CLUSTER,
                storm_id=STORM,
                investigation_id="inv-agent-test-1",
            )
        )
        assert report["status"] == "SIMULATED_CONTAINMENT" and report["mode"] == "agent"
        assert report["certificate_id"] and report["receipt_id"] and report["notes"] == []
        assert report["llm"]["tool_calls"] == 4 and report["llm"]["estimated_cost_usd"] > 0
        first = claude.requests[0]
        assert first["model"] == "claude-opus-5-5"
        assert first["thinking"] == {"type": "adaptive", "display": "summarized"}
        assert first["output_config"] == {"effort": "medium"}
        assert "tool_choice" not in first, "Opus 5.5 rejects forced tool choice"
        assert first["system"][0]["cache_control"] == {"type": "ephemeral"}
        assert [t["name"] for t in first["tools"]] == sorted(TOOL_NAMES)
        assert all(
            t["strict"] and t["input_schema"]["additionalProperties"] is False
            for t in first["tools"]
        )
        whys = [e["why"] for e in events.events if e["type"] == "tool_call"]
        assert whys[0] == "Start with the whole storm."
    finally:
        cleanup_session(store, ctx.keys)


def test_containment_wording_without_a_certificate_is_flagged(store, template) -> None:
    ctx = tool_context(store, app_settings(template))
    claude = ScriptedClaude(
        [
            tool_use("triage_alert_storm", {"storm_id": STORM}),
            Message(
                [Block("text", text="Everything is contained, see cert-" + "a" * 32)], "end_turn"
            ),
        ]
    )
    try:
        report = run(
            run_agent(
                DirectInvoker(ctx),
                Timeline(),
                claude,
                model="m",
                cluster_id=AUTH_CLUSTER,
                storm_id=STORM,
                investigation_id="inv-x",
            )
        )
        assert (
            report["status"] == "INCOMPLETE"
            and report["headline"] != "Model-verified containment (simulation)"
        )
        assert any("containment without a certificate" in n for n in report["notes"])
        assert any("Unverified references" in n for n in report["notes"])
    finally:
        cleanup_session(store, ctx.keys)


def test_the_tool_budget_is_enforced_in_code(store, template) -> None:
    ctx = tool_context(store, app_settings(template))
    script = [
        tool_use("recall_incident_memory", {"asset_ids": ["prod-payments-db"]}) for _ in range(13)
    ]
    script.append(Message([Block("text", text="Out of budget.")], "end_turn"))
    events = Timeline()
    try:
        report = run(
            run_agent(
                DirectInvoker(ctx),
                events,
                ScriptedClaude(script),
                model="m",
                cluster_id=AUTH_CLUSTER,
                storm_id=STORM,
                investigation_id="inv-y",
            )
        )
        assert report["status"] == "BUDGET_EXHAUSTED" and report["llm"]["tool_calls"] == 12
        assert sum(e["type"] == "tool_call" for e in events.events) == 12
    finally:
        cleanup_session(store, ctx.keys)


def test_a_refusal_hands_over_to_the_deterministic_pipeline(store, template) -> None:
    settings = app_settings(template)
    refusing = ScriptedClaude([Message([], "refusal")])
    with pytest.raises(AgentUnavailableError):
        run(
            run_agent(
                DirectInvoker(tool_context(store, settings)),
                Timeline(),
                ScriptedClaude([Message([], "refusal")]),
                model="m",
                cluster_id=AUTH_CLUSTER,
                storm_id=STORM,
                investigation_id="inv-z",
            )
        )
    app = create_app(
        store,
        settings,
        invoker_factory=direct_factory(store, settings),
        anthropic_client=refusing,
        static_dir=None,
        limits={b: (10_000, 3600) for b in ("session", "operation", "agent")},
    )
    with TestClient(app) as http:
        try:
            token = http.post("/api/sessions").json()["csrf_token"]
            http.headers["X-CSRF-Token"] = token
            started = http.post(
                "/api/investigations", json={"cluster_id": AUTH_CLUSTER, "mode": "agent"}
            ).json()
            assert started["mode"] == "agent"
            for _ in range(300):
                state = http.get(f"/api/investigations/{started['investigation_id']}").json()
                if state["status"] != "RUNNING":
                    break
                asyncio.run(asyncio.sleep(0.1))
            assert state["status"] == "SIMULATED_CONTAINMENT"
            assert state["report"]["mode"] == "deterministic (agent fallback)"
            assert any(
                e["type"] == "narration" and "Agent unavailable" in e["text"]
                for e in state["events"]
            )
        finally:
            cookie = http.cookies.get(COOKIE)
            if cookie:
                cleanup_session(
                    store, SessionKeys.derive(cookie.split(".")[0], settings.session_secret)
                )


def test_strict_schemas_keep_only_supported_keywords() -> None:
    schema = {
        "type": "object",
        "title": "Args",
        "properties": {
            "pod_id": {"type": "string", "pattern": "^[a-z]+$", "minLength": 1, "title": "Pod"},
            "hops": {"type": "integer", "minimum": 0, "maximum": 3, "default": 3},
            "ids": {
                "anyOf": [
                    {"type": "array", "items": {"type": "string", "maxLength": 64}, "maxItems": 10},
                    {"type": "null"},
                ]
            },
        },
        "required": ["pod_id"],
        "additionalProperties": False,
    }
    assert strict_schema(schema) == {
        "type": "object",
        "properties": {
            "pod_id": {"type": "string"},
            "hops": {"type": "integer"},
            "ids": {"anyOf": [{"type": "array", "items": {"type": "string"}}, {"type": "null"}]},
        },
        "required": ["pod_id"],
        "additionalProperties": False,
    }
