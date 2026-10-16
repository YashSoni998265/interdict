# Interdict V4.2: Graph Model, Evidence Tiers & Cypher Suite

> Status: Pre-event planning notes (Interdict V4.2). Ideas and design sketches only; all implementation is written fresh during the hackathon (Rule 8). Where this conflicts with [06_WINNING_PLAN.md](06_WINNING_PLAN.md), the V5 plan wins (see its §0).

---

## 1. Canonical Status & Outcome Enum Reference

> **V5.1 note:** The complete enum registry (including new triage, plan, impact, certificate and sandbox enums) is in [07 §12.1](07_V5_ENGINE_SPECIFICATION.md). The enums below remain valid; `QUALIFYING_MODELED_CHAIN` now also covers lateral chains (07 §3.4), and `SIMULATED_CONTAINMENT` is emitted only together with a certificate (07 §9).

To prevent naming collisions and ambiguous states across all tools, APIs, audit events, and UI, the following **strictly canonical status enums** are defined:

### A. Investigation & Chain Qualification Status (`InvestigationStatus`)
- `QUALIFYING_MODELED_CHAIN`: All 4 evidence tiers are present, valid, fresh, and mutually reference the same target database.
- `NOT_QUALIFIED`: At least one required evidence tier is verified to be absent (`COLLECTED_EMPTY`) (e.g., Scenario B).
- `INCONCLUSIVE`: Required evidence is stale (`now > valid_until`), contradictory, missing provenance, query execution failed, or inventory is incomplete.

### B. Candidate Simulation Status (`SimulationStatus`)
- `SIMULATED_CONTAINMENT`: Candidate action evaluated in memory results in 0 qualifying chains within the evaluated target scope.
- `SIMULATED_RESIDUAL_EXPOSURE`: Candidate action evaluated in memory leaves $\ge 1$ qualifying chains active within the evaluated target scope.
- `SIMULATION_REJECTED`: Candidate payload contains unsupported, malformed, or ambiguous policy rules.
- `SIMULATION_INCONCLUSIVE`: Target workload not in scope or evaluation contains inconclusive evidence tiers.

### C. Live / Scope Verification Status (`VerificationStatus`)
- `VERIFIED_CONTAINED`: Live graph re-queried post-execution confirms 0 qualifying chains remain within target scope.
- `RESIDUAL_EXPOSURE`: Live graph re-queried post-execution detects $\ge 1$ active qualifying chains targeting the asset.
- `VERIFICATION_INCONCLUSIVE`: Graph revision mismatch, query error, or stale evidence encountered during verification.

---

## 2. Canonical Node & Relationship Schema

> **V5.1 note:** Extended by [07 §2](07_V5_ENGINE_SPECIFICATION.md) (Pod labels and dependency manifest, vulnerability `attack_vector`, `Alert`, Pod→Pod `CAN_REACH`, `DEPENDS_ON`, NetworkPolicy `SELECTS`/`ALLOWS_EGRESS`, derived `ATTACK_STEP`, `Certificate`, `Plan`).

| Node Label | Core Properties | Description |
| :--- | :--- | :--- |
| `(:Internet)` | `id: 'global-internet'`, `untrusted: true` | Untrusted external network entry point. |
| `(:Ingress)` | `id, name, host, ip, namespace, tls_enabled: bool` | Ingress controller or Cloud Load Balancer. |
| `(:Service)` | `id, name, namespace, type` | Kubernetes Service or microservice abstraction. |
| `(:Pod)` | `id, name, namespace, ip, status, node_name` | Running workload/container pod. |
| `(:ContainerImage)`| `id, repository, tag, digest` | Image running inside the pod container. |
| `(:Vulnerability)` | `id, cve_id: 'DEMO-CVE-001', severity: 'CRITICAL', cvss_score: 9.8, status: 'ACTIVE'` | Vulnerability metadata record. |
| `(:IAMRole)` | `id, arn, name, trust_policy` | Cloud IAM role or Kubernetes ServiceAccount. |
| `(:IAMPermission)` | `id, action: 'rds-db:connect', effect: 'Allow'` | Specific permission grant within a policy. |
| `(:Database)` | `id, name, type: 'postgres', is_crown_jewel: bool` | High-value target data store. |
| `(:NetworkPolicy)` | `id, name, namespace, selector: 'app=auth', policy_type: 'Egress', status: 'ACTIVE'` | Deployed traffic containment control. |

