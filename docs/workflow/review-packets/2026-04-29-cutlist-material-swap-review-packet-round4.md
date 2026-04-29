# GPT-5.5 Pro Round-4 Review Packet — Cutlist Material Swap & Surcharge

**Spec under review (v4):** [`docs/superpowers/specs/2026-04-29-cutlist-material-swap-and-surcharge-design.md`](https://github.com/MaierG74/unity-erp/blob/codex/local-cutlist-material-swap-spec/docs/superpowers/specs/2026-04-29-cutlist-material-swap-and-surcharge-design.md)
**Branch:** `codex/local-cutlist-material-swap-spec` at `f8ede6d` (post-round-3 rework)
**Earlier packets:** [round 1](https://github.com/MaierG74/unity-erp/blob/codex/local-cutlist-material-swap-spec/docs/workflow/review-packets/2026-04-29-cutlist-material-swap-review-packet.md) · [round 2](https://github.com/MaierG74/unity-erp/blob/codex/local-cutlist-material-swap-spec/docs/workflow/review-packets/2026-04-29-cutlist-material-swap-review-packet-round2.md) · [round 3](https://github.com/MaierG74/unity-erp/blob/codex/local-cutlist-material-swap-spec/docs/workflow/review-packets/2026-04-29-cutlist-material-swap-review-packet-round3.md)

---

## Round 3 → Round 4 — what changed

Round 3 returned 1 BLOCKER / 1 MAJOR / 1 MINOR with explicit "no broader architecture issues remain." All three integrated. Verification map:

| Round 3 finding | Resolution | Verify in spec § |
|---|---|---|
| **BLOCKER** — A2-V5 contradicted the API "strip derived fields" rule (stripping the only-supplied field would convert PATCH to no-fields-to-update; trigger wouldn't fire) | API role reframed from **enforcement** to **observability**: log warnings for `surcharge_total` / `cutlist_surcharge_resolved` writes from clients, pass them through to the DB, let the BEFORE trigger overwrite. A2-V5 rewritten to assert request returns 200 (NOT 400), trigger fires, response carries the recomputed value, server log captures the warning. Second test added: PATCH with valid trigger-input field (no warning, normal recompute). | §7 "Defense-in-depth at the API layer", A2-V5 |
| **MAJOR** — Empty-string parity fixture invalid for SQL helper (SQL takes `NUMERIC`; `''` fails before COALESCE) | Split into two parity ACs: A1-V1a covers DB↔TS numeric parity (positive/negative/zero/NULL/decimal/qty=0); A1-V1b covers TS/API normalization (empty-string → 0 in TS, API coerces `''` to NULL before DB). End-to-end correctness preserved without invalid SQL fixtures. | §App-side helper, A1-V1a, A1-V1b |
| **MINOR** — "One-cycle transition window" for `material_assignments` deprecation was time-vague | Replaced with a **data-based** removal condition: cleanup ticket only removes the hash term when (a) audit query reports zero `order_details` sourcing material state from legacy `material_assignments`, (b) Phase F grid-redirect smoke runs cleanly through one full release cycle, (c) cutting-plan output is identical pre/post removal. Cleanup ticket's first AC is running and capturing that audit query. | §Cutting-plan source revision hash extension (final paragraphs) |

---

## Round 4 task

You are GPT-5.5 Pro, plan-quality reviewer. Round 3 was a near-clean pass; you explicitly stated "no broader architecture issues remain" and identified 3 surgical issues. All 3 are integrated.

**Round 4 is a final-check pass.** Greg has elected to do one more round before sign-off. Expected outcome: zero BLOCKERs, zero MAJORs, possibly one or two MINORs that don't block shipping. If you find more than that, the design has a deeper issue we missed and we want to know.

### Round 4 priority foci

1. **Did round 3's BLOCKER fix actually work?** The new A2-V5 says "API logs warning, request returns 200, response body returns recomputed value." But the existing PATCH route at `app/api/order-details/[detailId]/route.ts` returns "No fields to update" when `updateData` is empty. The new behaviour requires the route to keep `surcharge_total` in `updateData` (with a warning log) so the row UPDATE goes through and fires the trigger. Verify the spec is clear that the route must NOT strip the field before deciding whether `updateData` is empty.

2. **Is the A1-V1a / A1-V1b split clean?** Specifically:
   - The TS helper `resolveCutlistSurcharge` accepts numbers, not strings. The "empty-string" case is the API request body parser, not the TS helper. Verify the spec is clear about which boundary normalises `''`.
   - The DB trigger receives only NUMERIC after PostgREST validation. Is the API → DB pipeline lossless across all the documented inputs?

3. **The data-based deprecation condition** — is it concretely actionable?
   - The spec says "remove only when the audit query returns zero rows AND release cycle smoke passes." Has the audit query itself been spec'd, or is it left to the cleanup ticket to design?
   - Should the spec include a sample of what that audit query looks like, so the cleanup ticket has a head-start?

4. **Anything that's been spec'd but not added as an AC line?** Last spot-check: walk through Phase A1, A2, B, C, D, E, F ACs and look for a behaviour that's described in prose but missing from the AC list. Round 3 caught two of these.

5. **Any inconsistency the rework introduced?** A non-zero number of round-3 fixes touched multiple sections. Did the rewrites create stale references in earlier sections (e.g. a phasing table that still mentions a pre-rework approach)?

### Things to skip

- Don't re-litigate rounds 1, 2, or 3 issues unless the resolution itself is broken.
- Don't propose architectural alternatives or scope changes.
- Don't quibble about prose style.

### Reply format

Same. Severity-grouped. Cite spec sections. **If you find zero BLOCKERs and at most one or two MINORs, say so explicitly so we ship.** If you find a real BLOCKER, surface it — Greg requested round 4 because he wants the extra correctness check, not because we're chasing perfection.
