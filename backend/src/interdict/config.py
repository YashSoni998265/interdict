"""Runtime settings, read from environment variables (see .env.example)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def find_dotenv(start: Path | None = None) -> Path | None:
    """The nearest `.env` file in `start` (default: the working directory) or a parent."""
    current = (start or Path.cwd()).resolve()
    for folder in (current, *current.parents):
        candidate = folder / ".env"
        if candidate.is_file():
            return candidate
    return None


def load_dotenv(path: Path | None) -> None:
    """Load KEY=VALUE lines into the environment. Variables that are already set win."""
    if path is None or not path.is_file():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


@dataclass(frozen=True)
class Settings:
    falkordb_host: str = "localhost"
    falkordb_port: int = 6379
    falkordb_password: str | None = None
    query_timeout_ms: int = 500
    # Server-side row cap. FalkorDB silently truncates larger results (Day-1 gate G3),
    # so `db.run` treats any result that reaches this size as possibly truncated.
    resultset_size: int = 100_000

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            falkordb_host=os.environ.get("FALKORDB_HOST", cls.falkordb_host),
            falkordb_port=int(os.environ.get("FALKORDB_PORT", cls.falkordb_port)),
            falkordb_password=os.environ.get("FALKORDB_PASSWORD") or None,
            query_timeout_ms=int(os.environ.get("QUERY_TIMEOUT_MS", cls.query_timeout_ms)),
            resultset_size=int(os.environ.get("FALKORDB_RESULTSET_SIZE", cls.resultset_size)),
        )