### Shared Evidence Provenance & Freshness Contract
Every evidence edge (`CAN_REACH`, `EXPOSES`, `ASSUMES_ROLE`, etc.) must carry:
- `evidence_source`: Originating collector (e.g., `'K8S_DISCOVERY'`, `'VPC_FLOW_LOGS'`, `'IAM_EXTRACTOR'`).
- `observed_at`: ISO-8601 timestamp of observation.
- `verified: bool`: Explicit verification status.
- `valid_until`: ISO-8601 expiration timestamp. If `now > valid_until`, evidence is stale.

---

## 3. Disjoint Parameterized Cypher Queries (Marked UNVALIDATED until Day 1)

> **Note on Verification Status:** In accordance with pre-hackathon rules, all queries below are marked **`UNVALIDATED`** until executed directly against the pinned FalkorDB container on Day 1.

### Query 1A: Public Exposure Tier
```cypher
MATCH (ext:Internet {id: $internet_id})-[:EXPOSES]->(ing:Ingress)-[:ROUTES_TO]->(svc:Service)-[:TARGETS]->(pod:Pod {id: $pod_id})
RETURN 
  ext.id AS internet_id,
  ing.id AS ingress_id,
  svc.id AS service_id,
  pod.id AS pod_id,
  true AS has_exposure
```

### Query 1B: Vulnerability Tier
> **V5.1 note (conflict C-01, 07 §14):** ITM-1 additionally requires `v.attack_vector ∈ {NETWORK, ADJACENT}`; a missing vector is treated as `NETWORK`. The query below is preserved as written.
```cypher
MATCH (pod:Pod {id: $pod_id})-[:RUNS_IMAGE]->(img:ContainerImage)-[:HAS_VULNERABILITY]->(v:Vulnerability {status: 'ACTIVE'})
RETURN 
  v.id AS vulnerability_id,
  v.cve_id AS cve_id,
  v.severity AS severity,
  v.cvss_score AS cvss_score
```

### Query 1C: Network Reachability Tier
```cypher
MATCH (pod:Pod {id: $pod_id})-[reach:CAN_REACH {verified: true}]->(db:Database {is_crown_jewel: true})
RETURN 
  db.id AS target_db_id,
  db.name AS target_db_name,
  reach.protocol AS protocol,
  reach.port AS port,
  reach.evidence_source AS evidence_source,
  reach.observed_at AS observed_at,
  reach.valid_until AS valid_until
```

### Query 1D: Identity Authorization Tier
```cypher
MATCH (pod:Pod {id: $pod_id})-[:ASSUMES_ROLE]->(role:IAMRole)-[:GRANTS_ACCESS]->(perm:IAMPermission {effect: 'Allow'})-[:APPLIES_TO]->(db:Database {is_crown_jewel: true})
RETURN 
  db.id AS target_db_id,
  db.name AS target_db_name,
  role.arn AS role_arn,
  perm.action AS action,
  perm.effect AS effect
```

