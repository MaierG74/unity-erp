# Changelog — FG Reservations Phase 2

Date: 2025-09-19
Branch: September

## Summary
- Added Finished-Good reservation lifecycle (Reserve, Release, Consume) with RPCs and API endpoints.
- Orders UI: FG Reservations card, optimistic updates, and per-line columns (Reserved FG, Remain to Explode).
- Components tab: new toggles and semantics.
  - Apply FG coverage (default ON, persisted) scales per-order component requirements and shortfalls based on remaining-to-explode.
  - Show global context (default ON, persisted) shows Total Across Orders and Global Shortfall columns and a global badge (all orders).

## Technical
- RPCs: reserve_finished_goods, release_finished_goods, consume_finished_goods.
- Endpoints: POST reserve-fg/release-fg/consume-fg; GET fg-reservations.
- Resilient fg-reservations route avoids brittle FK joins by merging product info after fetching reservations.
- Fixed SQL ambiguities and type mismatches in component functions.

## Docs
- Updated:
  - docs/subproduct.md
  - docs/orders-master.md
  - docs/components-section.md
