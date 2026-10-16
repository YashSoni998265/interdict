"""Investigation runs over the MCP tools: the deterministic pipeline, and shared plumbing.

Both run modes call the same seven tools through an Invoker and emit the same timeline events:

    agent          Claude chooses the tools and narrates (interdict.agent)
    deterministic  this module calls them in a fixed order, no LLM (D-14 fallback)

In production the Invoker is an MCP client of the tool server; tests may call the tools
in-process. Either way the verdicts come from the engine, never from the run mode: the final
report's status, plan, certificate and receipt are copied from tool results.
"""

from __future__ import annotations

import json
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Protocol

import anyio
import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

from interdict import tools
from interdict.events import Timeline

TERMINAL_ERROR = "INVESTIGATION_FAILED"


class Invoker(Protocol):
    async def list_tools(self) -> list[dict[str, Any]]: ...

    async def call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]: ...


def _envelope(structured: dict[str, Any] | None, text: str, is_error: bool) -> dict[str, Any]:
    """Normalise a tool result: {ok, summary, brief, data, evidence, error, text}."""
    structured = structured or {}
    if is_error or "error" in structured:
        error = structured.get("error") or {"code": "QUERY_FAILED", "message": text}
        return {"ok": False, "error": error, "summary": error["message"], "text": text}
    return {
        "ok": True,
        "summary": structured.get("summary", ""),
        "brief": structured.get("brief", {}),
        "data": structured.get("data", {}),
        "evidence": structured.get("evidence", []),
        "error": None,
        "text": text,
    }


class DirectInvoker:
    """Calls the tools in-process (tests, and local runs without the tool server)."""

    def __init__(self, context: tools.ToolContext) -> None:
        self.context = context

    async def list_tools(self) -> list[dict[str, Any]]:
        from interdict.mcp_server import server

        return [
            {"name": t.name, "description": t.description, "input_schema": t.input_schema}
            for t in await server.list_tools()
        ]

    async def call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        def invoke() -> tools.ToolOutput:
            return tools.TOOLS[name](self.context, **arguments)

        try:
            out = await anyio.to_thread.run_sync(invoke)
        except tools.ToolError as exc:
            return _envelope(
                {"error": {"code": exc.code, "message": exc.message}}, exc.message, True
            )
        except TypeError as exc:
            return _envelope({"error": {"code": "VALIDATION_ERROR", "message": str(exc)}}, "", True)
        text = json.dumps({"summary": out.summary, "result": out.brief}, separators=(",", ":"))
        return _envelope(
            {
                "summary": out.summary,
                "brief": out.brief,
                "data": out.data,
                "evidence": out.evidence,
            },
            text,
            False,
        )


class McpInvoker:
    """An MCP client of the Interdict tool server (Streamable HTTP), for one visitor session."""

    def __init__(self, client: Client) -> None:
        self.client = client

    @classmethod
    @asynccontextmanager
    async def connect(cls, url: str, token: str, session_id: str) -> AsyncIterator[McpInvoker]:
        http = httpx2.AsyncClient(
            headers={"Authorization": f"Bearer {token}", "X-Interdict-Session": session_id},
            timeout=httpx2.Timeout(120.0, connect=5.0),
        )
        async with http, Client(streamable_http_client(url, http_client=http)) as client:
            yield cls(client)

    async def list_tools(self) -> list[dict[str, Any]]:
        listed = await self.client.list_tools()
        return [
            {"name": t.name, "description": t.description or "", "input_schema": t.input_schema}
            for t in listed.tools
        ]

    async def call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        result = await self.client.call_tool(name, arguments)
        text = "".join(getattr(block, "text", "") for block in result.content)
        return _envelope(result.structured_content, text, bool(result.is_error))


