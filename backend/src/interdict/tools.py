"""The seven investigation tools (solution.md §10.4, D-17), one implementation shared by the
MCP server and in-process runs (tests, and recording the UI fixtures).

Every tool takes typed, validated arguments (IDs match `^[a-z0-9-]{1,64}$`, no field accepts a
query, label, property name or graph key) and returns a ToolOutput:

    data      the full view, shown in the UI timeline ("Show graph proof")
    brief     the compact JSON the LLM reads, so a run stays within a sane token budget
    summary   one plain sentence for the timeline
    evidence  the graph queries behind the result (template, rows, latency)

Errors are typed (VALIDATION_ERROR, NOT_FOUND, SCOPE_INCOMPLETE, QUERY_FAILED,
PRECONDITION_FAILED), never free text alone. Sandbox operations are deliberately not tools.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from interdict.audit import AuditLog
from interdict.db import QueryFailedError
from interdict.engine.certificate import Certificate
from interdict.engine.hunter import hunt
from interdict.engine.planner import ACTION_TYPE, PlanReport, constraint_set, plan_remediation
from interdict.engine.sandbox import TEMPLATE, create_sandbox, read_revision, set_revision
from interdict.engine.statuses import AlertTriageClass, CertificateStatus, PlanStatus
from interdict.engine.triage import StormReport, run_triage
from interdict.gateway import certificate_status, submit_execution
from interdict.graphstore import GraphStore
from interdict.memory import Memory
from interdict.session import Records, SessionKeys
from interdict.views import (
    certificate_view,
    chain_view,
    cluster_view,
    hunt_view,
    plan_report_view,
    query_view,
    storm_view,
    untrusted,
    workload_evidence_view,
)

ID = re.compile(r"^[a-z0-9-]{1,64}$")
PLAN_TTL_S = 24 * 60 * 60
SESSION_TTL_S = 7 * 24 * 60 * 60
SANDBOX_IDLE_MS = 2 * 60 * 60 * 1000
CERTIFICATE_TTL_S = 7 * 24 * 60 * 60
TOOL_NAMES = (
    "triage_alert_storm",
    "find_evidence_by_workload",
    "find_attack_paths_to_asset",
    "plan_remediation",
    "hunt_residual_paths",
    "submit_remediation_execution",
    "recall_incident_memory",
)


class ToolError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


@dataclass(frozen=True)
class ToolOutput:
    data: dict[str, Any]
    brief: dict[str, Any]
    summary: str
    evidence: list[dict[str, Any]] = field(default_factory=list)


def _now() -> datetime:
    return datetime.now(UTC)


@dataclass
class ToolContext:
    store: GraphStore
    keys: SessionKeys
    clock: Callable[[], datetime] = _now
    template: str = TEMPLATE

    @property
    def records(self) -> Records:
        return Records(self.store.db.connection)

    @property
    def audit(self) -> AuditLog:
        return AuditLog(self.store, self.keys.audit)

    @property
    def memory(self) -> Memory:
        return Memory(self.store, self.keys.memory)

    def ensure_sandbox(self) -> None:
        """Create the session sandbox if it is missing, and refresh its idle expiry (§12.2).

        A sandbox that expired is re-created from the template, but its revision resumes above
        the session's last one, so certificates issued before cannot become VALID again."""
        if create_sandbox(self.store, self.keys.sandbox, self.clock(), template=self.template):
            last = self.records.get(self.keys.revision_mark)
            revision = 1
            if last:
                revision = set_revision(self.store, self.keys.sandbox, int(last) + 1)
            self.mark_revision(revision)
            self.audit.append("SANDBOX_CREATED", revision=revision)
        self.store.expire(self.keys.sandbox, SANDBOX_IDLE_MS)

    def mark_revision(self, revision: int) -> None:
        self.records.put(self.keys.revision_mark, revision, SESSION_TTL_S)

    def triage(self) -> StormReport:
        """Triage the session sandbox now. Serialised per sandbox, because building the derived
        ATTACK_STEP edges and reading them back must not interleave with another build."""
        self.ensure_sandbox()
        with self.store.lock(f"lock:triage:{self.keys.sandbox}", wait_s=30):
            return run_triage(self.store, self.keys.sandbox, self.clock())

    def revision(self) -> int:
        self.ensure_sandbox()
        return read_revision(self.store, self.keys.sandbox)


