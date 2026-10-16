"""Tests for the synthetic environment generator (issue #5, solution.md §4.3, D-18)."""

from __future__ import annotations

import ipaddress
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from interdict.seed import generate
from interdict.seed.generator import INJECTION_TITLE, validate
from interdict.seed.model import Environment

SHOP_PODS = (
    "auth-1",
    "analytics-1",
    "frontend-1",
    "checkout-1",
    "batch-1",
    "billing-1",
    "metrics-1",
)
DEEP_CHAIN = ("bq-frontend-1", "bq-checkout-1", "bq-email-1", "bq-newsletter-1", "bq-crm-sync-1")
DNS = ("kube-dns", 53, "UDP")


def pod_facts(env: Environment, pod: str) -> dict[str, Any]:
    """Everything the engine will read about one pod, gathered from the raw environment."""
    service = next(e.src for e in env.edges_of("TARGETS") if e.dst == pod)
    ingresses = sorted(e.src for e in env.edges_of("ROUTES_TO") if e.dst == service)
    image = next(e.dst for e in env.edges_of("RUNS_IMAGE") if e.src == pod)
    vulns = sorted(
        (
            env.node(e.dst).props["cve_id"],
            env.node(e.dst).props["attack_vector"],
            env.node(e.dst).props["status"],
        )
        for e in env.edges_of("HAS_VULNERABILITY")
        if e.src == image
    )
    role = next((e.dst for e in env.edges_of("ASSUMES_ROLE") if e.src == pod), None)
    perms = {e.dst for e in env.edges_of("GRANTS_ACCESS") if e.src == role}
    grants = sorted(e.dst for e in env.edges_of("APPLIES_TO") if e.src in perms)
    return {
        "ingresses": ingresses,
        "vulns": vulns,
        "grants": grants,
        "egress": sorted(
            (e.dst, e.props["port"], e.props["protocol"])
            for e in env.edges_of("CAN_REACH")
            if e.src == pod
        ),
        "declared": sorted(
            (e.dst, e.props["port"], e.props["protocol"])
            for e in env.edges_of("DEPENDS_ON")
            if e.src == pod
        ),
        "manifest": env.node(pod).props["dependency_manifest"],
    }


def final_hops_by_crown_jewel(env: Environment) -> dict[str, dict[str, int]]:
    """Independent reading of the threat model (ENTRY, LATERAL, GOAL) over the raw environment.

    Returns, per crown jewel, each pod that completes a chain to it and the minimum number of
    lateral hops needed to reach that pod from the Internet.
    """
    exposed_ingresses = {e.dst for e in env.edges_of("EXPOSES")}
    routed = {e.dst for e in env.edges_of("ROUTES_TO") if e.src in exposed_ingresses}
    exposed = {e.dst for e in env.edges_of("TARGETS") if e.src in routed}
    image_of = {e.src: e.dst for e in env.edges_of("RUNS_IMAGE")}
    vulnerable_images = {
        e.src
        for e in env.edges_of("HAS_VULNERABILITY")
        if env.node(e.dst).props["status"] == "ACTIVE"
        and env.node(e.dst).props["attack_vector"] in {"NETWORK", "ADJACENT"}
    }
    net_vuln = {p.id for p in env.by_label("Pod") if image_of.get(p.id) in vulnerable_images}
    role_of = {e.src: e.dst for e in env.edges_of("ASSUMES_ROLE")}
    perm_dbs: dict[str, set[str]] = defaultdict(set)
    for edge in env.edges_of("APPLIES_TO"):
        perm_dbs[edge.src].add(edge.dst)
    role_dbs: dict[str, set[str]] = defaultdict(set)
    for edge in env.edges_of("GRANTS_ACCESS"):
        if env.node(edge.dst).props["effect"] == "Allow":
            role_dbs[edge.src] |= perm_dbs[edge.dst]
    crown = {d.id for d in env.by_label("Database") if d.props["is_crown_jewel"]}
    reach: dict[str, set[str]] = defaultdict(set)
    for edge in env.edges_of("CAN_REACH"):
        reach[edge.src].add(edge.dst)

    depth = {pod: 0 for pod in sorted(exposed & net_vuln)}
    frontier = list(depth)
    while frontier:
        nxt = []
        for pod in frontier:
            for dst in sorted(reach[pod]):
                if dst in net_vuln and dst not in depth:
                    depth[dst] = depth[pod] + 1
                    nxt.append(dst)
        frontier = nxt

    result: dict[str, dict[str, int]] = defaultdict(dict)
    for pod, hops in depth.items():
        for db in reach[pod] & crown & role_dbs.get(role_of.get(pod, ""), set()):
            result[db][pod] = hops
    return dict(result)


