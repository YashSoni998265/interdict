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


def witness_paths(
    edges: Iterable[tuple[str, str]], source: str, targets: Iterable[str]
) -> dict[str, tuple[str, ...]]:
    """One shortest path from `source` to each reachable target, as node ids (deterministic)."""
    adjacency: dict[str, list[str]] = defaultdict(list)
    for src, dst in edges:
        adjacency[src].append(dst)
    parent: dict[str, str | None] = {source: None}
    queue = deque([source])
    while queue:
        node = queue.popleft()
        for nxt in sorted(adjacency[node]):
            if nxt not in parent:
                parent[nxt] = node
                queue.append(nxt)
    paths = {}
    for target in sorted(set(targets)):
        if target == source or target not in parent:
            continue
        path = [target]
        while (prev := parent[path[-1]]) is not None:
            path.append(prev)
        paths[target] = tuple(reversed(path))
    return paths
