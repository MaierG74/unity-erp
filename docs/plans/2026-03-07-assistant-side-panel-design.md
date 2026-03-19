# Assistant Side Panel Design

**Date**: 2026-03-07
**Branch**: `codex/unpublished-feature-bundle`
**Status**: Approved

## Problem

The current assistant is a floating translucent card anchored bottom-right. Issues:

1. Translucent backdrop is distracting — page content bleeds through
2. Chart cards show empty blocks with no useful content inside bars
3. Order list items are not clickable
4. No way to navigate to an order from the assistant while keeping the panel open
5. Resize is drag-only — no quick toggle, and the panel traps you when the browser window shrinks
6. Not optimized for low-resolution screens

## Design

### Layout: Right-Side Drawer

- Full viewport height, anchored to right edge
- Opaque background (`bg-slate-800` dark / `bg-white` light) — no translucency
- Overlays the page content (does not push/shrink the main layout)
- Subtle left border + drop shadow for depth
- Slide-in animation from right (200ms ease-out), slide-out on close

### Two-Preset Width Toggle

| Mode    | Width  | Use case                    |
|---------|--------|-----------------------------|
| Compact | 340px  | Chat, simple lists          |
| Wide    | 520px  | Cards, charts, tables       |

- Toggle button in header (expand/collapse icon)
- On viewports < 1400px: wide caps at 420px
- On viewports < 768px: full-width overlay (mobile)
- Default: compact

### Auto-Collapse on Viewport Shrink

- Panel > 40% of viewport width -> force compact
- Compact > 60% of viewport width -> auto-close panel
- Re-evaluate on window resize
- User's width preference is remembered but constrained by viewport

### Header (Compact)

- "Unity Assistant" title + Prototype badge
- Width toggle button + close (X) button
- Scope label below title
- Shortcut hint: Cmd+J

### Clickable Entity Rows

- Order numbers, PO references, and entity names in results are clickable
- Click calls `router.push()` on the main page — panel stays open
- Hover: subtle highlight + pointer cursor
- Card action buttons also use router navigation instead of `<a>` full-page nav

### Chart Card Improvements

- Bar chart: orders for each day listed below or inside the bar area
- Days with 0 orders: minimal representation, no large empty box
- Detail rows (PO21169, etc.) are clickable, navigating to the order

### Open/Close

- Trigger: Cmd+J keyboard shortcut, or FAB button (existing)
- FAB button remains for discoverability
- Escape key closes panel
- Panel remembers conversation across open/close within same page

## Files to Modify

- `components/features/assistant/AssistantDock.tsx` — full rewrite to side panel
- `lib/assistant/prompt-suggestions.ts` — no changes needed
- `app/api/assistant/route.ts` — no changes needed

## Out of Scope

- Backend/API changes
- New card types
- Mobile-specific redesign beyond full-width overlay
