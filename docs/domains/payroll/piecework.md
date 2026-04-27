# Piecework

## Product Cost Derivation

Product costing includes cutlist-derived piecework labor when an organization has active rows in `piecework_activities`.

The costing flow is read-only:

1. Load active `piecework_activities` for the product organization.
2. Load saved `product_cutlist_groups`; if none exist, seed cutlist parts from the product's effective BOM cutlist dimensions.
3. Group cutlist parts into material batches.
4. Run the registered counting strategy for each activity code in `lib/piecework/strategies`.
5. Return non-zero activity rows to the product Costing Labor tab.

The auto rows are displayed separately from the manual Bill of Labor rows and are marked `Auto`. Operators cannot edit or delete them from product costing. Rate changes are made in Settings -> Piecework Activities and are picked up on the next product costing load.

Auto-derived piecework totals are included in the product Unit Cost alongside material, manual labor, and overhead. Organizations with no active `piecework_activities` rows see no product costing behavior change.

This derivation does not add schema and does not write payroll earnings. Production-side card completion remains responsible for writing piecework earnings.

## Cutting Plan Finalize Work Pool

Finalizing an order cutting plan creates piecework demand only for organizations with active `piecework_activities`.

The finalize hook groups saved cutting-plan layouts by material/color batch and writes `source='cutting_plan'` rows into `job_work_pool`:

1. `cut_pieces` creates one pool row for every non-empty batch.
2. `edge_bundles` creates one pool row only when the batch has at least one banded bundle.
3. `required_qty` and `expected_count` both store the strategy result.
4. `material_color_label` stores the batch label shown to production.

Re-finalizing is idempotent. Unchanged pool rows are left untouched, so `updated_at` does not move. Changed rows that have not been issued are updated in place. Changed rows that have already been issued are not silently mutated; they create or update an open `job_work_pool_exceptions` row with `exception_type='cutting_plan_issued_count_changed'` for supervisor reconciliation.

Organizations with zero active `piecework_activities` rows keep the previous cutting-plan behavior and create no cutting-plan work-pool rows.
