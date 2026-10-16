"""The web API end to end (issue #13, solution.md §11.3, §12.7, TC-35, TC-36)."""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from interdict.api import COOKIE, create_app
from interdict.session import SessionKeys
from service_helpers import (
    AUTH_CLUSTER,
    DEEP_CLUSTER,
    app_settings,
    cleanup_session,
    direct_factory,
)

NO_LIMITS = {bucket: (10_000, 3600) for bucket in ("session", "operation", "agent")}


@pytest.fixture
def app_config(template):
    return app_settings(template)


@pytest.fixture
def client(store, app_config):
    app = create_app(
        store,
        app_config,
        invoker_factory=direct_factory(store, app_config),
        static_dir=None,
        limits=NO_LIMITS,
    )
    with TestClient(app) as http:
        yield http
        cookie = http.cookies.get(COOKIE)
        if cookie:
            cleanup_session(
                store, SessionKeys.derive(cookie.split(".")[0], app_config.session_secret)
            )


def start(http: TestClient) -> dict:
    body = http.post("/api/sessions").json()
    http.headers["X-CSRF-Token"] = body["csrf_token"]
    return body


def wait_for(http: TestClient, investigation_id: str, timeout: float = 30) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        state = http.get(f"/api/investigations/{investigation_id}").json()
        if state["status"] != "RUNNING":
            return state
        time.sleep(0.1)
    raise AssertionError("investigation did not finish")


def test_a_session_gets_its_own_sandbox_and_a_csrf_token(client) -> None:
    body = start(client)
    assert body["session"]["created"] and body["session"]["revision"] == 1
    assert body["session"]["storm_id"] == "storm-20261018"
    assert client.post("/api/sessions").json()["session"]["created"] is False, (
        "the cookie is reused"
    )


def test_requests_need_a_session_and_posts_need_the_csrf_token(client) -> None:
    assert client.get("/api/storm").status_code == 401
    start(client)
    token = client.headers.pop("X-CSRF-Token")
    assert client.post("/api/plans", json={"cluster_id": AUTH_CLUSTER}).status_code == 403
    client.headers["X-CSRF-Token"] = token
    real = client.cookies.get(COOKIE)
    client.cookies.clear()
    client.cookies.set(COOKIE, real.split(".")[0] + ".0000")
    assert client.get("/api/storm").status_code == 401, "a forged signature is rejected"
    client.cookies.clear()
    client.cookies.set(COOKIE, real)


def test_storm_view_and_strict_request_bodies(client) -> None:
    start(client)
    storm = client.get("/api/storm").json()
    assert storm["total_alerts"] == 200 and len(storm["alerts"]) == 200
    assert {c["id"] for c in storm["clusters"]} >= {AUTH_CLUSTER, DEEP_CLUSTER}
    assert (
        client.post(
            "/api/plans", json={"cluster_id": AUTH_CLUSTER, "cypher": "MATCH (n) DELETE n"}
        ).status_code
        == 422
    )
    assert (
        client.post("/api/sandbox/operations", json={"op": "RUN_QUERY", "args": {}}).status_code
        == 422
    )


def test_plan_hunt_certificate_and_subgraph(client) -> None:
    start(client)
    planned = client.post("/api/plans", json={"cluster_id": AUTH_CLUSTER}).json()
    assert planned["status"] == "PLAN_FOUND" and planned["plan_id"].startswith("plan-")
    hunted = client.post("/api/hunts", json={"plan_id": planned["plan_id"]}).json()
    assert hunted["status"] == "SIMULATED_CONTAINMENT"
    certificate_id = hunted["certificate"]["certificate_id"]
    certificate = client.get(f"/api/certificates/{certificate_id}").json()
    assert certificate["status"] == "VALID" and certificate["claim"] == "MODEL_VERIFIED_CONTAINMENT"
    graph = client.get(
        f"/api/clusters/{AUTH_CLUSTER}/subgraph", params={"plan_id": planned["plan_id"]}
    ).json()
    assert any(e["cut_by"] for e in graph["edges"]), "the verified plan's cuts are marked"
    assert {n["kind"] for n in graph["nodes"]} == {"Internet", "Pod", "Database"}


def test_a_deterministic_investigation_streams_its_timeline(client) -> None:
    start(client)
    started = client.post(
        "/api/investigations", json={"cluster_id": AUTH_CLUSTER, "mode": "deterministic"}
    )
    assert started.status_code == 202
    investigation_id = started.json()["investigation_id"]
    state = wait_for(client, investigation_id)
    assert state["status"] == "SIMULATED_CONTAINMENT"
    report = state["report"]
    assert report["headline"] == "Model-verified containment (simulation)"
    assert report["certificate_id"] and report["receipt_id"]
    tools_called = [e["tool"] for e in state["events"] if e["type"] == "tool_call"]
    assert tools_called == [
        "triage_alert_storm",
        "find_evidence_by_workload",
        "find_attack_paths_to_asset",
        "recall_incident_memory",
        "plan_remediation",
        "hunt_residual_paths",
        "submit_remediation_execution",
    ]
    with client.stream("GET", f"/api/investigations/{investigation_id}/events") as stream:
        body = "".join(stream.iter_text())
    assert body.count("\nevent: tool_result\n") == 7 and "event: done" in body
    resumed = client.get(
        f"/api/investigations/{investigation_id}/events",
        headers={"Last-Event-ID": str(len(state["events"]) - 1)},
    ).text
    assert resumed.count("data: ") == 1 and "event: done" in resumed


