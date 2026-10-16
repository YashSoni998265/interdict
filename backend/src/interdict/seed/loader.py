"""Write a generated environment into a FalkorDB graph (issue #6, solution.md §5.1, §5.7, §12.1).

The environment is built in a staging graph, verified (counts, unique ids, unique
constraints), then swapped into place with one copy under the global copy lock, so no
sandbox can ever copy a half-built `template`. Re-running with the same seed, generator
version and alert count is a no-op.
"""

from __future__ import annotations

import re
import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from falkordb.graph import Graph

from interdict.db import QueryFailedError, run
from interdict.graphstore import GraphStore
from interdict.seed.model import Environment

BATCH_SIZE = 500
TIMEOUT_MS = 30_000
_IDENTIFIER = re.compile(r"^[A-Za-z][A-Za-z_]*$")


class LoadError(RuntimeError):
    """The environment could not be written or did not verify."""


@dataclass(frozen=True)
class LoadResult:
    graph: str
    skipped: bool
    nodes: int
    edges: int
    seconds: float


def _identifier(name: str) -> str:
    """Labels and relationship types cannot be query parameters, so only safe names pass."""
    if not _IDENTIFIER.fullmatch(name):
        raise LoadError(f"unsafe label or relationship type: {name!r}")
    return name


def read_meta(store: GraphStore, name: str) -> dict[str, Any] | None:
    if not store.exists(name):
        return None
    rows = run(
        store.graph(name),
        "seed-meta",
        "MATCH (m:Meta {id: 'meta'}) RETURN properties(m)",
        timeout_ms=TIMEOUT_MS,
        read_only=True,
    ).result_set
    return dict(rows[0][0]) if rows else None


def load(
    store: GraphStore,
    env: Environment,
    name: str = "template",
    *,
    replace: bool = False,
    row_limit: int = 100_000,
) -> LoadResult:
    started = time.perf_counter()
    meta = env.node("meta").props
    summary = env.summary()
    totals = (sum(summary["nodes"].values()), sum(summary["edges"].values()))

    existing = read_meta(store, name)
    same = existing is not None and all(
        existing.get(key) == meta[key] for key in ("seed", "generator_version", "alert_count")
    )
    if same and not replace:
        return LoadResult(name, True, *totals, time.perf_counter() - started)

    staging = f"{name}:next"
    store.delete(staging)
    graph = store.graph(staging)
    try:
        _create_indexes(graph, env)
        _write_nodes(graph, env)
        _write_edges(graph, env)
        _create_unique_constraints(graph, env)
        problems = verify(graph, env, row_limit=row_limit)
        if problems:
            raise LoadError("loaded graph does not match the environment: " + "; ".join(problems))
        store.copy(staging, name, replace=True)
    finally:
        store.delete(staging)
    return LoadResult(name, False, *totals, time.perf_counter() - started)


def _chunks(rows: list[Any]) -> list[list[Any]]:
    return [rows[i : i + BATCH_SIZE] for i in range(0, len(rows), BATCH_SIZE)]


def _create_indexes(graph: Graph, env: Environment) -> None:
    for label in sorted({n.label for n in env.nodes}):
        run(
            graph,
            "seed-index",
            f"CREATE INDEX FOR (n:{_identifier(label)}) ON (n.id)",
            timeout_ms=TIMEOUT_MS,
        )
    for rel in sorted({e.type for e in env.edges}):
        run(
            graph,
            "seed-index",
            f"CREATE INDEX FOR ()-[e:{_identifier(rel)}]-() ON (e.id)",
            timeout_ms=TIMEOUT_MS,
        )


def _write_nodes(graph: Graph, env: Environment) -> None:
    by_label: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for node in env.nodes:
        by_label[node.label].append(node.props)
    for label, rows in by_label.items():
        query = f"UNWIND $rows AS r CREATE (n:{_identifier(label)}) SET n = r"
        for chunk in _chunks(rows):
            created = run(
                graph, f"seed-nodes-{label}", query, {"rows": chunk}, timeout_ms=TIMEOUT_MS
            )
            if created.nodes_created != len(chunk):
                raise LoadError(f"{label}: created {created.nodes_created} of {len(chunk)} nodes")


def _write_edges(graph: Graph, env: Environment) -> None:
    groups: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for edge in env.edges:
        groups[(edge.type, edge.src_label, edge.dst_label)].append(
            {"src": edge.src, "dst": edge.dst, "props": edge.props}
        )
    for (rel, src_label, dst_label), rows in groups.items():
        query = (
            f"UNWIND $rows AS r "
            f"MATCH (a:{_identifier(src_label)} {{id: r.src}}), (b:{_identifier(dst_label)} {{id: r.dst}}) "
            f"CREATE (a)-[e:{_identifier(rel)}]->(b) SET e = r.props"
        )
        for chunk in _chunks(rows):
            created = run(graph, f"seed-edges-{rel}", query, {"rows": chunk}, timeout_ms=TIMEOUT_MS)
            if created.relationships_created != len(chunk):
                raise LoadError(
                    f"{rel} {src_label}->{dst_label}: created {created.relationships_created} of {len(chunk)} edges"
                )


def _create_unique_constraints(graph: Graph, env: Environment) -> None:
    """Unique `id` per label; FalkorDB builds constraints asynchronously, so wait for them."""
    for label in sorted({n.label for n in env.nodes}):
        graph.create_node_unique_constraint(_identifier(label), "id")
    deadline = time.monotonic() + 30
    while True:
        statuses = [
            row[0]
            for row in run(
                graph,
                "seed-constraints",
                "CALL db.constraints() YIELD status RETURN status",
                timeout_ms=TIMEOUT_MS,
            ).result_set
        ]
        if statuses and all(s == "OPERATIONAL" for s in statuses):
            return
        if "FAILED" in statuses:
            raise LoadError("a unique constraint failed: duplicate ids in the environment")
        if time.monotonic() >= deadline:
            raise LoadError(f"unique constraints not operational in time: {statuses}")
        time.sleep(0.05)


def verify(graph: Graph, env: Environment, *, row_limit: int = 100_000) -> list[str]:
    """Compare a loaded graph with the environment it came from."""
    problems: list[str] = []
    summary = env.summary()
    try:
        for label, expected in summary["nodes"].items():
            got = run(
                graph,
                "seed-verify",
                f"MATCH (n:{_identifier(label)}) RETURN count(n)",
                timeout_ms=TIMEOUT_MS,
            ).result_set[0][0]
            if got != expected:
                problems.append(f"{label}: {got} nodes, expected {expected}")
        for rel, expected in summary["edges"].items():
            got = run(
                graph,
                "seed-verify",
                f"MATCH ()-[e:{_identifier(rel)}]->() RETURN count(e)",
                timeout_ms=TIMEOUT_MS,
            ).result_set[0][0]
            if got != expected:
                problems.append(f"{rel}: {got} edges, expected {expected}")
        for what, pattern in (("node", "(n)"), ("edge", "()-[n]->()")):
            duplicates = run(
                graph,
                "seed-verify-unique",
                f"MATCH {pattern} WITH n.id AS id, count(*) AS c WHERE c > 1 RETURN id LIMIT 5",
                timeout_ms=TIMEOUT_MS,
                row_limit=row_limit,
            ).result_set
            if duplicates:
                problems.append(f"duplicate {what} ids: {[d[0] for d in duplicates]}")
    except QueryFailedError as exc:
        problems.append(f"verification query failed: {exc}")
    return problems
