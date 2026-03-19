# Factory Floor Density Optimization — Design

**Date:** 2026-02-28
**Goal:** Maximize information density on 1080p screens while keeping all current card data visible.

## Approach: Compact Cards + Collapsed Header

### 1. Header — Single Compact Bar

Collapse from 3 rows (~100px) to 1-2 rows (~44px):

- Row 1: Title (text-lg) + date + stats + shift info + buttons — all inline
- Row 2 (conditional): Stale jobs warning only if relevant

Layout: `[Factory Floor · Sat 28 Feb · 12 staff · 8 in progress] [Shift: 07:00–16:00 (3h left) Extend] [Sections] [Refresh]`

### 2. Staff Cards — Horizontal Single-Row

From vertical stack (~80px) to horizontal row (~36px):

- Left edge: 3px colored border encoding shift warning (red=overrun, amber=tight, blue=overtime, transparent=ok)
- Status dot + name: first column, truncated
- Order/job/product: middle column, joined with ·, truncated
- Progress bar + percentage: right column, fixed ~100px

Padding: px-2 py-1.5 (was p-3)

### 3. Section Zones — More Columns

- Single-span sections: 2-column card grid (was 1)
- Double-span sections: 4-column card grid (was 3)
- Header padding: px-3 py-2 (was px-4 py-3)
- Min-height: 120px (was 200px)
- Body padding: p-2 (was p-3)

### 4. Outer Layout

- Page padding: p-4 (was p-6)
- Section gap: gap-3 (was gap-4)
- Header-to-sections gap: space-y-3 (was space-y-6)

### Expected Results

~2x improvement in visible cards above the fold on 1080p.

### Files Changed

- `components/factory-floor/floor-header.tsx`
- `components/factory-floor/staff-job-card.tsx`
- `components/factory-floor/section-zone.tsx`
- `components/factory-floor/factory-floor-page.tsx`
- `components/factory-floor/progress-bar.tsx`
