# Interdict V4.2: Requirements, Risks, Decisions & Execution

> Status: Pre-event planning notes (Interdict V4.2). Ideas and design sketches only; all implementation is written fresh during the hackathon (Rule 8). Where this conflicts with [06_WINNING_PLAN.md](06_WINNING_PLAN.md), the V5 plan wins (see its §0).

---

## 1. Functional Requirements (FR)

| Req ID | Title | Description | Acceptance Criteria | Test Mapping |
| :--- | :--- | :--- | :--- | :--- |
| **FR-01** | **Disjoint Evidence Ingestion** | Query exposure, vulnerability, reachability, and authorization independently. | Missing reachability returns empty list, not null maps; Scenario B captures critical CVE. | `TC-01`, `TC-02` |
| **FR-02** | **Deterministic Qualification** | Python engine matches 4 tiers on exact `target_db_id`. | Produces `QUALIFYING_MODELED_CHAIN` when all 4 match; `NOT_QUALIFIED` when any missing. | `TC-01`, `TC-04` |
| **FR-03** | **Freshness Validation** | Check `valid_until` against current evaluation timestamp. | Stale reachability (`valid_until < now`) forces `INCONCLUSIVE` status. | `TC-05` |
| **FR-04** | **Counterfactual Simulation** | In-memory evaluation of proposed NetworkPolicy. | Evaluates policy without modifying FalkorDB edges; clears target egress. | `TC-06`, `TC-12`|
| **FR-05** | **A/B Mitigation Tradeoff** | Rank Candidate A (Surgical) vs Candidate B (Hard Isolation). | Surgical isolation preserves non-target ports; Full isolation blocks all ports. | `TC-07` |
| **FR-06** | **Scope-Wide Residual Detection**| Target-scope verifier checks all workloads reaching database. | When Pod 1 is isolated, Pod 2's active path triggers `RESIDUAL_EXPOSURE`. | `TC-03` |
| **FR-07** | **Action Gateway Gatekeeping** | Independent allowlist, scope, and revision check. | Rejects unallowlisted actions and stale revision mutations. | `TC-08`, `TC-09`|
| **FR-08** | **Idempotent Execution** | Atomic check-and-set on `idempotency_key`. | Duplicate submissions return identical receipt without repeating mutations. | `TC-10` |
| **FR-09** | **Append-Only Audit Logging** | Record all investigation and mitigation events. | Every event contains trace ID, timestamp, and SHA-256 state hash. | `TC-13` |
| **FR-10** | **Choke Point Ranking (P1)** | Rank workloads using `algo.betweenness`. | Returns top-5 betweenness nodes; failure caught gracefully without blocking. | `TC-14` |
| **FR-11** | **Alert Storm Triage** | Partition every alert into one triage class; cluster chains; funnel with evidence IDs (07 §10). | Counts conserve input; inconclusive branch visible; counts match oracle across seeds. | `TC-15`–`TC-18` |
| **FR-12** | **Threat Model & Derived Graph** | ITM-1 transitions and ATTACK_STEP construction (07 §3–§4). | Bounded equivalence holds; transition rules enforced. | `TC-19`–`TC-21` |
| **FR-13** | **Allowlist Policy Semantics** | Additive allowlists, eligibility, monotonicity (07 §5–§6). | Declared deps and DNS kept; ineligible selectors rejected; actions never add attack steps. | `TC-06`, `TC-07` (revised), `TC-27` |
| **FR-14** | **Exact Remediation Planner** | Catalogue search up to k = 3, lexicographic objective, three-valued impact (07 §7). | Feasible, optimal within k, honest `NO_FEASIBLE_PLAN_WITHIN_K`, unknown ≠ zero. | `TC-22`–`TC-26` |
| **FR-15** | **Deterministic Path Hunter** | Plan → candidate graph → E/F/O agreement → re-plan (07 §8). | Finds beyond-bound paths; catches broken planner; disagreement is inconclusive. | `TC-28`, `TC-29`, `TC-33` |
| **FR-16** | **Model-Verified Certificate** | Issue only under 07 §9.1; hash, expiry, supersession, re-verification. | Gating, reproducibility, lifecycle, candidate isolation. | `TC-30`–`TC-32`, `TC-34` |
| **FR-17** | **Sandbox Operations** | Five typed operations with server-side authorization (07 §11). | Isolation, recomputation, limits, honest policy-removal semantics. | `TC-35`–`TC-38` |
| **FR-18** | **Memory Isolation** | Memory failure must not break investigation or certification. | Recall returns `UNAVAILABLE`; run completes. | `TC-41` |
| **FR-19** | **Temporal Attribution (P1)** | Most recent change on each chain's required edges. | Correct opened-at; unknown attribution reported as such. | `TC-40` |

