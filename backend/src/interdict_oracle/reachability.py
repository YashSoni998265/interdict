"""Plain breadth-first reachability over a directed edge list."""

from __future__ import annotations

from collections import defaultdict, deque
from collections.abc import Iterable


def reachable_from(edges: Iterable[tuple[str, str]], source: str) -> set[str]:
    """Nodes reachable from `source` by following edges in their direction (excludes `source`)."""
    adjacency: dict[str, list[str]] = defaultdict(list)
    for src, dst in edges:
        adjacency[src].append(dst)
    seen = {source}
    queue = deque([source])
    while queue:
        node = queue.popleft()
        for nxt in adjacency[node]:
            if nxt not in seen:
                seen.add(nxt)
                queue.append(nxt)
    seen.discard(source)
    return seen


def reachable_targets(
    edges: Iterable[tuple[str, str]], source: str, targets: Iterable[str]
) -> set[str]:
    """The subset of `targets` that has a directed path from `source`."""
    return reachable_from(edges, source) & set(targets)
