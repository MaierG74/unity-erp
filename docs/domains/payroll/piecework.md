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