> **V5.1 revisions** ([07 §12](07_V5_ENGINE_SPECIFICATION.md)): **FR-04** now runs on candidate graphs (`GRAPH.COPY`), not in memory; **FR-05** (two-candidate A/B) is superseded by FR-14's ranked plans plus a hard-isolation comparison (conflict C-18); **FR-06** residual detection is now performed by the Path Hunter (FR-15) across all crown jewels. TC-13 and TC-14 are now defined in 07 §12.4. Original rows preserved.

---

## 2. Non-Functional Requirements (NFR)

| Req ID | Title | Target SLO | Measurement Context |
| :--- | :--- | :--- | :--- |
| **NFR-01** | **Graph Query Latency** | p95 < 250 ms | FalkorDB local container running 50+ synthetic nodes. |
| **NFR-02** | **Ingestion Response Time**| p95 < 150 ms | FastAPI returns async `investigation_id` with 202 Accepted. |
| **NFR-03** | **Agent Tool Budget** | $\le 5$ iterations | Agent halts reasoning once path is classified or simulation completes. |
| **NFR-04** | **Clean Startup** | $\le 60$ seconds | One-command execution: `docker compose up --build`. |
| **NFR-05** | **Zero Secret Leaks** | 0 secrets in repo | Verified via pre-commit scan and git history check. |
| **NFR-06** | **Storm Triage Latency** | p95 < 2 s warm | 1,000 alerts, ~800 nodes; Day-1 gate G4. |
| **NFR-07** | **Hunter Round Latency** | p95 < 1.5 s | Copy + apply + E/F/O; gates G1, G2. |
| **NFR-08** | **Graph Copy** | p95 < 500 ms; 10 concurrent | Template ~800 nodes / ~3,000 edges; gate G2. |

> **V5.1 revision (conflict C-06):** **NFR-03** budget is now **≤ 12 tool calls** (07 §12.2). All targets above are provisional until the Day-1 gate (07 §13).

---

## 3. Architecture Risk Register (Top 15 Risks)

