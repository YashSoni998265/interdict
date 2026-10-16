"""Day-1 runtime validation gates G0, G3, G1 and G2 (solution.md §17).

Usage, from the repository root:
    docker compose up -d falkordb
    cd backend && uv run python scripts/day1_gates.py

Every graph this script creates is named "gate:*" and is deleted at the end.
Results are printed and written to scripts/gate_results/day1.json.
The exit code is 1 if any check fails, so a failed gate is never silent.
"""

from __future__ import annotations

import contextlib
import json
import os
import random
import statistics
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import redis
from falkordb import FalkorDB
from falkordb.graph import Graph

from interdict.config import Settings, load_dotenv
from interdict.db import QueryFailedError, connect, run
from interdict_oracle.reachability import reachable_targets

REPO_ROOT = Path(__file__).resolve().parents[2]
RESULTS_PATH = Path(__file__).resolve().parent / "gate_results" / "day1.json"
SLOW = 30_000  # generous timeout for setup queries
RESULTS: dict[str, list[dict[str, Any]]] = {}


def record(gate: str, check: str, passed: bool, detail: Any) -> None:
    RESULTS.setdefault(gate, []).append({"check": check, "passed": passed, "detail": detail})
    print(f"  [{'PASS' if passed else 'FAIL'}] {check}: {detail}")


def percentile(values: list[float], pct: int) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, round(pct / 100 * (len(ordered) - 1)))
    return ordered[index]


def timed(fn: Callable[[], Any]) -> tuple[Any, float]:
    start = time.perf_counter()
    out = fn()
    return out, (time.perf_counter() - start) * 1000


def fresh(db: FalkorDB, name: str) -> Graph:
    graph = db.select_graph(f"gate:{name}")
    with contextlib.suppress(redis.exceptions.ResponseError):  # graph did not exist
        graph.delete()
    return graph


def create_edges(
    graph: Graph, edges: list[tuple[str, str]], rel: str = "E", capacity: bool = True
) -> None:
    nodes = sorted({n for edge in edges for n in edge})
    run(
        graph,
        "setup-nodes",
        "UNWIND $ids AS id CREATE (:N {id: id})",
        {"ids": nodes},
        timeout_ms=SLOW,
    )
    run(graph, "setup-index", "CREATE INDEX FOR (n:N) ON (n.id)", timeout_ms=SLOW)
    props = "{capacity: 1}" if capacity else "{}"
    run(
        graph,
        "setup-edges",
        f"UNWIND $pairs AS p MATCH (a:N {{id: p[0]}}), (b:N {{id: p[1]}}) CREATE (a)-[:{rel} {props}]->(b)",
        {"pairs": [list(e) for e in edges]},
        timeout_ms=SLOW,
    )


def max_flow(
    graph: Graph, src: str, dst: list[str], types: str = "['E']"
) -> tuple[float, list[list[Any]]]:
    query = (
        "MATCH (s:N {id: $src}) MATCH (t:N) WHERE t.id IN $dst WITH s, collect(t) AS targets "
        f"CALL algo.maxFlow({{sourceNodes: [s], targetNodes: targets, capacityProperty: 'capacity', relationshipTypes: {types}}}) "
        "YIELD edges, edgeFlows, maxFlow "
        "RETURN maxFlow, [i IN range(0, size(edges) - 1) | [startNode(edges[i]).id, endNode(edges[i]).id, edgeFlows[i]]]"
    )
    row = run(
        graph, "maxflow", query, {"src": src, "dst": dst}, timeout_ms=SLOW, read_only=True
    ).result_set[0]
    return row[0], row[1]


