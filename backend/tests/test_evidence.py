"""Evidence collection, scope completeness, sandboxes and revisions (issue #7, solution.md §6, §12)."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import pytest

from engine_helpers import ALERTS, NOW, STAMP, write
from interdict.db import QueryFailedError
from interdict.engine import evidence as evidence_module
from interdict.engine.evidence import collect_evidence
from interdict.engine.sandbox import (
    ConcurrentModificationError,
    create_sandbox,
    mutate,
    read_revision,
    sandbox_name,
)
from interdict.engine.statuses import CollectionStatus, InconclusiveReason
from interdict.graphstore import GraphStore

AUTH_REACH = "ev-reach-auth-1-prod-payments-db-5432-tcp"


def test_sandbox_names_are_stable_secret_dependent_and_opaque() -> None:
    a = sandbox_name("session-1", "secret-a")
    assert a == sandbox_name("session-1", "secret-a")
    assert a != sandbox_name("session-2", "secret-a")
    assert a != sandbox_name("session-1", "secret-b")
    assert a.startswith("sandbox:") and "session-1" not in a


def test_sandbox_is_a_copy_with_evidence_stamped_by_the_collector(
    store: GraphStore, sandbox: str
) -> None:
    snap = collect_evidence(store, sandbox, NOW)
    expected = STAMP.strftime("%Y-%m-%dT%H:%M:%SZ")
    assert {r.evidence.observed_at for r in snap.reach} == {expected}
    assert {r.evidence.valid_until for r in snap.reach} == {
        (STAMP + timedelta(hours=12)).strftime("%Y-%m-%dT%H:%M:%SZ")
    }
    assert snap.revision == 1


def test_create_sandbox_is_idempotent_and_reset_restores_the_template(
    store: GraphStore, template: str, sandbox: str
) -> None:
    assert create_sandbox(store, sandbox, STAMP, template=template) is False
    write(store, sandbox, "MATCH (p:Pod {id: 'batch-1'}) DETACH DELETE p")
    assert create_sandbox(store, sandbox, STAMP, template=template, reset=True) is True
    assert "batch-1" in collect_evidence(store, sandbox, NOW).pods


def test_fresh_sandbox_has_a_complete_scope(store: GraphStore, sandbox: str) -> None:
    snap = collect_evidence(store, sandbox, NOW)
    assert snap.scope.complete, snap.scope.issues
    assert len(snap.pods) == 51
    assert len(snap.alerts) == ALERTS
    assert snap.crown_jewels == {"prod-payments-db", "customer-pii-db"}
    for name in (
        "exposure",
        "vulnerability",
        "reachability",
        "authorization",
        "policy",
        "dependency",
    ):
        assert snap.scope.tiers[name].status == CollectionStatus.COLLECTED_COMPLETE, name


def test_expired_evidence_makes_the_scope_inconclusive(store: GraphStore, sandbox: str) -> None:
    """TC-05 basis: evidence past valid_until is stale, never treated as absent."""
    write(
        store,
        sandbox,
        "MATCH ()-[e:CAN_REACH {id: $id}]->() SET e.valid_until = '2026-10-17T08:00:00Z'",
        {"id": AUTH_REACH},
    )
    snap = collect_evidence(store, sandbox, NOW)
    assert not snap.scope.complete
    assert snap.scope.tiers["reachability"].status == CollectionStatus.STALE_EXPIRED
    stale = [i for i in snap.scope.issues if i.reason == InconclusiveReason.STALE_EVIDENCE]
    assert stale and AUTH_REACH in stale[0].evidence_ids
    assert any(r.edge_id == AUTH_REACH for r in snap.reach), (
        "stale evidence is reported, not dropped"
    )


def test_unverified_evidence_makes_the_scope_inconclusive(store: GraphStore, sandbox: str) -> None:
    """D-06: verified = false is uncertainty, not absence."""
    write(
        store,
        sandbox,
        "MATCH ()-[e:CAN_REACH {id: $id}]->() SET e.verified = false",
        {"id": AUTH_REACH},
    )
    snap = collect_evidence(store, sandbox, NOW)
    assert InconclusiveReason.UNVERIFIED_EVIDENCE in snap.scope.reasons


def test_uncollected_reachability_makes_the_scope_inconclusive(
    store: GraphStore, sandbox: str
) -> None:
    """TC-38 basis: after a policy change, reachability must be observed again before any verdict."""
    write(store, sandbox, "MATCH (p:Pod {id: 'auth-1'}) SET p.reach_status = 'UNCOLLECTED'")
    snap = collect_evidence(store, sandbox, NOW)
    assert snap.scope.tiers["reachability"].status == CollectionStatus.UNCOLLECTED
    assert InconclusiveReason.UNCOLLECTED_EVIDENCE in snap.scope.reasons


def test_reach_not_allowed_by_policies_is_contradictory(store: GraphStore, sandbox: str) -> None:
    write(
        store,
        sandbox,
        "MATCH (p:Pod {id: 'platform-logging-1'}), (d:Database {id: 'customer-pii-db'}) "
        "CREATE (p)-[:CAN_REACH {id: 'ev-reach-contradiction', port: 5432, protocol: 'TCP', verified: true, "
        "observed_at: $obs, valid_until: $valid, evidence_source: 'SYNTHETIC_GENERATOR'}]->(d)",
        {"obs": "2026-10-17T09:00:00Z", "valid": "2026-10-17T21:00:00Z"},
    )
    snap = collect_evidence(store, sandbox, NOW)
    contradictions = [
        i for i in snap.scope.issues if i.reason == InconclusiveReason.CONTRADICTORY_EVIDENCE
    ]
    assert contradictions and "ev-reach-contradiction" in contradictions[0].evidence_ids


def test_incomplete_inventory_makes_the_scope_inconclusive(store: GraphStore, sandbox: str) -> None:
    write(store, sandbox, "MATCH (m:Meta {id: 'meta'}) SET m.inventory_complete = false")
    assert (
        InconclusiveReason.INVENTORY_INCOMPLETE
        in collect_evidence(store, sandbox, NOW).scope.reasons
    )


def test_a_failed_query_is_reported_and_never_read_as_empty(
    store: GraphStore, sandbox: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """TC-16 / TC-39 basis: a failure or timeout is QUERY_FAILED, never 'no reachability'."""
    real_run = evidence_module.run

    def failing_run(graph, template, *args, **kwargs):
        if template == "evidence-reachability":
            raise QueryFailedError(template, "Query timed out")
        return real_run(graph, template, *args, **kwargs)

    monkeypatch.setattr(evidence_module, "run", failing_run)
    snap = collect_evidence(store, sandbox, NOW)
    assert snap.scope.tiers["reachability"].status == CollectionStatus.QUERY_FAILED
    assert InconclusiveReason.QUERY_FAILED in snap.scope.reasons
    assert (
        next(q for q in snap.queries if q.template == "evidence-reachability").error
        == "Query timed out"
    )


def test_a_result_that_reaches_the_row_limit_is_a_failure(store: GraphStore, sandbox: str) -> None:
    """D-16 a: FalkorDB truncates silently, so a full result is not trusted."""
    snap = collect_evidence(store, sandbox, NOW, row_limit=50)
    assert snap.scope.tiers["alerts"].status == CollectionStatus.QUERY_FAILED
    assert not snap.scope.complete


def test_every_query_is_logged_with_template_rows_and_latency(
    store: GraphStore, sandbox: str
) -> None:
    snap = collect_evidence(store, sandbox, NOW)
    templates = [q.template for q in snap.queries]
    assert "evidence-reachability" in templates and "evidence-exposure" in templates
    assert all(q.latency_ms >= 0 and q.error is None for q in snap.queries)
    assert next(q for q in snap.queries if q.template == "evidence-alerts").rows == ALERTS


def test_alerts_carry_their_workload_and_vulnerability(store: GraphStore, sandbox: str) -> None:
    snap = collect_evidence(store, sandbox, NOW)
    vulns = {(v.pod, v.vuln_id) for v in snap.vulnerabilities}
    assert all((a.pod, a.vuln_id) in vulns for a in snap.alerts)


def test_tc42_revision_compare_and_set_lets_exactly_one_writer_win(
    store: GraphStore, sandbox: str
) -> None:
    body = "MATCH (p:Pod {id: 'batch-1'}) SET p.note = $note WITH m"

    def attempt(i: int) -> int | None:
        try:
            return mutate(store, sandbox, 1, "test-mutate", body, {"note": f"writer-{i}"})
        except ConcurrentModificationError:
            return None

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(attempt, range(8)))
    assert sorted(r for r in results if r is not None) == [2]
    assert results.count(None) == 7
    assert read_revision(store, sandbox) == 2
