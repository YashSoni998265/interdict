"""The Interdict agent: it reads what each tool returns and decides the next step (D-22).

There is no AI model. Every decision is a written rule over tool results, so each one can be
explained, repeated and tested, and a run costs nothing. The agent calls the seven MCP tools like
any other client: it decides what to do, the engine decides what is true, and the Action Gateway
decides what may be done.

Its rules, in order:
- read memory first: what this session already learned about the crown jewel changes the plan,
  but a recalled result is a starting point and is always verified again;
- stop when evidence is missing, stale or failed: inconclusive, never "safe";
- prefer a fix whose impact on legitimate traffic is fully known, and accept unknown impact only
  when no such fix cuts every path, saying so in the report;
- plan again once if the graph changes while the agent is working;
- act only with a certificate, through the Action Gateway, in simulation; otherwise hand the
  surviving paths to a person.

Guards in code: at most 12 tool calls, and the final report's status, plan, certificate and
receipt are copied from tool results.
"""

from __future__ import annotations

from typing import Any

from interdict.events import Timeline
from interdict.investigation import Invoker, call_tool, fail, final_report, finish

MODE = "agent"
MAX_TOOL_CALLS = 12
# Evidence the agent will not plan on (CollectionStatus); COLLECTED_EMPTY is a valid answer.
BLOCKING_EVIDENCE = ("STALE_EXPIRED", "QUERY_FAILED", "UNCOLLECTED")
UNKNOWN_IMPACT_EXCLUDED = "UNKNOWN_IMPACT_EXCLUDED"


class BudgetSpentError(Exception):
    """The run reached MAX_TOOL_CALLS."""


async def run_agent(
    invoker: Invoker,
    timeline: Timeline,
    *,
    cluster_id: str,
    storm_id: str,
    investigation_id: str,
) -> dict[str, Any]:
    """Investigate one cluster, deciding each step from the previous results."""
    agent = _Agent(invoker, timeline, cluster_id)
    try:
        return await agent.investigate(storm_id, investigation_id)
    except BudgetSpentError:
        agent.decide(
            f"The budget of {MAX_TOOL_CALLS} tool calls is spent. Stopping without acting."
        )
        return agent.finish("INCONCLUSIVE", notes=[f"Stopped at the {MAX_TOOL_CALLS}-call budget."])


