"""Path Hunter: verify a plan on a candidate graph, re-plan until nothing survives (§8, §9).

Each round copies the sandbox into a private candidate graph, adds the plan's candidate egress
policies there, and lets FalkorDB prune every observed flow that the policies in force no longer
allow (union semantics, §7.1). The pruned flows must be exactly the flows the planner predicted,
so a planner and a policy engine that disagree can never certify anything. Three methods then
look for surviving paths:

    E  bounded chains (at most 3 lateral hops) over base CAN_REACH evidence (Q-E1)
    F  FalkorDB max-flow from the Internet to each crown jewel over ATTACK_STEP (Q-F1)
    O  the oracle's breadth-first search over the exported ATTACK_STEP edges (D-14)

They must agree for every crown jewel: F > 0 exactly when O reaches it, and every E chain ends at
a target both reach. E is bounded, so F > 0 without an E chain is a path beyond the bound, not a
disagreement (D-20). All residual paths to T_scope (E's chains and F's flow decomposition) join
the constraint set and the planner runs again, for at most 5 rounds (D-02). A residual that the
current plan claims to cut means planner and graph disagree, which is a defect, never a pass.

A certificate is issued only when E, F and O all find nothing for T_scope, both scopes were
complete, nothing failed and the sandbox revision never moved (§8.8, §9.1). Every candidate graph
is deleted at the end unless it was promoted to `cert:{id}`, which expires after 24 hours.
"""

from __future__ import annotations

import time
import uuid
from collections import defaultdict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import redis

import interdict_oracle
from interdict.db import QueryFailedError, run
from interdict.engine.attackgraph import (
    Chain,
    FlowResult,
    RevisionChangedError,
    build_attack_steps,
    chain_id,
    enumerate_chains,
    export_steps,
    max_flow,
)
from interdict.engine.certificate import (
    RETENTION_MS,
    Certificate,
    build_certificate,
    new_certificate_id,
)
from interdict.engine.evidence import (
    INTERNET_ID,
    EvidenceSnapshot,
    QueryRecord,
    collect_evidence,
    timed,
)
from interdict.engine.planner import MAX_PLAN_ACTIONS, Plan, PlanReport, plan_remediation
from interdict.engine.sandbox import graph_lock, read_revision
from interdict.engine.snapshot import SnapshotError, snapshot_hash
from interdict.engine.statuses import InconclusiveReason, PlanStatus, SimulationStatus
from interdict.engine.triage import StormReport
from interdict.graphstore import GraphCopyError, GraphRenameError, GraphStore, LockTimeoutError
from interdict_oracle.reachability import reachable_targets, witness_paths

MAX_ROUNDS = 5
TIMEOUT_MS = 5_000
CANDIDATE_OWNER = "INTERDICT_CANDIDATE"

Q_CANDIDATE_POLICIES = (
    "UNWIND $policies AS pol "
    "CREATE (np:NetworkPolicy {id: pol.id, name: pol.name, namespace: pol.namespace, "
    "pod_selector: pol.selector, policy_types: ['Egress'], status: 'CANDIDATE', "
    "managed_by: $owner, candidate_action_id: pol.action}) "
    "WITH np, pol UNWIND pol.pods AS pod_id MATCH (p:Pod {id: pod_id}) "
    "CREATE (np)-[:SELECTS {id: 'sel-' + pol.id + '-' + pod_id}]->(p)"
)
Q_CANDIDATE_ALLOWS = (
    "UNWIND $allows AS al MATCH (np:NetworkPolicy {id: al.policy}) MATCH (d {id: al.dst}) "
    "CREATE (np)-[:ALLOWS_EGRESS {id: al.id, port: al.port, protocol: al.protocol}]->(d)"
)
Q_PRUNE = (  # §7.1 in the graph: an isolated pod keeps only flows some selecting policy allows
    "MATCH (np:NetworkPolicy)-[:SELECTS]->(p:Pod) WHERE 'Egress' IN np.policy_types "
    "WITH DISTINCT p MATCH (p)-[c:CAN_REACH]->(d) "
    "OPTIONAL MATCH (p)<-[:SELECTS]-(q:NetworkPolicy)-[a:ALLOWS_EGRESS]->(d) "
    "WHERE 'Egress' IN q.policy_types AND a.port = c.port AND a.protocol = c.protocol "
    "WITH c, count(a) AS allowed WHERE allowed = 0 "
    "WITH collect(c) AS doomed, collect(c.id) AS ids "
    "FOREACH (c IN doomed | DELETE c) RETURN ids"
)
Q_MARK_CANDIDATE = (
    "MATCH (m:Meta {id: 'meta'}) "
    "SET m.candidate_of = $sandbox, m.candidate_plan = $plan, m.candidate_round = $round"
)


