# Interdict V4.2: Simulation, Security, Verification & Audit Contract

> Status: Pre-event planning notes (Interdict V4.2). Ideas and design sketches only; all implementation is written fresh during the hackathon (Rule 8). Where this conflicts with [06_WINNING_PLAN.md](06_WINNING_PLAN.md), the V5 plan wins (see its §0).

---

## 1. Counterfactual Simulation Semantics & Synthetic Policy Engine

> **Superseded (V5.1, conflicts C-03/C-04):** Kubernetes NetworkPolicy has no explicit deny rules, so the `blocked_destinations` deny-list payloads and the in-memory simulator below are not valid semantics. Canonical replacements: policy semantics [07 §5](07_V5_ENGINE_SPECIFICATION.md), action catalogue §6, planner §7, candidate-graph simulation and Path Hunter §8. Everything in this section is preserved for history and regression comparison.

Interdict models Kubernetes network policies deterministically within its synthetic graph environment. It does **not** claim to replicate the asynchronous eBPF or kernel iptables implementation of Calico/Cilium.

### Modeled Synthetic Semantics:
1. **Additive Egress Allowlist:** Workloads have default allow connectivity unless an egress NetworkPolicy matches their `podSelector`. Once selected, all egress is blocked *except* ports explicitly declared in `egress.ports`.
2. **Core System Dependency Preservation:** Egress to CoreDNS (`kube-system`, UDP/TCP port 53) must be explicitly retained in surgical policies.
3. **Non-Mutating Evaluation:** Candidate policies are evaluated against an in-memory clone of the target scope's evidence graph. FalkorDB baseline nodes and relationships remain completely untouched.

### Supported Candidate Action Schemas:

**Candidate A: Surgical Database Egress Block (`SURGICAL_DB_ISOLATION`)**: blocks the attack vector to the database while preserving legitimate inter-service traffic. Operational impact: Low (DNS and cluster microservices keep working; only DB access on port 5432 is severed).
```json
{
  "candidate_action_id": "ACT-SURGICAL-01",
  "action_type": "APPLY_NETWORK_POLICY_ISOLATE",
  "policy_spec": {
    "name": "isolate-auth-db-egress",
    "namespace": "production",
    "pod_selector": {"app": "auth-service"},
    "policy_type": "Egress",
    "blocked_destinations": [
      {"target_db_id": "prod-payments-db", "port": 5432, "protocol": "TCP"}
    ],
    "preserved_egress": [
      {"destination": "kube-dns", "port": 53, "protocol": "UDP"},
      {"destination": "billing-service", "port": 8080, "protocol": "TCP"}
    ]
  }
}
```

**Candidate B: Hard Workload Severance (`HARD_WORKLOAD_ISOLATION`)**: complete emergency network isolation. Operational impact: Critical (blocks CoreDNS, inter-service HTTP and metrics; shuts down all pod communication).
```json
{
  "candidate_action_id": "ACT-HARD-02",
  "action_type": "APPLY_NETWORK_POLICY_ISOLATE",
  "policy_spec": {
    "name": "emergency-quarantine-auth",
    "namespace": "production",
    "pod_selector": {"app": "auth-service"},
    "policy_type": "Egress",
    "blocked_destinations": "ALL",
    "preserved_egress": []
  }
}
```

*Open issue:* the simulator below reads `candidate.target_workload_id`, which these payloads do not carry, and TC-06/TC-07 are phrased in terms of an older `blocked_port` field (`None` = block all, `int` = block that port). Reconcile both on Day 2.

