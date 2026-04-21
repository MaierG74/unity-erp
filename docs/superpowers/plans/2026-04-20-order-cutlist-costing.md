# Order Cutlist Costing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing per-product cutlist snapshot, order-level `material_assignments`, and `orders.cutting_plan` together into a single order-line material cost surface that switches from padded to nested-real once a cutting plan is generated.

**Architecture:** A single server helper (`getLineMaterialCost`) becomes the one path every order-line cost surface reads through. It picks one of three branches (nested-real from `orders.cutting_plan.line_allocations`; padded with stale flag; padded fresh). The cutting plan aggregator starts grouping by **resolved** `component_id` (after applying `material_assignments`) rather than nominal `board_type`. Plan-save time computes and persists a `line_allocations` array so per-line cost is deterministic on read.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase (Postgres JSONB), `node:test` + `assert/strict` for unit tests, Tailwind v4 / shadcn for UI.

---

## Spec reference

- Spec: `docs/superpowers/specs/2026-04-20-order-cutlist-costing-design.md`
- Prior specs this depends on:
  - `docs/superpowers/specs/2026-04-15-cutlist-to-costing-design.md` (per-product snapshot, shipped)
  - `docs/superpowers/specs/2026-04-01-order-cutting-plan-design.md` (order cutting plan, data layer shipped)
  - `docs/superpowers/specs/2026-04-01-per-line-material-assignment-design.md` (5-tuple role fingerprint, shipped)

## File structure

**New files:**
- `lib/orders/line-allocation.ts` — pure allocation helpers (area-weighted rule, substitution-safe)
- `lib/orders/line-material-cost.ts` — the branch-picking server helper
- `lib/orders/padded-line-cost.ts` — compute padded cost for one detail from product snapshot + non-cutlist BOM
- `app/api/orders/[orderId]/details/[detailId]/material-cost/route.ts` — GET endpoint that returns `LineMaterialCost`
- `tests/line-allocation.test.ts`
- `tests/padded-line-cost.test.ts`
- `tests/line-material-cost.test.ts`
- `components/features/orders/LineMaterialCostBadge.tsx` — small presentational component for basis/stale indicator

**Modified files:**
- `lib/orders/cutting-plan-types.ts` — add `line_allocations` field to `CuttingPlan`
- `lib/orders/cutting-plan-utils.ts` — extend `computeSourceRevision` to hash `material_assignments`
- `app/api/orders/[orderId]/cutting-plan/route.ts` — compute & persist `line_allocations`, server-compute `total_nested_cost`, hash assignments into revision in PUT
- `app/api/orders/[orderId]/cutting-plan/aggregate/route.ts` — group by resolved primary + resolved backer component (honour `material_assignments`), emit new revision hash
- `components/features/orders/ProductsTableRow.tsx` — render material cost cell (currently shows only product line total)
- `components/features/orders/OrderComponentsDialog.tsx` — non-blocking stale-plan warning + "Open cutting plan" affordance
- `tests/cutting-plan-utils.test.ts` — coverage for the extended `computeSourceRevision` (assignment-aware, reorder-invariant)

---

## Task 1: Add `line_allocations` field to `CuttingPlan` type

**Files:**
- Modify: `lib/orders/cutting-plan-types.ts:37-45`

- [ ] **Step 1: Add the new type and field**

Add this to `lib/orders/cutting-plan-types.ts` after `CuttingPlanMaterialGroup`:

```typescript
// ─── Line-level cost allocation (area-weighted, substitution-safe) ────────
export type CuttingPlanLineAllocation = {
  order_detail_id: number;
  /** Sum of (length_mm × width_mm × quantity) for this line's cutlist parts.
   *  Used as the allocation weight. Non-cutlist-only lines have area_mm2 = 0
   *  and are excluded from nested allocation (share = 0). */
  area_mm2: number;
  /** Share of total nested cost allocated to this line */
  line_share_amount: number;
  /** Allocation percentage (0-100) — `area_mm2 / sum(area_mm2) * 100` */
  allocation_pct: number;
};
```

Then extend the `CuttingPlan` type:

```typescript
export type CuttingPlan = {
  version: 1;
  generated_at: string;
  optimization_quality: 'fast' | 'balanced' | 'quality';
  stale: boolean;
  source_revision: string;
  material_groups: CuttingPlanMaterialGroup[];
  component_overrides: CuttingPlanOverride[];
  /** Total nested cost across all material groups, in the org's currency */
  total_nested_cost: number;
  /** Per-line allocation of the total nested cost */
  line_allocations: CuttingPlanLineAllocation[];
};
```

- [ ] **Step 2: Run TypeScript check to ensure nothing breaks**

Run: `npx tsc --noEmit 2>&1 | grep -E "cutting-plan|CuttingPlan" | head -20`
Expected: either clean, or a short list of files that read `CuttingPlan` and now need updating. Fix each by providing safe defaults (`total_nested_cost: 0`, `line_allocations: []`).

- [ ] **Step 3: Commit**

```bash
git add lib/orders/cutting-plan-types.ts
git commit -m "feat(orders): add line_allocations + total_nested_cost to CuttingPlan type"
```

---

## Task 2: Pure allocation helper — area-weighted with non-cutlist exclusion

**Files:**
- Create: `lib/orders/line-allocation.ts`
- Test: `tests/line-allocation.test.ts`

**Context:** Per spec §4, allocation is weighted by each line's total cutlist part area (mm²). Non-cutlist-only lines (area = 0) are **excluded** from the allocation — they receive zero nested share and their non-cutlist BOM cost adds on top unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/line-allocation.test.ts`:

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateLinesByArea } from '../lib/orders/line-allocation';

test('allocates proportionally by cutlist area', () => {
  const result = allocateLinesByArea(
    [
      { order_detail_id: 1, area_mm2: 4_000_000 },
      { order_detail_id: 2, area_mm2: 6_000_000 },
    ],
    800, // total_nested_cost (20% saving vs 1000 padded)
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].order_detail_id, 1);
  assert.equal(Math.round(result[0].line_share_amount * 100) / 100, 320);
  assert.equal(Math.round(result[0].allocation_pct * 10) / 10, 40);
  assert.equal(Math.round(result[1].line_share_amount * 100) / 100, 480);
  assert.equal(Math.round(result[1].allocation_pct * 10) / 10, 60);
});

test('allocation shares sum exactly to total_nested_cost (rounding-safe)', () => {
  const result = allocateLinesByArea(
    [
      { order_detail_id: 1, area_mm2: 3_333_333 },
      { order_detail_id: 2, area_mm2: 3_333_333 },
      { order_detail_id: 3, area_mm2: 3_333_334 },
    ],
    1000,
  );
  const sum = result.reduce((s, a) => s + a.line_share_amount, 0);
  assert.equal(Math.round(sum * 100) / 100, 1000);
});

test('empty lines returns empty allocation', () => {
  const result = allocateLinesByArea([], 500);
  assert.deepEqual(result, []);
});

test('zero-area lines excluded from allocation (not split evenly)', () => {
  // Two cutlist lines + one non-cutlist-only line.
  // Nested cost only splits across the two cutlist lines.
  const result = allocateLinesByArea(
    [
      { order_detail_id: 1, area_mm2: 5_000_000 },
      { order_detail_id: 2, area_mm2: 5_000_000 },
      { order_detail_id: 3, area_mm2: 0 }, // non-cutlist-only line
    ],
    600,
  );
  assert.equal(result.length, 3);
  const byId = new Map(result.map((r) => [r.order_detail_id, r]));
  assert.equal(byId.get(1)!.line_share_amount, 300);
  assert.equal(byId.get(2)!.line_share_amount, 300);
  assert.equal(byId.get(3)!.line_share_amount, 0);
  assert.equal(byId.get(3)!.allocation_pct, 0);
});

test('all zero-area lines return all-zero allocation (defensive)', () => {
  // Should not happen in practice (a plan can't exist without cutlist parts),
  // but be defensive: return zero shares, don't divide by zero.
  const result = allocateLinesByArea(
    [
      { order_detail_id: 1, area_mm2: 0 },
      { order_detail_id: 2, area_mm2: 0 },
    ],
    100,
  );
  assert.equal(result[0].line_share_amount, 0);
  assert.equal(result[1].line_share_amount, 0);
  assert.equal(result[0].allocation_pct, 0);
});

