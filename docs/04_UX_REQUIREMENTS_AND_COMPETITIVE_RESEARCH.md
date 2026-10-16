# Interdict V4.2: UX Requirements & Competitive Research

> Status: Pre-event planning notes (Interdict V4.2). Ideas and design sketches only; all implementation is written fresh during the hackathon (Rule 8). Where this conflicts with [06_WINNING_PLAN.md](06_WINNING_PLAN.md), the V5 plan wins (see its §0).

---

## 1. UX Philosophy: The "Anti-Black-Box" Interface
Most AI security demos fail because the interface is simply a generic chatbot window next to a cluttered graph viewer. The user cannot see:
- *Why* the agent chose a specific tool.
- *What* the agent verified versus what it assumed.
- *What* operational side effects will occur if the recommended remediation is applied.

Interdict is built around a single signature experience: **The Remediation Decision Workbench**.

---

## 2. The 3-Pane Decision Workbench Layout

```
+---------------------------------------------------------------------------------------------------+
|  INTERDICT AUTOPILOT       |  Active Incident: INC-4092 (auth-service-pod)  | Status: ANALYZING   |
+------------------------------------+----------------------------------+---------------------------+
|  PANE 1: Evidence Graph & Tiers    |  PANE 2: Remediation Workbench   |  PANE 3: Verification &   |
|                                    |  (A/B Tradeoff Comparison)       |          Audit Proof      |
|  [Interactive Subgraph Topology]   |                                  |                           |
|   (Internet) -> (Ingress) -> (Pod) |  Candidate A: Surgical Isolation |  Evidence Confidence:     |
|         |               |          |  - Type: NetworkPolicy (Egress)  |  - Graph Evidence: VALID  |
|         v               v          |  - Target Port: 5432 (Postgres)  |  - Feasibility: QUALIFIED |
|       (CVE)          (Crown DB)    |  - Paths Severed: 1 of 1         |  - Verification: PENDING  |
|                                    |  - Service Disruption: LOW       |                           |
|  Evidence Tiers Status:            |  [ RECOMMENDED BY AGENT ]        |  Candidate Outcome:       |
|  [✓] 1. Public Exposure            |  ------------------------------- |  SIMULATED_CONTAINMENT    |
|  [✓] 2. Active DEMO-CVE-001        |  Candidate B: Hard Isolation     |  - Baseline Chains: 1     |
|  [✓] 3. CAN_REACH (Port 5432)      |  - Type: Full Workload Severance |  - Residual Chains: 0     |
|  [✓] 4. IAM Allow (rds:connect)    |  - Paths Severed: 1 of 1         |  - Residual Scope: CLEAR  |
|                                    |  - Service Disruption: CRITICAL  |                           |
|  Modeled Chain: QUALIFIED          |    (Blocks DNS & Billing API)    |  [ Execute Simulation ]   |
|                                    |                                  |                           |
|  Choke Point Score: [Rank 1]       |  [ Select & Compare in Canvas ]  |  [ Approve Live Action ]  |
+------------------------------------+----------------------------------+---------------------------+
|  BOTTOM BAR: Append-Only Audit Stream | Event #14 | trace_id: tr-81f9 | Hash: e3b0c442...        |
+---------------------------------------------------------------------------------------------------+
```

---

## 3. UI State Coverage & Visual Deltas

1. **Loading / Analyzing:** Pulse animation indicating which specific evidence tier is currently being retrieved from FalkorDB.
2. **Scenario A (Critical Path):** Crimson highlight on the 4-tier chain $\rightarrow$ Candidate A preview renders dashed violet severance $\rightarrow$ Green `SIMULATED_CONTAINMENT` banner.
3. **Scenario B (Negative Control):** Amber card indicating *Vulnerability Critical, but Public Exposure / Reachability Absent*. Message: *Disruptive containment avoided due to absence of environmental path*.
4. **Scenario C (Residual Risk):** High-visibility Orange alert: *Workload 1 isolated, but Alternate Workload 2 (analytics-worker) retains active path to prod-payments-db*.
5. **Inconclusive / Stale Evidence:** Yellow warning flag: *Telemetry expired past valid_until; manual verification required*.
6. **Simulation Rejected:** Red notification explaining unsupported or malformed policy parameters.

