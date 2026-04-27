# Linear Handoff Workflow

This document is the canonical workflow for Unity ERP work that moves through
Linear between Greg, Claude, and Codex. Keep the short always-loaded guidance in
[CLAUDE.md](../../CLAUDE.md), [AGENTS.md](../../AGENTS.md), and
[linear-installed-agents-guidance.md](linear-installed-agents-guidance.md)
aligned with this source of truth.

## Most Important Rules

1. Greg should be out of the loop by default. Claude plans and reviews; Codex
   implements and self-reviews; Greg is pulled in only for defined guardrails.
2. Codex's summary is orientation, not evidence. Claude reviews the actual diff
   against `codex/integration`.
3. Claude independently re-runs the verification commands from the plan before
   approving.
4. Linear status is the baton. Do not rely on chat context to know who owns the
   next step.
5. The Linear issue description is the canonical execution contract unless it
   explicitly links to a larger repo plan.
6. Claude must not approve across guardrails such as migration/RLS/schema
   changes, auth/admin/payment surfaces, major scope drift, or non-trivial
   unverified work.

## Goal

The workflow exists so that any capable agent can pick up a Unity ERP issue cold
from Linear and understand:

- what is planned
- who owns the next step
- where the implementation branch lives
- what evidence was gathered
- what remains blocked, risky, or unverified

Greg is the accountable human, but he should not be a routine handoff step.
Claude and Codex should carry work as far as possible without involving him.

## Roles

### Greg

Greg is the default assignee for human accountability and business ownership.
Pull Greg in only for:

- business or product decisions that cannot be inferred from docs or existing UI
- ambiguous customer-facing behavior
- secrets, accounts, payment, billing, or privileged admin access
- production deploys to `main`
- irreversible or high-risk production database operations
- plan-quality issues that make safe execution impossible
- any explicit guardrail in the issue plan

### Claude

Claude owns planning and review.

Claude writes the execution contract into Linear, delegates executable work to
Codex, reviews the actual branch diff, re-runs verification, and may merge
approved task branches into `codex/integration` when guardrails allow it.

Claude is implicit in the workflow; do not create `Agent: Claude` labels.

### Codex

Codex owns implementation and delivery evidence.

Codex picks up issues delegated to Codex, creates a task branch from
`codex/integration`, implements within the plan, performs a lightweight
self-review, opens or updates the PR, and moves the issue to review with a
structured delivery comment.

For Codex's always-loaded repo guidance, see [AGENTS.md](../../AGENTS.md). For
Codex Cloud's condensed runtime guidance, see
[linear-installed-agents-guidance.md](linear-installed-agents-guidance.md).

## Linear Field Semantics

Use the fields this way:

| Field | Meaning |
| --- | --- |
| `assignee` | Greg, for human accountability |
| `delegate` | `@Codex` while Codex owns execution; null when Greg and Claude own planning/review |
| `status` | work state and next-owner baton |
| `Workflow:` labels | meta-state such as blocked, spike, or verification-needed |
| project | area of focus, such as Manufacturing, Purchasing, or Auth & Tenancy |

Do not use old `Agent: Claude` or `Agent: Codex` labels. Codex ownership is
tracked by `delegate=@Codex`; Claude ownership is implicit when no Codex
delegate is present.

## Status Flow

| Status | Delegate | Meaning | Trigger to next |
| --- | --- | --- | --- |
| Backlog | null | Idea exists but is not planned | Claude commits to planning |
| Todo | null | Claude planning or plan needs revision | Claude writes plan and delegates to Codex |
| Todo | `@Codex` | Planned and ready for Codex | Codex picks up and opens branch/PR |
| In Progress | `@Codex` | Codex implementing | Codex delivers PR and evidence |
| In Review | null or `@Codex` | Claude reviewing actual diff | Claude approves or requests changes |
| Verifying | null | Merged to `codex/integration`, waiting for production/staging verification | release verification completes |
| Done | null | Merged to `main` release slice or explicitly accepted | no next step |