| Risk ID | Severity | Category | Risk Description | Failure Mode & Impact | Concrete V4.0 Mitigation |
| :---: | :---: | :--- | :--- | :--- | :--- |
| **RSK-01** | **P0** | Verification | **False Containment via Scope Blindness** | Verifying only the mitigated workload ignores alternate pods reaching the target DB (Scenario C). | Verifier always evaluates **Target Database Scope** (`target_db_id`), scanning all workloads with access to that crown jewel. |
| **RSK-02** | **P0** | Logic | **Inconclusive Masking** | An error, timeout, or stale record in another workload gets swallowed as "0 paths", creating false safety. | Three-valued logic: If ANY workload targeting the asset returns `INCONCLUSIVE`, the overall status is `INCONCLUSIVE`. |
| **RSK-03** | **P0** | Simulation | **Additive NetworkPolicy Violation** | Simulating policy by directly deleting `CAN_REACH` edges ignores Kubernetes additive allow semantics. | Model explicit `NetworkPolicy` objects with pod selector, egress rules, and namespace; evaluate effective connectivity. |
| **RSK-04** | **P0** | Security | **Agent Prompt Injection** | Malicious CVE description or cluster label instructs agent to run unauthorized actions. | Strict XML tagging, Pydantic type coercion, and Action Gateway authorization independent of LLM reasoning. |
| **RSK-05** | **P0** | Integrity | **Stale Evidence Decision** | Decisions executed against telemetry whose `valid_until` timestamp has expired. | Canonical qualification engine strictly checks `now() > valid_until` on every edge; marks status `INCONCLUSIVE`. |
| **RSK-06** | **P1** | State | **Graph Revision Drift** | Infrastructure updates occur between simulation and live execution without invalidation. | Atomic application `graph_revision` counter. Action Gateway enforces `candidate.baseline_rev == current_rev`. |
| **RSK-07** | **P1** | Agent | **Agent Infinite Tool Loop** | Agent gets stuck in reasoning loop, consuming API budget and exceeding demo latency. | Hard tool budget limit (max 5 iterations); deterministic stop conditions when paths are classified. |
| **RSK-08** | **P1** | Scope | **Unimplemented Action in Allowlist** | `REVOKE_IAM_PERMISSION` listed in allowlist but simulator only implements NetworkPolicy. | Scope pruning: Remove IAM revocation from MVP allowlist; support only `APPLY_NETWORK_POLICY_ISOLATE`. |
| **RSK-09** | **P1** | Concurrency | **Duplicate Action Execution** | Operator double-clicks or agent retries on timeout, causing duplicated cluster operations. | Idempotency key cache with atomic check-and-set in Action Gateway returning cached execution receipt. |
| **RSK-10** | **P1** | Performance | **Combinatorial Cypher Explosion** | Unbounded path traversals (`[*..]`) cause FalkorDB query timeouts. | Bounded path traversals (`*1..4`), indexed node IDs, and early filtering on `pod.id` and `target_db.id`. |
| **RSK-11** | **P1** | Algorithm | **Centrality Failure / Timeout** | `algo.betweenness` procedure unavailable or slow in Docker container, blocking investigation. | Centrality designated as P1 asynchronous ranking signal; failure caught gracefully without blocking P0 flow. |
| **RSK-12** | **P1** | Deployment | **Transient Docker Startup Failure** | FalkorDB container not ready before backend API attempts initial graph connection. | Docker Compose `healthcheck` on FalkorDB port 6379 with exponential backoff connection retries in FastAPI. |
| **RSK-13** | **P2** | Audit | **Audit Log Tampering** | Audit events stored in mutable flat JSON files without tamper verification. | Append-only event store with cryptographic SHA-256 hash-chaining linking event sequence numbers. |
| **RSK-14** | **P2** | UX | **Visual Graph Overload** | Graph visualizer displays 100+ raw nodes, confusing the judges in a 3-minute video. | Subgraph focus: Render only active attack paths, affected workloads, and candidate severed edges. |
| **RSK-15** | **P2** | Identity | **Overpromising Cloud IAM Semantics** | Claiming full AWS/GCP IAM evaluation when real cloud policies have conditions, SCPs, and trust boundaries. | Documented MVP scope: Explicitly models simplified permission mapping (`action: 'rds-db:connect'`, `effect: 'Allow'`). |
| **RSK-16** | **P0** | Verification | **Shared Construction Blind Spot** (V5.1) | Max-flow and oracle share the ATTACK_STEP construction; a construction bug on long paths escapes both. | Bounded equivalence test TC-19, transition tests TC-21, beyond-bound test TC-28; stated in certificate exclusions (07 §4.4). |
| **RSK-17** | **P0** | Algorithm | **Max-Flow Behaviour Differs from Docs** (V5.1) | Undirected treatment, ignored types or capacities → wrong verification. | Day-1 gate G1 with oracle agreement; Cypher-existence fallback (07 §13). |
| **RSK-18** | **P1** | Honesty | **Generator Bias Read as Real-World Ratio** (V5.1) | Funnel ratios look like product claims. | Seed and parameters disclosed; label "synthetic dataset"; outcomes never generated (07 §10.1). |
| **RSK-19** | **P1** | Performance | **Catalogue or Chain Explosion** (V5.1) | Dense graphs exceed caps; exactness lost. | Caps with explicit `PLANNING_INCONCLUSIVE` reasons; `NOT_EXACT` plans still verified by the Hunter (07 §7.7). |
| **RSK-20** | **P1** | Security | **Sandbox Authorization Bypass** (V5.1) | A visitor edits another sandbox or the template. | Server-derived graph keys, typed IDs, existence checks, no graph-key or Cypher fields (07 §11, TC-35). |