# --------------------------------------------------------------------------- G0
def gate_g0(db: FalkorDB) -> None:
    print("\nG0  Version and capabilities")
    server = db.connection.info("server")
    record("G0", "Redis server version", True, server.get("redis_version"))
    modules = {
        m.get("name", m.get(b"name")): m.get("ver", m.get(b"ver"))
        for m in db.connection.module_list()
    }
    record(
        "G0",
        "FalkorDB module loaded",
        any(str(k) in ("graph", "b'graph'") for k in modules),
        modules,
    )

    g = fresh(db, "g0")
    run(
        g,
        "g0-setup",
        "CREATE (a:A {id: 'a', x: 1})-[:R {id: 'r1', p: 2}]->(b:B {id: 'b'}), (b)-[:R {id: 'r2'}]->(:B {id: 'c'})",
        timeout_ms=SLOW,
    )

    try:
        listed = [
            r[0]
            for r in run(
                g, "g0-procs", "CALL dbms.procedures() YIELD name RETURN name", timeout_ms=SLOW
            ).result_set
        ]
        by_lower = {
            name.lower(): name for name in listed
        }  # procedure names are case-insensitive in CALL
        for proc in ("algo.maxFlow", "algo.betweenness", "algo.bfs"):
            found = by_lower.get(proc.lower())
            record(
                "G0",
                f"procedure {proc} available",
                found is not None,
                f"listed as {found}" if found else "not listed",
            )
    except QueryFailedError as exc:
        record("G0", "dbms.procedures() callable", False, exc.reason)

    row = run(
        g,
        "g0-functions",
        "MATCH (a:A)-[r:R]->(b) RETURN labels(a), properties(a), type(r), properties(r), "
        "coalesce(a.missing, 'dflt'), [i IN range(0, 2) | i * 2], startNode(r).id, endNode(r).id",
        timeout_ms=SLOW,
    ).result_set[0]
    ok = (
        row[0] == ["A"]
        and row[1] == {"id": "a", "x": 1}
        and row[2] == "R"
        and row[3] == {"id": "r1", "p": 2}
        and row[4] == "dflt"
        and row[5] == [0, 2, 4]
        and row[6] == "a"
        and row[7] == "b"
    )
    record(
        "G0",
        "functions: labels, properties, type, coalesce, range, list comprehension, startNode, endNode",
        ok,
        row,
    )

    rows = run(
        g,
        "g0-varlen",
        "MATCH p = (a:A {id: 'a'})-[:R*0..3]->(x) RETURN [n IN nodes(p) | n.id]",
        timeout_ms=SLOW,
    ).result_set
    paths = sorted(tuple(r[0]) for r in rows)
    record("G0", "zero-length variable-length pattern *0..3", ("a",) in paths, paths)

    try:
        run(g, "g0-index-node", "CREATE INDEX FOR (n:A) ON (n.id)", timeout_ms=SLOW)
        run(g, "g0-index-rel", "CREATE INDEX FOR ()-[r:R]-() ON (r.id)", timeout_ms=SLOW)
        idx = run(
            g,
            "g0-index-list",
            "CALL db.indexes() YIELD label, properties RETURN label, properties",
            timeout_ms=SLOW,
        ).result_set
        record("G0", "node and relationship-property indexes", len(idx) >= 2, idx)
    except QueryFailedError as exc:
        record("G0", "node and relationship-property indexes", False, exc.reason)

    try:
        g.create_node_unique_constraint("A", "id")
        status = None
        for _ in range(50):
            rows = run(
                g,
                "g0-constraints",
                "CALL db.constraints() YIELD status RETURN status",
                timeout_ms=SLOW,
            ).result_set
            status = rows[0][0] if rows else None
            if status == "OPERATIONAL":
                break
            time.sleep(0.1)
        record("G0", "unique constraint becomes operational", status == "OPERATIONAL", status)
        try:
            run(g, "g0-dup", "CREATE (:A {id: 'dup'}), (:A {id: 'dup'})", timeout_ms=SLOW)
            rejected, reason = False, "duplicate accepted"
        except QueryFailedError as exc:
            rejected, reason = True, exc.reason
        left = run(
            g, "g0-dup-count", "MATCH (n:A {id: 'dup'}) RETURN count(n)", timeout_ms=SLOW
        ).result_set[0][0]
        record("G0", "unique constraint rejects duplicate ids", rejected, reason)
        record(
            "G0",
            "failed write query leaves no partial writes",
            left == 0,
            f"nodes with id 'dup' after the failed query: {left}",
        )
    except (QueryFailedError, redis.exceptions.ResponseError) as exc:
        record("G0", "unique constraints", False, str(exc))

    try:
        pong = db.connection.eval("return redis.call('PING')", 0)
        record(
            "G0",
            "server-side scripting (EVAL) for atomic audit append",
            pong in (b"PONG", "PONG"),
            pong,
        )
    except redis.exceptions.ResponseError as exc:
        record("G0", "server-side scripting (EVAL) for atomic audit append", False, str(exc))

    run(g, "g0-meta", "CREATE (:Meta {id: 'meta', revision: 1})", timeout_ms=SLOW)
    cas = "MATCH (m:Meta {id: 'meta'}) WHERE m.revision = $expected SET m.revision = m.revision + 1 RETURN m.revision"

    def attempt(_: int) -> int:
        return len(run(g, "g0-cas", cas, {"expected": 1}, timeout_ms=SLOW).result_set)

    with ThreadPoolExecutor(max_workers=20) as pool:
        winners = sum(pool.map(attempt, range(20)))
    final = run(
        g, "g0-meta-read", "MATCH (m:Meta {id: 'meta'}) RETURN m.revision", timeout_ms=SLOW
    ).result_set[0][0]
    record(
        "G0",
        "revision compare-and-set: exactly one of 20 concurrent writers wins (D-03)",
        winners == 1 and final == 2,
        f"winners={winners}, final revision={final}",
    )


