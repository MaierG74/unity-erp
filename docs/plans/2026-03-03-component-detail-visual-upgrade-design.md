# Component Detail Page Visual Upgrade

**Date:** 2026-03-03
**Status:** Approved
**Reference:** Orders page (`app/orders/[orderId]/page.tsx`) — the gold standard

## Problem

The Component detail page (`app/inventory/components/[id]/page.tsx`) lacks the visual depth and polish of the Orders page. Cards sit on a flat black/white background with no layering, no sidebar, and no accent borders. The Orders page uses a subtle gray canvas (`bg-muted/30`), a right sidebar, colored accent borders, and a sticky header to create beautiful visual hierarchy.

## Scope

All 5 tabs: Overview, Suppliers, Transactions, Orders, Analytics.

## Changes

### 1. Page-Level Background Wrapper

**Current:** `<div className="max-w-7xl space-y-4">`
**New:** `<div className="max-w-7xl space-y-5 bg-muted/30 -mx-4 md:-mx-6 px-4 md:px-6 min-h-screen">`

The `bg-muted/30` subtle gray canvas makes Card components pop with visual depth — the single biggest improvement.

### 2. Sticky Header with Backdrop Blur

Wrap the title row (back arrow + component code + Edit/Delete) and tab list in a sticky container:

```
sticky top-0 z-10 -mx-4 md:-mx-6 px-4 md:px-6 pb-0 pt-2 space-y-3
bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80
border-b shadow-sm
```

Title and tabs stay visible as user scrolls through long tab content.

### 3. Right Sidebar on Overview + Orders Tabs

280px right sidebar using `grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5`.

**Overview sidebar cards:**
- **Stock Summary** — Current stock level, reorder level, on-order quantity
- **Supplier Links** — Linked suppliers with click-through navigation
- **Quick Actions** — Edit, Reorder, View Transactions

**Orders sidebar cards:**
- **Stock Position** — In stock, on order, required, shortfall at a glance
- **Quick Actions** — Create PO, View all POs

Transactions, Suppliers, and Analytics tabs remain **full-width** (wide tables/charts).

### 4. Colored Gradient Stat Cards (Orders Tab)

Replace plain bordered cards with the gradient pattern already used in Overview tab:

| Card | Light | Dark | Border |
|------|-------|------|--------|
| On Order | `from-blue-50 to-blue-100/50` | `from-blue-950/30 to-blue-900/20` | `border-blue-200 dark:border-blue-800` |
| Required | `from-purple-50 to-purple-100/50` | `from-purple-950/30 to-purple-900/20` | `border-purple-200 dark:border-purple-800` |
| Used In | `from-slate-50 to-slate-100/50` | `from-slate-800/30 to-slate-700/20` | `border-slate-200 dark:border-slate-700` |

### 5. Section Card Accent Borders

Left accent borders to distinguish section categories:

| Section | Border | Meaning |
|---------|--------|---------|
| Purchase Orders | `border-l-3 border-l-blue-500/40` | Procurement |
| Bill of Materials | `border-l-3 border-l-emerald-500/40` | Products |
| Active Orders | `border-l-3 border-l-purple-500/40` | Demand |

### 6. All Tabs Benefit

The page background and sticky header apply universally. Individual tabs like Transactions (already has gradient banner) and Analytics (already has health cards) mainly benefit from the improved contrast against `bg-muted/30`.

## Files to Modify

1. `app/inventory/components/[id]/page.tsx` — Page wrapper, sticky header, sidebar grid
2. `components/features/inventory/component-detail/OrdersTab.tsx` — Gradient stat cards, accent borders, sidebar-aware layout
3. `components/features/inventory/component-detail/OverviewTab.tsx` — Sidebar-aware layout (extract sidebar content)
4. `components/features/inventory/component-detail/SuppliersTab.tsx` — Minor: benefits from page background
5. `components/features/inventory/component-detail/TransactionsTab.tsx` — Minor: benefits from page background
6. `components/features/inventory/component-detail/AnalyticsTab.tsx` — Minor: benefits from page background

## New Components

- **ComponentSidebar** (inline in page.tsx or small extracted component) — Stock summary, supplier links, quick actions cards. Content varies by active tab.
