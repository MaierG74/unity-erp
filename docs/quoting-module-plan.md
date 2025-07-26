# Unity ERP – Quoting Module Implementation Plan

---

## Purpose
Provide a flexible, auditable, and user-friendly quoting workflow that supports:
1. Multiple products per quote with granular pricing.
2. Rich context via attachments (photos, drawings, external docs).
3. Inline notes and calculation helpers.
4. Tight integration with Inventory while still allowing ad-hoc external line items.
5. Versioning, approvals, and streamlined conversion from Quote → Order.

---

## Data Model
### Core tables
- `quotes` – header record (id, customer_id, status, total_price, currency, created_by, approved_by, created_at).
- `quote_items` – one row per line item. Links to `inventory_items` (nullable) _or_ stores free-text description for external items / subcontractor costs (fields: description, vendor_id, unit_cost, markup_pct, unit_price, quantity, line_total, attachments).
- `quote_attachments` – files attached at either quote level or line-item level (`scope ENUM('quote','item')`, `quote_item_id` nullable).
- `quote_notes` – RICH TEXT notes/observations keyed to quote_id and optionally quote_item_id.
- `quote_versions` – snapshot of quote JSON at commit points for diff / rollback.

### Derived fields
- `subtotal`, `tax`, `shipping`, `discount_pct`, `grand_total` – maintained by DB function `update_quote_totals()` triggered on quote_items change.

---

## Key Features (MVP)
1. **Multi-item Quote Builder**
   - Search & add inventory items with live stock/price lookup.
   - Add custom items with manual cost & vendor refs.
   - Quantity, unit price, markup %, line total auto-calc.

2. **Attachment Management**
   - Drag-and-drop multiple images/drawings at quote or item level.
   - Uses Supabase Storage (`qbutton/quotes/{quote-id}/...`).
   - Preview thumbnails in UI; allow download/delete with RLS enforced.

3. **Notes & Rich Comments**
   - Markdown-supported notes field per quote & per item.
   - Mentions (`@username`) & timestamps for audit trail.

4. **Inline Calculation Sheet**
   - Calculator component that can reference line totals (ex: steel weight * rate).
   - Store calc results back into hidden items (e.g., "Labour") if required.

5. **External Document References**
   - Link external URLs or upload PDFs from suppliers.
   - Optionally include selected pages in exported quote PDF.

6. **Inventory & External Price Mix**
   - For inventory items: lock price from `inventory_items.price` or allow override with permission.
   - For external items: require vendor name & attachment of vendor quote.

7. **Quote Versioning & Approval**
   - Save & label versions (e.g., v1, Customer Rev A).
   - Compare diff (price/notes).
   - Basic approval workflow with role-based RLS (draft → pending → approved → sent).

8. **Export & Delivery**
   - Generate beautiful PDF with company letterhead, embedded images, optionally external docs as appendix.
   - Email directly from app with log of send attempts.

---

## Stretch Goals
- **Bulk PDF Export / Archive** – batch export selected quotes.
- **Margin Analysis Dashboard** – see cost vs sell, margin % by quote/item.
- **Mobile-first Quick Quote** – simplified flow for on-site quoting.
- **Dynamic BOM Expansion** – explode assemblies into parts on quote.

---

## UI / UX To-Dos
- Wizard-style quote builder with progress steps.
- Tabbed layout: Items | Attachments | Notes | Calculations | History.
- Sticky quote summary card with running totals.
- Inline image preview & annotation.
- Keyboard shortcuts for adding items / navigating fields.

## Current Implementation Files (2025-07-26)
- `app/quotes/page.tsx`
- `app/quotes/[id]/page.tsx`
- `app/quotes/new/page.tsx`
- `components/features/quotes/QuoteAttachmentsList.tsx`
- `components/features/quotes/QuoteItemsTable.tsx`
- `lib/db/quotes.ts`

---

## Technical Tasks
- [ ] Extend data model & SQL migrations for new tables/enums.
- [ ] Storage policy updates for new attachment scopes.
- [ ] Build React hook `useQuoteBuilder` for state & validation.
- [ ] Unit tests for price calculations & totals trigger.
- [ ] PDF template in `react-pdf`.
- [ ] Role-based RLS policies for approvals and attachment access.

---

## Next Steps
1. Finalize schema changes & Supabase migrations (see `/supabase/migrations/quotes_v2.sql`).
2. Implement Attachment Management UI (drag-and-drop component).
3. Prototype calculation component & get feedback.
4. Gather feedback from sales team, iterate.

