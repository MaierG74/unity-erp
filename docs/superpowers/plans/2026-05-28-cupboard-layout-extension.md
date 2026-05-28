# Cupboard Interior Layout Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `CupboardConfig` with hanging rail, vertical divider, and bay-specific shelf fields — updating the cutlist generator, SVG technical preview, 3D model, and form UI.

**Architecture:** Flat new fields on `CupboardConfig` replace `shelfCount` with `leftShelfCount`/`rightShelfCount` and add 6 new fields for the hanging bay and divider. All changes are self-contained to 6 files; no DB migrations or API changes needed. The hanging rail is visual-only (no cutlist part).

**Tech Stack:** TypeScript, Three.js (3D model), SVG (technical preview), React (form). Tests use Node.js built-in `node:test` runner via `npx tsx --test`.

---

## File Map

| File | Change |
|---|---|
| `lib/configurator/templates/types.ts` | Remove `shelfCount`; add 8 new fields + update defaults |
| `lib/configurator/templates/cupboardGeometry.ts` | Add `leftBayWidth`, `rightBayWidth` to derived geometry |
| `lib/configurator/templates/cupboard.ts` | Update shelf generation; add divider, top shelf, below-rail, right-shelf parts |
| `tests/configurator-cupboard-layout.test.ts` | New test file — cutlist correctness for all new layout combinations |
| `lib/configurator/preview/cupboardScene.ts` | Render divider, rail, top shelf, bay shelves in SVG front view |
| `lib/configurator/render/cupboardThreeModel.ts` | Add divider mesh, rail cylinder, new shelf meshes |
| `components/features/configurator/CupboardForm.tsx` | Move shelves input; add Interior Layout section |

---

## Task 1: Update CupboardConfig types

**Files:**
- Modify: `lib/configurator/templates/types.ts`

- [ ] **Step 1: Replace `shelfCount` with new fields in the `CupboardConfig` interface**

Open `lib/configurator/templates/types.ts`. Find the `shelfCount` line and replace it and add the new fields so the interface reads:

```typescript
/** Number of evenly-spaced shelves in the left bay (full-width when no divider) */
leftShelfCount: number;
/** Number of evenly-spaced shelves in the right bay — only used when hasVerticalDivider=true */
rightShelfCount: number;
/** Whether a hanging rail is present */
hangingRailEnabled: boolean;
/** Distance from interior top face to rail centreline in mm */
hangingRailHeightFromTop: number;
/** Whether a shelf is placed with its bottom face at hangingRailHeightFromTop */
hangingTopShelf: boolean;
/** Number of shelves evenly distributed below the rail in the hanging bay */
hangingBelowShelfCount: number;
/** Whether a vertical divider panel is present */
hasVerticalDivider: boolean;
/** Distance from left inner edge to divider panel face in mm */
dividerPositionMm: number;
```

Remove the old `/** Number of fixed shelves (0-10) */ shelfCount: number;` line entirely.

- [ ] **Step 2: Update `DEFAULT_CUPBOARD_CONFIG`**

Remove `shelfCount: 3` and add:

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

- [ ] **Step 3: Verify TypeScript compilation catches all consumers of the removed `shelfCount`**

```bash
npx tsc --noEmit 2>&1 | grep shelfCount
```

Expected: errors listing every file that still references `shelfCount`. You will fix each one in subsequent tasks. If there are zero errors, double-check you actually removed the field.

- [ ] **Step 4: Commit**

```bash
git add lib/configurator/templates/types.ts
git commit -m "feat(configurator): replace shelfCount with leftShelfCount + interior layout fields"
```

---

## Task 2: Add derived bay widths to cupboardGeometry

**Files:**
- Modify: `lib/configurator/templates/cupboardGeometry.ts`

- [ ] **Step 1: Add `leftBayWidth` and `rightBayWidth` to the `CupboardDerivedGeometry` interface**

Add at the end of the interface (before the closing `}`):

```typescript
leftBayWidth: number;
rightBayWidth: number;
```

- [ ] **Step 2: Compute the new values in `deriveCupboardGeometry`**

At the top of the function, destructure the two new config fields:

```typescript
const {
  // ... existing destructuring ...
  hasVerticalDivider,
  dividerPositionMm,
} = config;
```

Then, after the line that computes `shelfDepth`, add:

```typescript
const leftBayWidth = hasVerticalDivider ? dividerPositionMm : internalWidth;
const rightBayWidth = hasVerticalDivider
  ? Math.max(0, internalWidth - dividerPositionMm - T)
  : 0;
```

- [ ] **Step 3: Add the new fields to the return object**

In the `return { ... }` block, add:

```typescript
leftBayWidth,
rightBayWidth,
```

- [ ] **Step 4: Verify no TypeScript errors**