async def call_tool(
    invoker: Invoker, timeline: Timeline, name: str, arguments: dict[str, Any], why: str
) -> dict[str, Any]:
    """Invoke one tool and record the call and its result on the timeline."""
    call_id = timeline.next_call_id()
    timeline.emit("tool_call", call_id=call_id, tool=name, input=arguments, why=why)
    started = time.perf_counter()
    try:
        result = await invoker.call(name, arguments)
    except Exception as exc:  # transport failure: typed, never "0 paths"
        result = _envelope(
            {"error": {"code": "QUERY_FAILED", "message": f"tool server unavailable: {exc}"}},
            str(exc),
            True,
        )
    timeline.emit(
        "tool_result",
        call_id=call_id,
        tool=name,
        ok=result["ok"],
        summary=result["summary"],
        latency_ms=round((time.perf_counter() - started) * 1000, 1),
        evidence_ids=[e["id"] for e in result.get("evidence") or []],
        data=result.get("data") if result["ok"] else {"error": result["error"]},
    )
    return result


def final_report(
    *,
    mode: str,
    cluster_id: str,
    storm: dict[str, Any] | None,
    plan: dict[str, Any] | None,
    hunted: dict[str, Any] | None,
    receipt: dict[str, Any] | None,
    memory: dict[str, Any] | None,
    status: str,
    narrative: str = "",
    notes: list[str] | None = None,
) -> dict[str, Any]:
    """Statuses and ids come from tool results only; the narrative is presentation."""
    certificate = (hunted or {}).get("certificate")
    if status == "SIMULATED_CONTAINMENT" and certificate:
        headline = "Model-verified containment (simulation)"
    elif status == "NO_FEASIBLE_PLAN_WITHIN_K":
        headline = "No safe plan within 3 changes"
    elif status == "SIMULATED_RESIDUAL_EXPOSURE":
        headline = "Partly fixed: paths remain"
    elif status in ("NOT_ON_ATTACK_PATH", "NO_ATTACK_PATH"):
        headline = "Vulnerable but not on any attack path"
    else:
        headline = "Not enough fresh evidence" if "INCONCLUSIVE" in status else status
    return {
        "status": status,
        "headline": headline,
        "mode": mode,
        "cluster_id": cluster_id,
        "storm_id": (storm or {}).get("storm_id"),
        "t_scope": (hunted or plan or {}).get("t_scope"),
        "plan_id": (plan or {}).get("plan_id"),
        "certified_plan_id": (certificate or {}).get("certified_plan_id"),
        "certificate_id": (certificate or {}).get("certificate_id"),
        "receipt_id": (receipt or {}).get("receipt_id"),
        "memory": memory,
        "narrative": narrative,
        "notes": notes or [],
    }


