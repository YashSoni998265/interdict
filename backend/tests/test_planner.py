"""Remediation planner (issue #10, solution.md §7): allowlist semantics, impact, exact search."""

from __future__ import annotations

import random
import time
from collections import defaultdict
from collections.abc import Iterable

import pytest

from engine_helpers import NOW, write
from interdict.engine.attackgraph import Chain, authorized_pairs, chain_id, net_vuln_pods
from interdict.engine.evidence import (
    EvidenceSnapshot,
    PodInfo,
    PolicyInfo,
    Provenance,
    ReachEdge,
    ScopeReport,
)
from interdict.engine.planner import (
    DNS_FLOWS,
    INELIGIBLE_EXISTING_EGRESS_POLICY,
    Action,
    FlowRef,
    Variant,
    build_catalogue,
    plan_remediation,
    solve,
)
from interdict.engine.statuses import (
    ImpactStatus,
    NoPlanReason,
    PlanningInconclusiveReason,
    PlanOptimality,
    PlanStatus,
)
from interdict.engine.triage import run_triage
from interdict.graphstore import GraphStore

C1 = chain_id(("auth-1",), "prod-payments-db")
C2 = chain_id(("analytics-1",), "prod-payments-db")
C3 = chain_id(("frontend-1", "checkout-1"), "prod-payments-db")
CHECKOUT_DEP = "dep-checkout-1-prod-payments-db-5432-tcp"
ANALYTICS_UNKNOWN = {
    "ev-reach-analytics-1-prod-payments-db-5432-tcp",
    "ev-reach-analytics-1-metrics-1-9090-tcp",
}
BEST_C1 = (
    "act:shop:analytics:EGRESS_DECLARED",
    "act:shop:auth:EGRESS_DECLARED",
    "act:shop:checkout:EGRESS_STRICT",
)


# --- abstract instances (no FalkorDB needed) --------------------------------------------------


def chain(n: int) -> Chain:
    """Chain n has a single cuttable step, (s{n}, goal)."""
    return Chain(f"chain-{n}", (f"s{n}",), "goal")


def act(
    name: str,
    cuts: Iterable[int],
    *,
    selector: str | None = None,
    kb: int = 0,
    unk: int = 0,
    blocked: int = 1,
) -> Action:
    """An abstract action that removes the step of every chain in `cuts`."""
    sel = selector or name
    return Action(
        id=f"act:t:{name}",
        namespace="t",
        app=sel,
        variant=Variant.EGRESS_DECLARED,
        pods=(f"{sel}-1",),
        allow=frozenset(),
        blocked=frozenset(f"{name}:b{i}" for i in range(blocked)),
        removed=frozenset((f"s{c}", "goal") for c in cuts),
        known_broken=frozenset(f"{name}:kb{i}" for i in range(kb)),
        unknown=frozenset(f"{name}:u{i}" for i in range(unk)),
    )


def test_tc23_greedy_trap_the_widest_action_is_not_part_of_the_optimum() -> None:
    x = act("x", [1, 2, 3], kb=1)
    y = act("y", [1, 2])
    z = act("z", [3, 4])
    widest = max([x, y, z], key=lambda a: len(a.removed))
    assert widest is x, "a greedy planner would start with x and must then break a dependency"
    solution = solve([x, y, z], [chain(n) for n in (1, 2, 3, 4)])
    assert solution.status == PlanStatus.PLAN_FOUND
    assert solution.plan.action_ids == ("act:t:y", "act:t:z")
    assert solution.plan.impact_status == ImpactStatus.KNOWN_ZERO_DISRUPTION
    assert solution.optimality == PlanOptimality.EXACT_WITHIN_K


def test_tc23_a_known_break_costs_more_than_unknown_impact() -> None:
    """Criterion 1 (declared dependencies broken) comes before criterion 2 (unknown impact)."""
    known = act("known", [1], kb=1)
    unknown = act("unknown", [1], unk=3, blocked=3)
    solution = solve([known, unknown], [chain(1)])
    assert solution.plan.action_ids == ("act:t:unknown",)
    assert solution.plan.impact_status == ImpactStatus.IMPACT_PARTIALLY_UNKNOWN