test('single cutlist line gets the entire nested cost', () => {
  const result = allocateLinesByArea(
    [{ order_detail_id: 1, area_mm2: 5_000_000 }],
    750,
  );
  assert.equal(result[0].line_share_amount, 750);
  assert.equal(result[0].allocation_pct, 100);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/line-allocation.test.ts`
Expected: FAIL — "Cannot find module '../lib/orders/line-allocation'"

- [ ] **Step 3: Write the implementation**

Create `lib/orders/line-allocation.ts`:

```typescript
import type { CuttingPlanLineAllocation } from './cutting-plan-types';

export type LineAllocationInput = {
  order_detail_id: number;
  /** Sum of (length_mm × width_mm × quantity) for this line's cutlist parts. */
  area_mm2: number;
};

/**
 * Allocate total nested cost across lines proportionally to each line's
 * cutlist part area (mm²). Spec §4.
 *
 * Rationale: area reflects physical material consumption and is invariant
 * under per-line material substitutions (5 white + 5 cherry cupboards with
 * the same geometry allocate 50/50 regardless of cost difference). The
 * cross-product nesting *savings* are distributed by how much space each
 * line contributed to the nested layout.
 *
 * Special cases:
 *   - Empty input → empty output.
 *   - Zero-area lines (non-cutlist-only) are excluded from the allocation:
 *     they receive line_share_amount = 0 and allocation_pct = 0. Their
 *     non-cutlist BOM cost is layered on separately by pickLineMaterialCost.
 *   - All-zero input → all-zero output (defensive; don't divide by zero).
 *   - Rounding error is absorbed by the last non-zero-area line so shares
 *     sum exactly to total_nested_cost.
 */
export function allocateLinesByArea(
  lines: LineAllocationInput[],
  total_nested_cost: number,
): CuttingPlanLineAllocation[] {
  if (lines.length === 0) return [];

  const sumArea = lines.reduce((s, l) => s + Math.max(0, l.area_mm2), 0);

  // Defensive all-zero: return zero shares (not even split — if there are no
  // cutlist parts anywhere there should be no nested cost to allocate).
  if (sumArea === 0) {
    return lines.map((l) => ({
      order_detail_id: l.order_detail_id,
      area_mm2: 0,
      line_share_amount: 0,
      allocation_pct: 0,
    }));
  }

  // Identify the last non-zero-area line — rounding error absorbed there
  let lastNonZeroIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].area_mm2 > 0) { lastNonZeroIdx = i; break; }
  }

  const out: CuttingPlanLineAllocation[] = [];
  let allocatedSoFar = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const area = Math.max(0, l.area_mm2);

    if (area === 0) {
      out.push({
        order_detail_id: l.order_detail_id,
        area_mm2: 0,
        line_share_amount: 0,
        allocation_pct: 0,
      });
      continue;
    }

    const pct = (area / sumArea) * 100;
    const share = i === lastNonZeroIdx
      ? total_nested_cost - allocatedSoFar
      : (area / sumArea) * total_nested_cost;
    const rounded = Math.round(share * 100) / 100;
    allocatedSoFar += rounded;

    out.push({
      order_detail_id: l.order_detail_id,
      area_mm2: area,
      line_share_amount: rounded,
      allocation_pct: Math.round(pct * 100) / 100,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/line-allocation.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/orders/line-allocation.ts tests/line-allocation.test.ts
git commit -m "feat(orders): area-weighted line allocation with non-cutlist exclusion"
```

---

## Task 3: Padded line cost helper — server-side per-detail padded cost

**Files:**
- Create: `lib/orders/padded-line-cost.ts`
- Test: `tests/padded-line-cost.test.ts`

**Context:** For a single `order_details` row, compute the padded material cost for 1 unit × `quantity`. Pulls from:
- `product_cutlist_costing_snapshots` (cutlist portion — board sheets with per-sheet billing overrides applied, edging with pct/meters overrides applied)
- `order_details.bom_snapshot` filtered where `is_cutlist_item = false` (non-cutlist hardware/accessories)

This function accepts all inputs as arguments (no DB fetch) so it's unit-testable without a Supabase mock. The route handler in Task 5 will assemble the inputs.

- [ ] **Step 1: Write the failing test**

Create `tests/padded-line-cost.test.ts`:

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { computePaddedLineCost } from '../lib/orders/padded-line-cost';
import type { CutlistCostingSnapshot } from '../lib/cutlist/costingSnapshot';

function makeSnapshot(overrides: Partial<CutlistCostingSnapshot> = {}): CutlistCostingSnapshot {
  return {
    sheets: [
      {
        sheet_id: 's1', material_id: 'm1', material_name: 'White MFC',
        sheet_length_mm: 2800, sheet_width_mm: 2070,
        // Full sheet area so auto billing charges full price — keeps tests predictable.
        used_area_mm2: 2800 * 2070, billing_override: null,
      },
    ],
    global_full_board: false,
    edging: [
      {
        material_id: 'e1', material_name: 'White 1mm edging',
        thickness_mm: 1, meters_actual: 20,
        meters_override: null, pct_override: null,
        unit_price_per_meter: 2.75, component_id: 42,
      },
    ],
    board_prices: [{ material_id: 'm1', unit_price_per_sheet: 797.05, component_id: 100 }],
    backer_sheets: null,
    backer_global_full_board: false,
    backer_price_per_sheet: null,
    calculator_inputs: {
      primaryBoards: [], backerBoards: [], edging: [],
      kerf: 3, optimizationPriority: 'fast',
    },
    stats: { total_parts: 10, total_pieces: 10, total_used_area_mm2: 2_800_000, total_waste_area_mm2: 0, total_cuts: 9 },
    ...overrides,
  };
}

test('padded cost = sheet price + edging × unit_price for one unit', () => {
  const result = computePaddedLineCost({
    quantity: 1,
    snapshot: makeSnapshot(),
    bom_snapshot: [],
  });
  // 1 sheet × 797.05 + 20m × 2.75 = 797.05 + 55.00 = 852.05
  assert.equal(Math.round(result.padded_cost * 100) / 100, 852.05);
  assert.equal(Math.round(result.cutlist_portion * 100) / 100, 852.05);
  assert.equal(result.non_cutlist_portion, 0);
});

test('padded cost scales by quantity', () => {
  const result = computePaddedLineCost({
    quantity: 5,
    snapshot: makeSnapshot(),
    bom_snapshot: [],
  });
  // 852.05 × 5 = 4260.25
  assert.equal(Math.round(result.padded_cost * 100) / 100, 4260.25);
});

test('billing_override mode=full charges full sheet', () => {
  const snap = makeSnapshot({
    sheets: [{
      sheet_id: 's1', material_id: 'm1', material_name: 'White MFC',
      sheet_length_mm: 2800, sheet_width_mm: 2070,
      used_area_mm2: 100_000, // only ~1.7% used — but full-override charges full sheet
      billing_override: { mode: 'full', manualPct: 100 },
    }],
  });
  const result = computePaddedLineCost({ quantity: 1, snapshot: snap, bom_snapshot: [] });
  // Full sheet charged: 797.05 + 55.00 = 852.05
  assert.equal(Math.round(result.cutlist_portion * 100) / 100, 852.05);
});

test('edging pct_override pads meters', () => {
  const snap = makeSnapshot({
    edging: [{
      material_id: 'e1', material_name: 'White 1mm', thickness_mm: 1,
      meters_actual: 20, meters_override: null, pct_override: 10,
      unit_price_per_meter: 2.75, component_id: 42,
    }],
  });
  const result = computePaddedLineCost({ quantity: 1, snapshot: snap, bom_snapshot: [] });
  // edging = 20 × 1.10 × 2.75 = 60.50
  // sheet = 797.05
  // total = 857.55
  assert.equal(Math.round(result.cutlist_portion * 100) / 100, 857.55);
});

test('edging meters_override replaces actual', () => {
  const snap = makeSnapshot({
    edging: [{
      material_id: 'e1', material_name: 'White 1mm', thickness_mm: 1,
      meters_actual: 20, meters_override: 25, pct_override: null,
      unit_price_per_meter: 2.75, component_id: 42,
    }],
  });
  const result = computePaddedLineCost({ quantity: 1, snapshot: snap, bom_snapshot: [] });
  // edging = 25 × 2.75 = 68.75
  // sheet = 797.05 → total 865.80
  assert.equal(Math.round(result.cutlist_portion * 100) / 100, 865.80);
});

test('non-cutlist bom items contribute to non_cutlist_portion', () => {
  const result = computePaddedLineCost({
    quantity: 2,
    snapshot: null,
    bom_snapshot: [
      { is_cutlist_item: false, line_total: 50, component_id: 1 },
      { is_cutlist_item: false, line_total: 25, component_id: 2 },
      { is_cutlist_item: true, line_total: 999, component_id: 3 }, // ignored
    ],
  });
  // (50 + 25) × 2 = 150
  assert.equal(result.non_cutlist_portion, 150);
  assert.equal(result.cutlist_portion, 0);
  assert.equal(result.padded_cost, 150);
});

test('null snapshot with empty bom returns zero', () => {
  const result = computePaddedLineCost({
    quantity: 1,
    snapshot: null,
    bom_snapshot: [],
  });
  assert.equal(result.padded_cost, 0);
});

test('backer sheets contribute when present', () => {
  const snap = makeSnapshot({
    backer_sheets: [{
      sheet_id: 'b1', material_id: 'bm1', material_name: 'Backer',
      sheet_length_mm: 2440, sheet_width_mm: 1220,
      used_area_mm2: 1_000_000, billing_override: null,
    }],
    backer_price_per_sheet: 450,
  });
  const result = computePaddedLineCost({ quantity: 1, snapshot: snap, bom_snapshot: [] });
  // primary sheet 797.05 + edging 55.00 + backer 450 = 1302.05
  assert.equal(Math.round(result.cutlist_portion * 100) / 100, 1302.05);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/padded-line-cost.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/orders/padded-line-cost.ts`:

```typescript
import type { CutlistCostingSnapshot, SnapshotSheet } from '@/lib/cutlist/costingSnapshot';

export type BomSnapshotEntry = {
  is_cutlist_item?: boolean;
  line_total?: number;
  component_id?: number | null;
};

export type PaddedLineCostInput = {
  /** Line quantity (detail.quantity) */
  quantity: number;
  /** Per-product cutlist snapshot (null if product has no cutlist) */
  snapshot: CutlistCostingSnapshot | null;
  /** order_details.bom_snapshot — only rows with is_cutlist_item=false are counted */
  bom_snapshot: BomSnapshotEntry[];
};

export type PaddedLineCost = {
  padded_cost: number;
  cutlist_portion: number;
  non_cutlist_portion: number;
};

/**
 * Compute the padded material cost for ONE order_details row.
 * Cutlist portion: sheets (with per-sheet billing overrides) + edging (with pct/meters overrides)
 *   × quantity, sourced from product_cutlist_costing_snapshots.
 * Non-cutlist portion: sum of bom_snapshot.line_total where is_cutlist_item=false, × quantity.
 */
export function computePaddedLineCost(input: PaddedLineCostInput): PaddedLineCost {
  const qty = Math.max(0, input.quantity || 0);

  const cutlistPerUnit = input.snapshot ? paddedCutlistCostPerUnit(input.snapshot) : 0;
  const cutlist_portion = Math.round(cutlistPerUnit * qty * 100) / 100;

  const nonCutlistPerUnit = (input.bom_snapshot ?? [])
    .filter((e) => !e.is_cutlist_item)
    .reduce((s, e) => s + (e.line_total ?? 0), 0);
  const non_cutlist_portion = Math.round(nonCutlistPerUnit * qty * 100) / 100;

  return {
    cutlist_portion,
    non_cutlist_portion,
    padded_cost: Math.round((cutlist_portion + non_cutlist_portion) * 100) / 100,
  };
}

function paddedCutlistCostPerUnit(snap: CutlistCostingSnapshot): number {
  let total = 0;

  // Primary sheets — apply billing override per sheet, or global_full_board, or auto (full sheet for now)
  for (const sheet of snap.sheets) {
    total += sheetChargeAmount(sheet, snap.board_prices, snap.global_full_board);
  }

  // Backer sheets — use backer_price_per_sheet (single price for all backer sheets)
  if (snap.backer_sheets && snap.backer_price_per_sheet != null) {
    for (const sheet of snap.backer_sheets) {
      total += backerSheetCharge(sheet, snap.backer_price_per_sheet, snap.backer_global_full_board);
    }
  }

  // Edging — resolve meters with override (pct or meters), multiply by unit price
  for (const e of snap.edging) {
    const unitPrice = e.unit_price_per_meter ?? 0;
    let meters = e.meters_actual;
    if (e.meters_override != null) {
      meters = e.meters_override;
    } else if (e.pct_override != null) {
      meters = e.meters_actual * (1 + e.pct_override / 100);
    }
    total += meters * unitPrice;
  }

  return total;
}

function sheetChargeAmount(
  sheet: SnapshotSheet,
  board_prices: { material_id: string; unit_price_per_sheet: number | null }[],
  global_full_board: boolean,
): number {
  const price = board_prices.find((b) => b.material_id === sheet.material_id)?.unit_price_per_sheet ?? 0;
  if (price === 0) return 0;

  // Override precedence: per-sheet override > global_full_board > auto (full sheet)
  const ov = sheet.billing_override;
  if (ov) {
    if (ov.mode === 'full') return price;
    if (ov.mode === 'manual') return price * (ov.manualPct / 100);
    // ov.mode === 'auto' → fall through
  }
  if (global_full_board) return price;

  // Auto: charge used-area proportion of the sheet (waste absorbed into rounding elsewhere)
  const sheetArea = sheet.sheet_length_mm * sheet.sheet_width_mm;
  if (sheetArea === 0) return price; // defensive — fall back to full
  const usedPct = sheet.used_area_mm2 / sheetArea;
  return price * usedPct;
}

function backerSheetCharge(
  sheet: SnapshotSheet,
  backer_price: number,
  global_full_board: boolean,
): number {
  const ov = sheet.billing_override;
  if (ov) {
    if (ov.mode === 'full') return backer_price;
    if (ov.mode === 'manual') return backer_price * (ov.manualPct / 100);
  }
  if (global_full_board) return backer_price;
  const sheetArea = sheet.sheet_length_mm * sheet.sheet_width_mm;
  if (sheetArea === 0) return backer_price;
  return backer_price * (sheet.used_area_mm2 / sheetArea);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/padded-line-cost.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/orders/padded-line-cost.ts tests/padded-line-cost.test.ts
git commit -m "feat(orders): computePaddedLineCost — per-detail padded material cost"
```

---

## Task 4: `getLineMaterialCost` — the branch-picking server helper

**Files:**
- Create: `lib/orders/line-material-cost.ts`
- Test: `tests/line-material-cost.test.ts`

**Context:** Three branches per spec §3:
1. Plan exists + fresh + allocation for this detail → nested_real
2. Plan exists + stale → padded + stale flag
3. No plan → padded

Takes pre-fetched inputs (cutting_plan, snapshot, bom_snapshot, line details) so it's unit-testable.

- [ ] **Step 1: Write the failing test**

Create `tests/line-material-cost.test.ts`:

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickLineMaterialCost } from '../lib/orders/line-material-cost';
import type { CuttingPlan } from '../lib/orders/cutting-plan-types';

const freshPlan: CuttingPlan = {
  version: 1,
  generated_at: '2026-04-20T00:00:00Z',
  optimization_quality: 'balanced',
  stale: false,
  source_revision: 'abc123',
  material_groups: [],
  component_overrides: [],
  total_nested_cost: 800,
  line_allocations: [
    { order_detail_id: 1, area_mm2: 4_000_000, line_share_amount: 320, allocation_pct: 40 },
    { order_detail_id: 2, area_mm2: 6_000_000, line_share_amount: 480, allocation_pct: 60 },
  ],
};

test('branch 1: fresh plan + allocation → nested_real', () => {
  const result = pickLineMaterialCost({
    order_detail_id: 1,
    cutting_plan: freshPlan,
    padded: { padded_cost: 400, cutlist_portion: 400, non_cutlist_portion: 0 },
  });
  assert.equal(result.basis, 'nested_real');
  assert.equal(result.amount, 320);
  assert.equal(result.stale, false);
  assert.equal(result.source_cutting_plan_revision, 'abc123');
});

test('branch 2: stale plan → padded + stale flag', () => {
  const stalePlan: CuttingPlan = { ...freshPlan, stale: true };
  const result = pickLineMaterialCost({
    order_detail_id: 1,
    cutting_plan: stalePlan,
    padded: { padded_cost: 400, cutlist_portion: 400, non_cutlist_portion: 0 },
  });
  assert.equal(result.basis, 'padded');
  assert.equal(result.amount, 400);
  assert.equal(result.stale, true);
});

test('branch 3: no plan → padded fresh', () => {
  const result = pickLineMaterialCost({
    order_detail_id: 1,
    cutting_plan: null,
    padded: { padded_cost: 400, cutlist_portion: 400, non_cutlist_portion: 0 },
  });
  assert.equal(result.basis, 'padded');
  assert.equal(result.amount, 400);
  assert.equal(result.stale, false);
});

test('fresh plan but no allocation for this detail → padded + stale flag', () => {
  const result = pickLineMaterialCost({
    order_detail_id: 999, // not in allocations
    cutting_plan: freshPlan,
    padded: { padded_cost: 400, cutlist_portion: 400, non_cutlist_portion: 0 },
  });
  // Plan exists and is "fresh" by flag, but this line isn't covered — treat as stale
  assert.equal(result.basis, 'padded');
  assert.equal(result.stale, true);
});

test('nested_real preserves non-cutlist portion from padded input', () => {
  // Non-cutlist hardware shouldn't be nested — it's always added on top of allocated cutlist
  // (The current spec has cutting_plan total cover cutlist only; non-cutlist always padded.)
  const result = pickLineMaterialCost({
    order_detail_id: 1,
    cutting_plan: freshPlan,
    padded: { padded_cost: 500, cutlist_portion: 400, non_cutlist_portion: 100 },
  });
  // 320 (nested cutlist share) + 100 (non-cutlist) = 420
  assert.equal(result.amount, 420);
  assert.equal(result.basis, 'nested_real');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/line-material-cost.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/orders/line-material-cost.ts`:

```typescript
import type { CuttingPlan } from './cutting-plan-types';
import type { PaddedLineCost } from './padded-line-cost';

export type LineMaterialCostBasis = 'padded' | 'nested_real';

export type LineMaterialCost = {
  amount: number;
  basis: LineMaterialCostBasis;
  stale: boolean;
  cutlist_portion: number;
  non_cutlist_portion: number;
  source_cutting_plan_revision?: string;
};

export type PickLineMaterialCostInput = {
  order_detail_id: number;
  cutting_plan: CuttingPlan | null;
  padded: PaddedLineCost;
};

/**
 * Pure branch-picker. Given an order detail's padded cost (pre-computed) and
 * the order's cutting_plan, return the amount to display on the line.
 *
 * Branches (spec §3):
 *   1. Fresh plan with allocation for this detail → nested_real cutlist share + padded non-cutlist
 *   2. Plan exists but stale → padded + stale flag
 *   3. Plan exists, not stale, but this line has no allocation (e.g. new line added
 *      after plan was generated and source_revision hasn't been recomputed yet)
 *      → padded + stale flag (defensive — treat missing allocation as staleness)
 *   4. No plan → padded, not stale
 */
export function pickLineMaterialCost(input: PickLineMaterialCostInput): LineMaterialCost {
  const { order_detail_id, cutting_plan, padded } = input;

  if (!cutting_plan) {
    return {
      amount: padded.padded_cost,
      basis: 'padded',
      stale: false,
      cutlist_portion: padded.cutlist_portion,
      non_cutlist_portion: padded.non_cutlist_portion,
    };
  }

  if (cutting_plan.stale) {
    return {
      amount: padded.padded_cost,
      basis: 'padded',
      stale: true,
      cutlist_portion: padded.cutlist_portion,
      non_cutlist_portion: padded.non_cutlist_portion,
      source_cutting_plan_revision: cutting_plan.source_revision,
    };
  }

  const allocation = cutting_plan.line_allocations.find(
    (a) => a.order_detail_id === order_detail_id,
  );
  if (!allocation) {
    return {
      amount: padded.padded_cost,
      basis: 'padded',
      stale: true,
      cutlist_portion: padded.cutlist_portion,
      non_cutlist_portion: padded.non_cutlist_portion,
      source_cutting_plan_revision: cutting_plan.source_revision,
    };
  }

  // Nested cutlist share + padded non-cutlist (non-cutlist never gets nested)
  const amount = Math.round((allocation.line_share_amount + padded.non_cutlist_portion) * 100) / 100;

  return {
    amount,
    basis: 'nested_real',
    stale: false,
    cutlist_portion: allocation.line_share_amount,
    non_cutlist_portion: padded.non_cutlist_portion,
    source_cutting_plan_revision: cutting_plan.source_revision,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/line-material-cost.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/orders/line-material-cost.ts tests/line-material-cost.test.ts
git commit -m "feat(orders): pickLineMaterialCost — three-branch selector (padded / nested_real / stale)"
```

---

## Task 5: Material cost API endpoint

**Files:**
- Create: `app/api/orders/[orderId]/details/[detailId]/material-cost/route.ts`

**Context:** Wires together the pure helpers with a real Supabase fetch. Returns a `LineMaterialCost` for a single detail. UI and tests hit this endpoint; the existing `effective-bom` route stays as-is (consumers migrate via Task 7).

- [ ] **Step 1: Write the route**

Create `app/api/orders/[orderId]/details/[detailId]/material-cost/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getRouteClient } from '@/lib/supabase-route';
import { computePaddedLineCost } from '@/lib/orders/padded-line-cost';
import { pickLineMaterialCost } from '@/lib/orders/line-material-cost';
import type { CuttingPlan } from '@/lib/orders/cutting-plan-types';
import type { CutlistCostingSnapshot } from '@/lib/cutlist/costingSnapshot';

type RouteParams = { orderId: string; detailId: string };

export async function GET(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await getRouteClient(request);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { orderId, detailId } = await context.params;
  const orderIdNum = Number(orderId);
  const detailIdNum = Number(detailId);
  if (!Number.isFinite(orderIdNum) || orderIdNum <= 0 || !Number.isFinite(detailIdNum) || detailIdNum <= 0) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
  }

  // 1. Fetch the order detail + its product id and cutlist flag
  const { data: detail, error: detailErr } = await auth.supabase
    .from('order_details')
    .select('order_detail_id, order_id, product_id, quantity, bom_snapshot')
    .eq('order_detail_id', detailIdNum)
    .eq('order_id', orderIdNum)
    .maybeSingle();

  if (detailErr) return NextResponse.json({ error: detailErr.message }, { status: 500 });
  if (!detail) return NextResponse.json({ error: 'Order detail not found' }, { status: 404 });

  // 2. Fetch the order's cutting_plan (may be null)
  const { data: order, error: orderErr } = await auth.supabase
    .from('orders')
    .select('cutting_plan')
    .eq('order_id', orderIdNum)
    .maybeSingle();

  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 });
  const cutting_plan: CuttingPlan | null = (order?.cutting_plan as CuttingPlan) ?? null;

  // 3. Fetch the product's cutlist snapshot (may be null for non-cutlist products)
  let snapshot: CutlistCostingSnapshot | null = null;
  if (detail.product_id != null) {
    const { data: snap } = await auth.supabase
      .from('product_cutlist_costing_snapshots')
      .select('snapshot_data')
      .eq('product_id', detail.product_id)
      .maybeSingle();
    if (snap?.snapshot_data) {
      snapshot = snap.snapshot_data as CutlistCostingSnapshot;
    }
  }

  // 4. Compute padded baseline
  const padded = computePaddedLineCost({
    quantity: detail.quantity ?? 1,
    snapshot,
    bom_snapshot: Array.isArray(detail.bom_snapshot) ? detail.bom_snapshot : [],
  });

  // 5. Branch on cutting plan
  const result = pickLineMaterialCost({
    order_detail_id: detailIdNum,
    cutting_plan,
    padded,
  });

  return NextResponse.json(result);
}
```

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep -E "material-cost|line-material-cost|padded-line-cost" | head -10`
Expected: clean.

- [ ] **Step 3: Smoke test with curl**

Start dev server (separate terminal): `npm run dev -- --webpack`. Then:

```bash
# Replace 123/456 with real IDs from your dev DB
curl -s -b "<auth-cookie>" http://localhost:3000/api/orders/123/details/456/material-cost | jq
```

Expected: JSON shape `{ amount, basis, stale, cutlist_portion, non_cutlist_portion, source_cutting_plan_revision? }`. If the order has no cutting plan, `basis` should be `padded` and `stale: false`. If the product has no snapshot, `cutlist_portion` is 0 and only `non_cutlist_portion` (from bom_snapshot) contributes.

- [ ] **Step 4: Commit**

```bash
git add app/api/orders/[orderId]/details/[detailId]/material-cost/route.ts
git commit -m "feat(orders): material-cost route — per-line cost via padded/nested-real branch"
```

---

## Task 6: Aggregate endpoint — group by resolved primary + backer component

**Files:**
- Modify: `app/api/orders/[orderId]/cutting-plan/aggregate/route.ts:38-128`

**Context:** Today the aggregator groups parts by `board_type|primary_material_id|backer_material_id` — the *nominal* product defaults. Per spec §5, we resolve:
- **Primary** via per-role assignment in `MaterialAssignments.assignments` (5-tuple fingerprint); fall back to the product's nominal primary.
- **Backer** via `MaterialAssignments.backer_default` (order-level, single setting); fall back to the product's nominal backer.

Grouping key becomes `board_type|resolved_primary|resolved_backer`, so a 5-white + 5-black split produces two material groups and a whole-order backer change produces distinct backer groups.

- [ ] **Step 1: Read the current aggregate endpoint**

Open `app/api/orders/[orderId]/cutting-plan/aggregate/route.ts`. Locate the `groupMap` build (around lines 69-117).

- [ ] **Step 2: Add material_assignments to the fetch**

Replace the first Supabase fetch (lines 50-53) with a parallel fetch that also grabs `material_assignments`:

```typescript
const [detailsRes, orderRes] = await Promise.all([
  auth.supabase
    .from('order_details')
    .select('order_detail_id, product_id, quantity, cutlist_snapshot, products(name)')
    .eq('order_id', orderIdNum),
  auth.supabase
    .from('orders')
    .select('material_assignments')
    .eq('order_id', orderIdNum)
    .maybeSingle(),
]);

const { data: details, error } = detailsRes;
const assignments = (orderRes.data?.material_assignments as import('@/lib/orders/material-assignment-types').MaterialAssignments | null) ?? null;

if (error) return NextResponse.json({ error: error.message }, { status: 500 });
if (!details || details.length === 0) {
  return NextResponse.json({ error: 'No order details found' }, { status: 404 });
}
```

- [ ] **Step 3: Build an assignment lookup index + backer override**

Add after the fetch, before the group loop:

```typescript
import { roleFingerprint } from '@/lib/orders/material-assignment-types';
// (Add to imports at top if not already present.)

// Index per-role primary assignments by 5-tuple fingerprint
const assignmentIndex = new Map<string, { component_id: number; component_name: string }>();
for (const a of assignments?.assignments ?? []) {
  const fp = roleFingerprint(a.order_detail_id, a.board_type, a.part_name, a.length_mm, a.width_mm);
  assignmentIndex.set(fp, { component_id: a.component_id, component_name: a.component_name });
}

// Order-level backer override (single setting — applies to every group with a backer)
const backerOverride = assignments?.backer_default
  ? {
      component_id: assignments.backer_default.component_id,
      component_name: assignments.backer_default.component_name,
    }
  : null;
```

- [ ] **Step 4: Resolve each part through the assignment index**

Replace the inner grouping loop (currently around lines 81-117) with:

```typescript
for (const group of groups) {
  // Resolve backer once per group — it's either the order-level override
  // (if set AND this group has a backer at all) or the product's nominal backer.
  const resolved_backer_id =
    group.backer_material_id != null && backerOverride
      ? backerOverride.component_id
      : group.backer_material_id;
  const resolved_backer_name =
    group.backer_material_id != null && backerOverride
      ? backerOverride.component_name
      : group.backer_material_name;

  for (const part of group.parts) {
    const fp = roleFingerprint(
      detail.order_detail_id,
      group.board_type,
      part.name,
      part.length_mm,
      part.width_mm,
    );
    const assignment = assignmentIndex.get(fp);

    // Resolved primary: per-role assignment > product default
    const resolved_primary_id = assignment?.component_id ?? group.primary_material_id;
    const resolved_primary_name = assignment?.component_name ?? group.primary_material_name;

    // Key on resolved primary AND resolved backer, not nominal
    const key = `${group.board_type}|${resolved_primary_id ?? 'none'}|${resolved_backer_id ?? 'none'}`;

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        board_type: group.board_type,
        primary_material_id: resolved_primary_id,
        primary_material_name: resolved_primary_name,
        backer_material_id: resolved_backer_id,
        backer_material_name: resolved_backer_name,
        parts: [],
      });
    }

    const target = groupMap.get(key)!;
    const aggregatedPart: AggregatedPart = {
      id: `${detail.order_detail_id}-${part.id}`,
      original_id: part.id,
      order_detail_id: detail.order_detail_id,
      product_name: productName,
      name: part.name,
      grain: part.grain,
      quantity: part.quantity * lineQty,
      width_mm: part.width_mm,
      length_mm: part.length_mm,
      band_edges: part.band_edges,
      lamination_type: part.lamination_type,
      lamination_config: part.lamination_config,
      material_thickness: part.material_thickness,
      edging_material_id: part.edging_material_id,
      material_label: part.material_label,
    };
    target.parts.push(aggregatedPart);
    totalParts++;
  }
}
```

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit 2>&1 | grep -E "aggregate" | head -10`
Expected: clean.

- [ ] **Step 6: Manual verification**

1. Open a test order with two lines of the same product but different material assignments.
2. `curl -s http://localhost:3000/api/orders/<id>/cutting-plan/aggregate | jq '.material_groups | map({primary: .primary_material_id, backer: .backer_material_id, parts: (.parts | length)})'`
3. Expected: two groups, one per assigned primary material, each containing only the parts belonging to its line(s).
4. If you set a `backer_default` on the order's assignments, expect every group's `backer_material_id` to reflect the override.

- [ ] **Step 7: Commit**

```bash
git add app/api/orders/[orderId]/cutting-plan/aggregate/route.ts
git commit -m "feat(orders): aggregate groups by resolved primary + backer (respects material_assignments)"
```

---

## Task 7: Cutting-plan PUT — server-compute `total_nested_cost` + area-based allocation

**Files:**
- Modify: `app/api/orders/[orderId]/cutting-plan/route.ts:15-80`

**Context:** Per spec §3 and §4, the server is authoritative for `total_nested_cost` and the allocation. On save we:

1. Fetch the submitted plan's referenced component prices (boards + edging) from `components`.
2. Recompute `total_nested_cost` from `material_groups[].sheets_required × component.cost + backer_sheets_required × component.cost + edging meters × component.cost_per_meter`. Ignore whatever the client sent.
3. Sum per-line cutlist area from `order_details.cutlist_snapshot` (area = `length_mm × width_mm × part.quantity × detail.quantity`).
4. Allocate nested cost via `allocateLinesByArea`.
5. Persist the canonical `total_nested_cost` and `line_allocations` inside the stored `CuttingPlan`.

- [ ] **Step 1: Loosen body validation — client sends fields but server overwrites them**

Modify the validation near line 33 in `app/api/orders/[orderId]/cutting-plan/route.ts`:

```typescript
if (!body.source_revision || !Array.isArray(body.material_groups)) {
  return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
}
// total_nested_cost and line_allocations are server-computed; whatever the
// client sends is ignored.
```

- [ ] **Step 2: Extend detail fetch to include cutlist_snapshot and quantity**

Replace the current `details` query (lines 38-42):

```typescript
const { data: details, error: detailsError } = await supabaseAdmin
  .from('order_details')
  .select('order_detail_id, product_id, quantity, cutlist_snapshot')
  .eq('order_id', orderId);
```

- [ ] **Step 3: Fetch component prices for every referenced component**

After the `currentRevision` check (after line 64), before the persist, insert:

```typescript
import { allocateLinesByArea, type LineAllocationInput } from '@/lib/orders/line-allocation';
// (Add to imports at top of file.)

// Collect every component_id referenced by the incoming plan (primary, backer, edging).
const componentIds = new Set<number>();
for (const g of body.material_groups) {
  if (g.primary_material_id != null) componentIds.add(g.primary_material_id);
  if (g.backer_material_id != null) componentIds.add(g.backer_material_id);
  for (const e of g.edging_by_material ?? []) {
    if (e.component_id != null) componentIds.add(e.component_id);
  }
}

// Fetch authoritative prices. `cost` is per-sheet for boards; edging components
// carry a unit cost too — we treat both as the rand amount per unit (sheet or
// per-meter for edging where `unit = 'mm'` lengths convert via /1000).
const priceByComponentId = new Map<number, number>();
if (componentIds.size > 0) {
  const { data: comps, error: compsErr } = await supabaseAdmin
    .from('components')
    .select('component_id, cost, cost_per_meter')
    .in('component_id', Array.from(componentIds));
  if (compsErr) {
    return NextResponse.json({ error: 'Failed to load component prices' }, { status: 500 });
  }
  for (const c of comps ?? []) {
    // Board components use `cost` (per sheet). Edging components use `cost_per_meter`.
    // If both are present we prefer cost (boards); if only cost_per_meter, use that.
    const price = c.cost != null ? c.cost : (c.cost_per_meter ?? 0);
    priceByComponentId.set(c.component_id, price);
  }
}

// Server-authoritative total_nested_cost: recomputed from prices, not from body.
const total_nested_cost_raw = body.material_groups.reduce((sum, g) => {
  const primary = g.primary_material_id != null
    ? (g.sheets_required ?? 0) * (priceByComponentId.get(g.primary_material_id) ?? 0)
    : 0;
  const backer = g.backer_material_id != null
    ? (g.backer_sheets_required ?? 0) * (priceByComponentId.get(g.backer_material_id) ?? 0)
    : 0;
  const edging = (g.edging_by_material ?? []).reduce((s, e) =>
    s + (e.length_mm / 1000) * (priceByComponentId.get(e.component_id) ?? 0),
  0);
  return sum + primary + backer + edging;
}, 0);
const total_nested_cost = Math.round(total_nested_cost_raw * 100) / 100;
```

- [ ] **Step 4: Compute per-line cutlist area from order_details.cutlist_snapshot**

Continue after Step 3:

```typescript
// Sum cutlist-part area per line. Each part appears in cutlist_snapshot's group.parts
// with a per-unit quantity; multiply by the order-detail line quantity.
const lineAreaInputs: LineAllocationInput[] = (details ?? []).map((d) => {
  const lineQty = d.quantity ?? 1;
  const groups: Array<{ parts: Array<{ length_mm: number; width_mm: number; quantity: number }> }> =
    Array.isArray(d.cutlist_snapshot) ? d.cutlist_snapshot : [];
  let area_mm2 = 0;
  for (const g of groups) {
    for (const p of g.parts ?? []) {
      area_mm2 += (p.length_mm ?? 0) * (p.width_mm ?? 0) * (p.quantity ?? 0) * lineQty;
    }
  }
  return { order_detail_id: d.order_detail_id, area_mm2 };
});

const line_allocations = allocateLinesByArea(lineAreaInputs, total_nested_cost);
```

- [ ] **Step 5: Persist with server-authoritative values**

Replace the `planToSave` assignment (line 67):

```typescript
const planToSave: CuttingPlan = {
  ...body,
  stale: false,
  total_nested_cost,
  line_allocations,
};
```

- [ ] **Step 6: Type check**

Run: `npx tsc --noEmit 2>&1 | grep -E "cutting-plan/route" | head -10`
Expected: clean. If the `components` table columns differ (e.g. `cost_per_sheet` instead of `cost`), adjust the price-fetch column list and mapping.

- [ ] **Step 7: Smoke test**

1. Open an order with a cutting plan workflow. Click Generate → Save Plan.
2. Check `orders.cutting_plan->'total_nested_cost'` and `'line_allocations'` in Supabase SQL editor — expect a non-zero rand amount and one allocation entry per detail, with `line_share_amount` summing exactly to `total_nested_cost`.
3. Verify that even if the client sends a wrong `total_nested_cost` (temporarily set the client to send `0`), the server still persists a correct non-zero total.

- [ ] **Step 8: Commit**

```bash
git add app/api/orders/[orderId]/cutting-plan/route.ts
git commit -m "feat(orders): server-authoritative total_nested_cost + area-based line allocations"
```

---

## Task 8: Hash `material_assignments` into `source_revision` (close the race)

**Files:**
- Modify: `lib/orders/cutting-plan-utils.ts:8-20` (computeSourceRevision)
- Modify: `app/api/orders/[orderId]/cutting-plan/aggregate/route.ts:60-66` (hash call-site)
- Modify: `app/api/orders/[orderId]/cutting-plan/route.ts:47-53` (hash verification call-site)
- Test: `tests/cutting-plan-utils.test.ts`

**Context:** Today `computeSourceRevision` hashes only `order_details` (id, quantity, cutlist_snapshot). Per spec §6, the hash must also cover `orders.material_assignments` so that Tab A saving a plan generated before Tab B changed assignments gets a 409 `REVISION_MISMATCH` instead of silently overwriting.

- [ ] **Step 1: Write the failing test**

Create `tests/cutting-plan-utils.test.ts`:

```typescript
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSourceRevision } from '../lib/orders/cutting-plan-utils';

const detailA = { order_detail_id: 1, quantity: 2, cutlist_snapshot: [{ a: 1 }] };
const detailB = { order_detail_id: 2, quantity: 1, cutlist_snapshot: [{ b: 2 }] };
const emptyAssignments = { version: 1 as const, assignments: [], backer_default: null, edging_defaults: [], edging_overrides: [] };

test('same details + same assignments → same hash', () => {
  const a = computeSourceRevision([detailA, detailB], emptyAssignments);
  const b = computeSourceRevision([detailA, detailB], emptyAssignments);
  assert.equal(a, b);
});

test('different assignments → different hash (same details)', () => {
  const assignmentsV1 = {
    ...emptyAssignments,
    assignments: [{ order_detail_id: 1, board_type: 'carcass_16mm', part_name: 'Top',
      length_mm: 100, width_mm: 50, component_id: 500, component_name: 'White MFC' }],
  };
  const assignmentsV2 = {
    ...emptyAssignments,
    assignments: [{ order_detail_id: 1, board_type: 'carcass_16mm', part_name: 'Top',
      length_mm: 100, width_mm: 50, component_id: 501, component_name: 'Oak MFC' }],
  };
  const a = computeSourceRevision([detailA], assignmentsV1);
  const b = computeSourceRevision([detailA], assignmentsV2);
  assert.notEqual(a, b);
});

test('null assignments is treated as empty (stable hash)', () => {
  const a = computeSourceRevision([detailA], null);
  const b = computeSourceRevision([detailA], emptyAssignments);
  assert.equal(a, b, 'null and empty assignments should hash identically');
});

test('reordering assignments does not change hash (canonicalised)', () => {
  const row1 = { order_detail_id: 1, board_type: 'c', part_name: 'Top',
    length_mm: 100, width_mm: 50, component_id: 500, component_name: 'A' };
  const row2 = { order_detail_id: 2, board_type: 'c', part_name: 'Side',
    length_mm: 200, width_mm: 50, component_id: 501, component_name: 'B' };
  const a = computeSourceRevision([detailA], { ...emptyAssignments, assignments: [row1, row2] });
  const b = computeSourceRevision([detailA], { ...emptyAssignments, assignments: [row2, row1] });
  assert.equal(a, b);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test tests/cutting-plan-utils.test.ts`
Expected: FAIL — `computeSourceRevision` has a single-argument signature today.

- [ ] **Step 3: Update `computeSourceRevision` to accept assignments**

Replace the body of `lib/orders/cutting-plan-utils.ts` lines 8-20:

```typescript
import type { MaterialAssignments } from './material-assignment-types';

/**
 * Compute a hash of order details + material assignments state for stale-save detection.
 * Inputs: detail IDs, quantities, cutlist snapshot content, AND the assignments JSONB.
 * Canonicalised: assignments are sorted by role fingerprint so reordering doesn't affect the hash.
 */
export function computeSourceRevision(
  details: Array<{
    order_detail_id: number;
    quantity: number;
    cutlist_snapshot: unknown;
  }>,
  assignments: MaterialAssignments | null,
): string {
  const detailsPayload = details
    .sort((a, b) => a.order_detail_id - b.order_detail_id)
    .map((d) => `${d.order_detail_id}:${d.quantity}:${JSON.stringify(d.cutlist_snapshot ?? null)}`)
    .join('|');

  // Canonicalise assignments: sort every array so hash is reorder-invariant.
  const a = assignments ?? { version: 1, assignments: [], backer_default: null, edging_defaults: [], edging_overrides: [] };
  const sortedAssignments = [...a.assignments].sort((x, y) =>
    `${x.order_detail_id}|${x.board_type}|${x.part_name}|${x.length_mm}|${x.width_mm}`.localeCompare(
      `${y.order_detail_id}|${y.board_type}|${y.part_name}|${y.length_mm}|${y.width_mm}`,
    ),
  );
  const sortedEdgingDefaults = [...a.edging_defaults].sort((x, y) =>
    x.board_component_id - y.board_component_id,
  );
  const sortedEdgingOverrides = [...a.edging_overrides].sort((x, y) =>
    `${x.order_detail_id}|${x.board_type}|${x.part_name}|${x.length_mm}|${x.width_mm}`.localeCompare(
      `${y.order_detail_id}|${y.board_type}|${y.part_name}|${y.length_mm}|${y.width_mm}`,
    ),
  );
  const assignmentsPayload = JSON.stringify({
    assignments: sortedAssignments,
    backer_default: a.backer_default,
    edging_defaults: sortedEdgingDefaults,
    edging_overrides: sortedEdgingOverrides,
  });

  return crypto.createHash('sha256')
    .update(detailsPayload + '||' + assignmentsPayload)
    .digest('hex')
    .slice(0, 16);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test tests/cutting-plan-utils.test.ts`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Update the aggregate endpoint call-site**

In `app/api/orders/[orderId]/cutting-plan/aggregate/route.ts` at the call to `computeSourceRevision` (around line 60), pass the fetched assignments (already in scope from Task 6):

```typescript
const sourceRevision = computeSourceRevision(
  details.map((d) => ({
    order_detail_id: d.order_detail_id,
    quantity: d.quantity ?? 1,
    cutlist_snapshot: d.cutlist_snapshot,
  })),
  assignments,
);
```

- [ ] **Step 6: Update the PUT verification call-site**

In `app/api/orders/[orderId]/cutting-plan/route.ts` around line 47, fetch assignments alongside details and pass them through:

```typescript
const [{ data: details, error: detailsError }, { data: orderRow }] = await Promise.all([
  supabaseAdmin
    .from('order_details')
    .select('order_detail_id, product_id, quantity, cutlist_snapshot')
    .eq('order_id', orderId),
  supabaseAdmin
    .from('orders')
    .select('material_assignments')
    .eq('order_id', orderId)
    .maybeSingle(),
]);

if (detailsError) {
  return NextResponse.json({ error: 'Failed to verify order state' }, { status: 500 });
}

const currentAssignments = (orderRow?.material_assignments as import('@/lib/orders/material-assignment-types').MaterialAssignments | null) ?? null;

const currentRevision = computeSourceRevision(
  (details ?? []).map((d) => ({
    order_detail_id: d.order_detail_id,
    quantity: d.quantity ?? 1,
    cutlist_snapshot: d.cutlist_snapshot,
  })),
  currentAssignments,
);
```

- [ ] **Step 7: Type check**

Run: `npx tsc --noEmit 2>&1 | grep -E "computeSourceRevision|cutting-plan" | head -20`
Expected: clean.

- [ ] **Step 8: Smoke test — verify the race is closed**

1. Open an order in Tab A. Go to the Cutting Plan tab → Generate (aggregate runs, source_revision captured).
2. Open the same order in Tab B. Go to Material Assignments → change an assignment → Save (this calls `markCuttingPlanStale` and also changes the assignments JSONB).
3. Back in Tab A, click Save Plan.
4. Expected: Tab A gets a `REVISION_MISMATCH` 409 with a clear message. Today (pre-fix) it would succeed and overwrite Tab B's state.

- [ ] **Step 9: Commit**

```bash
git add lib/orders/cutting-plan-utils.ts tests/cutting-plan-utils.test.ts \
  app/api/orders/[orderId]/cutting-plan/aggregate/route.ts \
  app/api/orders/[orderId]/cutting-plan/route.ts
git commit -m "feat(orders): hash material_assignments into source_revision to close save-race"
```

---

## Task 9: PO stale warning on OrderComponentsDialog

**Files:**
- Modify: `components/features/orders/OrderComponentsDialog.tsx`

**Context:** Per spec §6, when an operator opens the PO flow while the cutting plan is stale, they should see a non-blocking warning that component costs reflect padded (not nested) amounts, with a one-click affordance to jump to the Cutting Plan tab and regenerate. The warning is advisory — we do **not** block PO creation, because operators frequently create POs before the final layout is locked in.

Product-snapshot propagation is intentionally out of scope: saved orders are frozen against their captured snapshots (spec §6 + §Out of Scope). So the only staleness source visible here is structural edits already caught in Task 8 (`order_details` changes, `material_assignments` writes).

- [ ] **Step 1: Add a minimal plan query inside the dialog**

In `OrderComponentsDialog.tsx`, after the existing `useQuery<SupplierGroup[]>` block (~line 91), add:

```typescript
import type { CuttingPlan } from '@/lib/orders/cutting-plan-types';

// Inside OrderComponentsDialog, after the existing data query:
const { data: cuttingPlan } = useQuery<CuttingPlan | null>({
  queryKey: ['order-cutting-plan', orderId],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('cutting_plan')
      .eq('order_id', Number(orderId))
      .maybeSingle();
    if (error) throw new Error('Failed to fetch cutting plan');
    return (data?.cutting_plan ?? null) as CuttingPlan | null;
  },
  enabled: open,
  staleTime: 30_000,
});

const planIsStale = Boolean(cuttingPlan && cuttingPlan.stale);
```

We reuse the existing `['order-cutting-plan', orderId]` query key so React Query de-dupes with `useOrderCuttingPlan` elsewhere on the page.

- [ ] **Step 2: Render the warning banner**

Directly after the existing `creationFailures` alert block (around line 643, just before `{step === 'select' && (`), add:

```tsx
{planIsStale && (
  <Alert className="mb-4 border-amber-500/40 bg-amber-500/10">
    <AlertCircle className="h-4 w-4 text-amber-400" />
    <AlertTitle className="text-amber-200">Cutting plan is stale</AlertTitle>
    <AlertDescription className="text-amber-200/80">
      Component costs below reflect padded per-product estimates, not cross-product nested amounts.
      Regenerate the cutting plan to lock in nested pricing before creating POs.
      <div className="mt-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onOpenChange(false);
            // Navigate to cutting-plan tab via query param
            const url = new URL(window.location.href);
            url.searchParams.set('tab', 'cutting-plan');
            window.history.pushState({}, '', url.toString());
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
        >
          Open cutting plan
        </Button>
      </div>
    </AlertDescription>
  </Alert>
)}
```

We use `pushState + popstate` because the order page reads `searchParams?.get('tab')` each render (see `app/orders/[orderId]/page.tsx:77`). A direct `router.push()` would also work if the dialog uses `useRouter`, but this pattern keeps the dialog decoupled from Next.js navigation.

- [ ] **Step 3: Lint**

Run: `npm run lint -- components/features/orders/OrderComponentsDialog.tsx`
Expected: clean.

- [ ] **Step 4: Manual verify**

1. Open an order with a saved, fresh cutting plan → open Order Components dialog → no banner.
2. Edit a line quantity (triggers Task 8's assignment-free source_revision shift → plan becomes stale on next PUT from the builder). Alternatively, set `cutting_plan->'stale' = true` directly in SQL for this test:
   ```sql
   UPDATE orders SET cutting_plan = jsonb_set(cutting_plan, '{stale}', 'true'::jsonb) WHERE order_id = <id>;
   ```
3. Reopen the dialog → amber banner appears with "Open cutting plan" button.
4. Click button → dialog closes, URL flips to `?tab=cutting-plan`, Cutting Plan tab renders.
5. Regenerate plan → banner disappears on next dialog open.

- [ ] **Step 5: Commit**

```bash
git add components/features/orders/OrderComponentsDialog.tsx
git commit -m "feat(orders): stale-plan warning on Order Components dialog"
```

---

## Task 10: UI — LineMaterialCostBadge component

**Files:**
- Create: `components/features/orders/LineMaterialCostBadge.tsx`

**Context:** Small presentational component that renders the amount + a basis indicator. Used by Task 11 on `ProductsTableRow`.

- [ ] **Step 1: Create the component**

Create `components/features/orders/LineMaterialCostBadge.tsx`:

```tsx
'use client';

import { formatCurrency } from '@/lib/utils/format';
import type { LineMaterialCost } from '@/lib/orders/line-material-cost';
import { cn } from '@/lib/utils';

type Props = {
  cost: LineMaterialCost | null;
  loading?: boolean;
  className?: string;
};

export function LineMaterialCostBadge({ cost, loading, className }: Props) {
  if (loading) {
    return <span className={cn('text-xs text-muted-foreground', className)}>…</span>;
  }
  if (!cost) {
    return <span className={cn('text-xs text-muted-foreground', className)}>—</span>;
  }

  const basisLabel =
    cost.basis === 'nested_real' ? 'nested' :
    cost.stale ? 'stale' : 'padded';

  const basisColor =
    cost.basis === 'nested_real' ? 'bg-emerald-500/15 text-emerald-400' :
    cost.stale ? 'bg-amber-500/15 text-amber-400' :
    'bg-muted text-muted-foreground';

  const title =
    cost.basis === 'nested_real'
      ? `Cross-product nested cost — saved vs ${formatCurrency(cost.cutlist_portion + cost.non_cutlist_portion)} padded.`
      : cost.stale
      ? 'Cutting plan is stale — regenerate for current nested cost.'
      : 'Padded cost — cutting plan not yet generated.';

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', className)} title={title}>
      <span>{formatCurrency(cost.amount)}</span>
      <span className={cn('rounded-sm px-1.5 py-0.5 text-[10px] uppercase tracking-wide', basisColor)}>
        {basisLabel}
      </span>
    </span>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/features/orders/LineMaterialCostBadge.tsx
git commit -m "feat(orders): LineMaterialCostBadge — basis/stale indicator for line material cost"
```

---

## Task 11: UI — render material cost on ProductsTableRow

**Files:**
- Modify: `components/features/orders/ProductsTableRow.tsx`

**Context:** Add a new "Material" column showing the line's material cost with the basis badge. Data comes from the new API via a React Query hook.

- [ ] **Step 1: Read the current row structure**

Run: `grep -n "function.*Row\|<td\|<TableCell" components/features/orders/ProductsTableRow.tsx | head -20` to find cell structure.

- [ ] **Step 2: Add a query hook**

At the top of `ProductsTableRow.tsx`, inside the component, add:

```typescript
import { useQuery } from '@tanstack/react-query';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import { LineMaterialCostBadge } from './LineMaterialCostBadge';
import type { LineMaterialCost } from '@/lib/orders/line-material-cost';

// Inside the component body, after existing hooks:
// Use authorizedFetch — the material-cost route calls getRouteClient()
// which needs a Bearer token (Supabase persists the session in localStorage
// by default, so plain fetch would 401).
const materialCostQuery = useQuery<LineMaterialCost>({
  queryKey: ['order-line-material-cost', orderId, detail.order_detail_id],
  queryFn: async () => {
    const res = await authorizedFetch(`/api/orders/${orderId}/details/${detail.order_detail_id}/material-cost`);
    if (!res.ok) throw new Error('Failed to fetch material cost');
    return res.json();
  },
  staleTime: 30_000,
});
```

- [ ] **Step 3: Render the badge in a new cell**

Add a new `<td>` (match the existing row's cell tag) adjacent to the unit-price cell around line 135. Use shadcn typography:

```tsx
<td className="px-3 py-2 text-right">
  <LineMaterialCostBadge
    cost={materialCostQuery.data ?? null}
    loading={materialCostQuery.isLoading}
  />
</td>
```

- [ ] **Step 4: Add matching header**

Find the corresponding `<thead>` — search: `grep -rn "ProductsTableRow\|<thead" components/features/orders | head -5`. Add `<th className="text-right">Material</th>` in the right position.

- [ ] **Step 5: Visual verification via Chrome MCP**

1. Start dev server if not running: `npm run dev -- --webpack`.
2. Log in via Chrome MCP (use testai credentials from MEMORY.md).
3. Navigate to an order detail page with cutlist products.
4. Take screenshot — expect the Material column showing amount + basis badge ("padded" grey, or "nested" green if plan exists).
5. Generate a cutting plan → reload → expect badges to flip to "nested".
6. Edit a line quantity → expect badges to stay "padded" with "stale" amber (since plan is now stale).

- [ ] **Step 6: Lint**

Run: `npm run lint -- components/features/orders`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add components/features/orders/ProductsTableRow.tsx
git commit -m "feat(orders): render line material cost with basis badge on products table"
```

---

## Task 12: Integration smoke — verify nested allocation end-to-end

**Files:**
- None (verification only)

- [ ] **Step 1: Build a test order**

1. Create a new order (via UI) with 2 lines of the same cutlist product (e.g. TestChair LC2 × 2 qty each, two lines).
2. Open the Cutting Plan tab → Generate → Save.

- [ ] **Step 2: Compare padded vs nested**

Before plan: each line's material cost (via the new badge) should equal the per-product padded × qty.

After plan: each line's badge should flip to "nested" green. Sum of the two lines' nested amounts should equal the plan's `total_nested_cost` + both lines' non-cutlist portions.

Verify via SQL:

```sql
SELECT
  cutting_plan->'total_nested_cost' as total_nested,
  cutting_plan->'line_allocations' as allocations,
  cutting_plan->>'stale' as stale
FROM orders WHERE order_id = <id>;
```

- [ ] **Step 3: Verify stale-on-edit**

1. Edit one line's quantity.
2. Reload order page → badges should show "padded" + amber "stale".
3. Cutting Plan tab → Regenerate → Save → badges flip back to green "nested" with new allocations.

- [ ] **Step 4: Verify stale-on-material-substitution**

1. With a fresh plan saved, open the Material Assignments grid on the Cutting Plan tab.
2. Change a line's material substitution (e.g. swap primary board on one line).
3. Reload the order page → badges flip to "padded" + amber "stale" (because Task 8 hashes `material_assignments` into `source_revision`).
4. Regenerate → badges return to green "nested".

- [ ] **Step 5: Verify PO stale warning**

1. With plan in stale state (from Step 3 or 4, before regenerate), click **Create PO / Order Components**.
2. Dialog opens with amber "Cutting plan is stale" banner and "Open cutting plan" button.
3. Click button → dialog closes, page switches to Cutting Plan tab.
4. Product snapshot changes do **NOT** stale the order (frozen-by-design). Optional: edit a product's cutlist parts → reload order → no banner should appear.

- [ ] **Step 6: Lint and typecheck final pass**

```bash
npm run lint
npx tsc --noEmit
```

Both expected clean. Report any pre-existing errors that are not from this plan.

- [ ] **Step 7: Commit verification notes**

```bash
git commit --allow-empty -m "chore(orders): integration smoke — line-material-cost end-to-end verified"
```

---

## Rollout / migration notes

- No database migration required — all new fields live inside the existing `orders.cutting_plan` JSONB.
- Existing orders without a plan: the new helper returns padded (branch 3), so no data backfill needed.
- Existing orders with a plan saved *before* this plan lands: `line_allocations` will be missing → helper returns padded + stale flag (branch 3-guard), prompting operator to regenerate. Acceptable — this is a non-destructive, explicit re-save.
- The existing `effective-bom` route is left in place for any non-cost consumer (the UI migrates via the new `material-cost` route).

## Open questions resolved during brainstorming + Codex review

See spec §7 for deferred items. The plan above reflects the resolved answers:

- **Allocation rule:** area-weighted across cutlist-bearing lines (Task 2), substitution-safe because weight is geometry, not price.
- **Missing allocation for a line:** defensive fall-back to padded + stale flag (Task 4, test "fresh plan but no allocation…").
- **Stale triggers:** structural edits (`order_details`) and material assignment writes both feed `computeSourceRevision` (Task 8). Product snapshot edits do **not** stale the order — orders are frozen against their captured snapshots by design (spec §6 + Out of Scope).
- **PO costing divergence:** non-blocking amber warning in `OrderComponentsDialog` when plan is stale, with one-click jump to Cutting Plan tab (Task 9). PO creation is not blocked — operators commonly PO before the final layout is locked.
- **Total trust model:** server recomputes `total_nested_cost` from component prices in the PUT handler (Task 7); the client payload's value is ignored.
