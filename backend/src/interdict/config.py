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


@dataclass(frozen=True)
class AppSettings:
    """Settings shared by the API and MCP processes. Secrets have no defaults: both processes
    refuse to start without them, so a deployment can never run with a guessable secret."""

    session_secret: str
    internal_token: str
    mcp_url: str = "http://127.0.0.1:8765/mcp"
    mcp_host: str = "127.0.0.1"
    mcp_port: int = 8765
    template: str = "template"
    llm_model: str = "claude-opus-5-5"
    allowed_origins: tuple[str, ...] = ("http://localhost:5173",)
    cookie_secure: bool = False
    build_sha: str = "dev"

    @classmethod
    def from_env(cls) -> AppSettings:
        secret = os.environ.get("INTERDICT_SESSION_SECRET", "")
        token = os.environ.get("INTERDICT_INTERNAL_TOKEN", "")
        if len(secret) < 32 or len(token) < 32:
            raise RuntimeError(
                "INTERDICT_SESSION_SECRET and INTERDICT_INTERNAL_TOKEN must each be set to at "
                "least 32 random characters (see .env.example)"
            )
        origins = os.environ.get("INTERDICT_ALLOWED_ORIGINS", ",".join(cls.allowed_origins))
        return cls(
            session_secret=secret,
            internal_token=token,
            mcp_url=os.environ.get("INTERDICT_MCP_URL", cls.mcp_url),
            mcp_host=os.environ.get("INTERDICT_MCP_HOST", cls.mcp_host),
            mcp_port=int(os.environ.get("INTERDICT_MCP_PORT", cls.mcp_port)),
            template=os.environ.get("INTERDICT_TEMPLATE", cls.template),
            llm_model=os.environ.get("INTERDICT_LLM_MODEL", cls.llm_model),
            allowed_origins=tuple(o.strip() for o in origins.split(",") if o.strip()),
            cookie_secure=os.environ.get("INTERDICT_COOKIE_SECURE", "0") == "1",
            build_sha=os.environ.get("INTERDICT_GIT_SHA", cls.build_sha),
        )
