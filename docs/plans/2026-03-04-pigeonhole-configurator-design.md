# Pigeon Hole Configurator Design

**Date:** 2026-03-04
**Status:** Approved

## Overview

Add a "Pigeon Hole" template to the furniture configurator — an open grid unit (no doors) defined by columns × rows. Customer use cases: 2×2, 1×4, 2×4 configurations.

## Config Fields

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| width | number | 700 | Overall external width (mm) |
| height | number | 700 | Overall external height (mm) |
| depth | number | 350 | Overall external depth (mm) |
| columns | number | 2 | 1–6 |
| rows | number | 2 | 1–6 |
| materialThickness | number | 16 | 16/18/25mm |
| hasBack | boolean | true | |
| backMaterialThickness | number | 16 | 3 or 16mm |
| laminateTopBase | boolean | false | If true, top/base are laminated pairs |
| adjusterHeight | number | 10 | 0–50mm |
| topOverhangSides | number | 0 | |
| topOverhangBack | number | 0 | |
| baseOverhangSides | number | 0 | |
| baseOverhangBack | number | 0 | |
| shelfSetback | number | 2 | Shelf/divider setback from back |
| backSlotDepth | number | 8 | Routed slot depth for back panel |

## Parts Generation

| Part | Qty | Edge Banding | Dimensions |
|------|-----|-------------|------------|
| Top | 1 (2 if laminated) | T R B L | carcassW + overhangs × carcassD + overhang |
| Base | 1 (2 if laminated) | T R B L | same as top (with base overhangs) |
| Left Side | 1 | R (front), L (back) | sideHeight × carcassDepth |
| Right Side | 1 | L (front), R (back) | sideHeight × carcassDepth |
| Vertical Divider | columns - 1 | T (front) | sideHeight × carcassDepth - setback - BT |
| Shelf | (rows - 1) × columns | T (front) | cellWidth × carcassDepth - setback - BT |
| Back | 1 (if hasBack) | none | internalWidth × sideHeight + backSlotDepth |

## Key Math

```
T2 = laminateTopBase ? T * 2 : T
carcassWidth = width - max(topOverhangSides, baseOverhangSides) * 2
carcassDepth = depth - max(topOverhangBack, baseOverhangBack)
sideHeight = height - adjusterHeight - T2 - T2
internalWidth = carcassWidth - T * 2
cellWidth = (internalWidth - T * (columns - 1)) / columns
cellHeight = (sideHeight - T * (rows - 1)) / rows
shelfDepth = carcassDepth - shelfSetback - (hasBack ? BT : 0)
dividerDepth = shelfDepth  (same as shelves)
```

## Files to Create/Modify

1. `lib/configurator/templates/types.ts` — add PigeonholeConfig
2. `lib/configurator/templates/pigeonhole.ts` — generator + template export
3. `lib/configurator/templates/index.ts` — register template
4. `components/features/configurator/PigeonholeForm.tsx` — config form
5. `components/features/configurator/PigeonholePreview.tsx` — SVG preview
6. `components/features/configurator/FurnitureConfigurator.tsx` — support template switching
