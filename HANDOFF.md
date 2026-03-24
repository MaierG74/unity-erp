# Transactions Explorer — Handoff Notes

## Branch: `codex/local-transactions-explorer`

## What was built
Enhanced the Inventory > Transactions tab from a flat 500-record list into an Airtable-like stock explorer with:

- **Grouping**: By component, supplier, weekly, or monthly — collapsible groups with summary headers (Sum In, Sum Out, Current Stock, On Order, Reserved)
- **Rich filtering**: By product (BOM-based), supplier, category, transaction type, date range
- **Date presets**: This Week, This Month, Last 30 Days, This Quarter, Year to Date, Custom calendar
- **Saved views**: Personal + shared org views stored in new `saved_table_views` Supabase table (migration already applied)
- **Print**: Via `react-to-print` — prints the current filtered/grouped view
- **Clickable references**: Order numbers, PO numbers, component codes all link to their detail pages in new tabs
- **Filter chips**: Active filters shown as dismissible badges

## Files created

### New components (`components/features/inventory/transactions/`)
| File | Purpose |
|------|---------|
| `index.tsx` | Re-export — keeps existing import in `page.tsx` working |
| `TransactionsExplorer.tsx` | Main orchestrator — owns ViewConfig state, fetches data, renders toolbar + table |
| `TransactionsToolbar.tsx` | Search, Group By, date presets, Filters popover, Views dropdown, Print button |
| `TransactionsGroupedTable.tsx` | Renders flat or grouped table with collapsible group headers |
| `ViewManager.tsx` | Saved views dropdown with save/delete dialogs |
| `PrintView.tsx` | Hidden print-optimized layout rendered by react-to-print |

### New hooks (`hooks/`)
| File | Purpose |
|------|---------|
| `use-transactions-query.ts` | Enriched Supabase query with date bounds, nested joins, BOM-based product filtering |
| `use-component-stock-summary.ts` | Fetches quantity_on_hand, reserved, on-order for group header stats |
| `use-saved-views.ts` | CRUD for saved_table_views table |

### New types (`types/`)
| File | Purpose |
|------|---------|
| `transaction-views.ts` | ViewConfig, SavedView, EnrichedTransaction, ComponentStockSummary, DATE_PRESETS |

### Modified files
| File | Change |
|------|--------|
| `app/inventory/page.tsx` | Import path changed from `inventory/TransactionsTab` to `inventory/transactions` |

### Untouched
- `components/features/inventory/TransactionsTab.tsx` — old file still exists as fallback

## Database migration (already applied)
- Table `saved_table_views` with RLS — stores saved filter/group presets per user/org
- Columns: view_id, org_id, user_id, table_key, name, config (JSONB), is_shared, is_default

## Known issue: DATA QUERY NOT LOADING

The UI renders correctly but shows 0 transactions with a spinner. The database has 819+ transactions in the last 30 days.

### Root cause (suspected)
The enriched Supabase query in `hooks/use-transactions-query.ts` has nested joins that may be failing silently:
```
inventory_transactions
  → components!inner (internal_code, description, category:component_categories(...))
  → transaction_types (type_name)
  → purchase_orders (q_number, supplier:suppliers(supplier_id, name))
  → orders (order_number)
```

### Debug steps
1. Open browser console on `/inventory?tab=transactions` — look for Supabase errors
2. Try simplifying the query — remove nested `category:component_categories` and `supplier:suppliers` joins first
3. If that works, add them back one at a time to find the culprit
4. Check if `!inner` on components is filtering out transactions with null component_id
5. Verify the `enabled` condition in TanStack Query isn't blocking (productId defaults to 'all' so should be fine)

### Quick fallback
To revert to old working tab while debugging:
```tsx
// In app/inventory/page.tsx, change:
import { TransactionsTab } from '@/components/features/inventory/transactions';
// Back to:
import { TransactionsTab } from '@/components/features/inventory/TransactionsTab';
```

## Full implementation plan
See `.claude/plans/quizzical-pondering-pearl.md` for the detailed design document.

## User requirements (from interview)
1. Filter by product (e.g., "Apollo") → shows all BOM component transactions grouped
2. Group headers show: In, Out, Current Stock, On Order, Reserved
3. Saved views — both personal and shared across org
4. Print what you see — filtered/grouped state prints cleanly
5. Clickable order refs open in new tabs
6. Date range is critical for print and performance
7. "Summary only" print option (just group headers) — planned but not yet implemented

## Verification checklist
- [ ] Fix data loading query
- [ ] Verify grouping by component renders with real data
- [ ] Verify grouping by supplier, weekly, monthly
- [ ] Test product filter (select a product, verify BOM components shown)
- [ ] Test filter chips (add/remove filters)
- [ ] Test saved views (save, load, delete)
- [ ] Test print output
- [ ] `npm run lint`
- [ ] `npx tsc --noEmit` on touched files
- [ ] `mcp__supabase__get_advisors` for RLS check on saved_table_views
- [ ] Run `/simplify` before finalizing
