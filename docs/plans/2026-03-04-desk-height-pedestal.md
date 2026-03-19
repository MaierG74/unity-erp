# Desk-Height Pedestal Configurator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Desk-Height Pedestal" template to the furniture configurator that generates cutlist parts for a topless pedestal box with stacked drawer fronts.

**Architecture:** New template follows the exact same pattern as cupboard/pigeonhole — config interface + defaults in `types.ts`, generator in `pedestal.ts`, registered in `index.ts`, form + preview components, wired into the orchestrator. No DB changes needed.

**Tech Stack:** TypeScript, React, SVG, existing configurator infrastructure.

**Design doc:** `docs/plans/2026-03-04-desk-height-pedestal-design.md`

---

### Task 1: Define PedestalConfig interface and defaults

**Files:**
- Modify: `lib/configurator/templates/types.ts`

**Step 1: Add PedestalConfig interface after PigeonholeConfig**

```typescript
/**
 * Configuration for a parametric desk-height pedestal.
 * No top panel — sides extend up as legs under the desk.
 * Drawer fronts stack vertically: optional pencil drawer at top,
 * N equal standard drawers in the middle, optional filing drawer at bottom.
 */
export interface PedestalConfig {
  /** Overall external width in mm */
  width: number;
  /** Overall external height in mm (including adjusters) */
  height: number;
  /** Overall external depth in mm */
  depth: number;
  /** Board thickness in mm (16, 18, or 25) */
  materialThickness: number;
  /** Number of standard (equal-height) drawers */
  drawerCount: number;
  /** Whether to include a shallow pencil drawer at the top */
  hasPencilDrawer: boolean;
  /** Pencil drawer front height in mm */
  pencilDrawerHeight: number;
  /** Whether to include a deep filing drawer at the bottom */
  hasFilingDrawer: boolean;
  /** Filing drawer front height in mm */
  filingDrawerHeight: number;
  /** Gap between each drawer front in mm */
  drawerGap: number;
  /** Whether the pedestal has a back panel */
  hasBack: boolean;
  /** Back panel thickness in mm (3 for hardboard, 16 for melamine) */
  backMaterialThickness: number;
  /** Adjuster height in mm (space at bottom for levelling feet) */
  adjusterHeight: number;
  /** Shelf setback from back edge in mm */
  shelfSetback: number;
  /** Back panel recess from rear edge of sides in mm (0 = flush) */
  backRecess: number;
  /** Depth of routed slot for back panel in mm */
  backSlotDepth: number;
}
```

**Step 2: Add DEFAULT_PEDESTAL_CONFIG**

```typescript
export const DEFAULT_PEDESTAL_CONFIG: PedestalConfig = {
  width: 400,
  height: 700,
  depth: 590,
  materialThickness: 16,
  drawerCount: 3,
  hasPencilDrawer: true,
  pencilDrawerHeight: 19,
  hasFilingDrawer: false,
  filingDrawerHeight: 390,
  drawerGap: 2,
  hasBack: true,
  backMaterialThickness: 3,
  adjusterHeight: 10,
  shelfSetback: 2,
  backRecess: 0,
  backSlotDepth: 8,
};
```

**Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: PASS — new types don't break anything

**Step 4: Commit**

```bash
git add lib/configurator/templates/types.ts
git commit -m "feat(configurator): add PedestalConfig interface and defaults"
```

---

### Task 2: Create pedestal parts generator

**Files:**
- Create: `lib/configurator/templates/pedestal.ts`

**Step 1: Create the generator file**

