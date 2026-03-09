# Dashboard & Reporting 📊
Clear metrics at a glance so leaders act faster.

---

### 💡 What It Does
Pulls live data from across the platform into simple visuals and drill-down reports.
Spotlights trends, risks, and wins without needing spreadsheets or manual exports.
Delivers the same truth to everyone — from finance to operations to the floor.

---

### 🚀 Why It Matters
- Decisions land quicker when the right numbers are one click away.
- Early alerts help teams correct course before small issues grow.
- Confident board updates backed by real-time figures, not stale snapshots.
- Less manual reporting so analysts can focus on insights, not formatting.

---

### ⚙️ Key Highlights
✅ Role-based dashboards
✅ Real-time KPIs with business-safe definitions (for example, outstanding purchase orders exclude cancelled/fully received work and low-stock counts match the alert list)
✅ Recent Activity Chart (Revenue Trends in ZAR)
✅ Low Stock Alerts
✅ Drill-down to source transactions
✅ Export-ready summaries and charts
✅ Scheduled email reports

### 🔗 Navigation Wiring
- Low Stock alert rows should deep-link to the component detail page for investigation.
- The `Order` action from Low Stock alerts should open Purchasing with that component prefilled on a new purchase-order draft, not the generic Inventory landing page.
- `View All` from Low Stock alerts should land on Inventory Reports so users can review the broader shortage list immediately.
- Dashboard purchasing KPIs should count only genuinely outstanding purchase orders, not cancelled rows or stale headers whose lines are already fully received.
- Inbound purchasing labels should distinguish PO counts from line-level counts. For example, `Outstanding POs` is a purchase-order count, while `Items Awaiting Delivery` is a supplier-line count.
- Purchasing Queue summary pills should act as in-place widget filters first, swapping the dashboard list between pending approvals, awaiting-delivery lines, partial receipts, and supplier groupings. Drill-through happens from the rows.
- Pending approval rows in the Purchasing Queue should expose the actual component summary inline so users can see what is waiting for review before opening the PO.
- Supplier drill-through from the dashboard should use the same outstanding-line dataset as the purchasing screen; avoid capped samples that make supplier counts disagree between the two views.
- Purchase activity charts should use actual receipt records for inbound activity rather than `purchase_orders.updated_at`.

### 🧭 Personalization Direction
- Unity ERP should move from a single generic homepage toward **role-focused dashboards** with lightweight per-user configuration.
- The current branch includes a working **Purchasing Clerk** example that hides executive rollups by default and instead emphasizes:
  - purchasing quick actions
  - low stock alerts
  - assigned tasks
  - a purchasing queue for approvals/receipts
- Dashboard preferences are persisted **per user** and **per organization** so different people in the same organization can keep different widget mixes.
- Benchmark and source notes live in [`../analysis/dashboard-personalization-benchmark-20260308.md`](../analysis/dashboard-personalization-benchmark-20260308.md).

---

### 📊 Real-World Impact
> “Weekly reviews now take half the time — the numbers are already curated and trusted.”

---

### ⏱ Time Saved
6–8 hours a week freed from building slide decks and chasing data.
