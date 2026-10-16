"""ATTACK_STEP construction, method E and reachability (issue #8, solution.md §6.2, §8.1-§8.2)."""

from __future__ import annotations

import uuid

import pytest

from engine_helpers import NOW, STAMP, write
from interdict.engine.attackgraph import (
    INTERNET_ID,
    TECHNIQUES,
    RevisionChangedError,
    ScopeIncompleteError,
    build_attack_steps,
    chain_id,
    enumerate_chains,
    export_steps,
    forward_reachable_in_graph,
    reachable,
    shortest_path,
)
from interdict.engine.evidence import collect_evidence
from interdict.engine.sandbox import create_sandbox, mutate
from interdict.graphstore import GraphStore
from interdict.seed import generate
from interdict.seed.loader import load

C1 = chain_id(("auth-1",), "prod-payments-db")
C2 = chain_id(("analytics-1",), "prod-payments-db")
C3 = chain_id(("frontend-1", "checkout-1"), "prod-payments-db")
DEEP = (
    INTERNET_ID,
    "bq-frontend-1",
    "bq-checkout-1",
    "bq-email-1",
    "bq-newsletter-1",
    "bq-crm-sync-1",
    "customer-pii-db",
)


def built(store: GraphStore, name: str):
    snap = collect_evidence(store, name, NOW)
    build_attack_steps(store, name, snap)
    return snap, export_steps(store, name)


def test_steps_follow_the_threat_model_on_the_worked_example(
    store: GraphStore, sandbox: str
) -> None:
    _, steps = built(store, sandbox)
    pairs = {(s.src, s.dst, s.kind) for s in steps}
    assert (INTERNET_ID, "auth-1", "ENTRY") in pairs
    assert ("frontend-1", "checkout-1", "LATERAL") in pairs
    assert ("auth-1", "prod-payments-db", "GOAL") in pairs
    assert ("checkout-1", "prod-payments-db", "GOAL") in pairs
    # TC-21: no LATERAL into a pod without a network-exploitable vulnerability (billing-1 is LOCAL only)
    assert not any(s.dst == "billing-1" for s in steps)
    # no GOAL without an Allow grant (frontend-1 reaches no database and holds no role)
    assert not any(s.src == "frontend-1" and s.kind == "GOAL" for s in steps)
    # TC-02 basis: batch-1 shares the CVE but is neither exposed nor reachable
    assert not any("batch-1" in (s.src, s.dst) for s in steps)


def test_steps_carry_attack_labels_and_backing_evidence(store: GraphStore, sandbox: str) -> None:
    _, steps = built(store, sandbox)
    for step in steps:
        assert step.technique_id == TECHNIQUES[step.kind][0]
        assert step.backing, f"{step} has no backing evidence"
        assert step.revision == 1
    goal = next(s for s in steps if (s.src, s.dst) == ("auth-1", "prod-payments-db"))
    assert "ev-reach-auth-1-prod-payments-db-5432-tcp" in goal.backing
    assert goal.ports == (5432,)


def test_a_missing_attack_vector_counts_as_network(store: GraphStore, sandbox: str) -> None:
    """TC-21: an unknown vector is treated as network-exploitable (attacker-favourable)."""
    write(
        store,
        sandbox,
        "MATCH (v:Vulnerability {cve_id: 'DEMO-CVE-404'}) SET v.attack_vector = NULL",
    )
    _, steps = built(store, sandbox)
    assert any((s.src, s.dst, s.kind) == ("auth-1", "billing-1", "LATERAL") for s in steps)


def test_building_requires_a_complete_scope(store: GraphStore, sandbox: str) -> None:
    write(
        store,
        sandbox,
        "MATCH ()-[e:CAN_REACH]->() WITH e LIMIT 1 SET e.valid_until = '2026-10-17T08:00:00Z'",
    )
    snap = collect_evidence(store, sandbox, NOW)
    with pytest.raises(ScopeIncompleteError):
        build_attack_steps(store, sandbox, snap)


def test_building_refuses_evidence_read_at_an_older_revision(
    store: GraphStore, sandbox: str
) -> None:
    snap = collect_evidence(store, sandbox, NOW)
    mutate(store, sandbox, 1, "test-bump", "WITH m")
    with pytest.raises(RevisionChangedError):
        build_attack_steps(store, sandbox, snap)


def test_rebuilding_replaces_the_previous_steps(store: GraphStore, sandbox: str) -> None:
    _, first = built(store, sandbox)
    _, second = built(store, sandbox)
    assert len(first) == len(second)


def test_method_e_finds_exactly_the_worked_example_chains(store: GraphStore, sandbox: str) -> None:
    snap, _ = built(store, sandbox)
    chains = enumerate_chains(store, sandbox, snap, {"prod-payments-db", "customer-pii-db"})
    assert {c.id for c in chains.chains} == {C1, C2, C3}
    assert not chains.truncated
    assert next(c for c in chains.chains if c.id == C3).steps() == [
        ("frontend-1", "checkout-1"),
        ("checkout-1", "prod-payments-db"),
    ]
    with pytest.raises(ValueError):
        enumerate_chains(store, sandbox, snap, {"prod-payments-db"}, max_lateral_hops=4)


def test_falkordb_bfs_and_python_agree_on_forward_reachability(
    store: GraphStore, sandbox: str
) -> None:
    snap, steps = built(store, sandbox)
    assert forward_reachable_in_graph(store, sandbox, len(snap.pods) + 2) == reachable(
        steps, {INTERNET_ID}
    )


def test_the_deep_boutique_path_is_found_by_unbounded_search(
    store: GraphStore, sandbox: str
) -> None:
    _, steps = built(store, sandbox)
    assert shortest_path(steps, "customer-pii-db") == DEEP


def _bounded_chains_from_steps(steps, crown: set[str], max_lateral: int = 3) -> set[str]:
    """Independent DFS over ATTACK_STEP edges: simple paths with at most `max_lateral` LATERAL edges."""
    lateral: dict[str, list[str]] = {}
    goals: dict[str, list[str]] = {}
    for s in steps:
        if s.kind == "LATERAL":
            lateral.setdefault(s.src, []).append(s.dst)
        elif s.kind == "GOAL" and s.dst in crown:
            goals.setdefault(s.src, []).append(s.dst)
    found: set[str] = set()

    def walk(path: tuple[str, ...]) -> None:
        for target in goals.get(path[-1], ()):
            found.add(chain_id(path, target))
        if len(path) - 1 < max_lateral:
            for nxt in lateral.get(path[-1], ()):
                if nxt not in path:
                    walk((*path, nxt))

    for s in steps:
        if s.kind == "ENTRY":
            walk((s.dst,))
    return found


@pytest.mark.parametrize("seed", range(20))
def test_tc19_method_e_equals_bounded_attack_step_paths(store: GraphStore, seed: int) -> None:
    template = f"test:tpl19:{seed}:{uuid.uuid4().hex[:6]}"
    sandbox = f"test:sbx19:{seed}:{uuid.uuid4().hex[:6]}"
    try:
        load(store, generate(seed=seed, alert_count=20), template)
        create_sandbox(store, sandbox, STAMP, template=template)
        snap, steps = built(store, sandbox)
        crown = set(snap.crown_jewels)
        e_chains = {c.id for c in enumerate_chains(store, sandbox, snap, crown).chains}
        assert e_chains == _bounded_chains_from_steps(steps, crown)
    finally:
        store.delete(sandbox)
        store.delete(template)