class HuntStoppedError(Exception):
    """Ends a hunt as SIMULATION_INCONCLUSIVE with a reason."""

    def __init__(self, reason: InconclusiveReason, detail: str) -> None:
        super().__init__(detail)
        self.reason = reason
        self.detail = detail


@dataclass(frozen=True)
class RoundReport:
    round: int
    plan_id: str
    action_ids: tuple[str, ...]
    candidate: str
    pruned: tuple[str, ...]  # CAN_REACH ids FalkorDB removed under the policies in force
    steps: int  # ATTACK_STEP edges in the candidate
    e_chains: tuple[str, ...]  # method E: bounded chains to T_scope
    f_values: dict[str, int]  # method F: max-flow value per crown jewel
    o_reachable: tuple[str, ...]  # method O: crown jewels reachable from the Internet
    witnesses: dict[str, tuple[str, ...]]  # one path per crown jewel O reaches
    residuals: tuple[str, ...]  # chain ids added to the constraint set after this round
    out_of_scope: tuple[str, ...]  # reachable crown jewels outside T_scope
    latency_ms: dict[str, float]  # per method (E, F, O) and for the whole round


@dataclass
class HuntReport:
    status: SimulationStatus | PlanStatus
    sandbox: str
    revision: int
    t_scope: tuple[str, ...]
    evaluated_at: datetime
    reason: str | None = None
    detail: str = ""
    rounds: list[RoundReport] = field(default_factory=list)
    plan: PlanReport | None = None  # the last plan computed
    chains: list[Chain] = field(default_factory=list)  # the final constraint set
    residual_paths: list[tuple[str, ...]] = field(default_factory=list)
    out_of_scope_residuals: list[str] = field(default_factory=list)
    certificate: Certificate | None = None
    queries: list[QueryRecord] = field(default_factory=list)


def decompose(
    flows: Iterable[tuple[str, str, int]], source: str, targets: set[str]
) -> list[tuple[str, ...]]:
    """Unit paths of a flow from `source` to `targets`, cycles removed (§8.6). Deterministic."""
    remaining: dict[str, dict[str, int]] = defaultdict(dict)
    total = 0
    for src, dst, units in flows:
        remaining[src][dst] = remaining[src].get(dst, 0) + units
        total += units
    paths = []
    for _ in range(sum(remaining[source].values())):
        walk, node = [source], source
        while node not in targets:
            nxt = next((d for d in sorted(remaining[node]) if remaining[node][d] > 0), None)
            if nxt is None or len(walk) > total + 1:
                raise ValueError(f"the max-flow result is not conserved at {node}")
            remaining[node][nxt] -= 1
            walk.append(nxt)
            node = nxt
        paths.append(_without_cycles(walk))
    return paths


def _without_cycles(walk: list[str]) -> tuple[str, ...]:
    path: list[str] = []
    for node in walk:
        if node in path:
            del path[path.index(node) + 1 :]
        else:
            path.append(node)
    return tuple(path)


def path_chain(path: tuple[str, ...]) -> Chain:
    """(Internet, pods..., target) -> the chain it walks."""
    pods, target = path[1:-1], path[-1]
    if not pods:
        raise ValueError(f"a path needs at least one pod: {path}")
    return Chain(chain_id(pods, target), pods, target)