### Simulator Implementation Contract:
```python
def simulate_candidate_policy(
    candidate: CandidateAction, 
    scope_workloads: Dict[str, WorkloadEvidence]
) -> SimulationReport:
    """
    Evaluates candidate policy rules against candidate-state memory.
    Guarantees FalkorDB baseline graph remains non-mutated.
    """
    if candidate.action_type != "APPLY_NETWORK_POLICY_ISOLATE":
        return SimulationReport(status="SIMULATION_REJECTED", error="Unsupported action type")

    # Deep copy scope workloads
    candidate_state = {k: v.model_copy(deep=True) for k, v in scope_workloads.items()}
    target = candidate_state.get(candidate.target_workload_id)
    
    if not target:
        return SimulationReport(status="SIMULATION_INCONCLUSIVE", error="Target workload not in scope")

    # Evaluate additive allowlist rules
    if candidate.policy_spec.blocked_destinations == "ALL":
        target.reachability_records = []
    else:
        # Surgical severance of declared blocked destinations
        blocked_pairs = {
            (d["target_db_id"], d["port"]) for d in candidate.policy_spec.blocked_destinations
        }
        target.reachability_records = [
            r for r in target.reachability_records 
            if (r.get("target_db_id"), r.get("port")) not in blocked_pairs
        ]

    # Re-evaluate all workloads targeting the asset
    residual_chains = []
    has_inconclusive = False
    for w in candidate_state.values():
        status, chains = evaluate_workload_chains(w)
        if status == "INCONCLUSIVE":
            has_inconclusive = True
        elif status == "QUALIFYING_MODELED_CHAIN":
            residual_chains.extend(chains)

    if has_inconclusive:
        sim_status = "SIMULATION_INCONCLUSIVE"
    elif len(residual_chains) == 0:
        sim_status = "SIMULATED_CONTAINMENT"
    else:
        sim_status = "SIMULATED_RESIDUAL_EXPOSURE"

    return SimulationReport(
        candidate_action_id=candidate.candidate_action_id,
        simulation_status=sim_status,
        residual_chain_ids=[c.chain_id for c in residual_chains],
        service_impact_level="CRITICAL" if candidate.policy_spec.blocked_destinations == "ALL" else "LOW_SURGICAL"
    )
```

---

## 2. Security Threat Model (STRIDE)

| STRIDE Category | Threat Scenario | Impact | Interdict Defensive Architecture |
| :--- | :--- | :--- | :--- |
| **Spoofing** | Attacker spoofs an alert payload to trigger containment on critical services. | Denial of Service (DoS) on legitimate infrastructure. | Action Gateway enforces strict workload allowlists and checks against active cluster manifests. |
| **Tampering** | Attacker modifies graph telemetry to hide attack paths. | False containment claims (`VERIFIED_CONTAINED` erroneously emitted). | Three-valued logic: Unverified, expired, or missing telemetry yields `INCONCLUSIVE`. |
| **Repudiation** | Operator denies authorizing a production pod isolation. | Lack of accountability during incident RCA. | Cryptographic append-only audit trail linking operator identity, action payload, and SHA-256 state hash. |
| **Information Disclosure** | Vulnerability payloads leak secret tokens in graph properties. | Credential compromise. | Pydantic sanitization filter strips API keys, secrets, and auth tokens before writing to graph properties. |
| **Denial of Service** | Agent triggers an infinite tool-calling loop or expensive graph query. | High API costs and frozen system response. | Hard timeout per Cypher query (500ms max) and hard limit of 5 tool iterations per investigation. |
| **Elevation of Privilege**| Prompt injection via CVE title instructs agent to execute shell commands. | Arbitrary remote code execution (RCE) on host. | Agent communicates via strict JSON tools. Action Gateway has zero shell adapters; only allowlisted actions exist. |

---

## 3. Action Gateway Contract & Execution Gate

The Action Gateway is the **independent security boundary**. The LLM has zero authority to execute changes directly:
1. **Action Allowlist:** Only `APPLY_NETWORK_POLICY_ISOLATE` permitted. Shell execution strictly disabled. `REVOKE_IAM_PERMISSION` pruned for MVP.
2. **Scope Constraint:** Target pod and namespace must match active `investigation_id`.
3. **Graph Revision Freshness:** Verifies `candidate.baseline_graph_revision == current_graph_revision`. If drift detected, halts with `STALE_REVISION_REJECTED`.
4. **Idempotency Guarantee:** Validates `idempotency_key`. Duplicate requests return previous cached execution receipt without repeating changes.
5. **Approval Mandate:** Live infrastructure changes strictly blocked without manual operator confirmation.

