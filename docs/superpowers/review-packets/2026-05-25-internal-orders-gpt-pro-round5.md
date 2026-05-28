# Review packet — Internal Orders & Order Completion (Round 5, sign-off)

**For:** GPT-5.5 Pro
**Round 4 summary:** 0 BLOCKERs + 1 MAJOR + 3 MINORs. The MAJOR (order-level section cascade cross-detail aggregation) is fixed. You said you'd sign off once that single cascade fix landed.
**Branch tip:** `codex/local-claude-internal-orders-spec` at `4733cc4`.
**Spec on GitHub:** https://github.com/MaierG74/unity-erp/blob/codex/local-claude-internal-orders-spec/docs/superpowers/specs/2026-05-25-internal-orders-and-order-completion-design.md

## The one change since round 4

**Order-level section cascade — per-detail group then SUM (round 4 MAJOR).** §"Section completion cascade (order-level — not the ready trigger)" now reads:

```
for each order_detail that routes through this section:
  for each pool row (= operation) for (this detail, this section), status='active':
    clamped_op_units = LEAST(SUM(jci.completed_quantity), pool.required_qty)
    op_complete_finished_goods = FLOOR(clamped_op_units / pool.required_qty_per_finished_good)
  section_complete_for_detail = LEAST(
     order_details.quantity,
     MIN(op_complete_finished_goods across that detail's operations in this section)
  )
order_section_completed = SUM(section_complete_for_detail across routed details)
order_section_required  = SUM(order_details.quantity across routed details)
if order_section_completed >= order_section_required:
  mark order_manufacturing_sections.completed_at
```

Worked example baked into the spec: 10 cupboards (Cutting→Edging→Assembly) + 5 chairs (Assembly only). Assembly required = 15. Both fully assembled → 10 + 5 = 15 ≥ 15 → completed_at set. The old `MIN(10, 5) = 5` would have wrongly compared `5 >= 15`.

Plus:
- Phase 2 test added: "10 cupboards + 5 chairs both route through Assembly; both fully complete; Assembly `completed_at` IS populated."
- Future-ticket note: raw-operation-progress UI surface alongside finished-good-equivalent (round 4 MINOR #2, non-blocking).
- Round 4 MINOR #1 (empty-string GUC clear vs RESET): kept empty-string per your call; no change.

## Sign-off request

This was the last open item from four review rounds. Unless you spot something new in the cascade fix, please confirm "Ship the spec" so I can proceed to `writing-plans` (implementation plan) and Linear filing.

One optional confirm: in the per-detail cascade, I cap `section_complete_for_detail` at `order_details.quantity` before summing — so an over-complete on one detail can't inflate the order-section total past its required. Is that cap correctly placed (inside the per-detail loop, before the SUM)? My read: yes, because `order_section_required = SUM(quantity)` and each detail can contribute at most its own `quantity`, so completed can never exceed required except through legitimate full completion.
