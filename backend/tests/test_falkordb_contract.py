"""FalkorDB behaviours the design relies on, measured by the Day-1 gates (solution.md §17).

Some tests pin quirks on purpose (silent truncation, max-flow erroring on an absent
relationship type, outgoing-only BFS, copy refusing an existing destination). If a
FalkorDB upgrade changes one of them, these tests fail and the engine rule built on
top of it must be revisited.
"""

from __future__ import annotations

import random
from concurrent.futures import ThreadPoolExecutor

import pytest
import redis
from falkordb import FalkorDB
from falkordb.graph import Graph

from graph_helpers import SETUP_TIMEOUT_MS, create_edges, max_flow
from interdict.db import QueryFailedError, run
from interdict_oracle.reachability import reachable_targets


def test_traversal_query_times_out_and_raises_query_failed(graph: Graph) -> None:
    run(
        graph, "setup", "UNWIND range(1, 2000) AS i CREATE (:P {i: i})", timeout_ms=SETUP_TIMEOUT_MS
    )
    with pytest.raises(QueryFailedError, match="timed out"):
        run(
            graph,
            "slow",
            "MATCH (a:P), (b:P), (c:P) RETURN count(*)",
            timeout_ms=50,
            read_only=True,
        )


def test_timed_out_write_is_rolled_back(graph: Graph) -> None:
    run(graph, "setup", "CREATE (:Probe)", timeout_ms=SETUP_TIMEOUT_MS)
    with pytest.raises(QueryFailedError, match="timed out"):
        run(graph, "slow-write", "UNWIND range(1, 50000000) AS x CREATE (:T {x: x})", timeout_ms=50)
    count = run(
        graph, "count", "MATCH (n:T) RETURN count(n)", timeout_ms=SETUP_TIMEOUT_MS
    ).result_set[0][0]
    assert count == 0


def test_run_rejects_results_that_reach_the_row_limit(graph: Graph) -> None:
    """FalkorDB truncates results at RESULTSET_SIZE without an error, so run() must not trust a full result."""
    run(graph, "setup", "CREATE (:Probe)", timeout_ms=SETUP_TIMEOUT_MS)
    rows = run(
        graph,
        "under",
        "UNWIND range(1, 9) AS x RETURN x",
        timeout_ms=SETUP_TIMEOUT_MS,
        row_limit=10,
    )
    assert len(rows.result_set) == 9
    with pytest.raises(QueryFailedError, match="may be truncated"):
        run(
            graph,
            "at-limit",
            "UNWIND range(1, 10) AS x RETURN x",
            timeout_ms=SETUP_TIMEOUT_MS,
            row_limit=10,
        )


def test_server_truncates_large_results_silently(graph: Graph, settings) -> None:
    run(graph, "setup", "CREATE (:Probe)", timeout_ms=SETUP_TIMEOUT_MS)
    n = settings.resultset_size + 10
    rows = run(
        graph, "big", "UNWIND range(1, $n) AS x RETURN x", {"n": n}, timeout_ms=SETUP_TIMEOUT_MS
    ).result_set
    assert len(rows) == settings.resultset_size


def test_revision_compare_and_set_has_a_single_winner(graph: Graph) -> None:
    """Database-level basis for D-03 / TC-42: one query mutates and bumps the revision atomically."""
    run(graph, "setup", "CREATE (:Meta {id: 'meta', revision: 1})", timeout_ms=SETUP_TIMEOUT_MS)
    cas = (
        "MATCH (m:Meta {id: 'meta'}) WHERE m.revision = $expected "
        "SET m.revision = m.revision + 1 RETURN m.revision"
    )

    def attempt(_: int) -> int:
        return len(run(graph, "cas", cas, {"expected": 1}, timeout_ms=SETUP_TIMEOUT_MS).result_set)

    with ThreadPoolExecutor(max_workers=20) as pool:
        winners = sum(pool.map(attempt, range(20)))
    final = run(
        graph, "read", "MATCH (m:Meta) RETURN m.revision", timeout_ms=SETUP_TIMEOUT_MS
    ).result_set[0][0]
    assert (winners, final) == (1, 2)