def apply_plan(store: GraphStore, candidate: str, plan: Plan) -> list[str]:
    """Add the plan's candidate policies, then prune disallowed flows. Returns the pruned ids."""
    graph = store.graph(candidate)
    policies, allows = [], []
    for action in plan.actions:
        policy_id = f"np-{action.namespace}-idt-candidate-{action.app}-egress"
        spec = action.policy_spec()["policy_spec"]
        policies.append(
            {
                "id": policy_id,
                "name": spec["name"],
                "namespace": spec["namespace"],
                "selector": spec["pod_selector"],
                "action": action.id,
                "pods": list(action.pods),
            }
        )
        allows.extend(
            {
                "policy": policy_id,
                "id": f"allow-{policy_id}-{dst}-{port}-{protocol.lower()}",
                "dst": dst,
                "port": port,
                "protocol": protocol,
            }
            for dst, port, protocol in sorted(action.allow)
        )
    if policies:
        created = run(
            graph,
            "candidate-policies",
            Q_CANDIDATE_POLICIES,
            {"policies": policies, "owner": CANDIDATE_OWNER},
            timeout_ms=TIMEOUT_MS,
        )
        selects = sum(len(p["pods"]) for p in policies)
        if created.nodes_created != len(policies) or created.relationships_created != selects:
            raise HuntStoppedError(
                InconclusiveReason.QUERY_FAILED, "candidate policies were not fully created"
            )
    if allows:
        created = run(
            graph, "candidate-allows", Q_CANDIDATE_ALLOWS, {"allows": allows}, timeout_ms=TIMEOUT_MS
        )
        if created.relationships_created != len(allows):
            raise HuntStoppedError(
                InconclusiveReason.QUERY_FAILED, "candidate allow rules were not fully created"
            )
    rows = run(graph, "candidate-prune", Q_PRUNE, timeout_ms=TIMEOUT_MS).result_set
    return sorted(rows[0][0]) if rows else []


def disagreement(
    chains: Iterable[Chain], flows: dict[str, FlowResult], reached: set[str]
) -> str | None:
    """The agreement rule (D-20); returns what disagrees, or None."""
    for target, flow in sorted(flows.items()):
        if (flow.value > 0) != (target in reached):
            verdict = "reaches" if target in reached else "does not reach"
            return f"max-flow to {target} is {flow.value} but the oracle {verdict} it"
    for chain in chains:
        if chain.target not in reached or flows[chain.target].value == 0:
            return f"bounded chain {chain.id} is not confirmed by max-flow and the oracle"
    return None


@dataclass
class _Verified:
    round: RoundReport
    candidate: str
    snapshot: EvidenceSnapshot
    residual: dict[str, Chain]
    surviving: list[str]


