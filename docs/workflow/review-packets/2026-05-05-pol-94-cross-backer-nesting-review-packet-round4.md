# GPT-5.5 Pro Review Packet — POL-94 Cross-color cutting-plan nesting (round 4)

**Spec under review:** [`docs/superpowers/specs/2026-05-05-cross-backer-nesting-design.md`](https://github.com/MaierG74/unity-erp/blob/codex/local-cross-backer-nesting/docs/superpowers/specs/2026-05-05-cross-backer-nesting-design.md) — v4 at commit `9d0a163`
**Branch:** `codex/local-cross-backer-nesting` (7 commits ahead of base)
**Base:** `codex/integration` at `99faea6`
**Round 3 packet + findings:** [`...-review-packet-round3.md`](https://github.com/MaierG74/unity-erp/blob/codex/local-cross-backer-nesting/docs/workflow/review-packets/2026-05-05-pol-94-cross-backer-nesting-review-packet-round3.md)
**Author:** Claude Desktop (local), 2026-05-05

> Paste below into GPT-5.5 Pro. Round-3 verdict was "very close, one more round" with 0 BLOCKERs + 2 MAJORs + 2 MINORs — all stale-v2-wording cleanups within file-by-file rows. v4 applies all four. Round 4 is final-pass verification + sign-off.

---

## Role

Final-pass plan-quality reviewer for POL-94. Round 3 surfaced four stale-wording inconsistencies between v3's DP5 contract and downstream file-by-file rows. v4 applies all four. Decide whether the spec is implementation-ready.

## What changed v3 → v4

See spec §What changed in v4 (top of document). Four targeted edits:

1. **DP5 row** — failure shape now lists `reason: 'wrong_category' | 'null' | 'out_of_range'` (was `'null' | 'out_of_range'`).
2. **`cutting-plan-aggregate.ts` row** — parameter renamed `backerThicknessByComponentId: Map<number, number>` → `backerLookup: Map<number, { thickness_mm; category_id }>`. Failure shape includes `'wrong_category'`. Removed "known-thickness set" wording.
3. **`material-regroup.ts` row** — same `backerLookup` parameter; mentions client-side category + plausibility-range checks before constructing the lookup.
4. **`aggregate/route.ts` row** — query selects `(component_id, description, category_id)`; validates all three (category, non-null parse, `0.5..50`); returns `BACKER_THICKNESS_INVALID` directly without entering the aggregator on failure.
5. **Phase 1 wording** — "known-thickness sanity check" → "category + plausibility-range validation".
6. **AC12** — `-both` regression now also asserts `total_nested_cost` parity.

No architectural changes. No new files affected. No DB or RLS implications.

## Specific things to verify

1. Are all references to "known-thickness set" / "known-backer-thickness set" in active spec rules now gone? (Changelog tables in §What changed in v2/v3/v4 legitimately reference the old term in a historical sense; that's expected.)
2. Is the `backerLookup` shape `Map<number, { thickness_mm: number; category_id: number }>` consistent across the three implementation rows that mention it (aggregator, regrouper, route)? Are caller and callee responsibilities clearly partitioned (route validates → aggregator trusts)?
3. Is the `reason` union `'wrong_category' | 'null' | 'out_of_range'` identical in DP5, Grouping rule §3, and the aggregator file-by-file row?
4. Does AC12's expanded `-both` assertion conflict with anything in AC11 (cost formula correctness)? Should be complementary, not redundant.

## Reply format

Same as prior rounds. Group by severity. If you find nothing, return:

> "Sign off as-is — Codex implementation can proceed."

Otherwise: severity-grouped findings + "Iterate one more round" or "Multiple rounds needed." If only nits remain that don't block implementation, prefer sign-off with the nits noted as MINOR and recommended for fix-during-implementation.