def _check_id(name: str, value: Any) -> str:
    if not isinstance(value, str) or not ID.match(value):
        raise ToolError("VALIDATION_ERROR", f"{name} must match ^[a-z0-9-]{{1,64}}$")
    return value


def _evidence(report: StormReport) -> list[dict[str, Any]]:
    return [query_view(q) for q in report.queries]


# --- 1. triage_alert_storm ----------------------------------------------------------------------


def triage_alert_storm(ctx: ToolContext, storm_id: str) -> ToolOutput:
    _check_id("storm_id", storm_id)
    report = ctx.triage()
    if report.storm_id != storm_id:
        raise ToolError("NOT_FOUND", f"storm {storm_id} is not in this sandbox")
    counts = report.counts
    titles = {a.id: a.title for a in report.snapshot.alerts}
    on_path = [v for v in report.verdicts if v.triage_class == AlertTriageClass.ON_ATTACK_PATH]
    brief = {
        "storm_id": report.storm_id,
        "revision": report.revision,
        "complete": report.complete,
        "issues": [{"reason": i.reason.value, "detail": i.detail} for i in report.issues],
        "total_alerts": len(report.verdicts),
        "counts": counts,
        "clusters": [cluster_view(c) for c in report.clusters],
        "chains": [{"id": c.id, "path": chain_view(c)["path"]} for c in report.chains],
        "roles": report.roles,
        "chain_enumeration_truncated": report.chain_enumeration_truncated,
        "sample_on_path_alerts": [
            {
                "alert_id": v.alert_id,
                "pod": v.pod,
                "cve_id": v.cve_id,
                "severity": v.severity,
                "roles": [r.value for r in v.roles],
                "title": untrusted(titles.get(v.alert_id, "")),
            }
            for v in on_path[:8]
        ],
    }
    summary = (
        f"{counts['ON_ATTACK_PATH']} of {len(report.verdicts)} alerts are on an attack path "
        f"({len(report.clusters)} clusters); {counts['NOT_ON_ATTACK_PATH']} vulnerable but on no "
        f"path; {counts['NOT_ACTIONABLE']} not actionable; "
        f"{counts['TRIAGE_INCONCLUSIVE']} inconclusive."
    )
    return ToolOutput(storm_view(report, alerts=False), brief, summary, _evidence(report))


# --- 2. find_evidence_by_workload ---------------------------------------------------------------


def find_evidence_by_workload(ctx: ToolContext, pod_id: str) -> ToolOutput:
    _check_id("pod_id", pod_id)
    report = ctx.triage()
    if pod_id not in report.snapshot.pods:
        raise ToolError("NOT_FOUND", f"no workload {pod_id} in this sandbox")
    data = workload_evidence_view(report.snapshot, pod_id)
    tiers = data["tiers"]

    def fresh(record: dict[str, Any]) -> str:
        states = {p["freshness"] for p in record.get("evidence", [])}
        return (
            "stale" if "stale" in states else ("unverified" if "unverified" in states else "fresh")
        )

    brief = {
        "pod": data["pod"],
        "revision": data["revision"],
        "tiers": {
            "exposure": {
                "status": tiers["exposure"]["status"],
                "records": [
                    {"ingress": r["ingress"], "service": r["service"], "freshness": fresh(r)}
                    for r in tiers["exposure"]["records"]
                ],
            },
            "vulnerability": {
                "status": tiers["vulnerability"]["status"],
                "records": [
                    {
                        "cve_id": r["cve_id"],
                        "status": r["status"],
                        "attack_vector": r["attack_vector"],
                        "severity": r["severity"],
                        "network_exploitable": r["network_exploitable"],
                    }
                    for r in tiers["vulnerability"]["records"]
                ],
            },
            "reachability": {
                "status": tiers["reachability"]["status"],
                "records": [
                    {
                        "dst": r["dst"],
                        "port": r["port"],
                        "protocol": r["protocol"],
                        "freshness": fresh(r),
                    }
                    for r in tiers["reachability"]["records"]
                ],
            },
            "authorization": {
                "status": tiers["authorization"]["status"],
                "records": [
                    {"db": r["db"], "effect": r["effect"], "role_arn": r["role_arn"]}
                    for r in tiers["authorization"]["records"]
                ],
            },
        },
        "egress_isolated": data["egress_isolated"],
        "declared_dependencies": data["declared_dependencies"],
    }
    summary = f"{pod_id}: " + ", ".join(f"{name} {tier['status']}" for name, tier in tiers.items())
    return ToolOutput(data, brief, summary, _evidence(report))


