"""Path Hunter and model-verified containment certificates (issue #11, solution.md §8-§9)."""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import replace
from datetime import timedelta

import pytest

from engine_helpers import NOW, STAMP, write
from interdict.db import QueryFailedError
from interdict.engine import hunter as hunter_module
from interdict.engine.attackgraph import (
    Chain,
    FlowResult,
    build_attack_steps,
    chain_id,
    export_steps,
    max_flow,
)
from interdict.engine.certificate import CLAIM, certificate_status
from interdict.engine.evidence import INTERNET_ID, collect_evidence
from interdict.engine.hunter import (
    MAX_ROUNDS,
    apply_plan,
    decompose,
    hunt,
    path_chain,
)
from interdict.engine.planner import Plan, plan_remediation
from interdict.engine.sandbox import iso, mutate, read_revision
from interdict.engine.snapshot import snapshot_hash
from interdict.engine.statuses import (
    CertificateStatus,
    InconclusiveReason,
    PlanStatus,
    SimulationStatus,
)
from interdict.engine.triage import StormReport, run_triage
from interdict.graphstore import GraphStore

PAYMENTS, PII = "prod-payments-db", "customer-pii-db"
C1 = chain_id(("auth-1",), PAYMENTS)
C2 = chain_id(("analytics-1",), PAYMENTS)
C3 = chain_id(("frontend-1", "checkout-1"), PAYMENTS)
DEEP_PODS = ("bq-frontend-1", "bq-checkout-1", "bq-email-1", "bq-newsletter-1", "bq-crm-sync-1")
DEEP = chain_id(DEEP_PODS, PII)
AUTH_CLUSTER = "cluster-prod-payments-db-ing-auth"
BEST_C1 = (
    "act:shop:analytics:EGRESS_DECLARED",
    "act:shop:auth:EGRESS_DECLARED",
    "act:shop:checkout:EGRESS_STRICT",
)


@pytest.fixture(autouse=True)
def no_leaks(store: GraphStore) -> Iterator[None]:
    """Every hunt must clean up its candidate graphs; certificates are removed after each test."""
    before = set(store.names())
    yield
    created = set(store.names()) - before
    for name in created:
        if name.startswith(("cand:", "cert:")):
            store.delete(name)
    assert not [n for n in created if n.startswith("cand:")], "a candidate graph was left behind"


@pytest.fixture
def triage(store: GraphStore, sandbox: str) -> StormReport:
    return run_triage(store, sandbox, NOW)


def cluster_chains(report: StormReport, cluster_id: str) -> list[Chain]:
    ids = set(next(c for c in report.clusters if c.id == cluster_id).chain_ids)
    return [c for c in report.chains if c.id in ids]


def certs(store: GraphStore) -> list[str]:
    return [n for n in store.names() if n.startswith("cert:")]


# --- the worked example (solution.md §4.3, steps 11-15) ---------------------------------------


def test_worked_example_round_by_round(
    store: GraphStore, sandbox: str, triage: StormReport
) -> None:
    report = hunt(store, triage, {PAYMENTS}, cluster_chains(triage, AUTH_CLUSTER))
    assert report.status == SimulationStatus.SIMULATED_CONTAINMENT, report.detail
    first, second = report.rounds

    assert first.action_ids == ("act:shop:auth:EGRESS_DECLARED",)
    assert first.pruned == ("ev-reach-auth-1-prod-payments-db-5432-tcp",)
    assert set(first.e_chains) == {C2, C3}
    assert first.f_values[PAYMENTS] == 2, "c2 and c3 are edge-disjoint"
    assert PAYMENTS in first.o_reachable
    assert set(first.residuals) == {C2, C3}, "every residual path joins the constraint set (D-02)"

    assert second.action_ids == BEST_C1
    assert second.e_chains == () and second.f_values[PAYMENTS] == 0
    assert PAYMENTS not in second.o_reachable
    assert {c.id for c in report.chains} == {C1, C2, C3}
    assert report.out_of_scope_residuals == [DEEP], "the deep PII path is reported, not hidden"


