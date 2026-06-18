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

## Piecework Safety

Piecework strategies default to the physical-pieces model. Product costing passes `sameBoardQuantityModel: "finished-v1"` only when the org flag is enabled, so product-row input expands same-board finished quantities exactly once. Cutting-plan work-pool input is placement-derived and does not set the flag, so same-board placements are not doubled again.