def test_tc23_fewer_actions_win_before_fewer_blocked_flows() -> None:
    wide = act("wide", [1, 2], blocked=5)
    left, right = act("left", [1]), act("right", [2])
    solution = solve([wide, left, right], [chain(1), chain(2)])
    assert solution.plan.action_ids == ("act:t:wide",)
    assert [p.action_ids for p in solution.alternatives] == [("act:t:left", "act:t:right")]


def test_tc23_one_action_per_selector() -> None:
    """Two variants of one selector are alternatives, never combined into one plan."""
    a = act("a-declared", [1], selector="a")
    b = act("a-strict", [2], selector="a")
    c = act("c", [2], kb=1)
    solution = solve([a, b, c], [chain(1), chain(2)])
    assert solution.plan.action_ids == ("act:t:a-declared", "act:t:c")


def test_tc24_an_instance_needing_four_actions_exceeds_k() -> None:
    actions = [act(f"a{n}", [n], kb=n) for n in (1, 2, 3, 4)]
    solution = solve(actions, [chain(n) for n in (1, 2, 3, 4)])
    assert solution.status == PlanStatus.NO_FEASIBLE_PLAN_WITHIN_K
    assert solution.no_plan_reason == NoPlanReason.K_EXCEEDED
    assert solution.plan is None and solution.optimality is None
    assert solution.best_partial.action_ids == ("act:t:a1", "act:t:a2", "act:t:a3")
    assert solution.uncovered == ("chain-4",)


def test_a_chain_no_action_can_cut_has_no_eligible_action() -> None:
    solution = solve([act("a", [1])], [chain(1), chain(2)])
    assert solution.no_plan_reason == NoPlanReason.NO_ELIGIBLE_ACTION
    assert solution.best_partial.covered == {"chain-1"} and solution.uncovered == ("chain-2",)


def test_strict_mode_reports_unknown_impact_and_keeps_the_partial_plan_admissible() -> None:
    risky = act("risky", [1, 2], unk=1)
    safe = act("safe", [1])
    solution = solve([risky, safe], [chain(1), chain(2)], strict=True)
    assert solution.no_plan_reason == NoPlanReason.UNKNOWN_IMPACT_EXCLUDED
    assert solution.best_partial.action_ids == ("act:t:safe",)
    assert solve([risky, safe], [chain(1), chain(2)]).plan.action_ids == ("act:t:risky",)


def test_an_empty_constraint_set_needs_no_action() -> None:
    solution = solve([act("a", [1])], [])
    assert solution.status == PlanStatus.PLAN_FOUND
    assert solution.plan.actions == () and solution.plan.id == "plan-empty"


def _random_instance(rng: random.Random) -> tuple[list[Action], list[Chain]]:
    pods = [f"p{i}" for i in range(6)]
    chains = []
    for n in range(rng.randint(1, 5)):
        path = tuple(rng.sample(pods, rng.randint(1, 3)))
        chains.append(Chain(f"chain-{n}", path, "goal"))
    steps = sorted({pair for c in chains for pair in c.steps()} | {("p0", "elsewhere")})
    actions = []
    for s in range(rng.randint(1, 4)):
        for v in range(rng.randint(1, 3)):
            actions.append(
                Action(
                    id=f"act:r:s{s}:v{v}",
                    namespace="r",
                    app=f"s{s}",
                    variant=Variant.EGRESS_DECLARED,
                    pods=(f"s{s}-1",),
                    allow=frozenset(),
                    blocked=frozenset(f"b{rng.randrange(8)}" for _ in range(rng.randint(0, 3))),
                    removed=frozenset(rng.sample(steps, rng.randint(0, min(3, len(steps))))),
                    known_broken=frozenset(
                        f"kb{rng.randrange(4)}" for _ in range(rng.randint(0, 2))
                    ),
                    unknown=frozenset(f"u{rng.randrange(4)}" for _ in range(rng.randint(0, 1))),
                )
            )
    return actions, chains


