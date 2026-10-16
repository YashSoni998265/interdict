# Interdict V4.2: Master Overview, Problem Statement & Scope

> Status: Pre-event planning notes (Interdict V4.2). Ideas and design sketches only; all implementation is written fresh during the hackathon (Rule 8). Where this conflicts with [06_WINNING_PLAN.md](06_WINNING_PLAN.md), the V5 plan wins (see its §0).

---

## 1. Executive Summary & Hackathon Positioning

- **Hackathon Event:** WeMakeDevs × FalkorDB Graph Hacks (Context for AI Agents)
- **Competition Window:** October 15, 2026, 12:01 AM IST – October 18, 2026, 11:59 PM IST
- **Track Selection:** **Track 01 — Agents That Act on Connected Data** (Prize: iPhone 18 Pro per team member)
- **Team Size:** Solo or up to 4 members
- **Core Mission:** Build an autonomous cloud-security investigation and remediation agent whose decisions and actions are **strictly determined by connected graph data in FalkorDB**.
- **The Non-Negotiable Rule:** *If FalkorDB is removed from the system and the product continues to function identically, the submission is disqualified.*

---

## 2. Problem Statement: Alert Fatigue vs. Attack Path Reality

### 2.1 The Cloud Security Dilemma
Modern cloud-native environments (Kubernetes clusters, multi-cloud VPCs, microservices) produce hundreds to thousands of daily vulnerability and configuration alerts. Security and DevOps engineers suffer from severe **alert fatigue**:
1. An alert stating `"Vulnerability detected on pod auth-svc"` (e.g., `DEMO-CVE-001`) does not reveal if `auth-svc` is actually exposed to an untrusted public internet ingress.
2. It does not prove whether the pod possesses an IAM role granting write/connect access to sensitive customer databases (crown jewels).
3. It cannot calculate whether the workload is a critical topological choke point connecting isolated infrastructure zones.
4. Engineers manually cross-reference 5 to 10 distinct tools (cloud consoles, Kubernetes manifests, IAM policies, network security groups, CVE feeds) taking hours while zero-day attacks unfold.

### 2.2 Why Traditional AI & Flat Vector Approaches Fail
- **Flat Vector Databases (RAG):** Retrieve isolated text chunks via cosine similarity, completely blind to multi-hop directional traversals, network topology, and IAM permission chains.
- **Context Window Dumping:** Stuffing thousands of raw Kubernetes manifests and VPC route tables into an LLM prompt leads to hallucinated connections, context rot, astronomical token costs, unpredictable actions, and high latency.
- **Passive "AI Dashboards":** Querying a database and drawing a visual graph on the side violates the hackathon's core requirement. The LLM must not be an alert-explainer; it must be an **investigation orchestrator acting on graph evidence**.

---

## 3. Product Vision & Differentiating Capabilities

`Interdict` is **not a passive visualization dashboard**. It is an **autonomous, evidence-driven attack-path investigation and remediation agent** that:
1. **Investigates** infrastructure incidents through multi-hop Cypher queries in FalkorDB across 4 independent evidence tiers:
   - **Public Exposure Tier:** Inbound routes from external internet to workloads.
   - **Vulnerability Tier:** Workload container image vulnerability metadata records.
   - **Network Reachability Tier:** Active, verified network connectivity between endpoints (`CAN_REACH`).
   - **Identity Authorization Tier:** IAM roles granting explicit `Allow` permissions to crown jewels.
2. **Qualifies Modeled Attack Chains:** Determines whether all four tiers coincide on target databases without confusing a modeled risk chain with proven real-world exploitation.
3. **The Remediation Decision Workbench (V4.0 Signature Feature):** An A/B mitigation comparison engine evaluating:
   - **Candidate A (Surgical DB Isolation):** Restricting database egress port 5432 while preserving DNS (port 53) and inter-service HTTP.
   - **Candidate B (Hard Workload Severance):** Blanket egress quarantine with critical operational disruption.
4. **Counterfactual Evaluation & Verification:**
   - **Simulation Mode (Default):** Evaluates candidate policy changes against in-memory candidate overlays without mutating the baseline FalkorDB graph. Yields `SIMULATED_CONTAINMENT` or `SIMULATED_RESIDUAL_EXPOSURE`.
   - **Live Mode (If Authorized):** Executes the change through an independent Action Gateway, refreshes observed evidence, and yields `VERIFIED_CONTAINED`, `RESIDUAL_EXPOSURE`, or `INCONCLUSIVE`.
