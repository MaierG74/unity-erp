# GPT-5.5 Pro Round-3 Review Packet — Cutlist Material Swap & Surcharge

**Spec under review (v3):** [`docs/superpowers/specs/2026-04-29-cutlist-material-swap-and-surcharge-design.md`](https://github.com/MaierG74/unity-erp/blob/codex/local-cutlist-material-swap-spec/docs/superpowers/specs/2026-04-29-cutlist-material-swap-and-surcharge-design.md)
**Branch:** `codex/local-cutlist-material-swap-spec` at `8d61014` (post-round-2 rework)
**Round 1 packet:** [`2026-04-29-cutlist-material-swap-review-packet.md`](https://github.com/MaierG74/unity-erp/blob/codex/local-cutlist-material-swap-spec/docs/workflow/review-packets/2026-04-29-cutlist-material-swap-review-packet.md)
**Round 2 packet:** [`2026-04-29-cutlist-material-swap-review-packet-round2.md`](https://github.com/MaierG74/unity-erp/blob/codex/local-cutlist-material-swap-spec/docs/workflow/review-packets/2026-04-29-cutlist-material-swap-review-packet-round2.md)

---

## Round 2 → Round 3 — what changed

You returned **3 BLOCKERs / 6 MAJORs / 1 MINOR** on round 2. All integrated. Verification map:

### BLOCKERs (resolved)

| # | Issue | Resolution | Verify in spec § |
|---|---|---|---|
| 1 | Decision Summary + composition section still said "no new trigger work" / "app-layer save time" — direct contradiction with §7 (A2 trigger) | Decision Summary bullet rewritten to declare A2 trigger as authoritative. "How this composes with POL-71" rewritten with explicit BEFORE/AFTER trigger diagram. App helpers now described as "preview-only" everywhere. | §Decision Summary "Surcharge total integration" bullet, §How this composes with POL-71 |
| 2 | `UPDATE OF` trigger column list excluded `surcharge_total` and `cutlist_surcharge_resolved` themselves, so direct PATCH writes to those fields wouldn't fire the recompute | Trigger column list extended to include both output columns. Defense-in-depth: API layer strips those fields with warning log; TS types mark them as readonly. New AC A2-V5 tests `PATCH { surcharge_total: 999 }` and asserts trigger overwrites. | §7 trigger DDL (BEFORE clause), §Defense-in-depth at the API layer, §A2-V5 |
| 3 | Backer NULL lifecycle inconsistent — said "required at write time" but the architecture says NULL valid pre-Generate | Backer aligned to primary's lifecycle. `cutlist_primary_backer_material_id` is nullable, valid pre-Generate, validated at cutting-plan Generate. Removed the contradicting "required at write time" wording. | §5b Backer material model (rewritten) |

### MAJORs (resolved)

| # | Issue | Resolution | Verify in spec § |
|---|---|---|---|
| 4 | Cutting-plan source revision hash included `cutlist_surcharge_kind`/`value` — commercial-only edits would stale the cutting plan | Removed surcharge fields from the hash. New test: surcharge-only edit produces IDENTICAL hash. | §Cutting-plan source revision hash extension, A1-CT3a |
| 5 | Negative cutlist surcharges (discounts) didn't render — child row only appeared on `> 0` | Changed to `!== 0`. Sign-aware formatting: positive → `+ R 1,050`, negative → `− R 200`. | §Order-line render bullet 2, §Quote PDF generation logic |
| 6 | UI preview parity with DB trigger underspecified — TS helper had no body, DB function had its own formula, drift inevitable | TS helper body now specified line-by-line to mirror SQL exactly. Property-style parity test (A1-V1a) runs same fixtures through both implementations: fixed/percentage/0/null/negative/decimal/qty=0/empty-string. Drift = BLOCKER for shipping. | §App-side helper, §A1-V1a |
| 7 | Column rename migration had no deployment/schema-cache plan | Maintenance-window default + expand-contract alternative documented. A1-D5 runbook in `docs/operations/migration-status.md` covers Supabase types regen, PostgREST schema cache reload, deploy ordering. | §Deployment / schema-cache plan for the column rename, A1-D5 |
| 8 | Edging-loss validation only checked orders with cutting plans — pre-cutting-plan orders could lose edging silently | Validation population expanded to all `order_details` with non-empty legacy `material_assignments` AND any edged parts. Output report includes board, thickness, legacy edging source. | §A1-BF1a (rewritten) |
| 9 | A2 backfill `UPDATE … SET col = col` overwrites old values before drift check | Three-step backfill: preflight temp table captures old vs computed, drift report query (stop-and-ask), apply UPDATE, parity check. Cascading-write note added (POL-71 AFTER trigger fires per row). | §Backfill (Phase A2), A2-BF1..BF5 |

### MINOR (resolved)

| # | Issue | Resolution | Verify in spec § |
|---|---|---|---|
| 10 | Stale `cutlist_snapshot` prose in early sections | Preflight Findings rewritten to call out the rename and shape change explicitly. Snapshot Consumers heading now distinguishes mechanical rename from substantive shape change. | §Filesystem-grounded Preflight Findings rows 2-3, §Snapshot Consumers audit heading |

---

## Round 3 task

You are GPT-5.5 Pro, plan-quality reviewer. Round 3 is the final pass before this spec ships to Codex Desktop for implementation. **Your bar is now: any BLOCKER you find here is a real BLOCKER. Any MAJOR is a real MAJOR.** I've integrated 6 BLOCKERs and 14 MAJORs across rounds 1+2; the diminishing-return curve is real. If you can sign off with at most a few MINORs, do.

### Round 3 priority foci

1. **Did round 2's BLOCKER fixes introduce regressions or new BLOCKERs?**
   - The BEFORE trigger fires when *any* of `surcharge_total` or `cutlist_surcharge_resolved` is in the SET clause. Verify this doesn't create infinite recursion when the trigger itself writes those columns. (Postgres BEFORE triggers don't re-fire from `NEW.x := y` assignments — they only fire from external UPDATE statements — but confirm.)
   - The "API layer strips with warning" defense-in-depth: is the readonly TS type sufficient, or does Codex need explicit AC text for stripping in the PATCH route handlers?
   - Backer's nullable-pre-Generate lifecycle: are there any code paths that would attempt to read `effective_backer_id` from a snapshot before Generate (e.g. costing helpers, BOL preview) and fail when null?

2. **The three-step backfill — is the preflight query semantically correct?**
   - It uses `compute_bom_snapshot_surcharge_total(bom_snapshot, quantity)` — but does the helper exist BEFORE the trigger is created? The migration order matters: helpers must be created first, then the temp tables can use them, then trigger creation.
   - Does the preflight assume the new columns (`cutlist_surcharge_kind` etc.) already exist on the row? If A1 and A2 are separate migrations and A1 sets default values on insert, the preflight will read the just-defaulted values, not historical values, which is fine — but worth a sanity check.

3. **Phase F's transition window for `material_assignments`** — is one cycle long enough?
   - The spec says `computeSourceRevision` continues to hash `orders.material_assignments` for one cycle. Define "one cycle" — one quarter? One PR cycle? Until every order has been re-saved? The deprecation removal ticket is mentioned but the trigger is unspecified.

4. **The maintenance window** — is 5–10 min realistic for the workshop?
   - Greg's data scale is small (300-ish products, hundreds of orders). The migration itself is fast. The real time goes to types regen + redeploy + smoke. Has any obvious step been missed (e.g. CDN cache, browser-cached JS bundle)?

5. **Anything that's been spec'd correctly but not added to ACs?**
   - Particular suspects: the API layer stripping for surcharge_total/cutlist_surcharge_resolved. The backer-NULL validation at Generate time. The sign-aware rendering for negative surcharges. Are these in AC lines under their respective phases?

### Things to skip

- Don't re-litigate round 1 or round 2 issues (table above shows resolutions; if a resolution itself is broken, flag the resolution as a NEW BLOCKER).
- Don't propose alternate trigger architectures, alternate column names, or alternate phase orderings.
- Don't quibble about prose style.

### Reply format

Same. Severity-grouped. Cite spec sections. **Critical:** if you find ZERO BLOCKERs and ≤2 MAJORs, say so explicitly so we can ship. The trial workflow exits when GPT Pro is mostly confirming what's already there.
