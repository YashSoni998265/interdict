# Interdict

**Graph-grounded security triage on FalkorDB.** Interdict turns a flood of vulnerability alerts into the few attack paths that actually reach your crown-jewel databases. It then finds the least-disruptive Kubernetes NetworkPolicy change that cuts every modelled path, checks that change with an independent graph search, and only then issues a model-verified containment certificate.

> Built for **WeMakeDevs × FalkorDB Graph Hacks 2026, Track 01: Agents That Act on Connected Data** (Oct 15–18, 2026). Work in progress.

## Why "Interdict"?
In operations research, *network interdiction* is the problem of removing the fewest edges from a network so that nothing can flow from a source to a target. Interdict does this for attack paths: it looks for the smallest safe cut between the Internet and your sensitive data, and verifies, within its stated threat model, that the cut holds.

## Status
| Area | State |
| :--- | :--- |
| Specification | Complete: [`solution.md`](solution.md) |
| FalkorDB runtime checks (Day-1 gates G0–G3) | Done: results in `solution.md` §17.1 |
| Engine, agent, UI | In progress |
| Live demo | Not yet deployed |

## Local development
Prerequisites: Docker and [uv](https://docs.astral.sh/uv/).

```bash
cp .env.example .env                  # then set FALKORDB_PASSWORD
docker compose up -d falkordb         # FalkorDB v4.22.1 (pinned), bound to localhost
cd backend
uv sync
uv run pytest                         # tests run against the local FalkorDB
uv run python scripts/day1_gates.py   # re-run the Day-1 runtime checks
```

## Repository layout (planned)
| Path | Contents |
| :--- | :--- |
| `backend/` | Python: engine (graph queries, planner, Path Hunter, certificates), independent oracle, API, MCP server, agent |
| `frontend/` | React + TypeScript web app |
| `docs/` | Pre-event planning notes (supporting material for `solution.md`) |
| `solution.md` | Canonical end-to-end specification |

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md). `main` is protected: every change goes through a pull request with passing CI.

## Security
See [SECURITY.md](SECURITY.md). Interdict runs only on synthetic data and never changes real infrastructure.

## AI usage disclosure
This project is built with an AI coding assistant (Claude Code). The planning documents in `docs/` and `solution.md` were prepared before the event as notes; all application code is written during the event and is reviewed and tested by the team. Commits that include AI-written changes carry a `Co-Authored-By` trailer.

## License
[MIT](LICENSE)
