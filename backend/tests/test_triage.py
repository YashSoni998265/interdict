"""Alert Storm triage (issue #8, solution.md §6.8): partition, roles, clusters, failure handling."""

from __future__ import annotations

import pathlib
import statistics
import time
import uuid

import pytest

from engine_helpers import ALERTS, NOW, STAMP, write
from interdict.db import QueryFailedError
from interdict.engine import evidence as evidence_module
from interdict.engine.attackgraph import chain_id
from interdict.engine.sandbox import create_sandbox
from interdict.engine.statuses import AlertTriageClass, InconclusiveReason
from interdict.engine.triage import run_triage
from interdict.graphstore import GraphStore
from interdict.seed import generate
from interdict.seed.generator import BOUTIQUE_APPS, DATABASES, INGRESSES, SHOP_APPS
from interdict.seed.loader import load

ON = AlertTriageClass.ON_ATTACK_PATH


def by_pod(report) -> dict[str, set[AlertTriageClass]]:
    classes: dict[str, set[AlertTriageClass]] = {}
    for v in report.verdicts:
        classes.setdefault(v.pod, set()).add(v.triage_class)
    return classes


def test_every_alert_gets_exactly_one_class(store: GraphStore, sandbox: str) -> None:
    report = run_triage(store, sandbox, NOW)
    assert report.complete, report.issues
    assert len(report.verdicts) == ALERTS
    assert sum(report.counts.values()) == ALERTS
    assert len({v.alert_id for v in report.verdicts}) == ALERTS


def test_worked_example_classes_and_roles(store: GraphStore, sandbox: str) -> None:
    report = run_triage(store, sandbox, NOW)
    classes = by_pod(report)
    assert classes["auth-1"] == {ON}
    assert classes["batch-1"] == {AlertTriageClass.NOT_ON_ATTACK_PATH}, (
        "restraint: same CVE, no path (TC-02)"
    )
    assert classes["billing-1"] == {AlertTriageClass.NOT_ACTIONABLE}, "LOCAL vulnerability"
    assert report.roles["auth-1"] == ["ENTRY", "FINAL_HOP"]
    assert report.roles["frontend-1"] == ["ENTRY"]
    assert report.roles["checkout-1"] == ["FINAL_HOP", "LATERAL"]
    assert report.roles["bq-email-1"] == ["LATERAL"]
    assert report.roles["bq-crm-sync-1"] == ["FINAL_HOP", "LATERAL"]


def test_tc01_the_direct_auth_chain_qualifies(store: GraphStore, sandbox: str) -> None:
    report = run_triage(store, sandbox, NOW)
    assert chain_id(("auth-1",), "prod-payments-db") in {c.id for c in report.chains}


def test_clusters_group_chains_by_target_and_entry_and_flag_the_deep_path(
    store: GraphStore, sandbox: str
) -> None:
    report = run_triage(store, sandbox, NOW)
    clusters = {c.id: c for c in report.clusters}
    assert clusters["cluster-prod-payments-db-ing-auth"].chain_ids == (
        chain_id(("auth-1",), "prod-payments-db"),
    )
    assert clusters["cluster-prod-payments-db-ing-analytics"].chain_ids == (
        chain_id(("analytics-1",), "prod-payments-db"),
    )
    assert clusters["cluster-prod-payments-db-ing-shop"].chain_ids == (
        chain_id(("frontend-1", "checkout-1"), "prod-payments-db"),
    )
    deep = clusters["cluster-customer-pii-db-deep"]
    assert deep.beyond_bound and deep.chain_ids == ()
    assert deep.entry_ingress == "ing-boutique"
    assert deep.witness_path[1:-1] == (
        "bq-frontend-1",
        "bq-checkout-1",
        "bq-email-1",
        "bq-newsletter-1",
        "bq-crm-sync-1",
    )
    assert len(report.clusters) == 4


def test_funnel_counts_are_consistent_with_the_verdicts(store: GraphStore, sandbox: str) -> None:
    report = run_triage(store, sandbox, NOW)
    stages = {s["stage"]: s["count"] for s in report.funnel}
    assert stages["alerts"] == ALERTS
    assert stages["on_attack_path"] == report.counts["ON_ATTACK_PATH"]
    assert (
        stages["actionable"]
        == report.counts["ON_ATTACK_PATH"] + report.counts["NOT_ON_ATTACK_PATH"]
    )
    assert stages["workloads_on_path"] == len(report.workloads_on_path)
    assert stages["clusters"] == len(report.clusters)


