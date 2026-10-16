"""Derived ATTACK_STEP graph, bounded chain enumeration (method E) and reachability.

Threat model ITM-1 (solution.md §6.2). Each step carries a MITRE ATT&CK label for display (D-18):

    ENTRY    Internet -> pod        Exposed(p) and NetVuln(p)            T1190
    LATERAL  pod a -> pod b         EffReach(a, b) and NetVuln(b)        T1210
    GOAL     pod a -> crown jewel   EffReach(a, t) and Authorized(a, t)  T1078.004

FalkorDB builds the ATTACK_STEP edges from the evidence itself, only when the scope is
complete, and only in sandbox or candidate graphs (§8.1). The bounded enumerator E reads base
evidence instead (CAN_REACH paths plus the evidence snapshot), so the two derivations
cross-check each other (TC-19). Variable-length paths repeat a node sequence once per parallel
edge, so E de-duplicates by node sequence.
"""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass

from interdict.db import run
from interdict.engine.evidence import INTERNET_ID, EvidenceSnapshot
from interdict.engine.sandbox import graph_lock, read_revision
from interdict.graphstore import GraphStore

TIMEOUT_MS = 5_000
MAX_LATERAL_HOPS = 3
CHAIN_ENUM_CAP = 10_000
TECHNIQUES = {
    "ENTRY": ("T1190", "Exploit Public-Facing Application"),
    "LATERAL": ("T1210", "Exploitation of Remote Services"),
    "GOAL": ("T1078.004", "Valid Accounts: Cloud Accounts"),
}
_NET_VULN = (
    "MATCH ({pod})-[:RUNS_IMAGE]->(:ContainerImage)-[:HAS_VULNERABILITY]->(v:Vulnerability {{status: 'ACTIVE'}}) "
    "WHERE coalesce(v.attack_vector, 'NETWORK') IN ['NETWORK', 'ADJACENT'] "
)
_STEP_PROPS = (
    "{{kind: '{kind}', capacity: 1, ports: ports, backing_evidence_ids: backing, "
    "built_at_revision: $revision, technique_id: '{tid}', technique: '{tname}'}}"
)
Q_CLEAR = "MATCH ()-[s:ATTACK_STEP]->() DELETE s"
Q_ENTRY = (
    "MATCH (ext:Internet {id: $internet_id})-[e1:EXPOSES]->(:Ingress)-[e2:ROUTES_TO]->(:Service)"
    "-[e3:TARGETS]->(p:Pod) " + _NET_VULN.format(pod="p") + "WITH ext, p, [] AS ports, "
    "collect(DISTINCT e1.id) + collect(DISTINCT e2.id) + collect(DISTINCT e3.id) + collect(DISTINCT v.id) AS backing "
    "CREATE (ext)-[:ATTACK_STEP "
    + _STEP_PROPS.format(kind="ENTRY", tid=TECHNIQUES["ENTRY"][0], tname=TECHNIQUES["ENTRY"][1])
    + "]->(p)"
)
Q_LATERAL = (
    "MATCH (a:Pod)-[c:CAN_REACH]->(b:Pod) WHERE a.id <> b.id "
    + _NET_VULN.format(pod="b")
    + "WITH a, b, collect(DISTINCT c.port) AS ports, collect(DISTINCT c.id) + collect(DISTINCT v.id) AS backing "
    "CREATE (a)-[:ATTACK_STEP "
    + _STEP_PROPS.format(
        kind="LATERAL", tid=TECHNIQUES["LATERAL"][0], tname=TECHNIQUES["LATERAL"][1]
    )
    + "]->(b)"
)
Q_GOAL = (
    "MATCH (a:Pod)-[c:CAN_REACH]->(t:Database {is_crown_jewel: true}) "
    "MATCH (a)-[:ASSUMES_ROLE]->(:IAMRole)-[:GRANTS_ACCESS]->(perm:IAMPermission {effect: 'Allow'})-[:APPLIES_TO]->(t) "
    "WITH a, t, collect(DISTINCT c.port) AS ports, collect(DISTINCT c.id) + collect(DISTINCT perm.id) AS backing "
    "CREATE (a)-[:ATTACK_STEP "
    + _STEP_PROPS.format(kind="GOAL", tid=TECHNIQUES["GOAL"][0], tname=TECHNIQUES["GOAL"][1])
    + "]->(t)"
)
Q_EXPORT = (
    "MATCH (a)-[s:ATTACK_STEP]->(b) "
    "RETURN a.id, b.id, s.kind, s.ports, s.backing_evidence_ids, s.built_at_revision, s.technique_id"
)
Q_FORWARD = (
    "MATCH (i:Internet {id: $internet_id}) CALL algo.bfs(i, $depth, 'ATTACK_STEP') "
    "YIELD nodes RETURN [n IN nodes | n.id]"
)