```bash
npx tsc --noEmit 2>&1 | grep cupboardGeometry
```

Expected: no errors for this file.

- [ ] **Step 5: Commit**

```bash
git add lib/configurator/templates/cupboardGeometry.ts
git commit -m "feat(configurator): add leftBayWidth and rightBayWidth to derived cupboard geometry"
```

---

## Task 3: Write failing tests for new cutlist parts

**Files:**
- Create: `tests/configurator-cupboard-layout.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateCupboardParts } from '../lib/configurator/templates/cupboard';
import { DEFAULT_CUPBOARD_CONFIG } from '../lib/configurator/templates/types';
import type { CupboardConfig } from '../lib/configurator/templates/types';

function cfg(overrides: Partial<CupboardConfig>): CupboardConfig {
  return { ...DEFAULT_CUPBOARD_CONFIG, ...overrides };
}

function partNames(config: CupboardConfig): string[] {
  return generateCupboardParts(config).map((p) => p.name);
}

function partByName(config: CupboardConfig, name: string) {
  return generateCupboardParts(config).find((p) => p.name === name);
}

describe('generateCupboardParts — interior layout', () => {
  it('standard config: generates leftShelfCount full-width shelves', () => {
    const parts = generateCupboardParts(cfg({ leftShelfCount: 3 }));
    const shelves = parts.find((p) => p.name === 'Shelves');
    assert.ok(shelves, 'should have Shelves part');
    assert.equal(shelves!.quantity, 3);
    assert.equal(shelves!.length_mm, DEFAULT_CUPBOARD_CONFIG.width - DEFAULT_CUPBOARD_CONFIG.materialThickness * 4);
  });

  it('standard config: no hanging or divider parts', () => {
    const names = partNames(cfg({ leftShelfCount: 2 }));
    assert.ok(!names.includes('Vertical Divider'), 'no divider');
    assert.ok(!names.includes('Hanging Rail'), 'no hanging rail part');
    assert.ok(!names.includes('Hanging Top Shelf'), 'no top shelf');
  });

  it('hanging rail: generates no cutlist part for the rail itself', () => {
    const names = partNames(cfg({ hangingRailEnabled: true }));
    assert.ok(!names.some((n) => n.toLowerCase().includes('rail')), 'rail must not appear in parts');
  });

  it('hangingTopShelf: generates "Hanging Top Shelf" part', () => {
    const names = partNames(cfg({ hangingRailEnabled: true, hangingTopShelf: true }));
    assert.ok(names.includes('Hanging Top Shelf'), 'should have Hanging Top Shelf');
  });

  it('hangingTopShelf: part has correct width (full internalWidth when no divider)', () => {
    const config = cfg({ hangingRailEnabled: true, hangingTopShelf: true });
    const part = partByName(config, 'Hanging Top Shelf');
    const T = config.materialThickness;
    const expectedWidth = config.width - T * 4; // internalWidth for default overhangs
    assert.equal(part!.length_mm, expectedWidth);
    assert.equal(part!.quantity, 1);
  });

  it('hangingBelowShelfCount=2: generates "Hanging Bay Shelves" with quantity 2', () => {
    const names = partNames(cfg({ hangingRailEnabled: true, hangingBelowShelfCount: 2 }));
    assert.ok(names.includes('Hanging Bay Shelves'), 'should have Hanging Bay Shelves');
    const part = partByName(cfg({ hangingRailEnabled: true, hangingBelowShelfCount: 2 }), 'Hanging Bay Shelves');
    assert.equal(part!.quantity, 2);
  });

  it('hangingBelowShelfCount=1: name is singular "Hanging Bay Shelf"', () => {
    const names = partNames(cfg({ hangingRailEnabled: true, hangingBelowShelfCount: 1 }));
    assert.ok(names.includes('Hanging Bay Shelf'), 'singular name for 1 shelf');
  });

  it('hasVerticalDivider: generates "Vertical Divider" part', () => {
    const names = partNames(cfg({ hasVerticalDivider: true }));
    assert.ok(names.includes('Vertical Divider'), 'should have Vertical Divider');
  });

  it('vertical divider: part has sideHeight and carcassDepth dimensions', () => {
    const config = cfg({ hasVerticalDivider: true });
    const part = partByName(config, 'Vertical Divider');
    const T = config.materialThickness;
    // sideHeight = H - adjusterHeight - topThickness - baseThickness
    // DEFAULT: 1800 - 10 - 32 - 32 = 1726
    assert.ok(part!.length_mm > 0, 'divider has positive height');
    assert.ok(part!.width_mm > 0, 'divider has positive depth');
    assert.equal(part!.quantity, 1);
    assert.deepEqual(part!.band_edges, { top: false, right: true, bottom: false, left: false });
  });

  it('hasVerticalDivider + rightShelfCount=3: generates "Right Shelves" with quantity 3', () => {
    const config = cfg({ hasVerticalDivider: true, rightShelfCount: 3 });
    const part = partByName(config, 'Right Shelves');
    assert.ok(part, 'should have Right Shelves');
    assert.equal(part!.quantity, 3);
  });

  it('rightShelfCount=1: name is singular "Right Shelf"', () => {
    const names = partNames(cfg({ hasVerticalDivider: true, rightShelfCount: 1 }));
    assert.ok(names.includes('Right Shelf'), 'singular name');
  });

  it('right shelves width = internalWidth - dividerPositionMm - T', () => {
    const config = cfg({ hasVerticalDivider: true, dividerPositionMm: 400, rightShelfCount: 2 });
    const part = partByName(config, 'Right Shelves');
    const T = config.materialThickness;
    // internalWidth = carcassWidth - T*2; carcassWidth = width - maxOverhang*2 = 900 - 20 = 880; internalWidth = 848
    const internalWidth = config.width - config.materialThickness * 4; // simplified for default overhangs
    const expectedWidth = internalWidth - config.dividerPositionMm - T;
    assert.equal(part!.length_mm, expectedWidth);
  });

  it('no divider + no hanging: zero-shelf config generates no shelf parts', () => {
    const names = partNames(cfg({ leftShelfCount: 0 }));
    assert.ok(!names.includes('Shelf'), 'no shelf');
    assert.ok(!names.includes('Shelves'), 'no shelves');
  });

  it('divider with hanging: top shelf uses leftBayWidth not internalWidth', () => {
    const config = cfg({
      hasVerticalDivider: true,
      dividerPositionMm: 450,
      hangingRailEnabled: true,
      hangingTopShelf: true,
    });
    const part = partByName(config, 'Hanging Top Shelf');
    assert.ok(part, 'should have top shelf');
    assert.equal(part!.length_mm, 450, 'top shelf width = dividerPositionMm');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they all fail**

```bash
npx tsx --test tests/configurator-cupboard-layout.test.ts 2>&1 | tail -20
```

Expected: multiple failures — `shelfCount` removed so `generateCupboardParts` won't compile yet.

---

## Task 4: Update cupboard.ts cutlist generation

**Files:**
- Modify: `lib/configurator/templates/cupboard.ts`

- [ ] **Step 1: Update destructuring — replace `shelfCount` with new fields**

Find the destructuring block near the top of `generateCupboardParts` and replace it:

```typescript
const {
  materialThickness: T,
  leftShelfCount,
  rightShelfCount,
  doorStyle,
  hasBack,
  topConstruction,
  baseConstruction,
  hangingRailEnabled,
  hangingTopShelf,
  hangingBelowShelfCount,
  hasVerticalDivider,
} = config;
const { doorGap, backSlotDepth, hangingRailHeightFromTop, dividerPositionMm } = config;
```

- [ ] **Step 2: Update geometry destructuring — add new derived fields**

In the `deriveCupboardGeometry` destructuring, add:

```typescript
const {
  valid,
  carcassWidth,
  carcassDepth,
  sideHeight,
  internalWidth,
  topWidth,
  topDepth,
  baseWidth,
  baseDepth,
  shelfDepth,
  baseCleatWidth,
  leftBayWidth,
  rightBayWidth,
} = deriveCupboardGeometry(config);
```

- [ ] **Step 3: Update the existing shelves block**

Find the `// ── SHELVES ──` block. Replace it entirely:

```typescript
// ── SHELVES (left bay / full-width) ──
if (leftShelfCount > 0 && shelfDepth > 0 && leftBayWidth > 0) {
  parts.push({
    id: nextId(),
    name: leftShelfCount === 1 ? 'Shelf' : 'Shelves',
    length_mm: leftBayWidth,
    width_mm: shelfDepth,
    quantity: leftShelfCount,
    grain: 'length',
    band_edges: { top: true, right: false, bottom: false, left: false },
  });
}
```

- [ ] **Step 4: Add vertical divider**

After the shelves block, add:

```typescript
// ── VERTICAL DIVIDER ──
if (hasVerticalDivider && sideHeight > 0 && carcassDepth > 0) {
  parts.push({
    id: nextId(),
    name: 'Vertical Divider',
    length_mm: sideHeight,
    width_mm: carcassDepth,
    quantity: 1,
    grain: 'length',
    band_edges: { top: false, right: true, bottom: false, left: false },
  });
}
```

- [ ] **Step 5: Add hanging top shelf**

```typescript
// ── HANGING TOP SHELF ──
if (hangingRailEnabled && hangingTopShelf && shelfDepth > 0 && leftBayWidth > 0) {
  parts.push({
    id: nextId(),
    name: 'Hanging Top Shelf',
    length_mm: leftBayWidth,
    width_mm: shelfDepth,
    quantity: 1,
    grain: 'length',
    band_edges: { top: true, right: false, bottom: false, left: false },
  });
}
```