5. **Honest Uncertainty & Residual Risk Reporting:** If multiple attack paths exist to a crown jewel (Scenario C) and a mitigation only isolates one workload, Interdict **refuses to claim complete containment** and explicitly lists remaining active attack chains.

---

## 4. The 5 Core Engineering Principles

```
[1. Grounded Evidence]          --> Graph claims backed by FalkorDB; external facts identify their own source & validation.
[2. Secure by Default]          --> The LLM is NEVER the security boundary; actions pass through an independent gateway.
[3. Constrained Execution]       --> Tool selection with parameterized templates, bounded depth, and non-blocking tasks.
[4. Observable Decisions]        --> Distributed correlation IDs connecting alerts -> queries -> tools -> outcomes.
[5. Demonstrable Correctness]    --> Passes the critical path test, negative control test, and partial-remediation test.
```

1. **Grounded Evidence:** Every graph-topology claim must be grounded in FalkorDB evidence. Every external fact, model-derived conclusion, and remediation outcome must identify its own source and validation method.
2. **Secure by Default:** The LLM is never the security boundary. Even if the LLM recommends a remediation, an independent backend gateway validates policy scope, action allowlists, and execution parameters.
3. **Constrained Execution:** The agent selects tools that invoke predefined, parameterized Cypher templates with bounded traversal depths. Raw, free-form Cypher generation by the LLM is strictly prohibited.
4. **Observable Decisions:** Every investigation generates an auditable trace connecting the raw alert, Cypher query execution, algorithm outputs, LLM tool calls, candidate simulations, and post-action verification.
5. **Demonstrable Correctness:** The system must succeed on critical attack paths, avoid overreacting to isolated vulnerabilities (negative controls), and explicitly warn operators when an action leaves residual attack paths intact.

---

## 5. Scope & Feature Priority Matrix (4-Day MVP Boundary)

> **Superseded (V5/V5.1):** current scope is [06 §3 and §3.1](06_WINNING_PLAN.md); engine behaviour is canonical in [07](07_V5_ENGINE_SPECIFICATION.md). Matrix preserved below.

### Scope Boundary
- **Infrastructure Target:** Synthetic cloud infrastructure modeling Kubernetes workloads, network connectivity, and cloud IAM permissions.
- **Execution Mode:** Simulation-first remediation adapter with full counterfactual evaluation. Optional real Kubernetes integration if time permits.

| Priority | Feature / Capability | Description & Justification |
| :---: | :--- | :--- |
| **P0** | **Independent Evidence Discovery** | Parameterized Cypher queries evaluating exposure, vulnerability, reachability, and authorization independently. |
| **P0** | **Deterministic Chain Qualification** | Python backend combines evidence by stable workload/target IDs; reports absent/stale tiers explicitly. |
| **P0** | **Counterfactual Simulation Engine** | Candidate-state evaluation in memory without mutating observed baseline graph. |
| **P0** | **Target-Scope Verification** | Verifies containment across target database scope to catch alternate qualifying workloads (Scenario C). |
| **P0** | **Auditable Action Gateway** | Strictly allowlisted remediation interface with input validation, idempotency keys, and explicit safety boundaries. |
| **P0** | **Deterministic Verification Suite** | Automated test suite proving correctness across Scenarios A, B, and C. |
| **P1** | **Topological Choke Point Ranking** | Betweenness centrality (`algo.betweenness`) with fixed sampling seed as a prioritization signal. |
| **P1** | **Remediation Decision Workbench** | 3-pane UI layout comparing Surgical vs. Hard Isolation trade-offs. |
| **P1** | **Evidence Confidence Panel** | UI panel exposing graph evidence status, security feasibility, and action verification status. |
| **P2** | **Persistent Incident Memory** | Store historical incident outcomes in FalkorDB (secondary extension). |

---

## 6. The 3 Demo Scenarios (Proof of Intelligence)

