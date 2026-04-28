# Orders Feature Notes

Status: Active development

## Order Detail

Order detail rows can store a frozen `bom_snapshot` and `cutlist_snapshot` on `order_details`. These snapshots preserve the operational state of the product as sold for that order line, so later product BOM or cutlist template changes do not mutate existing orders.

## Swap and Surcharge

Product swap and surcharge support extends the order detail snapshot model. Each BOM snapshot entry keeps the original/default component, the effective operational component, an explicit `swap_kind`, an `is_removed` flag, zero effective demand for removed rows, and optional commercial surcharge fields. `order_details.surcharge_total` stores the summed commercial surcharge for the row, while the base order line price remains separate.

Removed cutlist-linked components keep the cutlist group material references for audit, but the affected cutlist parts are serialized with `quantity: 0`. Order cutlist aggregators must skip those zero-quantity parts before material assignment, cutting-plan aggregation, export, and piecework work-pool counting.

Order-side swaps are editable throughout the order lifecycle. Later UI phases write downstream-state exceptions into `bom_swap_exceptions` when a swap occurs after purchasing, work-pool, job-card, or stock-issue activity already exists.