---

## 4. State Ownership, Persistence & Audit Integrity
> **Superseded in part (V5, conflict C-07):** SQLite and the JSONL file are replaced by FalkorDB graphs, Redis keys and a Redis Stream audit log ([06 §4.3](06_WINNING_PLAN.md)). The hash-chain protocol below is unchanged.

| Entity | Storage Location | Persistence Guarantees | Restart Recovery Protocol |
| :--- | :--- | :--- | :--- |
| **Graph Topology & Evidence** | FalkorDB (Redis Engine) | In-Memory with optional Redis RDB snapshotting | On startup, backend checks connection; if empty, runs idempotent seed script. |
| **Application Graph Revision** | Atomic Counter in Redis / Memory | Integer counter (`graph_revision: int`) | Initialized to `1` on clean start; incremented on graph telemetry writes. |
| **Investigation Lifecycle State** | SQLite / FastAPI In-Memory Store | Durable disk file (`investigations.db`) | On reboot, active investigations resume in `ANALYZING` or `FAILED`. |
| **Idempotency Receipts** | Key-Value Store (`idemp:{key}`) | TTL of 24 hours | On duplicate submission, cached JSON receipt returned immediately. |
| **Audit Event Stream** | Append-Only JSONL file (`audit.log`) | Append-only file with SHA-256 hash chains | Each line contains previous event hash; verifiable via verification tool. |

### Tamper-Evident Hash Chain Protocol:
$$\text{Hash}_N = \text{SHA256}(\text{Payload}_N \,\|\, \text{Hash}_{N-1})$$
*Honest Qualification:* Hash chaining is tamper-evident (detects unauthorized record insertion/deletion upon replay audit); it does not provide cryptographic write-once-read-many (WORM) hardware immutability against root filesystem overwrite.

---

## 5. Verification Invariants & Provisional SLOs

### 5.1 The 12 Deterministic Acceptance Tests (PyTest)

| Test ID | Scenario / Edge Case | Test Input & Condition | Expected Canonical Outcome |
| :---: | :--- | :--- | :--- |
| **TC-01** | **Scenario A: Full Containment** | `auth-service-pod` with `DEMO-CVE-001`, verified `CAN_REACH`, and IAM `Allow` to `prod-payments-db`. Candidate network isolation applied. | Baseline: `QUALIFYING_MODELED_CHAIN`. Simulation: `SIMULATED_CONTAINMENT`. Post-verification: 0 residual chains. |
| **TC-02** | **Scenario B: Negative Control** | `batch-worker-pod` has `DEMO-CVE-001`, but no internet exposure and no `CAN_REACH` edge to crown jewels. | Baseline: `NOT_QUALIFIED`. Agent reports low environmental risk and avoids disruptive isolation. |
| **TC-03** | **Scenario C: Residual Risk** | `auth-service-pod` and `analytics-worker-pod` both qualify against `prod-payments-db`. Isolate `auth-service-pod`. | Target scope evaluates both workloads. Simulation: `SIMULATED_RESIDUAL_EXPOSURE`. Lists `chain-analytics-worker-pod-prod-payments-db`. |
| **TC-04** | **Missing Vulnerability** | Pod has exposure, `CAN_REACH`, and IAM `Allow`, but its image has 0 active CVE records. | Baseline: `NOT_QUALIFIED` (fails Tier 2). |
| **TC-05** | **Expired / Stale Evidence** | Pod has all 4 tiers, but `CAN_REACH.valid_until < now()`. | Baseline: `INCONCLUSIVE`. Action Gateway refuses execution. |
| **TC-06** | **Simulation: Full Egress Block** | Candidate blocks all egress (`blocked_destinations: "ALL"` / legacy `blocked_port=None`). | Simulator clears all reachability records for the target workload; other workloads untouched. |
| **TC-07** | **Simulation: Port-Specific Block** | Candidate blocks port 5432; workload has reachability on 5432 and 6379. | Simulator clears port 5432; preserves port 6379. |
| **TC-08** | **Stale Graph Revision** | Simulation on revision 1. Before execution, graph revision increments to 2. | Action Gateway halts with `STALE_REVISION_REJECTED`. |
| **TC-09** | **Unallowlisted Action Rejection** | Agent submits candidate action `'TERMINATE_CONTAINER'`. | Action Gateway rejects with `UNAUTHORIZED_ACTION`. |
| **TC-10** | **Idempotency Guarantee** | Action submitted twice with identical `idempotency_key`. | Second request returns the previous execution receipt without repeating changes. |
| **TC-11** | **Query / Provider Failure** | Cypher query times out or returns malformed data during verification. | Verifier returns `VERIFICATION_INCONCLUSIVE`. Never claims zero paths. |
| **TC-12** | **Non-Mutating Simulation** | `simulate_remediation` executed; FalkorDB graph re-queried immediately. | All original nodes, edges, and counts in FalkorDB remain unchanged. |

