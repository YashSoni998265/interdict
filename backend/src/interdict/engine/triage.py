"""Alert Storm triage (solution.md §6.8): classify every alert, find the paths, group them.

Each alert gets exactly one class, so the counts always add up to the number of alerts:

1. TRIAGE_INCONCLUSIVE  evidence that bears on it is incomplete, stale or failed
2. NOT_ACTIONABLE       its vulnerability is not active or not network-exploitable
3. NOT_ON_ATTACK_PATH   its workload is on no Internet -> crown-jewel path
4. ON_ATTACK_PATH       its workload is on at least one such path (roles: ENTRY, LATERAL, FINAL_HOP)

"On a path" is exact and unbounded: a workload must be reachable from the Internet and able to
reach a crown jewel over ATTACK_STEP edges. Forward reachability is computed twice, by FalkorDB's
BFS and in Python; any disagreement makes the triage inconclusive. Under the frozen strict rule
(C-11), an incomplete scope makes every alert inconclusive except those that are NOT_ACTIONABLE.
"""

from __future__ import annotations

import time
from collections import Counter, defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from interdict.db import QueryFailedError
from interdict.engine.attackgraph import (
    MAX_LATERAL_HOPS,
    BuildResult,
    Chain,
    RevisionChangedError,
    build_attack_steps,
    enumerate_chains,
    export_steps,
    exposed_pods,
    forward_reachable_in_graph,
    reachable,
    shortest_path,
)
from interdict.engine.evidence import (
    INTERNET_ID,
    EvidenceSnapshot,
    QueryRecord,
    ScopeIssue,
    collect_evidence,
    judge,
)
from interdict.engine.statuses import AlertTriageClass, AttackPathRole, InconclusiveReason
from interdict.graphstore import GraphStore


@dataclass(frozen=True)
class AlertVerdict:
    alert_id: str
    pod: str
    vuln_id: str
    cve_id: str
    severity: str
    triage_class: AlertTriageClass
    roles: tuple[AttackPathRole, ...]
    reason: str


@dataclass(frozen=True)
class Cluster:
    id: str
    target: str
    entry_ingress: str | None
    chain_ids: tuple[str, ...]
    workloads: tuple[str, ...]
    beyond_bound: bool  # reached only by a path deeper than the planner's bound
    witness_path: tuple[str, ...]  # Internet, pods..., target


@dataclass
class StormReport:
    storm_id: str
    graph: str
    revision: int
    evaluated_at: datetime
    issues: list[ScopeIssue]
    verdicts: list[AlertVerdict]
    counts: dict[str, int]
    funnel: list[dict[str, Any]]
    workloads_on_path: list[str]
    roles: dict[str, list[str]]
    chains: list[Chain]
    clusters: list[Cluster]
    chain_enumeration_truncated: bool
    missing_attack_vector: int
    steps: BuildResult | None
    queries: list[QueryRecord]
    snapshot: EvidenceSnapshot

    @property
    def complete(self) -> bool:
        return not self.issues


def _timed[T](
    records: list[QueryRecord], template: str, fn: Callable[[], T], rows: Callable[[T], int]
) -> T:
    started = time.perf_counter()
    record_id = f"q{len(records) + 1:02d}"
    try:
        out = fn()
    except QueryFailedError as exc:
        records.append(
            QueryRecord(
                record_id, template, 0, round((time.perf_counter() - started) * 1000, 2), exc.reason
            )
        )
        raise
    records.append(
        QueryRecord(
            record_id, template, rows(out), round((time.perf_counter() - started) * 1000, 2)
        )
    )
    return out


