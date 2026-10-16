# Interdict web app

The face of Interdict: the alert storm, the investigation workbench (attack subgraph, agent timeline, plan comparison, Path Hunter rounds), the certificate, the sandbox and the system page. It only displays engine output; it never computes a verdict. Everything it shows is synthetic and simulated: no infrastructure is ever changed.

## Run it

Requires Node 22 LTS (`.nvmrc`) and npm.

```bash
cd frontend
npm ci
npm run dev            # http://localhost:5173, mock API: no backend needed
```

The default **mock** mode serves the real engine's recorded output (`src/mocks/fixtures`, written by `backend/scripts/export_ui_fixtures.py` on seed 20261018) in the browser, with small realistic delays and the investigation streamed event by event.

To use the live API instead:

```bash
VITE_API_MODE=http npm run dev                       # proxies /api to http://127.0.0.1:8000
VITE_API_MODE=http VITE_DEV_API_PROXY=http://127.0.0.1:9000 npm run dev
VITE_API_MODE=http npm run build                     # bundle for the API to serve same-origin
```

| Variable | Default | Meaning |
| :--- | :--- | :--- |
| `VITE_API_MODE` | `mock` | `mock` serves the recorded fixtures; `http` calls the API |
| `VITE_API_BASE` | `''` | API origin in `http` mode; empty means same origin (production) |
| `VITE_DEV_API_PROXY` | `http://127.0.0.1:8000` | Dev server only: where `/api` is proxied |

Copy `.env.example` to `.env.local` to set them persistently. They are public build-time settings, never secrets.

## Checks

```bash
npm run lint        # ESLint 9 flat config, typescript-eslint (type-checked), jsx-a11y, react-hooks
npm run typecheck   # tsc -b (strict, noUncheckedIndexedAccess)
npm test            # Vitest + Testing Library
npm run build       # typecheck, then vite build into dist/
npm run preview     # serve dist/ locally
```

CI runs the same four commands in the `web` job of `.github/workflows/ci.yml`.

## Screens

| Route | What it shows |
| :--- | :--- |
| `/` | One-sentence value, the 60-second demo, how it works, dataset disclosure |
| `/storm` | Funnel from 1,000 alerts to clusters with every branch visible, the restraint example, cluster cards with their plan status, every alert (untrusted titles shown inert) |
| `/clusters/:clusterId` | Workbench: evidence graph and tier checklist, agent timeline, plan comparison, Hunter rounds, certificate, audit strip. Three panes at 1280 px and wider, tabs below |
| `/certificates/:certificateId` | The §9.2 certificate: claim, scope, snapshot hashes, threat model, evidence, E/F/O results, rounds, plan, provenance, exclusions verbatim; greyed when superseded or expired |
| `/sandbox` | Break it yourself (also a drawer from the header): typed operations with a preview, results, history, reset |
| `/system` | FalkorDB version, build, seed, agent availability, graph stats, measured query latencies, MCP tools |

## How it stays honest

- **One status language** (`src/lib/status.ts`, solution.md §13.4): every status has the same colour, icon and words everywhere, and colour is never the only signal. Containment always reads "Model-verified containment (simulation)", only with a certificate that is still current; after a sandbox change it reads "Certificate no longer current".
- **Every number has a source** (`src/lib/numberSources.ts`, §13.5): numbers render through `<Num>`, whose tooltip (hover and keyboard focus) gives the category (`CALCULATED_GRAPH`, `MEASURED_ALGO`, `MEASURED_RUNTIME`, plus `CONSTANT` and `SYNTHETIC_INPUT`) and the formula. Truncated counts show `≥`. There are no percentages or risk scores.
- **Untrusted text** (§10.8): alert titles arrive as `{"untrusted_text": …}` and render through `<UntrustedText>` as inert plain text with a marker. An ESLint rule forbids `dangerouslySetInnerHTML` everywhere.
- **States** (§13.6): live progress instead of spinners, typed errors with a retry (never "0 paths"), empty states with the evidence behind them, inconclusive reasons, superseded and stale banners, the replay banner in mock mode, and the persistent "Simulation only" badge.

## Mock mode details

- It cannot recompute. After a sandbox operation it keeps serving the revision-1 recording, and every view says it was computed at an older revision.
- It follows the API contract: sessions, CSRF, plan handles, `{investigation_id, mode, notes}` (agent mode falls back to the recorded deterministic run with a note), one investigation at a time (`BUSY`), revisions that only increase (a reset is a revision too), certificate status recomputed on read (`SUPERSEDED` once the revision changes, `EXPIRED` after `expires_at`), and an audit log hash-chained in the browser with SHA-256 (`chain_valid`).
- Its clock starts at the recording's evaluation time (17 Oct 2026, 10:00 UTC), so recorded certificates expire on the recording's schedule rather than today's.
- The recorded "all crown jewels at once" hunt (`NO_FEASIBLE_PLAN_WITHIN_K`, `K_EXCEEDED`) has no REST route, so it is shown only in mock mode, on the storm page.

## Code map

| Path | Contents |
| :--- | :--- |
| `src/api/` | Wire types (mirroring `backend/src/interdict/views.py` and `events.py`), the `ApiClient` interface, the `http` and `mock` clients, React Query hooks |
| `src/lib/` | Pure helpers: status language, number sources, timeline derivation, graph overlays per Hunter round, ELK layout, formatting |
| `src/state/` | Sandbox revision and history; investigation runs whose event streams survive navigation |
| `src/components/` | UI primitives (Radix-based), graph (React Flow), evidence, timeline, plan, hunt, certificate, storm, sandbox, workbench panes |
| `src/pages/` | One file per route |

## Accessibility

Keyboard navigation with visible focus everywhere, labelled regions and controls, a table view as the text alternative to the graph, screen-reader announcements for new timeline steps, `prefers-reduced-motion` respected, and text colours that meet WCAG AA on the dark surfaces. The intent is WCAG 2.2 AA; no formal audit has been run.

## Credits

React Flow (MIT), Eclipse Layout Kernel via elkjs (EPL-2.0), Radix UI (MIT), TanStack Query (MIT), Lucide icons (ISC), Inter and JetBrains Mono via Fontsource (OFL-1.1). The environment's layout is shaped on Google's Online Boutique (Apache-2.0); attack steps carry MITRE ATT&CK® technique labels.
