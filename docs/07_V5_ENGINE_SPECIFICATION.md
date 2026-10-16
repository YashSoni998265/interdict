# Interdict V5.1: Canonical Engine Specification

> **Authority:** [`/solution.md`](../solution.md) is the canonical end-to-end specification and takes precedence over this document wherever they conflict.
> Status: Pre-event design specification (2026-10-14). Planning notes only, no implementation code (Rule 8).
> **Not runtime-validated.** Every FalkorDB behaviour marked **[GATE]** is an assumption until it passes the Day-1 validation gate (§13). Marks used: **[DESIGN]** = argued on paper in this document; **[GATE]** = must be measured on the pinned container; **[OPEN]** = unresolved, recorded in §14.

---

## 0. Authority and Document Map

This document is canonical for the topics below. Earlier material on the same topics is preserved in docs 00–06 and marked "superseded by 07 §x".

| Topic | Canonical location |
| :--- | :--- |
| Problem, vision, original scenarios A–C | 00 |
| Base node/edge schema, tier queries 1A–1D, 2, 3, 5, collection statuses, truth table | 01 (extended by 07 §2–§3) |
| Architecture, lifecycle, ADR-01…ADR-08 | 02 |
| STRIDE threat model, Action Gateway, audit hash chain | 03 |
| UX, layouts, metric classification | 04 (status labels: 07 §12.1) |
| FR/NFR catalogue, risk register, defect history | 05 (FR-11…FR-19 added from 07 §12.3) |
| Strategy, stack, deployment, team workflow, schedule | 06 |
| **Threat model ITM-1, derived ATTACK_STEP graph, policy semantics, action catalogue, planner, Path Hunter, certificate, Alert Storm, sandbox operations** | **07 §3–§11** |
| **Status enum registry, MCP tool registry, TC-13 onward, Day-1 gate, conflict register** | **07 §12–§14** |

### 0.1 Adopted provisional decisions (2026-10-14)
1. **Adversary model:** the planner enumerates chains with ≤ 3 lateral hops; the deterministic Path Hunter searches the derived ATTACK_STEP graph with no hop bound, over all modelled crown jewels and ports. No certificate if verification is incomplete, a residual path remains, or any query fails.
2. **Dependencies:** explicitly labelled synthetic declared dependencies; at least one scenario where the attack path overlaps legitimate traffic (no zero-disruption fix exists); unknown dependencies count as unknown impact, never zero; no production-behaviour claims.
3. **Scope:** P0 = Alert Storm, exact remediation planning, deterministic Path Hunter, model-verified containment certificates, five typed sandbox operations. P1 = minimal temporal attribution, choke-point ranking. Deferred = public MCP endpoint, PR Guard, certificate signing, time slider, WCC segments, report export. Memory must not jeopardise the core workflow.

### 0.2 Constants

| Name | Value | Meaning |
| :--- | :---: | :--- |
| `MAX_LATERAL_HOPS_PLANNER` (L) | 3 | Lateral hops in the planner's bounded enumeration |
| `MAX_PLAN_ACTIONS` (k) | 3 | Maximum actions in a plan |
| `MAX_HUNT_ROUNDS` (R) | 5 | Plan → hunt → re-plan rounds |
| `CATALOGUE_CAP` | 30 | Maximum candidate actions per planning problem |
| `CHAIN_ENUM_CAP` | 10,000 | Maximum enumerated chains per planning problem |
| `CERT_MAX_TTL` | 24 h | Upper bound on certificate lifetime |
| `SANDBOX_OP_CAP` | 20 | Sandbox operations per session |
| `QUERY_TIMEOUT_MS` | 500 (provisional) | Per-query timeout; storm batch queries may use a higher cap set at Day 1 |

---

## 1. Design Summary

```
Alerts ──► Triage (partition every alert, three-valued)
              │
              ▼
        Attack-path clusters ──► Exact planner (allowlist actions, k ≤ 3, lexicographic objective)
                                      │
                                      ▼
                         Candidate graph (GRAPH.COPY) + policies applied
                                      │
                                      ▼
            Path Hunter: enumerator E + max-flow F + oracle O must agree
              │ residual path found → add to constraints → re-plan (≤ 5 rounds)
              ▼
        Model-verified containment certificate (or an honest non-certified status)
```

FalkorDB does the work at every stage: tier queries, lateral enumeration, ATTACK_STEP construction, `algo.maxFlow`, candidate graphs via `GRAPH.COPY`, sandboxes, memory, and audit. Python performs only the three-valued joins, the exact subset search over a small catalogue, and the independent oracle.

---

## 2. Graph Model Extensions (adds to doc 01 §2)

### 2.1 Global rules
- Every node has a unique, stable, domain-level `id` (used for hashing and audit; FalkorDB internal IDs are never exposed or hashed).
- Every evidence edge keeps the doc 01 provenance contract (`evidence_source`, `observed_at`, `verified`, `valid_until`).
- New `evidence_source` values: `SYNTHETIC_GENERATOR`, `DECLARED_FIXTURE`, `SANDBOX_USER_CHANGE`.

### 2.2 Additions

| Element | Properties | Purpose |
| :--- | :--- | :--- |
| `(:Pod)` (extended) | `namespace`, `labels` (map, must include `app`), `dependency_manifest: 'COMPLETE' \| 'PARTIAL' \| 'NONE'` | Selector matching; three-valued dependency knowledge |
| `(:Vulnerability)` (extended) | `attack_vector: 'NETWORK' \| 'ADJACENT' \| 'LOCAL' \| 'PHYSICAL'` (CVSS v3 AV); synthetic IDs only (`DEMO-CVE-…`) | Network exploitability for lateral transitions |
| `(:PlatformService {id:'kube-dns', namespace:'kube-system'})` | — | DNS as an explicit egress destination |
| `(:Alert)` | `id, severity, created_at, scanner, evidence_source:'SYNTHETIC_GENERATOR'` | Storm input |
| `(:Alert)-[:ON_WORKLOAD]->(:Pod)` · `(:Alert)-[:REFERENCES]->(:Vulnerability)` | — | Alert linkage |
| `(:Pod)-[:CAN_REACH {port, protocol, …provenance}]->(:Pod \| :Database \| :PlatformService)` | Generalises doc 01 (was Pod→Database only) | Observed reachability incl. lateral |
| `(:Pod)-[:DEPENDS_ON {port, protocol, evidence_source:'DECLARED_FIXTURE'}]->(:Pod \| :Database \| :PlatformService)` | — | Declared legitimate dependencies |
| `(:NetworkPolicy)` (extended) | `id, namespace, pod_selector (map), policy_types (list), managed_by: 'BASELINE' \| 'INTERDICT_CANDIDATE'` | Policy semantics (§5) |
| `(:NetworkPolicy)-[:SELECTS]->(:Pod)` | materialised from `pod_selector` + namespace | Fast selection lookup |
| `(:NetworkPolicy)-[:ALLOWS_EGRESS {port, protocol}]->(destination)` | — | Allow rules (no deny exists) |
| `[:ATTACK_STEP {kind:'ENTRY' \| 'LATERAL' \| 'GOAL', capacity:1, ports:[…], backing_evidence_ids:[…], built_at_revision}]` | **Derived; only in sandbox and candidate graphs** | Hunter / max-flow network (§4) |
| `(:Change {id, at, kind, ref})` and `introduced_by`, `valid_from` on evidence edges | **P1** | Temporal attribution |
| `(:Plan)`, `(:Certificate)` in `memory:{tenant}` | see §7, §9 | Memory and certificate metadata |

