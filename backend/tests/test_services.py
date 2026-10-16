"""Tools, gateway, memory, audit and sandbox operations (issues #12-#13, solution.md §10, §12)."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest

from interdict.audit import AuditLog
from interdict.engine.statuses import SandboxOpResult
from interdict.memory import Memory
from interdict.sandbox_ops import apply_operation
from interdict.tools import (
    ToolError,
    find_attack_paths_to_asset,
    find_evidence_by_workload,
    hunt_residual_paths,
    plan_remediation_tool,
    recall_incident_memory,
    submit_remediation_execution,
    triage_alert_storm,
)
from service_helpers import (
    AUTH_CLUSTER,
    DEEP_CLUSTER,
    PAYMENTS,
    STORM,
    app_settings,
    cleanup_session,
    tool_context,
)


@pytest.fixture
def ctx(store, template):
    context = tool_context(store, app_settings(template))
    yield context
    cleanup_session(store, context.keys)


def certify(ctx, cluster_id: str = AUTH_CLUSTER) -> dict:
    planned = plan_remediation_tool(ctx, cluster_id=cluster_id).brief
    return hunt_residual_paths(ctx, planned["plan_id"]).brief


def test_triage_tool_reports_the_storm_and_hides_raw_alert_text(ctx) -> None:
    out = triage_alert_storm(ctx, STORM)
    assert out.brief["complete"] and out.brief["total_alerts"] == 200
    assert {c["id"] for c in out.brief["clusters"]} >= {AUTH_CLUSTER, DEEP_CLUSTER}
    assert all("untrusted_text" in a["title"] for a in out.brief["sample_on_path_alerts"])
    assert "alerts" not in out.data, "the model never receives the 1,000 raw alerts"
    assert out.evidence and all("template" in e for e in out.evidence)
    with pytest.raises(ToolError) as err:
        triage_alert_storm(ctx, "storm-1")
    assert err.value.code == "NOT_FOUND"


def test_tools_validate_their_inputs(ctx) -> None:
    for call, code in (
        (lambda: find_evidence_by_workload(ctx, "Auth-1"), "VALIDATION_ERROR"),
        (lambda: find_evidence_by_workload(ctx, "nobody-1"), "NOT_FOUND"),
        (lambda: find_attack_paths_to_asset(ctx, PAYMENTS, 4), "VALIDATION_ERROR"),
        (lambda: find_attack_paths_to_asset(ctx, "redis-cart"), "NOT_FOUND"),
        (lambda: plan_remediation_tool(ctx), "VALIDATION_ERROR"),
        (lambda: plan_remediation_tool(ctx, cluster_id="cluster-nope"), "NOT_FOUND"),
        (lambda: hunt_residual_paths(ctx, "plan-0000"), "NOT_FOUND"),
        (lambda: recall_incident_memory(ctx, []), "VALIDATION_ERROR"),
    ):
        with pytest.raises(ToolError) as err:
            call()
        assert err.value.code == code


def test_paths_tool_flags_the_path_beyond_the_bound(ctx) -> None:
    out = find_attack_paths_to_asset(ctx, "customer-pii-db")
    assert out.data["chains"] == [] and out.data["beyond_bound"][0]["id"] == DEEP_CLUSTER
    assert "beyond the bound" in out.summary


def test_plan_then_hunt_issues_a_stored_certificate(ctx) -> None:
    hunted = certify(ctx)
    assert hunted["status"] == "SIMULATED_CONTAINMENT"
    certificate = hunted["certificate"]
    stored = ctx.records.get(ctx.keys.certificate(certificate["certificate_id"]))
    assert stored["plan"]["plan_id"] == certificate["certified_plan_id"]
    assert hunted["memory_recorded"] is True
    assert [r["round"] for r in hunted["rounds"]] == [0, 1]


def test_a_plan_cannot_be_hunted_after_the_sandbox_changed(ctx) -> None:
    planned = plan_remediation_tool(ctx, cluster_id=AUTH_CLUSTER).brief
    apply_operation(
        ctx.store, ctx.keys.sandbox, "EXPOSE_WORKLOAD", {"pod_id": "batch-1"}, datetime.now(UTC)
    )
    with pytest.raises(ToolError) as err:
        hunt_residual_paths(ctx, planned["plan_id"])
    assert err.value.code == "PRECONDITION_FAILED"


# --- Action Gateway (TC-08, TC-09, TC-10) ------------------------------------------------------


def test_tc10_an_accepted_execution_is_idempotent(ctx) -> None:
    cert = certify(ctx)["certificate"]
    key = f"inv-{uuid.uuid4().hex[:12]}"
    first = submit_remediation_execution(
        ctx, cert["certified_plan_id"], cert["certificate_id"], "SIMULATION", key
    ).data
    again = submit_remediation_execution(
        ctx, cert["certified_plan_id"], cert["certificate_id"], "SIMULATION", key
    ).data
    assert first["status"] == "ACCEPTED" and first["duplicate"] is False
    assert again["receipt_id"] == first["receipt_id"] and again["duplicate"] is True
    assert first["note"] == "Simulation only: no infrastructure is changed."
    receipts = [e for e in ctx.audit.page() if e["event_type"] == "GATEWAY_RECEIPT"]
    assert len(receipts) == 1, "a duplicate never executes twice"


def test_tc09_tc08_the_gateway_rejects_what_it_must(ctx) -> None:
    cert = certify(ctx)["certificate"]
    plan_id, cert_id = cert["certified_plan_id"], cert["certificate_id"]

    def submit(**overrides):
        args = {
            "plan_id": plan_id,
            "certificate_id": cert_id,
            "execution_mode": "SIMULATION",
            "idempotency_key": f"k-{uuid.uuid4().hex[:12]}",
        }
        args.update(overrides)
        return submit_remediation_execution(ctx, **args).data

    assert submit(action_type="TERMINATE_CONTAINER")["rejection"] == "UNAUTHORIZED_ACTION"
    assert submit(execution_mode="LIVE")["rejection"] == "LIVE_MODE_DISABLED"
    assert submit(certificate_id=f"cert-{'0' * 32}")["rejection"] == "MISSING_CERTIFICATE"
    assert submit(plan_id="plan-0000000000000000")["rejection"] == "MISSING_CERTIFICATE"
    apply_operation(
        ctx.store, ctx.keys.sandbox, "EXPOSE_WORKLOAD", {"pod_id": "batch-1"}, datetime.now(UTC)
    )
    stale = submit()
    assert stale["rejection"] == "STALE_REVISION_REJECTED" and "revision 2" in stale["detail"]
    assert all(e["event_type"] != "GATEWAY_RECEIPT" for e in ctx.audit.page())


def test_an_expired_certificate_is_not_accepted(ctx) -> None:
    cert = certify(ctx)["certificate"]
    later = ctx.clock() + timedelta(hours=13)
    ctx.clock = lambda: later
    result = submit_remediation_execution(
        ctx, cert["certified_plan_id"], cert["certificate_id"], "SIMULATION", "expired-key-1"
    ).data
    assert result["rejection"] == "MISSING_CERTIFICATE" and "expired" in result["detail"]


# --- memory (D-17, TC-41) ----------------------------------------------------------------------


def test_memory_recalls_the_latest_run_for_an_asset(ctx) -> None:
    assert recall_incident_memory(ctx, [PAYMENTS]).data["entries"] == []
    certify(ctx)
    recalled = recall_incident_memory(ctx, [PAYMENTS]).data
    assert recalled["status"] == "AVAILABLE" and recalled["current_revision"] == 1
    entry = recalled["entries"][0]
    assert entry["status"] == "SIMULATED_CONTAINMENT" and entry["sandbox_revision"] == 1
    assert entry["certificate"]["id"].startswith("cert-")
    assert entry["certificate_status_now"] == "VALID"
    apply_operation(
        ctx.store, ctx.keys.sandbox, "EXPOSE_WORKLOAD", {"pod_id": "batch-1"}, datetime.now(UTC)
    )
    later = recall_incident_memory(ctx, [PAYMENTS]).data["entries"][0]
    assert later["certificate_status_now"] == "SUPERSEDED", "memory is a starting point, not proof"


def test_tc41_memory_failure_never_breaks_a_run(ctx, monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(*args, **kwargs):
        raise ConnectionError("memory graph unavailable")

    monkeypatch.setattr("interdict.memory.run", broken)
    hunted = certify(ctx)
    assert hunted["status"] == "SIMULATED_CONTAINMENT" and hunted["memory_recorded"] is False
    ctx.store.graph(ctx.keys.memory).query("CREATE (:Asset {id: 'probe'})")
    recalled = recall_incident_memory(ctx, [PAYMENTS]).data
    assert recalled["status"] == "UNAVAILABLE" and recalled["entries"] == []


def test_memory_is_per_session(store, template) -> None:
    settings = app_settings(template)
    a, b = tool_context(store, settings), tool_context(store, settings)
    try:
        certify(a)
        assert Memory(store, b.keys.memory).recall([PAYMENTS])["entries"] == []
        assert recall_incident_memory(a, [PAYMENTS]).data["entries"]
    finally:
        cleanup_session(store, a.keys)
        cleanup_session(store, b.keys)


# --- audit chain (TC-13) -----------------------------------------------------------------------


def test_tc13_the_audit_chain_detects_tampering(store) -> None:
    log = AuditLog(store, f"audit:test:{uuid.uuid4().hex[:8]}")
    try:
        for n in range(4):
            log.append("TEST_EVENT", revision=1, n=n)
        events = log.page()
        assert [e["seq"] for e in events] == [1, 2, 3, 4] and log.verify()
        assert events[1]["prev_hash"] == events[0]["hash"]
        entries = store.db.connection.xrange(log.stream)
        entry_id, fields = entries[2]
        forged = json.loads(fields["event"])
        forged["n"] = 99
        store.db.connection.xdel(log.stream, entry_id)
        store.db.connection.xadd(log.stream, {"event": json.dumps(forged)})
        assert not log.verify()
    finally:
        store.db.connection.delete(log.stream)


# --- sandbox operations (TC-36, D-12) ----------------------------------------------------------


def on_path_roles(ctx, pod: str):
    out = triage_alert_storm(ctx, STORM)
    return out.brief["roles"].get(pod), out


def test_tc36_exposure_alone_does_not_flip_but_exposure_plus_reach_does(ctx) -> None:
    now = datetime.now(UTC)
    assert on_path_roles(ctx, "batch-1")[0] is None
    exposed = apply_operation(
        ctx.store, ctx.keys.sandbox, "EXPOSE_WORKLOAD", {"pod_id": "batch-1"}, now
    )
    assert exposed.result == SandboxOpResult.APPLIED and exposed.revision == 2
    assert on_path_roles(ctx, "batch-1")[0] is None, "exposed but no reach: still on no path (D-12)"
    reach = apply_operation(
        ctx.store,
        ctx.keys.sandbox,
        "ADD_LATERAL_REACH",
        {"src_pod_id": "batch-1", "dst_pod_id": "checkout-1", "port": 8080},
        now,
    )
    assert reach.result == SandboxOpResult.APPLIED and reach.revision == 3
    roles, out = on_path_roles(ctx, "batch-1")
    assert roles == ["ENTRY"]
    assert any(c["path"][1] == "batch-1" for c in out.brief["chains"])


def test_operations_validate_and_respect_policies(ctx) -> None:
    now = datetime.now(UTC)
    sandbox = ctx.keys.sandbox
    ctx.ensure_sandbox()

    def op(name, args):
        return apply_operation(ctx.store, sandbox, name, args, now).result

    assert op("EXPOSE_WORKLOAD", {"pod_id": "auth-1"}) == SandboxOpResult.REJECTED_VALIDATION, (
        "already exposed"
    )
    assert (
        op("EXPOSE_WORKLOAD", {"pod_id": "auth-1", "extra": 1})
        == SandboxOpResult.REJECTED_VALIDATION
    )
    assert (
        op("ADD_LATERAL_REACH", {"src_pod_id": "auth-1", "dst_pod_id": "auth-1", "port": 1})
        == SandboxOpResult.REJECTED_VALIDATION
    )
    assert (
        op("ADD_LATERAL_REACH", {"src_pod_id": "auth-1", "dst_pod_id": "batch-1", "port": 70000})
        == SandboxOpResult.REJECTED_VALIDATION
    )
    assert (
        op("ADD_LATERAL_REACH", {"src_pod_id": "auth-1", "dst_pod_id": "billing-1", "port": 8080})
        == SandboxOpResult.REJECTED_VALIDATION
    ), "already observed"
    baseline_pod = (
        ctx.store.graph(sandbox)
        .query("MATCH (:NetworkPolicy)-[:SELECTS]->(p:Pod) RETURN p.id ORDER BY p.id LIMIT 1")
        .result_set[0][0]
    )
    assert (
        op("ADD_LATERAL_REACH", {"src_pod_id": baseline_pod, "dst_pod_id": "auth-1", "port": 4444})
        == SandboxOpResult.REJECTED_CONTRADICTS_POLICY
    )
    assert (
        op("EXPIRE_EVIDENCE", {"edge_ref": "sel-np-unknown"}) == SandboxOpResult.REJECTED_VALIDATION
    )
    assert op("DROP_EVERYTHING", {}) == SandboxOpResult.REJECTED_VALIDATION


def test_expiring_evidence_makes_triage_honestly_inconclusive(ctx) -> None:
    ctx.ensure_sandbox()
    result = apply_operation(
        ctx.store,
        ctx.keys.sandbox,
        "EXPIRE_EVIDENCE",
        {"edge_ref": "ev-reach-auth-1-prod-payments-db-5432-tcp"},
        datetime.now(UTC),
    )
    assert result.result == SandboxOpResult.APPLIED
    out = triage_alert_storm(ctx, STORM)
    assert not out.brief["complete"]
    assert (
        out.brief["counts"]["ON_ATTACK_PATH"] == 0
        and out.brief["counts"]["TRIAGE_INCONCLUSIVE"] > 0
    )
    with pytest.raises(ToolError) as err:
        find_attack_paths_to_asset(ctx, PAYMENTS)
    assert err.value.code == "SCOPE_INCOMPLETE"


# --- sandbox lifetime (§12.2) ------------------------------------------------------------------


def test_an_idle_sandbox_expires_and_comes_back_without_reviving_certificates(ctx) -> None:
    from interdict.gateway import certificate_status

    certificate = certify(ctx)["certificate"]
    ttl = ctx.store.db.connection.pttl(ctx.keys.sandbox)
    assert 0 < ttl <= 2 * 60 * 60 * 1000, "idle sandboxes expire after two hours"
    document = ctx.records.get(ctx.keys.certificate(certificate["certificate_id"]))
    assert certificate_status(document, ctx.clock(), ctx.revision()) == "VALID"
    ctx.store.delete(ctx.keys.sandbox)  # what the idle expiry does
    assert ctx.revision() == 2, "the re-created sandbox resumes above the last revision"
    assert certificate_status(document, ctx.clock(), ctx.revision()) == "SUPERSEDED"
    assert triage_alert_storm(ctx, STORM).brief["complete"]
