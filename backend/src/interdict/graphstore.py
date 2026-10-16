"""Named graphs in one FalkorDB instance, with safe copying (solution.md §5.1, D-16 c).

`GRAPH.COPY` forks the database server, and only one fork can run at a time (including
background saves), so concurrent copies fail with "could not fork" (Day-1 gate G2). Every
copy therefore runs under one global lock shared by all processes, and is retried with
backoff if a background save is holding the fork.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager

import redis
from falkordb import FalkorDB
from falkordb.graph import Graph

COPY_LOCK = "lock:graph-copy"
_RELEASE_IF_OWNER = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
end
return 0
"""


class GraphCopyError(RuntimeError):
    """A graph copy could not be completed."""


class LockTimeoutError(RuntimeError):
    """A lock could not be acquired in time."""


class GraphStore:
    def __init__(
        self,
        db: FalkorDB,
        *,
        lock_wait_s: float = 15.0,
        lock_ttl_ms: int = 30_000,
        fork_retries: int = 8,
    ) -> None:
        self.db = db
        self.lock_wait_s = lock_wait_s
        self.lock_ttl_ms = lock_ttl_ms
        self.fork_retries = fork_retries

    def graph(self, name: str) -> Graph:
        return self.db.select_graph(name)

    def names(self) -> list[str]:
        return sorted(n.decode() if isinstance(n, bytes) else str(n) for n in self.db.list_graphs())

    def exists(self, name: str) -> bool:
        return name in self.names()

    def delete(self, name: str) -> bool:
        """Delete a graph if it exists. Returns whether anything was deleted."""
        try:
            self.graph(name).delete()
        except redis.exceptions.ResponseError:
            return False
        return True

    @contextmanager
    def lock(self, key: str, *, wait_s: float | None = None) -> Iterator[None]:
        """A lock held in FalkorDB's keyspace, so it works across processes.

        The value is a random owner token and the key expires on its own, so a crashed holder
        cannot block others forever, and a holder can never release someone else's lock.
        """
        token = uuid.uuid4().hex
        deadline = time.monotonic() + (self.lock_wait_s if wait_s is None else wait_s)
        while not self.db.connection.set(key, token, nx=True, px=self.lock_ttl_ms):
            if time.monotonic() >= deadline:
                raise LockTimeoutError(f"timed out waiting for {key}")
            time.sleep(0.02)
        try:
            yield
        finally:
            self.db.connection.eval(_RELEASE_IF_OWNER, 1, key, token)

    def copy(self, src: str, dst: str, *, replace: bool = False) -> float:
        """Copy `src` to `dst` under the global copy lock. Returns the copy time in ms.

        With `replace`, an existing `dst` is deleted inside the same lock, so no other copy can
        observe it missing. Without it, an existing `dst` is an error, as in FalkorDB.
        """
        with self.lock(COPY_LOCK):
            if replace:
                self.delete(dst)
            for attempt in range(self.fork_retries):
                started = time.perf_counter()
                try:
                    self.graph(src).copy(dst)
                except redis.exceptions.ResponseError as exc:
                    if "could not fork" in str(exc).lower() and attempt + 1 < self.fork_retries:
                        time.sleep(min(0.05 * 2**attempt, 1.0))
                        continue
                    raise GraphCopyError(f"copy {src} -> {dst} failed: {exc}") from exc
                return (time.perf_counter() - started) * 1000
        raise GraphCopyError(f"copy {src} -> {dst} failed: no attempts made")