---

## 4. Preserved Specification Contradictions
> **V5.1 note:** New and still-open conflicts (C-01…C-20) are tracked in [07 §14](07_V5_ENGINE_SPECIFICATION.md). The "Tool Budget" row below is superseded by C-06 (12 calls).

| Item / Concept | Contradiction Detected Across Source Documents | Authoritative V4.1 Resolution |
| :---: | :--- | :--- |
| **Action Allowlist** | `PROBLEM_STATEMENT.md` listed `REVOKE_IAM_PERMISSION` and `APPLY_NETWORK_POLICY_ISOLATE`; ADR-02 and `SECURITY_THREAT_MODEL.md` pruned IAM revocation. | **Pruned from MVP.** Action allowlist contains strictly `APPLY_NETWORK_POLICY_ISOLATE`. IAM is read-only. |
| **Simulation Status** | V3 used `SIMULATED_RESOLVED`; V3.2 used `SIMULATED_CONTAINMENT`; V4 added `SIMULATED_RESIDUAL_EXPOSURE`. | **Canonical Enum Enforced:** `SIMULATED_CONTAINMENT`, `SIMULATED_RESIDUAL_EXPOSURE`, `SIMULATION_REJECTED`, `SIMULATION_INCONCLUSIVE`. |
| **Tool Budget** | Mentioned "5-call budget" without clarifying whether it meant reasoning turns or graph queries. | **Clarified:** Maximum 5 tool invocations total per investigation lifecycle. Deterministic halt enforced. |
| **Kubernetes Semantics** | V3 claimed production-grade K8s NetworkPolicy simulation by port filtering. | **Clarified:** Formally designated as *Deterministic Synthetic Policy Engine*, modeling additive allowlist rules. |
| **Algorithm Role** | Demo script implied centrality was mandatory P0 for proof of exploitability. | **Demoted to P1 Ranking Signal:** Centrality ranks candidate choke points; containment proof is governed by reachability. |

### 4.1 Resolved Defect History (V3.1 → V3.2)
Kept as the rationale behind current design choices.

| Defect | Previous Defect | Correction | Verified By |
| :---: | :--- | :--- | :--- |
| **DEF-01** (P0) | One query with multiple `OPTIONAL MATCH` clauses caused row multiplication; null maps passed truthy checks. | Split into 4 disjoint queries (1A–1D); missing tiers return empty lists; active CVE status validated. | TC-02, TC-04 |
| **DEF-02** (P0) | `blocked_port=None` branch always wiped all reachability regardless of policy. | Full block clears all egress; port block clears only that port; other workloads preserved. | TC-06, TC-07 |
| **DEF-03** (P0) | Simulation evaluated only one workload; missed Scenario C. | Simulator evaluates the complete target scope and lists residual chain IDs. | TC-03 |
| **DEF-04** (P0) | Checked `verified=true` but ignored `valid_until`; stale evidence could qualify. | `now > valid_until` forces `INCONCLUSIVE`. | TC-05 |
| **DEF-05** (P1) | `graph_revision` referenced but never implemented. | Atomic revision counter; gateway enforces baseline == current. | TC-08 |
| **DEF-06** (P1) | Status names mixed (`SIMULATED_RESOLVED` etc.). | Single canonical enum set (doc 01 §1). | Audit schema validation |

---

## 5. Day-by-Day Build Sequence (Oct 15–18)
> **Superseded (V5/V5.1):** the authoritative schedule is [06 §10](06_WINNING_PLAN.md) with its V5.1 adjustments, and the Day-1 validation gate is [07 §13](07_V5_ENGINE_SPECIFICATION.md). Original sequence preserved.

### Day 1 (Oct 15): Prove the Graph Core
First tasks (these can only be checked against the running container):
1. **Pin the container version:** start `falkordb/falkordb:latest`, record the exact version, pin it in `docker-compose.yml`.
2. **Validate `algo.betweenness`:** run Query 3 in the container; if unavailable, enable the degree-centrality fallback.
3. **Measure latency:** time Queries 1A–1D on the seeded data and replace the provisional targets in doc 03.

