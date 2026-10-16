"""Evidence collection and scope completeness (solution.md §5.6, §6.4-§6.6, D-06, D-07, D-16).

Every tier query runs over the whole sandbox, which is the evaluation scope for triage, the
Path Hunter and certificates. Queries return stale and unverified evidence together with its
provenance instead of filtering it in MATCH (D-07). Freshness is judged here, against one
evaluation time, so missing, stale, unverified, contradictory or failed evidence can never be
mistaken for absence (§6.5). Every query is logged with its template, row count and latency;
that log is the "graph proof" shown in the UI.
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from falkordb.graph import Graph

from interdict.db import QueryFailedError, run
from interdict.engine.statuses import CollectionStatus, InconclusiveReason
from interdict.graphstore import GraphStore

INTERNET_ID = "global-internet"
TIMEOUT_MS = 2_000
Flow = tuple[str, int, str]

Q_META = "MATCH (m:Meta {id: 'meta'}) RETURN properties(m)"
Q_PODS = (
    "MATCH (p:Pod) RETURN p.id, p.namespace, p.app, p.dependency_manifest, "
    "p.reach_status, p.reach_status_reason ORDER BY p.id"
)
Q_DATABASES = "MATCH (d:Database) RETURN d.id, d.is_crown_jewel ORDER BY d.id"
Q_EXPOSURE = (
    "MATCH (ext:Internet {id: $internet_id})-[e1:EXPOSES]->(ing:Ingress)-[e2:ROUTES_TO]->(svc:Service)"
    "-[e3:TARGETS]->(p:Pod) "
    "RETURN p.id, ing.id, svc.id, [e1.id, e2.id, e3.id], [e1.verified, e2.verified, e3.verified], "
    "[e1.observed_at, e2.observed_at, e3.observed_at], [e1.valid_until, e2.valid_until, e3.valid_until], "
    "[e1.evidence_source, e2.evidence_source, e3.evidence_source]"
)
Q_VULNERABILITY = (
    "MATCH (p:Pod)-[r:RUNS_IMAGE]->(img:ContainerImage)-[h:HAS_VULNERABILITY]->(v:Vulnerability) "
    "RETURN p.id, v.id, v.cve_id, v.status, v.attack_vector, v.severity, v.cvss_score, "
    "[r.id, h.id], [r.verified, h.verified], [r.observed_at, h.observed_at], "
    "[r.valid_until, h.valid_until], [r.evidence_source, h.evidence_source]"
)
Q_REACHABILITY = (
    "MATCH (a:Pod)-[c:CAN_REACH]->(d) "
    "RETURN a.id, d.id, labels(d), c.id, c.port, c.protocol, c.verified, c.observed_at, "
    "c.valid_until, c.evidence_source"
)
Q_AUTHORIZATION = (
    "MATCH (p:Pod)-[ar:ASSUMES_ROLE]->(role:IAMRole)-[g:GRANTS_ACCESS]->(perm:IAMPermission)"
    "-[ap:APPLIES_TO]->(db:Database) "
    "RETURN p.id, db.id, role.arn, perm.id, perm.effect, [ar.id, g.id, ap.id], "
    "[ar.verified, g.verified, ap.verified], [ar.observed_at, g.observed_at, ap.observed_at], "
    "[ar.valid_until, g.valid_until, ap.valid_until], "
    "[ar.evidence_source, g.evidence_source, ap.evidence_source]"
)
Q_POLICIES = (
    "MATCH (np:NetworkPolicy) WHERE 'Egress' IN np.policy_types "
    "OPTIONAL MATCH (np)-[:SELECTS]->(p:Pod) "
    "WITH np, collect(DISTINCT p.id) AS selected "
    "OPTIONAL MATCH (np)-[al:ALLOWS_EGRESS]->(d) "
    "RETURN np.id, np.managed_by, np.namespace, np.pod_selector, selected, "
    "collect(DISTINCT [d.id, al.port, al.protocol])"
)
Q_DEPENDENCIES = (
    "MATCH (p:Pod)-[dep:DEPENDS_ON]->(d) RETURN p.id, d.id, dep.port, dep.protocol, dep.id"
)
Q_ALERTS = (
    "MATCH (a:Alert)-[:ON_WORKLOAD]->(p:Pod) MATCH (a)-[:REFERENCES]->(v:Vulnerability) "
    "RETURN a.id, p.id, v.id, a.severity, a.title, a.created_at, a.scanner, a.storm_id ORDER BY a.id"
)
Q_DUPLICATE_IDS = "MATCH (n) WITH n.id AS id, count(*) AS c WHERE c > 1 RETURN id LIMIT 5"


@dataclass(frozen=True)
class QueryRecord:
    id: str
    template: str
    rows: int
    latency_ms: float
    error: str | None = None


@dataclass(frozen=True)
class Provenance:
    edge_id: str
    verified: Any
    observed_at: str | None
    valid_until: str | None
    evidence_source: str | None


@dataclass(frozen=True)
class PodInfo:
    id: str
    namespace: str
    app: str
    manifest: str
    reach_status: str


@dataclass(frozen=True)
class Exposure:
    pod: str
    ingress: str
    service: str
    evidence: tuple[Provenance, ...]


@dataclass(frozen=True)
class VulnFinding:
    pod: str
    vuln_id: str
    cve_id: str
    status: str
    attack_vector: str | None
    severity: str
    cvss: float
    evidence: tuple[Provenance, ...]

    @property
    def network_exploitable(self) -> bool:
        """Active and reachable over the network. A missing vector counts as NETWORK (§6.1)."""
        return self.status == "ACTIVE" and (self.attack_vector or "NETWORK") in {
            "NETWORK",
            "ADJACENT",
        }


@dataclass(frozen=True)
class ReachEdge:
    edge_id: str
    src: str
    dst: str
    dst_kind: str
    port: int
    protocol: str
    evidence: Provenance

    @property
    def flow(self) -> Flow:
        return (self.dst, self.port, self.protocol)


@dataclass(frozen=True)
class Grant:
    pod: str
    db: str
    role_arn: str
    permission_id: str
    effect: str
    evidence: tuple[Provenance, ...]


@dataclass(frozen=True)
class PolicyInfo:
    id: str
    managed_by: str
    namespace: str
    pod_selector: str
    selected: frozenset[str]
    allows: frozenset[Flow]


@dataclass(frozen=True)
class AlertInfo:
    id: str
    pod: str
    vuln_id: str
    severity: str
    title: str  # untrusted text (§10.8)
    created_at: str
    scanner: str
    storm_id: str


@dataclass
class TierReport:
    name: str
    status: CollectionStatus
    rows: int = 0
    stale: list[str] = field(default_factory=list)
    unverified: list[str] = field(default_factory=list)
    error: str | None = None


@dataclass(frozen=True)
class ScopeIssue:
    reason: InconclusiveReason
    detail: str
    evidence_ids: tuple[str, ...] = ()


@dataclass
class ScopeReport:
    tiers: dict[str, TierReport]
    issues: list[ScopeIssue]

    @property
    def complete(self) -> bool:
        return not self.issues

    @property
    def reasons(self) -> list[InconclusiveReason]:
        return sorted({issue.reason for issue in self.issues})


@dataclass
class EvidenceSnapshot:
    graph: str
    revision: int
    evaluated_at: datetime
    meta: dict[str, Any]
    pods: dict[str, PodInfo]
    crown_jewels: frozenset[str]
    databases: frozenset[str]
    exposures: list[Exposure]
    vulnerabilities: list[VulnFinding]
    reach: list[ReachEdge]
    grants: list[Grant]
    policies: list[PolicyInfo]
    declared: dict[str, frozenset[Flow]]
    declared_ids: dict[tuple[str, Flow], str]
    alerts: list[AlertInfo]
    scope: ScopeReport
    queries: list[QueryRecord]


class _Recorder:
    """Runs read-only queries and logs every one of them (including failures)."""

    def __init__(self, graph: Graph, row_limit: int, timeout_ms: int) -> None:
        self.graph = graph
        self.row_limit = row_limit
        self.timeout_ms = timeout_ms
        self.records: list[QueryRecord] = []

    def query(
        self, template: str, cypher: str, params: dict[str, Any] | None = None
    ) -> list[list[Any]]:
        started = time.perf_counter()
        record_id = f"q{len(self.records) + 1:02d}"
        try:
            result = run(
                self.graph,
                template,
                cypher,
                params,
                timeout_ms=self.timeout_ms,
                read_only=True,
                row_limit=self.row_limit,
            )
        except QueryFailedError as exc:
            self.records.append(QueryRecord(record_id, template, 0, _ms(started), exc.reason))
            raise
        self.records.append(QueryRecord(record_id, template, len(result.result_set), _ms(started)))
        return result.result_set


def _ms(started: float) -> float:
    return round((time.perf_counter() - started) * 1000, 2)


def _parse(ts: Any) -> datetime | None:
    if not isinstance(ts, str):
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


def judge(prov: Provenance, now: datetime) -> str:
    """'fresh', 'stale' or 'unverified' (which includes missing or invalid provenance)."""
    observed, valid_until = _parse(prov.observed_at), _parse(prov.valid_until)
    if observed is None or valid_until is None or not prov.evidence_source or observed > now:
        return "unverified"
    if prov.verified is not True:
        return "unverified"
    if now >= valid_until:
        return "stale"
    return "fresh"


def _provenance(
    ids: list[Any], verified: list[Any], observed: list[Any], valid: list[Any], sources: list[Any]
) -> tuple[Provenance, ...]:
    return tuple(
        Provenance(str(i), v, o, u, s)
        for i, v, o, u, s in zip(ids, verified, observed, valid, sources, strict=True)
    )


def _judge_tier(tier: TierReport, items: list[Provenance], now: datetime) -> None:
    for prov in items:
        verdict = judge(prov, now)
        if verdict == "stale":
            tier.stale.append(prov.edge_id)
        elif verdict == "unverified":
            tier.unverified.append(prov.edge_id)
    if tier.stale:
        tier.status = CollectionStatus.STALE_EXPIRED


def collect_evidence(
    store: GraphStore,
    name: str,
    now: datetime | None = None,
    *,
    row_limit: int = 100_000,
    timeout_ms: int = TIMEOUT_MS,
) -> EvidenceSnapshot:
    """Read every evidence tier of graph `name` and judge scope completeness at time `now`."""
    now = now or datetime.now(UTC)
    rec = _Recorder(store.graph(name), row_limit, timeout_ms)
    tiers: dict[str, TierReport] = {}
    issues: list[ScopeIssue] = []

    def tier(
        tier_name: str, template: str, cypher: str, params: dict[str, Any] | None = None
    ) -> list[list[Any]]:
        try:
            rows = rec.query(template, cypher, params)
        except QueryFailedError as exc:
            tiers[tier_name] = TierReport(
                tier_name, CollectionStatus.QUERY_FAILED, error=exc.reason
            )
            return []
        status = CollectionStatus.COLLECTED_COMPLETE if rows else CollectionStatus.COLLECTED_EMPTY
        tiers[tier_name] = TierReport(tier_name, status, rows=len(rows))
        return rows

    meta_rows = tier("inventory", "evidence-meta", Q_META)
    meta = dict(meta_rows[0][0]) if meta_rows else {}
    revision = int(meta.get("revision", 0))
    pods = {
        r[0]: PodInfo(r[0], r[1], r[2], r[3] or "NONE", r[4] or "UNCOLLECTED")
        for r in tier("pods", "evidence-pods", Q_PODS)
    }
    db_rows = tier("databases", "evidence-databases", Q_DATABASES)
    databases = frozenset(r[0] for r in db_rows)
    crown = frozenset(r[0] for r in db_rows if r[1] is True)

    exposures = [
        Exposure(r[0], r[1], r[2], _provenance(r[3], r[4], r[5], r[6], r[7]))
        for r in tier("exposure", "evidence-exposure", Q_EXPOSURE, {"internet_id": INTERNET_ID})
    ]
    vulns = [
        VulnFinding(
            r[0],
            r[1],
            r[2],
            r[3],
            r[4],
            r[5],
            float(r[6] or 0),
            _provenance(r[7], r[8], r[9], r[10], r[11]),
        )
        for r in tier("vulnerability", "evidence-vulnerability", Q_VULNERABILITY)
    ]
    reach = [
        ReachEdge(
            r[3],
            r[0],
            r[1],
            (r[2] or ["?"])[0],
            int(r[4]),
            r[5],
            Provenance(r[3], r[6], r[7], r[8], r[9]),
        )
        for r in tier("reachability", "evidence-reachability", Q_REACHABILITY)
    ]
    grants = [
        Grant(r[0], r[1], r[2], r[3], r[4], _provenance(r[5], r[6], r[7], r[8], r[9]))
        for r in tier("authorization", "evidence-authorization", Q_AUTHORIZATION)
    ]
    policies = [
        PolicyInfo(
            r[0],
            r[1] or "BASELINE",
            r[2],
            r[3],
            frozenset(r[4]),
            frozenset((a[0], int(a[1]), a[2]) for a in r[5] if a and a[0] is not None),
        )
        for r in tier("policy", "evidence-policies", Q_POLICIES)
    ]
    declared_sets: dict[str, set[Flow]] = defaultdict(set)
    declared_ids: dict[tuple[str, Flow], str] = {}
    for r in tier("dependency", "evidence-dependencies", Q_DEPENDENCIES):
        flow = (r[1], int(r[2]), r[3])
        declared_sets[r[0]].add(flow)
        declared_ids[(r[0], flow)] = str(r[4])
    alerts = [
        AlertInfo(r[0], r[1], r[2], r[3], r[4] or "", r[5] or "", r[6] or "", r[7] or "")
        for r in tier("alerts", "evidence-alerts", Q_ALERTS)
    ]
    duplicates = tier("identity", "evidence-duplicate-ids", Q_DUPLICATE_IDS)

    # Freshness and provenance per tier (§6.4).
    _judge_tier(tiers["exposure"], [p for e in exposures for p in e.evidence], now)
    _judge_tier(tiers["vulnerability"], [p for v in vulns for p in v.evidence], now)
    _judge_tier(tiers["reachability"], [r.evidence for r in reach], now)
    _judge_tier(tiers["authorization"], [p for g in grants for p in g.evidence], now)

    uncollected = sorted(p.id for p in pods.values() if p.reach_status != "COLLECTED")
    if uncollected and tiers["reachability"].status != CollectionStatus.QUERY_FAILED:
        tiers["reachability"].status = CollectionStatus.UNCOLLECTED

    for report in tiers.values():
        if report.status == CollectionStatus.QUERY_FAILED:
            issues.append(
                ScopeIssue(InconclusiveReason.QUERY_FAILED, f"{report.name}: {report.error}")
            )
        if report.stale:
            issues.append(
                ScopeIssue(
                    InconclusiveReason.STALE_EVIDENCE,
                    f"{report.name}: evidence past valid_until",
                    tuple(report.stale),
                )
            )
        if report.unverified:
            issues.append(
                ScopeIssue(
                    InconclusiveReason.UNVERIFIED_EVIDENCE,
                    f"{report.name}: unverified or missing provenance",
                    tuple(report.unverified),
                )
            )
    if uncollected:
        issues.append(
            ScopeIssue(
                InconclusiveReason.UNCOLLECTED_EVIDENCE,
                "reachability not collected for some pods",
                tuple(uncollected),
            )
        )
    if meta and meta.get("inventory_complete") is not True:
        issues.append(
            ScopeIssue(InconclusiveReason.INVENTORY_INCOMPLETE, "inventory is not marked complete")
        )
    if duplicates:
        issues.append(
            ScopeIssue(
                InconclusiveReason.CONTRADICTORY_EVIDENCE,
                "duplicate ids",
                tuple(str(d[0]) for d in duplicates),
            )
        )
    contradictions = baseline_contradictions(reach, policies)
    if contradictions:
        issues.append(
            ScopeIssue(
                InconclusiveReason.CONTRADICTORY_EVIDENCE,
                "observed reachability is not allowed by the egress policies in force",
                tuple(contradictions),
            )
        )

    return EvidenceSnapshot(
        graph=name,
        revision=revision,
        evaluated_at=now,
        meta=meta,
        pods=pods,
        crown_jewels=crown,
        databases=databases,
        exposures=exposures,
        vulnerabilities=vulns,
        reach=reach,
        grants=grants,
        policies=policies,
        declared={k: frozenset(v) for k, v in declared_sets.items()},
        declared_ids=declared_ids,
        alerts=alerts,
        scope=ScopeReport(tiers, issues),
        queries=rec.records,
    )


def allowed_flows(pod: str, policies: list[PolicyInfo]) -> frozenset[Flow] | None:
    """Egress allowed for `pod` under additive Kubernetes semantics (§7.1).

    None means the pod is not selected by any egress policy, so all egress is allowed.
    """
    selecting = [p for p in policies if pod in p.selected]
    if not selecting:
        return None
    return frozenset().union(*(p.allows for p in selecting))


def baseline_contradictions(reach: list[ReachEdge], policies: list[PolicyInfo]) -> list[str]:
    """Observed reach that the policies in force do not allow (§6.6 item 4)."""
    bad = []
    for edge in reach:
        allowed = allowed_flows(edge.src, policies)
        if allowed is not None and edge.flow not in allowed:
            bad.append(edge.edge_id)
    return sorted(bad)