# --------------------------------------------------------------------------- G3
def gate_g3(db: FalkorDB) -> None:
    print("\nG3  Query timeouts and result limits")
    config: dict[str, Any] = {}
    for key in (
        "TIMEOUT",
        "TIMEOUT_DEFAULT",
        "TIMEOUT_MAX",
        "RESULTSET_SIZE",
        "MAX_QUEUED_QUERIES",
    ):
        try:
            config[key] = db.config_get(key)
        except redis.exceptions.ResponseError as exc:
            config[key] = f"error: {exc}"
    record("G3", "server configuration", True, config)

    g = fresh(db, "g3")
    run(g, "g3-setup", "CREATE (:Probe {id: 'p'})", timeout_ms=SLOW)

    start = time.perf_counter()
    try:
        run(
            g,
            "g3-eager-list",
            "UNWIND range(1, 200000000) AS x WITH x WHERE x % 7 = 0 RETURN count(x)",
            timeout_ms=50,
            read_only=True,
        )
        timed_out, reason = False, "completed without timing out"
    except QueryFailedError as exc:
        timed_out, reason = "time" in exc.reason.lower(), exc.reason
    elapsed = (time.perf_counter() - start) * 1000
    record(
        "G3",
        "read query exceeding its 50 ms timeout raises QueryFailedError",
        timed_out,
        f"{reason!r} after {elapsed:.0f} ms",
    )
    record(
        "G3",
        "eager list functions (range of 200M items) are not interrupted by the timeout (informational)",
        True,
        f"{elapsed:.0f} ms wall clock for a 50 ms limit; engine queries must not build huge lists",
    )

    run(g, "g3-traversal-setup", "UNWIND range(1, 2000) AS i CREATE (:P {i: i})", timeout_ms=SLOW)
    start = time.perf_counter()
    try:
        run(
            g,
            "g3-slow-traversal",
            "MATCH (a:P), (b:P), (c:P) RETURN count(*)",
            timeout_ms=50,
            read_only=True,
        )
        traversal_timed_out, reason = False, "completed without timing out"
    except QueryFailedError as exc:
        traversal_timed_out, reason = "time" in exc.reason.lower(), exc.reason
    elapsed = (time.perf_counter() - start) * 1000
    record(
        "G3",
        "traversal-heavy query is interrupted promptly (< 1,000 ms wall clock for a 50 ms limit)",
        traversal_timed_out and elapsed < 1000,
        f"{reason!r} after {elapsed:.0f} ms",
    )

    try:
        run(
            g,
            "g3-slow-write",
            "UNWIND range(1, 50000000) AS x CREATE (:TimeoutProbe {x: x})",
            timeout_ms=50,
        )
        write_timed_out, reason = False, "completed without timing out"
    except QueryFailedError as exc:
        write_timed_out, reason = True, exc.reason
    left = run(g, "g3-count", "MATCH (n:TimeoutProbe) RETURN count(n)", timeout_ms=SLOW).result_set[
        0
    ][0]
    record(
        "G3",
        "timed-out write query is rolled back",
        write_timed_out and left == 0,
        f"{reason!r}; nodes left: {left}",
    )

    try:
        run(g, "g3-over-max", "RETURN 1", timeout_ms=10_000_000)
        record("G3", "per-query timeout above TIMEOUT_MAX is rejected", False, "accepted")
    except QueryFailedError as exc:
        record("G3", "per-query timeout above TIMEOUT_MAX is rejected", True, exc.reason)

    limit = config.get("RESULTSET_SIZE")
    limit_value = limit[1] if isinstance(limit, list) and len(limit) == 2 else limit
    try:
        n_rows = int(limit_value) + 10 if int(limit_value) > 0 else 20_000
    except (TypeError, ValueError):
        n_rows = 20_000
    rows = run(
        g,
        "g3-resultset",
        "UNWIND range(1, $n) AS x RETURN x",
        {"n": n_rows},
        timeout_ms=SLOW,
        read_only=True,
    ).result_set
    record(
        "G3",
        f"a {n_rows}-row result is returned in full (RESULTSET_SIZE={limit_value})",
        len(rows) == n_rows,
        f"rows returned: {len(rows)}"
        + (
            ""
            if len(rows) == n_rows
            else " -> results are truncated SILENTLY at RESULTSET_SIZE; engine must page and treat a full page as possibly truncated"
        ),
    )


