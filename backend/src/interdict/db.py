"""FalkorDB access: one place for connections, per-query timeouts and error mapping.

Every engine query goes through `run()`, so a timeout, a server error or a lost
connection always surfaces as `QueryFailedError`. Callers map that to the
`QUERY_FAILED` collection status; it must never be read as "no results"
(solution.md §6.5).
"""

from __future__ import annotations

from typing import Any

import redis
from falkordb import FalkorDB
from falkordb.graph import Graph
from falkordb.query_result import QueryResult

from interdict.config import Settings


class QueryFailedError(RuntimeError):
    """A named query template failed, timed out or lost its connection."""

    def __init__(self, template: str, reason: str) -> None:
        super().__init__(f"{template}: {reason}")
        self.template = template
        self.reason = reason


def connect(settings: Settings) -> FalkorDB:
    return FalkorDB(
        host=settings.falkordb_host,
        port=settings.falkordb_port,
        password=settings.falkordb_password,
        socket_connect_timeout=5,
    )


def run(
    graph: Graph,
    template: str,
    query: str,
    params: dict[str, Any] | None = None,
    *,
    timeout_ms: int,
    read_only: bool = False,
    row_limit: int | None = None,
) -> QueryResult:
    """Run one parameterised query template with a server-side timeout.

    `row_limit` should be the server's RESULTSET_SIZE. FalkorDB truncates larger
    results without an error, so a result that reaches the limit is reported as
    a failure instead of being trusted as complete.
    """
    execute = graph.ro_query if read_only else graph.query
    try:
        result = execute(query, params=params, timeout=timeout_ms)
    except (redis.exceptions.ResponseError, redis.exceptions.ConnectionError) as exc:
        raise QueryFailedError(template, str(exc)) from exc
    except redis.exceptions.TimeoutError as exc:
        raise QueryFailedError(template, f"client socket timeout: {exc}") from exc
    if row_limit is not None and len(result.result_set) >= row_limit:
        raise QueryFailedError(
            template, f"result reached the {row_limit}-row limit and may be truncated"
        )
    return result