def test_the_certificate_records_what_was_verified(
    store: GraphStore, sandbox: str, triage: StormReport
) -> None:
    report = hunt(store, triage, {PAYMENTS}, cluster_chains(triage, AUTH_CLUSTER))
    certificate = report.certificate
    document = certificate.to_dict()
    json.dumps(document)  # plain JSON all the way down

    assert document["claim"] == CLAIM and document["status"] == "VALID"
    assert document["evaluation_time"] == iso(NOW)
    assert document["expires_at"] == iso(STAMP + timedelta(hours=12)), "expires with its evidence"
    snapshot = document["snapshot"]
    assert snapshot["sandbox_graph_key"] == sandbox and snapshot["sandbox_revision"] == 1
    assert snapshot["candidate_graph_key"] == f"cert:{certificate.certificate_id}"
    assert snapshot["baseline_snapshot_hash"] != snapshot["candidate_snapshot_hash"]
    assert document["threat_model"]["t_scope"] == [PAYMENTS]

    plan = document["plan"]
    assert plan["plan_id"] == report.rounds[-1].plan_id
    assert [a["candidate_action_id"] for a in plan["actions"]] == list(BEST_C1)
    assert plan["optimality"] == "EXACT_WITHIN_K"
    assert plan["impact_status"] == "IMPACT_PARTIALLY_UNKNOWN"
    assert plan["known_broken"] == ["dep-checkout-1-prod-payments-db-5432-tcp"]

    verification = document["verification"]
    assert verification["enumerator_E"]["chains_found"] == 0
    assert verification["maxflow_F"]["value_t_scope"] == 0
    assert verification["maxflow_F"]["per_target"] == {PII: 1, PAYMENTS: 0}
    assert verification["oracle_O"]["reachable_targets"] == []
    assert verification["agreement"] is True
    assert verification["rounds"] == [
        {"round": 0, "plan_id": report.rounds[0].plan_id, "residual_chain_ids": sorted([C2, C3])},
        {"round": 1, "plan_id": report.rounds[1].plan_id, "residual_chain_ids": []},
    ]
    assert verification["out_of_scope_residuals"] == [DEEP]
    assert document["provenance"]["falkordb_version"] == "4.22.1"
    assert "not evidence of real-world containment" in document["exclusions"]
    assert "RSK-16" in document["exclusions"]


def test_tc22_the_certified_graph_has_no_path_to_the_target(
    store: GraphStore, triage: StormReport
) -> None:
    report = hunt(store, triage, {PAYMENTS}, cluster_chains(triage, AUTH_CLUSTER))
    key = report.certificate.candidate_graph_key
    assert key in certs(store)
    assert 0 < store.db.connection.pttl(key) <= 24 * 60 * 60 * 1000, "kept for 24 hours"
    assert max_flow(store, key, [PAYMENTS]).value == 0
    assert max_flow(store, key, [PII]).value == 1, "outside T_scope and reported as such"
    assert snapshot_hash(store, key).hash == report.certificate.candidate_snapshot_hash


def test_tc28_a_path_beyond_the_bound_is_found_replanned_and_certified(
    store: GraphStore, triage: StormReport
) -> None:
    deep = next(c for c in triage.clusters if c.beyond_bound)
    report = hunt(store, triage, {PII}, cluster_chains(triage, deep.id))
    assert report.status == SimulationStatus.SIMULATED_CONTAINMENT, report.detail
    first, second = report.rounds
    assert first.action_ids == () and first.e_chains == (), "4 lateral hops: invisible to E"
    assert first.f_values[PII] == 1 and PII in first.o_reachable, "F and O find it"
    assert first.residuals == (DEEP,)
    assert first.witnesses[PII] == (INTERNET_ID, *DEEP_PODS, PII)
    assert second.action_ids == ("act:boutique:crm-sync:EGRESS_DECLARED",)
    assert second.f_values[PII] == 0
    assert all(c.endswith(PAYMENTS) for c in report.out_of_scope_residuals)


def test_no_plan_closes_every_path_to_both_crown_jewels(
    store: GraphStore, triage: StormReport
) -> None:
    report = hunt(store, triage, {PAYMENTS, PII}, triage.chains)
    assert report.status == PlanStatus.NO_FEASIBLE_PLAN_WITHIN_K
    assert report.reason == "K_EXCEEDED" and report.certificate is None
    assert report.rounds[0].residuals == (DEEP,)
    assert {c.id for c in report.chains} == {C1, C2, C3, DEEP}
    assert len(report.plan.solution.uncovered) == 1, "best partial plan closes 3 of 4"
    assert not certs(store)