class _Agent:
    def __init__(self, invoker: Invoker, timeline: Timeline, cluster_id: str) -> None:
        self.invoker = invoker
        self.timeline = timeline
        self.cluster_id = cluster_id
        self.calls = 0
        self.storm: dict[str, Any] | None = None
        self.memory: dict[str, Any] | None = None
        self.notes: list[str] = []

    async def call(self, tool: str, arguments: dict[str, Any], why: str) -> dict[str, Any]:
        if self.calls >= MAX_TOOL_CALLS:
            raise BudgetSpentError
        self.calls += 1
        return await call_tool(self.invoker, self.timeline, tool, arguments, why)

    def decide(self, text: str) -> None:
        self.timeline.narrate(text, source=MODE)

    def finish(
        self,
        status: str,
        *,
        plan: dict[str, Any] | None = None,
        hunted: dict[str, Any] | None = None,
        receipt: dict[str, Any] | None = None,
        notes: list[str] | None = None,
    ) -> dict[str, Any]:
        return finish(
            self.timeline,
            final_report(
                mode=MODE,
                cluster_id=self.cluster_id,
                storm=self.storm,
                plan=plan,
                hunted=hunted,
                receipt=receipt,
                memory=self.memory,
                status=status,
                notes=[*self.notes, *(notes or [])],
            ),
        )

    async def investigate(self, storm_id: str, investigation_id: str) -> dict[str, Any]:
        self.timeline.lifecycle("TRIAGING")
        triage = await self.call(
            "triage_alert_storm",
            {"storm_id": storm_id},
            "Start from the whole storm: which alerts sit on a real attack path?",
        )
        if not triage["ok"]:
            return fail(self.timeline, MODE, self.cluster_id, triage)
        storm = self.storm = triage["brief"]
        cluster = next((c for c in storm["clusters"] if c["id"] == self.cluster_id), None)
        if cluster is None:
            if not storm["complete"]:
                count = storm["counts"]["TRIAGE_INCONCLUSIVE"]
                self.decide(
                    f"{count} alerts are inconclusive because evidence is missing or stale, and "
                    f"{self.cluster_id} is not in the triage. Stopping: missing evidence is never "
                    "treated as safe."
                )
                return self.finish("INCONCLUSIVE")
            self.decide(
                f"{self.cluster_id} is not in the current triage, so there is nothing to fix."
            )
            return self.finish("NOT_FOUND")
        target, entry = cluster["target"], cluster["witness_path"][1]

        self.timeline.lifecycle("ANALYZING")
        recalled = await self.call(
            "recall_incident_memory",
            {"asset_ids": [target]},
            f"Read memory first: what is already known about {target}?",
        )
        self.memory = recalled["brief"] if recalled["ok"] else {"status": "UNAVAILABLE"}
        memory_says, skip_known_impact = self.read_memory(target)

        evidence = await self.call(
            "find_evidence_by_workload",
            {"pod_id": entry},
            f"{memory_says} Check {entry}'s evidence before planning on it.",
        )
        if not evidence["ok"]:
            return fail(self.timeline, MODE, self.cluster_id, evidence)
        blocked = [
            (tier, record["status"])
            for tier, record in evidence["brief"]["tiers"].items()
            if record["status"] in BLOCKING_EVIDENCE
        ]
        if blocked:
            tier, status = blocked[0]
            self.decide(
                f"The {tier} evidence for {entry} is {status}. Stopping: Interdict does not plan "
                "on missing, stale or failed evidence."
            )
            return self.finish("INCONCLUSIVE", notes=[f"{entry}: {tier} evidence {status}."])

        paths = await self.call(
            "find_attack_paths_to_asset",
            {"target_db_id": target, "max_lateral_hops": 3},
            f"Evidence for {entry} is usable. Map every attack chain into {target}.",
        )
        if not paths["ok"]:
            return fail(self.timeline, MODE, self.cluster_id, paths)
        chains = len(paths["brief"]["chains"])
        if chains == 0 and not paths["brief"]["beyond_bound"]:
            self.decide(f"No attack chain reaches {target} any more. Nothing to fix.")
            return self.finish("NO_ATTACK_PATH")

        if skip_known_impact:
            why = "Memory: no fully known fix cut every path at this revision. Skip that attempt."
            return await self.plan_and_hunt(investigation_id, known_impact=False, why=why)
        why = (
            f"{chains} {'chain reaches' if chains == 1 else 'chains reach'} {target}. Prefer a fix "
            "whose impact is fully known."
        )
        return await self.plan_and_hunt(investigation_id, known_impact=True, why=why)

    def read_memory(self, target: str) -> tuple[str, bool]:
        """What memory changes: a sentence for the next step, and whether to skip a known failure."""
        memory = self.memory or {}
        if memory.get("status") != "AVAILABLE":
            return "Memory is unavailable, so plan without it.", False
        entries = [e for e in memory.get("entries", []) if target in (e.get("t_scope") or [])]
        if not entries:
            return f"Nothing learned yet about {target}.", False
        current = memory.get("current_revision")
        skip = any(
            e.get("cluster_id") == self.cluster_id
            and e.get("sandbox_revision") == current
            and e.get("status") == "NO_FEASIBLE_PLAN_WITHIN_K"
            and e.get("reason") == UNKNOWN_IMPACT_EXCLUDED
            for e in entries
        )
        certified = next((e for e in entries if e.get("certificate")), None)
        if certified is None:
            return (
                f"Memory has {len(entries)} earlier result(s) for {target}, none certified.",
                skip,
            )
        status = certified.get("certificate_status_now")
        if status == "VALID":
            return "Memory has a certificate that still holds; verify it again anyway.", skip
        revision = certified["certificate"].get("sandbox_revision")
        return (
            f"The certificate in memory no longer holds ({status}: revision {revision}, now "
            f"{current}).",
            skip,
        )

    async def plan_and_hunt(
        self, investigation_id: str, *, known_impact: bool, why: str, replanned: bool = False
    ) -> dict[str, Any]:
        self.timeline.lifecycle("PLANNING")
        planned = await self.call(
            "plan_remediation",
            {"cluster_id": self.cluster_id, "require_known_impact": known_impact},
            why,
        )
        if not planned["ok"]:
            return fail(self.timeline, MODE, self.cluster_id, planned)
        plan = planned["brief"]
        if not plan.get("plan_id"):
            if known_impact and plan.get("no_plan_reason") == UNKNOWN_IMPACT_EXCLUDED:
                return await self.plan_and_hunt(
                    investigation_id,
                    known_impact=False,
                    why="No fix with fully known impact exists. Accept unknown impact, and flag it.",
                )
            return self.hand_over(
                plan["status"],
                plan.get("no_plan_reason") or plan.get("inconclusive_reason"),
                plan=plan,
            )

        self.timeline.lifecycle("HUNTING")
        hunted = await self.call(
            "hunt_residual_paths",
            {"plan_id": plan["plan_id"]},
            (
                "Found a fix with fully known impact. Try to break it on a copy of the graph."
                if known_impact
                else "Try to break the fix on a copy of the graph, with no hop limit."
            ),
        )
        if not hunted["ok"]:
            if hunted["error"]["code"] == "PRECONDITION_FAILED" and not replanned:
                self.decide(
                    f"{hunted['error']['message']}. The graph changed while I worked: planning again."
                )
                return await self.plan_and_hunt(
                    investigation_id,
                    known_impact=known_impact,
                    why="The graph changed during the run. Plan again from the current graph.",
                    replanned=True,
                )
            return fail(self.timeline, MODE, self.cluster_id, hunted)
        hunt = hunted["brief"]
        certificate = hunt.get("certificate")
        if certificate:
            return await self.act(investigation_id, plan, hunt, certificate, known_impact)
        if known_impact and hunt.get("reason") == UNKNOWN_IMPACT_EXCLUDED:
            return await self.plan_and_hunt(
                investigation_id,
                known_impact=False,
                why=(
                    "No fully known fix cuts the paths the hunt found. Accept unknown impact, "
                    "and flag it."
                ),
            )
        return self.hand_over(hunt["status"], hunt.get("reason"), plan=plan, hunted=hunt)

    async def act(
        self,
        investigation_id: str,
        plan: dict[str, Any],
        hunt: dict[str, Any],
        certificate: dict[str, Any],
        known_impact: bool,
    ) -> dict[str, Any]:
        unknown = (hunt.get("final_plan") or {}).get("unknown_impact_flows") or []
        if unknown and not known_impact:
            shown = ", ".join(unknown[:3]) + (
                f" and {len(unknown) - 3} more" if len(unknown) > 3 else ""
            )
            self.notes.append(f"Accepted unknown impact on {len(unknown)} flow(s): {shown}.")
        self.timeline.lifecycle("EXECUTING")
        submitted = await self.call(
            "submit_remediation_execution",
            {
                "plan_id": certificate["certified_plan_id"],
                "certificate_id": certificate["certificate_id"],
                "execution_mode": "SIMULATION",
                "idempotency_key": investigation_id,
            },
            "Certified: all three checks agree. Record the fix through the Gateway (simulation).",
        )
        receipt = submitted["brief"] if submitted["ok"] else None
        targets = ", ".join(hunt["t_scope"])
        if receipt and receipt.get("status") == "ACCEPTED":
            self.decide(
                f"Certificate {certificate['certificate_id']}: no modelled path reaches {targets}. "
                "The fix is recorded as a simulation; no infrastructure was changed."
            )
        else:
            detail = (receipt or {}).get("detail") or (submitted.get("error") or {}).get(
                "message", ""
            )
            self.decide(
                f"The Action Gateway did not accept the fix ({detail}). Nothing was recorded."
            )
            receipt = None
        return self.finish(hunt["status"], plan=plan, hunted=hunt, receipt=receipt)

    def hand_over(
        self,
        status: str,
        reason: str | None,
        *,
        plan: dict[str, Any],
        hunted: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """No certificate: report why, and hand anything that survives to a person."""
        surviving = [" → ".join(p) for p in (hunted or {}).get("residual_paths") or []]
        because = f" ({reason})" if reason else ""
        if surviving:
            self.decide(
                f"{len(surviving)} path(s) survive every fix within 3 changes{because}. Handing them "
                "to a person: " + "; ".join(surviving[:3]) + "."
            )
        elif "INCONCLUSIVE" in status:
            self.decide(f"The result is inconclusive{because}, so no certificate and no action.")
        else:
            self.decide(
                f"No safe fix within 3 changes{because}. Handing this to a person; nothing was recorded."
            )
        return self.finish(status, plan=plan, hunted=hunted)
