"""Export real engine results as JSON fixtures for the web app's mock API.

Runs the engine on the default synthetic environment (seed 20261018, 1,000 alerts) in a
throwaway sandbox and writes the exact views the API serves, so the UI is built against real
numbers rather than invented ones. Usage (FalkorDB running):

    uv run python scripts/export_ui_fixtures.py ../frontend/src/mocks/fixtures
"""

from __future__ import annotations

import json
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from interdict.config import Settings, find_dotenv, load_dotenv
from interdict.db import connect
from interdict.engine.attackgraph import export_steps
from interdict.engine.hunter import hunt
from interdict.engine.planner import plan_remediation
from interdict.engine.sandbox import create_sandbox
from interdict.engine.statuses import CertificateStatus
from interdict.engine.triage import run_triage
from interdict.events import Timeline
from interdict.graphstore import GraphStore
from interdict.seed import GENERATOR_VERSION, generate
from interdict.seed.generator import DEFAULT_SEED
from interdict.seed.loader import load
from interdict.views import (
    certificate_view,
    chain_view,
    hunt_view,
    plan_report_view,
    storm_view,
    subgraph_view,
    workload_evidence_view,
)

STAMP = datetime(2026, 10, 17, 9, 0, tzinfo=UTC)
NOW = STAMP + timedelta(hours=1)


def write(out: Path, name: str, data: object) -> None:
    path = out / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, separators=(",", ":")) + "\n")  # generated: compact
    print(f"wrote {path} ({path.stat().st_size // 1024} KB)")


def main(out: Path) -> None:
    load_dotenv(find_dotenv(Path(__file__).resolve()))
    store = GraphStore(connect(Settings.from_env()))
    template = f"fixtures:tpl:{uuid.uuid4().hex[:8]}"
    sandbox = f"fixtures:sbx:{uuid.uuid4().hex[:8]}"
    created: list[str] = []
    try:
        load(store, generate(alert_count=1000), template)
        create_sandbox(store, sandbox, STAMP, template=template)
        report = run_triage(store, sandbox, NOW)
        steps = export_steps(store, sandbox)
        write(out, "storm.json", storm_view(report))

        clusters = {c.id: c for c in report.clusters}
        for cluster in report.clusters:
            chains = [c for c in report.chains if c.id in set(cluster.chain_ids)]
            planned = plan_remediation(report, chains)
            hunted = hunt(store, report, {cluster.target}, chains)
            if hunted.certificate:
                created.append(hunted.certificate.candidate_graph_key)
            final_plan = hunted.plan.plan if hunted.plan else None
            write(out, f"plans/{cluster.id}.json", plan_report_view(planned))
            write(out, f"hunts/{cluster.id}.json", hunt_view(hunted))
            write(
                out,
                f"subgraphs/{cluster.id}.json",
                subgraph_view(
                    report,
                    steps,
                    hunted.chains or chains,
                    plan=final_plan,
                    extra_paths=tuple(tuple(p) for p in cluster_paths(cluster)),
                ),
            )
            if hunted.certificate:
                write(
                    out,
                    f"certificates/{hunted.certificate.certificate_id}.json",
                    certificate_view(hunted.certificate, CertificateStatus.VALID),
                )
            write(
                out,
                f"investigations/{cluster.id}.json",
                timeline(report, cluster, chains, planned, hunted),
            )

        everything = hunt(store, report, report.snapshot.crown_jewels, report.chains)
        write(out, "hunts/all-crown-jewels.json", hunt_view(everything))

        for pod in sorted({p for c in report.chains for p in c.pods} | set(deep_pods(clusters))):
            write(out, f"evidence/{pod}.json", workload_evidence_view(report.snapshot, pod))

        write(
            out,
            "system.json",
            {
                "falkordb_version": store.server_version(),
                "generator_version": GENERATOR_VERSION,
                "seed": DEFAULT_SEED,
                "dataset": "synthetic (Online Boutique-shaped, DEMO-CVE identifiers)",
                "graph_stats": storm_view(report, alerts=False)["graph_stats"],
                "latencies_ms": {q.template: q.latency_ms for q in report.queries},
                "build_sha": "fixture",
                "live_mode": False,
            },
        )
    finally:
        for name in (sandbox, template, *created):
            store.delete(name)


def cluster_paths(cluster) -> list[tuple[str, ...]]:
    return [tuple(cluster.witness_path)] if cluster.beyond_bound else []


def deep_pods(clusters) -> list[str]:
    return [p for c in clusters.values() if c.beyond_bound for p in c.witness_path[1:-1]]