@pytest.fixture(scope="module")
def env() -> Environment:
    return generate()


def test_generated_environment_passes_its_own_validation(env: Environment) -> None:
    assert validate(env) == []


def test_same_seed_gives_an_identical_environment() -> None:
    assert generate(seed=7).to_dict() == generate(seed=7).to_dict()


def test_a_different_seed_changes_only_the_background_noise() -> None:
    a, b = generate(seed=1), generate(seed=2)
    assert a.to_dict() != b.to_dict()
    for pod in (*SHOP_PODS, *DEEP_CHAIN):
        assert pod_facts(a, pod) == pod_facts(b, pod), pod


def test_worked_example_matches_solution_section_4_3(env: Environment) -> None:
    expected = {
        "auth-1": {
            "ingresses": ["ing-auth"],
            "vulns": [("DEMO-CVE-001", "NETWORK", "ACTIVE")],
            "grants": ["prod-payments-db"],
            "egress": sorted([("prod-payments-db", 5432, "TCP"), ("billing-1", 8080, "TCP"), DNS]),
            "declared": sorted([("billing-1", 8080, "TCP"), DNS]),
            "manifest": "COMPLETE",
        },
        "analytics-1": {
            "ingresses": ["ing-analytics"],
            "vulns": [("DEMO-CVE-303", "NETWORK", "ACTIVE")],
            "grants": ["prod-payments-db"],
            "egress": sorted([("prod-payments-db", 5432, "TCP"), ("metrics-1", 9090, "TCP"), DNS]),
            "declared": [DNS],
            "manifest": "PARTIAL",
        },
        "frontend-1": {
            "ingresses": ["ing-shop"],
            "vulns": [("DEMO-CVE-101", "NETWORK", "ACTIVE")],
            "grants": [],
            "egress": sorted([("checkout-1", 8080, "TCP"), DNS]),
            "declared": sorted([("checkout-1", 8080, "TCP"), DNS]),
            "manifest": "COMPLETE",
        },
        "checkout-1": {
            "ingresses": [],
            "vulns": [("DEMO-CVE-202", "NETWORK", "ACTIVE")],
            "grants": ["prod-payments-db"],
            "egress": sorted([("prod-payments-db", 5432, "TCP"), DNS]),
            "declared": sorted([("prod-payments-db", 5432, "TCP"), DNS]),
            "manifest": "COMPLETE",
        },
        "batch-1": {
            "ingresses": [],
            "vulns": [("DEMO-CVE-001", "NETWORK", "ACTIVE")],
            "grants": [],
            "egress": [DNS],
            "declared": [DNS],
            "manifest": "COMPLETE",
        },
    }
    for pod, facts in expected.items():
        assert pod_facts(env, pod) == facts, pod
    assert not [e for e in env.edges_of("SELECTS") if e.dst in SHOP_PODS], (
        "shop pods must have no baseline egress policy"
    )


def test_only_the_designed_chains_reach_crown_jewels(env: Environment) -> None:
    """Payments: auth-1 and analytics-1 directly, checkout-1 via frontend-1 (1 lateral hop).
    Customer PII: only the boutique chain, 4 lateral hops, beyond the planner's 3-hop bound."""
    assert final_hops_by_crown_jewel(env) == {
        "prod-payments-db": {"auth-1": 0, "analytics-1": 0, "checkout-1": 1},
        "customer-pii-db": {"bq-crm-sync-1": 4},
    }


