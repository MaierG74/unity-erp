**Purchasing Reset Guide**

- **Purpose:** Clean Purchasing data only (purchase_orders, supplier_orders, receipts, related inventory transactions, and junction links), keeping other modules (e.g., payroll/staff) intact.
- **Script:** `scripts/cleanup-purchasing.ts`

**Dry‑Run First**

- Command: `npx tsx scripts/cleanup-purchasing.ts --dry-run`
- Output shows counts to be affected and the first few component inventory deltas.
- Optional filters:
  - `--after=YYYY-MM-DD` limit by creation date
  - `--poIds=1,2,3` limit to specific purchase orders

**Apply Cleanup**

- Command: `npx tsx scripts/cleanup-purchasing.ts`
- Optional flags:
  - `--after=YYYY-MM-DD`
  - `--poIds=...`
  - `--allow-negative` allow on‑hand stock to go negative when reversing receipts (default clamps at zero)

**What the Script Does**

- Reverses inventory for the **net** quantity (receipts − returns) via suppliercomponents → components.
- Deletes `supplier_order_returns` and their linked `inventory_transactions`.
- Deletes `supplier_order_receipts` and their linked `inventory_transactions`.
- Deletes junction rows in `supplier_order_customer_orders` for affected supplier orders.
- Deletes `supplier_orders`, then parent `purchase_orders`.
- Leaves all other modules and lookup tables untouched.

**Tables Affected**

| Table | Action |
|-------|--------|
| `purchase_orders` | Deleted |
| `supplier_orders` | Deleted |
| `supplier_order_receipts` | Deleted |
| `supplier_order_returns` | Deleted |
| `inventory_transactions` | Receipt and return transactions deleted |
| `inventory` | `quantity_on_hand` reversed |
| `supplier_order_customer_orders` | Junction links deleted |

**Safeguards**

- Always run a dry run first and verify the scope.
- Prefer clamping to zero for stock unless you explicitly want negative quantities.
- If your instance uses component views, refresh them after cleanup (or add an RPC): `SELECT refresh_component_views();`

**Related Docs**

- `docs/domains/purchasing/purchasing-master.md`