def test_graph_copy_preserves_contents_and_indexes(db: FalkorDB, graph: Graph) -> None:
    create_edges(graph, [("a", "b"), ("b", "c")])
    clone_name = f"{graph.name}:copy"
    graph.copy(clone_name)
    clone = db.select_graph(clone_name)
    try:
        counts = "MATCH (n) WITH count(n) AS n MATCH ()-[r]->() RETURN n, count(r)"
        assert run(clone, "counts", counts, timeout_ms=SETUP_TIMEOUT_MS).result_set[0] == [3, 2]
        indexes = run(
            clone,
            "indexes",
            "CALL db.indexes() YIELD label RETURN label",
            timeout_ms=SETUP_TIMEOUT_MS,
        ).result_set
        assert ["N"] in indexes
    finally:
        clone.delete()


def test_graph_copy_refuses_an_existing_destination(db: FalkorDB, graph: Graph) -> None:
    create_edges(graph, [("a", "b")])
    clone_name = f"{graph.name}:copy"
    graph.copy(clone_name)
    try:
        with pytest.raises(redis.exceptions.ResponseError, match="already exists"):
            graph.copy(clone_name)
    finally:
        db.select_graph(clone_name).delete()


def test_maxflow_is_directed(graph: Graph) -> None:
    create_edges(graph, [("s", "t")])
    assert max_flow(graph, "s", ["t"])[0] == 1
    assert max_flow(graph, "t", ["s"])[0] == 0


def test_maxflow_counts_edge_disjoint_paths_with_unit_capacities(graph: Graph) -> None:
    create_edges(graph, [("s", "a"), ("a", "t"), ("s", "b"), ("b", "t"), ("a", "b")])
    value, flows = max_flow(graph, "s", ["t"])
    assert value == 2
    assert sum(f[2] for f in flows if f[0] == "s") == 2


def test_maxflow_ignores_relationship_types_not_listed(graph: Graph) -> None:
    create_edges(graph, [("s", "t")], rel="OTHER")
    run(
        graph,
        "e-edge",
        "CREATE (:N {id: 'x'})-[:E {capacity: 1}]->(:N {id: 'y'})",
        timeout_ms=SETUP_TIMEOUT_MS,
    )
    assert max_flow(graph, "s", ["t"])[0] == 0


def test_maxflow_errors_when_the_listed_relationship_type_is_absent(graph: Graph) -> None:
    """Quirk: the engine must count ATTACK_STEP edges first and treat zero edges as F = 0 (D-16)."""
    create_edges(graph, [("s", "t")], rel="OTHER")
    with pytest.raises(QueryFailedError, match="unknown relationship-type"):
        max_flow(graph, "s", ["t"])


def test_bfs_follows_outgoing_edges_only(graph: Graph) -> None:
    create_edges(graph, [("a", "b")])
    bfs = "MATCH (x:N {id: $id}) CALL algo.bfs(x, 3, 'E') YIELD nodes RETURN [n IN nodes | n.id]"
    from_a = run(graph, "bfs", bfs, {"id": "a"}, timeout_ms=SETUP_TIMEOUT_MS).result_set
    from_b = run(graph, "bfs", bfs, {"id": "b"}, timeout_ms=SETUP_TIMEOUT_MS).result_set
    assert from_a[0][0] == ["b"]
    assert not from_b or from_b[0][0] == []


def test_tc20_maxflow_agrees_with_the_oracle_on_random_graphs(db: FalkorDB) -> None:
    """TC-20: on 50 random directed graphs, maxFlow > 0 exactly when the oracle finds a path."""
    rng = random.Random(20261017)
    for trial in range(50):
        nodes = [f"n{i}" for i in range(25)]
        edges = sorted({(rng.choice(nodes), rng.choice(nodes)) for _ in range(rng.randint(20, 60))})
        edges = [e for e in edges if e[0] != e[1]]
        if not any(e[0] == "n0" for e in edges):
            edges.append(("n0", rng.choice(nodes[1:])))
        present = [t for t in rng.sample(nodes[1:], 3) if any(t in e for e in edges)]
        g = db.select_graph(f"test:tc20:{trial}:{rng.getrandbits(32):08x}")
        try:
            create_edges(g, edges)
            value = max_flow(g, "n0", present)[0] if present else 0
            oracle = reachable_targets(edges, "n0", present)
            assert (value > 0) == bool(oracle), (trial, value, sorted(oracle))
        finally:
            g.delete()