# --------------------------------------------------------------------------- G1
def gate_g1(db: FalkorDB) -> None:
    print("\nG1  Max-flow and BFS behaviour")
    g = fresh(db, "g1a")
    create_edges(g, [("s", "t")])
    forward, _ = max_flow(g, "s", ["t"])
    backward, _ = max_flow(g, "t", ["s"])
    record(
        "G1",
        "(a) edges are directed: s->t gives 1, t->s gives 0",
        forward == 1 and backward == 0,
        f"s->t={forward}, t->s={backward}",
    )

    g = fresh(db, "g1b")
    create_edges(g, [("s", "a"), ("a", "t"), ("s", "b"), ("b", "t"), ("a", "b")])
    value, flows = max_flow(g, "s", ["t"])
    out_of_s = sum(f[2] for f in flows if f[0] == "s")
    record(
        "G1",
        "(b) unit capacities: value = number of edge-disjoint paths (2)",
        value == 2,
        f"maxFlow={value}",
    )
    record(
        "G1",
        "(b) per-edge flows returned and conserve flow out of the source",
        out_of_s == value,
        flows,
    )

    g = fresh(db, "g1c")
    create_edges(g, [("s", "t1"), ("s", "t2")])
    value, _ = max_flow(g, "s", ["t1", "t2"])
    record("G1", "(c) multiple targetNodes supported (expected 2)", value == 2, f"maxFlow={value}")

    g = fresh(db, "g1d1")
    create_edges(g, [("s", "t")], rel="OTHER")
    try:
        value, _ = max_flow(g, "s", ["t"])
        record(
            "G1",
            "(d1) graph with no edge of the listed type: maxFlow returns 0",
            value == 0,
            f"maxFlow={value}",
        )
    except QueryFailedError as exc:
        record(
            "G1",
            "(d1) graph with no edge of the listed type: maxFlow returns 0",
            False,
            f"{exc.reason} -> a fully contained candidate (no ATTACK_STEP edges left) would error; "
            "engine must count ATTACK_STEP edges first and treat 0 edges as F = 0",
        )

    g = fresh(db, "g1d2")
    create_edges(g, [("s", "t")], rel="OTHER")
    run(g, "g1d2-e", "CREATE (:N {id: 'x'})-[:E {capacity: 1}]->(:N {id: 'y'})", timeout_ms=SLOW)
    try:
        value, _ = max_flow(g, "s", ["t"])
        record(
            "G1",
            "(d2) edges of other relationship types are ignored (expected 0)",
            value == 0,
            f"maxFlow={value}",
        )
    except QueryFailedError as exc:
        record(
            "G1",
            "(d2) edges of other relationship types are ignored (expected 0)",
            False,
            exc.reason,
        )

    g = fresh(db, "g1e")
    create_edges(g, [("s", "t")], capacity=False)
    try:
        value, _ = max_flow(g, "s", ["t"])
        detail = f"edge without capacity property gives maxFlow={value}"
    except QueryFailedError as exc:
        detail = f"error: {exc.reason}"
    record(
        "G1",
        "(e) behaviour with a missing capacity property (documented, informational)",
        True,
        detail,
    )

    g = fresh(db, "g1-param")
    create_edges(g, [("s", "t")])
    try:
        row = run(
            g,
            "maxflow-param",
            "MATCH (s:N {id: 's'}), (t:N {id: 't'}) "
            "CALL algo.maxFlow({sourceNodes: [s], targetNodes: [t], capacityProperty: 'capacity', relationshipTypes: $types}) "
            "YIELD maxFlow RETURN maxFlow",
            {"types": ["E"]},
            timeout_ms=SLOW,
        ).result_set[0]
        record(
            "G1", "relationshipTypes accepts a query parameter", row[0] == 1, f"maxFlow={row[0]}"
        )
    except QueryFailedError as exc:
        record("G1", "relationshipTypes accepts a query parameter", False, exc.reason)

    rng = random.Random(20261017)
    agree, disagreements = 0, []
    for trial in range(50):
        nodes = [f"n{i}" for i in range(25)]
        edges = sorted({(rng.choice(nodes), rng.choice(nodes)) for _ in range(rng.randint(20, 60))})
        edges = [e for e in edges if e[0] != e[1]]
        if not any(e[0] == "n0" for e in edges):
            edges.append(("n0", rng.choice(nodes[1:])))
        targets = rng.sample(nodes[1:], 3)
        g = fresh(db, f"g1f-{trial}")
        create_edges(g, edges)
        present = [t for t in targets if any(t in e for e in edges)]
        value, _ = max_flow(g, "n0", present) if present else (0, [])
        oracle = reachable_targets(edges, "n0", present)
        if (value > 0) == bool(oracle):
            agree += 1
        else:
            disagreements.append({"trial": trial, "maxFlow": value, "oracle": sorted(oracle)})
        g.delete()
    record(
        "G1",
        "(f) 50 random graphs: maxFlow > 0 exactly when the oracle finds a path",
        agree == 50,
        f"{agree}/50 agree; disagreements={disagreements}",
    )

    g = fresh(db, "g1g")
    rng = random.Random(7)
    nodes = [f"n{i}" for i in range(800)]
    big = sorted({(rng.choice(nodes), rng.choice(nodes)) for _ in range(3100)})
    big = [e for e in big if e[0] != e[1]][:3000]
    create_edges(g, big)
    targets = rng.sample(nodes[1:], 5)
    times = [timed(lambda: max_flow(g, "n0", targets))[1] for _ in range(20)]
    p95 = percentile(times, 95)
    record(
        "G1",
        "(g) maxFlow p95 < 300 ms on ~800 nodes / 3,000 edges",
        p95 < 300,
        f"p50={statistics.median(times):.1f} ms, p95={p95:.1f} ms",
    )

    g = fresh(db, "g1h")
    create_edges(g, [("a", "b")])
    from_b = run(
        g,
        "bfs",
        "MATCH (x:N {id: 'b'}) CALL algo.bfs(x, 3, 'E') YIELD nodes RETURN [n IN nodes | n.id]",
        timeout_ms=SLOW,
    ).result_set
    from_a = run(
        g,
        "bfs",
        "MATCH (x:N {id: 'a'}) CALL algo.bfs(x, 3, 'E') YIELD nodes RETURN [n IN nodes | n.id]",
        timeout_ms=SLOW,
    ).result_set
    reached_from_b = from_b[0][0] if from_b else []
    reached_from_a = from_a[0][0] if from_a else []
    direction = "outgoing only" if "a" not in reached_from_b else "follows edges in both directions"
    record(
        "G1",
        "(h) algo.bfs direction (informational)",
        True,
        f"from a: {reached_from_a}; from b: {reached_from_b} -> {direction}",
    )