---

## 3. Threat Model ITM-1 (exploitable transitions)

### 3.1 Evaluation state and freshness
- A **graph state** `S` is one sandbox or candidate graph at revision `r`, evaluated at time `t`.
- An evidence item is **fresh** iff `verified = true` ∧ `observed_at ≤ t < valid_until`.
- The **evaluation scope** of a question is every pod, crown jewel, policy and evidence item that can create or remove an ATTACK_STEP edge. For Hunter and certificate questions, that is the whole sandbox (all crown jewels, all ports).
- **Scope completeness:** every evidence query over the scope returned `COLLECTED_COMPLETE` or `COLLECTED_EMPTY`, no item in scope is `STALE_EXPIRED` or `UNCOLLECTED`, no query failed or timed out, and the inventory is marked complete. **If scope completeness fails, no ATTACK_STEP graph is built and the result is `INCONCLUSIVE` (or `SIMULATION_INCONCLUSIVE` / `PLANNING_INCONCLUSIVE`).** Missing, stale, failed or incomplete evidence is never treated as absence.

### 3.2 Predicates (all over fresh evidence in state S)
- **Exposed(p):** a fresh chain `Internet -EXPOSES-> Ingress -ROUTES_TO-> Service -TARGETS-> p`.
- **NetVuln(p):** `p -RUNS_IMAGE-> img -HAS_VULNERABILITY-> v` with `v.status = 'ACTIVE'` and `v.attack_vector ∈ {NETWORK, ADJACENT}`. A missing `attack_vector` is treated as `NETWORK` (attacker-favourable over-approximation; flagged in output).
- **EffReach_S(a, d):** some port `π` such that a fresh observed `CAN_REACH(a→d, π)` exists **and** egress `(a, d, π)` is allowed in S by the policy semantics of §5.
- **Authorized(p, t):** `p -ASSUMES_ROLE-> role -GRANTS_ACCESS-> perm {effect:'Allow'} -APPLIES_TO-> t`, all fresh, `t.is_crown_jewel = true`.

### 3.3 Transitions (what an attacker may do in one step)

| Transition | From → To | Condition |
| :--- | :--- | :--- |
| **ENTRY** | Internet → pod `p` | Exposed(p) ∧ NetVuln(p) |
| **LATERAL** | pod `a` → pod `b` (a ≠ b) | EffReach_S(a, b) ∧ NetVuln(b) |
| **GOAL** | pod `a` → crown jewel `t` | EffReach_S(a, t) ∧ Authorized(a, t) |

Meaning: the attacker controls the pods it has entered; it can take over another pod only by reaching it over the network and exploiting a network-reachable active vulnerability on it; it can access a crown jewel only from a pod that both reaches it and holds an IAM grant for it.

### 3.4 Attack chains
- An **attack chain** to `t` is a sequence `Internet → p₀ → p₁ → … → p_m → t` where the first step is ENTRY, each `pᵢ → pᵢ₊₁` is LATERAL, the last step is GOAL, and all pods are distinct. `m` is the number of lateral hops.
- **Bounded chains** (planner): `m ≤ L = 3`. **Unbounded** (Hunter): any `m`.
- `m = 0` is exactly the original four-tier chain of doc 01, except that the vulnerability must be network-exploitable (conflict C-01, §14).
- `QUALIFYING_MODELED_CHAIN` now means "at least one attack chain exists to the target"; chain IDs are `chain-{p₀}-…-{p_m}-{t}`.

### 3.5 Assumptions and exclusions (printed on every certificate)
- **Over-approximations (favour the attacker):** any port of a reached pod can carry the exploit; missing `attack_vector` = NETWORK; ingress-side NetworkPolicies are not modelled (only egress restricts reach).
- **Observed reachability** reflects the baseline enforced state; candidate policies can only remove reachability (§5.5).
- **Not modelled:** credential theft or token reuse across pods; application-layer vulnerabilities without a network vector; node/host and loopback traffic (NetworkPolicy cannot block these); Internet egress / exfiltration; IAM conditions, SCPs, permission boundaries; supply-chain compromise; zero-days; real CNI enforcement behaviour.

---

## 4. Derived ATTACK_STEP Graph

### 4.1 Construction [DESIGN]
1. Built **only** inside a sandbox (`sandbox:{session}`) or candidate graph (`cand:{plan}:{round}`), never in `template` or `memory`.
2. Precondition: scope completeness (§3.1). Otherwise stop with an inconclusive status.
3. Delete all existing ATTACK_STEP edges in that graph, then create, via parameterized Cypher templates:
   - one `ENTRY` edge `Internet → p` per pod satisfying ENTRY;
   - one `LATERAL` edge `a → b` per ordered pod pair satisfying LATERAL (parallel ports collapse into one edge with `ports` listing every allowed observed port);
   - one `GOAL` edge `a → t` per pod/crown-jewel pair satisfying GOAL.
4. Every edge stores `backing_evidence_ids` (the evidence edges that justify it) and `built_at_revision`.
5. Any use of ATTACK_STEP edges first checks `built_at_revision == current revision`; on mismatch it rebuilds.

### 4.2 Path semantics proof [DESIGN]
**Theorem 1.** For a state S that passes scope completeness, an attack chain (any length) to crown jewel `t` exists **iff** there is a directed path from `Internet` to `t` in S's ATTACK_STEP graph.

*Proof.* (⇒) Each step of a chain satisfies the condition of its transition type, so by construction (§4.1 step 3) the corresponding ATTACK_STEP edge exists; the chain's steps form a directed path. (⇐) Take a directed path `Internet → v₁ → … → v_n → t`. `Internet` has only ENTRY out-edges, crown jewels have only GOAL in-edges, and pod-to-pod edges are LATERAL, so the path's steps are ENTRY, LATERAL…, GOAL in order. Each edge exists only if its condition holds, and every condition depends only on the edge's two endpoints and S (never on earlier steps), so the sequence is a valid chain, except possibly for repeated pods. If a pod repeats, delete the cycle between its occurrences; the remaining consecutive pairs are still edges, so the shortened sequence is a valid chain with distinct pods. ∎

**Corollary 1 (bounded equivalence).** The set of bounded chains (m ≤ 3) equals the set of simple ATTACK_STEP paths with at most 3 LATERAL edges. The planner's enumerator **E** computes the left side from base evidence; the right side is computed from ATTACK_STEP edges. Equality is tested in TC-19 and cross-checks the construction for bounded paths.

**Locality is essential.** Any future condition that depends on earlier steps (for example "credential stolen two hops ago") breaks Theorem 1 and must not be added without a new proof.

### 4.3 Max-flow semantics [DESIGN + GATE]
**Theorem 2.** With capacity 1 on every ATTACK_STEP edge, `maxFlow(Internet → T) = 0` **iff** no directed path exists from `Internet` to any `t ∈ T`.

*Proof.* If a path exists, pushing one unit along it is a feasible flow, so the maximum is ≥ 1. If the maximum flow is 0, the zero flow is optimal, so no augmenting path exists in its residual graph; for the zero flow the residual graph is the original graph, so no path exists. ∎

