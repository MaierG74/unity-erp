# Unity ERP Agent Notes

This repository is being actively migrated to **multi-tenant** (organization/tenant) data isolation in Supabase using `org_id` + RLS.

## Execution Checklist (every tenant-scoped change)
1. Read `docs/README.md` and locate the canonical area docs for the feature.
2. Check `docs/overview/todo-index.md` for active tasks and source docs.
3. Apply organization scoping (`org_id`) and verify access behavior under RLS.
4. Update the canonical feature/domain docs before marking the work done.

## Branch Workflow
- `main` is release-only. Do not use it as the default branch for ongoing feature work.
- `codex/integration` is the shared working branch. It holds approved but not-yet-released work.
- **Never commit directly to local `codex/integration` or local `main`.** These branches are write-only via PR merges. The repo enforces this via the pre-commit hook in `.githooks/pre-commit` (one-time install: `git config core.hooksPath .githooks`). If you ever find yourself with HEAD on `codex/integration` and uncommitted edits, branch off first: `git checkout -b codex/local-<task> origin/codex/integration` and redo the work there. This rule exists because direct commits to local `codex/integration` accumulate silently and diverge from the remote — a previous session built up 70 unpushed commits on local integration before being caught (2026-04-28 recovery).
- Create each new task branch from `codex/integration` unless the user explicitly asks for a different base.
- Use a dedicated short-lived branch for each meaningful task or session, not for every single message.
- If local work, cloud Codex, and cloud Claude are running at the same time, each must use a different task branch.
- If multiple task branches need to be tested locally at the same time, use separate git worktrees (one worktree/folder per branch, one dev server per worktree).
- Branch names should use the `codex/` prefix and clearly describe the worker and task, for example:
  - `codex/integration`
  - `codex/local-purchasing-fix`
  - `codex/cloud-codex-assistant-routing`
  - `codex/cloud-claude-docs-purchasing`
- Review task branches against `codex/integration`, not against chat history. Review scope is git-based.
- Merge approved task branches back into `codex/integration`.
- Treat anything going to `main` as a release slice from `codex/integration`: only move reviewed, production-safe changes.

## End-of-Session Reconciliation
Before closing any long-running session, run this five-step check and surface any finding to Greg before saying "done." This exists to catch silent drift early — a previous session accumulated 70 unpushed feature commits on local `codex/integration` because no end-of-session check fired.

1. **Working tree clean?** Run `git status`. Any uncommitted edits → either commit them on a feature branch or stash with a clear, dated label (`git stash push -m "claude: <what> — YYYY-MM-DD"`). Don't leave anonymous WIP.
2. **New stashes this session?** Run `git stash list`. Each new entry should have a self-explanatory label so a future session knows what it is and which branch it belongs on. Drop or document each.
3. **HEAD on a feature branch?** Run `git branch --show-current`. If it's `codex/integration` or `main`, that's a workflow error — branch off first (`git checkout -b codex/local-<task> origin/codex/integration`).
4. **Local in sync with origin?** Run `git fetch origin codex/integration` then both:
   - `git log codex/integration..origin/codex/integration --oneline` — if non-empty, local is behind origin.
   - `git log origin/codex/integration..codex/integration --oneline` — if non-empty, local has unpushed commits that need a feature branch + PR. THIS IS THE 70-COMMIT-DRIFT CHECK.
5. **Worktrees still around?** Run `git worktree list`. Any session-scoped worktrees under `.worktrees/` should be removed (`git worktree remove .worktrees/<name>`).

If any of (1) (2) (4) returns something unexpected, stop and tell Greg before closing — even if the work is "fine." Visibility is the load-bearing thing here.

## Documentation Update Rules
- Always update the canonical doc for the feature or domain you changed.
- Do not update shared summary/index docs such as `docs/README.md` or `docs/overview/todo-index.md` unless one of these is true:
  - the task status materially changed
  - a new workstream or source doc was introduced
  - you are doing release or migration reconciliation
- Prefer release-time reconciliation for shared index docs when multiple branches are active, to reduce merge conflicts.

## Linear Workflow
- Canonical workflow doc: `docs/workflow/linear-handoff.md`.
- Claude mirror: `CLAUDE.md`.
- Linear Installed Agents guidance for Codex Cloud: `docs/workflow/linear-installed-agents-guidance.md`.
- Linear workspace: `polygon-dev`; team: `Polygon`; issue prefix: `POL-`.
- Greg should stay out of routine handoffs. Escalate only for business decisions, ambiguous user-facing behavior, secrets/accounts/payment/admin access, production deploys to `main`, irreversible or high-risk DB ops, or plan-quality blockers.
- Treat Linear status as the baton: `Backlog -> Todo -> In Progress -> In Review -> Verifying -> Done`.
- `assignee` stays Greg for human accountability; `delegate=@Codex` means Codex owns implementation.
- Pick up only issues that are `Todo` with `delegate=@Codex`, unless Greg explicitly asks otherwise.
- Branch from `codex/integration` with `codex/<issue-id>-<short-slug>` and target PRs back to `codex/integration`, never directly to `main`.
- The Linear description is the execution contract. It should include Scope, Acceptance Criteria, Verification Commands, Decision Points, Rollback / Release Notes, and Documentation Requirements.
- If the plan is not executable, do not guess. Comment the gap, leave the issue for Claude plan revision, and avoid surprise implementation.
- Before delivery, perform a lightweight self-review: inspect `git diff` against `codex/integration`, check scope creep, run the plan's verification commands, and report anything not verified.
- Always include a `Deviations from plan` section in the delivery comment, even when it is `None.`
- Delivery comment format: `Delivered on branch/PR: ... Changed: ... Verified: ... Not verified: ... Risks/open questions: ... Deviations from plan: ...`
- Codex's delivery summary is orientation, not evidence; Claude reviews the actual diff and re-runs verification.
- If you see unexpected Linear status, label, delegate, assignee, or description changes, sync before continuing.
- For blockers, add `Workflow: blocked-greg`, keep `delegate=@Codex` (or note the local-CLI executor), and comment the exact Greg question with options.

