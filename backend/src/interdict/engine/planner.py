"""Cheapest safe fix: allowlist actions, computed impact and exact search (solution.md §7).

Kubernetes egress policies are additive allow lists with no deny rules (§7.1), so every action
gives one workload selector (namespace, app) an explicit egress allow list:

    EGRESS_DECLARED  declared dependencies plus DNS
    EGRESS_STRICT    the same minus the attack flows (only when an attack flow is declared)
    EGRESS_DENY_ALL  nothing, DNS included

A selector is eligible only if no existing egress policy selects any of its pods (under union
semantics a new policy cannot restrict a pod that is already isolated) and one of its pods starts
a cuttable step of a chain in the constraint set C. ENTRY steps cannot be cut by egress policies.

The search is exact within the catalogue. Every plan of at most k actions, one per selector, is
evaluated, and the best by this lexicographic objective wins:

    (1) declared dependencies broken    (2) blocked flows of unknown impact    (3) actions
    (4) flows blocked                   (5) sorted action ids, a deterministic tie-break

A plan is therefore optimal among plans of at most k actions from this catalogue, not over every
possible policy. General weighted hitting set is NP-hard; exactness comes from the small bounded
instance (at most 30 actions and k <= 3, so at most 4,526 subsets). Each action's hits are a
bitmask over C, so checking a subset costs a few integer ORs however large C is.
"""

from __future__ import annotations

import hashlib
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from itertools import combinations
from typing import Any

from interdict.engine.attackgraph import Chain
from interdict.engine.evidence import EvidenceSnapshot, Flow, ReachEdge
from interdict.engine.statuses import (
    DependencyManifest,
    ImpactStatus,
    NoPlanReason,
    PlanningInconclusiveReason,
    PlanOptimality,
    PlanStatus,
)
from interdict.engine.triage import StormReport

PLATFORM_DNS = "kube-dns"
DNS_FLOWS: frozenset[Flow] = frozenset({(PLATFORM_DNS, 53, "UDP"), (PLATFORM_DNS, 53, "TCP")})
MAX_PLAN_ACTIONS = 3
CATALOGUE_CAP = 30
ALTERNATIVES = 3
ACTION_TYPE = "APPLY_NETWORK_POLICY_ISOLATE"
INELIGIBLE_EXISTING_EGRESS_POLICY = "INELIGIBLE_EXISTING_EGRESS_POLICY"

Objective = tuple[int, int, int, int, tuple[str, ...]]


class Variant(StrEnum):
    EGRESS_DECLARED = "EGRESS_DECLARED"
    EGRESS_STRICT = "EGRESS_STRICT"
    EGRESS_DENY_ALL = "EGRESS_DENY_ALL"


@dataclass(frozen=True)
class FlowRef:
    """A flow named by its evidence id: an observed CAN_REACH or a declared DEPENDS_ON edge."""

    id: str
    src: str
    dst: str
    port: int
    protocol: str


@dataclass(frozen=True)
class Action:
    id: str
    namespace: str
    app: str
    variant: Variant
    pods: tuple[str, ...]
    allow: frozenset[Flow]
    blocked: frozenset[str]  # observed CAN_REACH ids the allow list no longer permits
    removed: frozenset[tuple[str, str]]  # (pod, destination) pairs left with no permitted flow
    known_broken: frozenset[str]  # declared DEPENDS_ON ids the allow list no longer permits
    unknown: frozenset[str]  # blocked ids from PARTIAL or NONE manifests that are not declared

    @property
    def selector(self) -> tuple[str, str]:
        return (self.namespace, self.app)

    def policy_spec(self) -> dict[str, Any]:
        """The candidate NetworkPolicy in the V5 form (§7.3)."""
        return {
            "candidate_action_id": self.id,
            "action_type": ACTION_TYPE,
            "policy_spec": {
                "name": f"idt-candidate-{self.app}-egress",
                "namespace": self.namespace,
                "pod_selector": f"app={self.app}",
                "policy_types": ["Egress"],
                "allows_egress": [
                    {"destination_id": dst, "port": port, "protocol": protocol}
                    for dst, port, protocol in sorted(self.allow)
                ],
            },
        }


def objective(actions: Iterable[Action]) -> Objective:
    """The lexicographic cost of a set of actions (§7.6); smaller is better."""
    chosen = list(actions)
    return (
        len(frozenset().union(*(a.known_broken for a in chosen))),
        len(frozenset().union(*(a.unknown for a in chosen))),
        len(chosen),
        len(frozenset().union(*(a.blocked for a in chosen))),
        tuple(sorted(a.id for a in chosen)),
    )