This relies on implementation properties that must be measured on Day 1 (§13, gate G1): edges are treated as **directed**; only the listed `relationshipTypes` are traversed; the `capacityProperty` is honoured; multiple `targetNodes` are supported; results match an oracle. FalkorDB's documentation states that `algo.maxFlow` returns the nodes and edges carrying positive flow, the per-edge flow values and the total, **not the minimum cut**.

### 4.4 Three-method agreement rule
| Method | Input | Implementation | Bound |
| :--- | :--- | :--- | :--- |
| **E**: bounded enumerator | base evidence | Cypher templates (FalkorDB) | m ≤ 3 |
| **F**: max-flow | ATTACK_STEP edges | `algo.maxFlow` (FalkorDB) | none |
| **O**: oracle | ATTACK_STEP edges exported as a list | separate Python breadth-first search, written independently of the engine | none |

- A containment conclusion requires **E = ∅ (for T_scope) ∧ F = 0 ∧ O = ∅**. Any disagreement → `SIMULATION_INCONCLUSIVE` with reason `METHOD_DISAGREEMENT`, and the run is logged as a defect.
- **Honest limit:** F and O share the ATTACK_STEP construction. A construction error that affects only paths longer than 3 lateral hops is caught by neither E (bounded) nor F/O (shared input). TC-19, TC-21 and TC-28 target this; it is stated in the certificate exclusions.

---

## 5. Candidate Policy Semantics (replaces doc 03 §1 deny-list model)

### 5.1 Adopted Kubernetes semantics (source: Kubernetes NetworkPolicy documentation)
- A pod is non-isolated for egress by default (all outbound allowed).
- It becomes isolated for egress when any NetworkPolicy with `Egress` in `policyTypes` selects it.
- Policies are additive: the allowed egress is the **union** of all selecting policies' rules. There is **no explicit deny**.
- Enforcement requires a network plugin that implements NetworkPolicy; the model cannot claim enforcement.

### 5.2 Allowed egress in state S
`Allowed_S(p, d, π)` = true if no Egress policy selects `p`; otherwise true iff some selecting policy has `ALLOWS_EGRESS {port: π}` to `d`.

### 5.3 Baseline consistency check
Every fresh observed `CAN_REACH(p→d, π)` in a sandbox must satisfy `Allowed_S(p, d, π)` under baseline policies. A violation is contradictory evidence → scope completeness fails (`INCONCLUSIVE`, reason `CONTRADICTORY_EVIDENCE`).

### 5.4 Effective reachability
`EffReach_S(p, d)` as defined in §3.2. In a candidate graph, applying a plan materialises its policies, and observed `CAN_REACH` edges whose `(d, π)` is not allowed are removed **in the candidate graph only**.

### 5.5 Monotonicity lemma [DESIGN]
An eligible catalogue action (§6.2) targets pods that no Egress policy currently selects, so before the action they allow everything; afterwards they allow only the action's list. Allowed egress therefore only shrinks, so ATTACK_STEP edges can only disappear. **Catalogue actions never create attack paths.** Policies selecting other pods are unchanged.

### 5.6 Policy removal (sandbox operation)
Removing a policy can only enlarge allowed egress, but the newly allowed flows have not been observed. Therefore `REMOVE_POLICY` marks the reachability evidence of every pod the policy selected as `UNCOLLECTED` (reason `POLICY_CHANGED`), and investigations over that scope return `INCONCLUSIVE` until fresh reachability is observed. The model never guesses reachability. [OPEN C-13: an explicit "potential reachability" model could replace this.]

---

## 6. Action Catalogue

### 6.1 Action type
Only the Action Gateway's allowlisted type `APPLY_NETWORK_POLICY_ISOLATE` exists. Each action creates one `INTERDICT_CANDIDATE` egress policy for a **workload selector** `σ = (namespace, app)` selecting pod set `P_σ`.

### 6.2 Eligibility
A selector is eligible iff (i) `P_σ` is non-empty and in one namespace; (ii) **no existing Egress policy selects any pod in `P_σ`**, because under union semantics a new policy could not restrict them (otherwise reason `INELIGIBLE_EXISTING_EGRESS_POLICY`); (iii) some pod in `P_σ` is the source of a LATERAL or GOAL step on a constraint chain.

### 6.3 Variants (deterministic ID `act:{namespace}:{app}:{variant}`)
Let `Decl(σ)` = declared dependencies `(d, π)` of pods in `P_σ`, `DNS` = `(kube-dns, 53/UDP and 53/TCP)`, and `AttackDest(σ)` = every `(d, π)` such that a constraint-chain step leaves a pod in `P_σ` to `d` and `π` is one of that step's observed ports.

| Variant | Allow list | Generated when |
| :--- | :--- | :--- |
| `EGRESS_DECLARED` | `Decl(σ) ∪ DNS` | always (if eligible) |
| `EGRESS_STRICT` | `(Decl(σ) ∪ DNS) \ AttackDest(σ)` | only if it differs from `EGRESS_DECLARED` (i.e., an attack step overlaps a declared dependency) |
| `EGRESS_DENY_ALL` (hard isolation) | `∅` (DNS also blocked) | always (if eligible) |

### 6.4 Computed effects of an action `a` (all against the current sandbox state)
- **Blocked(a):** fresh observed `CAN_REACH(p→d, π)` with `p ∈ P_σ` and `(d, π)` not in the allow list.
- **StepRemoved(a):** LATERAL/GOAL steps `p → d` with `p ∈ P_σ` such that **every** observed port of the step is in Blocked(a).
- **KnownBroken(a):** declared dependencies `DEPENDS_ON(p→d, π)` with `p ∈ P_σ` and `(d, π)` not in the allow list (whether or not currently observed).
- **Unknown(a):** edges in Blocked(a) whose source pod has `dependency_manifest ∈ {PARTIAL, NONE}` and that are not declared dependencies. (With `COMPLETE` manifests, undeclared blocked flows are known non-dependencies and carry no disruption.)
- Plan-level effects are unions of distinct edges across the plan's actions.

### 6.5 Catalogue limits
At most `CATALOGUE_CAP = 30` actions per planning problem; otherwise `PLANNING_INCONCLUSIVE` with reason `CATALOGUE_TOO_LARGE` (no exactness claim; see §7.7).

---

## 7. Exact Remediation Planner

### 7.1 Inputs
Constraint set `C` (bounded chains to `T_scope` from E, plus residual paths added by the Hunter), catalogue `A`, `k = 3`, option `require_known_impact` (default `false`).

### 7.2 Hitting
Plan `S` (set of actions) **hits** chain `c` iff some LATERAL or GOAL step of `c` is in `StepRemoved(a)` for some `a ∈ S`. ENTRY steps are not cuttable by egress actions (limitation C-17).

### 7.3 Feasibility
`S` is feasible iff: hits every `c ∈ C`; at most one action per selector; `|S| ≤ k`; all actions eligible; and, if `require_known_impact = true`, `Unknown(S) = ∅`.