async def run_deterministic(
    invoker: Invoker,
    timeline: Timeline,
    *,
    cluster_id: str,
    storm_id: str,
    investigation_id: str,
    mode: str = "deterministic",
) -> dict[str, Any]:
    """The fixed tool sequence: triage, evidence, paths, memory, plan, hunt, gateway."""
    say = timeline.narrate
    timeline.lifecycle("TRIAGING")
    triage = await call_tool(
        invoker,
        timeline,
        "triage_alert_storm",
        {"storm_id": storm_id},
        "Sort the whole alert storm by whether each alert sits on a real attack path.",
    )
    if not triage["ok"]:
        return _fail(timeline, mode, cluster_id, triage)
    brief = triage["brief"]
    cluster = next((c for c in brief["clusters"] if c["id"] == cluster_id), None)
    if cluster is None:
        status = "INCONCLUSIVE" if not brief["complete"] else "NOT_FOUND"
        say(f"Cluster {cluster_id} is not in the current triage ({status}).")
        return _finish(
            timeline,
            final_report(
                mode=mode,
                cluster_id=cluster_id,
                storm=brief,
                plan=None,
                hunted=None,
                receipt=None,
                memory=None,
                status=status,
            ),
        )
    target, entry = cluster["target"], cluster["witness_path"][1]
    say(
        f"{brief['counts']['ON_ATTACK_PATH']} of {brief['total_alerts']} alerts are on an attack "
        f"path. Investigating {cluster_id}: {target} reached from {cluster['entry_ingress'] or 'the Internet'}."
    )

    timeline.lifecycle("ANALYZING")
    await call_tool(
        invoker,
        timeline,
        "find_evidence_by_workload",
        {"pod_id": entry},
        f"Check the four evidence tiers of the entry workload {entry}.",
    )
    await call_tool(
        invoker,
        timeline,
        "find_attack_paths_to_asset",
        {"target_db_id": target, "max_lateral_hops": 3},
        f"List every bounded attack chain that ends at {target}.",
    )
    recalled = await call_tool(
        invoker,
        timeline,
        "recall_incident_memory",
        {"asset_ids": [target]},
        f"Check what this session already learned about {target}.",
    )
    memory = recalled["brief"] if recalled["ok"] else {"status": "UNAVAILABLE"}

    timeline.lifecycle("PLANNING")
    planned = await call_tool(
        invoker,
        timeline,
        "plan_remediation",
        {"cluster_id": cluster_id, "require_known_impact": False},
        "Find the cheapest set of at most 3 allowlist policies that cuts every chain.",
    )
    if not planned["ok"]:
        return _fail(timeline, mode, cluster_id, planned)
    plan = planned["brief"]
    if not plan.get("plan_id"):
        say(f"Planning ended with {plan['status']}; no certificate is possible.")
        return _finish(
            timeline,
            final_report(
                mode=mode,
                cluster_id=cluster_id,
                storm=brief,
                plan=plan,
                hunted=None,
                receipt=None,
                memory=memory,
                status=plan["status"],
            ),
        )

    timeline.lifecycle("HUNTING")
    hunted = await call_tool(
        invoker,
        timeline,
        "hunt_residual_paths",
        {"plan_id": plan["plan_id"]},
        "Apply the plan to a candidate graph and hunt for surviving paths with three methods.",
    )
    if not hunted["ok"]:
        return _fail(timeline, mode, cluster_id, hunted)
    hunt = hunted["brief"]
    receipt = None
    if hunt.get("certificate"):
        certificate = hunt["certificate"]
        say(
            f"All three methods agree: nothing reaches {', '.join(hunt['t_scope'])}. "
            f"Certificate {certificate['certificate_id']} issued."
        )
        timeline.lifecycle("EXECUTING")
        submitted = await call_tool(
            invoker,
            timeline,
            "submit_remediation_execution",
            {
                "plan_id": certificate["certified_plan_id"],
                "certificate_id": certificate["certificate_id"],
                "execution_mode": "SIMULATION",
                "idempotency_key": investigation_id,
            },
            "Record the verified plan through the Action Gateway (simulation only).",
        )
        receipt = submitted["brief"] if submitted["ok"] else None
    else:
        say(
            f"No certificate: {hunt['status']}"
            + (f" ({hunt['reason']})" if hunt.get("reason") else "")
        )
    return _finish(
        timeline,
        final_report(
            mode=mode,
            cluster_id=cluster_id,
            storm=brief,
            plan=plan,
            hunted=hunt,
            receipt=receipt,
            memory=memory,
            status=hunt["status"],
        ),
    )


def _fail(timeline: Timeline, mode: str, cluster_id: str, result: dict[str, Any]) -> dict[str, Any]:
    error = result.get("error") or {"code": "QUERY_FAILED", "message": result.get("summary", "")}
    timeline.emit("error", code=error["code"], message=error["message"])
    status = (
        "INCONCLUSIVE" if error["code"] in ("SCOPE_INCOMPLETE", "QUERY_FAILED") else TERMINAL_ERROR
    )
    return _finish(
        timeline,
        final_report(
            mode=mode,
            cluster_id=cluster_id,
            storm=None,
            plan=None,
            hunted=None,
            receipt=None,
            memory=None,
            status=status,
            notes=[f"{error['code']}: {error['message']}"],
        ),
    )


def _finish(timeline: Timeline, report: dict[str, Any]) -> dict[str, Any]:
    timeline.emit("report", report=report)
    timeline.emit("done", status=report["status"])
    return report