def _brute_force(actions: list[Action], chains: list[Chain], k: int, strict: bool):
    """Independent reference: every subset by bitmask, the objective written out from §7.6.

    Returns the feasible costs best first, each with whether the plan is minimal (no action
    can be dropped), the best partial key and the expected no-plan reason.
    """
    feasible, partial, covering = [], None, False
    every = {c.id for c in chains}

    def cuts(chosen: list[Action]) -> set[str]:
        removed = set().union(*(a.removed for a in chosen))
        return {c.id for c in chains if set(c.steps()) & removed}

    for mask in range(1 << len(actions)):
        chosen = [a for i, a in enumerate(actions) if mask >> i & 1]
        if len(chosen) > k or len({a.selector for a in chosen}) != len(chosen):
            continue
        cut = cuts(chosen)
        unknown = set().union(*(a.unknown for a in chosen))
        covering = covering or cut == every
        if strict and unknown:
            continue
        cost = (
            len(set().union(*(a.known_broken for a in chosen))),
            len(unknown),
            len(chosen),
            len(set().union(*(a.blocked for a in chosen))),
            tuple(sorted(a.id for a in chosen)),
        )
        if cut == every:
            minimal = all(cuts([b for b in chosen if b is not a]) != every for a in chosen)
            feasible.append((cost, minimal))
        if partial is None or (-len(cut), cost) < partial:
            partial = (-len(cut), cost)
    removable = set().union(*(a.removed for a in actions))
    if feasible:
        reason = None
    elif any(not set(c.steps()) & removable for c in chains):
        reason = NoPlanReason.NO_ELIGIBLE_ACTION
    elif strict and covering:
        reason = NoPlanReason.UNKNOWN_IMPACT_EXCLUDED
    else:
        reason = NoPlanReason.K_EXCEEDED
    return sorted(feasible), partial, reason


@pytest.mark.parametrize("seed", range(300))
def test_tc23_exact_search_matches_an_independent_brute_force(seed: int) -> None:
    rng = random.Random(seed)
    actions, chains = _random_instance(rng)
    k, strict = rng.randint(1, 3), rng.random() < 0.4
    feasible, partial, reason = _brute_force(actions, chains, k, strict)
    solution = solve(actions, chains, k=k, strict=strict)
    assert solution.feasible == len(feasible)
    assert solution.no_plan_reason == reason
    if feasible:
        assert solution.plan.objective == feasible[0][0]
        assert feasible[0][1], "the optimum is always minimal"
        minimal = [cost for cost, is_minimal in feasible[1:] if is_minimal]
        assert [p.objective for p in solution.alternatives] == minimal[:3]
    else:
        best = solution.best_partial
        assert (-len(best.covered), best.objective) == partial


def test_exact_search_at_the_catalogue_and_chain_caps() -> None:
    """30 actions and 10,000 chains: all 4,526 subsets are examined, well within budget."""
    actions = [
        Action(
            id=f"act:t:s{j:02d}",
            namespace="t",
            app=f"s{j:02d}",
            variant=Variant.EGRESS_DECLARED,
            pods=(f"p{j}",),
            allow=frozenset(),
            blocked=frozenset({f"b{j}"}),
            removed=frozenset((f"p{j}", f"q{i}") for i in range(j, 10_000, 30)),
            known_broken=frozenset(),
            unknown=frozenset(),
        )
        for j in range(30)
    ]
    chains = [Chain(f"c{i}", (f"p{i % 30}", f"q{i}"), "goal") for i in range(10_000)]
    started = time.perf_counter()
    solution = solve(actions, chains)
    elapsed = time.perf_counter() - started
    print(f"\nexact search at the caps: {elapsed * 1000:.0f} ms")
    assert solution.evaluated == 4526
    assert solution.no_plan_reason == NoPlanReason.K_EXCEEDED
    assert len(solution.best_partial.covered) == 3 * 334
    assert elapsed < 2.0


# --- hand-built snapshots ---------------------------------------------------------------------

PROV = Provenance("p", True, "2026-10-17T09:00:00Z", "2026-10-17T21:00:00Z", "SYNTHETIC_GENERATOR")