class _Hunt:
    """One hunt's state: the sandbox triage, T_scope, the query log and live candidate graphs."""

    def __init__(
        self, store: GraphStore, triage: StormReport, scope: tuple[str, ...], report: HuntReport
    ) -> None:
        self.store = store
        self.triage = triage
        self.scope = scope
        self.crown = sorted(triage.snapshot.crown_jewels)
        self.report = report
        self.records = report.queries
        self.run_id = uuid.uuid4().hex[:12]
        self.live: list[str] = []
        self.baseline_hash: str | None = None

    def stop_if_changed(self, detail: str) -> None:
        if read_revision(self.store, self.triage.graph) != self.triage.revision:
            raise HuntStoppedError(InconclusiveReason.REVISION_CHANGED, detail)

    def copy(self, number: int) -> str:
        candidate = f"cand:{self.run_id}:r{number}"
        with self.store.lock(graph_lock(self.triage.graph)):
            self.stop_if_changed("the sandbox changed during the hunt")
            timed(
                self.records,
                "candidate-copy",
                lambda: self.store.copy(self.triage.graph, candidate),
            )
            self.live.append(candidate)
        if read_revision(self.store, candidate) != self.triage.revision:
            raise HuntStoppedError(
                InconclusiveReason.REVISION_CHANGED, "the copy has a different revision"
            )
        if self.baseline_hash is None:  # the untouched copy is the sandbox at this revision
            self.baseline_hash = timed(
                self.records, "snapshot-baseline", lambda: snapshot_hash(self.store, candidate)
            ).hash
        return candidate

    def verify(self, number: int, plan: Plan) -> _Verified:
        """One round: candidate graph, policies, then E, F and O (§8.7)."""
        started = time.perf_counter()
        store, records, now = self.store, self.records, self.triage.evaluated_at
        candidate = self.copy(number)
        run(
            store.graph(candidate),
            "candidate-mark",
            Q_MARK_CANDIDATE,
            {"sandbox": self.triage.graph, "plan": plan.id, "round": number},
            timeout_ms=TIMEOUT_MS,
        )
        pruned = timed(records, "candidate-apply", lambda: apply_plan(store, candidate, plan), len)
        if set(pruned) != plan.blocked:
            raise HuntStoppedError(
                InconclusiveReason.METHOD_DISAGREEMENT,
                f"FalkorDB pruned {len(pruned)} flows under the candidate policies; "
                f"the planner predicted {len(plan.blocked)}",
            )

        snap = collect_evidence(store, candidate, now)
        records.extend(snap.queries)
        if not snap.scope.complete:
            issue = snap.scope.issues[0]
            raise HuntStoppedError(issue.reason, f"candidate scope incomplete: {issue.detail}")
        timed(
            records,
            "candidate-attack-build",
            lambda: build_attack_steps(store, candidate, snap),
            lambda b: b.total,
        )
        steps = timed(
            records, "candidate-attack-export", lambda: export_steps(store, candidate), len
        )

        mark = time.perf_counter()
        bounded = timed(
            records,
            "candidate-enumerate-E",
            lambda: enumerate_chains(store, candidate, snap, set(self.scope)),
            lambda cs: len(cs.chains),
        )
        if bounded.truncated:
            raise HuntStoppedError(InconclusiveReason.QUERY_FAILED, "chain enumeration hit its cap")
        e_ms, mark = _since(mark), time.perf_counter()
        flows = {
            target: timed(
                records,
                f"candidate-maxflow-F:{target}",
                lambda target=target: max_flow(store, candidate, [target], steps=len(steps)),
                lambda f: f.value,
            )
            for target in self.crown
        }
        f_ms, mark = _since(mark), time.perf_counter()
        edges = [(s.src, s.dst) for s in steps]
        reached = reachable_targets(edges, INTERNET_ID, self.crown)
        witnesses = witness_paths(edges, INTERNET_ID, self.crown)
        o_ms = _since(mark)
        problem = disagreement(bounded.chains, flows, reached)
        if problem:
            raise HuntStoppedError(InconclusiveReason.METHOD_DISAGREEMENT, problem)

        surviving = [t for t in self.scope if flows[t].value > 0]
        outside = tuple(t for t in self.crown if t not in self.scope and flows[t].value > 0)
        residual: dict[str, Chain] = {c.id: c for c in bounded.chains}
        if surviving:
            in_scope = (
                flows[self.scope[0]]
                if len(self.scope) == 1
                else max_flow(store, candidate, self.scope, steps=len(steps))
            )
            try:
                for path in decompose(in_scope.flows, INTERNET_ID, set(self.scope)):
                    chain = path_chain(path)
                    residual.setdefault(chain.id, chain)
            except ValueError as exc:
                raise HuntStoppedError(InconclusiveReason.METHOD_DISAGREEMENT, str(exc)) from exc
        self.report.out_of_scope_residuals = sorted(
            path_chain(witnesses[t]).id for t in outside if t in witnesses
        )
        report = RoundReport(
            round=number,
            plan_id=plan.id,
            action_ids=plan.action_ids,
            candidate=candidate,
            pruned=tuple(pruned),
            steps=len(steps),
            e_chains=tuple(sorted(c.id for c in bounded.chains)),
            f_values={t: f.value for t, f in flows.items()},
            o_reachable=tuple(sorted(reached)),
            witnesses=witnesses,
            residuals=tuple(sorted(residual)) if surviving else (),
            out_of_scope=outside,
            latency_ms={"E": e_ms, "F": f_ms, "O": o_ms, "round": _since(started)},
        )
        self.report.rounds.append(report)
        return _Verified(report, candidate, snap, residual, surviving)

    def issue(self, verified: _Verified, plan: Plan, max_rounds: int) -> Certificate:
        """Hash the final candidate, build the certificate and keep the graph as `cert:{id}`."""
        baseline_hash = self.baseline_hash
        if baseline_hash is None:
            raise HuntStoppedError(InconclusiveReason.QUERY_FAILED, "the sandbox was not hashed")
        self.stop_if_changed("the sandbox changed before issuance")
        candidate = verified.candidate
        candidate_hash = timed(
            self.records, "snapshot-candidate", lambda: snapshot_hash(self.store, candidate)
        ).hash
        certificate_id = new_certificate_id()
        key = f"cert:{certificate_id}"
        try:
            certificate = self._build(
                verified, plan, max_rounds, certificate_id, key, baseline_hash, candidate_hash
            )
        except ValueError as exc:
            raise HuntStoppedError(InconclusiveReason.STALE_EVIDENCE, str(exc)) from exc
        self.store.expire(candidate, RETENTION_MS)  # RENAME keeps the expiry
        self.store.rename(candidate, key)
        self.live.remove(candidate)
        return certificate

    def _build(
        self,
        verified: _Verified,
        plan: Plan,
        max_rounds: int,
        certificate_id: str,
        key: str,
        baseline_hash: str,
        candidate_hash: str,
    ) -> Certificate:
        report, last = self.report, verified.round
        return build_certificate(
            certificate_id=certificate_id,
            now=self.triage.evaluated_at,
            sandbox=self.triage.graph,
            revision=self.triage.revision,
            baseline_hash=baseline_hash,
            candidate_key=key,
            candidate_hash=candidate_hash,
            t_scope=self.scope,
            max_rounds=max_rounds,
            snapshot=verified.snapshot,
            plan=plan,
            optimality=report.plan.solution.optimality.value,
            verification={
                "enumerator_E": {
                    "chains_found": len(last.e_chains),
                    "template": "Q-E1",
                    "latency_ms": last.latency_ms["E"],
                },
                "maxflow_F": {
                    "value_t_scope": sum(last.f_values[t] for t in self.scope),
                    "value_all_crown_jewels": sum(last.f_values.values()),
                    "per_target": dict(sorted(last.f_values.items())),
                    "template": "Q-F1",
                    "latency_ms": last.latency_ms["F"],
                },
                "oracle_O": {
                    "reachable_targets": sorted(set(last.o_reachable) & set(self.scope)),
                    "method": interdict_oracle.METHOD,
                    "version": interdict_oracle.__version__,
                    "latency_ms": last.latency_ms["O"],
                },
                "agreement": True,
                "rounds": [
                    {
                        "round": r.round,
                        "plan_id": r.plan_id,
                        "residual_chain_ids": list(r.residuals),
                    }
                    for r in report.rounds
                ],
                "out_of_scope_residuals": report.out_of_scope_residuals,
            },
            falkordb_version=self.store.server_version(),
            oracle_version=f"{interdict_oracle.METHOD} {interdict_oracle.__version__}",
        )

    def discard(self, candidate: str) -> None:
        self.store.delete(candidate)
        self.live.remove(candidate)