### Query 2: Bounded Blast-Radius Semantics
```cypher
MATCH (pod:Pod {id: $pod_id})

// Network assets
OPTIONAL MATCH (pod)-[reach:CAN_REACH {verified: true}]->(net_asset)
WHERE net_asset:Database OR net_asset:Service

// Authorized databases
OPTIONAL MATCH (pod)-[:ASSUMES_ROLE]->(:IAMRole)-[:GRANTS_ACCESS]->(perm:IAMPermission {effect: 'Allow'})-[:APPLIES_TO]->(auth_db:Database)

WITH 
  collect(DISTINCT net_asset.id) AS net_ids,
  collect(DISTINCT auth_db.id) AS auth_db_ids

RETURN 
  net_ids AS network_reachable_asset_ids,
  size(net_ids) AS network_reachable_count,
  auth_db_ids AS iam_authorized_database_ids,
  size(auth_db_ids) AS iam_authorized_count
```
*(Backend performs `dual_exposure_database_ids = list(set(net_ids) & set(auth_db_ids))` in Python to guarantee deterministic set intersection without nested Cypher aggregations).*

### Query 3: Choke Point Detection via FalkorDB `algo.betweenness` (P1 Differentiator)
```cypher
CALL algo.betweenness({
  relationshipTypes: ['EXPOSES', 'ROUTES_TO', 'TARGETS', 'CAN_REACH'],
  samplingSeed: 42
})
YIELD node, score
WHERE node:Pod OR node:Service
RETURN node.id AS node_id, node.name AS name, score
ORDER BY score DESC
LIMIT 5
```

### Query 5: Live Scope Re-Query (UNVALIDATED)
> **V5.1 note (conflict C-15, 07 §14):** Query 5 checks direct chains only. Simulation-mode verification now uses the Path Hunter (07 §8). Query 5 must be generalised to ITM-1 before LIVE mode is enabled.
```cypher
MATCH (ext:Internet {id: $internet_id})-[:EXPOSES]->(ing:Ingress)-[:ROUTES_TO]->(svc:Service)-[:TARGETS]->(p:Pod)
MATCH (p)-[:RUNS_IMAGE]->(img:ContainerImage)-[:HAS_VULNERABILITY]->(v:Vulnerability {status: 'ACTIVE'})
MATCH (p)-[reach:CAN_REACH {verified: true}]->(db:Database {id: $target_db_id})
MATCH (p)-[:ASSUMES_ROLE]->(role:IAMRole)-[:GRANTS_ACCESS]->(perm:IAMPermission {effect: 'Allow'})-[:APPLIES_TO]->(db)
RETURN 
  p.id AS workload_id,
  p.name AS workload_name,
  db.id AS target_db_id,
  v.cve_id AS cve_id,
  reach.port AS port,
  reach.valid_until AS reach_valid_until,
  role.arn AS role_arn
```

### Target-Scope Verification Logic
- **In Simulation Mode:** Verification validates the `SimulationReport` output over the target scope. Returns `SIMULATED_CONTAINMENT` or `SIMULATED_RESIDUAL_EXPOSURE`.
- **In Live Mode:** Executes Query 5 against the refreshed graph revision.
  - If the query fails or any `reach_valid_until < now`: returns `VERIFICATION_INCONCLUSIVE`.
  - If 0 qualifying chains are returned: returns `VERIFIED_CONTAINED`.
  - If $\ge 1$ qualifying chains are returned: returns `RESIDUAL_EXPOSURE` and lists residual chain IDs.

---

## 4. Evidence State Schema & Decision Truth Table

### 4.1 Tier Collection Schema
```json
{
  "tier_name": "NETWORK_REACHABILITY",
  "collection_status": "COLLECTED_COMPLETE",
  "observed_at": "2026-10-15T10:00:00Z",
  "valid_until": "2026-10-15T22:00:00Z",
  "evidence_source": "VPC_FLOW_LOGS",
  "records": [
    {
      "target_db_id": "prod-payments-db",
      "port": 5432,
      "protocol": "tcp",
      "verified": true
    }
  ],
  "error_message": null
}
```

Allowed `collection_status` values:
- `COLLECTED_COMPLETE`: Query succeeded; matching records returned.
- `COLLECTED_EMPTY`: Query succeeded; explicitly verified that 0 matching records exist (negative proof).
- `QUERY_FAILED`: Database error, timeout, or syntax error during execution.
- `STALE_EXPIRED`: Telemetry observation is past `valid_until`.
- `UNCOLLECTED`: Data source has not been queried.

