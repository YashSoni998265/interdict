"""Canonical graph export and snapshot hash (solution.md §9.3, Q-H1/Q-H2).

Certificates bind to two hashes: the sandbox as the plan was computed on, and the candidate
graph after the plan. Both are SHA-256 over a canonical serialisation:

    nodes sorted by id, each [id, sorted labels, properties with sorted keys]
    edges sorted by (source id, type, target id, properties), excluding derived ATTACK_STEP

Reads are paged well below RESULTSET_SIZE (D-16 a) with a total order, so pages can neither
repeat nor skip a row. A missing or duplicate node or edge id aborts the export: a hash over an
ambiguous graph would not identify what was verified. Timestamps are already stored as UTC
ISO-8601 strings by the generator, the collector and the sandbox operations.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from dataclasses import dataclass
from typing import Any

from interdict.db import run
from interdict.graphstore import GraphStore

PAGE = 5_000
TIMEOUT_MS = 5_000
DERIVED_TYPES = ("ATTACK_STEP",)

Q_NODES = (  # Q-H1
    "MATCH (n) RETURN n.id AS id, labels(n) AS labels, properties(n) AS props "
    "ORDER BY id SKIP $skip LIMIT $page"
)
Q_EDGES = (  # Q-H2
    "MATCH (a)-[r]->(b) WHERE NOT type(r) IN $derived "
    "RETURN a.id AS src, type(r) AS type, b.id AS dst, r.id AS rid, properties(r) AS props "
    "ORDER BY src, type, dst, rid SKIP $skip LIMIT $page"
)


class SnapshotError(RuntimeError):
    """The graph cannot be hashed unambiguously (a missing or duplicate id)."""


@dataclass(frozen=True)
class GraphExport:
    nodes: list[list[Any]]  # [id, sorted labels, properties]
    edges: list[list[Any]]  # [source id, type, target id, properties]


@dataclass(frozen=True)
class SnapshotDigest:
    hash: str  # "sha256:<hex>"
    nodes: int
    edges: int


def _paged(store: GraphStore, name: str, template: str, query: str, **params: Any) -> list[list]:
    rows: list[list] = []
    skip = 0
    while True:
        page = run(
            store.graph(name),
            template,
            query,
            {**params, "skip": skip, "page": PAGE},
            timeout_ms=TIMEOUT_MS,
            read_only=True,
            row_limit=PAGE + 1,
        ).result_set
        rows.extend(page)
        if len(page) < PAGE:
            return rows
        skip += PAGE


def export_graph(store: GraphStore, name: str) -> GraphExport:
    """Every node and every non-derived edge of graph `name`, canonically ordered."""
    nodes = [
        [row[0], sorted(row[1]), dict(row[2])]
        for row in _paged(store, name, "snapshot-nodes", Q_NODES)
    ]
    edges = [
        [row[0], row[1], row[2], dict(row[4])]
        for row in _paged(store, name, "snapshot-edges", Q_EDGES, derived=list(DERIVED_TYPES))
    ]
    _check_ids("node", [n[0] for n in nodes])
    _check_ids("edge", [e[3].get("id") for e in edges])
    edges.sort(key=lambda e: (e[0], e[1], e[2], _canonical(e[3])))
    return GraphExport(nodes, edges)


def _check_ids(kind: str, ids: list[Any]) -> None:
    if any(not isinstance(i, str) or not i for i in ids):
        raise SnapshotError(f"a {kind} has no id")
    duplicates = sorted(i for i, n in Counter(ids).items() if n > 1)
    if duplicates:
        raise SnapshotError(f"duplicate {kind} ids: {', '.join(duplicates[:5])}")


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(export: GraphExport) -> SnapshotDigest:
    hasher = hashlib.sha256()
    for record in (*export.nodes, *export.edges):
        hasher.update(_canonical(record).encode())
        hasher.update(b"\n")
    return SnapshotDigest(f"sha256:{hasher.hexdigest()}", len(export.nodes), len(export.edges))


def snapshot_hash(store: GraphStore, name: str) -> SnapshotDigest:
    return digest(export_graph(store, name))