- [ ] **Step 6: Add shelves below rail**

```typescript
// ── HANGING BAY SHELVES (below rail) ──
if (hangingRailEnabled && hangingBelowShelfCount > 0 && shelfDepth > 0 && leftBayWidth > 0) {
  parts.push({
    id: nextId(),
    name: hangingBelowShelfCount === 1 ? 'Hanging Bay Shelf' : 'Hanging Bay Shelves',
    length_mm: leftBayWidth,
    width_mm: shelfDepth,
    quantity: hangingBelowShelfCount,
    grain: 'length',
    band_edges: { top: true, right: false, bottom: false, left: false },
  });
}
```

- [ ] **Step 7: Add right-side shelves**

```typescript
// ── RIGHT-SIDE SHELVES ──
if (hasVerticalDivider && rightShelfCount > 0 && shelfDepth > 0 && rightBayWidth > 0) {
  parts.push({
    id: nextId(),
    name: rightShelfCount === 1 ? 'Right Shelf' : 'Right Shelves',
    length_mm: rightBayWidth,
    width_mm: shelfDepth,
    quantity: rightShelfCount,
    grain: 'length',
    band_edges: { top: true, right: false, bottom: false, left: false },
  });
}
```

- [ ] **Step 8: Run tests and confirm they pass**

```bash
npx tsx --test tests/configurator-cupboard-layout.test.ts 2>&1
```

Expected: all tests pass. If any fail, check the `internalWidth` calculation in the geometry — the test uses `config.width - config.materialThickness * 4` as a simplified check; verify that the actual derived value matches.

- [ ] **Step 9: Commit**

```bash
git add lib/configurator/templates/cupboard.ts tests/configurator-cupboard-layout.test.ts
git commit -m "feat(configurator): update cupboard cutlist for interior layout — divider, rail shelves, bay shelves"
```

---

## Task 5: Update CupboardForm

**Files:**
- Modify: `components/features/configurator/CupboardForm.tsx`

- [ ] **Step 1: Remove the "Shelves" input from the Construction section**

In the `Construction` section's 3-col grid (the one with Board, Shelves, Doors), remove the Shelves `<div>` entirely:

```tsx
// DELETE this block from the 3-col grid:
<div className="space-y-1">
  <Label htmlFor="cfg-shelves" className="text-xs text-muted-foreground">Shelves</Label>
  <NumberInput id="cfg-shelves" value={config.shelfCount} min={0} max={10} onChange={(v) => update({ shelfCount: v })} />
</div>
```

The grid becomes 2-col (Board + Doors). Change `grid-cols-3` to `grid-cols-2` on that row.

- [ ] **Step 2: Add the "Interior Layout" section between Construction and Back Panel**

Insert this new `<div>` block after the closing `</div>` of the Construction section and before the Back Panel section:

```tsx
{/* Interior Layout */}
<div>
  <h3 className="text-sm font-medium text-foreground mb-2">Interior Layout</h3>

  {/* Hanging Rail */}
  <div className="flex items-center justify-between mb-1">
    <Label className="text-sm font-medium">Hanging Rail</Label>
    <Switch
      id="cfg-hanging-rail"
      checked={config.hangingRailEnabled}
      onCheckedChange={(v) => update({ hangingRailEnabled: v })}
    />
  </div>
  {config.hangingRailEnabled && (
    <div className="ml-3 border-l-2 border-blue-800 pl-3 mb-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="cfg-rail-height" className="text-xs text-muted-foreground">
            Rail from top (mm)
          </Label>
          <NumberInput
            id="cfg-rail-height"
            value={config.hangingRailHeightFromTop}
            min={50}
            max={2500}
            onChange={(v) => update({ hangingRailHeightFromTop: v })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cfg-below-shelves" className="text-xs text-muted-foreground">
            Shelves below rail
          </Label>
          <NumberInput
            id="cfg-below-shelves"
            value={config.hangingBelowShelfCount}
            min={0}
            max={8}
            onChange={(v) => update({ hangingBelowShelfCount: v })}
          />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="cfg-top-shelf" className="text-xs text-muted-foreground">
          Top shelf above rail
        </Label>
        <Switch
          id="cfg-top-shelf"
          checked={config.hangingTopShelf}
          onCheckedChange={(v) => update({ hangingTopShelf: v })}
        />
      </div>
    </div>
  )}

  {/* Vertical Divider */}
  <div className="flex items-center justify-between mb-1">
    <Label className="text-sm font-medium">Vertical Divider</Label>
    <Switch
      id="cfg-divider"
      checked={config.hasVerticalDivider}
      onCheckedChange={(v) => update({ hasVerticalDivider: v })}
    />
  </div>
  {config.hasVerticalDivider && (
    <div className="ml-3 border-l-2 border-blue-800 pl-3 mb-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="cfg-divider-pos" className="text-xs text-muted-foreground">
            Divider from left (mm)
          </Label>
          <NumberInput
            id="cfg-divider-pos"
            value={config.dividerPositionMm}
            min={config.materialThickness * 2}
            max={2500}
            onChange={(v) => update({ dividerPositionMm: v })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cfg-right-shelves" className="text-xs text-muted-foreground">
            Right shelves
          </Label>
          <NumberInput
            id="cfg-right-shelves"
            value={config.rightShelfCount}
            min={0}
            max={10}
            onChange={(v) => update({ rightShelfCount: v })}
          />
        </div>
      </div>
    </div>
  )}

  {/* Left / full-width shelves */}
  <div className="space-y-1">
    <Label htmlFor="cfg-left-shelves" className="text-xs text-muted-foreground">
      {config.hasVerticalDivider ? 'Left shelves' : 'Shelves'}
    </Label>
    <NumberInput
      id="cfg-left-shelves"
      value={config.leftShelfCount}
      min={0}
      max={10}
      onChange={(v) => update({ leftShelfCount: v })}
    />
  </div>
</div>
```

