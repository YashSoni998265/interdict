"""Interdict web API (solution.md §11.3): sessions, storm, investigations, sandbox, certificates.

- Anonymous sessions: a signed, HttpOnly, SameSite cookie, plus a CSRF token required on every
  POST. All keys are derived from the session id on the server (§12.7).
- Investigations run in the background through the MCP tool server (agent or deterministic)
  and stream their timeline over Server-Sent Events, resumable with Last-Event-ID.
- Sandbox operations are only here, never in the MCP tool set, and are capped and rate-limited.
- If `frontend/dist` exists it is served as the single-page app.

Run: `uvicorn interdict.api:app` (reads the environment, see .env.example).
"""

import asyncio
import hashlib
import hmac
import json
import logging
import os
import secrets
import socket
import time
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from interdict import tools
from interdict.agent import run_agent
from interdict.audit import AuditLog
from interdict.config import AppSettings, Settings, find_dotenv, load_dotenv
from interdict.db import QueryFailedError, connect, run
from interdict.engine.attackgraph import export_steps
from interdict.engine.sandbox import read_revision, reset_sandbox
from interdict.events import Timeline
from interdict.gateway import certificate_status
from interdict.graphstore import GraphStore
from interdict.investigation import Invoker, McpInvoker
from interdict.sandbox_ops import MAX_OPERATIONS, OPERATIONS, apply_operation
from interdict.session import Records, SessionKeys
from interdict.views import storm_view, subgraph_view

log = logging.getLogger("interdict.api")

COOKIE = "interdict_session"
SESSION_TTL_S = 7 * 24 * 60 * 60
EVENTS_TTL_S = 24 * 60 * 60
HEARTBEAT_S = 15
ID = r"^[a-z0-9-]{1,64}$"
LIMITS = {  # (count, window seconds) per client IP, §10.10 [TARGET values]
    "session": (10, 3600),
    "operation": (60, 3600),
}
STATIC_DIR = Path(
    os.environ.get(
        "INTERDICT_STATIC_DIR", Path(__file__).resolve().parents[3] / "frontend" / "dist"
    )
)

InvokerFactory = Callable[[str], AbstractAsyncContextManager[Invoker]]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PlanRequest(Strict):
    cluster_id: Annotated[str, Field(pattern=ID)] | None = None
    target_db_ids: list[Annotated[str, Field(pattern=ID)]] | None = Field(
        default=None, max_length=10
    )
    require_known_impact: bool = False


class HuntRequest(Strict):
    plan_id: Annotated[str, Field(pattern=ID)]


class InvestigationRequest(Strict):
    cluster_id: Annotated[str, Field(pattern=ID)]
    mode: Literal["agent"] = "agent"


class OperationRequest(Strict):
    op: Literal["EXPOSE_WORKLOAD", "ADD_LATERAL_REACH", "EXPIRE_EVIDENCE"]
    args: dict[str, Any]


class SessionContext:
    def __init__(self, session_id: str, app_state: "State") -> None:
        self.session_id = session_id
        self.keys = SessionKeys.derive(session_id, app_state.settings.session_secret)
        self.tools = tools.ToolContext(
            app_state.store, self.keys, template=app_state.settings.template
        )
        self.records = Records(app_state.store.db.connection)
        self.audit = AuditLog(app_state.store, self.keys.audit)


class State:
    def __init__(
        self,
        store: GraphStore,
        settings: AppSettings,
        invoker_factory: InvokerFactory,
    ) -> None:
        self.store = store
        self.settings = settings
        self.invoker_factory = invoker_factory
        self.redis = store.db.connection
        self.running: dict[str, asyncio.Task] = {}
        self.limit = asyncio.Semaphore(4)


def _sign(secret: str, purpose: str, value: str) -> str:
    return hmac.new(secret.encode(), f"{purpose}:{value}".encode(), hashlib.sha256).hexdigest()[:32]