def test_the_round_limit_ends_with_residual_exposure(
    store: GraphStore, triage: StormReport
) -> None:
    report = hunt(store, triage, {PAYMENTS}, cluster_chains(triage, AUTH_CLUSTER), max_rounds=1)
    assert report.status == SimulationStatus.SIMULATED_RESIDUAL_EXPOSURE
    assert report.certificate is None
    assert report.residual_paths == [
        (INTERNET_ID, "analytics-1", PAYMENTS),
        (INTERNET_ID, "frontend-1", "checkout-1", PAYMENTS),
    ]


# --- defects and failures never yield a certificate -------------------------------------------


def _drop_last_action(real):
    def broken(*args, **kwargs):
        planned = real(*args, **kwargs)
        solution = planned.solution
        if solution and solution.plan and solution.plan.actions:
            kept = Plan(solution.plan.actions[:-1], solution.plan.covered)
            planned.solution = replace(solution, plan=kept)
        return planned

    return broken


def test_tc29_a_planner_that_drops_an_action_is_caught(
    store: GraphStore, triage: StormReport, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        hunter_module, "plan_remediation", _drop_last_action(hunter_module.plan_remediation)
    )
    report = hunt(store, triage, {PAYMENTS}, triage.chains)
    assert report.status == SimulationStatus.SIMULATION_INCONCLUSIVE
    assert report.reason == InconclusiveReason.METHOD_DISAGREEMENT
    assert C3 in report.detail and C3 in report.rounds[0].residuals
    assert report.certificate is None and not certs(store)


def test_the_graph_checks_the_planners_blocked_flows(
    store: GraphStore, triage: StormReport, monkeypatch: pytest.MonkeyPatch
) -> None:
    real = hunter_module.plan_remediation

    def overclaims(*args, **kwargs):
        planned = real(*args, **kwargs)
        plan = planned.solution.plan
        first = replace(plan.actions[0], blocked=plan.actions[0].blocked | {"ev-reach-phantom"})
        planned.solution = replace(
            planned.solution, plan=Plan((first, *plan.actions[1:]), plan.covered)
        )
        return planned

    monkeypatch.setattr(hunter_module, "plan_remediation", overclaims)
    report = hunt(store, triage, {PAYMENTS}, triage.chains)
    assert report.reason == InconclusiveReason.METHOD_DISAGREEMENT
    assert "FalkorDB pruned 4 flows" in report.detail and "predicted 5" in report.detail
    assert report.certificate is None


@pytest.mark.parametrize("method", ["E", "F", "O"])
def test_tc33_a_fault_in_any_one_method_is_a_disagreement(
    store: GraphStore, triage: StormReport, monkeypatch: pytest.MonkeyPatch, method: str
) -> None:
    if method == "E":
        real_e = hunter_module.enumerate_chains

        def phantom(*args, **kwargs):
            found = real_e(*args, **kwargs)
            ghost = Chain(chain_id(("billing-1",), PAYMENTS), ("billing-1",), PAYMENTS)
            return replace(found, chains=(*found.chains, ghost))

        monkeypatch.setattr(hunter_module, "enumerate_chains", phantom)
    elif method == "F":
        real_f = hunter_module.max_flow

        def inflated(store_, name, targets, **kwargs):
            result = real_f(store_, name, targets, **kwargs)
            return FlowResult(result.targets, result.value + 1, result.flows)

        monkeypatch.setattr(hunter_module, "max_flow", inflated)
    else:
        monkeypatch.setattr(hunter_module, "reachable_targets", lambda *a, **k: set())

    report = hunt(store, triage, {PAYMENTS}, triage.chains)
    assert report.status == SimulationStatus.SIMULATION_INCONCLUSIVE
    assert report.reason == InconclusiveReason.METHOD_DISAGREEMENT
    assert report.certificate is None and not certs(store)