Linear automations may set `In Progress` when a PR opens, `In Review` when
review activity starts, `Verifying` when a branch merges into `codex/integration`,
and `Done` when the release slice merges to `main`. The workflow must still make
sense when those automations are not available.

### Rejection Paths

Use these paths when review fails:

- `In Review` -> `In Progress`: small implementation fixes; plan remains valid.
- `In Review` -> `Todo`: plan needs revision, acceptance criteria are wrong, or
  Codex found a plan-quality issue.

Always leave a comment explaining the state change and what must happen next.

## Branch And PR Conventions

- Branch from `codex/integration`.
- Use branch format `codex/<issue-id>-<short-slug>`, for example
  `codex/pol-31-work-pool-schema`.
- Target PRs at `codex/integration`, never directly at `main`.
- PR descriptions should mirror the Codex delivery comment and include
  `Closes POL-N`.
- `main` is release-only. Release slices from `codex/integration` to `main` are
  Greg's gate unless he explicitly changes that policy.
- Review scope is git-based: compare the task branch to `codex/integration`.

## Plan Template

Every planned-execution issue must have a contract-shaped description with these
sections:

1. **Scope** - files, modules, and behavior in scope, plus explicit
   out-of-bounds areas.
2. **Acceptance Criteria** - observable, testable outcomes.
3. **Verification Commands** - exact commands and manual checks Codex must run.
4. **Decision Points** - conditions where Codex must stop and ask Greg instead
   of deciding alone.
5. **Rollback / Release Notes** - how to back out and what is safe or unsafe to
   ship, especially for database work.
6. **Documentation Requirements** - canonical docs that must be updated when
   behavior changes.

Plans should be executable, not grand prose. Codex should not need chat history
to understand the next move.

For plans over roughly 800-1000 words, plans with diagrams, or plans with phased
rollout sequencing, keep the Linear description concise and link to a repo plan
under `docs/plans/`. The Linear issue should still contain the summary,
acceptance criteria, verification commands, and stop/ask conditions.

## Codex Pickup

When Codex picks up an issue:

1. Confirm the issue is `Todo` and `delegate=@Codex`.
2. Read the issue description and any linked repo plan.
3. Create the task branch from `codex/integration`.
4. Leave or prepare the pickup comment.
5. Work only within the plan scope.

Pickup comment template:

> Picking up POL-N on branch `codex/pol-n-slug` from `codex/integration`. Scope
> understood: ... Planned verification: ...

If the plan is not executable, Codex should not guess. Move or leave the issue in
`Todo`, flag the plan problem, and ask for plan revision.

## Codex Self-Review

Before moving work to review, Codex performs a lightweight pre-flight:

- inspect `git diff` against `codex/integration`
- check touched files for accidental scope creep
- run all verification commands listed in the plan
- note anything not verified and why
- always include a `Deviations from plan` section, even when the answer is
  `None.`

This step is not meant to become bureaucracy. It is meant to give Claude a clean
review target and make plan drift visible.

Delivery comment template:

> Delivered on branch/PR: ... Changed: ... Verified: ... Not verified: ...
> Risks/open questions: ... Deviations from plan: ...

## Claude Review

Claude reviews the actual diff against `codex/integration`.

Locked review rules:

1. Codex's summary is orientation, not evidence.
2. Claude independently re-runs the plan's verification commands.
3. If Codex's `Deviations from plan` section is non-empty, Claude assesses plan
   quality before reviewing the diff on its merits.
4. Plan-quality problems bounce to `Todo` for plan rewrite.
5. Small implementation problems bounce to `In Progress`.

Claude review/merge comment template:

> Reviewed diff against `codex/integration`. Verification re-run by Claude: ...
> Findings: ... Verdict: approved. Merged in SHA: ...

## Claude Approval Guardrails

Claude does not approve the PR without escalating to Greg when any of these are
true:

- diff scope exceeds the plan scope by more than roughly 50 percent of files
- migration, RLS, or schema changes are present
- auth, payment, or admin endpoints are touched
- Codex marked `Workflow: blocked-greg` at any point during the work
- Codex's `Not verified` section is non-trivial
- Codex's `Deviations from plan` section is non-trivial
- Codex's self-review flagged plan-quality issues

Escalation does not always mean the work stops forever. It means Greg must make
the judgment call before Claude approves or merges.

## Spikes

Use `Workflow: spike` for exploratory work.

Claude writes a spike brief with:

- the question to answer
- allowed files or systems to inspect
- whether throwaway code is allowed
- expected output

Trivial spikes may close with findings as a Linear comment. Non-trivial spikes
should write findings to `docs/spikes/POL-N-spike.md`, close the spike, and
create a linked follow-up `Workflow: planned-execution` issue via `relatedTo`.

Spikes do not produce production code. Throwaway code stays on the spike branch
unless a follow-up planned-execution issue explicitly adopts it.

## Blockers

When Codex hits a Greg-only decision:

- keep status `In Progress` if Codex is still actively working around it
- move status to `Todo` if Codex has moved on and cannot proceed
- keep `delegate=@Codex` so Codex resumes when unblocked
- keep `assignee=Greg`
- add `Workflow: blocked-greg`
- comment the exact question and concrete options

Do not hide blocked work inside ordinary progress notes.

## Race-Condition Rule

If you observe a status, label, delegate, assignee, or description change you did
not make, sync before continuing.

This applies to Claude, Codex, and any future agent. Linear is the durable shared
memory; unexpected changes may mean another worker has taken ownership.

## Stale-Queue Sweep

Future automation should run a weekly sweep that flags issues stuck more than
seven days in `In Progress` or `In Review`.

Do not build this yet. Reserve the slot and keep the convention visible so later
automation has a clear target.

## Plan Tier And Feature Availability

The workflow is designed to run on Linear Free.

- Linear Free is enough for issues, projects, custom statuses, custom labels,
  delegates, and branch-specific PR rules.
- Greg has ChatGPT Pro, so Codex Cloud Agent is available in Linear.
- Triage Intelligence, Automations, and Insights are Business+ features and are
  not required for this workflow.
- Branch-specific PR rules and custom statuses should be used where available,
  but the human-readable status flow remains canonical.

## Linear Skills Vs Claude / Codex Skills

Two unrelated concepts are both called "skills." Keep them distinct.

| | Linear Skills | Claude Code / Codex Skills |
| --- | --- | --- |
| Lives where | Linear cloud, per-user account | `.claude/skills/` or `codex-skills/`, in repo or user home |
| Format | saved conversation or prompt template | Markdown `SKILL.md` with structured procedure |
| Run by | Linear's `@Linear` agent | Claude Code or Codex CLI |
| Codebase access | no | yes, full filesystem and bash |
| Sharing | personal only | repo-checked-in or user-home |

Workflow skills for Claude and Codex are intentionally deferred to later work.
When they are added, keep them thin wrappers around this document.

## Always-Loaded Guidance Files

- [CLAUDE.md](../../CLAUDE.md) contains Claude's compact always-loaded pointer.
- [AGENTS.md](../../AGENTS.md) contains Codex's compact always-loaded pointer.
- [linear-installed-agents-guidance.md](linear-installed-agents-guidance.md)
  contains condensed guidance for Linear Settings -> Agents -> Installed agents
  guidance.

If this canonical document changes, update the short guidance files in the same
PR unless there is an explicit reason not to.

## First Dogfood Cycle

POL-58 bootstraps this workflow. POL-31 is the intended first feature execution
cycle after the workflow exists:

1. Claude writes an executable Linear contract.
2. Codex implements on a task branch from `codex/integration`.
3. Codex self-reviews and opens a PR.
4. Claude reviews the real diff and re-runs verification.
5. Claude merges to `codex/integration` if no guardrail requires Greg.
6. Greg is pulled in only for the defined escalation cases.