### 4.2 Complete Three-Valued Decision Truth Table

| Exposure Tier | Vulnerability Tier | Reachability Tier | Authorization Tier | Target Scope Inventory | Evaluated Security Conclusion | Justification |
| :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| `COMPLETE` (True) | `COMPLETE` (Active) | `COMPLETE` (Matches DB) | `COMPLETE` (Allow) | `COMPLETE` | **`QUALIFYING_MODELED_CHAIN`** | All 4 tiers present, fresh, and coincide on target DB. (Scenario A) |
| `EMPTY` (No Ingress) | `COMPLETE` (Active) | *Any* | *Any* | `COMPLETE` | **`NOT_QUALIFIED`** | Proven lack of public exposure. Restraint warranted. (Scenario B) |
| `COMPLETE` (True) | `EMPTY` (0 CVEs) | *Any* | *Any* | `COMPLETE` | **`NOT_QUALIFIED`** | Proven lack of active vulnerability. |
| `COMPLETE` (True) | `COMPLETE` (Active) | `EMPTY` (No Route) | *Any* | `COMPLETE` | **`NOT_QUALIFIED`** | Proven network isolation between pod and crown jewel. |
| `COMPLETE` (True) | `COMPLETE` (Active) | `COMPLETE` (Matches DB) | `EMPTY` (No IAM) | `COMPLETE` | **`NOT_QUALIFIED`** | Proven lack of database authorization. |
| **`QUERY_FAILED`** | *Any* | *Any* | *Any* | *Any* | **`INCONCLUSIVE`** | Cannot verify exposure; unsafe to claim unexposed. |
| *Any* | **`STALE_EXPIRED`** | *Any* | *Any* | *Any* | **`INCONCLUSIVE`** | Vulnerability telemetry expired; unsafe to trust status. |
| *Any* | *Any* | **`STALE_EXPIRED`** | *Any* | *Any* | **`INCONCLUSIVE`** | Reachability expired; network changes may have occurred. |
| *Any* | *Any* | *Any* | *Any* | **`INCOMPLETE`** | **`INCONCLUSIVE`** | Target-scope inventory missing workloads; residual risk unknown. |

---

## 5. Scope-Wide Deterministic Qualification Engine (Python)

> **V5.1 note:** Chain semantics are now defined by ITM-1 and the derived ATTACK_STEP graph ([07 §3–§4](07_V5_ENGINE_SPECIFICATION.md)). This evaluator remains the reference for direct (`m = 0`) chains and per-tier three-valued logic; preserved unchanged.

