# Contributing to Interdict

## Ground rules
- `main` is protected. No direct pushes, no force-pushes, no deletion. Every change lands through a pull request (PR) with green CI and resolved review threads.
- One purpose per PR, kept small (aim for under ~400 changed lines, excluding lockfiles and generated files).
- [`solution.md`](solution.md) is the canonical specification. If a change alters a design decision, record it in §0.2 as a new `D-xx` entry **in the same PR**.
- Hackathon rules: all application code is written during the event; AI assistance is disclosed (commits with AI-written changes carry a `Co-Authored-By` trailer); every contributor must understand, and be able to explain, what they merge.

## Workflow
1. Pick or open an issue using the **Task** template.
2. Branch from an up-to-date `main`:
   ```bash
   git switch main && git pull
   git switch -c feat/alert-storm-triage
   ```
3. Commit using Conventional Commits (below). Run the local checks before pushing.
4. Push and open a PR. The PR template asks how the change was verified. Request a review from the other team member.
5. Merge with **Squash and merge** once CI passes and review threads are resolved. The PR title becomes the commit message on `main`, and the branch is deleted automatically.

## Branch names
`<type>/<short-kebab-summary>`, for example `feat/path-hunter`, `fix/stale-evidence-status`, `docs/readme-setup`.

Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`.

## Commit messages and PR titles (Conventional Commits)
```
<type>(<scope>): <imperative summary>
```
- Scopes: `engine`, `oracle`, `seed`, `api`, `mcp`, `agent`, `web`, `infra`, `docs`, `ci`.
- Examples:
  - `feat(engine): build ATTACK_STEP edges from fresh evidence`
  - `fix(api): reject sandbox operations without a CSRF token`
  - `test(oracle): add hand-built fixtures for one-way reachability`
- Breaking change: `feat(api)!: …` plus a `BREAKING CHANGE:` footer.
- CI checks that **PR titles** follow this format, because squash-merging turns the PR title into the commit on `main`.

## Reviews
- Required approvals: **1** once both team members are repository collaborators (temporarily 0 while the second account is being added).
- Reviewers check:
  - correctness against `solution.md`;
  - tests (reference `TC-xx` IDs from `solution.md` §16);
  - honesty rules: no containment claim without a certificate, and inconclusive results never presented as safe;
  - security: no raw or LLM-generated Cypher, no secrets, no non-synthetic data.

## Local checks
```bash
uvx pre-commit install          # once per clone: runs the hooks on every commit
uvx pre-commit run --all-files  # run everything manually
```
The hooks block commits to `main`, scan for secrets (gitleaks), and lint and format Python (ruff). Backend and frontend commands will be added with the project skeleton.