# --- 3. find_attack_paths_to_asset --------------------------------------------------------------


def find_attack_paths_to_asset(
    ctx: ToolContext, target_db_id: str, max_lateral_hops: int = 3
) -> ToolOutput:
    _check_id("target_db_id", target_db_id)
    if not isinstance(max_lateral_hops, int) or not 0 <= max_lateral_hops <= 3:
        raise ToolError("VALIDATION_ERROR", "max_lateral_hops must be between 0 and 3")
    report = ctx.triage()
    if target_db_id not in report.snapshot.crown_jewels:
        raise ToolError("NOT_FOUND", f"{target_db_id} is not a crown jewel in this sandbox")
    if not report.complete:
        reasons = ", ".join(sorted({i.reason.value for i in report.issues}))
        raise ToolError(
            "SCOPE_INCOMPLETE", f"evidence is incomplete ({reasons}); no paths are claimed"
        )
    chains = [
        c for c in report.chains if c.target == target_db_id and c.lateral_hops <= max_lateral_hops
    ]
    deeper = [c for c in report.clusters if c.target == target_db_id and c.beyond_bound]
    data = {
        "target_db_id": target_db_id,
        "max_lateral_hops": max_lateral_hops,
        "revision": report.revision,
        "chains": [chain_view(c) for c in chains],
        "truncated": report.chain_enumeration_truncated,
        "beyond_bound": [cluster_view(c) for c in deeper],
    }
    summary = (
        f"{len(chains)} chains of at most {max_lateral_hops} lateral hops reach {target_db_id}"
    )
    if report.chain_enumeration_truncated:
        summary = "≥ " + summary
    if deeper:
        summary += (
            "; a longer path exists beyond the bound (" + ", ".join(c.id for c in deeper) + ")"
        )
    return ToolOutput(data, data, summary + ".", _evidence(report))


# --- 4. plan_remediation ------------------------------------------------------------------------


def _handle(planned: PlanReport, t_scope: tuple[str, ...], strict: bool) -> str:
    """A plan handle unique to (plan, scope, constraint set, strictness, revision)."""
    plan_id = planned.plan.id if planned.plan else "none"
    text = f"{plan_id}|{','.join(t_scope)}|{','.join(planned.chains)}|{strict}|{planned.revision}"
    return "plan-" + hashlib.sha256(text.encode()).hexdigest()[:16]