def hand_snapshot(
    pods: dict[str, tuple[str, str, str]],
    reach: list[tuple[str, str, int, str]],
    declared: list[tuple[str, str, int, str]],
    policies: list[PolicyInfo] | None = None,
) -> EvidenceSnapshot:
    sets: dict[str, set] = defaultdict(set)
    ids = {}
    for src, dst, port, proto in declared:
        sets[src].add((dst, port, proto))
        ids[(src, (dst, port, proto))] = f"d-{src}-{dst}-{port}"
    return EvidenceSnapshot(
        graph="hand",
        revision=1,
        evaluated_at=NOW,
        meta={},
        pods={
            p: PodInfo(p, ns, app, manifest, "COLLECTED") for p, (ns, app, manifest) in pods.items()
        },
        crown_jewels=frozenset(),
        databases=frozenset(),
        exposures=[],
        vulnerabilities=[],
        reach=[
            ReachEdge(f"r-{src}-{dst}-{port}", src, dst, "Pod", port, proto, PROV)
            for src, dst, port, proto in reach
        ],
        grants=[],
        policies=policies or [],
        declared={pod: frozenset(flows) for pod, flows in sets.items()},
        declared_ids=ids,
        alerts=[],
        scope=ScopeReport({}, []),
        queries=[],
    )


API_FLOWS = [
    ("api-1", "orders-db", 5432, "TCP"),
    ("api-1", "cache-1", 6379, "TCP"),
    ("api-1", "kube-dns", 53, "UDP"),
]
API_CHAIN = Chain("chain-api-1-orders-db", ("api-1",), "orders-db")


def test_tc07_strict_blocks_the_attack_port_and_keeps_other_dependencies_and_dns() -> None:
    snap = hand_snapshot({"api-1": ("demo", "api", "COMPLETE")}, API_FLOWS, API_FLOWS)
    actions = {a.variant: a for a in build_catalogue(snap, [API_CHAIN]).actions}
    assert set(actions) == set(Variant)

    strict = actions[Variant.EGRESS_STRICT]
    assert ("orders-db", 5432, "TCP") not in strict.allow
    assert ("cache-1", 6379, "TCP") in strict.allow and strict.allow >= DNS_FLOWS
    assert strict.blocked == {"r-api-1-orders-db-5432"}
    assert strict.removed == {("api-1", "orders-db")}
    assert strict.known_broken == {"d-api-1-orders-db-5432"} and not strict.unknown

    declared = actions[Variant.EGRESS_DECLARED]
    assert not declared.blocked, "the attack flow is a declared dependency, so DECLARED keeps it"
    assert solve(list(actions.values()), [API_CHAIN]).plan.action_ids == (
        "act:demo:api:EGRESS_STRICT",
    )


def test_one_allow_list_covers_every_pod_of_the_selector() -> None:
    """A policy selects by label, so a flow declared by one replica stays open for all of them."""
    snap = hand_snapshot(
        {"x-1": ("demo", "x", "COMPLETE"), "x-2": ("demo", "x", "COMPLETE")},
        [("x-1", "orders-db", 5432, "TCP"), ("x-2", "orders-db", 5432, "TCP")],
        [("x-2", "orders-db", 5432, "TCP")],
    )
    actions = {
        a.variant: a for a in build_catalogue(snap, [Chain("c", ("x-1",), "orders-db")]).actions
    }
    assert actions[Variant.EGRESS_DECLARED].pods == ("x-1", "x-2")
    assert not actions[Variant.EGRESS_DECLARED].removed
    assert actions[Variant.EGRESS_STRICT].known_broken == {"d-x-2-orders-db-5432"}


def test_tc25_unknown_impact_depends_on_the_manifest() -> None:
    flows = [("w-1", "orders-db", 5432, "TCP"), ("w-1", "metrics-1", 9090, "TCP")]
    chain_w = Chain("c", ("w-1",), "orders-db")
    for manifest, unknown in (("COMPLETE", 0), ("PARTIAL", 2), ("NONE", 2)):
        snap = hand_snapshot({"w-1": ("demo", "w", manifest)}, flows, [])
        declared = build_catalogue(snap, [chain_w]).actions[0]
        assert declared.variant == Variant.EGRESS_DECLARED
        assert len(declared.blocked) == 2 and not declared.known_broken
        # under a COMPLETE manifest an undeclared flow is a known non-dependency
        assert len(declared.unknown) == unknown, manifest


