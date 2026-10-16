"""JSON views of engine results, shared by the web API, the MCP tools and the UI fixtures.

Views never compute verdicts; they only reshape what the engine decided. Free text that came
from the graph (alert titles) is wrapped as {"untrusted_text": ...} so no consumer can mistake
it for an instruction (§10.8).
"""

from __future__ import annotations

from collections import defaultdict
from itertools import pairwise
from typing import Any

from interdict.engine.attackgraph import TECHNIQUES, AttackStep, Chain
from interdict.engine.certificate import Certificate
from interdict.engine.evidence import (
    INTERNET_ID,
    EvidenceSnapshot,
    Provenance,
    QueryRecord,
    allowed_flows,
    judge,
)
from interdict.engine.hunter import HuntReport, RoundReport
from interdict.engine.planner import Action, Plan, PlanReport
from interdict.engine.sandbox import iso
from interdict.engine.statuses import CertificateStatus, CollectionStatus
from interdict.engine.triage import Cluster, StormReport

Json = dict[str, Any]


def untrusted(text: str) -> Json:
    return {"untrusted_text": text}


def query_view(record: QueryRecord) -> Json:
    return {
        "id": record.id,
        "template": record.template,
        "rows": record.rows,
        "latency_ms": record.latency_ms,
        "error": record.error,
    }


def provenance_view(prov: Provenance, snapshot: EvidenceSnapshot) -> Json:
    return {
        "edge_id": prov.edge_id,
        "verified": prov.verified,
        "observed_at": prov.observed_at,
        "valid_until": prov.valid_until,
        "evidence_source": prov.evidence_source,
        "freshness": judge(prov, snapshot.evaluated_at),
    }


def chain_view(chain: Chain) -> Json:
    return {
        "id": chain.id,
        "pods": list(chain.pods),
        "target": chain.target,
        "lateral_hops": chain.lateral_hops,
        "path": [INTERNET_ID, *chain.pods, chain.target],
    }


def cluster_view(cluster: Cluster) -> Json:
    return {
        "id": cluster.id,
        "target": cluster.target,
        "entry_ingress": cluster.entry_ingress,
        "chain_ids": list(cluster.chain_ids),
        "workloads": list(cluster.workloads),
        "beyond_bound": cluster.beyond_bound,
        "witness_path": list(cluster.witness_path),
    }


def storm_view(report: StormReport, *, alerts: bool = True) -> Json:
    snap = report.snapshot
    titles = {a.id: a for a in snap.alerts}
    view: Json = {
        "storm_id": report.storm_id,
        "revision": report.revision,
        "evaluated_at": iso(report.evaluated_at),
        "complete": report.complete,
        "issues": [
            {"reason": i.reason.value, "detail": i.detail, "evidence_ids": list(i.evidence_ids)}
            for i in report.issues
        ],
        "total_alerts": len(report.verdicts),
        "counts": report.counts,
        "funnel": report.funnel,
        "workloads_on_path": report.workloads_on_path,
        "roles": report.roles,
        "chains": [chain_view(c) for c in report.chains],
        "clusters": [cluster_view(c) for c in report.clusters],
        "chain_enumeration_truncated": report.chain_enumeration_truncated,
        "missing_attack_vector": report.missing_attack_vector,
        "attack_steps": (
            {
                "entry": report.steps.entry,
                "lateral": report.steps.lateral,
                "goal": report.steps.goal,
                "total": report.steps.total,
            }
            if report.steps
            else None
        ),
        "tiers": {
            name: {
                "status": tier.status.value,
                "rows": tier.rows,
                "stale": len(tier.stale),
                "unverified": len(tier.unverified),
                "error": tier.error,
            }
            for name, tier in sorted(snap.scope.tiers.items())
        },
        "graph_stats": {
            "pods": len(snap.pods),
            "crown_jewels": sorted(snap.crown_jewels),
            "observed_flows": len(snap.reach),
            "vulnerability_findings": len(snap.vulnerabilities),
        },
        "queries": [query_view(q) for q in report.queries],
    }
    if alerts:
        view["alerts"] = [
            {
                "alert_id": v.alert_id,
                "pod": v.pod,
                "vuln_id": v.vuln_id,
                "cve_id": v.cve_id,
                "severity": v.severity,
                "triage_class": v.triage_class.value,
                "roles": [r.value for r in v.roles],
                "reason": v.reason,
                "title": untrusted(titles[v.alert_id].title) if v.alert_id in titles else None,
                "scanner": titles[v.alert_id].scanner if v.alert_id in titles else None,
                "created_at": titles[v.alert_id].created_at if v.alert_id in titles else None,
            }
            for v in report.verdicts
        ]
    return view


def action_view(action: Action) -> Json:
    return {
        "id": action.id,
        "namespace": action.namespace,
        "app": action.app,
        "variant": action.variant.value,
        "pods": list(action.pods),
        "allow": [{"dst": d, "port": p, "protocol": pr} for d, p, pr in sorted(action.allow)],
        "blocked": sorted(action.blocked),
        "removed_steps": [list(pair) for pair in sorted(action.removed)],
        "known_broken": sorted(action.known_broken),
        "unknown": sorted(action.unknown),
        "policy_spec": action.policy_spec(),
    }