def _plan_brief(planned: PlanReport) -> dict[str, Any]:
    def named(ids: list[str]) -> list[str]:
        out = []
        for flow_id in ids:
            f = planned.flows.get(flow_id)
            out.append(f"{f.src} -> {f.dst}:{f.port}/{f.protocol}" if f else flow_id)
        return out

    def compact(plan) -> dict[str, Any] | None:
        if plan is None:
            return None
        return {
            "actions": [
                {
                    "id": a.id,
                    "variant": a.variant.value,
                    "allow": [f"{d}:{p}/{pr}" for d, p, pr in sorted(a.allow)],
                }
                for a in plan.actions
            ],
            "impact_status": plan.impact_status.value,
            "declared_dependencies_broken": named(sorted(plan.known_broken)),
            "unknown_impact_flows": named(sorted(plan.unknown)),
            "flows_blocked": len(plan.blocked),
            "chains_cut": sorted(plan.covered),
        }

    solution = planned.solution
    return {
        "status": planned.status.value,
        "revision": planned.revision,
        "constraint_chains": planned.chains,
        "inconclusive_reason": (
            planned.inconclusive_reason.value if planned.inconclusive_reason else None
        ),
        "optimality": solution.optimality.value if solution and solution.optimality else None,
        "plan": compact(planned.plan),
        "alternatives": [
            {"action_ids": list(p.action_ids), "objective": list(p.objective[:4])}
            for p in (solution.alternatives if solution else ())
        ],
        "hard_isolation": compact(solution.hard_isolation) if solution else None,
        "no_plan_reason": (
            solution.no_plan_reason.value if solution and solution.no_plan_reason else None
        ),
        "best_partial": compact(solution.best_partial) if solution else None,
        "uncovered": list(solution.uncovered) if solution else [],
        "ineligible": [f"{i.namespace}/{i.app}: {i.reason}" for i in planned.ineligible],
    }


def plan_remediation_tool(
    ctx: ToolContext,
    cluster_id: str | None = None,
    target_db_ids: list[str] | None = None,
    require_known_impact: bool = False,
) -> ToolOutput:
    if (cluster_id is None) == (target_db_ids is None):
        raise ToolError("VALIDATION_ERROR", "give exactly one of cluster_id or target_db_ids")
    if cluster_id is not None:
        _check_id("cluster_id", cluster_id)
    if target_db_ids is not None:
        if not isinstance(target_db_ids, list) or not 1 <= len(target_db_ids) <= 10:
            raise ToolError("VALIDATION_ERROR", "target_db_ids must list 1 to 10 crown jewels")
        for target in target_db_ids:
            _check_id("target_db_ids[]", target)
    report = ctx.triage()
    try:
        t_scope, chains = constraint_set(report, cluster_id=cluster_id, targets=target_db_ids)
    except KeyError as exc:
        raise ToolError("NOT_FOUND", f"no cluster {cluster_id} in the current triage") from exc
    except ValueError as exc:
        raise ToolError("NOT_FOUND", str(exc)) from exc
    planned = plan_remediation(report, chains, strict=bool(require_known_impact))
    handle = _handle(planned, t_scope, bool(require_known_impact))
    if planned.status == PlanStatus.PLAN_FOUND:
        ctx.records.put(
            ctx.keys.plan(handle),
            {
                "plan_id": handle,
                "engine_plan_id": planned.plan.id,
                "t_scope": list(t_scope),
                "chain_ids": planned.chains,
                "strict": bool(require_known_impact),
                "revision": planned.revision,
                "cluster_id": cluster_id,
            },
            PLAN_TTL_S,
        )
    ctx.audit.append(
        "PLAN_COMPUTED",
        revision=planned.revision,
        plan_id=handle,
        status=planned.status.value,
        t_scope=list(t_scope),
        actions=list(planned.plan.action_ids) if planned.plan else [],
    )
    hunt_handle = handle if planned.status == PlanStatus.PLAN_FOUND else None
    data = {
        "plan_id": hunt_handle,
        "t_scope": list(t_scope),
        "cluster_id": cluster_id,
        **plan_report_view(planned),
    }
    brief = {"plan_id": hunt_handle, "t_scope": list(t_scope), **_plan_brief(planned)}
    if planned.plan:
        p = planned.plan
        summary = (
            f"{planned.status.value} ({len(p.actions)} action(s), {p.impact_status.value}): "
            + (", ".join(p.action_ids) or "no change needed for the bounded chains")
        )
    else:
        reason = planned.inconclusive_reason or (
            planned.solution.no_plan_reason if planned.solution else None
        )
        summary = f"{planned.status.value}" + (f" ({reason.value})" if reason else "")
    return ToolOutput(data, brief, summary, _evidence(report))


