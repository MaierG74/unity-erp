# CLAUDE.md

## Git Workflow

- `main` is release-only. Keep it clean — no direct development on `main`.
- `codex/integration` is the shared working branch for approved but not-yet-released work.
- Every meaningful task/session gets its own short-lived branch. Branch off `codex/integration`, do the work, then merge back into `codex/integration`.
- Do not create a new branch for every single follow-up message on the same task.
- If two task branches need to be tested locally at the same time, use separate git worktrees so each branch has its own folder and dev server.
- Use the `codex/` prefix with a clear worker and task name:
  - `codex/integration`
  - `codex/local-purchasing-fix`
  - `codex/cloud-codex-assistant-routing`
  - `codex/cloud-claude-docs-purchasing`
- When multiple environments are working at the same time (local, cloud Codex, cloud Claude), each must use a separate branch.
- Review scope is git-based, not chat-based:
  - `/codex:review` reviews the current uncommitted changes
  - `/codex:review --base codex/integration` reviews the current task branch against the shared working branch
- Before merging to `main`, treat it as a release slice from `codex/integration` and review for production safety.
- Always update the canonical doc for the feature or domain you changed.
- Do **not** update shared summary/index docs (`docs/README.md`, `docs/overview/todo-index.md`) on every task. Only update them when status materially changes, a new workstream is introduced, or during release/reconciliation work.

## End-of-Session Reconciliation

Before closing any long session, run the five-step check documented in [AGENTS.md > End-of-Session Reconciliation](AGENTS.md). The TL;DR: `git status`, `git stash list`, `git branch --show-current`, `git log codex/integration..origin/codex/integration --oneline` AND the reverse, `git worktree list`. Surface any non-empty unexpected result before saying "done." This exists because a prior session built up 70 unpushed commits on local `codex/integration` without anyone noticing — the end-of-session check is the structural fix.

## Multi-Tenancy

- Any new table holding org-specific data **must** include an `org_id` column with org-scoped RLS.
- Nested relations in Supabase queries can be `null` due to RLS — UI code must never assume embedded objects exist.
- For tenancy migrations, RLS work, or debugging, use the `unity-erp-tenancy` skill.

## MCP Tools

Three MCP servers are available. For setup/troubleshooting, see `docs/technical/mcp-setup.md`.

- **Supabase MCP** - Use for database migrations (`apply_migration`), running SQL queries (`execute_sql`), storage operations, edge functions, and documentation lookups. Prefer this over raw SQL in scripts.
- **Claude in Chrome** - Browser automation for the user's Chrome. Use `tabs_context_mcp` first, then navigate/interact. Uses an isolated profile — log in with the test account each session for authenticated pages.
- **Linear MCP** - Canonical task tracker. Use for reading, planning, delegating, reviewing, and closing Linear issues. See "Task Tracking" and "Linear Workflow" below.

## Development Commands

- `npm run schema` - Get database schema via `tsx scripts/get-schema.ts`
- `npm run seed` - Seed test data via `tsx scripts/seed-test-data.ts`
- For database migrations and RLS work, use the `unity-erp-tenancy` skill.

## Task Tracking

Linear is the canonical tracker. Workspace: **polygon-dev**, team: **Polygon** (issue prefix `POL-`).

Issues are organised by **area-of-focus projects**, not one flat backlog:

- **Manufacturing** — production pipeline (BOL, Work Pool, Job Cards, scheduler, exceptions)
- **Cutlist** — optimiser, cutting plan, material assignment, cut-diagram PDF
- **Purchasing** — purchase orders, receipts, supplier returns, allocations
- **Payroll & Timekeeping** — clock-ins, OT policies, payroll-review UI
- **Auth & Tenancy** — RLS, user lifecycle, permissions, module entitlements, activity logging
- **AI Assistant** — in-app NLQ + RAG (distinct from OpenClaw)
- **Platform & UX** — navbar/sidebar, dev tooling, shared utilities
- **OpenClaw Agents** — standalone autonomous-agents product
- **Furniture Configurator** — sellable parametric module

Rules of thumb:

- Always file against an existing project; don't drop loose issues into the team root.
- Use sub-issues for tightly-coupled phases of one feature (e.g. POL-26 Work Pool has 9 phase sub-issues).
- Use Milestones inside a project when grouping otherwise-independent issues under a phase heading.
- The historical `docs/overview/todo-index.md` is preserved as a reference but is no longer the source of truth.

## Linear Workflow

Full workflow: [docs/workflow/linear-handoff.md](docs/workflow/linear-handoff.md).
Codex always-loaded mirror: [AGENTS.md](AGENTS.md). Codex Cloud condensed
guidance: [docs/workflow/linear-installed-agents-guidance.md](docs/workflow/linear-installed-agents-guidance.md).

- Greg should stay out of routine handoffs; escalate only for business decisions,
  ambiguous user-facing behavior, secrets/accounts/payment/admin access,
  production deploys to `main`, high-risk DB ops, or plan-quality blockers.
- Claude writes contract-shaped Linear plans: Scope, Acceptance Criteria,
  Verification Commands, Decision Points, Rollback / Release Notes, and Docs.
- Use Linear status as the baton: Backlog -> Todo -> In Progress -> In Review
  -> Verifying -> Done.
- `assignee` stays Greg; `delegate=@Codex` means Codex owns execution.
- Review the actual diff against `codex/integration`; Codex's summary is
  orientation, not evidence.
- Re-run the plan's verification commands before approving.
- Do not approve without Greg when guardrails fire: migrations/RLS/schema, auth,
  payment/admin endpoints, major scope drift, blocked-Greg history, or
  non-trivial unverified/deviated work.
- If approved and no guardrail applies, Claude may merge the PR into
  `codex/integration` and comment the merge SHA.

## Documentation

- **Index**: [docs/README.md](docs/README.md) is the reference index for all documentation — consult before working on unfamiliar areas.
- **Plans / specs**: per-feature docs under `docs/plans/`, `docs/projects/`, `docs/domains/` are the canonical technical references; Linear issues link out to them rather than duplicating the content.

## Architecture

- For staff/attendance pay logic and file storage paths, use the `unity-erp-business-rules` skill.
- Piecework completion, earnings, and reopen behavior are documented in [docs/domains/payroll/piecework.md](docs/domains/payroll/piecework.md).
- Dark theme is default; font is Inter
- `@react-pdf/renderer` must be lazy/dynamically imported (causes build timeouts)

## Frontend Stack (IMPORTANT — post-training-data versions)

- **Tailwind CSS 4.2** — CSS-first config in `globals.css`, NO `tailwind.config.ts`. Use the `tailwind-v4` skill for any styling work — v4 has breaking syntax changes from v3 that training data gets wrong.
- **shadcn 4.0** — Package renamed from `shadcn-ui`. CLI: `pnpm dlx shadcn@latest add <component>`.
- **tw-animate-css** — Replaces `tailwindcss-animate`. Imported as CSS, not a plugin.
- Key gotchas: `shadow`→`shadow-sm`, `rounded`→`rounded-sm`, `ring`→`ring-3`, no `bg-opacity-*` (use `/50` modifier), `bg-(--var)` not `bg-[--var]`.

## Verification

IMPORTANT: Never consider a task complete without verifying it works.

- **UI changes**: Use Claude in Chrome (`mcp__claude-in-chrome__read_page`, `mcp__claude-in-chrome__navigate`) to confirm the change renders correctly and has no runtime errors. Share a screenshot as proof.
- **Database changes**: Run `mcp__supabase__get_advisors` (security) to check for missing RLS. Verify with a test query.
- **All changes**: Run `npm run lint` before finishing. Run `npx tsc --noEmit` when the touched area supports it; if existing unrelated TypeScript failures block a clean run, report that clearly instead of treating the whole task as unverified.
- If verification isn't possible (e.g. auth-gated flow, external integration), state what you can't verify and why.

## Code Quality & Batch Processing

- **`/simplify`** — Run automatically before finalising any PR or at the end of any session that modifies more than 3 files. No need to ask — just run it as a final step.
- **`/batch`** — If a change would touch more than 10 files with a similar pattern (e.g. adding entity-awareness across modules, updating RLS policies, applying a type pattern across features), stop and flag it as a `/batch` candidate, explain scope, and wait for confirmation before proceeding.
