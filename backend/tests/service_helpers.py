"""Shared helpers for the API, MCP and agent tests."""

from __future__ import annotations

import secrets
import socket
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

import uvicorn

from interdict.config import AppSettings
from interdict.investigation import DirectInvoker
from interdict.session import SessionKeys
from interdict.tools import ToolContext

STORM = "storm-20261018"
PAYMENTS, PII = "prod-payments-db", "customer-pii-db"
AUTH_CLUSTER = "cluster-prod-payments-db-ing-auth"
DEEP_CLUSTER = "cluster-customer-pii-db-deep"


def app_settings(template: str, **overrides: Any) -> AppSettings:
    return AppSettings(
        session_secret=secrets.token_urlsafe(48),
        internal_token=secrets.token_urlsafe(48),
        template=template,
        **overrides,
    )


def tool_context(store, settings: AppSettings, session_id: str | None = None) -> ToolContext:
    session_id = session_id or secrets.token_urlsafe(24)
    return ToolContext(
        store, SessionKeys.derive(session_id, settings.session_secret), template=settings.template
    )


def direct_factory(store, settings: AppSettings):
    @asynccontextmanager
    async def factory(session_id: str):
        yield DirectInvoker(tool_context(store, settings, session_id))

    return factory


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class ServerThread:
    """Run an ASGI app with uvicorn in a background thread (for real HTTP transports)."""

    def __init__(self, app, port: int) -> None:
        self.server = uvicorn.Server(
            uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
        )
        self.thread = threading.Thread(target=self.server.run, daemon=True)

    def __enter__(self) -> ServerThread:
        self.thread.start()
        deadline = time.monotonic() + 10
        while not self.server.started:
            if time.monotonic() > deadline:
                raise RuntimeError("server did not start")
            time.sleep(0.02)
        return self

    def __exit__(self, *exc: object) -> None:
        self.server.should_exit = True
        self.thread.join(timeout=5)


def cleanup_session(store, keys: SessionKeys) -> None:
    """Delete everything a session created, including its certificate graphs (`cert:{id}` names
    carry no session key; the session's certificate records do)."""
    client = store.db.connection
    for key in client.scan_iter(f"certificate:{keys.key}:*"):
        store.delete("cert:" + key.split(":")[-1])
    for name in store.names():
        if keys.key in name:
            store.delete(name)
    for key in client.scan_iter(f"*{keys.key}*"):
        client.delete(key)


# --- a scripted stand-in for the Anthropic client ---------------------------------------------


@dataclass
class Block:
    type: str
    text: str = ""
    thinking: str = ""
    id: str = ""
    name: str = ""
    input: dict[str, Any] = field(default_factory=dict)


@dataclass
class Usage:
    input_tokens: int = 1000
    output_tokens: int = 200
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0


@dataclass
class Message:
    content: list[Block]
    stop_reason: str
    usage: Usage = field(default_factory=Usage)


class ScriptedClaude:
    """Plays a fixed script; each step sees the conversation so far and returns a Message."""

    def __init__(self, script) -> None:
        self.script = list(script)
        self.requests: list[dict[str, Any]] = []
        self.messages = self

    async def create(self, **kwargs: Any) -> Message:
        self.requests.append(kwargs)
        step = self.script.pop(0)
        return step(kwargs["messages"]) if callable(step) else step


def tool_use(name: str, arguments: dict[str, Any], why: str = "") -> Message:
    blocks = [Block("text", text=why)] if why else []
    blocks.append(Block("tool_use", id=f"tu-{name}-{len(arguments)}", name=name, input=arguments))
    return Message(blocks, "tool_use")


def last_result(messages: list[dict[str, Any]]) -> dict[str, Any]:
    """The JSON of the most recent tool result the agent received."""
    import json

    content = messages[-1]["content"][-1]["content"]
    return json.loads(content)
