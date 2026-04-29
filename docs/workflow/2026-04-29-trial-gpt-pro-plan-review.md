# Trial: GPT-5.5 Pro in plan-review loop

**Status:** Trial, started 2026-04-29.
**Goal:** Reduce Codex token burn during planning while preserving plan quality.

## Why this trial exists

The canonical workflow ([`docs/workflow/linear-handoff.md`](linear-handoff.md)) routes plan review through Codex Desktop. POL-71 used this pattern: Claude wrote a spec, Codex reviewed twice (round 1: 5 BLOCKERs / 7 MAJORs / 3 MINORs; round 2: 2 BLOCKERs / 3 MAJORs / 1 MINOR), Claude reworked. Both rounds caught real bugs. But Codex tokens are constrained, and plan-review passes are 10–25% of one phase's implementation cost.

This trial replaces the Codex plan-review step with **GPT-5.5 Pro** (web-only, accessed via the ChatGPT web interface). GPT Pro can read committed GitHub files but has no filesystem access, no MCP tools, and cannot run validation. To compensate, Claude does a **filesystem-grounded preflight probe** before producing the review packet, baking the findings into the spec.

Codex stays in the loop for **implementation only**.

## Roles in the trial

| Step | Owner | Tools / Access |
|---|---|---|
| Brainstorm + decisions | Claude + Greg | Claude tools |
| Filesystem-grounded preflight probe | **Claude** (was Codex) | Bash, Read, Supabase MCP, Explore |
| Spec write to `docs/plans/<date>-<topic>.md` | Claude | Repo write |
| Review packet for GPT Pro | Claude | Markdown |
| Plan-quality review | **GPT Pro** (was Codex) | GitHub repo read only |
| Spec rework based on feedback | Claude | Repo write |
| Linear filing | Claude | Linear MCP |
| Codex Desktop pickup prompt | Claude | `unity-erp-handoff-prompts` skill |
| Implementation | Codex Desktop | Local filesystem + Supabase MCP |
| Code review (post-PR) | Claude | Bash, Read, Supabase MCP, preview MCP |
| Merge | Claude (auto-merge if no migration) or Greg sign-off (migration) | gh CLI |

## What GPT Pro can and cannot see

GPT Pro reads only **committed files in the GitHub repo** (`MaierG74/unity-erp`). It cannot see:
- Uncommitted working-tree changes
- Stashes
- Local-only branches (a branch must be pushed to be visible)
- Codex Desktop's session state
- Claude Code's tool outputs

Greg pastes the review packet into GPT Pro's web interface. GPT Pro returns findings; Greg pastes findings back to Claude.

## Claude's preflight probe checklist

For every spec, run filesystem-grounded checks **before** producing the review packet so GPT Pro reviews a spec that already incorporates real-world findings:

1. Read every migration touching the feature's domain (`supabase/migrations/*<keyword>*.sql`).
2. `grep -rn` for all consumers of tables/RPCs/columns the spec touches.
3. `mcp__supabase__execute_sql` against the actual schema (column types, constraints, function signatures, view definitions, trigger bodies).
4. `mcp__supabase__get_advisors --type security` — record current findings.
5. Find views referencing affected tables (the recurring view-drift bug class — `CREATE OR REPLACE VIEW` does NOT auto-pick up new columns).
6. Check function definitions for `security_definer`, `search_path`, grants — anything the spec proposes to mutate.
7. Read the canonical doc for the feature area (`docs/features/...`, `docs/domains/...`).
8. Confirm RLS posture if tenant-scoped (does `is_org_member` or composite FK already cover it?).
9. Verify standing safety rails apply: `LOCAL DESKTOP ONLY` for Codex execution, `delegate=null` on Linear issues, wage-table safety, migration discipline.

Bake findings into the spec. The spec should be filesystem-validated **before** GPT Pro sees it.

## Review packet shape

When you produce a spec for GPT Pro, format it as a packet Greg can paste into the ChatGPT web interface. Required sections:

1. Task summary
2. Current repo context inspected (file paths + line numbers — GPT Pro can read those)
3. Relevant branches and assumed base branch
4. Files likely to change
5. Files / docs consulted
6. Proposed implementation steps
7. Tenant / RLS considerations, if applicable
8. Migration / schema considerations, if applicable
9. Testing and validation plan
10. Risks and edge cases
11. Questions or uncertainties
12. Specific things you want GPT Pro to review

The packet must be **self-contained** because GPT Pro can only see committed files. Include enough reasoning context for GPT Pro to evaluate the design without access to your tool outputs.

## Standing rules unchanged by this trial

- `LOCAL DESKTOP ONLY` for all Codex execution. Codex Cloud's Linear integration was revoked 2026-04-28 after a Cloud auto-pickup incident; it stays off indefinitely.
- `delegate=null` on Linear issues to prevent any future Cloud auto-pickup if the integration is ever re-enabled.
- Sub-issue progression: only the active phase sits in `Todo`; predecessors stay in `Backlog` until their dependency lands.
- Auto-merge OK for non-migration / non-RLS / non-schema / non-auth phases when verification is clean.
- Greg sign-off required for: migrations, RLS changes, schema changes, auth/payment/admin endpoints, scope drift >50% files, `Workflow: blocked-greg` history, non-trivial unverified or deviated work.
- Browser smoke is reviewer responsibility when executor can't (port collisions, etc.).
- Wage-table safety: never insert synthetic rows into wage-flowing tables without proven cleanup in the same response.
- Migration discipline: file at `supabase/migrations/<timestamp>_<name>.sql` + `mcp__supabase__apply_migration` + `mcp__supabase__list_migrations` reconciliation + `docs/operations/migration-status.md` update.
- View drift check: when adding columns to a base table, every view reading from it must be extended in the same PR.

## Trial exit criteria

After 3–5 specs run through this workflow, evaluate:

- Did GPT Pro catch BLOCKERs that Claude's preflight missed?
- How much Codex token spend was avoided vs the canonical pattern?
- Did the extra Claude time per spec offset the savings, or was it net positive?
- Any process friction (paste roundtrips, web-interface latency)?

**If GPT Pro adds signal:** promote the pattern, update [`docs/workflow/linear-handoff.md`](linear-handoff.md) accordingly, delete this trial doc.

**If GPT Pro mostly confirms what Claude's preflight already found:** revert to canonical workflow but keep the preflight checklist as a permanent improvement to Claude's discipline.

## Related

- Canonical workflow: [`docs/workflow/linear-handoff.md`](linear-handoff.md)
- Codex Cloud guidance (currently revoked): [`docs/workflow/linear-installed-agents-guidance.md`](linear-installed-agents-guidance.md)
- Always-loaded agent docs: [`AGENTS.md`](../../AGENTS.md), [`CLAUDE.md`](../../CLAUDE.md)