def test_tc27_a_selector_already_under_an_egress_policy_is_ineligible() -> None:
    policy = PolicyInfo(
        "np-demo-api-egress",
        "BASELINE",
        "demo",
        "app=api",
        frozenset({"api-1"}),
        frozenset((dst, port, proto) for _, dst, port, proto in API_FLOWS),
    )
    snap = hand_snapshot({"api-1": ("demo", "api", "COMPLETE")}, API_FLOWS, API_FLOWS, [policy])
    catalogue = build_catalogue(snap, [API_CHAIN])
    assert catalogue.actions == ()
    (ineligible,) = catalogue.ineligible
    assert (ineligible.namespace, ineligible.app) == ("demo", "api")
    assert ineligible.reason == INELIGIBLE_EXISTING_EGRESS_POLICY
    assert ineligible.policies == ("np-demo-api-egress",)
    assert solve(catalogue.actions, [API_CHAIN]).no_plan_reason == NoPlanReason.NO_ELIGIBLE_ACTION


# --- the worked example on a real sandbox (solution.md §4.3) ----------------------------------


def chains_of(report, *ids: str) -> list[Chain]:
    return [c for c in report.chains if c.id in ids]


def test_the_auth_cluster_gets_the_surgical_allowlist(store: GraphStore, sandbox: str) -> None:
    report = run_triage(store, sandbox, NOW)
    cluster = next(c for c in report.clusters if c.id == "cluster-prod-payments-db-ing-auth")
    planned = plan_remediation(report, chains_of(report, *cluster.chain_ids))
    assert planned.status == PlanStatus.PLAN_FOUND and planned.chains == [C1]
    assert [a.id for a in planned.catalogue] == [
        "act:shop:auth:EGRESS_DECLARED",
        "act:shop:auth:EGRESS_DENY_ALL",
    ], "no STRICT variant: the attack flow is not a declared dependency"

    plan = planned.plan
    assert plan.action_ids == ("act:shop:auth:EGRESS_DECLARED",)
    assert plan.impact_status == ImpactStatus.KNOWN_ZERO_DISRUPTION
    assert plan.blocked == {"ev-reach-auth-1-prod-payments-db-5432-tcp"}
    assert planned.solution.optimality == PlanOptimality.EXACT_WITHIN_K
    spec = plan.actions[0].policy_spec()
    assert spec["action_type"] == "APPLY_NETWORK_POLICY_ISOLATE"
    assert spec["policy_spec"]["pod_selector"] == "app=auth"
    assert {
        (e["destination_id"], e["port"], e["protocol"])
        for e in spec["policy_spec"]["allows_egress"]
    } == {
        ("billing-1", 8080, "TCP"),
        ("kube-dns", 53, "UDP"),
        ("kube-dns", 53, "TCP"),
    }

    hard = planned.solution.hard_isolation
    assert hard.action_ids == ("act:shop:auth:EGRESS_DENY_ALL",)
    assert hard.known_broken == {"dep-auth-1-billing-1-8080-tcp", "dep-auth-1-kube-dns-53-udp"}
    assert planned.revision == report.revision and planned.graph == sandbox


def test_tc26_the_full_cluster_set_has_no_zero_disruption_plan(
    store: GraphStore, sandbox: str
) -> None:
    report = run_triage(store, sandbox, NOW)
    planned = plan_remediation(report)
    assert planned.chains == sorted([C1, C2, C3])
    plan = planned.plan
    assert plan.action_ids == BEST_C1
    assert plan.known_broken == {CHECKOUT_DEP}
    assert plan.unknown == ANALYTICS_UNKNOWN
    assert len(plan.blocked) == 4
    assert plan.impact_status == ImpactStatus.IMPACT_PARTIALLY_UNKNOWN
    assert planned.flows[CHECKOUT_DEP] == FlowRef(
        CHECKOUT_DEP, "checkout-1", "prod-payments-db", 5432, "TCP"
    )

    tie = planned.solution.alternatives[0]
    assert tie.action_ids[-1] == "act:shop:frontend:EGRESS_STRICT"
    assert tie.objective[:4] == plan.objective[:4], "tied on criteria 1-4, broken by sorted ids"

    feasible, _, _ = _brute_force(planned.catalogue, report.chains, 3, False)
    assert len(feasible) == planned.solution.feasible
    assert all(cost[0] > 0 for cost, _ in feasible), (
        "cutting c3 always breaks a declared dependency"
    )

    only_c3 = plan_remediation(report, chains_of(report, C3)).plan
    assert only_c3.impact_status == ImpactStatus.KNOWN_DISRUPTION
    assert only_c3.action_ids == ("act:shop:checkout:EGRESS_STRICT",)
    assert only_c3.known_broken == {CHECKOUT_DEP}