- [ ] **Step 3: Run TypeScript check on this file**

```bash
npx tsc --noEmit 2>&1 | grep CupboardForm
```

Expected: no errors.

- [ ] **Step 4: Run lint**

```bash
npm run lint -- --quiet 2>&1 | grep CupboardForm
```

Expected: no errors (warnings about `<img>` in other files are pre-existing, ignore them).

- [ ] **Step 5: Commit**

```bash
git add components/features/configurator/CupboardForm.tsx
git commit -m "feat(configurator): add Interior Layout section to CupboardForm"
```

---

## Task 6: Update SVG technical preview

**Files:**
- Modify: `lib/configurator/preview/cupboardScene.ts`

- [ ] **Step 1: Replace `shelfCount` references with `leftShelfCount`**

In `buildCupboardPreviewScene`, the destructuring pulls `shelfCount` from `config`. Replace with:

```typescript
const {
  // ... existing fields ...
  leftShelfCount,
  rightShelfCount,
  hangingRailEnabled,
  hangingRailHeightFromTop,
  hangingTopShelf,
  hangingBelowShelfCount,
  hasVerticalDivider,
  dividerPositionMm,
} = config;
```

Replace every reference to `shelfCount` in the function body with `leftShelfCount`. These occur in:
- The `shelfPositions` calculation block
- The assembly steps text (e.g., `` `${shelfCount} shelves` ``)

- [ ] **Step 2: Add derived bay widths**

After the `deriveCupboardGeometry` call, destructure the new fields:

```typescript
const {
  // ... existing ...
  leftBayWidth,
  rightBayWidth,
} = deriveCupboardGeometry(config);
```

- [ ] **Step 3: Limit existing shelf positions to left bay width**

The `shelfPositions` are used to draw shelf rects in the front view. Each shelf rect currently spans from `sideLeftInnerX` to `sideRightInnerX`. When `hasVerticalDivider` is true, limit the shelf width:

```typescript
// In the front view shelf rendering loop:
shelfPositions.forEach((shelfY, index) => {
  const shelfRightX = hasVerticalDivider
    ? sideLeftInnerX + leftBayWidth
    : sideRightInnerX;
  nodes.push(
    {
      type: 'rect',
      x: sideLeftInnerX,
      y: shelfY - T / 2,
      width: shelfRightX - sideLeftInnerX,
      // ... rest unchanged
    },
    // ... label unchanged
  );
});
```

Apply the same `shelfRightX` limit in the side-view shelf loop (the side view renders shelf depth, not width, so no change needed there).

- [ ] **Step 4: Add vertical divider to front view**

After the base rect nodes, add:

```typescript
if (hasVerticalDivider) {
  const dividerX = sideLeftInnerX + dividerPositionMm;
  nodes.push({
    type: 'rect',
    x: dividerX,
    y: topBottomY,
    width: T,
    height: sideHeight,
    fill: TECHNICAL_PREVIEW_COLORS.panelFill,
    stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
    strokeWidth: u * 0.1,
    meta: frontMeta('divider', 'divider'),
  });
  // Dimension callout below
  push(
    ...createHorizontalDimension({
      x1: sideLeftInnerX,
      x2: dividerX,
      y: sideBottomY + baseThickness + u * 0.8,
      label: `${dividerPositionMm}`,
      side: 'below',
      unit: u * 0.65,
      meta: frontMeta(undefined, 'dimension'),
    })
  );
}
```

- [ ] **Step 5: Add hanging rail to front view**

After the divider block, add:

```typescript
if (hangingRailEnabled) {
  const railY = topBottomY + hangingRailHeightFromTop;
  const railRightX = sideLeftInnerX + leftBayWidth;
  nodes.push({
    type: 'line',
    x1: sideLeftInnerX,
    y1: railY,
    x2: railRightX,
    y2: railY,
    stroke: '#7dd3fc',
    strokeWidth: u * 0.35,
    meta: frontMeta('hanging-rail', 'hanging-rail'),
  });
  // Vertical dimension: top interior to rail
  push(
    ...createVerticalDimension({
      y1: topBottomY,
      y2: railY,
      x: railRightX + u * 0.6,
      label: `${hangingRailHeightFromTop}`,
      side: 'right',
      unit: u * 0.65,
      meta: frontMeta(undefined, 'dimension'),
    })
  );
}
```

- [ ] **Step 6: Add hanging top shelf to front view**

```typescript
if (hangingRailEnabled && hangingTopShelf) {
  const shelfBottomY = topBottomY + hangingRailHeightFromTop - T;
  const shelfRightX = sideLeftInnerX + leftBayWidth;
  nodes.push({
    type: 'rect',
    x: sideLeftInnerX,
    y: shelfBottomY,
    width: shelfRightX - sideLeftInnerX,
    height: T,
    fill: '#a78bfa',
    fillOpacity: 0.6,
    stroke: TECHNICAL_PREVIEW_COLORS.panelStroke,
    strokeWidth: u * 0.1,
    meta: frontMeta('hanging-top-shelf', 'shelf'),
  });
}
```

- [ ] **Step 7: Add below-rail shelves to front view**

```typescript
if (hangingRailEnabled && hangingBelowShelfCount > 0) {
  const railY = topBottomY + hangingRailHeightFromTop;
  const belowHeight = sideBottomY - railY;
  const shelfRightX = sideLeftInnerX + leftBayWidth;
  for (let i = 1; i <= hangingBelowShelfCount; i++) {
    const shelfY = railY + (belowHeight * i) / (hangingBelowShelfCount + 1);
    nodes.push({
      type: 'rect',
      x: sideLeftInnerX,
      y: shelfY - T / 2,
      width: shelfRightX - sideLeftInnerX,
      height: T,
      fill: TECHNICAL_PREVIEW_COLORS.panelFill,
      stroke: TECHNICAL_PREVIEW_COLORS.shelfStroke,
      strokeWidth: u * 0.1,
      dashArray: `${u * 0.4},${u * 0.2}`,
      meta: frontMeta(`hanging-shelf-${i}`, 'shelf'),
    });
  }
}
```

- [ ] **Step 8: Add right-side shelves to front view**

```typescript
if (hasVerticalDivider && rightShelfCount > 0 && rightBayWidth > 0) {
  const dividerRightX = sideLeftInnerX + dividerPositionMm + T;
  for (let i = 1; i <= rightShelfCount; i++) {
    const shelfY = topBottomY + (sideHeight * i) / (rightShelfCount + 1);
    nodes.push({
      type: 'rect',
      x: dividerRightX,
      y: shelfY - T / 2,
      width: rightBayWidth,
      height: T,
      fill: TECHNICAL_PREVIEW_COLORS.panelFill,
      stroke: TECHNICAL_PREVIEW_COLORS.shelfStroke,
      strokeWidth: u * 0.1,
      dashArray: `${u * 0.4},${u * 0.2}`,
      meta: frontMeta(`right-shelf-${i}`, 'shelf'),
    });
  }
}
```

- [ ] **Step 9: Update assembly notes**

In the `assemblySteps` array, update the shelf step:

```typescript
const assemblySteps = [
  baseConstruction === 'cleated' ? '1. Cleated base on adjusters' : '1. Base on adjusters',
  '2. Sides onto base',
  hasVerticalDivider
    ? `3. Vertical divider at ${dividerPositionMm}mm from left`
    : leftShelfCount > 0
      ? `3. ${leftShelfCount} ${leftShelfCount === 1 ? 'shelf' : 'shelves'} between sides`
      : '3. Open carcass',
  hasBack ? `4. ${rounded(BT)}mm back from rear onto base` : '4. No back panel',
  hasBack ? `5. Top down, capture ${rounded(backSlotDepth)}mm` : '5. Top closes carcass',
  ...(hangingRailEnabled ? [`6. Hanging rail at ${hangingRailHeightFromTop}mm from top`] : []),
];
```

- [ ] **Step 10: Run TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep cupboardScene
```

Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add lib/configurator/preview/cupboardScene.ts
git commit -m "feat(configurator): update SVG preview for hanging rail, divider, and bay shelves"
```

---

## Task 7: Update 3D model

**Files:**
- Modify: `lib/configurator/render/cupboardThreeModel.ts`