def test_tc30_a_failed_query_withholds_the_certificate(
    store: GraphStore, triage: StormReport, monkeypatch: pytest.MonkeyPatch
) -> None:
    def timeout(*args, **kwargs):
        raise QueryFailedError("attack-maxflow", "Query timed out")

    monkeypatch.setattr(hunter_module, "max_flow", timeout)
    report = hunt(store, triage, {PAYMENTS}, triage.chains)
    assert report.status == SimulationStatus.SIMULATION_INCONCLUSIVE
    assert report.reason == InconclusiveReason.QUERY_FAILED and "timed out" in report.detail
    assert report.certificate is None


def test_tc30_stale_evidence_in_the_candidate_withholds_the_certificate(
    store: GraphStore, triage: StormReport, monkeypatch: pytest.MonkeyPatch
) -> None:
    def apply_and_expire(store_, candidate, plan):
        pruned = apply_plan(store_, candidate, plan)
        write(
            store_,
            candidate,
            "MATCH ()-[e:EXPOSES {id: 'ev-exposes-ing-auth'}]->() "
            "SET e.valid_until = '2026-10-17T08:00:00Z'",
        )
        return pruned

    monkeypatch.setattr(hunter_module, "apply_plan", apply_and_expire)
    report = hunt(store, triage, {PAYMENTS}, triage.chains)
    assert report.reason == InconclusiveReason.STALE_EVIDENCE
    assert report.certificate is None


def test_tc30_an_incomplete_sandbox_is_never_planned_or_hunted(
    store: GraphStore, sandbox: str
) -> None:
    write(
        store,
        sandbox,
        "MATCH ()-[e:CAN_REACH {id: 'ev-reach-batch-1-kube-dns-53-udp'}]->() "
        "SET e.valid_until = '2026-10-17T08:00:00Z'",
    )
    stale = run_triage(store, sandbox, NOW)
    report = hunt(store, stale, {PAYMENTS}, [])
    assert report.status == PlanStatus.PLANNING_INCONCLUSIVE
    assert report.reason == "SCOPE_INCOMPLETE" and report.rounds == []


def test_tc43_a_sandbox_change_during_the_hunt_blocks_issuance(
    store: GraphStore, sandbox: str, triage: StormReport, monkeypatch: pytest.MonkeyPatch
) -> None:
    real_o = hunter_module.reachable_targets

    def oracle_then_change(*args, **kwargs):
        mutate(store, sandbox, read_revision(store, sandbox), "test-bump", "WITH m")
        return real_o(*args, **kwargs)

    monkeypatch.setattr(hunter_module, "reachable_targets", oracle_then_change)
    report = hunt(store, triage, {PAYMENTS}, triage.chains)
    assert report.status == SimulationStatus.SIMULATION_INCONCLUSIVE
    assert report.reason == InconclusiveReason.REVISION_CHANGED
    assert report.certificate is None and not certs(store)


def test_an_audit_failure_withdraws_the_certificate(store: GraphStore, triage: StormReport) -> None:
    def failing(_document):
        raise RuntimeError("audit store unavailable")

    report = hunt(store, triage, {PAYMENTS}, triage.chains, audit=failing)
    assert report.status == SimulationStatus.SIMULATION_INCONCLUSIVE
    assert "audit append failed" in report.detail
    assert report.certificate is None and not certs(store)


def test_an_audited_certificate_carries_the_event_hash(
    store: GraphStore, triage: StormReport
) -> None:
    seen = []

    def audit(document):
        seen.append(document)
        return "sha256:" + "ab" * 32

    report = hunt(store, triage, {PAYMENTS}, triage.chains, audit=audit)
    certificate = report.certificate
    assert seen and seen[0]["certificate_id"] == certificate.certificate_id
    assert certificate.provenance["audit_event_hash"] == "sha256:" + "ab" * 32
    assert (
        certificate.digest()
        == replace(
            certificate, provenance={**certificate.provenance, "audit_event_hash": None}
        ).digest()
    ), "the digest covers the certificate, not the event that records it"


# --- isolation, lifecycle, determinism ---------------------------------------------------------


def test_tc34_hunting_never_touches_the_sandbox(
    store: GraphStore, sandbox: str, triage: StormReport
) -> None:
    before = snapshot_hash(store, sandbox)
    report = hunt(store, triage, {PAYMENTS}, cluster_chains(triage, AUTH_CLUSTER))
    assert snapshot_hash(store, sandbox) == before
    assert report.certificate.baseline_snapshot_hash == before.hash
    assert read_revision(store, sandbox) == 1