def test_tc25_strict_mode_excludes_the_unknown_impact_plans(
    store: GraphStore, sandbox: str
) -> None:
    report = run_triage(store, sandbox, NOW)
    planned = plan_remediation(report, strict=True)
    assert planned.status == PlanStatus.NO_FEASIBLE_PLAN_WITHIN_K
    solution = planned.solution
    assert solution.no_plan_reason == NoPlanReason.UNKNOWN_IMPACT_EXCLUDED
    assert solution.best_partial.action_ids == (
        "act:shop:auth:EGRESS_DECLARED",
        "act:shop:checkout:EGRESS_STRICT",
    )
    assert solution.uncovered == (C2,)
    assert not solution.best_partial.unknown


def test_tc24_two_actions_cannot_close_three_independent_paths(
    store: GraphStore, sandbox: str
) -> None:
    report = run_triage(store, sandbox, NOW)
    planned = plan_remediation(report, k=2)
    solution = planned.solution
    assert solution.no_plan_reason == NoPlanReason.K_EXCEEDED
    assert solution.best_partial.action_ids == (
        "act:shop:analytics:EGRESS_DECLARED",
        "act:shop:auth:EGRESS_DECLARED",
    )
    assert solution.uncovered == (C3,)


def test_tc22_the_plan_cuts_every_chain_checked_from_raw_evidence(
    store: GraphStore, sandbox: str
) -> None:
    report = run_triage(store, sandbox, NOW)
    plan = plan_remediation(report).plan
    allow = {pod: a.allow for a in plan.actions for pod in a.pods}
    snap = report.snapshot

    def cut(c: Chain) -> bool:
        for src, dst in c.steps():
            flows = [e.flow for e in snap.reach if (e.src, e.dst) == (src, dst)]
            if src in allow and flows and all(f not in allow[src] for f in flows):
                return True
        return False

    assert all(cut(c) for c in report.chains)
    assert plan.covered == {c.id for c in report.chains}


def test_tc06_hard_isolation_blocks_every_egress_flow_including_dns(
    store: GraphStore, sandbox: str
) -> None:
    report = run_triage(store, sandbox, NOW)
    planned = plan_remediation(report)
    for action in planned.catalogue:
        own = {e.edge_id for e in report.snapshot.reach if e.src in action.pods}
        assert action.blocked <= own, f"{action.id} blocks a flow of another workload"
        if action.variant == Variant.EGRESS_DENY_ALL:
            assert action.allow == frozenset() and action.blocked == own
    deny_auth = next(a for a in planned.catalogue if a.id == "act:shop:auth:EGRESS_DENY_ALL")
    assert "ev-reach-auth-1-kube-dns-53-udp" in deny_auth.blocked


def _derived_steps(snap: EvidenceSnapshot, reach: list[ReachEdge]) -> set[tuple[str, str]]:
    """LATERAL and GOAL steps re-derived from the threat model over a set of observed flows."""
    vulnerable, authorized = net_vuln_pods(snap), authorized_pairs(snap)
    steps = set()
    for e in reach:
        if e.src != e.dst and e.dst in snap.pods and e.dst in vulnerable:
            steps.add((e.src, e.dst))
        if e.dst in snap.crown_jewels and (e.src, e.dst) in authorized:
            steps.add((e.src, e.dst))
    return steps


def test_tc27_catalogue_actions_keep_declared_dependencies_and_only_remove_steps(
    store: GraphStore, sandbox: str
) -> None:
    report = run_triage(store, sandbox, NOW)
    snap = report.snapshot
    before = _derived_steps(snap, snap.reach)
    for action in plan_remediation(report).catalogue:
        if action.variant == Variant.EGRESS_DECLARED:
            declared = frozenset().union(*(snap.declared.get(p, ()) for p in action.pods))
            assert declared | DNS_FLOWS <= action.allow
            assert not action.known_broken
        after = _derived_steps(snap, [e for e in snap.reach if e.edge_id not in action.blocked])
        assert after <= before, f"{action.id} would create an attack step"
        assert before - after == {pair for pair in action.removed if pair in before}