def create_app(
    store: GraphStore,
    settings: AppSettings,
    *,
    invoker_factory: InvokerFactory | None = None,
    static_dir: Path | None = STATIC_DIR,
    limits: dict[str, tuple[int, int]] | None = None,
) -> FastAPI:
    def mcp_invoker(session_id: str) -> AbstractAsyncContextManager[Invoker]:
        return McpInvoker.connect(settings.mcp_url, settings.internal_token, session_id)

    state = State(store, settings, invoker_factory or mcp_invoker)
    app = FastAPI(
        title="Interdict API",
        version="0.1.0",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )
    app.state.interdict = state
    app.add_middleware(GZipMiddleware, minimum_size=2048)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-CSRF-Token", "Last-Event-ID"],
    )

    # --- helpers ---------------------------------------------------------------------------

    def client_ip(request: Request) -> str:
        if os.environ.get("INTERDICT_TRUST_PROXY") == "1":
            forwarded = request.headers.get("x-forwarded-for", "")
            if forwarded:
                return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    budgets = {**LIMITS, **(limits or {})}

    def rate_limit(request: Request, bucket: str) -> bool:
        count, window = budgets[bucket]
        key = f"rate:{bucket}:{client_ip(request)}:{int(time.time() // window)}"
        used = state.redis.incr(key)
        if used == 1:
            state.redis.expire(key, window)
        return used <= count

    def session_from_cookie(request: Request) -> str | None:
        raw = request.cookies.get(COOKIE, "")
        session_id, _, signature = raw.partition(".")
        if session_id and hmac.compare_digest(
            signature, _sign(settings.session_secret, "cookie", session_id)
        ):
            return session_id
        return None

    def current(request: Request) -> SessionContext:
        session_id = session_from_cookie(request)
        if session_id is None:
            raise HTTPException(401, {"code": "NO_SESSION", "message": "create a session first"})
        if request.method == "POST":
            token = request.headers.get("x-csrf-token", "")
            if not hmac.compare_digest(token, _sign(settings.session_secret, "csrf", session_id)):
                raise HTTPException(
                    403, {"code": "CSRF", "message": "missing or invalid CSRF token"}
                )
        return SessionContext(session_id, state)

    Session = Annotated[SessionContext, Depends(current)]

    def tool_call(fn: Callable[[], tools.ToolOutput]) -> dict[str, Any]:
        try:
            return fn().data
        except tools.ToolError as exc:
            status = {
                "NOT_FOUND": 404,
                "VALIDATION_ERROR": 422,
                "PRECONDITION_FAILED": 409,
                "SCOPE_INCOMPLETE": 409,
            }.get(exc.code, 503)
            raise HTTPException(status, {"code": exc.code, "message": exc.message}) from exc
        except QueryFailedError as exc:
            raise HTTPException(
                503, {"code": "QUERY_FAILED", "message": f"{exc.template}: {exc.reason}"}
            ) from exc

    def storm_id(session: SessionContext) -> str:
        session.tools.ensure_sandbox()
        rows = run(
            store.graph(session.keys.sandbox),
            "meta-storm",
            "MATCH (m:Meta {id: 'meta'}) RETURN m.storm_id, m.seed",
            timeout_ms=2_000,
            read_only=True,
        ).result_set
        return rows[0][0]

    # --- sessions --------------------------------------------------------------------------

    @app.post("/api/sessions")
    def create_session(request: Request, response: Response) -> dict[str, Any]:
        session_id = session_from_cookie(request)
        created = session_id is None
        if created:
            if not rate_limit(request, "session"):
                raise HTTPException(
                    429,
                    {"code": "RATE_LIMITED", "message": "too many new sessions from this address"},
                )
            session_id = secrets.token_urlsafe(24)
            response.set_cookie(
                COOKIE,
                f"{session_id}.{_sign(settings.session_secret, 'cookie', session_id)}",
                max_age=SESSION_TTL_S,
                httponly=True,
                samesite="lax",
                secure=settings.cookie_secure,
                path="/",
            )
        session = SessionContext(session_id, state)
        try:
            session.tools.ensure_sandbox()
            revision = read_revision(store, session.keys.sandbox)
            rows = run(
                store.graph(session.keys.sandbox),
                "meta-session",
                "MATCH (m:Meta {id: 'meta'}) RETURN m.storm_id, m.seed, m.alert_count",
                timeout_ms=2_000,
                read_only=True,
            ).result_set
        except QueryFailedError as exc:
            raise HTTPException(503, {"code": "QUERY_FAILED", "message": exc.reason}) from exc
        if created:
            session.audit.append("SESSION_CREATED", revision=revision)
        return {
            "session": {
                "revision": revision,
                "storm_id": rows[0][0],
                "seed": rows[0][1],
                "alert_count": rows[0][2],
                "created": created,
            },
            "csrf_token": _sign(settings.session_secret, "csrf", session_id),
        }

    # --- read views ------------------------------------------------------------------------

    @app.get("/api/storm")
    def get_storm(session: Session) -> dict[str, Any]:
        try:
            report = session.tools.triage()
        except QueryFailedError as exc:
            raise HTTPException(503, {"code": "QUERY_FAILED", "message": exc.reason}) from exc
        session.audit.append("STORM_TRIAGED", revision=report.revision, counts=report.counts)
        return storm_view(report)

    @app.get("/api/clusters/{cluster_id}/subgraph")
    def get_subgraph(
        cluster_id: str, session: Session, plan_id: str | None = None
    ) -> dict[str, Any]:
        report = session.tools.triage()
        cluster = next((c for c in report.clusters if c.id == cluster_id), None)
        if cluster is None:
            raise HTTPException(404, {"code": "NOT_FOUND", "message": f"no cluster {cluster_id}"})
        chains = [c for c in report.chains if c.id in set(cluster.chain_ids)]
        cuts: dict[tuple[str, str], list[str]] = {}
        extra = [tuple(cluster.witness_path)] if cluster.beyond_bound else []
        if plan_id:
            hunted = session.records.get(session.keys.hunt(plan_id))
            planned = session.records.get(session.keys.plan(plan_id))
            view = (hunted or {}).get("plan") or (planned or {}).get("view")
            for action in ((view or {}).get("plan") or {}).get("actions", []):
                for src, dst in action["removed_steps"]:
                    cuts.setdefault((src, dst), []).append(action["id"])
            extra += [tuple(c["path"]) for c in (hunted or {}).get("chains", [])]
        steps = export_steps(store, session.keys.sandbox)
        return subgraph_view(report, steps, chains, cuts=cuts, extra_paths=tuple(extra))

    @app.get("/api/workloads/{pod_id}/evidence")
    def get_evidence(pod_id: str, session: Session) -> dict[str, Any]:
        return tool_call(lambda: tools.find_evidence_by_workload(session.tools, pod_id))

    # --- planning and hunting (direct, for the workbench) ------------------------------------

    @app.post("/api/plans")
    def post_plan(body: PlanRequest, session: Session) -> dict[str, Any]:
        data = tool_call(
            lambda: tools.plan_remediation_tool(
                session.tools, body.cluster_id, body.target_db_ids, body.require_known_impact
            )
        )
        if data.get("plan_id"):
            record = session.records.get(session.keys.plan(data["plan_id"])) or {}
            session.records.put(
                session.keys.plan(data["plan_id"]), {**record, "view": data}, tools.PLAN_TTL_S
            )
        return data

    @app.post("/api/hunts")
    def post_hunt(body: HuntRequest, session: Session) -> dict[str, Any]:
        return tool_call(lambda: tools.hunt_residual_paths(session.tools, body.plan_id))

    # --- investigations --------------------------------------------------------------------

    @app.post("/api/investigations", status_code=202)
    async def post_investigation(
        body: InvestigationRequest, request: Request, session: Session
    ) -> dict[str, Any]:
        running = state.running.get(session.keys.key)
        if running and not running.done():
            raise HTTPException(
                409, {"code": "BUSY", "message": "an investigation is already running"}
            )
        mode, notes = body.mode, []
        investigation_id = f"inv-{uuid.uuid4().hex[:16]}"
        sid = await asyncio.to_thread(storm_id, session)
        session.records.put(
            session.keys.investigation(investigation_id),
            {
                "investigation_id": investigation_id,
                "cluster_id": body.cluster_id,
                "requested_mode": body.mode,
                "mode": mode,
                "status": "RUNNING",
                "started_at": datetime.now(UTC).isoformat(timespec="seconds"),
                "notes": notes,
            },
            EVENTS_TTL_S,
        )
        session.audit.append(
            "INVESTIGATION_STARTED",
            trace_id=investigation_id,
            cluster_id=body.cluster_id,
            mode=mode,
        )
        task = asyncio.create_task(
            _investigate(state, session, investigation_id, body.cluster_id, sid, mode, notes)
        )
        state.running[session.keys.key] = task
        return {"investigation_id": investigation_id, "mode": mode, "notes": notes}

    @app.get("/api/investigations/{investigation_id}")
    def get_investigation(investigation_id: str, session: Session) -> dict[str, Any]:
        record = session.records.get(session.keys.investigation(investigation_id))
        if record is None:
            raise HTTPException(404, {"code": "NOT_FOUND", "message": "no such investigation"})
        events = [
            json.loads(e) for e in state.redis.lrange(session.keys.events(investigation_id), 0, -1)
        ]
        report = next((e["report"] for e in reversed(events) if e["type"] == "report"), None)
        return {**record, "events": events, "report": report}

    @app.get("/api/investigations/{investigation_id}/events")
    async def stream_events(
        investigation_id: str, request: Request, session: Session
    ) -> StreamingResponse:
        if session.records.get(session.keys.investigation(investigation_id)) is None:
            raise HTTPException(404, {"code": "NOT_FOUND", "message": "no such investigation"})
        key = session.keys.events(investigation_id)
        try:
            seen = int(
                request.headers.get("last-event-id") or request.query_params.get("after") or 0
            )
        except ValueError:
            seen = 0

        async def stream() -> AsyncIterator[str]:
            index, beat = seen, time.monotonic()
            yield "retry: 2000\n\n"
            while not await request.is_disconnected():
                items = state.redis.lrange(key, index, -1)
                for raw in items:
                    event = json.loads(raw)
                    index += 1
                    yield f"id: {event['seq']}\nevent: {event['type']}\ndata: {raw}\n\n"
                    if event["type"] == "done":
                        return
                if not items:
                    record = session.records.get(session.keys.investigation(investigation_id)) or {}
                    if record.get("status") != "RUNNING" and index >= state.redis.llen(key):
                        return
                if time.monotonic() - beat > HEARTBEAT_S:
                    beat = time.monotonic()
                    yield ": heartbeat\n\n"
                await asyncio.sleep(0.15)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # --- certificates and audit ------------------------------------------------------------

    @app.get("/api/certificates/{certificate_id}")
    def get_certificate(certificate_id: str, session: Session) -> dict[str, Any]:
        document = session.records.get(session.keys.certificate(certificate_id))
        if document is None:
            raise HTTPException(
                404, {"code": "NOT_FOUND", "message": "no such certificate in this session"}
            )
        revision = session.tools.revision()
        status = certificate_status(document, datetime.now(UTC), revision)
        return {**document, "status": status, "current_revision": revision}

    @app.get("/api/audit")
    def get_audit(session: Session, after: int = 0) -> dict[str, Any]:
        return {"events": session.audit.page(after), "chain_valid": session.audit.verify()}

    # --- sandbox operations (never exposed to the agent) -----------------------------------

    @app.post("/api/sandbox/operations")
    def post_operation(
        body: OperationRequest, request: Request, session: Session
    ) -> dict[str, Any]:
        if not rate_limit(request, "operation"):
            raise HTTPException(
                429, {"code": "RATE_LIMITED", "message": "too many operations from this address"}
            )
        used = state.redis.incr(session.keys.operations)
        state.redis.expire(session.keys.operations, SESSION_TTL_S)
        session.tools.ensure_sandbox()
        if used > MAX_OPERATIONS:
            revision = session.tools.revision()
            session.audit.append(
                "SANDBOX_OPERATION_REJECTED", revision=revision, op=body.op, result="REJECTED_LIMIT"
            )
            return {
                "op": body.op,
                "result": "REJECTED_LIMIT",
                "revision": revision,
                "detail": f"at most {MAX_OPERATIONS} operations per session; reset the sandbox",
                "superseded_certificates": [],
            }
        result = apply_operation(store, session.keys.sandbox, body.op, body.args, datetime.now(UTC))
        session.tools.mark_revision(result.revision)
        event = "SANDBOX_OPERATION_APPLIED" if result.applied else "SANDBOX_OPERATION_REJECTED"
        session.audit.append(
            event,
            revision=result.revision,
            op=body.op,
            args=body.args,
            result=result.result.value,
            detail=result.detail,
        )
        superseded = []
        if result.applied:
            for key in session.records.keys(f"certificate:{session.keys.key}:*"):
                document = session.records.get(key)
                if document and document["snapshot"]["sandbox_revision"] != result.revision:
                    superseded.append(document["certificate_id"])
        return {
            "op": body.op,
            "result": result.result.value,
            "revision": result.revision,
            "detail": result.detail,
            "superseded_certificates": sorted(superseded),
        }

    @app.post("/api/sandbox/reset")
    def post_reset(session: Session) -> dict[str, Any]:
        revision = reset_sandbox(
            store, session.keys.sandbox, datetime.now(UTC), template=settings.template
        )
        session.tools.mark_revision(revision)
        state.redis.delete(session.keys.operations)
        session.audit.append("SANDBOX_CREATED", revision=revision, reset=True)
        return {"revision": revision}

    # --- system and health -----------------------------------------------------------------

    @app.get("/api/system")
    def get_system() -> dict[str, Any]:
        rows = run(
            store.graph(settings.template),
            "system-template",
            "MATCH (m:Meta {id: 'meta'}) RETURN m.seed, m.generator_version, m.alert_count, m.storm_id",
            timeout_ms=2_000,
            read_only=True,
        ).result_set
        seed, version, alerts, storm = rows[0] if rows else (None, None, None, None)
        return {
            "falkordb_version": store.server_version(),
            "build_sha": settings.build_sha,
            "seed": seed,
            "generator_version": version,
            "alert_count": alerts,
            "storm_id": storm,
            "dataset": "synthetic (Online Boutique-shaped, DEMO-CVE identifiers, RFC 5737 addresses)",
            "agent": "decision rules over tool results (no AI model)",
            "live_mode": False,
            "tools": list(tools.TOOL_NAMES),
            "sandbox_operations": list(OPERATIONS),
        }

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz")
    def readyz() -> JSONResponse:
        checks: dict[str, bool] = {}
        try:
            checks["falkordb"] = bool(store.db.connection.ping())
            checks["template"] = store.exists(settings.template)
        except Exception:
            checks["falkordb"] = checks.get("falkordb", False)
            checks["template"] = False
        checks["mcp"] = _reachable(settings.mcp_url)
        ready = checks["falkordb"] and checks["template"] and checks["mcp"]
        return JSONResponse({"ready": ready, "checks": checks}, status_code=200 if ready else 503)

    # --- the web app -----------------------------------------------------------------------

    if static_dir is not None and (static_dir / "index.html").is_file():
        root = static_dir.resolve()

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str) -> FileResponse:
            if path.startswith("api/"):
                raise HTTPException(404, {"code": "NOT_FOUND", "message": "unknown endpoint"})
            candidate = (root / path).resolve()
            if path and candidate.is_file() and root in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(root / "index.html")

    return app


