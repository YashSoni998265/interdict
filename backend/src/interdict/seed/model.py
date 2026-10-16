"""In-memory form of a generated environment: labelled nodes and typed edges with properties."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True, slots=True)
class Node:
    label: str
    id: str
    props: dict[str, Any]


@dataclass(frozen=True, slots=True)
class Edge:
    type: str
    src: str
    dst: str
    src_label: str
    dst_label: str
    props: dict[str, Any]

    @property
    def id(self) -> str:
        return self.props["id"]


@dataclass
class Environment:
    nodes: list[Node] = field(default_factory=list)
    edges: list[Edge] = field(default_factory=list)
    _index: dict[str, Node] = field(default_factory=dict, repr=False)

    def add_node(self, label: str, node_id: str, **props: Any) -> Node:
        if node_id in self._index:
            raise ValueError(f"duplicate node id: {node_id}")
        node = Node(label, node_id, {"id": node_id, **props})
        self.nodes.append(node)
        self._index[node_id] = node
        return node

    def add_edge(self, rel_type: str, src: str, dst: str, edge_id: str, **props: Any) -> Edge:
        if src not in self._index or dst not in self._index:
            raise ValueError(f"edge {edge_id} references a missing node ({src} -> {dst})")
        edge = Edge(
            rel_type,
            src,
            dst,
            self._index[src].label,
            self._index[dst].label,
            {"id": edge_id, **props},
        )
        self.edges.append(edge)
        return edge

    def node(self, node_id: str) -> Node:
        return self._index[node_id]

    def has_node(self, node_id: str) -> bool:
        return node_id in self._index

    def by_label(self, label: str) -> list[Node]:
        return [n for n in self.nodes if n.label == label]

    def edges_of(self, rel_type: str) -> list[Edge]:
        return [e for e in self.edges if e.type == rel_type]

    def summary(self) -> dict[str, dict[str, int]]:
        return {
            "nodes": dict(sorted(Counter(n.label for n in self.nodes).items())),
            "edges": dict(sorted(Counter(e.type for e in self.edges).items())),
        }

    def to_dict(self) -> dict[str, Any]:
        """Deterministic, JSON-ready form (sorted), used for comparisons and exports."""
        return {
            "nodes": sorted(
                ({"label": n.label, **n.props} for n in self.nodes), key=lambda n: n["id"]
            ),
            "edges": sorted(
                ({"type": e.type, "src": e.src, "dst": e.dst, **e.props} for e in self.edges),
                key=lambda e: e["id"],
            ),
        }