Then: seed the synthetic dataset for Scenarios A, B, C with stable IDs (`auth-service-pod`, `batch-worker-pod`, `analytics-worker-pod`, `prod-payments-db`); run Queries 1A–1D, 2, 3, 5 via `falkordb-python`; assert non-empty tiers for Scenario A and empty reachability for Scenario B; remove the `UNVALIDATED` flags once verified.

### Day 2 (Oct 16): Prove the Remediation Lifecycle
Implement the qualification engine, candidate simulator, Action Gateway (allowlist `['APPLY_NETWORK_POLICY_ISOLATE']`, idempotency, revision check), and verifier. All 12 acceptance tests must pass before any LLM or frontend work.

### Day 3 (Oct 17): Agent Tool Loop & UI Workbench
Connect the LLM through the constrained tool contracts; build the React + Vite 3-pane Workbench with the Evidence Confidence Panel and an observed-vs-candidate topology view.

### Day 4 (Oct 18): Freeze, Harden & Submit
Clean-slate `docker compose up --build`; secret scan; finalize README and AI-use disclosure; record the 3-minute video; submit before 11:59 PM IST.

---

## 6. 3-Minute Demo Script & Official Submission Checklist

### 6.1 The 3-Minute Demo Script
```
[00:00 - 00:45] The Problem & Grounding
- Open Interdict dashboard with live synthetic cloud topology (50+ nodes) in FalkorDB.
- Ingest Alert: "DEMO-CVE-001 detected on auth-service-pod".
- Show Agent invoking find_evidence_by_workload() via FalkorDB.

[00:45 - 01:30] Independent Evidence Tiers & Choke Points
- Display the 4 independent evidence tiers:
  1. Exposure: Internet -> Ingress -> auth-service-pod (Present).
  2. Vulnerability: Image has DEMO-CVE-001 (Critical).
  3. Reachability: CAN_REACH verified to prod-payments-db (Present).
  4. Authorization: IAMRole grants 'Allow' on prod-payments-db (Present).
- Modeled Chain Status: QUALIFYING_MODELED_CHAIN.
- Agent invokes FalkorDB Betweenness Centrality (algo.betweenness) to evaluate topological choke points.

[01:30 - 02:15] Counterfactual Candidate Simulation
- Agent evaluates candidate action: NetworkPolicy isolating auth-service-pod.
- Calls simulate_remediation(): Shows candidate graph evaluation breaking the reachability edge in memory without mutating DB.
- Action submitted to Action Gateway in SIMULATION mode.

[02:15 - 03:00] Verification Proof & The Two Differentiators
- Agent calls verify_remediation() across target database scope:
  - Scenario A: Qualifying chains drop to 0 -> SIMULATED_CONTAINMENT confirmed.
- Show Scenario B (Negative Control / Restraint):
  - batch-worker-pod has DEMO-CVE-001, but lacks exposure and reachability -> Agent reports low contextual risk and avoids disruptive isolation!
- Show Scenario C (Residual Risk / Honesty):
  - Isolating auth-service-pod leaves analytics-worker-pod reachable to prod-payments-db -> Agent refuses to claim full containment and emits SIMULATED_RESIDUAL_EXPOSURE!
- Conclude with Evidence Confidence Panel and hash-chained audit timeline.
```

### 6.2 Official Submission Checklist (7 Deliverables)
- [ ] **1. Public GitHub Repository:** Clean code, free of secrets or personal keys, with open-source license.
- [ ] **2. README & Graph Model:** Full setup instructions, architecture diagrams, and exact node/edge schemas.
- [ ] **3. Cypher Queries & Algorithm Suite:** Canonical Cypher templates and `CALL algo.betweenness` documentation.
- [ ] **4. Working Demo Video:** 3-minute walkthrough demonstrating live alert -> evidence -> simulation -> proof & residual risk.
- [ ] **5. Live Deployment / Docker Compose:** Clean 1-command startup: `docker compose up --build`.
- [ ] **6. Explicit Track Declaration:** Formally entering **Track 01 — Agents That Act on Connected Data**.
- [ ] **7. AI Usage Disclosure:** Full transparency on coding assistant collaboration and architectural verification.
