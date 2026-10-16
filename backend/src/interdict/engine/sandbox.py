"""Per-session sandboxes and graph revisions (solution.md §5.1, §12.2-§12.3, D-03, D-04).

A sandbox is a private copy of `template`. Its evidence is stamped by the synthetic
collector when the sandbox is created (D-04), so it is fresh for the visitor's session.

Every sandbox mutation runs as one query that also checks and bumps `Meta.revision`
(compare-and-set) while holding the sandbox's lock, so concurrent writers cannot both
succeed and a copy can never capture a half-applied change (D-03).
"""

from __future__ import annotations

import hashlib
import hmac
from datetime import UTC, datetime, timedelta
from typing import Any

from interdict.db import run
from interdict.graphstore import GraphStore

TEMPLATE = "template"
TIMEOUT_MS = 10_000
EVIDENCE_TTL = timedelta(hours=12)


class ConcurrentModificationError(RuntimeError):
    """The graph changed since the caller read its revision."""


def sandbox_name(session_id: str, secret: str) -> str:
    """Graph key for a session. Derived on the server and never accepted from a client (§12.7)."""
    digest = hmac.new(secret.encode(), session_id.encode(), hashlib.sha256).hexdigest()
    return f"sandbox:{digest[:32]}"


def graph_lock(name: str) -> str:
    return f"lock:graph:{name}"


def iso(ts: datetime) -> str:
    return ts.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_revision(store: GraphStore, name: str) -> int:
    rows = run(
        store.graph(name),
        "revision-read",
        "MATCH (m:Meta {id: 'meta'}) RETURN m.revision",
        timeout_ms=TIMEOUT_MS,
        read_only=True,
    ).result_set
    if not rows:
        raise ValueError(f"graph {name} has no Meta node")
    return int(rows[0][0])


def stamp_evidence(
    store: GraphStore, name: str, now: datetime, ttl: timedelta = EVIDENCE_TTL
) -> int:
    """The synthetic collector observes the environment now (D-04). Returns edges stamped."""
    result = run(
        store.graph(name),
        "collector-stamp",
        "MATCH ()-[e]->() WHERE e.evidence_source = 'SYNTHETIC_GENERATOR' "
        "SET e.observed_at = $observed_at, e.valid_until = $valid_until "
        "RETURN count(e)",
        {"observed_at": iso(now), "valid_until": iso(now + ttl)},
        timeout_ms=TIMEOUT_MS,
    )
    return int(result.result_set[0][0])


def create_sandbox(
    store: GraphStore,
    name: str,
    now: datetime,
    *,
    template: str = TEMPLATE,
    reset: bool = False,
    ttl: timedelta = EVIDENCE_TTL,
) -> bool:
    """Create the sandbox if it does not exist (or rebuild it with `reset`). Returns True if created."""
    with store.lock(graph_lock(name)):
        if store.exists(name) and not reset:
            return False
        store.copy(template, name, replace=reset)
        stamp_evidence(store, name, now, ttl)
        return True


def mutate(
    store: GraphStore,
    name: str,
    expected_revision: int,
    template: str,
    body: str,
    params: dict[str, Any] | None = None,
) -> int:
    """Apply one change and bump the revision in the same query, under the graph's lock.

    `body` continues after `MATCH (m:Meta ...) WITH m` and must keep `m` in scope (for example
    by ending with `WITH m`). The caller validates that every referenced entity exists before
    calling, so an empty result means the revision moved on.
    """
    query = (
        "MATCH (m:Meta {id: 'meta'}) WHERE m.revision = $expected_revision WITH m "
        f"{body} "
        "SET m.revision = m.revision + 1 RETURN m.revision"
    )
    with store.lock(graph_lock(name)):
        rows = run(
            store.graph(name),
            template,
            query,
            {**(params or {}), "expected_revision": expected_revision},
            timeout_ms=TIMEOUT_MS,
        ).result_set
    if not rows:
        raise ConcurrentModificationError(f"{name} is no longer at revision {expected_revision}")
    return int(rows[0][0])