- **Scenario A — Critical Attack Path (Full Containment):**
  - Internet-facing pod `auth-service-pod` with `DEMO-CVE-001` has both verified network reachability (`CAN_REACH`) and active IAM authorization (`Allow`) to `prod-payments-db`.
  - *Expected Agent Behavior:* Identifies all 4 tiers, simulates candidate network isolation, executes/simulates policy, verifies target reachability drops to 0 qualifying chains, and confirms containment (`SIMULATED_CONTAINMENT` or `VERIFIED_CONTAINED`).
- **Scenario B — Vulnerability Without Exposure / Reachability (Negative Control / Restraint):**
  - Internal batch worker `batch-worker-pod` has the identical critical vulnerability (`DEMO-CVE-001`), but lacks internet exposure and has no `CAN_REACH` edge to crown jewels.
  - *Expected Agent Behavior:* Evaluates tiers independently. Explicitly reports vulnerability is critical, but exposure and reachability are absent. Concludes low contextual risk and avoids unnecessary disruptive isolation.
- **Scenario C — Multi-Workload Exposure & Partial Remediation (Residual Risk / Honesty):**
  - Two distinct workloads (`auth-service-pod` and `analytics-worker-pod`) both have qualifying chains to `prod-payments-db`.
  - *Expected Agent Behavior:* Evaluates candidate isolation on `auth-service-pod`, verifies target-level scope, discovers that `analytics-worker-pod` still maintains an active qualifying chain, emits `RESIDUAL_EXPOSURE`, and recommends layered remediation.

---

## 7. Revised 4-Day Vertical Slice Delivery Strategy

| Day & Date | Vertical Slice Objective | Tangible Deliverables |
| :--- | :--- | :--- |
| **Day 1 (Oct 15)** | **Vertical Slice 1: Grounded Evidence Core** | Dockerized FalkorDB running with synthetic Scenarios A, B, C; execute queries 1A–1D; pass basic qualification tests. |
| **Day 2 (Oct 16)** | **Vertical Slice 2: Counterfactual Decision Engine** | In-memory candidate simulator; A/B candidate ranking; Action Gateway allowlist & idempotency; pass all 12 acceptance tests. |
| **Day 3 (Oct 17)** | **Vertical Slice 3: Agent Tool Loop & UI Workbench** | Connect LLM agent with 5-iteration budget; render 3-pane Remediation Decision Workbench in React + Vite; live visual graph. |
| **Day 4 (Oct 18)** | **Vertical Slice 4: Hardening, Video & Submission** | Clean Docker startup check; pre-commit secret scans; record 3-minute video showing Scenarios A, B, C; submit by 11:59 PM IST. |

---

## 8. Preserved Technical Contradictions & Unresolved Product Decisions

### 8.1 Action Allowlist Scope Discrepancy
- *Source A (`PROBLEM_STATEMENT.md`):* Includes `APPLY_NETWORK_POLICY_ISOLATE` and `REVOKE_IAM_PERMISSION`.
- *Source B (`TECHNICAL_DECISION_LOG.md` ADR-02, `SECURITY_THREAT_MODEL.md`):* Prunes `REVOKE_IAM_PERMISSION` from MVP allowlist to eliminate complex cloud IAM policy modeling risk.
- *Status:* Preserved contradiction for reviewer decision. Recommendation is to follow ADR-02 and prune IAM revocation from active execution.

### 8.2 Simulation Status Naming Discrepancy
- *Source A (`PROBLEM_STATEMENT.md` table):* Uses `SIMULATED_RESOLVED`.
- *Source B (`02_GRAPH_DATA_MODEL.md`, `EVIDENCE_STATE_AND_DECISION_TABLE.md`):* Uses `SIMULATED_CONTAINMENT` and `SIMULATED_RESIDUAL_EXPOSURE`.
- *Status:* Preserved discrepancy. Canonical recommendation is `SIMULATED_CONTAINMENT`.

### 8.3 Unresolved Product Decisions Requiring Human Sign-Off
1. **FalkorDB Tag Pinning:** Whether to pin semantic tag or use latest during Day 1 build.
2. **Centrality Fallback Policy:** Whether degree centrality fallback activates immediately if `algo.betweenness` procedure fails.
3. **Simulation vs. Live K8s Adapter:** Whether live execution remains 100% disabled or available via toggle.
