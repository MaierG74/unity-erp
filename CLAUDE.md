# CLAUDE.md

## Multi-Tenancy

- Any new table holding org-specific data **must** include an `org_id` column with org-scoped RLS.
- Nested relations in Supabase queries can be `null` due to RLS — UI code must never assume embedded objects exist.
- For tenancy migrations, RLS work, or debugging, use the `unity-erp-tenancy` skill.

## MCP Tools

Two MCP servers are available. For setup/troubleshooting, see `docs/technical/mcp-setup.md`.

- **Supabase MCP** - Use for database migrations (`apply_migration`), running SQL queries (`execute_sql`), storage operations, edge functions, and documentation lookups. Prefer this over raw SQL in scripts.
- **Claude in Chrome** - Browser automation for the user's Chrome. Use `tabs_context_mcp` first, then navigate/interact. Cannot access authenticated pages (isolated profile).

## Development Commands

- `npm run schema` - Get database schema via `tsx scripts/get-schema.ts`
- `npm run seed` - Seed test data via `tsx scripts/seed-test-data.ts`
- For database migrations, use the `migration-hygiene` skill.

## Documentation

- **TODO Overview**: Consult [docs/overview/todo-index.md](docs/overview/todo-index.md) for outstanding work.
- **Index**: [docs/README.md](docs/README.md) is the reference index for all documentation — consult before working on unfamiliar areas.

## Architecture

- For staff/attendance pay logic and file storage paths, use the `unity-erp-business-rules` skill.
- Dark theme is default; font is Inter
- `@react-pdf/renderer` must be lazy/dynamically imported (causes build timeouts)

## Verification

IMPORTANT: Never consider a task complete without verifying it works.

- **UI changes**: Use preview tools (`preview_snapshot`, `preview_screenshot`, `preview_console_logs`) to confirm the change renders correctly and has no runtime errors. Share the screenshot as proof.
- **Database changes**: Run `mcp__supabase__get_advisors` (security) to check for missing RLS. Verify with a test query.
- **All changes**: Run `npx tsc --noEmit` and `npm run lint` before finishing.
- If verification isn't possible (e.g. auth-gated flow, external integration), state what you can't verify and why.

## Code Quality & Batch Processing

- **`/simplify`** — Run automatically before finalising any PR or at the end of any session that modifies more than 3 files. No need to ask — just run it as a final step.
- **`/batch`** — If a change would touch more than 10 files with a similar pattern (e.g. adding entity-awareness across modules, updating RLS policies, applying a type pattern across features), stop and flag it as a `/batch` candidate, explain scope, and wait for confirmation before proceeding.
