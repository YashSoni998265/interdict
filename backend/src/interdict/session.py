"""Per-session keys and records, derived on the server from the session id (§12.6, §12.7).

Every graph name and Redis key a session can touch is derived from
`hmac(session_secret, session_id)`. No endpoint or tool ever accepts a graph key, so one visitor
cannot reach another visitor's sandbox, plans or certificates (TC-35).
"""

from __future__ import annotations

import hashlib
import hmac
import json
from dataclasses import dataclass
from typing import Any

import redis


@dataclass(frozen=True)
class SessionKeys:
    key: str

    @classmethod
    def derive(cls, session_id: str, secret: str) -> SessionKeys:
        digest = hmac.new(secret.encode(), session_id.encode(), hashlib.sha256).hexdigest()
        return cls(digest[:32])

    @property
    def sandbox(self) -> str:
        return f"sandbox:{self.key}"

    @property
    def memory(self) -> str:
        return f"memory:{self.key}"

    @property
    def audit(self) -> str:
        return f"audit:{self.key}"

    @property
    def operations(self) -> str:
        return f"ops:{self.key}"

    def plan(self, plan_id: str) -> str:
        return f"plan:{self.key}:{plan_id}"

    def hunt(self, plan_id: str) -> str:
        return f"hunt:{self.key}:{plan_id}"

    def certificate(self, certificate_id: str) -> str:
        return f"certificate:{self.key}:{certificate_id}"

    def receipt(self, idempotency_key: str) -> str:
        return f"idemp:{self.key}:{idempotency_key}"

    def investigation(self, investigation_id: str) -> str:
        return f"inv:{self.key}:{investigation_id}"

    def events(self, investigation_id: str) -> str:
        return f"events:{self.key}:{investigation_id}"


class Records:
    """JSON documents in FalkorDB's keyspace, each with its own retention."""

    def __init__(self, client: redis.Redis) -> None:
        self.client = client

    def put(self, key: str, value: Any, ttl_s: int) -> None:
        self.client.set(key, json.dumps(value, separators=(",", ":")), ex=ttl_s)

    def put_new(self, key: str, value: Any, ttl_s: int) -> bool:
        """Store only if absent (atomic check-and-set). Returns whether it was stored."""
        return bool(
            self.client.set(key, json.dumps(value, separators=(",", ":")), ex=ttl_s, nx=True)
        )

    def get(self, key: str) -> Any | None:
        raw = self.client.get(key)
        return json.loads(raw) if raw is not None else None

    def keys(self, pattern: str) -> list[str]:
        return sorted(
            k.decode() if isinstance(k, bytes) else k for k in self.client.scan_iter(pattern)
        )