def _since(started: float) -> float:
    return round((time.perf_counter() - started) * 1000, 2)


def hunt(
    store: GraphStore,
    triage: StormReport,
    t_scope: Iterable[str],
    chains: Iterable[Chain],
    *,
    k: int = MAX_PLAN_ACTIONS,
    strict: bool = False,
    max_rounds: int = MAX_ROUNDS,
    audit: Callable[[dict[str, Any]], str] | None = None,
) -> HuntReport:
    """Plan, verify and re-plan for T_scope starting from the constraint set `chains` (§8.7).

    `triage` is the sandbox's current triage: its evaluation time is used for every freshness
    check, and its revision must hold from the first copy until issuance. `audit`, if given,
    records the certificate document and returns the audit event hash; if it fails, the
    certificate is withdrawn (no unaudited certificate).
    """
    scope = tuple(sorted(set(t_scope)))
    if not scope or not set(scope) <= triage.snapshot.crown_jewels:
        raise ValueError("T_scope must be a non-empty set of crown jewels")
    if not 1 <= max_rounds <= MAX_ROUNDS:
        raise ValueError(f"max_rounds must be between 1 and {MAX_ROUNDS}")

    report = HuntReport(
        SimulationStatus.SIMULATION_INCONCLUSIVE,
        triage.graph,
        triage.revision,
        scope,
        triage.evaluated_at,
    )
    state = _Hunt(store, triage, scope, report)
    constraint = {c.id: c for c in chains}

    def replan() -> bool:
        report.plan = plan_remediation(triage, constraint.values(), k=k, strict=strict)
        report.chains = sorted(constraint.values(), key=lambda c: c.id)
        if report.plan.status == PlanStatus.PLAN_FOUND:
            return True
        report.status = report.plan.status
        solution = report.plan.solution
        reason = solution.no_plan_reason if solution else report.plan.inconclusive_reason
        report.reason = reason.value if reason else None
        return False

    try:
        if not replan():
            return report
        for number in range(max_rounds):
            plan = report.plan.plan
            verified = state.verify(number, plan)
            if not verified.surviving:
                report.certificate = state.issue(verified, plan, max_rounds)
                if audit is not None:
                    try:
                        event_hash = audit(report.certificate.to_dict())
                    except Exception as exc:
                        store.delete(report.certificate.candidate_graph_key)
                        raise HuntStoppedError(
                            InconclusiveReason.QUERY_FAILED, f"audit append failed: {exc}"
                        ) from exc
                    report.certificate = report.certificate.with_audit(event_hash)
                report.status = SimulationStatus.SIMULATED_CONTAINMENT
                return report

            claimed = sorted(set(verified.residual) & set(constraint))
            if claimed:
                raise HuntStoppedError(
                    InconclusiveReason.METHOD_DISAGREEMENT,
                    f"the plan claims to cut {', '.join(claimed)}, but the candidate keeps it",
                )
            constraint.update(verified.residual)
            state.discard(verified.candidate)
            if number + 1 == max_rounds:
                report.chains = sorted(constraint.values(), key=lambda c: c.id)
                report.residual_paths = sorted(
                    (INTERNET_ID, *c.pods, c.target) for c in verified.residual.values()
                )
                report.status = SimulationStatus.SIMULATED_RESIDUAL_EXPOSURE
                return report
            if not replan():
                return report
        return report  # pragma: no cover - the loop always returns
    except HuntStoppedError as stop:
        return _inconclusive(report, stop.reason, stop.detail)
    except QueryFailedError as exc:
        return _inconclusive(
            report, InconclusiveReason.QUERY_FAILED, f"{exc.template}: {exc.reason}"
        )
    except RevisionChangedError as exc:
        return _inconclusive(report, InconclusiveReason.REVISION_CHANGED, str(exc))
    except SnapshotError as exc:
        return _inconclusive(report, InconclusiveReason.CONTRADICTORY_EVIDENCE, str(exc))
    except (GraphCopyError, GraphRenameError, LockTimeoutError, redis.exceptions.RedisError) as exc:
        return _inconclusive(report, InconclusiveReason.QUERY_FAILED, str(exc))
    finally:
        for name in list(state.live):
            store.delete(name)


def _inconclusive(report: HuntReport, reason: InconclusiveReason, detail: str) -> HuntReport:
    report.status = SimulationStatus.SIMULATION_INCONCLUSIVE
    report.reason = reason.value
    report.detail = detail
    report.certificate = None
    return report
