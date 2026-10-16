"""Model-verified containment certificate (solution.md §9).

A certificate says one thing: under threat model ITM-1, on the hashed snapshot, after the listed
candidate policies, no modelled chain reaches the crown jewels in T_scope, and three methods
agreed on that. It is never a claim of real-world containment. It expires with its evidence
(at most 24 hours) and is superseded by any change to the sandbox.
"""

from __future__ import annotations

import hashlib
import json
import os
import uuid
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from typing import Any

from interdict.engine.attackgraph import MAX_LATERAL_HOPS
from interdict.engine.evidence import EvidenceSnapshot
from interdict.engine.planner import MAX_PLAN_ACTIONS, Plan
from interdict.engine.sandbox import iso
from interdict.engine.statuses import CertificateStatus

CLAIM = "MODEL_VERIFIED_CONTAINMENT"
THREAT_MODEL = "ITM-1"
MAX_VALIDITY = timedelta(hours=24)
RETENTION_MS = 24 * 60 * 60 * 1000
RELATIONSHIP_TYPES = (
    "EXPOSES",
    "ROUTES_TO",
    "TARGETS",
    "RUNS_IMAGE",
    "HAS_VULNERABILITY",
    "CAN_REACH",
    "ASSUMES_ROLE",
    "GRANTS_ACCESS",
    "APPLIES_TO",
    "SELECTS",
    "ALLOWS_EGRESS",
)
EXCLUSIONS = (
    "Model-verified only under ITM-1 on the hashed snapshot; not evidence of real-world "
    "containment; enforcement depends on the cluster's network plugin; the environment and its "
    "dependency manifests are synthetic. Not modelled: credential theft, application-layer "
    "vectors without a network vector, node/host/loopback traffic, egress exfiltration, IAM "
    "Deny/conditions/SCPs, supply chain, zero-days, ingress policies. The oracle re-checks "
    "reachability over the same derived ATTACK_STEP edges as max-flow (D-14), so it does not "
    "independently re-derive the threat model (RSK-16)."
)


def _ts(value: str | None) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def earliest_valid_until(snapshot: EvidenceSnapshot) -> datetime | None:
    """The first moment any evidence the verdict rests on goes stale."""
    provenance = [
        *(p for e in snapshot.exposures for p in e.evidence),
        *(p for v in snapshot.vulnerabilities for p in v.evidence),
        *(r.evidence for r in snapshot.reach),
        *(p for g in snapshot.grants for p in g.evidence),
    ]
    times = [t for t in (_ts(p.valid_until) for p in provenance) if t is not None]
    return min(times) if times else None