```typescript
import type { CutlistPart } from '@/lib/cutlist/types';
import type { PedestalConfig, FurnitureTemplate } from './types';
import { DEFAULT_PEDESTAL_CONFIG } from './types';

/**
 * Generate all cutlist parts for a desk-height pedestal.
 *
 * Assembly (bottom to top):
 *   - Adjusters (levelling feet)
 *   - Base panel spans between sides
 *   - Left Side + Right Side (full height from base to top — no top panel)
 *   - Drawer fronts stack vertically across the full front face
 *   - Back panel (optional)
 *
 * No top panel — sides extend up as legs under the desk surface.
 *
 * Key dimensions:
 *   carcassHeight = H - adjusterHeight
 *   sideHeight = carcassHeight
 *   baseWidth = W - T × 2  (spans between sides)
 *   baseDepth = D - shelfSetback - (hasBack ? BT + backRecess : 0)
 *
 * Drawer front stack (top to bottom):
 *   totalFronts = drawerCount + (hasPencilDrawer ? 1 : 0) + (hasFilingDrawer ? 1 : 0)
 *   totalGaps = (totalFronts - 1) × drawerGap
 *   pencilH = hasPencilDrawer ? pencilDrawerHeight : 0
 *   filingH = hasFilingDrawer ? filingDrawerHeight : 0
 *   standardTotal = carcassHeight - pencilH - filingH - totalGaps
 *   standardH = standardTotal / drawerCount
 *   frontWidth = baseWidth - drawerGap × 2
 */
export function generatePedestalParts(config: PedestalConfig): CutlistPart[] {
  const { width: W, height: H, depth: D, materialThickness: T } = config;
  const { drawerCount, hasPencilDrawer, pencilDrawerHeight, hasFilingDrawer, filingDrawerHeight } = config;
  const { drawerGap, hasBack, backMaterialThickness: BT } = config;
  const { adjusterHeight, shelfSetback, backSlotDepth, backRecess } = config;

  // ── Derived dimensions ──
  const carcassHeight = H - adjusterHeight;
  const sideHeight = carcassHeight;
  const baseWidth = W - T * 2;
  const baseDepth = D - shelfSetback - (hasBack ? BT + backRecess : 0);

  // Validate
  if (sideHeight <= 0 || baseWidth <= 0 || baseDepth <= 0) return [];

  // Drawer front calculations
  const totalFronts = drawerCount + (hasPencilDrawer ? 1 : 0) + (hasFilingDrawer ? 1 : 0);
  const totalGaps = Math.max(0, totalFronts - 1) * drawerGap;
  const pencilH = hasPencilDrawer ? pencilDrawerHeight : 0;
  const filingH = hasFilingDrawer ? filingDrawerHeight : 0;
  const standardTotal = carcassHeight - pencilH - filingH - totalGaps;
  const standardH = drawerCount > 0 ? standardTotal / drawerCount : 0;
  const frontWidth = baseWidth - drawerGap * 2;

  if (frontWidth <= 0) return [];

  const parts: CutlistPart[] = [];
  let counter = 0;
  const nextId = () => `cfg-${++counter}`;

  // ── SIDES ── (full carcass height, front edge banded)
  parts.push({
    id: nextId(),
    name: 'Left Side',
    length_mm: sideHeight,
    width_mm: D,
    quantity: 1,
    grain: 'length',
    band_edges: { top: false, right: true, bottom: false, left: true },
  });

  parts.push({
    id: nextId(),
    name: 'Right Side',
    length_mm: sideHeight,
    width_mm: D,
    quantity: 1,
    grain: 'length',
    band_edges: { top: false, right: true, bottom: false, left: true },
  });

  // ── BASE ── (spans between sides)
  parts.push({
    id: nextId(),
    name: 'Base',
    length_mm: baseWidth,
    width_mm: baseDepth,
    quantity: 1,
    grain: 'length',
    band_edges: { top: true, right: false, bottom: false, left: false },
  });

  // ── BACK PANEL ──
  if (hasBack) {
    const backHeight = sideHeight + backSlotDepth;
    const backWidth = baseWidth;

    if (backHeight > 0 && backWidth > 0) {
      parts.push({
        id: nextId(),
        name: 'Back',
        length_mm: backHeight,
        width_mm: backWidth,
        quantity: 1,
        grain: 'any',
        band_edges: { top: false, right: false, bottom: false, left: false },
      });
    }
  }

  // ── DRAWER FRONTS ──

  // Pencil drawer (top)
  if (hasPencilDrawer && pencilH > 0) {
    parts.push({
      id: nextId(),
      name: 'Pencil Drawer Front',
      length_mm: Math.round(frontWidth),
      width_mm: Math.round(pencilH),
      quantity: 1,
      grain: 'length',
      band_edges: { top: true, right: true, bottom: true, left: true },
    });
  }

  // Standard drawers (middle)
  if (drawerCount > 0 && standardH > 0) {
    parts.push({
      id: nextId(),
      name: drawerCount === 1 ? 'Drawer Front' : 'Drawer Fronts',
      length_mm: Math.round(frontWidth),
      width_mm: Math.round(standardH),
      quantity: drawerCount,
      grain: 'length',
      band_edges: { top: true, right: true, bottom: true, left: true },
    });
  }

  // Filing drawer (bottom)
  if (hasFilingDrawer && filingH > 0) {
    parts.push({
      id: nextId(),
      name: 'Filing Drawer Front',
      length_mm: Math.round(frontWidth),
      width_mm: Math.round(filingH),
      quantity: 1,
      grain: 'length',
      band_edges: { top: true, right: true, bottom: true, left: true },
    });
  }

  return parts;
}

export const pedestalTemplate: FurnitureTemplate<PedestalConfig> = {
  id: 'pedestal',
  name: 'Desk-Height Pedestal',
  description: 'Desk-height pedestal with configurable drawer layout',
  defaultConfig: DEFAULT_PEDESTAL_CONFIG,
  generateParts: generatePedestalParts,
};
```

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add lib/configurator/templates/pedestal.ts
git commit -m "feat(configurator): add desk-height pedestal parts generator"
```

---

### Task 3: Register pedestal template

**Files:**
- Modify: `lib/configurator/templates/index.ts`

**Step 1: Add import and register**

Add import:
```typescript
import { pedestalTemplate } from './pedestal';
```

Add to TEMPLATES:
```typescript
export const TEMPLATES: Record<string, FurnitureTemplate<any>> = {
  cupboard: cupboardTemplate,
  pigeonhole: pigeonholeTemplate,
  pedestal: pedestalTemplate,
};
```

Add to exports:
```typescript
export { DEFAULT_CUPBOARD_CONFIG, DEFAULT_PIGEONHOLE_CONFIG, DEFAULT_PEDESTAL_CONFIG } from './types';
export type { CupboardConfig, PigeonholeConfig, PedestalConfig, FurnitureTemplate } from './types';
```

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add lib/configurator/templates/index.ts
git commit -m "feat(configurator): register pedestal template"
```