## Active workflow trial

A workflow trial is running as of 2026-04-29: GPT-5.5 Pro is in the plan-review loop in place of Codex pre-implementation review, to conserve Codex tokens. Codex remains the implementation executor. See [`docs/workflow/2026-04-29-trial-gpt-pro-plan-review.md`](docs/workflow/2026-04-29-trial-gpt-pro-plan-review.md) for roles, the filesystem-grounded preflight checklist Claude must run before producing review packets, and exit criteria. The canonical workflow in [`docs/workflow/linear-handoff.md`](docs/workflow/linear-handoff.md) remains in force for everything not changed by the trial.

## Pre-PR Self-Check (stale-base / broad-deletion tripwire)
Before opening a PR, compare the task branch against `origin/codex/integration`:

```bash
git fetch origin codex/integration
git diff origin/codex/integration --stat
```

If the diff shows broad unrelated deletions, unexpected churn outside the issue scope, or files removed because the branch was based on stale `main`, **stop**. Do not open or push the PR until the branch is rebased or recreated from current `origin/codex/integration`:

```bash
git rebase origin/codex/integration   # or recreate the branch from integration HEAD
```

This is a self-check for the executor (CLI or Cloud), not just for the reviewer. The "Able to merge" badge on GitHub only means no textual conflicts — it does not mean the diff is what you intended. A PR that silently deletes integration-only work would be catastrophic.

## Execution Surfaces
Codex can run against this repo from two surfaces:

- **Local Codex CLI** (default for non-trivial work). The user invokes Codex from a clean checkout of `codex/integration`. Codex reads this `AGENTS.md` automatically as standing context, fetches the Linear issue body via Linear MCP, branches from current `origin/codex/integration`, implements, runs the Pre-PR Self-Check above, pushes, opens the PR against `codex/integration`, and posts the structured delivery comment back on Linear. The Linear issue's `delegate` is typically left null (or set to a non-Codex value) so Codex Cloud does not race the local execution.
- **Codex Cloud** (only for trivial pure-code tasks). Allowed when there is no schema, no RLS, no auth, no admin/payment, no migration, no production data path, and no multi-file risky refactor. Cloud's environment repo map must be configured to default-branch `codex/integration`, otherwise the Pre-PR Self-Check will trip on stale-base divergence.

When unsure which surface to use, default to local CLI.

## Canonical Docs (start here)
- Documentation index: `docs/README.md`
- Tenant module entitlements (feature toggles per org): `docs/operations/tenant-module-entitlements-runbook.md`
- Tenant data isolation (zero-downtime staged plan): `docs/operations/tenant-data-isolation-zero-downtime-runbook.md`
- Consolidated TODO tracker: `docs/overview/todo-index.md`

## Operational Notes
- Prefer Supabase MCP for migrations/SQL/storage/edge functions and doc lookups; avoid ad-hoc SQL scripts when MCP coverage exists.
- Unity ERP's Supabase project is `ttlyfhkrsjjrzxiagzpb` (`https://ttlyfhkrsjjrzxiagzpb.supabase.co`). In Codex, the writable MCP server should be named `supabase_unity` and expose tools like `mcp__supabase_unity__list_migrations`, `mcp__supabase_unity__execute_sql`, and `mcp__supabase_unity__apply_migration`. If a session only shows the old `mcp__supabase_kinetic__` namespace, that is the legacy misnamed Unity connection; verify the project ref with `list_migrations` and use it rather than stalling on the unauthorized default `mcp__supabase__` namespace.
- For MCP setup or troubleshooting, use `docs/technical/mcp-setup.md`.
- Fast validation commands: `npm run lint`, `npm run build`, and `npm run schema` when schema-level changes are involved.
- Non-obvious guardrails: staff attendance payroll rules rely on `time_clock_events`; keep `@react-pdf/renderer` lazily/dynamically imported to avoid build timeouts.

## Migration Tracking (All Features)
- For migration create/apply/reconcile work, use `codex-skills/migration-hygiene/SKILL.md`.
- Keep `docs/operations/migration-status.md` synced to Supabase MCP `list_migrations` after each apply.

## Tenancy Vocabulary
- Use **organization** (aka **tenant**) consistently.

## Tenancy Rules Of Thumb (for new code)
1. If a feature stores **customer/org-specific data**, it must be scoped by `org_id` (eventually `NOT NULL` + FK + RLS).
2. A user must have a row in `public.organization_members` to see tenant-scoped tables under RLS.
3. Supabase nested selects can return `null` for related rows that are blocked by RLS. UI code should treat nested relations as nullable.
4. Prefer enforcing access in server routes via the shared module/org utilities (see `lib/api/module-access.ts` + `lib/api/org-context.ts`) rather than ad-hoc checks.
5. If a task touches multi-tenant behavior, use `codex-skills/unity-erp-tenancy/SKILL.md`.

## Production State Notes
This evolves. Do not assume everything is fully tenant-enforced yet. Always check the runbook and verify RLS/policies on the tables you touch.
If docs and code disagree, verify the current schema and active RLS policies first, then update docs to match verified behavior.
