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

from interdict.config import Settings
from interdict.db import connect

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_dotenv() -> None:
    env_file = REPO_ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


@pytest.fixture(scope="session")
def settings() -> Settings:
    _load_dotenv()
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