```python
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from pydantic import BaseModel

class QualifyingChain(BaseModel):
    chain_id: str
    workload_id: str
    target_database_id: str
    cve_id: str
    port: int
    role_arn: str

class WorkloadEvidence(BaseModel):
    pod_id: str
    exposure_status: str  # COLLECTED_COMPLETE | COLLECTED_EMPTY | QUERY_FAILED | STALE_EXPIRED
    has_exposure: bool
    vuln_status: str
    vulnerabilities: List[dict]  # list of {cve_id, severity, status}
    reach_status: str
    reachability_records: List[dict]  # list of {target_db_id, port, valid_until, ...}
    auth_status: str
    authorization_records: List[dict] # list of {target_db_id, role_arn, effect, ...}

def evaluate_workload_chains(
    evidence: WorkloadEvidence, 
    current_time: Optional[datetime] = None
) -> Tuple[str, List[QualifyingChain]]:
    """
    Evaluates qualifying modeled chains for a workload against canonical 4-tier rules.
    Returns: (status: QUALIFYING_MODELED_CHAIN | NOT_QUALIFIED | INCONCLUSIVE, chains: List[QualifyingChain])
    """
    if current_time is None:
        current_time = datetime.now(timezone.utc)

    # Inconclusive Check 1: Any query failure or stale collection status
    tier_statuses = [evidence.exposure_status, evidence.vuln_status, evidence.reach_status, evidence.auth_status]
    if any(s in ("QUERY_FAILED", "STALE_EXPIRED", "UNCOLLECTED") for s in tier_statuses):
        return ("INCONCLUSIVE", [])

    # Inconclusive Check 2: Freshness validation on reachability records
    for r in evidence.reachability_records:
        valid_until_str = r.get("valid_until")
        if not valid_until_str:
            return ("INCONCLUSIVE", [])
        valid_until = datetime.fromisoformat(valid_until_str.replace("Z", "+00:00"))
        if current_time > valid_until:
            return ("INCONCLUSIVE", [])

    # Negative Proof Check: Explicit lack of exposure or active vulnerability
    active_vulns = [v for v in evidence.vulnerabilities if v.get("cve_id") and v.get("status") == "ACTIVE"]
    if not evidence.has_exposure or len(active_vulns) == 0:
        return ("NOT_QUALIFIED", [])

    # Match Network Reachability and IAM Authorization on exact Target Database ID
    valid_reach = {r["target_db_id"]: r for r in evidence.reachability_records if r.get("port")}
    valid_auth = {a["target_db_id"]: a for a in evidence.authorization_records if a.get("effect") == "Allow"}

    common_db_ids = set(valid_reach.keys()) & set(valid_auth.keys())
    if not common_db_ids:
        return ("NOT_QUALIFIED", [])

    qualifying_chains = []
    primary_cve = active_vulns[0]["cve_id"]
    for db_id in sorted(common_db_ids):
        r_rec = valid_reach[db_id]
        a_rec = valid_auth[db_id]
        qualifying_chains.append(QualifyingChain(
            chain_id=f"chain-{evidence.pod_id}-{db_id}",
            workload_id=evidence.pod_id,
            target_database_id=db_id,
            cve_id=primary_cve,
            port=r_rec["port"],
            role_arn=a_rec["role_arn"]
        ))

    return ("QUALIFYING_MODELED_CHAIN", qualifying_chains)
```

---

## 6. Preserved Code Snippets & Competing Representations (V3 vs. V4)

### 6.1 Preserved V3 Monolithic Query (Historical Reference from `02_GRAPH_DATA_MODEL.md` V3)
In earlier drafts (V3.0/V3.1), Query 1 was drafted as a single query with multiple `OPTIONAL MATCH` clauses:
```cypher
MATCH (pod:Pod {id: $pod_id})
OPTIONAL MATCH exposure_path = (ext:Internet {id: $internet_id})-[:EXPOSES]->(ing:Ingress)-[:ROUTES_TO]->(svc:Service)-[:TARGETS]->(pod)
OPTIONAL MATCH (pod)-[:RUNS_IMAGE]->(:ContainerImage)-[:HAS_VULNERABILITY]->(v:Vulnerability)
OPTIONAL MATCH (pod)-[reach:CAN_REACH]->(db:Database {is_crown_jewel: true})
OPTIONAL MATCH (pod)-[:ASSUMES_ROLE]->(role:IAMRole)-[:GRANTS_ACCESS]->(perm:IAMPermission {effect: 'Allow'})-[:APPLIES_TO]->(db)
RETURN pod.id AS pod_id, exposure_path IS NOT NULL AS has_exposure, collect(DISTINCT v.cve_id) AS vulnerability_ids, collect(DISTINCT {database_id: db.id, database_name: db.name, has_network_reachability: (reach IS NOT NULL AND reach.verified = true), has_iam_authorization: (perm IS NOT NULL)}) AS crown_jewel_targets
```
*Reviewer Note:* This query was flagged for intermediate row multiplication and tied null variables when reachability was absent. The V4.1 disjoint queries (1A–1D) replace it. Retained for provenance and regression comparison.