def plan_view(plan: Plan | None) -> Json | None:
    if plan is None:
        return None
    known, unknown, actions, blocked, _ = plan.objective
    return {
        "id": plan.id,
        "action_ids": list(plan.action_ids),
        "actions": [action_view(a) for a in plan.actions],
        "covered": sorted(plan.covered),
        "known_broken": sorted(plan.known_broken),
        "unknown": sorted(plan.unknown),
        "blocked": sorted(plan.blocked),
        "impact_status": plan.impact_status.value,
        "objective": {
            "known_broken": known,
            "unknown": unknown,
            "actions": actions,
            "blocked": blocked,
        },
    }


def plan_report_view(report: PlanReport) -> Json:
    solution = report.solution
    return {
        "status": report.status.value,
        "revision": report.revision,
        "k": report.k,
        "strict": report.strict,
        "chains": report.chains,
        "inconclusive_reason": (
            report.inconclusive_reason.value if report.inconclusive_reason else None
        ),
        "plan": plan_view(report.plan),
        "optimality": solution.optimality.value if solution and solution.optimality else None,
        "alternatives": [plan_view(p) for p in solution.alternatives] if solution else [],
        "hard_isolation": plan_view(solution.hard_isolation) if solution else None,
        "best_partial": plan_view(solution.best_partial) if solution else None,
        "uncovered": list(solution.uncovered) if solution else [],
        "no_plan_reason": (
            solution.no_plan_reason.value if solution and solution.no_plan_reason else None
        ),
        "feasible_plans": solution.feasible if solution else 0,
        "subsets_evaluated": solution.evaluated if solution else 0,
        "catalogue": [action_view(a) for a in report.catalogue],
        "ineligible": [
            {
                "namespace": i.namespace,
                "app": i.app,
                "reason": i.reason,
                "policies": list(i.policies),
            }
            for i in report.ineligible
        ],
        "flows": {
            fid: {"src": f.src, "dst": f.dst, "port": f.port, "protocol": f.protocol}
            for fid, f in report.flows.items()
        },
    }


def round_view(r: RoundReport) -> Json:
    return {
        "round": r.round,
        "plan_id": r.plan_id,
        "action_ids": list(r.action_ids),
        "pruned": list(r.pruned),
        "attack_steps": r.steps,
        "e_chains": list(r.e_chains),
        "f_values": r.f_values,
        "o_reachable": list(r.o_reachable),
        "witnesses": {t: list(p) for t, p in r.witnesses.items()},
        "residuals": list(r.residuals),
        "out_of_scope": list(r.out_of_scope),
        "latency_ms": r.latency_ms,
    }


def certificate_view(certificate: Certificate, status: CertificateStatus) -> Json:
    return {**certificate.to_dict(status), "digest": certificate.digest()}


def hunt_view(report: HuntReport, certificate_status: CertificateStatus | None = None) -> Json:
    return {
        "status": report.status.value,
        "reason": report.reason,
        "detail": report.detail,
        "t_scope": list(report.t_scope),
        "revision": report.revision,
        "evaluated_at": iso(report.evaluated_at),
        "rounds": [round_view(r) for r in report.rounds],
        "plan": plan_report_view(report.plan) if report.plan else None,
        "chains": [chain_view(c) for c in report.chains],
        "residual_paths": [list(p) for p in report.residual_paths],
        "out_of_scope_residuals": report.out_of_scope_residuals,
        "certificate": (
            certificate_view(report.certificate, certificate_status or CertificateStatus.VALID)
            if report.certificate
            else None
        ),
        "queries": [query_view(q) for q in report.queries],
    }


def _tier_status(snapshot: EvidenceSnapshot, tier: str, records: list[Json]) -> str:
    """Per-workload status: a failed or empty tier is never reported as 'nothing found'."""
    report = snapshot.scope.tiers.get(tier)
    if report is None or report.status == CollectionStatus.QUERY_FAILED:
        return CollectionStatus.QUERY_FAILED.value
    freshness = [p["freshness"] for r in records for p in r.get("evidence", [])]
    if "stale" in freshness:
        return CollectionStatus.STALE_EXPIRED.value
    if tier == "reachability" and report.status == CollectionStatus.UNCOLLECTED:
        return CollectionStatus.UNCOLLECTED.value
    return (
        CollectionStatus.COLLECTED_COMPLETE.value
        if records
        else CollectionStatus.COLLECTED_EMPTY.value
    )