def test_tc32_certificates_are_superseded_by_change_and_expire_with_evidence(
    store: GraphStore, sandbox: str, triage: StormReport
) -> None:
    certificate = hunt(store, triage, {PAYMENTS}, triage.chains).certificate
    assert certificate_status(certificate, NOW, 1) == CertificateStatus.VALID
    assert certificate_status(certificate, certificate.expires_at, 1) == CertificateStatus.EXPIRED
    revision = mutate(store, sandbox, 1, "test-bump", "WITH m")
    assert certificate_status(certificate, NOW, revision) == CertificateStatus.SUPERSEDED


def test_hunts_are_deterministic(store: GraphStore, triage: StormReport) -> None:
    first = hunt(store, triage, {PAYMENTS}, cluster_chains(triage, AUTH_CLUSTER))
    second = hunt(store, triage, {PAYMENTS}, cluster_chains(triage, AUTH_CLUSTER))
    assert [(r.plan_id, r.residuals, r.f_values) for r in first.rounds] == [
        (r.plan_id, r.residuals, r.f_values) for r in second.rounds
    ]
    a, b = first.certificate, second.certificate
    assert a.certificate_id != b.certificate_id
    assert a.baseline_snapshot_hash == b.baseline_snapshot_hash
    assert a.candidate_snapshot_hash == b.candidate_snapshot_hash


def test_tc06_tc27_every_candidate_policy_only_removes_attack_steps(
    store: GraphStore, sandbox: str, triage: StormReport
) -> None:
    """Applied in a candidate graph, each catalogue action prunes exactly the flows the planner
    predicted (DENY_ALL: every egress flow, DNS included) and never adds an ATTACK_STEP edge."""
    before = {(s.src, s.dst) for s in export_steps(store, sandbox)}
    for action in plan_remediation(triage).catalogue:
        candidate = f"cand:test:{action.app}:{action.variant.lower()}"
        store.copy(sandbox, candidate)
        try:
            pruned = apply_plan(store, candidate, Plan((action,), frozenset()))
            assert set(pruned) == action.blocked, action.id
            snap = collect_evidence(store, candidate, NOW)
            assert snap.scope.complete, snap.scope.issues
            if action.variant == "EGRESS_DENY_ALL":
                assert not [e for e in snap.reach if e.src in action.pods], action.id
            build_attack_steps(store, candidate, snap)
            after = {(s.src, s.dst) for s in export_steps(store, candidate)}
            assert after <= before, f"{action.id} created an attack step"
        finally:
            store.delete(candidate)


# --- pure helpers -----------------------------------------------------------------------------


def test_flow_decomposition_yields_unit_paths_without_cycles() -> None:
    disjoint = [("i", "a", 1), ("a", "t", 1), ("i", "b", 1), ("b", "c", 1), ("c", "t", 1)]
    assert decompose(disjoint, "i", {"t"}) == [("i", "a", "t"), ("i", "b", "c", "t")]
    # a unit that circles a -> b -> a before reaching t is reported without the cycle
    looped = [("i", "a", 1), ("a", "b", 1), ("b", "a", 1), ("a", "t", 1)]
    assert decompose(looped, "i", {"t"}) == [("i", "a", "t")]
    with pytest.raises(ValueError, match="not conserved"):
        decompose([("i", "a", 1)], "i", {"t"})


def test_a_path_maps_to_the_chain_it_walks() -> None:
    chain = path_chain((INTERNET_ID, "a-1", "b-1", "db"))
    assert chain == Chain(chain_id(("a-1", "b-1"), "db"), ("a-1", "b-1"), "db")
    with pytest.raises(ValueError):
        path_chain((INTERNET_ID, "db"))


def test_hunt_validates_its_inputs(store: GraphStore, triage: StormReport) -> None:
    with pytest.raises(ValueError, match="crown jewels"):
        hunt(store, triage, set(), [])
    with pytest.raises(ValueError, match="crown jewels"):
        hunt(store, triage, {"analytics-warehouse"}, [])
    with pytest.raises(ValueError, match="max_rounds"):
        hunt(store, triage, {PAYMENTS}, [], max_rounds=MAX_ROUNDS + 1)