def test_tc27_a_baseline_policy_makes_the_selector_ineligible(
    store: GraphStore, sandbox: str
) -> None:
    write(
        store,
        sandbox,
        "MATCH (p:Pod {id: 'auth-1'}) "
        "CREATE (np:NetworkPolicy {id: 'np-test-auth-egress', name: 'np-test-auth-egress', "
        "namespace: 'shop', pod_selector: 'app=auth', policy_types: ['Egress'], "
        "status: 'ACTIVE', managed_by: 'BASELINE'})-[:SELECTS {id: 'sel-test-auth'}]->(p) "
        "WITH np, p MATCH (p)-[c:CAN_REACH]->(d) "
        "CREATE (np)-[:ALLOWS_EGRESS {id: 'allow-test-' + c.id, port: c.port, "
        "protocol: c.protocol}]->(d)",
    )
    report = run_triage(store, sandbox, NOW)
    assert report.complete, report.issues
    assert C1 in {c.id for c in report.chains}, "the policy allows every observed flow"
    planned = plan_remediation(report)
    assert [(i.namespace, i.app, i.policies) for i in planned.ineligible] == [
        ("shop", "auth", ("np-test-auth-egress",))
    ]
    assert not any(a.app == "auth" for a in planned.catalogue)
    assert planned.solution.no_plan_reason == NoPlanReason.NO_ELIGIBLE_ACTION
    assert C1 in planned.solution.uncovered


def test_the_deep_path_is_planned_like_any_other_chain(store: GraphStore, sandbox: str) -> None:
    """The deep cluster starts with no bounded chain; once its witness path is a constraint
    (as the Path Hunter adds it), the cheapest cut is an allowlist on a PARTIAL manifest."""
    report = run_triage(store, sandbox, NOW)
    deep = next(c for c in report.clusters if c.beyond_bound)
    empty = plan_remediation(report, chains_of(report, *deep.chain_ids))
    assert empty.status == PlanStatus.PLAN_FOUND and empty.plan.actions == ()

    pods, target = deep.witness_path[1:-1], deep.witness_path[-1]
    residual = Chain(chain_id(pods, target), pods, target)
    planned = plan_remediation(report, [residual])
    assert planned.plan.action_ids == ("act:boutique:crm-sync:EGRESS_DECLARED",)
    assert planned.plan.impact_status == ImpactStatus.IMPACT_PARTIALLY_UNKNOWN
    assert planned.plan.unknown == {"ev-reach-bq-crm-sync-1-customer-pii-db-5432-tcp"}


def test_planning_fails_closed(store: GraphStore, sandbox: str) -> None:
    report = run_triage(store, sandbox, NOW)
    capped = plan_remediation(report, catalogue_cap=5)
    assert capped.status == PlanStatus.PLANNING_INCONCLUSIVE
    assert capped.inconclusive_reason == PlanningInconclusiveReason.CATALOGUE_TOO_LARGE
    assert capped.plan is None and len(capped.catalogue) == 10

    report.chain_enumeration_truncated = True
    truncated = plan_remediation(report)
    assert truncated.inconclusive_reason == PlanningInconclusiveReason.CHAIN_ENUMERATION_TRUNCATED

    with pytest.raises(ValueError):
        plan_remediation(report, k=4)

    write(
        store,
        sandbox,
        "MATCH ()-[e:CAN_REACH {id: 'ev-reach-batch-1-kube-dns-53-udp'}]->() "
        "SET e.valid_until = '2026-10-17T08:00:00Z'",
    )
    stale = run_triage(store, sandbox, NOW)
    for chains in (None, chains_of(report, C1)):
        planned = plan_remediation(stale, chains)
        assert planned.status == PlanStatus.PLANNING_INCONCLUSIVE
        assert planned.inconclusive_reason == PlanningInconclusiveReason.SCOPE_INCOMPLETE
        assert planned.plan is None and planned.catalogue == []


def test_plans_are_deterministic(store: GraphStore, sandbox: str) -> None:
    first = plan_remediation(run_triage(store, sandbox, NOW))
    second = plan_remediation(run_triage(store, sandbox, NOW))
    assert first.plan.id == second.plan.id and first.plan.id.startswith("plan-")
    assert [p.action_ids for p in first.solution.alternatives] == [
        p.action_ids for p in second.solution.alternatives
    ]