### 7.4 Objective (lexicographic, minimise in order)
1. `|KnownBroken(S)|` (declared dependencies broken)
2. `|Unknown(S)|` (blocked flows with unknown impact)
3. `|S|` (number of actions)
4. `|Blocked(S)|` (total flows blocked, i.e., least change)
5. tie-break: lexicographic order of sorted action IDs (determinism)

The order of 1 vs 2 is provisional [OPEN C-12].

### 7.5 Exactness
Enumerate every subset of `A` of size 0…k that respects the one-per-selector rule (≤ 4,526 subsets at `|A| = 30`, `k = 3`), evaluate feasibility and objective with set operations, and return the minimum. The claim is **`EXACT_WITHIN_K`: optimal among plans of at most k actions drawn from this catalogue for this constraint set**, not optimal over all possible policies. General weighted hitting set is NP-hard; exactness here comes from the small, bounded instance.

### 7.6 Impact status
- `KNOWN_ZERO_DISRUPTION`: `KnownBroken = ∅ ∧ Unknown = ∅`
- `KNOWN_DISRUPTION`: `KnownBroken ≠ ∅ ∧ Unknown = ∅`
- `IMPACT_PARTIALLY_UNKNOWN`: `Unknown ≠ ∅` (KnownBroken reported alongside)

"Zero disruption" may be displayed only for `KNOWN_ZERO_DISRUPTION`, always qualified as "of declared dependencies (synthetic fixture)".

### 7.7 Outputs and non-success statuses
- **`PLAN_FOUND`:** plan ID, actions with full policy specs, `optimality`, impact sets and status, covered chain IDs, plus up to 3 distinct alternatives and the best all-`EGRESS_DENY_ALL` plan for comparison.
- **`NO_FEASIBLE_PLAN_WITHIN_K`** with `reason ∈ {K_EXCEEDED, UNKNOWN_IMPACT_EXCLUDED, NO_ELIGIBLE_ACTION}`, `k`, and `best_partial_plan` (maximum chains covered, ties broken by the objective) with covered and uncovered chain IDs. Never a certificate; never "contained". UI copy: *"No plan of ≤ 3 allowed policy changes closes every modelled path. Best partial plan closes X of Y."*
- **`PLANNING_INCONCLUSIVE`** with `reason ∈ {SCOPE_INCOMPLETE, CATALOGUE_TOO_LARGE, CHAIN_ENUMERATION_TRUNCATED}`. In this state a heuristic plan may still be shown and verified by the Hunter, but it is labelled `optimality: NOT_EXACT`.

### 7.8 Required overlap scenario (fixture)
At least one cluster must have **no `KNOWN_ZERO_DISRUPTION` plan**. Reference design: `Internet → frontend (exposed, network vuln) → checkout (network vuln) → payments-db`, where `frontend → checkout:8080` and `checkout → payments-db:5432` are both declared dependencies and checkout holds the IAM grant. Every cut breaks a declared dependency, so the planner must return `KNOWN_DISRUPTION` and name the dependency it breaks (TC-26).

---

## 8. Deterministic Path Hunter