def workload_evidence_view(snapshot: EvidenceSnapshot, pod_id: str) -> Json:
    """The four evidence tiers for one workload, with provenance and freshness (§6.4)."""
    pod = snapshot.pods[pod_id]
    exposure = [
        {
            "ingress": e.ingress,
            "service": e.service,
            "evidence": [provenance_view(p, snapshot) for p in e.evidence],
        }
        for e in snapshot.exposures
        if e.pod == pod_id
    ]
    vulnerability = [
        {
            "vuln_id": v.vuln_id,
            "cve_id": v.cve_id,
            "status": v.status,
            "attack_vector": v.attack_vector,
            "severity": v.severity,
            "cvss": v.cvss,
            "network_exploitable": v.network_exploitable,
            "evidence": [provenance_view(p, snapshot) for p in v.evidence],
        }
        for v in snapshot.vulnerabilities
        if v.pod == pod_id
    ]
    reachability = [
        {
            "edge_id": r.edge_id,
            "dst": r.dst,
            "dst_kind": r.dst_kind,
            "port": r.port,
            "protocol": r.protocol,
            "evidence": [provenance_view(r.evidence, snapshot)],
        }
        for r in snapshot.reach
        if r.src == pod_id
    ]
    authorization = [
        {
            "db": g.db,
            "role_arn": g.role_arn,
            "permission_id": g.permission_id,
            "effect": g.effect,
            "evidence": [provenance_view(p, snapshot) for p in g.evidence],
        }
        for g in snapshot.grants
        if g.pod == pod_id
    ]
    allowed = allowed_flows(pod_id, snapshot.policies)
    return {
        "pod": {
            "id": pod.id,
            "namespace": pod.namespace,
            "app": pod.app,
            "dependency_manifest": pod.manifest,
            "reach_status": pod.reach_status,
        },
        "revision": snapshot.revision,
        "evaluated_at": iso(snapshot.evaluated_at),
        "tiers": {
            name: {"status": _tier_status(snapshot, name, records), "records": records}
            for name, records in (
                ("exposure", exposure),
                ("vulnerability", vulnerability),
                ("reachability", reachability),
                ("authorization", authorization),
            )
        },
        "egress_policies": sorted(p.id for p in snapshot.policies if pod_id in p.selected),
        "egress_isolated": allowed is not None,
        "declared_dependencies": [
            {
                "id": snapshot.declared_ids.get((pod_id, flow)),
                "dst": flow[0],
                "port": flow[1],
                "protocol": flow[2],
            }
            for flow in sorted(snapshot.declared.get(pod_id, ()))
        ],
    }


def subgraph_view(
    report: StormReport,
    steps: list[AttackStep],
    chains: list[Chain],
    *,
    plan: Plan | None = None,
    extra_paths: tuple[tuple[str, ...], ...] = (),
) -> Json:
    """The focused attack subgraph for some chains: their nodes and ATTACK_STEP edges, with the
    steps a plan would cut marked (§13.7: subgraph focus only)."""
    snap = report.snapshot
    by_pair = {(s.src, s.dst): s for s in steps}
    paths = [(INTERNET_ID, *c.pods, c.target) for c in chains] + [tuple(p) for p in extra_paths]
    pairs = sorted({pair for path in paths for pair in pairwise(path)})
    cut_by: dict[tuple[str, str], list[str]] = defaultdict(list)
    for action in plan.actions if plan else ():
        for pair in action.removed:
            cut_by[pair].append(action.id)
    alerts_on: dict[str, int] = defaultdict(int)
    for verdict in report.verdicts:
        alerts_on[verdict.pod] += 1
    cves: dict[str, set[str]] = defaultdict(set)
    for v in snap.vulnerabilities:
        if v.network_exploitable:
            cves[v.pod].add(v.cve_id)
    ingresses: dict[str, list[str]] = defaultdict(list)
    for e in snap.exposures:
        ingresses[e.pod].append(e.ingress)

    node_ids = sorted({n for pair in pairs for n in pair})
    nodes = []
    for node_id in node_ids:
        if node_id == INTERNET_ID:
            nodes.append({"id": node_id, "kind": "Internet", "label": "Internet"})
        elif node_id in snap.pods:
            pod = snap.pods[node_id]
            nodes.append(
                {
                    "id": node_id,
                    "kind": "Pod",
                    "label": node_id,
                    "namespace": pod.namespace,
                    "app": pod.app,
                    "roles": report.roles.get(node_id, []),
                    "alerts": alerts_on.get(node_id, 0),
                    "network_cves": sorted(cves.get(node_id, ())),
                    "exposed_via": sorted(set(ingresses.get(node_id, ()))),
                }
            )
        else:
            nodes.append(
                {
                    "id": node_id,
                    "kind": "Database",
                    "label": node_id,
                    "crown_jewel": node_id in snap.crown_jewels,
                }
            )
    edges = []
    for src, dst in pairs:
        step = by_pair.get((src, dst))
        kind = step.kind if step else None
        edges.append(
            {
                "id": f"{src}->{dst}",
                "source": src,
                "target": dst,
                "kind": kind,
                "ports": list(step.ports) if step else [],
                "technique_id": TECHNIQUES[kind][0] if kind else None,
                "technique": TECHNIQUES[kind][1] if kind else None,
                "backing_evidence_ids": list(step.backing) if step else [],
                "cut_by": cut_by.get((src, dst), []),
            }
        )
    return {"revision": report.revision, "nodes": nodes, "edges": edges}