*Open issue:* FR-09 and FR-10 (doc 05) reference `TC-13` (audit logging) and `TC-14` (choke-point ranking), which are not yet defined.

> **Resolved (V5.1):** TC-13 and TC-14 are now defined, and TC-15…TC-41 added, in the canonical registry [07 §12.4](07_V5_ENGINE_SPECIFICATION.md). **TC-06 and TC-07 are revised there** to allowlist semantics (`EGRESS_DENY_ALL`, `EGRESS_STRICT`); the rows above are preserved as originally written. TC-01's "`SIMULATED_CONTAINMENT`" now additionally requires an issued certificate (07 §9).

### 5.2 Provisional Latency Targets (Smoke-Test, 50+ node synthetic graph)
> **V5.1 note:** Additional targets NFR-06…NFR-08 (storm triage, Hunter round, graph copy) and the Day-1 validation gate G0–G4 are in [07 §12.3 and §13](07_V5_ENGINE_SPECIFICATION.md). Record measured values here after Day 1.

| Operation | Metric | Provisional Target | Context |
| :--- | :--- | :--- | :--- |
| System Health Check | p99 | < 50 ms | Local FalkorDB Docker container |
| Single-Node Indexed Lookup | p95 | < 80 ms | Seeded graph |
| Independent Evidence Queries (1A–1D combined) | p95 | < 250 ms | 4 disjoint queries |
| Betweenness Centrality (`algo.betweenness`) | p95 | < 400 ms | Sampled call (`samplingSeed: 42`) |
| Total Non-LLM Graph Investigation | p95 | < 500 ms | Cypher + algorithm calls combined |
| API Ingestion Acceptance | p95 | < 150 ms | Returns async `investigation_id` (`202 Accepted`) |
| Complete Agent Investigation Loop | Total | Monitored separately | Depends on model provider and network |

Replace these targets with measured values on Day 1.

---

## 6. Audit Event & Evidence Confidence Panel Schema

Every investigation produces structured audit records. The Evidence Confidence Panel exposes three canonical statuses:

```json
{
  "timestamp": "2026-10-15T10:14:02.124Z",
  "trace_id": "tr-98f21a4e",
  "investigation_id": "INV-1042",
  "alert_id": "ALT-209",
  "graph_revision": 17,
  "event_type": "REMEDIATION_SIMULATED",
  "target_db_id": "prod-payments-db",
  "candidate_action_id": "ACT-08",
  "execution_mode": "SIMULATION",
  "confidence_panel": {
    "graph_evidence_status": "VALID_AND_CURRENT",
    "security_feasibility_status": "QUALIFYING_MODELED_CHAIN",
    "action_verification_status": "SIMULATED_CONTAINMENT"
  },
  "pre_remediation_qualifying_chains": 1,
  "post_remediation_qualifying_chains": 0,
  "verification_scope": "TARGET_ASSET",
  "simulation_status": "SIMULATED_CONTAINMENT",
  "residual_chain_ids": [],
  "execution_duration_ms": 142
}
```