### 8.1 Loop [DESIGN]
1. `C₀` = bounded chains to `T_scope`; `P₀` = planner(`C₀`).
2. For round `i = 0 … R−1`:
   1. `GRAPH.COPY sandbox → cand:{plan}:{i}`; apply `Pᵢ`'s policies; remove disallowed observed reach (§5.4); rebuild ATTACK_STEP (§4.1).
   2. Run **E**, **F** (`algo.maxFlow` from Internet to **all** crown jewels) and **O**.
   3. If any query fails or times out, or scope completeness fails → `SIMULATION_INCONCLUSIVE`; stop.
   4. If the methods disagree → `SIMULATION_INCONCLUSIVE (METHOD_DISAGREEMENT)`; stop.
   5. If no path reaches any `t ∈ T_scope` → issue a certificate (§9) → `SIMULATED_CONTAINMENT`; stop.
   6. Otherwise extract one residual path `π` to a target in `T_scope` (from F's positive-flow edges, cycles removed), map it to a chain, set `Cᵢ₊₁ = Cᵢ ∪ {π}`, `Pᵢ₊₁` = planner(`Cᵢ₊₁`). If the planner returns `NO_FEASIBLE_PLAN_WITHIN_K` → stop with that status and the residual paths.
3. If `R` rounds pass without success → `SIMULATED_RESIDUAL_EXPOSURE` with residual paths; no certificate.

Residual paths to crown jewels **outside** `T_scope` are reported as out-of-scope exposure and do not block a certificate for `T_scope`. When `T_scope` = all crown jewels, the certificate is environment-wide.

### 8.2 Termination
Every plan hits every chain in its constraint set, so any residual path found is a new simple chain not yet in `C`. There are finitely many simple chains, so the loop terminates; `R` bounds the cost.

### 8.3 What "independent" means here
The Hunter uses a different **method** (unbounded max-flow plus oracle versus bounded enumeration), a broader **adversary scope** (all crown jewels, unbounded lateral hops), and sees only the graph with the plan applied, never the planner's reasoning. It does **not** independently validate the data model or the telemetry. It is marketed as "an independent algorithm under the same threat model", never as independent verification of reality or as a second AI agent. No LLM participates in the search.

---

## 9. Model-Verified Containment Certificate

### 9.1 Issued only if all hold
Scope completeness passed; E = ∅ for `T_scope`; F = 0 for `T_scope`; O = ∅ for `T_scope`; no query failed or timed out; the sandbox revision did not change between copy and issuance; the snapshot hash computed successfully; the plan came from `PLAN_FOUND` (exact or `NOT_EXACT`, recorded).

### 9.2 Contents
| Field | Content |
| :--- | :--- |
| `certificate_id`, `claim` | claim is always `MODEL_VERIFIED_CONTAINMENT` |
| `issued_at`, `expires_at` | `expires_at = min(earliest valid_until among evidence in scope, issued_at + 24 h)` |
| Snapshot identity | candidate graph key `cert:{certificate_id}`; `baseline_revision`; `baseline_snapshot_hash`; `candidate_snapshot_hash` |
| Plan | plan ID, actions with full policy specs, `optimality`, impact status and sets |
| Threat model | `ITM-1`, constants, relationship types used, `T_scope`, over-approximations applied (e.g., missing `attack_vector` count) |
| Verification | evidence completeness summary per tier; E/F/O results with query template IDs, parameters, latencies; Hunter round log |
| Provenance | engine git SHA, FalkorDB version, audit event hash that records this certificate |
| Exclusions | the static text of §3.5 plus: "Model-verified only; not evidence of real-world containment; enforcement depends on the cluster's network plugin." |

### 9.3 Snapshot hash (canonical serialisation)
SHA-256 over: all nodes sorted by `id`, each as `(id, sorted labels, sorted properties)`; then all edges sorted by `(source id, type, target id, sorted properties)`; timestamps normalised to UTC ISO-8601; keys sorted; numbers in canonical decimal form. Derived ATTACK_STEP edges are **excluded** (they are recomputed); a duplicate or missing `id` aborts issuance.

### 9.4 Lifecycle
- `VALID` → `EXPIRED` when `now ≥ expires_at`.
- `VALID` → `SUPERSEDED` when the source sandbox's revision changes (any sandbox operation).
- `verify_certificate` re-runs E/F/O on the retained snapshot and recomputes the hash; a mismatch sets `REVERIFICATION_FAILED`.
- The snapshot graph is retained 24 h; afterwards only metadata remains in `memory:{tenant}` (status shows "snapshot no longer retained").

### 9.5 What it establishes / cannot establish
| Establishes | Cannot establish |
| :--- | :--- |
| Under ITM-1, on the hashed snapshot, after the listed policies, no modelled attack chain reaches `T_scope` | Real-world containment or CNI enforcement |
| All evidence used was complete and fresh at issuance | Correctness or completeness of the telemetry and inventory |
| The result is reproducible from the retained snapshot | Absence of unmodelled vectors (§3.5) |
| The certificate record is tamper-evident via the audit chain | That the result holds after any later change |

**Failure conditions (no certificate):** any §9.1 condition false; residual path in `T_scope`; `NO_FEASIBLE_PLAN_WITHIN_K`; Hunter round limit reached; method disagreement; revision change during the run; hash or `id` uniqueness failure; Day-1 gate G1 failed without the fallback path being active (§13).

---

## 10. Alert Storm

### 10.1 Deterministic dataset
A seeded generator builds `template`: topology (namespaces, services, pods with labels, images, synthetic vulnerabilities with `attack_vector`), reachability, IAM, baseline policies, declared dependencies with manifest completeness, scenario structures A–E and the overlap scenario (§7.8), and alerts (one per pod/vulnerability finding plus duplicate scanners). Parameters and seed are printed in the README and on the `/system` page. Outcomes are **never** written by the generator; only structure. The ratio of alerts to real chains is a property of the disclosed synthetic distribution, not a real-world claim.

### 10.2 Triage partition (every alert gets exactly one class)
1. `TRIAGE_INCONCLUSIVE`: any evidence needed for its workload is stale, uncollected, contradictory, or its query failed.
2. `NOT_ACTIONABLE`: the referenced vulnerability is not `ACTIVE` or not network-exploitable.
3. `NOT_ON_ATTACK_PATH`: the workload lies on no Internet → crown-jewel path in the ATTACK_STEP graph.
4. `ON_ATTACK_PATH`: the workload lies on at least one path, with role `ENTRY`, `LATERAL` or `FINAL_HOP` (a workload may hold several roles; the UI shows all).

"Lies on a path" is computed exactly and without a hop bound: `v ∈ Forward(Internet) ∩ Backward(T)`, where `Forward` and `Backward` are reachability sets over ATTACK_STEP edges. If the sandbox scope is incomplete, the ATTACK_STEP graph is not built, and alerts whose workloads touch incomplete evidence are `TRIAGE_INCONCLUSIVE`. [OPEN C-11: whether alerts elsewhere can still be classified when only part of the scope is incomplete.]

**Conservation:** class counts always sum to the number of input alerts.

### 10.3 Clusters and funnel
- Clusters: bounded chains grouped by `(target crown jewel, entry ingress)`. Each cluster is a planning problem with `T_scope = {target}`; the environment-wide plan uses `T_scope` = all crown jewels.
- Funnel stages shown: alerts → actionable → on attack path → workloads on paths → chains (bounded count; unbounded existence via Forward ∩ Backward) → clusters → actions in the environment-wide plan. `TRIAGE_INCONCLUSIVE` is a visible side branch, never dropped.
- Every number carries an evidence ID (query template, parameters, revision, latency).
- `CHAIN_ENUMERATION_TRUNCATED` is shown if `CHAIN_ENUM_CAP` is reached.

### 10.4 Performance
Tier queries are **set-based** (one query per tier for all alerted workloads). Provisional target: full triage p95 < 2 s warm on 1,000 alerts / ~800 nodes [GATE G4].

---

## 11. Sandbox Operations ("Break It Yourself")

### 11.1 Rules for all operations
- Session identity: server-issued, HttpOnly, signed cookie. The sandbox key is derived on the server (`sandbox:{hmac(session_id)}`); **no request field can name a graph key**.
- Inputs are typed; IDs must match `^[a-z0-9-]{1,64}$` **and** exist in that sandbox; no free-text or Cypher fields are accepted (unknown fields → 422).
- Executed via parameterized templates by the engine; never callable by the LLM (operations are not MCP tools).
- Each applied operation increments the sandbox revision, writes an audit event, invalidates ATTACK_STEP edges, and supersedes certificates from that sandbox.
- Limits: `SANDBOX_OP_CAP = 20` per session plus per-IP rate limit; `RESET_SANDBOX` re-copies `template` and is not counted.
- Investigations always recompute from the graph; nothing is cached by scenario.

### 11.2 Operations
| Operation | Preconditions | Effect | Rejections |
| :--- | :--- | :--- | :--- |
| `EXPOSE_WORKLOAD(pod_id)` | pod has a Service | adds fresh `EXPOSES`/`ROUTES_TO` from the default ingress to that Service (`SANDBOX_USER_CHANGE`, valid 2 h) | unknown ID; no Service |
| `GRANT_DB_ACCESS(pod_id, db_id)` | pod assumes a role; db exists | adds a fresh `Allow` permission from that role to the db | unknown IDs; no role |
| `ADD_LATERAL_REACH(src_pod_id, dst_pod_id, port)` | distinct pods; port 1–65535; egress allowed under current policies | adds a fresh observed `CAN_REACH` | `REJECTED_CONTRADICTS_POLICY` if policies disallow it |
| `EXPIRE_EVIDENCE(edge_ref)` | edge is an evidence edge in this sandbox | sets `valid_until` to the past | unknown ref; derived edge |
| `REMOVE_POLICY(policy_id)` | policy exists, `managed_by = BASELINE` | deletes the policy; selected pods' reachability → `UNCOLLECTED` (§5.6) | unknown ID |

Result enum: `APPLIED`, `REJECTED_VALIDATION`, `REJECTED_UNAUTHORIZED`, `REJECTED_LIMIT`, `REJECTED_CONTRADICTS_POLICY`.

---

## 12. Registries

### 12.1 Status enums (canonical; supersedes doc 01 §1 and doc 06 §7.4 where they differ)

| Enum | Values | Notes |
| :--- | :--- | :--- |
| `CollectionStatus` | `COLLECTED_COMPLETE`, `COLLECTED_EMPTY`, `QUERY_FAILED`, `STALE_EXPIRED`, `UNCOLLECTED` | `NOT_CONFIGURED` (doc V4.1 review) maps to `UNCOLLECTED` |
| `InvestigationStatus` | `QUALIFYING_MODELED_CHAIN`, `NOT_QUALIFIED`, `INCONCLUSIVE` | chain semantics per §3.4 |
| `InconclusiveReason` | `QUERY_FAILED`, `STALE_EVIDENCE`, `UNCOLLECTED_EVIDENCE`, `CONTRADICTORY_EVIDENCE`, `INVENTORY_INCOMPLETE`, `METHOD_DISAGREEMENT`, `REVISION_CHANGED` | attached to any inconclusive status |
| `AlertTriageClass` | `ON_ATTACK_PATH`, `NOT_ON_ATTACK_PATH`, `NOT_ACTIONABLE`, `TRIAGE_INCONCLUSIVE` | §10.2 |
| `AttackPathRole` | `ENTRY`, `LATERAL`, `FINAL_HOP` | §10.2 |
| `PlanStatus` | `PLAN_FOUND`, `NO_FEASIBLE_PLAN_WITHIN_K`, `PLANNING_INCONCLUSIVE` | §7.7 |
| `NoPlanReason` | `K_EXCEEDED`, `UNKNOWN_IMPACT_EXCLUDED`, `NO_ELIGIBLE_ACTION` | |
| `PlanningInconclusiveReason` | `SCOPE_INCOMPLETE`, `CATALOGUE_TOO_LARGE`, `CHAIN_ENUMERATION_TRUNCATED` | |
| `PlanOptimality` | `EXACT_WITHIN_K`, `NOT_EXACT` | |
| `ImpactStatus` | `KNOWN_ZERO_DISRUPTION`, `KNOWN_DISRUPTION`, `IMPACT_PARTIALLY_UNKNOWN` | §7.6 |
| `DependencyManifest` | `COMPLETE`, `PARTIAL`, `NONE` | |
| `SimulationStatus` | `SIMULATED_CONTAINMENT`, `SIMULATED_RESIDUAL_EXPOSURE`, `SIMULATION_REJECTED`, `SIMULATION_INCONCLUSIVE` | **`SIMULATED_CONTAINMENT` is emitted only together with a certificate** |
| `CertificateStatus` | `VALID`, `EXPIRED`, `SUPERSEDED`, `REVERIFICATION_FAILED` | |
| `VerificationStatus` (LIVE mode, deferred) | `VERIFIED_CONTAINED`, `RESIDUAL_EXPOSURE`, `VERIFICATION_INCONCLUSIVE` | Query 5 must be generalised to ITM-1 before LIVE mode (C-15) |
| `SandboxOpResult` | `APPLIED`, `REJECTED_VALIDATION`, `REJECTED_UNAUTHORIZED`, `REJECTED_LIMIT`, `REJECTED_CONTRADICTS_POLICY` | §11 |
| `GatewayRejection` | `UNAUTHORIZED_ACTION`, `STALE_REVISION_REJECTED`, `MISSING_CERTIFICATE`, `LIVE_MODE_DISABLED` | |
| Lifecycle (doc 02 §3, extended) | adds `TRIAGING`, `PLANNING`, `HUNTING` between `EVALUATING` and `CANDIDATE_EVALUATED`; adds terminals `NO_FEASIBLE_PLAN_WITHIN_K`, `PLANNING_INCONCLUSIVE`, `SIMULATION_INCONCLUSIVE`, `BUDGET_EXHAUSTED` | |
| `AttributionStatus` (P1) | `ATTRIBUTED`, `ATTRIBUTION_UNKNOWN` | |

**UI label mapping (updates doc 06 §7.4):** `SIMULATED_CONTAINMENT` → "Model-verified containment" (never "Contained" alone); `KNOWN_DISRUPTION` → "Closes all modelled paths; breaks N declared dependencies"; `NO_FEASIBLE_PLAN_WITHIN_K` → "No safe plan within 3 changes"; every inconclusive status → "Not enough fresh evidence" plus reason.

### 12.2 MCP tool registry (canonical; supersedes doc 02 §5 and doc 06 §4.4)

| Tool | Priority | Purpose | Replaces / notes |
| :--- | :---: | :--- | :--- |
| `get_alert_context(alert_id)` | P0 | Alert + workload context | unchanged |
| `triage_alert_storm(storm_id)` | P0 | §10 partition, clusters, funnel | new |
| `find_evidence_by_workload(pod_id)` | P0 | Four tiers with collection statuses | unchanged |
| `find_attack_paths_to_asset(target_db_id, max_lateral_hops ≤ 3)` | P0 | Method E | from doc 06 |
| `plan_remediation(cluster_id \| target_db_ids, require_known_impact?)` | P0 | §7 planner | replaces `rank_remediation_options` (02) and `plan_min_cut_remediation` (06) |
| `simulate_remediation(plan_id)` | P0 | One candidate-graph round (§8.1 step 2.1–2.2), no re-planning | semantics changed from in-memory overlay (02/03) |
| `hunt_residual_paths(plan_id)` | P0 | Full §8 loop; issues certificate | new |
| `verify_certificate(certificate_id)` | P0 | Read-only re-verification (§9.4) | new |
| `submit_remediation_execution(plan_id, certificate_id, execution_mode, idempotency_key)` | P0 | Gateway receipt; prod accepts `SIMULATION` only; requires a `VALID` certificate at current revision | name from 02 (06 used `submit_remediation`) |
| `recall_incident_memory(asset_ids)` | P0, must degrade | Past plans and certificates | returns `UNAVAILABLE` without failing the run |
| `calculate_blast_radius(pod_id)` | P1 | Query 2 | retained from 02 |
| `rank_choke_points(scope)` | P1 | `algo.betweenness` display signal | from 06; never used as proof |
| `verify_remediation(investigation_id, target_db_id, scope)` | Deferred | LIVE post-execution verification | retained from 02; requires C-15 |

Agent budget: **≤ 12 tool calls** (NFR-03 revised). Typical run: triage → evidence → paths → plan → hunt → submit (SIMULATION) → recall ≈ 7–8 calls. Preconditions enforced in code: no `submit` without a `VALID` certificate at the current revision; no containment wording without `SIMULATED_CONTAINMENT`; sandbox operations are not tools.

### 12.3 Requirements added to doc 05 (FR-11…FR-19, NFR-06…NFR-08)
| ID | Requirement | Tests |
| :--- | :--- | :--- |
| FR-11 | Alert Storm triage partition, clusters, funnel with evidence IDs | TC-15–TC-18 |
| FR-12 | Threat model ITM-1 and derived ATTACK_STEP graph | TC-19–TC-21 |
| FR-13 | Allowlist candidate-policy semantics, eligibility, monotonicity | TC-06, TC-07 (revised), TC-27 |
| FR-14 | Exact remediation planner with three-valued impact | TC-22–TC-26 |
| FR-15 | Deterministic Path Hunter with three-method agreement | TC-28, TC-29, TC-33 |
| FR-16 | Model-verified containment certificate | TC-30–TC-32, TC-34 |
| FR-17 | Five typed sandbox operations with server-side authorization | TC-35–TC-38 |
| FR-18 | Memory isolation (core workflow survives memory failure) | TC-41 |
| FR-19 (P1) | Minimal temporal attribution | TC-40 |
| NFR-06 | Storm triage p95 < 2 s warm (1,000 alerts, ~800 nodes) | TC-18, gate G4 |
| NFR-07 | One Hunter round p95 < 1.5 s (copy + apply + E/F/O) | gate G1, G2 |
| NFR-08 | `GRAPH.COPY` of template p95 < 500 ms; 10 concurrent copies succeed | gate G2 |

### 12.4 Acceptance tests (canonical registry from TC-13; TC-01…TC-12 remain in doc 03)

**Revised:**
- **TC-06 (revised):** `EGRESS_DENY_ALL` on selector σ removes every observed egress of `P_σ` (including DNS) in the candidate graph; pods outside `P_σ` unchanged.
- **TC-07 (revised):** `EGRESS_STRICT` with attack step on 5432 and declared dependency on 6379 removes 5432 and keeps 6379 and DNS.

| ID | Test |
| :--- | :--- |
| TC-13 | Audit hash chain: append 100 events, verify chain; altering, inserting or deleting one event is detected (resolves FR-09 reference) |
| TC-14 | Choke-point ranking: fixed seed → identical top-5 on repeated runs; procedure failure → investigation completes, panel shows `UNAVAILABLE` (resolves FR-10 reference) |
| TC-15 | Storm determinism: same seed → identical partition, clusters, chain IDs; 20 random seeds → every count equals the oracle |
| TC-16 | Storm conservation: inject `QUERY_FAILED` for one tier on 5 workloads → their alerts are `TRIAGE_INCONCLUSIVE`; class counts sum to input |
| TC-17 | No hardcoded outcomes: static scan finds no scenario/fixture IDs in the engine package; a mutated seed changes results and still matches the oracle |
| TC-18 | Storm latency: 1,000 alerts p95 < 2 s warm (NFR-06) |
| TC-19 | Bounded equivalence (Corollary 1): E's chains = ATTACK_STEP simple paths with ≤ 3 LATERAL edges, on 50 random seeds |
| TC-20 | Max-flow vs oracle: 50 random graphs incl. one-way edges → `F = 0` ⇔ `O = ∅`; directed asymmetric case gives 0 in the reverse direction |
| TC-21 | Transition rules: LATERAL into a pod without a network vuln does not exist; GOAL without IAM does not exist; missing `attack_vector` treated as NETWORK and flagged |
| TC-22 | Plan feasibility: the plan hits every chain in C and the candidate graph gives F = 0 for T_scope |
| TC-23 | Plan optimality: three hand-built instances with known optimum, including one where a greedy choice is worse |
| TC-24 | `NO_FEASIBLE_PLAN_WITHIN_K` (`K_EXCEEDED`) on an instance needing 4 actions; best partial plan reported; no certificate |
| TC-25 | Unknown impact: blocked undeclared flow from a `PARTIAL` manifest pod counts in Unknown; with `require_known_impact` → `UNKNOWN_IMPACT_EXCLUDED` |
| TC-26 | Overlap scenario (§7.8): no `KNOWN_ZERO_DISRUPTION` plan exists; the planner returns `KNOWN_DISRUPTION` naming the broken dependency |
| TC-27 | Policy semantics: allowlist keeps declared dependencies and DNS; selector already selected by an Egress policy → `INELIGIBLE_EXISTING_EGRESS_POLICY`; applying any catalogue action never adds an ATTACK_STEP edge |
| TC-28 | Hunter beyond bound: a 5-lateral-hop path missed by E is found by F/O, re-planned, final F = 0 |
| TC-29 | Broken-planner mutation: planner deliberately drops one action → Hunter reports residual; no certificate |
| TC-30 | Certificate gating: stale evidence, failed query or timeout anywhere in scope → `SIMULATION_INCONCLUSIVE`; no certificate |
| TC-31 | Certificate reproducibility: `verify_certificate` reproduces hash and results; changing one property in the snapshot changes the hash and yields `REVERIFICATION_FAILED` |
| TC-32 | Certificate lifecycle: sandbox operation → `SUPERSEDED`; clock past `expires_at` → `EXPIRED` |
| TC-33 | Method disagreement: fault injected into one method → `SIMULATION_INCONCLUSIVE (METHOD_DISAGREEMENT)` |
| TC-34 | Isolation of candidates: sandbox snapshot hash identical before and after planning and hunting |
| TC-35 | Sandbox authorization: cross-session access, forged keys, unknown IDs, non-allowlisted operations, extra/raw-Cypher fields → rejected with the right `SandboxOpResult` |
| TC-36 | Sandbox recomputation: `EXPOSE_WORKLOAD` + `GRANT_DB_ACCESS` on batch-worker flips `NOT_QUALIFIED` → `QUALIFYING_MODELED_CHAIN`; revision increments; audit event written |
| TC-37 | Sandbox limits: 21st operation → `REJECTED_LIMIT`; rate limit enforced |
| TC-38 | `REMOVE_POLICY` → affected reachability `UNCOLLECTED` → `INCONCLUSIVE`; never assumed reachable or unreachable |
| TC-39 | Query timeout → `QUERY_FAILED` → inconclusive; never "0 paths" (complements TC-11) |
| TC-40 (P1) | Temporal: chain opened-at = latest `valid_from` of its required edges; missing `introduced_by` → `ATTRIBUTION_UNKNOWN` |
| TC-41 | Memory isolation: memory graph unavailable → investigation and certificate still complete; recall returns `UNAVAILABLE` |

**Mapping from the 2026-10-14 review's provisional IDs:** TC-20→TC-15, TC-21→TC-16, TC-22→TC-17, TC-23→TC-22, TC-24→TC-23, TC-25→TC-24, TC-26→TC-25, TC-27→TC-26, TC-28→TC-28, TC-29→TC-29, TC-30→TC-30, TC-31→TC-31, TC-32→TC-34, TC-33→TC-35, TC-34→TC-36, TC-35→TC-37, TC-36→TC-40, TC-37→TC-27, TC-38→TC-20.

---

## 13. Day-1 Validation Gate (Oct 15, decision by 18:00 IST)

Run against the pinned FalkorDB container with the seeded template. Record measured values in this section and in doc 03 §5.2, replacing provisional targets. Nothing in §4.3, §8 or §9 may be described as validated until G1 passes.

| Gate | Procedure | Pass criteria | If it fails: safe fallback | Features cut or changed |
| :--- | :--- | :--- | :--- | :--- |
| **G0 Version & availability** | Pin image tag; confirm `algo.maxFlow`, `algo.betweenness`, `GRAPH.COPY`, `TIMEOUT` argument exist | All present | Try the previous stable tag | If maxFlow absent → G1 fallback; if `GRAPH.COPY` absent → G2 fallback |
| **G1 Max-flow behaviour** | (a) one-way edge A→B: flow B→A = 0; (b) unit capacities on a known graph = number of edge-disjoint paths; (c) multiple `targetNodes`; (d) edges of other relationship types ignored; (e) behaviour with missing capacity property documented; (f) 50 random graphs agree with oracle O; (g) p95 < 300 ms on ~3,000 ATTACK_STEP edges | (a)–(d), (f) all correct; (g) met | **Correctness failure:** do not use `algo.maxFlow` for decisions. Method F becomes a bounded Cypher variable-length existence query over ATTACK_STEP with the bound set to the pod count, which is still unbounded in effect; O unchanged; residual paths are extracted from that query. **Performance-only failure:** use the Cypher existence query in intermediate rounds and maxFlow only for the final certificate check | Drop "max-flow" wording from UI and certificates; certificates name the methods actually used. TC-20 retargeted to the substitute method |
| **G2 Graph-copy performance** | Copy template (~800 nodes / ~3,000 edges) 20×; 10 concurrent copies; memory per copy | p95 < 500 ms; 10 concurrent succeed; 60 graphs fit the instance memory budget | (1) Copy-on-write sandboxes: visitors share the read-only `template` until their first sandbox operation. (2) One candidate graph per hunt, reused across rounds (delete and re-apply only candidate policies and reach edges). (3) Reduce template to ~400 nodes | If copies fail outright: Break It Yourself becomes one shared, queue-serialised demo sandbox reset after each use; Hunter keeps candidate graphs (required). If even candidate copies fail: **stop and re-plan**, since §8 depends on isolated candidate state |
| **G3 Query timeout handling** | Per-query `TIMEOUT` via the Python client; set `TIMEOUT_DEFAULT`/`TIMEOUT_MAX`; force a slow query; confirm error type, write rollback, engine mapping to `QUERY_FAILED` | Timeout raised within budget, distinguishable error, write undone, status `QUERY_FAILED` → inconclusive | Client-side async timeout plus connection reset, mapped to `QUERY_FAILED`; concurrency cap so abandoned server queries cannot pile up | None; batch storm queries split into smaller batches if they exceed the cap |
| **G4 Alert Storm latency** | Full triage on 1,000 alerts / ~800 nodes, warm and cold, 20 runs; chain enumeration time at `CHAIN_ENUM_CAP` | Warm p95 < 2 s; cold < 5 s; enumeration < 1 s | (1) Storm size 500. (2) Triage of the unmodified template computed when the sandbox is created (still computed from the graph, labelled with its revision) and recomputed after each sandbox operation. (3) Planner bound L reduced from 3 to 2, relying on the Hunter loop for longer paths | Funnel animation uses the measured size; claims in README use measured numbers only |

**Protocol:** gates run in order G0 → G3 → G1 → G2 → G4 (G3 first because the others depend on reliable timeouts). Results, chosen fallbacks and cuts are recorded in this section with timestamps before Day-2 work starts. A failed gate is never hidden: the README "Limitations" section states which fallback is active.

---

## 14. Conflict and Open-Decision Register

| ID | Topic | Conflict | Status / provisional resolution |
| :--- | :--- | :--- | :--- |
| C-01 | Vulnerability tier | Doc 01 Query 1B accepts any `ACTIVE` vulnerability; ITM-1 requires network-exploitable (missing vector → NETWORK) | Resolved (provisional); scenarios A–C unaffected because their vulnerabilities are network-exploitable |
| C-02 | Chain definition | Doc 01 chains are direct (exposed pod → DB); ITM-1 adds lateral chains | Resolved: direct chain = `m = 0` case |
| C-03 | Candidate payload | Doc 03 `blocked_destinations` deny-list is not valid NetworkPolicy semantics | Resolved: superseded by §5–§6; doc 03 text preserved |
| C-04 | Simulation location | ADR-03 in-memory overlay vs candidate graph | Resolved: candidate graph (ADR-06) |
| C-05 | Tool names | Doc 02 vs doc 06 tool lists; `submit_remediation` vs `submit_remediation_execution` | Resolved: §12.2 |
| C-06 | Tool budget | Doc 02/05 say 5; doc 06 says 12 | Resolved: 12 (NFR-03 revised) |
| C-07 | Persistence | Doc 03 SQLite + JSONL vs doc 06 FalkorDB-only | Resolved: doc 06 §4.3 (FalkorDB graphs, Redis keys, Redis Stream audit) |
| C-08 | `graph_revision` type | `'rev-N'` string (old docs) vs integer | Resolved: integer |
| C-09 | Min-cut role | Doc 06 calls min-cut the optimizer | Resolved: exact catalogue search optimizes; max-flow verifies (§7–§8) |
| C-10 | Containment label | Doc 06 "Contained (simulated)" | Resolved: "Model-verified containment" |
| C-11 | Partial-scope triage | Can alerts outside an incomplete region still be classified? | **Open.** Provisional: if any evidence in the sandbox is incomplete, no ATTACK_STEP graph is built and affected alerts are inconclusive; other alerts are classified only by `NOT_ACTIONABLE` |
| C-12 | Objective order | Known-broken before unknown-impact, or the reverse? | **Open.** Provisional: known-broken first |
| C-13 | Policy removal | Invalidate reachability (§5.6) vs model potential reachability | **Open.** Provisional: invalidate |
| C-14 | Certificate scope | Per-target vs environment-wide | Resolved: `T_scope` per plan; environment-wide when `T_scope` = all crown jewels |
| C-15 | LIVE verification | Query 5 is direct-chain only | **Open, deferred** with LIVE mode; must be generalised to ITM-1 before enabling |
| C-16 | Stale evidence handling | Strict (no certificate) vs pessimistic closure (assume stale edges present) | **Open.** Provisional: strict for MVP |
| C-17 | Uncuttable entry | Egress-only catalogue cannot remove ENTRY steps (exposure) | Accepted limitation for MVP; ingress actions deferred |
| C-18 | A/B workbench | Doc 04/05 two-candidate comparison vs planner's ranked alternatives | Resolved: UI shows best plan, up to 3 alternatives and the best hard-isolation plan |
| C-19 | Memory priority | Doc 06 lists memory as P0; decision 3 says it must not jeopardise the core | Resolved: P0 but degradable (FR-18, TC-41); cut first if Day 3 slips |
| C-20 | Cluster definition | `(target, entry ingress)` grouping may split chains that share a cut | **Open.** Acceptable for display; the environment-wide plan is computed over all chains |

---

## 15. Demo Narrative (supersedes doc 06 §12.2 outline; old outline preserved there)
1. **0:00–0:25:** 1,000 synthetic alerts → live funnel; the inconclusive branch is visible; click any number to see the query.
2. **0:25–0:50:** Restraint: same CVE on two pods; one is `NOT_ON_ATTACK_PATH`, with the graph evidence.
3. **0:50–1:40:** Planner: best plan versus alternatives and hard isolation, with computed impact; the overlap cluster shows "no zero-disruption plan exists; this one breaks 1 declared dependency".
4. **1:40–2:15:** Hunter: round 1 finds a residual 4-hop lateral path the bounded planner missed; re-plan; round 2: E, F and O agree on no path → certificate with assumptions and exclusions shown.
5. **2:15–2:40:** Break It Yourself: the viewer grants a pod database access; the certificate becomes `SUPERSEDED`; re-investigation shows the new chain.
6. **2:40–3:00:** MCP tool calls, memory recall of the earlier certificate, `/system` measured latencies; close on "model-verified, with its limits stated".

---

## 16. Sources
- FalkorDB `algo.maxFlow`: https://docs.falkordb.com/algorithms/maxflow
- FalkorDB betweenness centrality: https://docs.falkordb.com/algorithms/betweenness-centrality
- FalkorDB `GRAPH.COPY`: https://docs.falkordb.com/commands/graph.copy
- FalkorDB configuration (`TIMEOUT_DEFAULT`, `TIMEOUT_MAX`): https://docs.falkordb.com/getting-started/configuration
- Kubernetes Network Policies (default isolation, additive semantics, plugin requirement, no explicit deny): https://kubernetes.io/docs/concepts/services-networking/network-policies/
- MCP Streamable HTTP transport security (Origin validation, authentication): https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- Google Online Boutique (Apache-2.0), reference for the declared-dependency fixture: https://github.com/GoogleCloudPlatform/microservices-demo
- Max-flow min-cut theorem: https://en.wikipedia.org/wiki/Max-flow_min-cut_theorem
- Set cover / hitting set NP-hardness (Karp, 1972): https://en.wikipedia.org/wiki/Set_cover_problem
- CVSS v3.1 attack vector metric: https://www.first.org/cvss/v3.1/specification-document
