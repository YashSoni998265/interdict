"""Investigation timeline events, the one schema used by the API stream, the agent and the UI.

    lifecycle    {"state": <lifecycle state from §10.2>}
    tool_call    {"call_id", "tool", "input", "why"}
    tool_result  {"call_id", "tool", "ok", "summary", "latency_ms", "evidence_ids", "data"}
    narration    {"text", "source": "agent" | "deterministic"}
    report       {"report": final report}
    error        {"code", "message"}
    done         {"status": terminal status}

Every event also carries `seq` (1, 2, ...) and `at` (UTC ISO-8601), so a client can resume a
stream from the last `seq` it saw.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

Event = dict[str, Any]

LIFECYCLE = (
    "INGESTED",
    "TRIAGING",
    "ANALYZING",
    "EVALUATING",
    "PLANNING",
    "HUNTING",
    "SIMULATING",
    "CANDIDATE_EVALUATED",
    "AWAITING_APPROVAL",
    "EXECUTING",
    "VERIFYING",
)


class Timeline:
    """Numbers and timestamps events, keeps them, and forwards each one to a listener."""

    def __init__(
        self,
        listener: Callable[[Event], None] | None = None,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.events: list[Event] = []
        self.listener = listener
        self.clock = clock
        self._calls = 0

    def emit(self, type_: str, **fields: Any) -> Event:
        event = {
            "seq": len(self.events) + 1,
            "at": self.clock().astimezone(UTC).isoformat(timespec="milliseconds"),
            "type": type_,
            **fields,
        }
        self.events.append(event)
        if self.listener is not None:
            self.listener(event)
        return event

    def lifecycle(self, state: str) -> Event:
        return self.emit("lifecycle", state=state)

    def narrate(self, text: str, source: str = "deterministic") -> Event:
        return self.emit("narration", text=text, source=source)

    def next_call_id(self) -> str:
        self._calls += 1
        return f"call-{self._calls}"