### UI Design Rules
1. **No Blank Spinners:** Show real-time lifecycle progress (`INGESTED` → `ANALYZING` → `EVALUATING` → `SIMULATING` → `VERIFIED`).
2. **Visual Delta Highlighting:** Active attack paths in crimson/amber; candidate severed edges as dashed violet lines with strikethroughs; residual paths (Scenario C) in high-visibility orange.
3. **Evidence Drill-Down Drawer:** Clicking any edge opens an inspection card showing `evidence_source`, `observed_at`, and `valid_until`.
4. **Subgraph Focus:** Render only active attack paths, affected workloads, and candidate severed edges, never the full raw graph (RSK-14).

---

## 4. Metric Classification Schema (Eliminating Fabricated Precision)

| Displayed Metric | Category | Computation Method / Grounding Source |
| :--- | :--- | :--- |
| **Active Qualifying Chains** | `CALCULATED_GRAPH` | Evaluated dynamically from FalkorDB evidence tiers in Python. |
| **Downstream Affected Assets** | `CALCULATED_GRAPH` | Distinct count of nodes reached via `CAN_REACH` query. |
| **Topological Choke Point Score** | `MEASURED_ALGO` (P1) | Output of `CALL algo.betweenness` with sampling seed 42. (Label: *Topological Centrality*). |
| **Surgical Policy Disruption** | `SYNTHETIC_MODEL` | Modeled as *Low (Preserves DNS & Inter-Service HTTP)* based on synthetic policy spec. |
| **Hard Isolation Disruption** | `SYNTHETIC_MODEL` | Modeled as *Critical (Blocks 100% egress traffic including cluster DNS)*. |
| **Query Latency (ms)** | `MEASURED_RUNTIME` | Wall-clock execution time recorded via Python `time.perf_counter()`. |

> **V5.1 additions** ([07 §7, §10](07_V5_ENGINE_SPECIFICATION.md)). The two `SYNTHETIC_MODEL` disruption rows above are superseded for planned fixes: disruption is now computed.

| Displayed Metric | Category | Computation Method / Grounding Source |
| :--- | :--- | :--- |
| **Alert triage counts (funnel)** | `CALCULATED_GRAPH` | Triage partition over ATTACK_STEP reachability on the seeded synthetic dataset; seed and parameters disclosed. |
| **Declared dependencies broken by a plan** | `CALCULATED_GRAPH` over `DECLARED_FIXTURE` | Count of `DEPENDS_ON` edges outside the plan's allow lists. Label: "declared dependencies (synthetic fixture)". |
| **Blocked flows with unknown impact** | `CALCULATED_GRAPH` | Blocked observed flows from pods whose dependency manifest is `PARTIAL` or `NONE`. Never shown as zero disruption. |
| **Hunter result / certificate** | `CALCULATED_GRAPH` + `MEASURED_ALGO` | Agreement of enumerator, `algo.maxFlow` and oracle; label "Model-verified containment", never "contained" alone. |

---

## 5. Grounded Competitive Research & Evidence Ledger

### 5.1 Verified Commercial Context vs. Interdict
- **Snapshot Polling vs. Real-Time In-Memory Traversal:** Commercial CNAPPs (Wiz, Orca) prioritize agentless API polling and scheduled snapshots ([Wiz Architecture Overview](https://docs.wiz.io)). Interdict leverages FalkorDB for sub-second, multi-hop in-memory traversals on every step of an agent loop.
- **Ticketing Workflows vs. Closed-Loop Autopilot:** Incumbent tools integrate primarily with Jira, Slack, and SIEM/SOAR webhooks ([Orca Automation Docs](https://orca.security)). Interdict executes counterfactual simulation, models candidate policy overlays, and verifies residual risk directly.
- **Proprietary Risk Scores vs. Three-Valued Logic:** CNAPPs utilize 0–100 proprietary risk scores that average out missing data. Interdict enforces Kleene three-valued logic, returning `INCONCLUSIVE` whenever telemetry is missing or expired.

### 5.2 Unsubstantiated Competitor Claims Removed
- Prior drafts contained universal assertions that competitors "cannot simulate" or "have no verification". These unsupported negative claims were pruned in V4.1. Differentiation is grounded strictly in Interdict's unique FalkorDB-driven architecture.
