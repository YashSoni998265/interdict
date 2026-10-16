"""Append-only, hash-chained audit log per session (§12.5).

    payload_hash_N = SHA256(canonical event body N)
    hash_N         = SHA256(payload_hash_N || hash_{N-1}),  hash_0 = 64 zeros

Appends are serialised by a lock shared by every process, so the chain never forks. Replaying
the chain detects an inserted, deleted or modified event: tamper-evident, not tamper-proof, since
an operator who controls the store could rewrite the whole stream.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from interdict.graphstore import GraphStore

GENESIS = "sha256:" + "0" * 64
RETENTION_MS = 7 * 24 * 60 * 60 * 1000


def _sha256(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode()).hexdigest()


def _canonical(body: dict[str, Any]) -> str:
    return json.dumps(body, sort_keys=True, separators=(",", ":"), default=str)


class AuditLog:
    def __init__(self, store: GraphStore, stream: str) -> None:
        self.store = store
        self.stream = stream
        self.client = store.db.connection

    def _all(self) -> list[dict[str, Any]]:
        entries = self.client.xrange(self.stream)
        return [
            json.loads(fields[b"event"] if b"event" in fields else fields["event"])
            for _, fields in entries
        ]

    def append(
        self,
        event_type: str,
        *,
        trace_id: str | None = None,
        revision: int | None = None,
        **payload: Any,
    ) -> dict[str, Any]:
        with self.store.lock(f"lock:{self.stream}"):
            last = self.client.xrevrange(self.stream, count=1)
            previous = (
                json.loads(last[0][1][b"event"] if b"event" in last[0][1] else last[0][1]["event"])
                if last
                else None
            )
            body = {
                "seq": previous["seq"] + 1 if previous else 1,
                "timestamp": datetime.now(UTC).isoformat(timespec="milliseconds"),
                "trace_id": trace_id,
                "graph_revision": revision,
                "event_type": event_type,
                **payload,
            }
            payload_hash = _sha256(_canonical(body))
            prev_hash = previous["hash"] if previous else GENESIS
            event = {
                **body,
                "payload_hash": payload_hash,
                "prev_hash": prev_hash,
                "hash": _sha256(payload_hash + prev_hash),
            }
            self.client.xadd(self.stream, {"event": json.dumps(event, default=str)})
            self.client.pexpire(self.stream, RETENTION_MS)
        return event

    def page(self, after: int = 0, limit: int = 200) -> list[dict[str, Any]]:
        return [e for e in self._all() if e["seq"] > after][:limit]

    def verify(self) -> bool:
        """Replay the chain; False if any event was inserted, removed or changed."""
        prev = GENESIS
        for expected_seq, event in enumerate(self._all(), start=1):
            body = {
                k: v for k, v in event.items() if k not in ("payload_hash", "prev_hash", "hash")
            }
            payload_hash = _sha256(_canonical(body))
            if (
                event["seq"] != expected_seq
                or event["prev_hash"] != prev
                or event["payload_hash"] != payload_hash
                or event["hash"] != _sha256(payload_hash + prev)
            ):
                return False
            prev = event["hash"]
        return True