class ScopeIncompleteError(RuntimeError):
    """ATTACK_STEP edges may only be built over complete, fresh evidence (§6.6)."""


class RevisionChangedError(RuntimeError):
    """The graph changed after its evidence was read."""


@dataclass(frozen=True)
class AttackStep:
    src: str
    dst: str
    kind: str
    ports: tuple[int, ...]
    backing: tuple[str, ...]
    revision: int
    technique_id: str


@dataclass(frozen=True)
class BuildResult:
    entry: int
    lateral: int
    goal: int
    revision: int

    @property
    def total(self) -> int:
        return self.entry + self.lateral + self.goal


@dataclass(frozen=True)
class Chain:
    """Internet -> pods[0] -> ... -> pods[-1] -> target, with distinct pods."""

    id: str
    pods: tuple[str, ...]
    target: str

    @property
    def lateral_hops(self) -> int:
        return len(self.pods) - 1

    def steps(self) -> list[tuple[str, str]]:
        """(source, destination) of every LATERAL and GOAL step: the cuttable steps."""
        hops = list(zip(self.pods, self.pods[1:], strict=False))
        return [*hops, (self.pods[-1], self.target)]


@dataclass(frozen=True)
class ChainSet:
    chains: tuple[Chain, ...]
    truncated: bool
    max_lateral_hops: int


def chain_id(pods: tuple[str, ...], target: str) -> str:
    return "chain-" + "-".join((*pods, target))


def build_attack_steps(store: GraphStore, name: str, snapshot: EvidenceSnapshot) -> BuildResult:
    """Rebuild every ATTACK_STEP edge of graph `name` from its evidence (Q-A1 to Q-A4)."""
    if not snapshot.scope.complete:
        raise ScopeIncompleteError(", ".join(snapshot.scope.reasons))
    graph = store.graph(name)
    params = {"internet_id": INTERNET_ID, "revision": snapshot.revision}
    with store.lock(graph_lock(name)):
        if read_revision(store, name) != snapshot.revision:
            raise RevisionChangedError(f"{name} changed after its evidence was read")
        run(graph, "attack-clear", Q_CLEAR, timeout_ms=TIMEOUT_MS)
        created = [
            int(run(graph, template, query, params, timeout_ms=TIMEOUT_MS).relationships_created)
            for template, query in (
                ("attack-entry", Q_ENTRY),
                ("attack-lateral", Q_LATERAL),
                ("attack-goal", Q_GOAL),
            )
        ]
    return BuildResult(*created, revision=snapshot.revision)


def export_steps(store: GraphStore, name: str, *, row_limit: int = 100_000) -> list[AttackStep]:
    rows = run(
        store.graph(name),
        "attack-export",
        Q_EXPORT,
        timeout_ms=TIMEOUT_MS,
        read_only=True,
        row_limit=row_limit,
    ).result_set
    return [
        AttackStep(
            r[0], r[1], r[2], tuple(int(p) for p in r[3] or ()), tuple(r[4] or ()), int(r[5]), r[6]
        )
        for r in rows
    ]


def forward_reachable_in_graph(store: GraphStore, name: str, depth: int) -> set[str]:
    """Forward reachability from the Internet computed by FalkorDB's BFS (outgoing only, gate G1)."""
    rows = run(
        store.graph(name),
        "attack-forward-bfs",
        Q_FORWARD,
        {"internet_id": INTERNET_ID, "depth": depth},
        timeout_ms=TIMEOUT_MS,
        read_only=True,
    ).result_set
    return set(rows[0][0]) if rows else set()


def _adjacency(steps: list[AttackStep], reverse: bool = False) -> dict[str, list[str]]:
    adjacency: dict[str, list[str]] = defaultdict(list)
    for step in steps:
        a, b = (step.dst, step.src) if reverse else (step.src, step.dst)
        adjacency[a].append(b)
    return adjacency


