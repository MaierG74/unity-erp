---
name: unity-erp-handoff-prompts
description: Use when writing a self-contained brief for a fresh Claude or Codex session to pick up unfinished work — including "paste this into a new session" prompts, Codex CLI invocation phrases, or any handoff to another runtime/agent. Enforces local-desktop-only execution, contract shape, and the load-bearing first-line rule that scattered memory files don't reliably enforce.
---

# Writing handoff prompts for fresh Claude/Codex sessions

Use this skill any time the output of the current session will be **pasted into a fresh Claude or Codex window**, into Codex CLI, or otherwise handed to a runtime that doesn't share the current conversation's context. The skill exists because the receiving session has no idea what runtime to target unless the prompt tells it explicitly — and the wrong default leaks work to Cloud, which has known stale-base divergence on Unity ERP.

## Load-bearing rule: declare LOCAL DESKTOP ONLY in the first sentence

The very first line of every handoff prompt must explicitly forbid Cloud execution. No buried workflow notes, no footnotes, no "see AGENTS.md for runtime policy." The first sentence the receiving session reads must answer: where does this run?

Acceptable openings:

```
LOCAL DESKTOP ONLY. Do NOT run this in Cloud or any remote agent — Cloud branches off `main`, not `codex/integration`, and produces stale-base divergence (see project memory for details).
```

```
Run this in Codex CLI on Greg's local machine only. Cloud execution is OFF until the Cloud repo map is fixed to default to `codex/integration`.
```

Both put the runtime constraint before any technical context, before any "Continuing X investigation" framing, before any other instruction. The receiving session should not have to read past the first sentence to know which runtime to use.

**Why this is load-bearing:** This came up 2026-04-28. A Tailwind/Turbopack handoff prompt mentioned local-only at the bottom in a workflow-notes paragraph; the receiving fresh Claude session read past the technical context, hit the workflow-notes paragraph last, and had already started routing to Cloud. Greg caught it and redirected, no damage. Without the load-bearing first-line rule, the receiver follows whatever its environment defaults to.

## Standing rules every handoff must respect

Every handoff brief must inherit the workflow rules already documented in `AGENTS.md` and the canonical Linear handoff doc. Don't restate them in full — point at them. But for the rules with the highest blast radius, restate the constraint inline so the receiving session can't miss them:

1. **Branch from `origin/codex/integration`** — never from `main`, never from local `codex/integration` (which can have unpushed WIP). Use a fresh worktree branch named with the `codex/local-` or `codex/cloud-` prefix per AGENTS.md.

2. **Pre-PR Self-Check before opening the PR** — `git diff origin/codex/integration --stat`. Stop and surface if the diff shows broad unrelated deletions or files outside the expected surface area. (The Cloud-stale-base bug surfaces here.)

3. **Wage-table safety** — never insert synthetic rows into `staff_piecework_earnings`, `staff_piecework_earning_entries`, `billoflabour` rows with `pay_type='piece'`, or any other wage-flowing table without proven cleanup in the same response. Greg's payroll runs weekly on the live DB; synthetic rows leak into paychecks if the cleanup misses. Default to pure-helper unit tests over live-DB fixtures wherever possible.

4. **Migration discipline** — any DDL change requires all four artifacts: file at `supabase/migrations/<timestamp>_<name>.sql` + `mcp__supabase__apply_migration` with matching name + `mcp__supabase__list_migrations` reconciliation + `docs/operations/migration-status.md` update.

5. **View drift check** — when adding columns to a base table, every view that reads from it must be extended in the same PR. PostgreSQL `CREATE OR REPLACE VIEW` doesn't auto-pick up new columns; this is a recurring bug class (POL-60→POL-62 hit it).

6. **Browser smoke is reviewer responsibility when executor can't** — if the executor reports "port collision skipped browser smoke" or similar, the reviewer (Claude during PR review) must run the smoke before approving. Never punt to Greg.

## Contract shape for new-task handoffs

If the brief is a new task (not a continuation of a prior failed attempt), it must include:

- **Scope** — in-scope and out-of-scope, explicit
- **Acceptance Criteria** — observable behavior, not just "tests pass"
- **Verification Commands** — exact lint / type-check / test / build commands the executor must run, plus any browser-smoke routes
- **Decision Points** — anything ambiguous in the spec, with a recommendation or "stop and surface to Greg"
- **Rollback / Release Notes** — what reverting looks like
- **Documentation Requirements** — which doc file (if any) to update
- **Branch name** — `codex/local-<descriptive-slug>`
- **Base branch** — `codex/integration`

For continuation handoffs (e.g. picking up an investigation that hit a guardrail), drop the formal contract and replace with:

- A clear "Continuing X" framing
- The technical context the new session needs to act cold (versions, file paths, error messages, what's been ruled out)
- The proposed plan with explicit decision points
- The same hard guardrails (DO NOT touch X, DO NOT do Y)

## What NOT to put in handoff briefs

- **Conversation history.** The receiving session doesn't need the back-and-forth, just the final state.
- **Unverified claims.** If you reference a flag name, version number, or API signature, the brief should say "verify against current docs before applying" if you didn't verify yourself in the current session.
- **Ambiguous "see X for details" pointers** that bury the load-bearing constraints. Cloud-routing, wage-data, and migration-discipline rules belong inline (or at least flagged inline with a one-line summary of the rule).
- **Linear ticket numbers as the sole context.** If a ticket number is referenced, either the brief includes the issue body or instructs the executor to read it via `mcp__linear__get_issue` before starting.

## Self-check before delivering a handoff

Before pasting a handoff prompt back to Greg, verify:

1. Does the very first sentence answer "where does this run?"
2. Does the brief include all hard guardrails relevant to its surface (wage-table safety if anywhere near payroll, migration discipline if any DDL, view-drift check if columns added)?
3. If it's a new task: does it have Scope + AC + Verification Commands + Decision Points?
4. If it's a continuation: does it explicitly enumerate what's been ruled out so the receiver doesn't repeat dead ends?
5. Are version numbers and flag names verified or marked "verify against current docs"?
6. Does the brief contain a clear "stop and surface" rule for any ambiguity the executor might hit?

If any answer is no, fix the brief before sending.

## Related references

- `AGENTS.md` at the repo root — Codex CLI's always-loaded workflow doc; the canonical source for branch naming, executor surfaces, and Linear baton state machine.
- `docs/workflow/linear-handoff.md` — human-readable canonical Linear workflow doc.
- Project memory (`/Users/gregorymaier/.claude/projects/-Users-gregorymaier-developer-unity-erp/memory/`) — captures session-discovered behavioral rules; this skill consolidates the handoff-prompt-shape rules into structural enforcement.
