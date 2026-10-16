"""Small helpers for building directed test graphs in FalkorDB."""

from __future__ import annotations

from typing import Any

from falkordb.graph import Graph

from interdict.db import run

SETUP_TIMEOUT_MS = 30_000

MAX_FLOW = (
    "MATCH (s:N {id: $src}) MATCH (t:N) WHERE t.id IN $dst WITH s, collect(t) AS targets "
    "CALL algo.maxFlow({sourceNodes: [s], targetNodes: targets, capacityProperty: 'capacity', "
    "relationshipTypes: $types}) "
    "YIELD edges, edgeFlows, maxFlow "
    "RETURN maxFlow, [i IN range(0, size(edges) - 1) | "
    "[startNode(edges[i]).id, endNode(edges[i]).id, edgeFlows[i]]]"
)


def create_edges(graph: Graph, edges: list[tuple[str, str]], rel: str = "E") -> None:
    """Create :N nodes for every endpoint and one `rel` edge (capacity 1) per pair."""
    nodes = sorted({n for edge in edges for n in edge})
    run(
        graph,
        "test-nodes",
        "UNWIND $ids AS id CREATE (:N {id: id})",
        {"ids": nodes},
        timeout_ms=SETUP_TIMEOUT_MS,
    )
    run(graph, "test-index", "CREATE INDEX FOR (n:N) ON (n.id)", timeout_ms=SETUP_TIMEOUT_MS)
    run(
        graph,
        "test-edges",
        f"UNWIND $pairs AS p MATCH (a:N {{id: p[0]}}), (b:N {{id: p[1]}}) CREATE (a)-[:{rel} {{capacity: 1}}]->(b)",
        {"pairs": [list(e) for e in edges]},
        timeout_ms=SETUP_TIMEOUT_MS,
    )


def max_flow(
    graph: Graph, src: str, dst: list[str], types: list[str] | None = None
) -> tuple[float, list[Any]]:
    row = run(
        graph,
        "test-maxflow",
        MAX_FLOW,
        {"src": src, "dst": dst, "types": types or ["E"]},
        timeout_ms=SETUP_TIMEOUT_MS,
        read_only=True,
    ).result_set[0]
    return row[0], row[1]