---

### Task 4: Create PedestalForm component

**Files:**
- Create: `components/features/configurator/PedestalForm.tsx`

**Context:** Follow the exact pattern of `PigeonholeForm.tsx` — same `NumberInput` local component, same layout structure, same `Collapsible` advanced section. The pedestal form is simpler: no grid (cols/rows), no dimension mode toggle, no doors. Just dims, drawer config, back panel toggle, and advanced section.

**Step 1: Create PedestalForm.tsx**

The form should have these sections:
1. **Dimensions** — W / H / D in a 3-col grid (same as pigeonhole overall mode)
2. **Drawers** — `drawerCount` NumberInput (1-8), `hasPencilDrawer` Switch, `hasFilingDrawer` Switch
3. **Back panel** — `hasBack` Switch + back material Select when on
4. **Advanced** (collapsible) — `adjusterHeight`, `drawerGap`, `shelfSetback`, `backRecess`, `backSlotDepth`, `pencilDrawerHeight`, `filingDrawerHeight`

Copy the `NumberInput` component from PigeonholeForm (it's local to each form file).

Show a summary line under Drawers: e.g. "4 fronts: Pencil (19mm) + 3 × 181mm + Filing (390mm)" — calculated from config so the user can see the split.

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add components/features/configurator/PedestalForm.tsx
git commit -m "feat(configurator): add PedestalForm component"
```

---

### Task 5: Create PedestalPreview component

**Files:**
- Create: `components/features/configurator/PedestalPreview.tsx`

**Context:** Follow the exact pattern of `PigeonholePreview.tsx` — same color palette, same `DimensionH`/`DimensionV`/`PanelLabel` helpers, same zoom/pan/fullscreen infrastructure. The pedestal preview is a **front view only** (no side view needed for v1, but include if straightforward).

**Step 1: Create PedestalPreview.tsx**

Front view should show:
- Two side panels (full height, no top)
- Base panel at bottom (between sides)
- Stacked drawer fronts with gaps between them
- Pencil drawer (if on) at top — thin, different fill to distinguish
- Filing drawer (if on) at bottom — taller, different fill
- Standard drawers in the middle — equal height
- Adjusters at bottom
- Dimension lines: overall W, overall H, depth (as text label)

Side view (right of front view):
- Side panel cross-section (full height)
- Base panel
- Back panel (if on)
- Adjusters
- Dimension lines: overall D, overall H

Use the same zoom/pan/fullscreen toolbar pattern. Use `DimensionH`, `DimensionV`, `PanelLabel` helpers (copied locally, same as PigeonholePreview).

Color scheme additions:
- `DRAWER_FILL = '#dbeafe'` (light blue, same as doors)
- `DRAWER_STROKE = '#3b82f6'`
- `PENCIL_FILL = '#fef3c7'` (light amber to distinguish)
- `FILING_FILL = '#d1fae5'` (light green to distinguish)

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add components/features/configurator/PedestalPreview.tsx
git commit -m "feat(configurator): add PedestalPreview SVG component"
```

---

### Task 6: Wire pedestal into FurnitureConfigurator orchestrator

**Files:**
- Modify: `components/features/configurator/FurnitureConfigurator.tsx`

**Step 1: Add imports**

```typescript
import type { PedestalConfig } from '@/lib/configurator/templates/types';
import { DEFAULT_PEDESTAL_CONFIG } from '@/lib/configurator/templates/types';
import { generatePedestalParts } from '@/lib/configurator/templates/pedestal';
import { PedestalForm } from './PedestalForm';
import { PedestalPreview } from './PedestalPreview';
```

**Step 2: Update TemplateId type**

```typescript
type TemplateId = 'cupboard' | 'pigeonhole' | 'pedestal';
```

**Step 3: Add pedestal state**

Add alongside existing state:
```typescript
const [pedestalConfig, setPedestalConfig] = React.useState<PedestalConfig>(DEFAULT_PEDESTAL_CONFIG);
```

**Step 4: Apply org defaults for pedestal**

In the `useEffect` that applies org defaults, add shared field application for pedestal (same pattern as pigeonhole — materialThickness, backMaterialThickness, adjusterHeight, shelfSetback, backSlotDepth, backRecess).

**Step 5: Update parts generation**

In the `parts` useMemo, add:
```typescript
if (templateId === 'pedestal') return generatePedestalParts(pedestalConfig);
```

**Step 6: Update activeConfig**

```typescript
const activeConfig = templateId === 'cupboard' ? cupboardConfig : templateId === 'pigeonhole' ? pigeonholeConfig : pedestalConfig;
```

**Step 7: Add form rendering**

```typescript
{templateId === 'pedestal' && (
  <PedestalForm config={pedestalConfig} onChange={setPedestalConfig} />
)}
```

**Step 8: Add preview rendering**

```typescript
{templateId === 'pedestal' && <PedestalPreview config={pedestalConfig} />}
```

**Step 9: Verify**

Run: `npx tsc --noEmit`
Run: `npm run lint`
Expected: PASS

**Step 10: Commit**

```bash
git add components/features/configurator/FurnitureConfigurator.tsx
git commit -m "feat(configurator): wire pedestal template into orchestrator"
```

---

### Task 7: Visual verification and polish

**Step 1: Open the configurator in the browser**

Navigate to `localhost:3000/products/{any-product-id}/configurator` and select "Desk-Height Pedestal" from the template dropdown.

**Step 2: Verify the form**

- Default values: 400 × 700 × 590, 3 drawers, pencil drawer on
- Changing drawer count updates the parts table
- Toggling pencil/filing drawer updates parts table and preview
- Advanced section collapses/expands

**Step 3: Verify the preview**

- Front view shows carcass with stacked drawer fronts
- Dimension lines show correct values
- Zoom/pan/fullscreen work

**Step 4: Verify parts table**

- Parts: Left Side, Right Side, Base, Back, Pencil Drawer Front, Drawer Fronts (×3)
- Dimensions make sense for 400 × 700 × 590
- Edge banding popover works on each part

**Step 5: Test save flow**

- Click "Save to Product" — should succeed
- Click "Save & Open Cutlist Builder" — should save and navigate

**Step 6: Fix any visual issues found during testing**

**Step 7: Commit any polish fixes**

```bash
git commit -m "fix(configurator): polish pedestal template after visual review"
```