def run_triage(
    store: GraphStore,
    name: str,
    now: datetime | None = None,
    *,
    row_limit: int = 100_000,
    max_lateral_hops: int = MAX_LATERAL_HOPS,
) -> StormReport:
    snap = collect_evidence(store, name, now, row_limit=row_limit)
    records = list(snap.queries)
    issues = list(snap.scope.issues)
    on_path: set[str] = set()
    roles: dict[str, set[AttackPathRole]] = defaultdict(set)
    chains: list[Chain] = []
    clusters: list[Cluster] = []
    truncated = False
    built: BuildResult | None = None

    if not issues:
        try:
            built = _timed(
                records,
                "attack-build",
                lambda: build_attack_steps(store, name, snap),
                lambda b: b.total,
            )
            steps = _timed(
                records,
                "attack-export",
                lambda: export_steps(store, name, row_limit=row_limit),
                len,
            )
            forward_py = reachable(steps, {INTERNET_ID})
            forward_db = (
                _timed(
                    records,
                    "attack-forward-bfs",
                    lambda: forward_reachable_in_graph(store, name, len(snap.pods) + 2),
                    len,
                )
                if steps
                else set()
            )
            if forward_db != forward_py:
                issues.append(
                    ScopeIssue(
                        InconclusiveReason.METHOD_DISAGREEMENT,
                        "FalkorDB BFS and the engine disagree on forward reachability",
                        tuple(sorted(forward_db ^ forward_py)),
                    )
                )
            else:
                crown = set(snap.crown_jewels)
                backward = reachable(steps, crown, reverse=True)
                on_path = {p for p in snap.pods if p in forward_py and p in backward}
                for step in steps:
                    if step.kind == "ENTRY" and step.dst in on_path:
                        roles[step.dst].add(AttackPathRole.ENTRY)
                    elif step.kind == "LATERAL" and step.dst in on_path and step.src in forward_py:
                        roles[step.dst].add(AttackPathRole.LATERAL)
                    elif step.kind == "GOAL" and step.src in on_path and step.dst in crown:
                        roles[step.src].add(AttackPathRole.FINAL_HOP)
                chain_set = _timed(
                    records,
                    "chains-enumerate",
                    lambda: enumerate_chains(
                        store,
                        name,
                        snap,
                        crown,
                        max_lateral_hops=max_lateral_hops,
                        row_limit=row_limit,
                    ),
                    lambda cs: len(cs.chains),
                )
                chains, truncated = list(chain_set.chains), chain_set.truncated
                clusters = _clusters(snap, steps, chains, crown & forward_py)
        except QueryFailedError as exc:
            issues.append(
                ScopeIssue(InconclusiveReason.QUERY_FAILED, f"{exc.template}: {exc.reason}")
            )
        except RevisionChangedError as exc:
            issues.append(ScopeIssue(InconclusiveReason.REVISION_CHANGED, str(exc)))
        if issues:  # fail closed: nothing derived from a failed run is reported
            on_path, roles, chains, clusters = set(), defaultdict(set), [], []

    verdicts = _classify(snap, issues, on_path, roles)
    counts = Counter(v.triage_class.value for v in verdicts)
    counts_all = {c.value: counts.get(c.value, 0) for c in AlertTriageClass}
    funnel = [
        {"stage": "alerts", "count": len(verdicts)},
        {
            "stage": "actionable",
            "count": counts_all["ON_ATTACK_PATH"] + counts_all["NOT_ON_ATTACK_PATH"],
        },
        {"stage": "on_attack_path", "count": counts_all["ON_ATTACK_PATH"]},
        {"stage": "workloads_on_path", "count": len(on_path)},
        {"stage": "chains_within_bound", "count": len(chains), "truncated": truncated},
        {"stage": "clusters", "count": len(clusters)},
    ]
    return StormReport(
        storm_id=str(snap.meta.get("storm_id", "")),
        graph=name,
        revision=snap.revision,
        evaluated_at=snap.evaluated_at,
        issues=issues,
        verdicts=verdicts,
        counts=counts_all,
        funnel=funnel,
        workloads_on_path=sorted(on_path),
        roles={pod: sorted(r.value for r in rs) for pod, rs in sorted(roles.items())},
        chains=chains,
        clusters=clusters,
        chain_enumeration_truncated=truncated,
        missing_attack_vector=sum(1 for v in snap.vulnerabilities if v.attack_vector is None),
        steps=built,
        queries=records,
        snapshot=snap,
    )


