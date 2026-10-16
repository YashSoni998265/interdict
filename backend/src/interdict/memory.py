"""Investigation memory (D-17, FR-18, TC-41): what this session has learned, recalled first.

`memory:{session}` holds one dated `Plan` node per finished hunt, the `Certificate` it earned (if
any) and the crown-jewel `Asset` nodes it protects. It stores conclusions and their provenance
(sandbox revision, time, chains), never evidence: a recalled entry is a starting point that must
be re-verified, and the agent says when an answer came from memory and when it was learned.

Memory can never break a run: any failure to write is swallowed and reported, and recall then
answers UNAVAILABLE.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any

from interdict.db import QueryFailedError, run
from interdict.engine.hunter import HuntReport
from interdict.engine.sandbox import iso
from interdict.graphstore import GraphStore

log = logging.getLogger(__name__)

RETENTION_MS = 7 * 24 * 60 * 60 * 1000
TIMEOUT_MS = 2_000

Q_RECORD = (
    "CREATE (p:Plan {id: $id, plan_id: $plan_id, created_at: $created_at, status: $status, "
    "reason: $reason, actions: $actions, impact_status: $impact_status, optimality: $optimality, "
    "t_scope: $t_scope, sandbox_revision: $revision, cluster_id: $cluster_id, rounds: $rounds, "
    "chains: $chains, certificate_id: $certificate_id}) "
    "WITH p UNWIND $t_scope AS asset MERGE (a:Asset {id: asset}) CREATE (p)-[:PROTECTS]->(a)"
)
Q_CERTIFY = (
    "MATCH (p:Plan {id: $id}) "
    "CREATE (p)-[:CERTIFIED_BY]->(:Certificate {id: $certificate_id, issued_at: $issued_at, "
    "expires_at: $expires_at, digest: $digest, sandbox_revision: $revision})"
)
Q_RECALL = (
    "MATCH (a:Asset) WHERE a.id IN $assets MATCH (p:Plan)-[:PROTECTS]->(a) "
    "WITH DISTINCT p OPTIONAL MATCH (p)-[:CERTIFIED_BY]->(c:Certificate) "
    "RETURN properties(p), properties(c) ORDER BY p.created_at DESC LIMIT $limit"
)


class Memory:
    def __init__(self, store: GraphStore, name: str) -> None:
        self.store = store
        self.name = name

    def record(self, report: HuntReport, *, cluster_id: str | None, now: datetime) -> bool:
        """Remember a finished hunt. Returns False (and logs) instead of raising."""
        plan_report = report.plan
        plan = plan_report.plan if plan_report else None
        node_id = f"mem-{uuid.uuid4().hex[:16]}"
        try:
            graph = self.store.graph(self.name)
            run(
                graph,
                "memory-record",
                Q_RECORD,
                {
                    "id": node_id,
                    "plan_id": plan.id if plan else None,
                    "created_at": iso(now),
                    "status": report.status.value,
                    "reason": report.reason,
                    "actions": list(plan.action_ids) if plan else [],
                    "impact_status": plan.impact_status.value if plan else None,
                    "optimality": (
                        plan_report.solution.optimality.value
                        if plan_report and plan_report.solution and plan_report.solution.optimality
                        else None
                    ),
                    "t_scope": list(report.t_scope),
                    "revision": report.revision,
                    "cluster_id": cluster_id,
                    "rounds": len(report.rounds),
                    "chains": [c.id for c in report.chains],
                    "certificate_id": (
                        report.certificate.certificate_id if report.certificate else None
                    ),
                },
                timeout_ms=TIMEOUT_MS,
            )
            if report.certificate:
                certificate = report.certificate
                run(
                    graph,
                    "memory-certify",
                    Q_CERTIFY,
                    {
                        "id": node_id,
                        "certificate_id": certificate.certificate_id,
                        "issued_at": iso(certificate.issued_at),
                        "expires_at": iso(certificate.expires_at),
                        "digest": certificate.digest(),
                        "revision": certificate.sandbox_revision,
                    },
                    timeout_ms=TIMEOUT_MS,
                )
            self.store.expire(self.name, RETENTION_MS)
            return True
        except Exception:  # memory must never break a run (TC-41)
            log.exception("memory write failed for %s", self.name)
            return False

    def recall(self, asset_ids: list[str], *, limit: int = 5) -> dict[str, Any]:
        """Most recent entries for these assets, newest first; UNAVAILABLE on any failure."""
        try:
            if not self.store.exists(self.name):
                return {"status": "AVAILABLE", "entries": [], "note": "nothing learned yet"}
            rows = run(
                self.store.graph(self.name),
                "memory-recall",
                Q_RECALL,
                {"assets": sorted(set(asset_ids)), "limit": limit},
                timeout_ms=TIMEOUT_MS,
                read_only=True,
            ).result_set
        except QueryFailedError as exc:
            return {"status": "UNAVAILABLE", "reason": exc.reason, "entries": []}
        except Exception as exc:
            return {"status": "UNAVAILABLE", "reason": str(exc), "entries": []}
        entries = []
        for plan, certificate in rows:
            plan = dict(plan)
            entries.append(
                {
                    "learned_at": plan["created_at"],
                    "plan_id": plan.get("plan_id"),
                    "status": plan["status"],
                    "reason": plan.get("reason"),
                    "t_scope": list(plan.get("t_scope") or []),
                    "cluster_id": plan.get("cluster_id"),
                    "actions": list(plan.get("actions") or []),
                    "impact_status": plan.get("impact_status"),
                    "sandbox_revision": plan.get("sandbox_revision"),
                    "chains": list(plan.get("chains") or []),
                    "rounds": plan.get("rounds"),
                    "certificate": dict(certificate) if certificate else None,
                }
            )
        return {"status": "AVAILABLE", "entries": entries}
