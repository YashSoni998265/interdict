from __future__ import annotations

import contextlib
import os
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
import redis
from falkordb import FalkorDB
from falkordb.graph import Graph

from interdict.config import Settings, find_dotenv, load_dotenv
from interdict.db import connect
from interdict.graphstore import GraphStore
from interdict.seed import generate
from interdict.seed.loader import load

REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def settings() -> Settings:
    load_dotenv(find_dotenv(REPO_ROOT))
    return Settings.from_env()


@pytest.fixture(scope="session")
def db(settings: Settings) -> FalkorDB:
    client = connect(settings)
    try:
        client.connection.ping()
    except redis.exceptions.RedisError as exc:
        if os.environ.get("INTERDICT_REQUIRE_FALKORDB") == "1":
            pytest.fail(f"FalkorDB is required but unavailable: {exc}")
        pytest.skip(
            f"FalkorDB not available (start it with `docker compose up -d falkordb`): {exc}"
        )
    return client


@pytest.fixture
def graph(db: FalkorDB) -> Iterator[Graph]:
    """A uniquely named, empty graph that is deleted after the test."""
    g = db.select_graph(f"test:{uuid.uuid4().hex[:12]}")
    yield g
    with contextlib.suppress(redis.exceptions.ResponseError):  # the test never created it
        g.delete()


@pytest.fixture(scope="module")
def store(db: FalkorDB) -> GraphStore:
    return GraphStore(db)


@pytest.fixture(scope="module")
def template(store: GraphStore) -> Iterator[str]:
    """A synthetic environment loaded once per test module."""
    from engine_helpers import ALERTS

    name = f"test:tpl:{uuid.uuid4().hex[:10]}"
    load(store, generate(alert_count=ALERTS), name)
    yield name
    store.delete(name)


@pytest.fixture
def sandbox(store: GraphStore, template: str) -> Iterator[str]:
    """A fresh sandbox copied from the module's template, stamped at engine_helpers.STAMP."""
    from engine_helpers import STAMP
    from interdict.engine.sandbox import create_sandbox

    name = f"test:sbx:{uuid.uuid4().hex[:10]}"
    create_sandbox(store, name, STAMP, template=template)
    yield name
    store.delete(name)