@pytest.mark.parametrize("seed", [1, 2, 3, 99, 20261018])
def test_noise_never_creates_a_path_to_a_crown_jewel(seed: int) -> None:
    hops = final_hops_by_crown_jewel(generate(seed=seed))
    assert set(hops) == {"prod-payments-db", "customer-pii-db"}
    assert set(hops["prod-payments-db"]) == {"auth-1", "analytics-1", "checkout-1"}
    assert hops["customer-pii-db"] == {"bq-crm-sync-1": 4}


@pytest.mark.parametrize("count", [1000, 250])
def test_alert_count_is_exact(count: int) -> None:
    env = generate(alert_count=count)
    assert len(env.by_label("Alert")) == count
    assert validate(env) == []


def test_scenario_findings_get_alerts_before_any_finding_gets_a_second(env: Environment) -> None:
    alerted_pods = {e.dst for e in env.edges_of("ON_WORKLOAD")}
    vulnerable_scenario_pods = {
        "auth-1",
        "analytics-1",
        "frontend-1",
        "checkout-1",
        "batch-1",
        "billing-1",
        *DEEP_CHAIN,
    }
    assert vulnerable_scenario_pods <= alerted_pods
    small = generate(alert_count=20)
    assert {e.dst for e in small.edges_of("ON_WORKLOAD")} >= {"auth-1", "batch-1", "frontend-1"}


def test_exactly_one_prompt_injection_probe_among_the_alerts(env: Environment) -> None:
    titles = [a.props["title"] for a in env.by_label("Alert")]
    assert titles.count(INJECTION_TITLE) == 1


def test_evidence_edges_carry_provenance_stamped_at_generation_time() -> None:
    stamp = datetime(2026, 10, 17, 9, 30, tzinfo=UTC)
    env = generate(stamped_at=stamp, ttl=timedelta(hours=12))
    evidence = (
        "EXPOSES",
        "ROUTES_TO",
        "TARGETS",
        "RUNS_IMAGE",
        "HAS_VULNERABILITY",
        "CAN_REACH",
        "ASSUMES_ROLE",
        "GRANTS_ACCESS",
        "APPLIES_TO",
    )
    for rel in evidence:
        for edge in env.edges_of(rel):
            assert edge.props["evidence_source"] == "SYNTHETIC_GENERATOR", edge.id
            assert edge.props["verified"] is True, edge.id
            assert edge.props["observed_at"] == "2026-10-17T09:30:00Z", edge.id
            assert edge.props["valid_until"] == "2026-10-17T21:30:00Z", edge.id


def test_synthetic_markers_make_the_data_unmistakably_fake(env: Environment) -> None:
    """D-18: nothing in the dataset should look like a real system, CVE or account."""
    documentation_net = ipaddress.ip_network("203.0.113.0/24")
    assert all(v.props["cve_id"].startswith("DEMO-CVE-") for v in env.by_label("Vulnerability"))
    for ingress in env.by_label("Ingress"):
        assert ipaddress.ip_address(ingress.props["ip"]) in documentation_net
        assert ingress.props["host"].endswith(".example")
    assert all(":000000000000:" in r.props["arn"] for r in env.by_label("IAMRole"))
    assert all(
        i.props["repository"].startswith("registry.example/")
        for i in env.by_label("ContainerImage")
    )


def test_validator_detects_reach_that_baseline_policies_do_not_allow(env: Environment) -> None:
    broken = generate()
    isolated_pod = next(e.dst for e in broken.edges_of("SELECTS"))
    broken.add_edge(
        "CAN_REACH",
        isolated_pod,
        "prod-payments-db",
        "ev-reach-forbidden",
        port=5432,
        protocol="TCP",
    )
    assert any("not allowed by the baseline policies" in p for p in validate(broken))