# --- 5. hunt_residual_paths ---------------------------------------------------------------------


def hunt_residual_paths(ctx: ToolContext, plan_id: str) -> ToolOutput:
    _check_id("plan_id", plan_id)
    record = ctx.records.get(ctx.keys.plan(plan_id))
    if record is None:
        raise ToolError("NOT_FOUND", f"no plan {plan_id} in this session (plan first)")
    report = ctx.triage()
    if report.revision != record["revision"]:
        raise ToolError(
            "PRECONDITION_FAILED",
            f"the sandbox moved from revision {record['revision']} to {report.revision}; plan again",
        )
    chains = [c for c in report.chains if c.id in set(record["chain_ids"])]
    if len(chains) != len(record["chain_ids"]):
        raise ToolError("PRECONDITION_FAILED", "the plan's chains are no longer in the triage")
    audit = ctx.audit

    def record_certificate(certificate: Certificate) -> str:
        return audit.append(
            "CERTIFICATE_ISSUED",
            revision=certificate.sandbox_revision,
            certificate_id=certificate.certificate_id,
            certificate_hash=certificate.digest(),
            plan_id=certificate.plan["plan_id"],
            t_scope=list(certificate.t_scope),
        )["hash"]

    hunted = hunt(
        ctx.store,
        report,
        record["t_scope"],
        chains,
        strict=record["strict"],
        audit=record_certificate,
    )
    for r in hunted.rounds:
        audit.append(
            "HUNT_ROUND",
            revision=hunted.revision,
            plan_id=plan_id,
            round=r.round,
            round_plan_id=r.plan_id,
            residual_chain_ids=list(r.residuals),
            f_values=r.f_values,
        )
    view = hunt_view(hunted)
    if hunted.certificate:
        ctx.records.put(
            ctx.keys.certificate(hunted.certificate.certificate_id),
            certificate_view(hunted.certificate, CertificateStatus.VALID),
            CERTIFICATE_TTL_S,
        )
    memorised = ctx.memory.record(hunted, cluster_id=record.get("cluster_id"), now=ctx.clock())
    ctx.records.put(ctx.keys.hunt(plan_id), view, PLAN_TTL_S)
    final = hunted.plan.plan if hunted.plan else None
    certificate = hunted.certificate
    brief = {
        "plan_id": plan_id,
        "status": hunted.status.value,
        "reason": hunted.reason,
        "detail": hunted.detail,
        "t_scope": list(hunted.t_scope),
        "revision": hunted.revision,
        "rounds": [
            {
                "round": r.round,
                "actions": list(r.action_ids),
                "flows_pruned": len(r.pruned),
                "E_bounded_chains": list(r.e_chains),
                "F_max_flow": r.f_values,
                "O_reachable": list(r.o_reachable),
                "residuals_added": list(r.residuals),
            }
            for r in hunted.rounds
        ],
        "final_plan": _plan_brief(hunted.plan)["plan"] if hunted.plan else None,
        "no_plan_reason": (
            hunted.plan.solution.no_plan_reason.value
            if hunted.plan and hunted.plan.solution and hunted.plan.solution.no_plan_reason
            else None
        ),
        "residual_paths": [list(p) for p in hunted.residual_paths],
        "out_of_scope_residuals": hunted.out_of_scope_residuals,
        "certificate": (
            {
                "certificate_id": certificate.certificate_id,
                "claim": "MODEL_VERIFIED_CONTAINMENT",
                "status": "VALID",
                "certified_plan_id": certificate.plan["plan_id"],
                "t_scope": list(certificate.t_scope),
                "expires_at": view["certificate"]["expires_at"],
                "digest": view["certificate"]["digest"],
            }
            if certificate
            else None
        ),
        "memory_recorded": memorised,
    }
    if certificate:
        summary = (
            f"{hunted.status.value} after {len(hunted.rounds)} round(s): certificate "
            f"{certificate.certificate_id} for {', '.join(hunted.t_scope)} (plan "
            f"{', '.join(final.action_ids) if final else ''})."
        )
    else:
        summary = f"{hunted.status.value}" + (f" ({hunted.reason})" if hunted.reason else "")
        if hunted.detail:
            summary += f": {hunted.detail}"
    evidence = [query_view(q) for q in hunted.queries]
    return ToolOutput({"plan_id": plan_id, **view}, brief, summary, evidence)