@dataclass(frozen=True)
class Plan:
    actions: tuple[Action, ...]  # sorted by id
    covered: frozenset[str]  # ids of the constraint chains this plan cuts

    @classmethod
    def of(cls, actions: Iterable[Action], covered: frozenset[str]) -> Plan:
        return cls(tuple(sorted(actions, key=lambda a: a.id)), covered)

    @property
    def id(self) -> str:
        if not self.actions:
            return "plan-empty"
        digest = hashlib.sha256("|".join(self.action_ids).encode()).hexdigest()
        return f"plan-{digest[:12]}"

    @property
    def action_ids(self) -> tuple[str, ...]:
        return tuple(a.id for a in self.actions)

    @property
    def known_broken(self) -> frozenset[str]:
        return frozenset().union(*(a.known_broken for a in self.actions))

    @property
    def unknown(self) -> frozenset[str]:
        return frozenset().union(*(a.unknown for a in self.actions))

    @property
    def blocked(self) -> frozenset[str]:
        return frozenset().union(*(a.blocked for a in self.actions))

    @property
    def objective(self) -> Objective:
        return objective(self.actions)

    @property
    def impact_status(self) -> ImpactStatus:
        if self.unknown:
            return ImpactStatus.IMPACT_PARTIALLY_UNKNOWN
        if self.known_broken:
            return ImpactStatus.KNOWN_DISRUPTION
        return ImpactStatus.KNOWN_ZERO_DISRUPTION


@dataclass(frozen=True)
class IneligibleSelector:
    namespace: str
    app: str
    reason: str
    policies: tuple[str, ...]  # the egress policies that already select its pods


@dataclass(frozen=True)
class Catalogue:
    actions: tuple[Action, ...]
    ineligible: tuple[IneligibleSelector, ...]


@dataclass(frozen=True)
class Solution:
    """The exact search result: a best plan, or an honest account of why there is none."""

    status: PlanStatus
    plan: Plan | None
    alternatives: tuple[Plan, ...]  # the next best feasible plans
    hard_isolation: Plan | None  # the best feasible plan made only of EGRESS_DENY_ALL actions
    best_partial: Plan | None  # when infeasible: most chains cut, then the objective
    uncovered: tuple[str, ...]  # chains the best partial plan leaves open
    no_plan_reason: NoPlanReason | None
    feasible: int  # feasible plans found
    evaluated: int  # subsets examined

    @property
    def optimality(self) -> PlanOptimality | None:
        return PlanOptimality.EXACT_WITHIN_K if self.plan else None


@dataclass
class PlanReport:
    status: PlanStatus
    graph: str
    revision: int
    k: int
    strict: bool
    chains: list[str]  # the constraint set C
    inconclusive_reason: PlanningInconclusiveReason | None = None
    solution: Solution | None = None
    catalogue: list[Action] = field(default_factory=list)
    ineligible: list[IneligibleSelector] = field(default_factory=list)
    flows: dict[str, FlowRef] = field(default_factory=dict)  # every flow the catalogue names

    @property
    def plan(self) -> Plan | None:
        return self.solution.plan if self.solution else None


def build_catalogue(snapshot: EvidenceSnapshot, chains: Iterable[Chain]) -> Catalogue:
    """Candidate actions for the selectors whose pods start a cuttable step of a chain in C."""
    steps = {pair for chain in chains for pair in chain.steps()}
    members: dict[tuple[str, str], list[str]] = defaultdict(list)
    for pod in snapshot.pods.values():
        members[(pod.namespace, pod.app)].append(pod.id)
    outgoing: dict[str, list[ReachEdge]] = defaultdict(list)
    for edge in snapshot.reach:
        outgoing[edge.src].append(edge)
    selectors = sorted(
        {
            (snapshot.pods[src].namespace, snapshot.pods[src].app)
            for src, _ in steps
            if src in snapshot.pods
        }
    )

    actions: list[Action] = []
    ineligible: list[IneligibleSelector] = []
    for namespace, app in selectors:
        pods = tuple(sorted(members[(namespace, app)]))
        selecting = sorted(p.id for p in snapshot.policies if p.selected & set(pods))
        if selecting:
            ineligible.append(
                IneligibleSelector(
                    namespace, app, INELIGIBLE_EXISTING_EGRESS_POLICY, tuple(selecting)
                )
            )
            continue
        edges = [edge for pod in pods for edge in outgoing[pod]]
        declared = frozenset().union(*(snapshot.declared.get(pod, ()) for pod in pods))
        keep = declared | DNS_FLOWS
        attack = {edge.flow for edge in edges if (edge.src, edge.dst) in steps}
        variants = [(Variant.EGRESS_DECLARED, keep)]
        if keep - attack != keep:
            variants.append((Variant.EGRESS_STRICT, keep - attack))
        variants.append((Variant.EGRESS_DENY_ALL, frozenset()))
        actions.extend(
            _action(snapshot, namespace, app, pods, edges, variant, allow)
            for variant, allow in variants
        )
    return Catalogue(tuple(actions), tuple(ineligible))


