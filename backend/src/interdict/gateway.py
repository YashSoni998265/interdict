"""Action Gateway: the only path from a plan to an execution receipt (§10.9, TC-08 to TC-10).

The LLM can ask for an execution, but this code decides, in this order:

    1. allowlist      only APPLY_NETWORK_POLICY_ISOLATE        else UNAUTHORIZED_ACTION
    2. mode           SIMULATION only (LIVE is not built)      else LIVE_MODE_DISABLED
    3. idempotency    a key already used returns its receipt  (no second execution)
    4. scope          the certificate belongs to this session and certifies this plan
    5. revision       certificate revision = current revision  else STALE_REVISION_REJECTED
    6. certificate    VALID (not expired, not superseded)      else MISSING_CERTIFICATE

An accepted request records a simulation receipt: no infrastructure is ever changed.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from typing import Any

from interdict.audit import AuditLog
from interdict.engine.planner import ACTION_TYPE
from interdict.engine.statuses import GatewayRejection
from interdict.session import Records, SessionKeys

RECEIPT_TTL_S = 24 * 60 * 60
IDEMPOTENCY_KEY = re.compile(r"^[A-Za-z0-9-]{8,64}$")
SIMULATION_NOTE = "Simulation only: no infrastructure is changed."


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def certificate_status(document: dict[str, Any], now: datetime, revision: int) -> str:
    """The lifecycle status of a stored certificate document (§9.4)."""
    if document["snapshot"]["sandbox_revision"] != revision:
        return "SUPERSEDED"
    if now >= _parse(document["expires_at"]):
        return "EXPIRED"
    return "VALID"


def submit_execution(
    *,
    keys: SessionKeys,
    records: Records,
    audit: AuditLog,
    revision: int,
    now: datetime,
    plan_id: str,
    certificate_id: str,
    execution_mode: str,
    idempotency_key: str,
    action_type: str = ACTION_TYPE,
) -> dict[str, Any]:
    def rejected(reason: GatewayRejection, detail: str) -> dict[str, Any]:
        event = audit.append(
            "GATEWAY_REJECTED",
            revision=revision,
            rejection=reason.value,
            plan_id=plan_id,
            certificate_id=certificate_id,
            execution_mode=execution_mode,
        )
        return {
            "status": "REJECTED",
            "rejection": reason.value,
            "detail": detail,
            "audit_event_hash": event["hash"],
        }

    if action_type != ACTION_TYPE:
        return rejected(
            GatewayRejection.UNAUTHORIZED_ACTION, f"{action_type} is not an allowlisted action"
        )
    if execution_mode != "SIMULATION":
        return rejected(
            GatewayRejection.LIVE_MODE_DISABLED, "only SIMULATION is accepted in this deployment"
        )
    if not IDEMPOTENCY_KEY.match(idempotency_key):
        return rejected(GatewayRejection.UNAUTHORIZED_ACTION, "invalid idempotency key")
    cached = records.get(keys.receipt(idempotency_key))
    if cached is not None:
        return {**cached, "duplicate": True}

    document = records.get(keys.certificate(certificate_id))
    if document is None or document["plan"]["plan_id"] != plan_id:
        return rejected(
            GatewayRejection.MISSING_CERTIFICATE,
            "no certificate of this session certifies this plan",
        )
    if document["snapshot"]["sandbox_revision"] != revision:
        return rejected(
            GatewayRejection.STALE_REVISION_REJECTED,
            f"certificate is for revision {document['snapshot']['sandbox_revision']}, "
            f"the sandbox is at revision {revision}",
        )
    if certificate_status(document, now, revision) != "VALID":
        return rejected(GatewayRejection.MISSING_CERTIFICATE, "the certificate has expired")

    receipt = {
        "status": "ACCEPTED",
        "receipt_id": f"rcpt-{uuid.uuid4().hex[:24]}",
        "execution_mode": "SIMULATION",
        "plan_id": plan_id,
        "certificate_id": certificate_id,
        "sandbox_revision": revision,
        "actions": document["plan"]["actions"],
        "recorded_at": now.astimezone(UTC).isoformat(timespec="seconds"),
        "note": SIMULATION_NOTE,
    }
    if not records.put_new(keys.receipt(idempotency_key), receipt, RECEIPT_TTL_S):
        return {**records.get(keys.receipt(idempotency_key)), "duplicate": True}
    event = audit.append(
        "GATEWAY_RECEIPT",
        revision=revision,
        receipt_id=receipt["receipt_id"],
        plan_id=plan_id,
        certificate_id=certificate_id,
        execution_mode="SIMULATION",
    )
    receipt["audit_event_hash"] = event["hash"]
    records.put(keys.receipt(idempotency_key), receipt, RECEIPT_TTL_S)
    return {**receipt, "duplicate": False}