def test_agent_mode_without_a_key_runs_the_same_tools_deterministically(client) -> None:
    start(client)
    started = client.post(
        "/api/investigations", json={"cluster_id": DEEP_CLUSTER, "mode": "agent"}
    ).json()
    assert started["mode"] == "deterministic" and "No Claude API key" in started["notes"][0]
    state = wait_for(client, started["investigation_id"])
    assert state["status"] == "SIMULATED_CONTAINMENT", "the deep path is found and certified"


def test_tc36_sandbox_operations_supersede_certificates(client) -> None:
    start(client)
    planned = client.post("/api/plans", json={"cluster_id": AUTH_CLUSTER}).json()
    certificate_id = client.post("/api/hunts", json={"plan_id": planned["plan_id"]}).json()[
        "certificate"
    ]["certificate_id"]
    exposed = client.post(
        "/api/sandbox/operations", json={"op": "EXPOSE_WORKLOAD", "args": {"pod_id": "batch-1"}}
    ).json()
    assert exposed["result"] == "APPLIED" and exposed["revision"] == 2
    assert exposed["superseded_certificates"] == [certificate_id]
    assert client.get(f"/api/certificates/{certificate_id}").json()["status"] == "SUPERSEDED"
    reach = client.post(
        "/api/sandbox/operations",
        json={
            "op": "ADD_LATERAL_REACH",
            "args": {"src_pod_id": "batch-1", "dst_pod_id": "checkout-1", "port": 8080},
        },
    ).json()
    assert reach["result"] == "APPLIED"
    storm = client.get("/api/storm").json()
    assert storm["roles"]["batch-1"] == ["ENTRY"]
    assert {a["triage_class"] for a in storm["alerts"] if a["pod"] == "batch-1"} == {
        "ON_ATTACK_PATH"
    }
    reset = client.post("/api/sandbox/reset").json()
    assert reset["revision"] == 4, "revisions keep counting, so old certificates stay superseded"
    assert client.get(f"/api/certificates/{certificate_id}").json()["status"] == "SUPERSEDED"
    audit = client.get("/api/audit").json()
    assert audit["chain_valid"]
    assert {"SANDBOX_OPERATION_APPLIED", "CERTIFICATE_ISSUED", "PLAN_COMPUTED"} <= {
        e["event_type"] for e in audit["events"]
    }


def test_tc35_sessions_cannot_see_each_other(store, app_config) -> None:
    app = create_app(
        store,
        app_config,
        invoker_factory=direct_factory(store, app_config),
        static_dir=None,
        limits=NO_LIMITS,
    )
    with TestClient(app) as alice, TestClient(app) as bob:
        try:
            start(alice)
            start(bob)
            planned = alice.post("/api/plans", json={"cluster_id": AUTH_CLUSTER}).json()
            certificate_id = alice.post("/api/hunts", json={"plan_id": planned["plan_id"]}).json()[
                "certificate"
            ]["certificate_id"]
            assert bob.get(f"/api/certificates/{certificate_id}").status_code == 404
            assert bob.post("/api/hunts", json={"plan_id": planned["plan_id"]}).status_code == 404
            bob.post(
                "/api/sandbox/operations",
                json={"op": "EXPOSE_WORKLOAD", "args": {"pod_id": "batch-1"}},
            )
            assert alice.get(f"/api/certificates/{certificate_id}").json()["status"] == "VALID", (
                "Bob's change is his alone"
            )
        finally:
            for http in (alice, bob):
                cookie = http.cookies.get(COOKIE)
                if cookie:
                    cleanup_session(
                        store, SessionKeys.derive(cookie.split(".")[0], app_config.session_secret)
                    )


def test_the_operation_cap_and_system_endpoints(client, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("interdict.api.MAX_OPERATIONS", 1)
    start(client)
    first = client.post(
        "/api/sandbox/operations", json={"op": "EXPOSE_WORKLOAD", "args": {"pod_id": "batch-1"}}
    ).json()
    second = client.post(
        "/api/sandbox/operations", json={"op": "EXPOSE_WORKLOAD", "args": {"pod_id": "billing-1"}}
    ).json()
    assert first["result"] == "APPLIED" and second["result"] == "REJECTED_LIMIT"
    system = client.get("/api/system").json()
    assert system["live_mode"] is False and system["falkordb_version"] == "4.22.1"
    assert len(system["tools"]) == 7 and "EXPIRE_EVIDENCE" in system["sandbox_operations"]
    assert client.get("/healthz").json() == {"status": "ok"}
    assert client.get("/readyz").json()["checks"]["falkordb"] is True