def reachable(steps: list[AttackStep], sources: set[str], *, reverse: bool = False) -> set[str]:
    """Nodes reachable from `sources` over ATTACK_STEP edges (backwards with `reverse`), excluding sources."""
    adjacency = _adjacency(steps, reverse)
    seen = set(sources)
    queue = deque(sorted(sources))
    while queue:
        node = queue.popleft()
        for nxt in adjacency[node]:
            if nxt not in seen:
                seen.add(nxt)
                queue.append(nxt)
    return seen - sources


def shortest_path(steps: list[AttackStep], target: str) -> tuple[str, ...] | None:
    """A shortest Internet -> target path over ATTACK_STEP edges, as node ids (a witness path)."""
    adjacency = _adjacency(steps)
    parent: dict[str, str | None] = {INTERNET_ID: None}
    queue = deque([INTERNET_ID])
    while queue:
        node = queue.popleft()
        if node == target:
            path = []
            current: str | None = node
            while current is not None:
                path.append(current)
                current = parent[current]
            return tuple(reversed(path))
        for nxt in sorted(adjacency[node]):
            if nxt not in parent:
                parent[nxt] = node
                queue.append(nxt)
    return None


def net_vuln_pods(snapshot: EvidenceSnapshot) -> set[str]:
    return {v.pod for v in snapshot.vulnerabilities if v.network_exploitable}


def exposed_pods(snapshot: EvidenceSnapshot) -> dict[str, list[str]]:
    exposed: dict[str, set[str]] = defaultdict(set)
    for exposure in snapshot.exposures:
        exposed[exposure.pod].add(exposure.ingress)
    return {pod: sorted(ingresses) for pod, ingresses in exposed.items()}


def authorized_pairs(snapshot: EvidenceSnapshot) -> set[tuple[str, str]]:
    return {(g.pod, g.db) for g in snapshot.grants if g.effect == "Allow"}


def enumerate_chains(
    store: GraphStore,
    name: str,
    snapshot: EvidenceSnapshot,
    targets: set[str],
    *,
    max_lateral_hops: int = MAX_LATERAL_HOPS,
    cap: int = CHAIN_ENUM_CAP,
    row_limit: int = 100_000,
) -> ChainSet:
    """Method E: every chain to `targets` with at most `max_lateral_hops`, from base evidence."""
    if not 0 <= max_lateral_hops <= MAX_LATERAL_HOPS:
        raise ValueError(f"max_lateral_hops must be between 0 and {MAX_LATERAL_HOPS}")
    vulnerable = net_vuln_pods(snapshot)
    entries = sorted(set(exposed_pods(snapshot)) & vulnerable)
    authorized = authorized_pairs(snapshot)
    reach_dbs: dict[str, set[str]] = defaultdict(set)
    for edge in snapshot.reach:
        if edge.dst in targets:
            reach_dbs[edge.src].add(edge.dst)
    goal_targets = {
        pod: {t for t in dbs if (pod, t) in authorized} for pod, dbs in reach_dbs.items()
    }
    goals = sorted(pod for pod, dbs in goal_targets.items() if dbs)
    if not entries or not goals:
        return ChainSet((), False, max_lateral_hops)

    query = (
        f"MATCH path = (p0:Pod)-[:CAN_REACH*0..{int(max_lateral_hops)}]->(pm:Pod) "
        "WHERE p0.id IN $entries AND pm.id IN $goals "
        "RETURN [n IN nodes(path) | n.id] LIMIT $limit"
    )
    rows = run(
        store.graph(name),
        "chains-enumerate",
        query,
        {"entries": entries, "goals": goals, "limit": cap + 1},
        timeout_ms=TIMEOUT_MS,
        read_only=True,
        row_limit=row_limit,
    ).result_set
    truncated = len(rows) > cap
    chains: dict[str, Chain] = {}
    for row in rows[:cap]:
        pods = tuple(row[0])
        if len(set(pods)) != len(pods) or not all(p in vulnerable for p in pods):
            continue  # repeated pods, or a hop into a pod without a network-exploitable vulnerability
        for target in sorted(goal_targets.get(pods[-1], ())):
            cid = chain_id(pods, target)
            chains.setdefault(cid, Chain(cid, pods, target))
    return ChainSet(tuple(sorted(chains.values(), key=lambda c: c.id)), truncated, max_lateral_hops)
