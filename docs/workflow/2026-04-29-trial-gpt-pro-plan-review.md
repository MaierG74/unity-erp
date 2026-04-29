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

## First-spec data point: POL-83 cutlist material swap & surcharge (2026-04-29)

The first spec run through this trial. Results across 4 review rounds:

| Round | BLOCKERs | MAJORs | MINORs | Outcome |
|---|---|---|---|---|
| 1 | 3 | 8 | 2 | All integrated → v2 |
| 2 | 3 | 6 | 1 | All integrated → v3 |
| 3 | 1 | 1 | 1 | All integrated → v4; "no broader architecture issues remain" sign-off signal |
| 4 | 0 | 0 | 2 | All integrated → v5; explicit "Ship the spec" recommendation |
| **Total** | **7** | **15** | **6** | Sign-off after 4 rounds |

### What GPT Pro caught that Claude's preflight missed

These were real, implementation-blocking issues that the filesystem-grounded preflight did not surface:

- **`quote_items.cutlist_snapshot` column-name collision** with the existing `QuoteItem.cutlist_snapshot` TS property mapped to the `quote_item_cutlists(*)` side-table for layout data. Claude's preflight checked schema state via `information_schema.columns` and saw no column with that name — but missed that the TS property layer was already using the name for a different concept. Adding the column would have shadowed via Supabase's `select('*')` mapping.
- **Backer-default persistence gap.** Phase F's redirect from `orders.material_assignments` to per-line columns would have broken cutting-plan generation for `-backer` orders because the new schema had no `cutlist_primary_backer_material_id` column. Caught in round 1.
- **Surcharge drift on generic PATCH route.** The `app/api/order-details/[detailId]/route.ts` PATCH accepts `quantity` and `surcharge_total` independently. Without a DB-side trigger, percentage cutlist surcharges drift silently when qty alone is edited. Caught in round 1; led to introducing Phase A2 with a BEFORE INSERT/UPDATE trigger.
- **`UPDATE OF` trigger column-list completeness.** Claude's first-pass trigger only listed input columns; GPT Pro caught that direct writes to `surcharge_total` itself wouldn't fire the recompute and could persist as-is. Caught in round 2.
- **Decision-Summary-vs-§7 contradiction.** When Claude added Phase A2 in v2, the high-level Decision Summary still said "no new trigger work." Codex would have followed the summary. Caught in round 2.
- **PostgreSQL `''` vs `NUMERIC` type-boundary.** The "empty-string fixture" parity test was specified to run through both TS and SQL helpers; SQL's `NUMERIC` parameter type would reject `''` before COALESCE could run. Caught in round 3; led to splitting parity tests into TS-side and route-side layers.

### What GPT Pro confirmed that Claude already had

- The phasing structure (A1, A2, B, C, D, E, F mirroring POL-71) was solid
- The three-layer architecture (operational + auto-pair memory + commercial surcharge) survived 4 rounds unchanged
- The downstream-state probe extension matched POL-71's pattern correctly

### Process notes

- 4 review rounds is more than expected. Round 3 already signaled "no broader architecture issues remain"; Greg elected to run round 4 as a final check, which surfaced 2 small MINORs that would have been clean to fix post-implementation but were cheap to fix pre-implementation. Net positive.
- Each round took ~10–15 minutes for Greg (paste packet → wait → paste reply). Roughly 1 hour total over 4 rounds.
- The packets themselves grew shorter each round (round 1: 212 lines, round 4: 51 lines) as the spec stabilised — packet size is a reasonable proxy for how much surface remains to verify.
- GPT Pro's responses were always severity-grouped per the packet template; no formatting friction.

### Tentative trial verdict (after spec 1)

**Net positive on this spec.** GPT Pro caught at least 6 issues (3 BLOCKERs + 3 MAJORs in rounds 1–2) that would have hit Codex during implementation, plus several that would have created subtle correctness bugs in production (surcharge drift, view shadowing). Claude's preflight surfaced the schema/RLS/migration state correctly but did not catch:
- Cross-layer name collisions (TS property ↔ DB column)
- Trigger correctness in the face of the existing PATCH route's behaviour
- Implementation-architecture cohesion (Decision Summary drifting from Phase A2 introduction)

These are the gaps GPT Pro is filling. **Continue trial for at least 2 more specs before final evaluation.** Specifically watch whether the gaps repeat across different problem domains — if yes, the GPT Pro layer is structural value; if no, the gaps may have been spec-specific and worth one improved preflight checklist instead.

### Action items from this spec

- **Improve preflight checklist:** when adding columns to a table, grep for the column name as a literal across `lib/db/`, `app/api/`, and TS interfaces, not just `information_schema`. The collision Claude missed in round 1 would have been caught by `grep -rn "cutlist_snapshot" lib/db/ app/api/`.
- **Improve preflight checklist:** when a generic PATCH route writes a derived field, check whether a DB-side trigger is needed for drift safety. Not just "is there a trigger today" but "is the field multiplicatively dependent on other columns the route can mutate."
- **Improve preflight checklist:** when extending a feature spec (POL-83 extending POL-71), inherit POL-71's preflight findings forward and check whether the extension introduces any new column collisions or trigger ordering concerns.

## Related

- Canonical workflow: [`docs/workflow/linear-handoff.md`](linear-handoff.md)
- Codex Cloud guidance (currently revoked): [`docs/workflow/linear-installed-agents-guidance.md`](linear-installed-agents-guidance.md)
- Always-loaded agent docs: [`AGENTS.md`](../../AGENTS.md), [`CLAUDE.md`](../../CLAUDE.md)
