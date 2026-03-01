# Orders Page Redesign — Design Notes

**Date:** 2026-02-28
**Status:** Design approved, simplification complete — Phase 2 plan ready

## Problem

The orders detail page (`app/orders/[orderId]/page.tsx`) is a 4,183-line monolith with a dated layout. The Order Summary section wastes space on metadata that's rarely edited, stock reservations are a separate block rather than per-line, and the tab-based navigation requires too many clicks.

## Approach: Single Scroll + Smart Buttons + Slide-Out Panel

Approved by user. Combines the best patterns from Odoo, SAP Fiori, NetSuite, and ERPNext.

### Layout (top → bottom)

1. **Back + Order title stripe** — `← PO1852` + status badge + delivery badge
2. **Metadata stripe** — `Typestar | Feb 27, 2026 | Due: Mar 17 | R 12,450.00` — all inline-editable on click
3. **Smart buttons row** — `📦 Products (3) | 🔧 Job Cards (2) | 📋 POs (1) | 📄 Docs (4) | 📤 Issued (2)` — counts of related records, clicking scrolls to section or opens slide-out
4. **Products table** (dominates viewport) — expandable rows show BOM components inline, inline reserve per line, inline price editing
5. **Collapsible sections** — Job Cards, Procurement, Documents, Issue Stock — collapsed by default, opened via smart button click
6. **Slide-out panel** — Optional right panel for deep-dive into BOM/procurement per selected line item

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Full page rethink (all tabs) | User wants cohesive experience |
| Components tab | Embedded per product line | Expandable rows, no separate tab |
| Header | Ultra-compact single stripe | One line: Customer + PO# + Status + Date + Total |
| Navigation | Smart buttons replace tabs | Badge-like buttons with counts, no tab bar |
| Stock reservations | Per-line in products table | Reserve button per product row, modal for quantity |

### Research Sources

- **Odoo:** Smart buttons, inline-editable line items, section headers in tables
- **SAP Fiori:** Collapsible header with KPIs, row-selection quick actions, semantic color coding
- **NetSuite Redwood:** Collapsible sections, multi-action save buttons, sticky headers
- **ERPNext:** Three-column metadata, auto-exploded packing lists

## Implementation Phases

### Phase 1: Simplification (current)
Break the 4,183-line monolith into focused components:
- `lib/queries/order-queries.ts` — data fetching functions
- `lib/queries/order-components.ts` — BOM/supplier queries
- `components/features/orders/OrderComponentsDialog.tsx`
- `components/features/orders/AddProductsDialog.tsx`
- `components/features/orders/StatusBadge.tsx`
- `lib/format-utils.ts` (already exists)

### Phase 2: Redesign
Build the new layout using the extracted components as building blocks.