def timeline(report, cluster, chains, planned, hunted) -> dict:
    """The deterministic investigation sequence for one cluster, in the stream's event schema."""
    clock = iter(NOW + timedelta(milliseconds=180 * i) for i in range(1000))
    events = Timeline(clock=lambda: next(clock))
    events.lifecycle("TRIAGING")
    call = events.next_call_id()
    events.emit(
        "tool_call",
        call_id=call,
        tool="triage_alert_storm",
        input={"storm_id": report.storm_id},
        why="Sort the whole alert storm by whether each alert sits on a real attack path.",
    )
    storm = storm_view(report, alerts=False)
    events.emit(
        "tool_result",
        call_id=call,
        tool="triage_alert_storm",
        ok=True,
        summary=(
            f"{storm['counts']['ON_ATTACK_PATH']} of {storm['total_alerts']} alerts are on an "
            f"attack path, in {len(storm['clusters'])} clusters."
        ),
        latency_ms=round(sum(q["latency_ms"] for q in storm["queries"]), 1),
        evidence_ids=[q["id"] for q in storm["queries"]],
        data=storm,
    )
    events.lifecycle("ANALYZING")
    entry = cluster.witness_path[1]
    call = events.next_call_id()
    events.emit(
        "tool_call",
        call_id=call,
        tool="find_evidence_by_workload",
        input={"pod_id": entry},
        why=f"Check the four evidence tiers for the entry workload {entry}.",
    )
    evidence = workload_evidence_view(report.snapshot, entry)
    events.emit(
        "tool_result",
        call_id=call,
        tool="find_evidence_by_workload",
        ok=True,
        summary=", ".join(f"{k}: {v['status']}" for k, v in evidence["tiers"].items()),
        latency_ms=1.0,
        evidence_ids=[],
        data=evidence,
    )
    call = events.next_call_id()
    events.emit(
        "tool_call",
        call_id=call,
        tool="find_attack_paths_to_asset",
        input={"target_db_id": cluster.target, "max_lateral_hops": 3},
        why=f"List every bounded attack chain that ends at {cluster.target}.",
    )
    to_target = [chain_view(c) for c in report.chains if c.target == cluster.target]
    events.emit(
        "tool_result",
        call_id=call,
        tool="find_attack_paths_to_asset",
        ok=True,
        summary=f"{len(to_target)} chains of at most 3 lateral hops reach {cluster.target}.",
        latency_ms=1.0,
        evidence_ids=[],
        data={"target_db_id": cluster.target, "chains": to_target, "truncated": False},
    )
    events.lifecycle("PLANNING")
    call = events.next_call_id()
    events.emit(
        "tool_call",
        call_id=call,
        tool="plan_remediation",
        input={"cluster_id": cluster.id, "require_known_impact": False},
        why="Find the cheapest set of at most 3 allowlist policies that cuts every chain.",
    )
    events.emit(
        "tool_result",
        call_id=call,
        tool="plan_remediation",
        ok=True,
        summary=f"{planned.status.value}: {', '.join(planned.plan.action_ids) if planned.plan else 'no plan'}",
        latency_ms=1.0,
        evidence_ids=[],
        data=plan_report_view(planned),
    )
    events.lifecycle("HUNTING")
    call = events.next_call_id()
    plan_id = planned.plan.id if planned.plan else None
    events.emit(
        "tool_call",
        call_id=call,
        tool="hunt_residual_paths",
        input={"plan_id": plan_id},
        why="Apply the plan to a candidate graph and look for any surviving path with three methods.",
    )
    hunted_view = hunt_view(hunted)
    events.emit(
        "tool_result",
        call_id=call,
        tool="hunt_residual_paths",
        ok=True,
        summary=f"{hunted.status.value} after {len(hunted.rounds)} round(s).",
        latency_ms=round(sum(r.latency_ms["round"] for r in hunted.rounds), 1),
        evidence_ids=[],
        data=hunted_view,
    )
    status = hunted.status.value
    if hunted.certificate:
        events.lifecycle("EXECUTING")
        call = events.next_call_id()
        events.emit(
            "tool_call",
            call_id=call,
            tool="submit_remediation_execution",
            input={
                "plan_id": hunted.certificate.plan["plan_id"],
                "certificate_id": hunted.certificate.certificate_id,
                "execution_mode": "SIMULATION",
                "idempotency_key": "fixture-key",
            },
            why="Record the verified plan through the Action Gateway (simulation only).",
        )
        events.emit(
            "tool_result",
            call_id=call,
            tool="submit_remediation_execution",
            ok=True,
            summary="Simulation receipt recorded; no infrastructure was changed.",
            latency_ms=2.0,
            evidence_ids=[],
            data={
                "status": "ACCEPTED",
                "receipt_id": "rcpt-fixture",
                "execution_mode": "SIMULATION",
                "note": "Simulation only: no infrastructure is changed.",
            },
        )
    events.emit(
        "report",
        report={
            "status": status,
            "mode": "deterministic",
            "cluster_id": cluster.id,
            "t_scope": [cluster.target],
            "plan_id": hunted.certificate.plan["plan_id"] if hunted.certificate else None,
            "certificate_id": hunted.certificate.certificate_id if hunted.certificate else None,
            "headline": (
                "Model-verified containment (simulation)"
                if hunted.certificate
                else "No certificate: see the reason"
            ),
        },
    )
    events.emit("done", status=status)
    return {"investigation_id": f"inv-fixture-{cluster.id}", "events": events.events}


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "fixtures"))