def _action(
    snapshot: EvidenceSnapshot,
    namespace: str,
    app: str,
    pods: tuple[str, ...],
    edges: list[ReachEdge],
    variant: Variant,
    allow: frozenset[Flow],
) -> Action:
    """Impact of one allow list on the selector's pods (§7.4)."""
    blocked = frozenset(edge.edge_id for edge in edges if edge.flow not in allow)
    by_pair: dict[tuple[str, str], set[str]] = defaultdict(set)
    for edge in edges:
        by_pair[(edge.src, edge.dst)].add(edge.edge_id)
    removed = frozenset(pair for pair, ids in by_pair.items() if ids <= blocked)
    known_broken = frozenset(
        snapshot.declared_ids[(pod, flow)]
        for pod in pods
        for flow in snapshot.declared.get(pod, ())
        if flow not in allow
    )
    unknown = frozenset(
        edge.edge_id
        for edge in edges
        if edge.edge_id in blocked
        and snapshot.pods[edge.src].manifest != DependencyManifest.COMPLETE
        and edge.flow not in snapshot.declared.get(edge.src, ())
    )
    return Action(
        id=f"act:{namespace}:{app}:{variant}",
        namespace=namespace,
        app=app,
        variant=variant,
        pods=pods,
        allow=allow,
        blocked=blocked,
        removed=removed,
        known_broken=known_broken,
        unknown=unknown,
    )


def solve(
    actions: Sequence[Action],
    chains: Iterable[Chain],
    *,
    k: int = MAX_PLAN_ACTIONS,
    strict: bool = False,
) -> Solution:
    """Exact search over every plan of at most `k` actions with at most one per selector (§7.6).

    A plan is feasible when it cuts every chain and, in strict mode, has no unknown impact. The
    best partial plan obeys the same rules except coverage: it is what could be applied.
    """
    constraint = sorted({c.id: c for c in chains}.values(), key=lambda c: c.id)
    step_bits: dict[tuple[str, str], int] = defaultdict(int)
    for bit, chain in enumerate(constraint):
        for pair in chain.steps():
            step_bits[pair] |= 1 << bit
    hits = []
    for action in actions:
        mask = 0
        for pair in action.removed:
            mask |= step_bits.get(pair, 0)
        hits.append(mask)
    every = (1 << len(constraint)) - 1

    feasible: list[tuple[Objective, tuple[int, ...]]] = []
    partial: tuple[tuple[int, Objective], tuple[int, ...], int] | None = None
    covering = evaluated = 0
    for size in range(k + 1):
        for combo in combinations(range(len(actions)), size):
            chosen = [actions[i] for i in combo]
            if len({a.selector for a in chosen}) < size:
                continue
            evaluated += 1
            mask = 0
            for i in combo:
                mask |= hits[i]
            if strict and any(a.unknown for a in chosen):
                covering += mask == every
                continue
            cost = objective(chosen)
            if mask == every:
                covering += 1
                feasible.append((cost, combo))
            key = (-mask.bit_count(), cost)
            if partial is None or key < partial[0]:
                partial = (key, combo, mask)

    every_id = frozenset(c.id for c in constraint)
    feasible.sort()
    if feasible:
        ranked = [combo for _, combo in feasible]
        plan = Plan.of((actions[i] for i in ranked[0]), every_id)
        # Alternatives are minimal: a plan with an action that cuts nothing new is not a choice.
        alternatives = [
            Plan.of((actions[i] for i in combo), every_id)
            for combo in ranked[1:]
            if _minimal(combo, hits, every)
        ][:ALTERNATIVES]
        hard = next(
            (
                combo
                for combo in ranked
                if combo and all(actions[i].variant == Variant.EGRESS_DENY_ALL for i in combo)
            ),
            None,
        )
        return Solution(
            status=PlanStatus.PLAN_FOUND,
            plan=plan,
            alternatives=tuple(alternatives),
            hard_isolation=Plan.of((actions[i] for i in hard), every_id) if hard else None,
            best_partial=None,
            uncovered=(),
            no_plan_reason=None,
            feasible=len(feasible),
            evaluated=evaluated,
        )

    best_partial = None
    if partial is not None:
        _, combo, mask = partial
        cut = frozenset(c.id for bit, c in enumerate(constraint) if mask >> bit & 1)
        best_partial = Plan.of((actions[i] for i in combo), cut)
    removable = frozenset().union(*(a.removed for a in actions))
    if any(not set(chain.steps()) & removable for chain in constraint):
        reason = NoPlanReason.NO_ELIGIBLE_ACTION
    elif strict and covering:
        reason = NoPlanReason.UNKNOWN_IMPACT_EXCLUDED
    else:
        reason = NoPlanReason.K_EXCEEDED
    return Solution(
        status=PlanStatus.NO_FEASIBLE_PLAN_WITHIN_K,
        plan=None,
        alternatives=(),
        hard_isolation=None,
        best_partial=best_partial,
        uncovered=tuple(sorted(every_id - (best_partial.covered if best_partial else set()))),
        no_plan_reason=reason,
        feasible=0,
        evaluated=evaluated,
    )