- [ ] **Step 1: Replace `shelfCount` in config destructuring**

Find the destructuring block inside `buildCupboardModel` (around line 290) that reads:

```typescript
const {
  materialThickness: T,
  baseConstruction,
  shelfCount,
  doorStyle,
  ...
} = config;
```

Replace `shelfCount` with the new fields:

```typescript
const {
  materialThickness: T,
  baseConstruction,
  leftShelfCount,
  rightShelfCount,
  hangingRailEnabled,
  hangingRailHeightFromTop,
  hangingTopShelf,
  hangingBelowShelfCount,
  hasVerticalDivider,
  dividerPositionMm,
  doorStyle,
  hasBack,
  backMaterialThickness: BT,
  doorGap,
  backSlotDepth,
  backRecess,
  adjusterHeight,
} = config;
```

- [ ] **Step 2: Add `leftBayWidth` and `rightBayWidth` to the derived geometry destructuring**

In the `const { carcassWidth, ... } = derived;` block, add:

```typescript
leftBayWidth,
rightBayWidth,
```

- [ ] **Step 3: Update existing shelf loop**

Find the shelf loop (around line 479):

```typescript
if (shelfCount > 0 && shelfDepth > 0) {
  for (let index = 1; index <= shelfCount; index += 1) {
    const y = sideBottomY + (sideHeight * index) / (shelfCount + 1);
    const shelf = createPanelMesh({
      name: `Shelf ${index}`,
      width: internalWidth,
      ...
    });
    shelf.position.set(0, y, carcassFront + shelfDepth / 2);
    root.add(shelf);
  }
}
```

Replace with:

```typescript
if (leftShelfCount > 0 && shelfDepth > 0 && leftBayWidth > 0) {
  const leftBayCentreX = carcassLeft + T + leftBayWidth / 2;
  for (let index = 1; index <= leftShelfCount; index += 1) {
    const y = sideBottomY + (sideHeight * index) / (leftShelfCount + 1);
    const shelf = createPanelMesh({
      name: `Shelf ${index}`,
      width: leftBayWidth,
      height: T,
      depth: shelfDepth,
      color: COLORS.shell,
      finish: palette.carcass,
      thicknessAxis: 'y',
      opacity: 1,
      userData: { partRole: 'shelf', shelfIndex: index },
    });
    shelf.position.set(leftBayCentreX, y, carcassFront + shelfDepth / 2);
    root.add(shelf);
  }
}
```

- [ ] **Step 4: Add vertical divider mesh**

After the shelf loop, add:

```typescript
if (hasVerticalDivider) {
  const divider = createPanelMesh({
    name: 'Vertical Divider',
    width: T,
    height: sideHeight,
    depth: carcassDepth,
    color: COLORS.shell,
    finish: palette.carcass,
    thicknessAxis: 'x',
    opacity: 1,
    userData: { partRole: 'divider' },
  });
  divider.position.set(
    carcassLeft + T + dividerPositionMm + T / 2,
    sideBottomY + sideHeight / 2,
    (carcassFront + carcassBack) / 2
  );
  root.add(divider);
}
```

- [ ] **Step 5: Add hanging rail cylinder**

```typescript
if (hangingRailEnabled) {
  const railY = sideTopY - hangingRailHeightFromTop;
  const leftBayCentreX = carcassLeft + T + leftBayWidth / 2;
  const railGeometry = new THREE.CylinderGeometry(12, 12, leftBayWidth, 16);
  const railMaterial = new THREE.MeshStandardMaterial({
    color: '#7dd3fc',
    roughness: 0.4,
    metalness: 0.7,
  });
  const railMesh = new THREE.Mesh(railGeometry, railMaterial);
  railMesh.name = 'Hanging Rail Mesh';
  railMesh.rotation.z = Math.PI / 2;

  const railGroup = new THREE.Group();
  railGroup.name = 'Hanging Rail';
  railGroup.userData = { partRole: 'hanging-rail' };
  railGroup.add(railMesh);
  railGroup.position.set(leftBayCentreX, railY, carcassFront + shelfDepth * 0.35);
  root.add(railGroup);
}
```

- [ ] **Step 6: Add hanging top shelf mesh**

```typescript
if (hangingRailEnabled && hangingTopShelf && shelfDepth > 0) {
  const shelfBottomY = sideTopY - hangingRailHeightFromTop;
  const leftBayCentreX = carcassLeft + T + leftBayWidth / 2;
  const topShelf = createPanelMesh({
    name: 'Hanging Top Shelf',
    width: leftBayWidth,
    height: T,
    depth: shelfDepth,
    color: COLORS.shell,
    finish: palette.carcass,
    thicknessAxis: 'y',
    opacity: 1,
    userData: { partRole: 'shelf', shelfType: 'hanging-top' },
  });
  topShelf.position.set(leftBayCentreX, shelfBottomY + T / 2, carcassFront + shelfDepth / 2);
  root.add(topShelf);
}
```