# --- 6. submit_remediation_execution ------------------------------------------------------------


def submit_remediation_execution(
    ctx: ToolContext,
    plan_id: str,
    certificate_id: str,
    execution_mode: str,
    idempotency_key: str,
    action_type: str = ACTION_TYPE,
) -> ToolOutput:
    _check_id("plan_id", plan_id)
    _check_id("certificate_id", certificate_id)
    result = submit_execution(
        keys=ctx.keys,
        records=ctx.records,
        audit=ctx.audit,
        revision=ctx.revision(),
        now=ctx.clock(),
        plan_id=plan_id,
        certificate_id=certificate_id,
        execution_mode=execution_mode,
        idempotency_key=idempotency_key,
        action_type=action_type,
    )
    if result["status"] == "ACCEPTED":
        summary = (
            f"Simulation receipt {result['receipt_id']} recorded"
            + (" (duplicate request, cached receipt)" if result.get("duplicate") else "")
            + "; no infrastructure was changed."
        )
    else:
        summary = f"Rejected by the Action Gateway: {result['rejection']} ({result['detail']})."
    brief = {k: v for k, v in result.items() if k != "actions"}
    return ToolOutput(result, brief, summary)


# --- 7. recall_incident_memory ------------------------------------------------------------------


def recall_incident_memory(ctx: ToolContext, asset_ids: list[str]) -> ToolOutput:
    if not isinstance(asset_ids, list) or not 1 <= len(asset_ids) <= 10:
        raise ToolError("VALIDATION_ERROR", "asset_ids must list 1 to 10 ids")
    for asset in asset_ids:
        _check_id("asset_ids[]", asset)
    try:
        current = ctx.revision()
    except QueryFailedError:
        current = None
    result = {**ctx.memory.recall(asset_ids), "current_revision": current}
    now = ctx.clock()
    for entry in result.get("entries", []):
        certificate = entry.get("certificate")
        if certificate and current is not None:
            entry["certificate_status_now"] = certificate_status(
                {
                    "snapshot": {"sandbox_revision": certificate["sandbox_revision"]},
                    "expires_at": certificate["expires_at"],
                },
                now,
                current,
            )
    if result["status"] != "AVAILABLE":
        summary = f"Memory UNAVAILABLE ({result.get('reason', 'unknown')}); continuing without it."
    elif not result["entries"]:
        summary = f"Nothing learned yet about {', '.join(asset_ids)} in this session."
    else:
        latest = result["entries"][0]
        summary = (
            f"{len(result['entries'])} earlier result(s); latest: {latest['status']} at "
            f"{latest['learned_at']} (revision {latest['sandbox_revision']}, now {current})."
        )
    return ToolOutput(result, result, summary)


TOOLS: dict[str, Callable[..., ToolOutput]] = {
    "triage_alert_storm": triage_alert_storm,
    "find_evidence_by_workload": find_evidence_by_workload,
    "find_attack_paths_to_asset": find_attack_paths_to_asset,
    "plan_remediation": plan_remediation_tool,
    "hunt_residual_paths": hunt_residual_paths,
    "submit_remediation_execution": submit_remediation_execution,
    "recall_incident_memory": recall_incident_memory,
}
