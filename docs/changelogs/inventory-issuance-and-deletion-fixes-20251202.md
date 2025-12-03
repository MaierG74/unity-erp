# Inventory Issuance & Deletion Fixes

**Date:** 2025-12-02  
**Status:** Completed  
**Related Work:** Manual stock issuance RPC hotfix, Inventory Transactions documentation refresh, Component deletion workflow hardening

## Summary
- Fixed the `process_manual_stock_issuance` RPC so it validates inputs, logs user IDs, handles UUID/NUMERIC types correctly, and returns useful error messages instead of empty `{}` payloads.
- Manual issuance history on `/inventory` now exposes a Stock Issuance PDF download button that mirrors the purchase-order issuance document.
- Transactions tab always shows the Stock Adjustment banner/button even if a component has no historical movements, enabling first-time stocktakes.
- Component deletion dialog now calls the `/api/inventory/components/[id]` route, which uses the Supabase admin client to delete all related rows (inventory transactions, quotes, supplier links, etc.) before removing the component record. This prevents orphaned `internal_code` values that block re-use.

## Frontend Updates
1. **`ManualStockIssueTab.tsx`**
   - Added download icon per issuance row that renders `ManualIssuancePDFDocument`.
   - Reused company settings for branding and added error handling on download failures.
2. **`TransactionsTab.tsx`**
   - Always renders the Stock Adjustment banner/cards even when `transactionsWithBalance.length === 0`.
3. **`DeleteComponentDialog.tsx`**
   - Replaced direct Supabase deletes with a call to `/api/inventory/components/[componentId]` so we can rely on the centralized admin cleanup logic.

## Backend Updates
1. **Supabase RPC `process_manual_stock_issuance`**
   - Casts UUIDs correctly, returns structured errors, enforces external reference presence, and updates `inventory.quantity_on_hand` field.
2. **API route `/api/inventory/components/[componentId]`**
   - Now deletes dependent rows across `stock_issuances`, `inventory_transactions`, `inventory`, `suppliercomponents`, `component_follow_up_emails`, `quote_cluster_lines`, `bom_collection_items`, `section_details`, and `supplier_order_customer_orders` before deleting the component.

## Documentation
- `domains/components/inventory-transactions.md` — Added manual issuance contract, PDF workflow details, and Stock Adjustment visibility notes.
- `domains/components/inventory-master.md` — Updated core operations to include manual issuance and clarified that Stock Adjustment banner shows even with zero history.
- `docs/README.md` — Linked this changelog.

## Testing
- Issued manual stock (component WIDGET) with references `ABC123456` and verified updated quantity, PDF download, and Supabase RPC return payload.
- Attempted manual issuance with missing reference to confirm validation error surfaces.
- Removed orphaned component `T222` via API and verified that a new component can reuse the internal code.
- Regressed component deletion UI to ensure it navigates back to the inventory list and invalidates queries.

## Follow-up
- Monitor Netlify deploy for Next.js build completion.
- Consider adding soft-delete/audit log to complement the hard delete flow.
