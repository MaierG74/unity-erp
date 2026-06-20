# Cutlist Same-Board Finished Quantity Model

Date: 2026-06-18

## Goal

Same-board laminated parts can now use a finished-quantity model behind the organization flag `organizations.cutlist_defaults.same_board_quantity_model`.

- `pieces-v0` remains the default and preserves deployed behavior.
- `finished-v1` means a same-board quantity of `1` represents one finished laminated part and expands to two physical primary-board cut pieces for nesting.
- With-backer, none, and custom semantics are unchanged.

## Rollout

1. Deploy the flag-aware code while all organizations still default to `pieces-v0`.
2. Run `supabase/migrations/20260618120000_cutlist_same_board_finished_qty.sql` during the approved write freeze.
3. The migration halves existing even same-board quantities, marks migrated JSON rows with `"_sbqm": "finished-v1"`, records rollback rows, and flips affected organizations to `finished-v1` in the same transaction.
4. Product costing snapshots whose `parts_hash` was based on pre-migration quantities will read as stale and recompute on the next save.

## Counting Rules

The canonical helper is `lib/cutlist/quantityModel.ts`.

- Physical cut pieces: `cutPieceCountFromQuantity(part, { finishedModel })`
- Finished assemblies for edging/costing display: `finishedPartCountFromQuantity(part, { finishedModel })`

Same-board expansion is not applied to rows with `lamination_group` because grouped rows already represent explicit layers.
Custom lamination remains raw-quantity in the shared helper; placement-derived custom work pools already carry layer expansion separately.

## Piecework Safety

Piecework strategies default to the physical-pieces model. Product costing passes `sameBoardQuantityModel: "finished-v1"` only when the org flag is enabled, so product-row input expands ungrouped same-board finished quantities exactly once. Grouped same-board rows keep their explicit layer count for cutting and collapse edge bundles by `lamination_group`.

Cutting-plan work-pool input is placement-derived and does not set the finished-model flag, so same-board placements are not doubled again. Placement batches carry `source_part_id` for same-board rows so strip-packer placements with unique IDs still pair physical layers into finished edge bundles.

Grouped same-board edge bundles are namespaced by their source assembly when available. This prevents two order details that both contain `lamination_group = "G1"` in the same material batch from collapsing into one edge bundle.

Quote cutlist edging also collapses grouped same-board layer rows to one finished bundle per grouped assembly, matching the board allocation policy that treats grouped rows as explicit layers rather than auto-expanded finished quantities.

## Stale Client Guard

Cutting-plan aggregate responses include `same_board_quantity_model`, and `source_revision` includes the same resolved model. Saved cutting plans also carry `same_board_quantity_model`; the server rejects PUT submissions whose model differs from the current organization flag so a stale cached client cannot save a half-sized plan after cutover.

Org flag reads use membership-aware organization context. Client org settings resolve the active `organization_members` row first, and server order cutlist routes use the shared org-context resolver instead of trusting only JWT org metadata.

## Migration Safety Notes

The migration candidate predicate excludes grouped same-board rows, treats missing/null/empty `lamination_type` the same for `*-both` fallback rows, updates only rows with captured candidates, and derives affected organizations from `cutlist_same_board_finished_qty_rollback`. Rollback rows capture prior `cutlist_defaults` and `same_board_quantity_model` for flag restoration.

Every JSON array walk is guarded so SQL null, JSON null, or malformed non-array `parts` containers are skipped rather than aborting the run. The rollback and ledger tables are RLS-enabled with `anon` and `authenticated` revoked because they are migration/service-role artifacts. Rollback paths are stored relative to the JSON column being restored, and the migration comment includes a loop-based restore snippet for rows with multiple changed paths.