def test_tc15_the_same_environment_gives_an_identical_triage(
    store: GraphStore, template: str
) -> None:
    names = [f"test:sbx15:{uuid.uuid4().hex[:8]}" for _ in range(2)]
    try:
        reports = []
        for name in names:
            create_sandbox(store, name, STAMP, template=template)
            reports.append(run_triage(store, name, NOW))
        a, b = reports
        assert [(v.alert_id, v.triage_class, v.roles) for v in a.verdicts] == [
            (v.alert_id, v.triage_class, v.roles) for v in b.verdicts
        ]
        assert a.clusters == b.clusters and [c.id for c in a.chains] == [c.id for c in b.chains]
    finally:
        for name in names:
            store.delete(name)


def test_tc16_a_failed_query_leaves_only_decidable_alerts_classified(
    store: GraphStore, sandbox: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    real_run = evidence_module.run

    def failing(graph, template, *args, **kwargs):
        if template == "evidence-reachability":
            raise QueryFailedError(template, "Query timed out")
        return real_run(graph, template, *args, **kwargs)

    monkeypatch.setattr(evidence_module, "run", failing)
    report = run_triage(store, sandbox, NOW)
    assert not report.complete and InconclusiveReason.QUERY_FAILED in {
        i.reason for i in report.issues
    }
    assert report.counts["ON_ATTACK_PATH"] == 0 and report.counts["NOT_ON_ATTACK_PATH"] == 0
    assert report.counts["NOT_ACTIONABLE"] > 0
    assert sum(report.counts.values()) == ALERTS
    assert report.chains == [] and report.clusters == []


def test_stale_evidence_makes_actionable_alerts_inconclusive(
    store: GraphStore, sandbox: str
) -> None:
    write(
        store,
        sandbox,
        "MATCH ()-[e:CAN_REACH {id: 'ev-reach-auth-1-prod-payments-db-5432-tcp'}]->() SET e.valid_until = '2026-10-17T08:00:00Z'",
    )
    report = run_triage(store, sandbox, NOW)
    assert report.counts["ON_ATTACK_PATH"] == 0
    assert report.counts["TRIAGE_INCONCLUSIVE"] > 0
    assert {v.triage_class for v in report.verdicts if v.pod == "batch-1"} == {
        AlertTriageClass.TRIAGE_INCONCLUSIVE
    }


def test_a_sandbox_without_any_attack_step_is_handled(store: GraphStore, sandbox: str) -> None:
    write(store, sandbox, "MATCH (:Internet)-[e:EXPOSES]->() DELETE e")
    report = run_triage(store, sandbox, NOW)
    assert report.complete, report.issues
    assert report.counts["ON_ATTACK_PATH"] == 0 and report.clusters == []


def test_tc17_engine_code_contains_no_scenario_identifiers() -> None:
    """Outcomes must be computed, so the engine may not mention any fixture by name."""
    names = {pod for app in (*SHOP_APPS, *BOUTIQUE_APPS) for pod in app.pods}
    names |= {db for db, _, _ in DATABASES} | {i.id for i in INGRESSES} | {"DEMO-CVE"}
    engine_dir = pathlib.Path(evidence_module.__file__).parent
    for source in engine_dir.glob("*.py"):
        text = source.read_text()
        hits = sorted(n for n in names if n in text)
        assert not hits, f"{source.name} mentions scenario identifiers {hits}"


def test_g4_storm_triage_latency_on_1000_alerts(store: GraphStore) -> None:
    """Gate G4: warm p95 of a full storm triage (1,000 alerts) must stay under 2 s."""
    template = f"test:tplg4:{uuid.uuid4().hex[:8]}"
    sandbox = f"test:sbxg4:{uuid.uuid4().hex[:8]}"
    try:
        load(store, generate(alert_count=1000), template)
        create_sandbox(store, sandbox, STAMP, template=template)
        run_triage(store, sandbox, NOW)  # warm-up
        times = []
        for _ in range(5):
            started = time.perf_counter()
            report = run_triage(store, sandbox, NOW)
            times.append(time.perf_counter() - started)
        assert report.complete and len(report.verdicts) == 1000
        p95 = sorted(times)[-1]
        print(
            f"\nG4 storm triage: median {statistics.median(times) * 1000:.0f} ms, max of 5 {p95 * 1000:.0f} ms"
        )
        assert p95 < 2.0
    finally:
        store.delete(sandbox)
        store.delete(template)
