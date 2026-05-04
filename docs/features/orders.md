# Orders Feature Notes

Status: Active development

## Order Detail

Order detail rows can store frozen `bom_snapshot`, `cutlist_material_snapshot`, and `cutlist_costing_snapshot` values on `order_details`. These snapshots preserve the operational state and costing basis of the product as sold for that order line, so later product BOM, cutlist template, or product-level **Save to Costing** changes do not mutate existing orders.

Product-level cutlist costing snapshots are templates for future order lines only. When a product is added directly to an order, or when a quote is converted into an order, the current `product_cutlist_costing_snapshots.snapshot_data` is copied into `order_details.cutlist_costing_snapshot`. Material-cost fallback readers must prefer that order-line snapshot and only read the live product snapshot for legacy rows where the frozen field is empty. Refreshing an existing order line requires an explicit line edit or removing and re-adding the product.

## Swap and Surcharge

Product swap and surcharge support extends the order detail snapshot model. Each BOM snapshot entry keeps the original/default component, the effective operational component, an explicit `swap_kind`, an `is_removed` flag, zero effective demand for removed rows, and optional commercial surcharge fields. `order_details.surcharge_total` stores the summed commercial surcharge for the row, while the base order line price remains separate.

Cutlist material swaps use the same order-line snapshot principle. For lines with a cutlist material snapshot, the Products table exposes a **Cutlist material** action that lets operators set one primary board, one line-level edging, an optional fixed or percentage surcharge, and collapsed per-part board/edging overrides. Saving persists the line intent and rebuilds `order_details.cutlist_material_snapshot` with per-part `effective_*` fields so downstream cutting-plan, edging, export, and costing readers do not need to recompute the override chain.

Removed cutlist-linked components keep the cutlist group material references for audit, but the affected cutlist parts are serialized with `quantity: 0`. Order cutlist aggregators must skip those zero-quantity parts before material assignment, cutting-plan aggregation, export, and piecework work-pool counting.

Order totals are maintained by the database trigger `order_details_total_update_trigger`, which recomputes `orders.total_amount` from `order_details.quantity * order_details.unit_price + order_details.surcharge_total` after inserts, updates, deletes, and surcharge-only updates. Application routes should insert or mutate order details and then re-read the order if they need the latest total.

## Swap and Surcharge

Operators can open the Products tab on an order, expand a line's BOM panel, and use the row-level swap action to replace a BOM component with another component from the same category or remove it from operational demand. The dialog shows the frozen default component, a searchable same-category component list with `None / Remove this component` pinned at the top, a live cost-delta reference, and a user-controlled surcharge amount plus label.

Applying a swap updates the line's `bom_snapshot` and `surcharge_total` together on `order_details`. The surcharge total is the sum of each snapshot entry's surcharge amount multiplied by the order line quantity, so the order-total trigger immediately recomputes `orders.total_amount`. Swaps with non-zero surcharge render as indented child rows under the parent product line; removed components use a minus prefix and alternative swaps use a plus prefix.

Cutlist surcharges render as a separate child row when `cutlist_surcharge_resolved` is non-zero. The child row uses the resolved cutlist amount directly and keeps the sign visible, while `surcharge_total` remains trigger-owned rollup data for totals only.

Order-side swaps are editable throughout the order lifecycle. Later UI phases write downstream-state exceptions into `bom_swap_exceptions` when a swap occurs after purchasing, work-pool, job-card, or stock-issue activity already exists.
