"""The copy lock and safe graph copies (D-16 c). Without the lock, concurrent copies fail."""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from falkordb import FalkorDB
from falkordb.graph import Graph

from graph_helpers import create_edges
from interdict.graphstore import COPY_LOCK, GraphCopyError, GraphStore, LockTimeoutError


@pytest.fixture
def store(db: FalkorDB) -> GraphStore:
    return GraphStore(db, lock_wait_s=10)


def test_concurrent_copies_succeed_under_the_copy_lock(store: GraphStore, graph: Graph) -> None:
    create_edges(graph, [(f"n{i}", f"n{i + 1}") for i in range(200)])
    targets = [f"{graph.name}:copy-{i}" for i in range(10)]
    try:
        with ThreadPoolExecutor(max_workers=10) as pool:
            times = list(pool.map(lambda dst: store.copy(graph.name, dst), targets))
        assert len(times) == 10
        assert all(store.exists(t) for t in targets)
    finally:
        for target in targets:
            store.delete(target)


def test_copy_refuses_an_existing_destination_unless_replacing(
    store: GraphStore, graph: Graph
) -> None:
    create_edges(graph, [("a", "b")])
    target = f"{graph.name}:copy"
    try:
        store.copy(graph.name, target)
        with pytest.raises(GraphCopyError, match="already exists"):
            store.copy(graph.name, target)
        store.copy(graph.name, target, replace=True)
        assert store.exists(target)
    finally:
        store.delete(target)


def test_delete_reports_whether_a_graph_existed(store: GraphStore) -> None:
    assert store.delete(f"test:missing:{uuid.uuid4().hex}") is False


def test_lock_times_out_while_another_owner_holds_it(store: GraphStore, db: FalkorDB) -> None:
    key = f"lock:test:{uuid.uuid4().hex}"
    db.connection.set(key, "someone-else", px=5_000)
    try:
        with pytest.raises(LockTimeoutError), store.lock(key, wait_s=0.2):
            pass
        assert db.connection.get(key) == "someone-else", (
            "a waiter must never release another owner's lock"
        )
    finally:
        db.connection.delete(key)


def test_lock_is_released_after_an_error(store: GraphStore, db: FalkorDB) -> None:
    key = f"lock:test:{uuid.uuid4().hex}"
    with pytest.raises(RuntimeError, match="boom"), store.lock(key):
        raise RuntimeError("boom")
    assert db.connection.get(key) is None


def test_copy_lock_key_is_shared_by_every_store(db: FalkorDB) -> None:
    """Two stores (like the API and MCP processes) contend for the same lock key."""
    first, second = GraphStore(db), GraphStore(db, lock_wait_s=0.2)
    with first.lock(COPY_LOCK), pytest.raises(LockTimeoutError), second.lock(COPY_LOCK):
        pass
