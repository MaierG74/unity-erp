# Cupboard Interior Layout Extension — Design Spec

**Date:** 2026-05-28  
**Branch:** `codex/configurator-layout-extension`  
**Status:** Approved

---

## Overview

Extends the Furniture Configurator's Cupboard template with wardrobe-style interior layout options: a hanging rail, a vertical divider, and configurable shelf sections. All new options use independent toggles (not named presets). Positions are in mm throughout.

---

## Scope

**In scope:**
- Hanging rail (visual only — no cutlist part)
- Top shelf above the rail
- Shelves below the rail
- Vertical divider panel (generates a cutlist part)
- Right-side shelves (when divider is present)
- SVG technical preview updates
- 3D preview updates (cupboardThreeModel.ts)

**Out of scope (future):**
- Drawers below the hanging rail
- User-saved presets / templates
- Pigeonhole / Pedestal layout changes

---

## Data Model

### New fields on `CupboardConfig` (`lib/configurator/templates/types.ts`)

`shelfCount` is replaced by `leftShelfCount`. All new fields have defaults so existing saved configs remain valid.

```typescript
// replaces shelfCount
leftShelfCount: number;
// right-side shelves — only meaningful when hasVerticalDivider=true
rightShelfCount: number;

// hanging rail
hangingRailEnabled: boolean;
hangingRailHeightFromTop: number;  // mm from interior top face to rail centreline
hangingTopShelf: boolean;           // shelf with bottom face at hangingRailHeightFromTop
hangingBelowShelfCount: number;     // shelves below rail, evenly distributed

// vertical divider
hasVerticalDivider: boolean;
dividerPositionMm: number;          // mm from left inner edge to divider panel face
```

### Defaults added to `DEFAULT_CUPBOARD_CONFIG`

```typescript
leftShelfCount: 3,
rightShelfCount: 3,
hangingRailEnabled: false,
hangingRailHeightFromTop: 500,
hangingTopShelf: false,
hangingBelowShelfCount: 0,
hasVerticalDivider: false,
dividerPositionMm: 450,
```

### Field semantics by configuration

| Configuration | Active fields |
|---|---|
| Standard shelves | `leftShelfCount` (full-width) |
| Full hanging bay | `hangingRailEnabled`, `hangingRailHeightFromTop`, `hangingTopShelf`, `hangingBelowShelfCount` |
| Split: hang + shelves | All hanging fields (left bay) + `hasVerticalDivider`, `dividerPositionMm`, `rightShelfCount` |
| Top shelf + hanging | `hangingRailEnabled`, `hangingTopShelf: true`, `hangingRailHeightFromTop` |

`leftShelfCount` is always present and label-switches to "Left shelves" in the form when `hasVerticalDivider=true`.

---

## Cutlist Generation (`lib/configurator/templates/cupboard.ts`)

### Removed
- `shelfCount` reference — replaced by `leftShelfCount`

### Changed
- Existing shelf generation uses `leftShelfCount` with full `internalWidth` when `hasVerticalDivider=false`, or with left-bay width (`dividerPositionMm - 0`) when `hasVerticalDivider=true` and `hangingRailEnabled=false`

### Added (in order of assembly)

**Vertical divider** (when `hasVerticalDivider=true`):
- Name: `"Vertical Divider"`
- `length_mm`: `sideHeight`
- `width_mm`: `carcassDepth`
- `quantity`: 1
- `grain`: `'length'`
- `band_edges`: front edge only (`{ top: false, right: true, bottom: false, left: false }`)

**Hanging top shelf** (when `hangingRailEnabled && hangingTopShelf`):
- Name: `"Hanging Top Shelf"`
- Bottom face at `hangingRailHeightFromTop` from interior top
- `length_mm`: left-bay internal width (`dividerPositionMm` when divider present, `internalWidth` when not)
- `width_mm`: `shelfDepth`
- `quantity`: 1
- `grain`: `'length'`
- `band_edges`: `{ top: true, right: false, bottom: false, left: false }` (front edge — matches existing shelf convention)

**Hanging rail** — no cutlist part (visual only)

**Shelves below rail** (when `hangingRailEnabled && hangingBelowShelfCount > 0`):
- Name: `"Hanging Bay Shelf"` / `"Hanging Bay Shelves"`
- Evenly distributed between `hangingRailHeightFromTop` and the base interior face
- Same width as hanging top shelf, same depth
- `quantity`: `hangingBelowShelfCount`
- `grain`: `'length'`
- `band_edges`: `{ top: true, right: false, bottom: false, left: false }`

**Right-side shelves** (when `hasVerticalDivider && rightShelfCount > 0`):
- Name: `"Right Shelf"` / `"Right Shelves"`
- `length_mm`: `internalWidth - dividerPositionMm - T` (right-bay internal width)
- `width_mm`: `shelfDepth`
- `quantity`: `rightShelfCount`
- `grain`: `'length'`
- `band_edges`: `{ top: true, right: false, bottom: false, left: false }`

### Derived geometry additions (`cupboardGeometry.ts`)

