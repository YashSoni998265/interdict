"""Shared plumbing for investigation runs over the MCP tools: invokers, the timeline of tool
calls, and the final report.

The agent (interdict.agent) calls the seven tools through an Invoker and records every call and
result on the timeline. In production the Invoker is an MCP client of the tool server; tests may
call the tools in-process. Either way the verdicts come from the engine, never from the agent:
the final report's status, plan, certificate and receipt are copied from tool results.
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


def fail(timeline: Timeline, mode: str, cluster_id: str, result: dict[str, Any]) -> dict[str, Any]:
    error = result.get("error") or {"code": "QUERY_FAILED", "message": result.get("summary", "")}
    timeline.emit("error", code=error["code"], message=error["message"])
    status = (
        "INCONCLUSIVE" if error["code"] in ("SCOPE_INCOMPLETE", "QUERY_FAILED") else TERMINAL_ERROR
    )
    return finish(
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


def finish(timeline: Timeline, report: dict[str, Any]) -> dict[str, Any]:
    timeline.emit("report", report=report)
    timeline.emit("done", status=report["status"])
    return report
