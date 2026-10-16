"""Build the synthetic environment and load it into FalkorDB.

uv run python -m interdict.seed                 # load `template` (no-op if already current)
uv run python -m interdict.seed --replace       # rebuild even if current
uv run python -m interdict.seed --seed 7 --alerts 500 --graph scratch:template
"""

from __future__ import annotations

import argparse
import json
import sys

from interdict.config import Settings, find_dotenv, load_dotenv
from interdict.db import connect
from interdict.graphstore import GraphStore
from interdict.seed.generator import DEFAULT_SEED, generate
from interdict.seed.loader import load


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m interdict.seed", description=__doc__.splitlines()[0]
    )
    parser.add_argument("--graph", default="template", help="graph to write (default: template)")
    parser.add_argument(
        "--seed", type=int, default=DEFAULT_SEED, help=f"generator seed (default: {DEFAULT_SEED})"
    )
    parser.add_argument("--alerts", type=int, default=1000, help="number of alerts (default: 1000)")
    parser.add_argument(
        "--replace", action="store_true", help="rebuild even if the graph is current"
    )
    args = parser.parse_args(argv)

    load_dotenv(find_dotenv())
    settings = Settings.from_env()
    store = GraphStore(connect(settings))
    env = generate(seed=args.seed, alert_count=args.alerts)
    result = load(store, env, args.graph, replace=args.replace, row_limit=settings.resultset_size)
    print(
        json.dumps(
            {
                "graph": result.graph,
                "skipped": result.skipped,
                "seed": args.seed,
                "alerts": args.alerts,
                "nodes": result.nodes,
                "edges": result.edges,
                "seconds": round(result.seconds, 2),
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
