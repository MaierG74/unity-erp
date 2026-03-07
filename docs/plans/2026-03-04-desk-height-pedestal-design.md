# Desk-Height Pedestal Configurator — Design

**Date:** 2026-03-04
**Status:** Approved

## Overview

Add a "Desk-Height Pedestal" template to the furniture configurator. Generates cutlist parts for a pedestal box with stacked drawer fronts — no top panel (sides act as legs under the desk).

## Config

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| width | number | 400 | Overall external mm |
| height | number | 700 | Including adjusters |
| depth | number | 590 | Overall external mm |
| materialThickness | number | 16 | Board thickness |
| drawerCount | number | 3 | Standard (equal-height) drawers |
| hasPencilDrawer | boolean | true | 19mm front at top of stack |
| hasFilingDrawer | boolean | false | ~390mm front at bottom of stack |
| drawerGap | number | 2 | Gap between each drawer front |
| hasBack | boolean | true | Back panel |
| backMaterialThickness | number | 3 | Hardboard default |
| adjusterHeight | number | 10 | Levelling feet |
| shelfSetback | number | 2 | Advanced |
| backRecess | number | 0 | Advanced |
| backSlotDepth | number | 8 | Advanced |

## Generated Parts (v1)

1. **Left Side / Right Side** — height: H - adjusterHeight, width: full depth. Edge banding on front edge.
2. **Base** — spans between sides. Depth minus back allowance.
3. **Back** — fits between sides, height includes slot depth.
4. **Pencil Drawer Front** (optional) — 19mm tall.
5. **Standard Drawer Fronts** — remaining height split equally minus gaps.
6. **Filing Drawer Front** (optional) — 390mm tall, at bottom.

Drawer front width = carcass internal width - drawerGap × 2.

### Not included (future)
- Drawer boxes (sides, base, back of each drawer)
- Top panel option (for standalone use)
- Mobile/castor variant
- Hardware (handles, locking)

## Dimension Math

```
carcassHeight = H - adjusterHeight
sideHeight    = carcassHeight
baseWidth     = W - T × 2           (spans between sides)
baseDepth     = D - shelfSetback - (hasBack ? BT + backRecess : 0)

Drawer front stack (top to bottom):
  totalGaps      = (N - 1) × drawerGap   where N = total drawer count
  pencilHeight   = hasPencilDrawer ? 19 : 0
  filingHeight   = hasFilingDrawer ? 390 : 0
  standardTotal  = carcassHeight - pencilHeight - filingHeight - totalGaps
  standardHeight = standardTotal / drawerCount
  frontWidth     = baseWidth - drawerGap × 2
```

## UI

- **Form:** NumberInput fields for dims, drawer count, toggles for pencil/filing, collapsible Advanced section. Same pattern as PigeonholeForm.
- **Preview:** SVG front view — carcass outline with stacked drawer fronts, dimension lines.
- **Edge banding:** Same override pattern via EdgeBandingPopover.

## Files

- `lib/configurator/templates/types.ts` — PedestalConfig interface + defaults
- `lib/configurator/templates/pedestal.ts` — generatePedestalParts()
- `lib/configurator/templates/index.ts` — register template
- `components/features/configurator/PedestalForm.tsx` — config form
- `components/features/configurator/PedestalPreview.tsx` — SVG preview
- `components/features/configurator/FurnitureConfigurator.tsx` — wire in
