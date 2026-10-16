"""Typed sandbox operations a visitor can run from the web session (§10.7, D-12).

Never callable by the LLM: the MCP server registers no tool for them. Each operation validates
its typed inputs (ID pattern, existence, policy), then changes the sandbox in one query that also
compare-and-sets the revision (D-03). A new revision makes every certificate of the sandbox
SUPERSEDED and every derived ATTACK_STEP edge stale, so the next triage recomputes from evidence.
Changes are stamped as `SANDBOX_USER_CHANGE` evidence, fresh for two hours.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from interdict.db import run
from interdict.engine.evidence import allowed_flows, collect_evidence
from interdict.engine.sandbox import ConcurrentModificationError, iso, mutate, read_revision
from interdict.engine.statuses import SandboxOpResult
from interdict.graphstore import GraphStore

USER_SOURCE = "SANDBOX_USER_CHANGE"
USER_TTL = timedelta(hours=2)
MAX_OPERATIONS = 20
OPERATIONS = ("EXPOSE_WORKLOAD", "ADD_LATERAL_REACH", "EXPIRE_EVIDENCE")
ID = re.compile(r"^[a-z0-9-]{1,64}$")
EDGE_REF = re.compile(r"^[A-Za-z0-9-]{1,128}$")
TIMEOUT_MS = 5_000

_PROVENANCE = (
    "evidence_source: 'SANDBOX_USER_CHANGE', collector: 'sandbox-operation', "
    "observed_at: $now, valid_until: $until, verified: true"
)


@dataclass(frozen=True)
class OperationResult:
    op: str
    result: SandboxOpResult
    revision: int
    detail: str
    args: dict[str, Any] = field(default_factory=dict)

    @property
    def applied(self) -> bool:
        return self.result == SandboxOpResult.APPLIED


def _rows(store: GraphStore, sandbox: str, template: str, query: str, **params: Any) -> list:
    return run(
        store.graph(sandbox), template, query, params, timeout_ms=TIMEOUT_MS, read_only=True
    ).result_set


def apply_operation(
    store: GraphStore, sandbox: str, op: str, args: dict[str, Any], now: datetime
) -> OperationResult:
    """Validate and apply one operation. Rejections are results, not exceptions."""
    revision = read_revision(store, sandbox)

    def reject(result: SandboxOpResult, detail: str) -> OperationResult:
        return OperationResult(op, result, revision, detail, args)

    stamp = {"now": iso(now), "until": iso(now + USER_TTL)}
    try:
        if op == "EXPOSE_WORKLOAD":
            pod = args.get("pod_id")
            if not isinstance(pod, str) or not ID.match(pod) or set(args) != {"pod_id"}:
                return reject(SandboxOpResult.REJECTED_VALIDATION, "expected {pod_id}")
            services = _rows(
                store,
                sandbox,
                "op-expose-service",
                "MATCH (svc:Service)-[:TARGETS]->(p:Pod {id: $pod}) RETURN svc.id",
                pod=pod,
            )
            if not services:
                return reject(
                    SandboxOpResult.REJECTED_VALIDATION, f"{pod} is not a pod behind a Service"
                )
            ingress = _rows(
                store, sandbox, "op-expose-ingress", "MATCH (i:Ingress {default: true}) RETURN i.id"
            )
            if not ingress:
                return reject(SandboxOpResult.REJECTED_VALIDATION, "no default ingress")
            service, ingress_id = services[0][0], ingress[0][0]
            routed = _rows(
                store,
                sandbox,
                "op-expose-existing",
                "MATCH (i:Ingress)-[:ROUTES_TO]->(:Service {id: $service}) RETURN i.id",
                service=service,
            )
            if routed:
                return reject(
                    SandboxOpResult.REJECTED_VALIDATION,
                    f"{pod} is already exposed via {routed[0][0]}",
                )
            new = mutate(
                store,
                sandbox,
                revision,
                "op-expose-workload",
                "MATCH (i:Ingress {id: $ingress}), (svc:Service {id: $service}) "
                f"CREATE (i)-[:ROUTES_TO {{id: $edge_id, {_PROVENANCE}}}]->(svc) WITH m",
                {
                    "ingress": ingress_id,
                    "service": service,
                    "edge_id": f"ev-routes-{ingress_id}-{service}-user",
                    **stamp,
                },
            )
            return OperationResult(
                op,
                SandboxOpResult.APPLIED,
                new,
                f"{pod} is now reachable from the Internet via {ingress_id} -> {service}",
                args,
            )

        if op == "ADD_LATERAL_REACH":
            src, dst, port = args.get("src_pod_id"), args.get("dst_pod_id"), args.get("port")
            if (
                set(args) != {"src_pod_id", "dst_pod_id", "port"}
                or not isinstance(src, str)
                or not isinstance(dst, str)
                or not ID.match(src)
                or not ID.match(dst)
                or not isinstance(port, int)
                or isinstance(port, bool)
                or not 1 <= port <= 65_535
            ):
                return reject(
                    SandboxOpResult.REJECTED_VALIDATION,
                    "expected {src_pod_id, dst_pod_id, port 1-65535}",
                )
            if src == dst:
                return reject(SandboxOpResult.REJECTED_VALIDATION, "pods must differ")
            found = _rows(
                store,
                sandbox,
                "op-reach-pods",
                "MATCH (p:Pod) WHERE p.id IN [$src, $dst] RETURN p.id",
                src=src,
                dst=dst,
            )
            if {r[0] for r in found} != {src, dst}:
                return reject(SandboxOpResult.REJECTED_VALIDATION, "unknown pod id")
            existing = _rows(
                store,
                sandbox,
                "op-reach-existing",
                "MATCH (:Pod {id: $src})-[c:CAN_REACH]->(:Pod {id: $dst}) "
                "WHERE c.port = $port AND c.protocol = 'TCP' RETURN c.id",
                src=src,
                dst=dst,
                port=port,
            )
            if existing:
                return reject(
                    SandboxOpResult.REJECTED_VALIDATION, f"{src} already reaches {dst}:{port}"
                )
            policies = collect_evidence(store, sandbox, now).policies
            allowed = allowed_flows(src, policies)
            if allowed is not None and (dst, port, "TCP") not in allowed:
                return reject(
                    SandboxOpResult.REJECTED_CONTRADICTS_POLICY,
                    f"the egress policies selecting {src} do not allow {dst}:{port}/TCP",
                )
            new = mutate(
                store,
                sandbox,
                revision,
                "op-add-lateral-reach",
                "MATCH (a:Pod {id: $src}), (b:Pod {id: $dst}) "
                "CREATE (a)-[:CAN_REACH {id: $edge_id, port: $port, protocol: 'TCP', "
                f"{_PROVENANCE}}}]->(b) WITH m",
                {
                    "src": src,
                    "dst": dst,
                    "port": port,
                    "edge_id": f"ev-reach-{src}-{dst}-{port}-tcp",
                    **stamp,
                },
            )
            return OperationResult(
                op, SandboxOpResult.APPLIED, new, f"{src} can now reach {dst}:{port}/TCP", args
            )

        if op == "EXPIRE_EVIDENCE":
            ref = args.get("edge_ref")
            if set(args) != {"edge_ref"} or not isinstance(ref, str) or not EDGE_REF.match(ref):
                return reject(SandboxOpResult.REJECTED_VALIDATION, "expected {edge_ref}")
            found = _rows(
                store,
                sandbox,
                "op-expire-find",
                "MATCH ()-[e]->() WHERE e.id = $ref AND e.evidence_source IS NOT NULL "
                "AND type(e) <> 'ATTACK_STEP' RETURN type(e)",
                ref=ref,
            )
            if not found:
                return reject(SandboxOpResult.REJECTED_VALIDATION, f"{ref} is not an evidence edge")
            new = mutate(
                store,
                sandbox,
                revision,
                "op-expire-evidence",
                "MATCH ()-[e]->() WHERE e.id = $ref SET e.valid_until = $past WITH m",
                {"ref": ref, "past": iso(now - timedelta(minutes=1))},
            )
            return OperationResult(
                op,
                SandboxOpResult.APPLIED,
                new,
                f"{ref} ({found[0][0]}) is now past its valid_until",
                args,
            )
    except ConcurrentModificationError as exc:
        return reject(SandboxOpResult.REJECTED_VALIDATION, f"concurrent modification: {exc}")
    return reject(SandboxOpResult.REJECTED_VALIDATION, f"unknown operation {op!r}")