# --------------------------------------------------------------------------- G2
def gate_g2(db: FalkorDB) -> None:
    print("\nG2  Graph copy")
    g = fresh(db, "g2src")
    rng = random.Random(11)
    nodes = [f"n{i}" for i in range(800)]
    edges = sorted({(rng.choice(nodes), rng.choice(nodes)) for _ in range(3100)})
    edges = [e for e in edges if e[0] != e[1]][:3000]
    create_edges(g, edges)
    counts = run(
        g,
        "g2-counts",
        "MATCH (n) WITH count(n) AS n MATCH ()-[r]->() RETURN n, count(r)",
        timeout_ms=SLOW,
    ).result_set[0]

    times = []
    for i in range(20):
        dest = f"gate:g2copy-{i}"
        _, ms = timed(lambda d=dest: g.copy(d))
        times.append(ms)
        db.select_graph(dest).delete()
    p95 = percentile(times, 95)
    record(
        "G2",
        "copy ~800 nodes / 3,000 edges: p95 < 500 ms",
        p95 < 500,
        f"p50={statistics.median(times):.1f} ms, p95={p95:.1f} ms",
    )

    copy = db.select_graph("gate:g2copy-check")
    g.copy("gate:g2copy-check")
    copied = run(
        copy,
        "g2-counts",
        "MATCH (n) WITH count(n) AS n MATCH ()-[r]->() RETURN n, count(r)",
        timeout_ms=SLOW,
    ).result_set[0]
    record(
        "G2",
        "copy has identical node and edge counts",
        copied == counts,
        f"source={counts}, copy={copied}",
    )
    idx = run(
        copy,
        "g2-index",
        "CALL db.indexes() YIELD label, properties RETURN label, properties",
        timeout_ms=SLOW,
    ).result_set
    record("G2", "indexes are copied", any(r[0] == "N" for r in idx), idx)

    try:
        g.copy("gate:g2copy-check")
        record(
            "G2",
            "copy onto an existing destination is rejected",
            False,
            "overwrote the destination",
        )
    except redis.exceptions.ResponseError as exc:
        record("G2", "copy onto an existing destination is rejected", True, str(exc))

    def concurrent_copy(i: int) -> float:
        return timed(lambda: g.copy(f"gate:g2conc-{i}"))[1]

    try:
        with ThreadPoolExecutor(max_workers=10) as pool:
            conc = list(pool.map(concurrent_copy, range(10)))
        record("G2", "10 concurrent copies succeed", True, f"slowest={max(conc):.0f} ms")
    except redis.exceptions.ResponseError as exc:
        record("G2", "10 concurrent copies succeed", False, str(exc))

    try:
        usage = db.execute_command("GRAPH.MEMORY", "USAGE", "gate:g2copy-check")
        record("G2", "memory per copy (GRAPH.MEMORY USAGE, informational)", True, usage)
    except redis.exceptions.ResponseError as exc:
        before = db.connection.info("memory")["used_memory"]
        record(
            "G2",
            "memory per copy (GRAPH.MEMORY USAGE unavailable; INFO used_memory, informational)",
            True,
            f"{exc}; used_memory={before}",
        )


def main() -> int:
    load_dotenv(REPO_ROOT / ".env")
    settings = Settings.from_env()
    db = connect(settings)
    db.connection.ping()
    started = datetime.now(UTC).isoformat()
    try:
        gate_g0(db)
        gate_g3(db)
        gate_g1(db)
        gate_g2(db)
    finally:
        for name in db.list_graphs():
            if str(name).startswith("gate:"):
                db.select_graph(name).delete()
    failed = [(gate, r["check"]) for gate, rows in RESULTS.items() for r in rows if not r["passed"]]
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULTS_PATH.write_text(
        json.dumps(
            {
                "started_at": started,
                "falkordb_image": os.environ.get("FALKORDB_IMAGE", "see docker-compose.yml"),
                "results": RESULTS,
                "failed": failed,
            },
            indent=2,
            default=str,
        )
        + "\n"
    )
    print(
        f"\n{sum(len(v) for v in RESULTS.values()) - len(failed)} checks passed, {len(failed)} failed. Results: {RESULTS_PATH}"
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
