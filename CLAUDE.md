# CLAUDE.md

## Git Workflow

- `main` is release-only. Keep it clean — no direct development on `main`.
- Every task gets its own short-lived branch. Branch off `main`, do the work, merge back.
- Use the `codex/` prefix with a clear worker and task name:
  - `codex/local-purchasing-fix`
  - `codex/cloud-codex-assistant-routing`
  - `codex/cloud-claude-docs-purchasing`
- When multiple environments are working at the same time (local, cloud Codex, cloud Claude), each must use a separate branch.
- Before merging to `main`, treat it as a release slice — review for production safety.
- Always update the canonical doc for the feature or domain you changed.
- Do **not** update shared summary/index docs (`docs/README.md`, `docs/overview/todo-index.md`) on every task. Only update them when status materially changes, a new workstream is introduced, or during release/reconciliation work.

## Multi-Tenancy

- Any new table holding org-specific data **must** include an `org_id` column with org-scoped RLS.
- Nested relations in Supabase queries can be `null` due to RLS — UI code must never assume embedded objects exist.
- For tenancy migrations, RLS work, or debugging, use the `unity-erp-tenancy` skill.

## MCP Tools

Two MCP servers are available. For setup/troubleshooting, see `docs/technical/mcp-setup.md`.

- **Supabase MCP** - Use for database migrations (`apply_migration`), running SQL queries (`execute_sql`), storage operations, edge functions, and documentation lookups. Prefer this over raw SQL in scripts.
- **Claude in Chrome** - Browser automation for the user's Chrome. Use `tabs_context_mcp` first, then navigate/interact. Uses an isolated profile — log in with the test account each session for authenticated pages.

## Development Commands

- `npm run schema` - Get database schema via `tsx scripts/get-schema.ts`
- `npm run seed` - Seed test data via `tsx scripts/seed-test-data.ts`
- For database migrations and RLS work, use the `unity-erp-tenancy` skill.

## Documentation

- **TODO Overview**: Consult [docs/overview/todo-index.md](docs/overview/todo-index.md) for outstanding work.
- **Index**: [docs/README.md](docs/README.md) is the reference index for all documentation — consult before working on unfamiliar areas.

## Architecture

- For staff/attendance pay logic and file storage paths, use the `unity-erp-business-rules` skill.
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