Two new derived values exported from `deriveCupboardGeometry`:
- `leftBayWidth`: `dividerPositionMm` when `hasVerticalDivider`, else `internalWidth`
- `rightBayWidth`: `internalWidth - dividerPositionMm - T` when `hasVerticalDivider`, else 0

---

## Form UI (`components/features/configurator/CupboardForm.tsx`)

### Changes to Construction section
- Remove the "Shelves" `NumberInput` — it moves to the new Interior Layout section

### New "Interior Layout" section
Inserted between Construction and Back Panel.

```
Interior Layout
├── [Switch] Hanging Rail
│   └── (when ON, indented with blue left-border)
│       ├── Rail height from top (mm)  [NumberInput, min 50, max sideHeight-50]
│       ├── Shelves below rail         [NumberInput, min 0, max 8]
│       └── [Switch] Top shelf above rail
├── [Switch] Vertical Divider
│   └── (when ON, indented)
│       ├── Divider from left (mm)     [NumberInput, min T*2, max internalWidth-T*2]
│       └── Right shelves              [NumberInput, min 0, max 10]
└── Shelves [label: "Left shelves" when divider ON, "Shelves" when OFF]
    [NumberInput, min 0, max 10]
```

All sub-fields use the existing `NumberInput` component. Indented sub-groups use a `border-l-2 border-blue-800 pl-3 ml-3` pattern (matches Back Panel's existing conditional reveal style).

---

## SVG Technical Preview (`lib/configurator/preview/cupboardScene.ts`)

### Front view additions
- **Vertical divider**: filled rect with side-panel colour, full `sideHeight`, at `dividerPositionMm` from left inner edge
- **Hanging rail**: a bold cyan horizontal line at `hangingRailHeightFromTop` from interior top, spanning the hanging bay width. `stroke: '#7dd3fc'`, `strokeWidth: u * 0.35`. Not dashed (visually distinct from shelves).
- **Top shelf**: filled rect with a purple tint (`#a78bfa` at 60% opacity), bottom face at `hangingRailHeightFromTop`, spanning hanging bay width
- **Below-rail shelves**: same dashed shelf style as existing shelves, positioned evenly in the below-rail space of the hanging bay
- **Right-side shelves**: same dashed shelf style, spanning right-bay width

### Dimension callout
- A vertical dimension arrow from interior top to rail, labelled `${hangingRailHeightFromTop}mm` — rendered on the right margin of the hanging bay when `hangingRailEnabled=true`

### Assembly notes panel
- When `hangingRailEnabled`: append `"Hanging rail at ${hangingRailHeightFromTop}mm from top"` to assembly steps
- When `hasVerticalDivider`: append `"Vertical divider at ${dividerPositionMm}mm from left"`

---

## 3D Preview (`lib/configurator/render/cupboardThreeModel.ts`)

### Vertical divider
- `BoxGeometry(T, sideHeight, carcassDepth)`
- Same `carcass` finish as side panels
- Positioned at `carcassLeft + dividerPositionMm + T/2` on X-axis, centred vertically in the carcass

### Hanging rail
- `CylinderGeometry(12, 12, bayWidth, 16)` rotated 90° on Z-axis
- Material: `MeshStandardMaterial({ color: '#7dd3fc', roughness: 0.4, metalness: 0.6 })`
- Positioned at Y = `sideTopY - hangingRailHeightFromTop`, X centred in the hanging bay
- Only rendered in both `assembly` and `interior` view modes

### Top shelf
- Same `BoxGeometry` as existing shelf meshes
- `length_mm = leftBayWidth`, positioned with bottom face at `sideTopY - hangingRailHeightFromTop`
- Uses `carcass` finish (no special tint in 3D — purple tint is SVG-only for readability)

### Below-rail shelves + right-side shelves
- Same `BoxGeometry` as existing shelf meshes, positioned in their respective bays at evenly-distributed Y values

---

## Files Changed

| File | Change |
|---|---|
| `lib/configurator/templates/types.ts` | Add 8 new fields; remove `shelfCount`; update `DEFAULT_CUPBOARD_CONFIG` |
| `lib/configurator/templates/cupboardGeometry.ts` | Add `leftBayWidth`, `rightBayWidth` to derived geometry |
| `lib/configurator/templates/cupboard.ts` | Update shelf generation; add divider, top shelf, below-rail, right-shelf parts |
| `lib/configurator/preview/cupboardScene.ts` | Render divider, rail, top shelf, new shelves in SVG front/side views |
| `lib/configurator/render/cupboardThreeModel.ts` | Add divider mesh, rail cylinder, new shelf meshes |
| `components/features/configurator/CupboardForm.tsx` | Move shelves input; add Interior Layout section with toggles |

---

## Verification

```bash
npm run lint
npx tsc --noEmit
```

- Open `/roomcraft` → create a project → place a block → configure it as a cupboard
- Toggle hanging rail ON: preview shows cyan rail line; parts list has no rail entry
- Toggle top shelf ON: purple shelf appears above rail in SVG; "Hanging Top Shelf" appears in parts
- Toggle vertical divider ON: divider panel appears; "Vertical Divider" in parts
- Toggle 3D tab: rail renders as cyan cylinder; divider as panel; shelves in correct bays
- Set all toggles OFF: behaves identically to the current configurator (no regression)
