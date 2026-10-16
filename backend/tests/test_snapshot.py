"""Canonical snapshot export and hash (issue #11, solution.md §9.3)."""

from __future__ import annotations

import uuid

import pytest

from engine_helpers import NOW, STAMP, write
from interdict.db import run
from interdict.engine import snapshot as snapshot_module
from interdict.engine.sandbox import create_sandbox
from interdict.engine.snapshot import SnapshotError, export_graph, snapshot_hash
from interdict.engine.triage import run_triage
from interdict.graphstore import GraphStore


def counts(store: GraphStore, name: str) -> tuple[int, int]:
    nodes = run(store.graph(name), "n", "MATCH (n) RETURN count(n)", timeout_ms=5_000)
    edges = run(
        store.graph(name),
        "e",
        "MATCH ()-[r]->() WHERE type(r) <> 'ATTACK_STEP' RETURN count(r)",
        timeout_ms=5_000,
    )
    return nodes.result_set[0][0], edges.result_set[0][0]


def test_the_export_covers_every_node_and_non_derived_edge(store: GraphStore, sandbox: str) -> None:
    run_triage(store, sandbox, NOW)  # builds ATTACK_STEP edges, which must be left out
    export = export_graph(store, sandbox)
    assert (len(export.nodes), len(export.edges)) == counts(store, sandbox)
    assert [n[0] for n in export.nodes] == sorted(n[0] for n in export.nodes)
    assert not any(e[1] == "ATTACK_STEP" for e in export.edges)


def test_the_hash_ignores_paging_and_derived_edges(
    store: GraphStore, sandbox: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    before = snapshot_hash(store, sandbox)
    run_triage(store, sandbox, NOW)
    assert snapshot_hash(store, sandbox) == before, "ATTACK_STEP edges are recomputed, not hashed"
    monkeypatch.setattr(snapshot_module, "PAGE", 97)
    assert snapshot_hash(store, sandbox) == before, "paging must not change the order"
    assert before.hash.startswith("sha256:") and len(before.hash) == 71


def test_equal_graphs_hash_equally_and_any_change_shows(
    store: GraphStore, template: str, sandbox: str
) -> None:
    twin = f"test:twin:{uuid.uuid4().hex[:8]}"
    try:
        create_sandbox(store, twin, STAMP, template=template)
        assert snapshot_hash(store, twin) == snapshot_hash(store, sandbox)
        write(store, twin, "MATCH (p:Pod {id: 'batch-1'}) SET p.status = 'Pending'")
        assert snapshot_hash(store, twin).hash != snapshot_hash(store, sandbox).hash
    finally:
        store.delete(twin)


def test_a_duplicate_or_missing_id_aborts_the_export(store: GraphStore, sandbox: str) -> None:
    """Unique constraints stop duplicates within a label; the export also catches them across
    labels, because a certificate names nodes by id alone."""
    write(store, sandbox, "CREATE (:Probe {id: 'auth-1'})")
    with pytest.raises(SnapshotError, match="duplicate node ids: auth-1"):
        export_graph(store, sandbox)
    write(store, sandbox, "MATCH (p:Probe) DELETE p")
    write(
        store,
        sandbox,
        "MATCH (a:Pod {id: 'auth-1'}), (b:Pod {id: 'batch-1'}) CREATE (a)-[:CAN_REACH {port: 1}]->(b)",
    )
    with pytest.raises(SnapshotError, match="has no id"):
        export_graph(store, sandbox)
