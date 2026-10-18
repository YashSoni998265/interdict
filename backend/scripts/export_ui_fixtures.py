"""Export real engine results as JSON fixtures for the web app's mock API.

Runs the engine on the default synthetic environment (seed 20261018, 1,000 alerts) in a
throwaway sandbox and writes the exact views the API serves, so the UI is built against real
numbers rather than invented ones. Each investigation is the real agent's run in a fresh session,
recorded as the event stream sends it; its hunt and certificate are written from that same run.
Usage (FalkorDB running):

    uv run python scripts/export_ui_fixtures.py ../frontend/src/mocks/fixtures
"""

from __future__ import annotations

import asyncio
import json
import secrets
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from interdict.agent import run_agent
from interdict.config import Settings, find_dotenv, load_dotenv
from interdict.db import connect
from interdict.engine.attackgraph import export_steps
from interdict.engine.hunter import hunt
from interdict.engine.planner import plan_remediation
from interdict.engine.sandbox import create_sandbox
from interdict.engine.triage import run_triage
from interdict.events import Timeline
from interdict.graphstore import GraphStore
from interdict.investigation import DirectInvoker
from interdict.seed import GENERATOR_VERSION, generate
from interdict.seed.generator import DEFAULT_SEED
from interdict.seed.loader import load
from interdict.session import SessionKeys
from interdict.tools import ToolContext
from interdict.views import (
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
        for stale in ("certificates", "hunts", "investigations"):
            for path in (out / stale).glob("*.json"):
                path.unlink()
        for cluster in report.clusters:
            chains = [c for c in report.chains if c.id in set(cluster.chain_ids)]
            planned = plan_remediation(report, chains)
            hunted = hunt(store, report, {cluster.target}, chains)
            if hunted.certificate:
                created.append(hunted.certificate.candidate_graph_key)
            final_plan = hunted.plan.plan if hunted.plan else None
            write(out, f"plans/{cluster.id}.json", plan_report_view(planned))
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
            record_agent(store, template, report.storm_id, cluster.id, out)

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
                "agent": "decision rules over tool results (no AI model)",
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


def record_agent(
    store: GraphStore, template: str, storm_id: str, cluster_id: str, out: Path
) -> None:
    """Record the agent investigating one cluster in a fresh session, and the hunt and the
    certificate of that run, so the mock serves one consistent set of ids."""
    keys = SessionKeys.derive(secrets.token_urlsafe(24), secrets.token_urlsafe(48))
    ctx = ToolContext(store, keys, clock=lambda: NOW, template=template)
    create_sandbox(store, keys.sandbox, STAMP, template=template)
    clock = iter(NOW + timedelta(milliseconds=180 * i) for i in range(1000))
    events = Timeline(clock=lambda: next(clock))
    investigation_id = f"inv-fixture-{cluster_id}"
    try:
        asyncio.run(
            run_agent(
                DirectInvoker(ctx),
                events,
                cluster_id=cluster_id,
                storm_id=storm_id,
                investigation_id=investigation_id,
            )
        )
        write(
            out,
            f"investigations/{cluster_id}.json",
            {"investigation_id": investigation_id, "events": events.events},
        )
        hunts = [
            e["data"]
            for e in events.events
            if e["type"] == "tool_result" and e["tool"] == "hunt_residual_paths" and e["ok"]
        ]
        if hunts:
            final = {k: v for k, v in hunts[-1].items() if k != "plan_id"}
            write(out, f"hunts/{cluster_id}.json", final)
            certificate_id = (final.get("certificate") or {}).get("certificate_id")
            if certificate_id:
                certificate = ctx.records.get(keys.certificate(certificate_id))
                write(out, f"certificates/{certificate_id}.json", certificate)
    finally:
        client = store.db.connection
        for key in client.scan_iter(f"certificate:{keys.key}:*"):
            store.delete("cert:" + key.split(":")[-1])
        for name in store.names():
            if keys.key in name:
                store.delete(name)
        for key in client.scan_iter(f"*{keys.key}*"):
            client.delete(key)


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "fixtures"))
