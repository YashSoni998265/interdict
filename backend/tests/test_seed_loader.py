"""Loading the synthetic environment into FalkorDB (issue #6)."""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import pytest
from falkordb import FalkorDB

from interdict.db import run
from interdict.graphstore import GraphStore
from interdict.seed import generate
from interdict.seed.loader import load, read_meta, verify


@pytest.fixture
def store(db: FalkorDB) -> GraphStore:
    return GraphStore(db)


@pytest.fixture
def target(store: GraphStore) -> Iterator[str]:
    name = f"test:template:{uuid.uuid4().hex[:10]}"
    yield name
    store.delete(name)
    store.delete(f"{name}:next")


def test_loaded_graph_matches_the_environment(store: GraphStore, target: str) -> None:
    env = generate(alert_count=300)
    result = load(store, env, target)
    assert not result.skipped
    assert verify(store.graph(target), env) == []
    assert (result.nodes, result.edges) == (len(env.nodes), len(env.edges))
    assert not store.exists(f"{target}:next"), "the staging graph must be removed"


def test_loaded_graph_has_id_indexes_and_operational_unique_constraints(
    store: GraphStore, target: str
) -> None:
    load(store, generate(alert_count=50), target)
    graph = store.graph(target)
    indexes = run(
        graph, "test", "CALL db.indexes() YIELD label RETURN label", timeout_ms=5000
    ).result_set
    labels = {row[0] for row in indexes}
    assert {"Pod", "Database", "Alert", "CAN_REACH", "HAS_VULNERABILITY"} <= labels
    statuses = run(
        graph, "test", "CALL db.constraints() YIELD status RETURN status", timeout_ms=5000
    ).result_set
    assert statuses and all(row[0] == "OPERATIONAL" for row in statuses)


def test_reloading_the_same_environment_is_a_no_op(store: GraphStore, target: str) -> None:
    env = generate(alert_count=50)
    load(store, env, target)
    assert load(store, env, target).skipped


def test_a_different_seed_or_replace_rebuilds(store: GraphStore, target: str) -> None:
    load(store, generate(seed=1, alert_count=50), target)
    assert not load(store, generate(seed=2, alert_count=50), target).skipped
    assert read_meta(store, target)["seed"] == 2
    assert not load(store, generate(seed=2, alert_count=50), target, replace=True).skipped


def test_meta_records_seed_version_and_storm(store: GraphStore, target: str) -> None:
    load(store, generate(seed=5, alert_count=40), target)
    meta = read_meta(store, target)
    assert meta["seed"] == 5
    assert meta["storm_id"] == "storm-5"
    assert meta["alert_count"] == 40
    assert meta["revision"] == 1
    assert meta["inventory_complete"] is True


def test_cli_loads_and_reports_json(
    store: GraphStore, target: str, capsys: pytest.CaptureFixture[str]
) -> None:
    from interdict.seed.__main__ import main

    assert main(["--graph", target, "--alerts", "30"]) == 0
    first = capsys.readouterr().out
    assert '"skipped": false' in first
    assert main(["--graph", target, "--alerts", "30"]) == 0
    assert '"skipped": true' in capsys.readouterr().out