- [ ] **Step 7: Add below-rail shelves**

```typescript
if (hangingRailEnabled && hangingBelowShelfCount > 0 && shelfDepth > 0) {
  const railY = sideTopY - hangingRailHeightFromTop;
  const belowHeight = railY - sideBottomY;
  const leftBayCentreX = carcassLeft + T + leftBayWidth / 2;
  for (let i = 1; i <= hangingBelowShelfCount; i++) {
    const y = sideBottomY + (belowHeight * i) / (hangingBelowShelfCount + 1);
    const shelf = createPanelMesh({
      name: `Hanging Bay Shelf ${i}`,
      width: leftBayWidth,
      height: T,
      depth: shelfDepth,
      color: COLORS.shell,
      finish: palette.carcass,
      thicknessAxis: 'y',
      opacity: 1,
      userData: { partRole: 'shelf', shelfType: 'hanging-below', shelfIndex: i },
    });
    shelf.position.set(leftBayCentreX, y, carcassFront + shelfDepth / 2);
    root.add(shelf);
  }
}
```

- [ ] **Step 8: Add right-side shelves**

```typescript
if (hasVerticalDivider && rightShelfCount > 0 && rightBayWidth > 0 && shelfDepth > 0) {
  const rightBayCentreX = carcassLeft + T + dividerPositionMm + T + rightBayWidth / 2;
  for (let i = 1; i <= rightShelfCount; i++) {
    const y = sideBottomY + (sideHeight * i) / (rightShelfCount + 1);
    const shelf = createPanelMesh({
      name: `Right Shelf ${i}`,
      width: rightBayWidth,
      height: T,
      depth: shelfDepth,
      color: COLORS.shell,
      finish: palette.carcass,
      thicknessAxis: 'y',
      opacity: 1,
      userData: { partRole: 'shelf', shelfType: 'right', shelfIndex: i },
    });
    shelf.position.set(rightBayCentreX, y, carcassFront + shelfDepth / 2);
    root.add(shelf);
  }
}
```

- [ ] **Step 9: Verify full TypeScript build**

```bash
npx tsc --noEmit 2>&1 | grep -v "validator.ts\|todos\|suppliers\|quotes\|me/profile\|overhead"
```

Expected: no errors in the files we changed. (The pre-existing errors in `todos`, `suppliers`, `quotes`, `me/profile`, and `overhead` routes can be ignored — they existed before this task.)

- [ ] **Step 10: Run lint**

```bash
npm run lint 2>&1 | tail -5
```

Expected: `0 errors` (pre-existing warnings are fine).

- [ ] **Step 11: Run tests one final time**

```bash
npx tsx --test tests/configurator-cupboard-layout.test.ts 2>&1
```

Expected: all pass.

- [ ] **Step 12: Commit**

```bash
git add lib/configurator/render/cupboardThreeModel.ts
git commit -m "feat(configurator): add divider, hanging rail, and bay shelf meshes to 3D cupboard model"
```

---

## Task 8: Final checks and PR

- [ ] **Step 1: Run `/simplify`** (as required by CLAUDE.md for PRs touching more than 3 files)

- [ ] **Step 2: Final lint + type check**

```bash
npm run lint 2>&1 | tail -3
npx tsc --noEmit 2>&1 | grep -v "validator.ts\|todos\|suppliers\|quotes\|me/profile\|overhead" | head -20
```

Expected: 0 lint errors, no new TS errors in changed files.

- [ ] **Step 3: Verify the app opens and the form works**

Open the app. Navigate to the Furniture Configurator (via a product or via `/roomcraft`). Select the Cupboard template.

Checklist:
- [ ] All new toggles are OFF by default — form looks identical to before
- [ ] Toggle Hanging Rail ON → sub-fields appear (rail height, shelves below, top shelf switch)
- [ ] Toggle Vertical Divider ON → sub-fields appear (divider position, right shelves)
- [ ] "Shelves" label changes to "Left shelves" when divider is ON
- [ ] Parts list updates live as fields change
- [ ] Rail does NOT appear in parts list
- [ ] "Hanging Top Shelf" appears when top shelf toggle is ON
- [ ] "Vertical Divider" appears in parts when divider is ON
- [ ] Technical preview tab shows the cyan rail line, purple top shelf, divider panel
- [ ] 3D tab shows cyan cylinder for rail, divider panel, shelves in correct bays
- [ ] Setting all toggles OFF and comparing to a fresh config shows no regression

- [ ] **Step 4: Push and update Linear**

```bash
git push origin codex/configurator-layout-extension
```

Target merge: `codex/configurator-layout-extension` → `codex/integration`.
