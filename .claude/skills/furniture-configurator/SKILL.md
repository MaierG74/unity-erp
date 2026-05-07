---
name: furniture-configurator
description: Use when adding a new furniture template, modifying parametric parts generation, extending the configurator UI (forms, previews, edge banding), or porting the configurator pattern to another project.
---

# Furniture Configurator

## Overview

Parametric furniture builder: user configures dimensions/options via form → template generates CutlistPart[] → SVG preview renders live → parts save to `product_cutlist_groups` for the Cutlist Builder.

## Architecture

```
lib/configurator/templates/
  types.ts          — FurnitureTemplate<TConfig>, config interfaces, defaults
  index.ts          — TEMPLATES registry, getTemplate(), getTemplateList()
  cupboard.ts       — generateCupboardParts(CupboardConfig)
  pigeonhole.ts     — generatePigeonholeParts(PigeonholeConfig)

components/features/configurator/
  FurnitureConfigurator.tsx — Orchestrator: template select, parts table, save
  CupboardForm.tsx          — Config form for cupboard
  CupboardPreview.tsx       — SVG side-section view for cupboard
  PigeonholeForm.tsx        — Config form with cell-size reverse calculator
  PigeonholePreview.tsx     — SVG side-section view for pigeonhole
```

## Adding a New Template

### 1. Define Config + Defaults (`types.ts`)

```typescript
export interface PedestalConfig {
  width: number; height: number; depth: number;
  materialThickness: number;
  // ... template-specific fields
  // Shared fields: hasBack, backMaterialThickness, adjusterHeight,
  //   shelfSetback, backRecess, backSlotDepth, overhangs (top/base × sides/back)
}
export const DEFAULT_PEDESTAL_CONFIG: PedestalConfig = { /* ... */ };
```

### 2. Create Generator (`pedestal.ts`)

```typescript
export function generatePedestalParts(config: PedestalConfig): CutlistPart[] {
  // Derive carcass dimensions from overall dims minus overhangs
  // Generate parts: top, base, sides, shelves, back, doors, drawers
  // Each part: { id, name, length_mm, width_mm, quantity, grain, band_edges }
  // Optional: lamination_type: 'same-board' for doubled panels
}

export const pedestalTemplate: FurnitureTemplate<PedestalConfig> = {
  id: 'pedestal',
  name: 'Pedestal',
  description: '...',
  defaultConfig: DEFAULT_PEDESTAL_CONFIG,
  generateParts: generatePedestalParts,
};
```

### 3. Register in `index.ts`

```typescript
import { pedestalTemplate } from './pedestal';
export const TEMPLATES: Record<string, FurnitureTemplate<any>> = {
  cupboard: cupboardTemplate,
  pigeonhole: pigeonholeTemplate,
  pedestal: pedestalTemplate,  // add here
};
```

### 4. Add Form + Preview Components

- `PedestalForm.tsx` — use existing NumberInput pattern, collapsible Advanced section
- `PedestalPreview.tsx` — SVG side-section view with zoom/pan/fullscreen

### 5. Wire into Orchestrator (`FurnitureConfigurator.tsx`)

Add state, switch in form/preview rendering, apply org defaults for shared fields.

## Key Patterns

### Dimension Math Convention

All generators follow: **overall → carcass → internal → cell/shelf**.

```
carcassWidth  = W - max(topOverhangSides, baseOverhangSides) × 2
carcassDepth  = D - max(topOverhangBack, baseOverhangBack)
sideHeight    = H - adjusterHeight - topThickness - baseThickness
internalWidth = carcassWidth - T × 2
shelfDepth    = carcassDepth - shelfSetback - (hasBack ? BT + backRecess : 0)
```

### Cell-Size Reverse Calculator (Pigeonhole)

Two functions in `PigeonholeForm.tsx` convert between cell and overall dimensions:

- `cellToOverall(cellW, cellH, cellD, config)` — given internal cubby size, compute overall W/H/D
- `overallToCell(config)` — given overall config, derive cell W/H/D

Toggle between modes with `DimensionMode = 'overall' | 'cell'`. In cell mode, changing any construction param (thickness, overhangs, rows/cols) auto-recalculates overall dims.

### NumberInput Component

Both forms use a local `NumberInput` that:
- Shows raw text while focused (no clamping during typing)
- Clamps to `[min, max]` on blur
- Syncs from parent value when not focused

### Edge Banding Overrides

`FurnitureConfigurator.tsx` maintains `edgeOverrides` state keyed by part ID. Generated parts merge with overrides via `finalParts` memo. `EdgeBandingPopover` provides the click-to-edit UI.

### Org-Level Defaults

Stored in `organizations.configurator_defaults` (JSONB). Applied on mount via `useOrgSettings()`. Shared fields (materialThickness, backMaterialThickness, adjusterHeight, shelfSetback, backRecess, backSlotDepth, overhangs) apply to all templates.

### SVG Preview Architecture

- Unit system: `u = Math.min(rawW, rawH) / 100`
- Components: `DimensionH`, `DimensionV` (dimension lines), `PanelLabel` (text on panels)
- Zoom/pan via viewBox manipulation with React state
- Fullscreen modal via dialog
- Font sizes scale inversely: `Math.max(11, Math.min(14, 13 / scale))`

### Save Flow

Parts save as cutlist groups to `POST /api/products/[id]/cutlist-groups`:
- Laminated parts (`lamination_type: 'same-board'`) → separate group with `board_type: '{T*2}mm-both'`
- Standard parts → group with `board_type: '{T}mm'`

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Forgetting `backRecess` in shelf depth | Always subtract `BT + backRecess` when `hasBack` |
| Hardcoding `32mm` for laminated | Use `T * 2` — board thickness is configurable |
| Not handling 0-row or 0-column | Return `[]` early if derived dims are ≤ 0 |
| Edge banding on back panels | Back panels never get edge banding |
| Missing grain direction | Sides/doors/shelves = `'length'`, backs = `'any'` |
