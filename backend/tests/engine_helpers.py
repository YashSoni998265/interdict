"""Shared constants and helpers for engine tests (the fixtures live in conftest.py)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from interdict.db import run
from interdict.graphstore import GraphStore

STAMP = datetime(2026, 10, 17, 9, 0, tzinfo=UTC)
NOW = STAMP + timedelta(hours=1)  # inside the 12-hour freshness window
ALERTS = 200


def write(store: GraphStore, graph: str, cypher: str, params: dict | None = None) -> None:
    """Test-only direct write (real changes go through sandbox operations)."""
    run(store.graph(graph), "test-write", cypher, params, timeout_ms=10_000)