@dataclass(frozen=True)
class Certificate:
    certificate_id: str
    issued_at: datetime
    expires_at: datetime
    evaluation_time: datetime
    sandbox_graph_key: str
    sandbox_revision: int
    baseline_snapshot_hash: str
    candidate_graph_key: str
    candidate_snapshot_hash: str
    t_scope: tuple[str, ...]
    max_hunt_rounds: int
    missing_attack_vector_count: int
    completeness: dict[str, Any]
    earliest_valid_until: datetime
    plan: dict[str, Any]
    verification: dict[str, Any]
    provenance: dict[str, Any] = field(default_factory=dict)

    def to_dict(self, status: CertificateStatus = CertificateStatus.VALID) -> dict[str, Any]:
        """The certificate document in the §9.2 schema."""
        return {
            "certificate_id": self.certificate_id,
            "claim": CLAIM,
            "status": status.value,
            "issued_at": iso(self.issued_at),
            "expires_at": iso(self.expires_at),
            "evaluation_time": iso(self.evaluation_time),
            "snapshot": {
                "sandbox_graph_key": self.sandbox_graph_key,
                "sandbox_revision": self.sandbox_revision,
                "baseline_snapshot_hash": self.baseline_snapshot_hash,
                "candidate_graph_key": self.candidate_graph_key,
                "candidate_snapshot_hash": self.candidate_snapshot_hash,
            },
            "threat_model": {
                "id": THREAT_MODEL,
                "constants": {
                    "max_lateral_hops_planner": MAX_LATERAL_HOPS,
                    "max_plan_actions": MAX_PLAN_ACTIONS,
                    "max_hunt_rounds": self.max_hunt_rounds,
                },
                "relationship_types": list(RELATIONSHIP_TYPES),
                "t_scope": list(self.t_scope),
                "over_approximations": {
                    "missing_attack_vector_count": self.missing_attack_vector_count,
                    "ingress_policies_ignored": True,
                },
            },
            "evidence": {
                "completeness": self.completeness,
                "freshness": {
                    "earliest_valid_until": iso(self.earliest_valid_until),
                    "stale_items": 0,
                    "unverified_items": 0,
                },
            },
            "plan": self.plan,
            "verification": self.verification,
            "provenance": self.provenance,
            "exclusions": EXCLUSIONS,
        }

    def digest(self) -> str:
        """SHA-256 of the canonical document, excluding the audit hash that records it."""
        document = self.to_dict()
        document["provenance"] = {
            k: v for k, v in document["provenance"].items() if k != "audit_event_hash"
        }
        canonical = json.dumps(document, sort_keys=True, separators=(",", ":"))
        return "sha256:" + hashlib.sha256(canonical.encode()).hexdigest()

    def with_audit(self, event_hash: str) -> Certificate:
        return replace(self, provenance={**self.provenance, "audit_event_hash": event_hash})


def new_certificate_id() -> str:
    return f"cert-{uuid.uuid4().hex}"


def build_certificate(
    *,
    certificate_id: str,
    now: datetime,
    sandbox: str,
    revision: int,
    baseline_hash: str,
    candidate_key: str,
    candidate_hash: str,
    t_scope: tuple[str, ...],
    max_rounds: int,
    snapshot: EvidenceSnapshot,
    plan: Plan,
    optimality: str,
    verification: dict[str, Any],
    falkordb_version: str,
    oracle_version: str,
) -> Certificate:
    """Assemble a certificate once every §9.1 condition has been checked by the caller."""
    earliest = earliest_valid_until(snapshot)
    if earliest is None or earliest <= now:
        raise ValueError("a certificate needs evidence that is still fresh")
    tiers = {name: tier.status.value for name, tier in sorted(snapshot.scope.tiers.items())}
    return Certificate(
        certificate_id=certificate_id,
        issued_at=now,
        expires_at=min(earliest, now + MAX_VALIDITY),
        evaluation_time=now,
        sandbox_graph_key=sandbox,
        sandbox_revision=revision,
        baseline_snapshot_hash=baseline_hash,
        candidate_graph_key=candidate_key,
        candidate_snapshot_hash=candidate_hash,
        t_scope=t_scope,
        max_hunt_rounds=max_rounds,
        missing_attack_vector_count=sum(
            1 for v in snapshot.vulnerabilities if v.attack_vector is None
        ),
        completeness={**tiers, "inventory_complete": snapshot.meta.get("inventory_complete")},
        earliest_valid_until=earliest,
        plan={
            "plan_id": plan.id,
            "actions": [a.policy_spec() for a in plan.actions],
            "optimality": optimality,
            "impact_status": plan.impact_status.value,
            "known_broken": sorted(plan.known_broken),
            "unknown_impact": sorted(plan.unknown),
        },
        verification=verification,
        provenance={
            "engine_git_sha": os.environ.get("INTERDICT_GIT_SHA", "unknown"),
            "falkordb_version": falkordb_version,
            "oracle_version": oracle_version,
            "audit_event_hash": None,
        },
    )


def certificate_status(
    certificate: Certificate, now: datetime, current_revision: int
) -> CertificateStatus:
    """VALID until the sandbox changes (SUPERSEDED) or the evidence ages out (EXPIRED)."""
    if current_revision != certificate.sandbox_revision:
        return CertificateStatus.SUPERSEDED
    if now >= certificate.expires_at:
        return CertificateStatus.EXPIRED
    return CertificateStatus.VALID