def _reachable(url: str, timeout_s: float = 0.5) -> bool:
    """Whether something accepts TCP connections at the URL's host and port."""
    parts = urlsplit(url)
    try:
        with socket.create_connection((parts.hostname or "127.0.0.1", parts.port or 80), timeout_s):
            return True
    except OSError:
        return False


async def _investigate(
    state: State,
    session: SessionContext,
    investigation_id: str,
    cluster_id: str,
    sid: str,
    mode: str,
    notes: list[str],
) -> None:
    key = session.keys.events(investigation_id)

    def listener(event: dict[str, Any]) -> None:
        state.redis.rpush(key, json.dumps(event, default=str))
        state.redis.expire(key, EVENTS_TTL_S)

    timeline = Timeline(listener)
    for note in notes:
        timeline.narrate(note)
    status = "FAILED"
    async with state.limit:
        try:
            async with state.invoker_factory(session.session_id) as invoker:
                report = await run_agent(
                    invoker,
                    timeline,
                    cluster_id=cluster_id,
                    storm_id=sid,
                    investigation_id=investigation_id,
                )
                status = report["status"]
        except Exception as exc:
            log.exception("investigation %s failed", investigation_id)
            timeline.emit(
                "error", code="INVESTIGATION_FAILED", message=f"{type(exc).__name__}: {exc}"
            )
            timeline.emit("done", status="FAILED")
    record = session.records.get(session.keys.investigation(investigation_id)) or {}
    session.records.put(
        session.keys.investigation(investigation_id),
        {
            **record,
            "status": status,
            "finished_at": datetime.now(UTC).isoformat(timespec="seconds"),
        },
        EVENTS_TTL_S,
    )
    session.audit.append("INVESTIGATION_FINISHED", trace_id=investigation_id, status=status)


def _default_app() -> FastAPI:  # pragma: no cover - process entry point
    load_dotenv(find_dotenv())
    settings = AppSettings.from_env()
    store = GraphStore(connect(Settings.from_env()))
    return create_app(store, settings)


def __getattr__(name: str) -> Any:  # lazily build `app` for `uvicorn interdict.api:app`
    if name == "app":
        globals()["app"] = _default_app()
        return globals()["app"]
    raise AttributeError(name)


@asynccontextmanager
async def direct_invoker(context: tools.ToolContext) -> AsyncIterator[Invoker]:
    """An invoker that calls the tools in-process (tests and local runs)."""
    from interdict.investigation import DirectInvoker

    yield DirectInvoker(context)