def _minimal(combo: tuple[int, ...], hits: list[int], every: int) -> bool:
    """True if dropping any one action would leave some chain uncut."""
    for left_out in combo:
        rest = 0
        for i in combo:
            if i != left_out:
                rest |= hits[i]
        if rest == every:
            return False
    return True


def plan_remediation(
    triage: StormReport,
    chains: Iterable[Chain] | None = None,
    *,
    k: int = MAX_PLAN_ACTIONS,
    strict: bool = False,
    catalogue_cap: int = CATALOGUE_CAP,
) -> PlanReport:
    """The cheapest plan of at most `k` actions that cuts every chain in C (§7.7).

    C defaults to every bounded chain the triage found; the Path Hunter passes larger sets as it
    adds residual paths. `strict` is the tool's `require_known_impact`. Planning fails closed: an
    incomplete triage or a truncated chain enumeration is reported, never planned over.
    """
    if not 1 <= k <= MAX_PLAN_ACTIONS:
        raise ValueError(f"k must be between 1 and {MAX_PLAN_ACTIONS}")
    constraint = sorted(
        {c.id: c for c in (triage.chains if chains is None else chains)}.values(),
        key=lambda c: c.id,
    )
    report = PlanReport(
        status=PlanStatus.PLANNING_INCONCLUSIVE,
        graph=triage.graph,
        revision=triage.revision,
        k=k,
        strict=strict,
        chains=[c.id for c in constraint],
    )
    if not triage.complete:
        report.inconclusive_reason = PlanningInconclusiveReason.SCOPE_INCOMPLETE
        return report
    if triage.chain_enumeration_truncated:
        report.inconclusive_reason = PlanningInconclusiveReason.CHAIN_ENUMERATION_TRUNCATED
        return report

    catalogue = build_catalogue(triage.snapshot, constraint)
    report.catalogue = list(catalogue.actions)
    report.ineligible = list(catalogue.ineligible)
    report.flows = _flow_refs(triage.snapshot, catalogue.actions)
    if len(catalogue.actions) > catalogue_cap:
        report.inconclusive_reason = PlanningInconclusiveReason.CATALOGUE_TOO_LARGE
        return report
    report.solution = solve(catalogue.actions, constraint, k=k, strict=strict)
    report.status = report.solution.status
    return report


def constraint_set(
    triage: StormReport,
    *,
    cluster_id: str | None = None,
    targets: Iterable[str] | None = None,
) -> tuple[tuple[str, ...], list[Chain]]:
    """T_scope and the starting constraint set C0: one cluster's target and chains, or every
    bounded chain to a set of crown jewels. Raises KeyError for an unknown cluster and ValueError
    for anything else that does not name crown jewels."""
    if (cluster_id is None) == (targets is None):
        raise ValueError("give exactly one of cluster_id or targets")
    if cluster_id is not None:
        cluster = next((c for c in triage.clusters if c.id == cluster_id), None)
        if cluster is None:
            raise KeyError(cluster_id)
        ids = set(cluster.chain_ids)
        return (cluster.target,), [c for c in triage.chains if c.id in ids]
    scope = tuple(sorted(set(targets or ())))
    if not scope or not set(scope) <= triage.snapshot.crown_jewels:
        raise ValueError("targets must be a non-empty set of crown jewels")
    return scope, [c for c in triage.chains if c.target in scope]


def _flow_refs(snapshot: EvidenceSnapshot, actions: Iterable[Action]) -> dict[str, FlowRef]:
    known = {
        e.edge_id: FlowRef(e.edge_id, e.src, e.dst, e.port, e.protocol) for e in snapshot.reach
    }
    for (pod, (dst, port, protocol)), dep_id in snapshot.declared_ids.items():
        known[dep_id] = FlowRef(dep_id, pod, dst, port, protocol)
    named = set().union(*(a.blocked | a.known_broken for a in actions))
    return {flow_id: known[flow_id] for flow_id in sorted(named)}