def _classify(
    snap: EvidenceSnapshot,
    issues: list[ScopeIssue],
    on_path: set[str],
    roles: dict[str, set[AttackPathRole]],
) -> list[AlertVerdict]:
    findings = {(v.pod, v.vuln_id): v for v in snap.vulnerabilities}
    scope_reason = ", ".join(sorted({i.reason.value for i in issues}))
    verdicts = []
    for alert in snap.alerts:
        finding = findings.get((alert.pod, alert.vuln_id))
        cve = finding.cve_id if finding else ""
        if finding is None or not all(
            judge(p, snap.evaluated_at) == "fresh" for p in finding.evidence
        ):
            klass, reason = (
                AlertTriageClass.TRIAGE_INCONCLUSIVE,
                "vulnerability evidence missing, stale or unverified",
            )
        elif not finding.network_exploitable:
            klass = AlertTriageClass.NOT_ACTIONABLE
            reason = (
                f"vulnerability status is {finding.status}"
                if finding.status != "ACTIVE"
                else f"attack vector is {finding.attack_vector}"
            )
        elif issues:
            klass, reason = (
                AlertTriageClass.TRIAGE_INCONCLUSIVE,
                f"scope incomplete: {scope_reason}",
            )
        elif alert.pod in on_path:
            klass, reason = (
                AlertTriageClass.ON_ATTACK_PATH,
                "workload lies on an Internet to crown-jewel path",
            )
        else:
            klass, reason = (
                AlertTriageClass.NOT_ON_ATTACK_PATH,
                "no path from the Internet through this workload to a crown jewel",
            )
        pod_roles = (
            tuple(sorted(roles.get(alert.pod, ())))
            if klass == AlertTriageClass.ON_ATTACK_PATH
            else ()
        )
        verdicts.append(
            AlertVerdict(
                alert.id, alert.pod, alert.vuln_id, cve, alert.severity, klass, pod_roles, reason
            )
        )
    return verdicts


def _clusters(
    snap: EvidenceSnapshot, steps: list, chains: list[Chain], reachable_targets: set[str]
) -> list[Cluster]:
    """Bounded chains grouped by (target, entry ingress), plus one cluster per crown jewel that is
    reachable only by a path deeper than the bound (found by unbounded reachability)."""
    ingresses = exposed_pods(snap)
    groups: dict[tuple[str, str | None], list[Chain]] = defaultdict(list)
    for chain in chains:
        entry = (ingresses.get(chain.pods[0]) or [None])[0]
        groups[(chain.target, entry)].append(chain)
    clusters = []
    for (target, entry), members in sorted(
        groups.items(), key=lambda kv: (kv[0][0], kv[0][1] or "")
    ):
        shortest = min(members, key=lambda c: (c.lateral_hops, c.id))
        clusters.append(
            Cluster(
                id=f"cluster-{target}-{entry or 'unknown'}",
                target=target,
                entry_ingress=entry,
                chain_ids=tuple(c.id for c in members),
                workloads=tuple(sorted({p for c in members for p in c.pods})),
                beyond_bound=False,
                witness_path=(INTERNET_ID, *shortest.pods, target),
            )
        )
    bounded_targets = {c.target for c in chains}
    for target in sorted(reachable_targets - bounded_targets):
        witness = shortest_path(steps, target)
        if witness is None:
            continue
        entry = (ingresses.get(witness[1]) or [None])[0] if len(witness) > 2 else None
        clusters.append(
            Cluster(
                id=f"cluster-{target}-deep",
                target=target,
                entry_ingress=entry,
                chain_ids=(),
                workloads=tuple(witness[1:-1]),
                beyond_bound=True,
                witness_path=witness,
            )
        )
    return clusters
