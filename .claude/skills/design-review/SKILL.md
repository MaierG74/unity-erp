---
name: design-review
description: Reviews and applies Unity ERP UI design standards to a page or component. Use when building new pages, refactoring existing UI, or reviewing design consistency. Covers layout structure, spacing, color tokens, component patterns, table density, status badges, and mobile responsiveness.
disable-model-invocation: true
argument-hint: "[page or component to review]"
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# Unity ERP Design Review

Review and apply design standards to: **$ARGUMENTS**

## Your Workflow

1. **Read the target files** — Find and read all files related to `$ARGUMENTS`
2. **Read the supporting reference files** in this skill directory:
   - `design-tokens.md` — Color system, typography, spacing values
   - `components.md` — Component patterns with actual Tailwind classes
   - `principles.md` — Design philosophy and review checklist
3. **Audit the target** against the checklist in `principles.md`
4. **Report findings** — List what's correct, what needs fixing, and what's missing
5. **Apply fixes** if the user asks (or suggest them if reviewing only)

## Key Rules

- Always use semantic color tokens (`text-primary`, `bg-destructive`) — never raw hex/rgb
- Reference `components/ui/page-toolbar.tsx` as the standard page header pattern
- Reference `app/purchasing/page.tsx` as the gold-standard dashboard layout
- Tables should use `px-4 py-2.5` cell padding (not `p-4`) for ERP-appropriate density
- All countable text must use correct pluralization: `${count} item${count !== 1 ? 's' : ''}`
- Mobile views: tables need a `md:hidden` card fallback and `hidden md:block` desktop table
- Status badges must use consistent colors between list and detail views
- Primary actions go in ONE location only (prefer sticky bottom bar on detail pages)

## Output Format

Structure your response as:

### Audit Results
- **Pass** — things that match the design standards
- **Fail** — things that need fixing (with file path and line number)
- **Missing** — patterns that should exist but don't

### Recommended Changes
For each issue, show the specific edit needed with before/after code.
