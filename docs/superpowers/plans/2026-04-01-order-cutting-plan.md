# Order-Level Cutting Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Cutting Plan tab to the order page that runs cross-product nesting optimization and feeds accurate board/edging quantities to purchasing.

**Architecture:** New `orders.cutting_plan` JSONB column stores optimization results. Client-side packing via existing algorithms. Purchasing RPCs split demand into cutlist vs non-cutlist streams — cutlist demand overridden by cutting plan when fresh. Stale-marking on all mutation endpoints via centralized Postgres function.

**Tech Stack:** Next.js API routes, Supabase Postgres RPCs, existing cutlist packing algorithms (guillotine/strip/SA), React components with existing SheetLayoutGrid primitives.

**Spec:** `docs/superpowers/specs/2026-04-01-order-cutting-plan-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `lib/orders/cutting-plan-types.ts` | TypeScript types for `cutting_plan` JSONB shape |
| `lib/orders/cutting-plan-utils.ts` | `computeSourceRevision()`, `buildCuttingPlanPayload()`, `markCuttingPlanStale()` |
| `app/api/orders/[orderId]/cutting-plan/aggregate/route.ts` | GET — aggregate cutlist snapshots with revision hash |
| `app/api/orders/[orderId]/cutting-plan/route.ts` | PUT (confirm with revision check) + DELETE (clear) |
| `components/features/orders/CuttingPlanTab.tsx` | Main tab component with four states |
| `components/features/orders/CuttingPlanViewer.tsx` | Read-only sheet layout viewer using SheetLayoutGrid |
| `hooks/useOrderCuttingPlan.ts` | React hook for loading/saving cutting plan state |
| `supabase/migrations/20260401000000_cutting_plan_foundation.sql` | Column, stale function, RPC NUMERIC fix |
| `supabase/migrations/20260401000001_cutting_plan_aware_rpcs.sql` | Updated RPCs with cutlist/non-cutlist split |

### Modified Files

| File | Change |
|------|--------|
| `components/features/orders/SmartButtonsRow.tsx` | Add "Cutting Plan" tab to tabs array |
| `app/orders/[orderId]/page.tsx` | Render CuttingPlanTab when activeTab = 'cutting-plan' |
| `app/api/order-details/[detailId]/route.ts` | Call `markCuttingPlanStale()` in PATCH and DELETE |
| `app/api/orders/[orderId]/add-products/route.ts` | Call `markCuttingPlanStale()` after insert |
| `app/api/orders/[orderId]/details/[detailId]/cutlist/route.ts` | Call `markCuttingPlanStale()` in PATCH |
| `lib/queries/order-components.ts` | Read `orders.cutting_plan` for effective requirements |

---

## Phase 1: Data Foundation

### Task 1: Migration — Column, Stale Function, NUMERIC Fix

**Files:**
- Create: `supabase/migrations/20260401000000_cutting_plan_foundation.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 1. Add cutting_plan column to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cutting_plan jsonb;

COMMENT ON COLUMN orders.cutting_plan IS
  'Optimized cutting plan from order-level nesting. NULL = no plan generated.
   When present and not stale, purchasing RPCs use component_overrides
   instead of naive BOM quantities for cutlist materials.';

-- 2. Centralized stale-marking function (idempotent, race-safe)
CREATE OR REPLACE FUNCTION mark_cutting_plan_stale(p_order_id INT)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE orders
  SET cutting_plan = jsonb_set(cutting_plan, '{stale}', 'true'::jsonb)
  WHERE order_id = p_order_id
    AND cutting_plan IS NOT NULL
    AND (cutting_plan->>'stale')::boolean IS DISTINCT FROM true;
END;
$$;

-- 3. Fix RPC return types: INT → NUMERIC for fractional edging support
-- (Handled in Task 4's RPC rewrite — the new function signature uses NUMERIC)
```

- [ ] **Step 2: Apply the migration**

Run via Supabase MCP `execute_sql` or dashboard SQL editor.

- [ ] **Step 3: Verify**

```sql
-- Column exists
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'orders' AND column_name = 'cutting_plan';

-- Function exists
SELECT proname FROM pg_proc WHERE proname = 'mark_cutting_plan_stale';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260401000000_cutting_plan_foundation.sql
git commit -m "feat: add cutting_plan column and stale-marking function"
```

---

### Task 2: TypeScript Types for Cutting Plan

**Files:**
- Create: `lib/orders/cutting-plan-types.ts`

- [ ] **Step 1: Write the types**

```typescript
import type { SheetLayout, StockSheetSpec } from '@/lib/cutlist/types';

// ─── Persisted JSONB shape on orders.cutting_plan ────────────────────────

export type CuttingPlanOverride = {
  component_id: number;
  quantity: number;
  unit: 'sheets' | 'mm';
  source: 'cutlist_primary' | 'cutlist_backer' | 'cutlist_edging';
};

export type CuttingPlanEdgingEntry = {
  component_id: number;
  component_name: string;
  thickness_mm: number;
  length_mm: number;
  unit: 'mm';
};

export type CuttingPlanMaterialGroup = {
  board_type: string;
  primary_material_id: number | null;
  primary_material_name: string | null;
  backer_material_id: number | null;
  backer_material_name: string | null;
  sheets_required: number;
  backer_sheets_required: number;
  edging_by_material: CuttingPlanEdgingEntry[];
  total_parts: number;
  waste_percent: number;
  bom_estimate_sheets: number;
  bom_estimate_backer_sheets: number;
  layouts: SheetLayout[];
  stock_sheet_spec: { length_mm: number; width_mm: number };
};

export type CuttingPlan = {
  version: 1;
  generated_at: string;
  optimization_quality: 'fast' | 'balanced' | 'quality';
  stale: boolean;
  source_revision: string;
  material_groups: CuttingPlanMaterialGroup[];
  component_overrides: CuttingPlanOverride[];
};

// ─── Aggregate endpoint response ─────────────────────────────────────────

export type AggregatedPartGroup = {
  board_type: string;
  primary_material_id: number | null;
  primary_material_name: string | null;
  backer_material_id: number | null;
  backer_material_name: string | null;
  parts: AggregatedPart[];
};

export type AggregatedPart = {
  id: string;                // namespaced: `${order_detail_id}-${original_id}`
  original_id: string;
  order_detail_id: number;
  product_name: string;
  name: string;
  grain: string;
  quantity: number;
  width_mm: number;
  length_mm: number;
  band_edges: Record<string, boolean>;
  lamination_type: string;
  lamination_config?: unknown;
  material_thickness?: number;
  edging_material_id?: string;
  material_label?: string;
};

export type AggregateResponse = {
  order_id: number;
  source_revision: string;
  material_groups: AggregatedPartGroup[];
  total_parts: number;
  has_cutlist_items: boolean;
};
```

- [ ] **Step 2: Commit**

```bash
git add lib/orders/cutting-plan-types.ts
git commit -m "feat: add TypeScript types for cutting plan JSONB"
```

---

### Task 3: Utility Functions

**Files:**
- Create: `lib/orders/cutting-plan-utils.ts`

- [ ] **Step 1: Write computeSourceRevision**

This hashes the order details state so the confirm endpoint can detect changes.

```typescript
import crypto from 'crypto';

/**
 * Compute a hash of order details state for stale-save detection.
 * Inputs: detail IDs, quantities, and cutlist snapshot content.
 */
export function computeSourceRevision(
  details: Array<{
    order_detail_id: number;
    quantity: number;
    cutlist_snapshot: unknown;
  }>
): string {
  const payload = details
    .sort((a, b) => a.order_detail_id - b.order_detail_id)
    .map((d) => `${d.order_detail_id}:${d.quantity}:${JSON.stringify(d.cutlist_snapshot ?? null)}`)
    .join('|');
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}
```

- [ ] **Step 2: Write markCuttingPlanStale helper**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Mark the cutting plan as stale for the order that owns a given order_detail.
 * Safe to call when no cutting plan exists (no-op).
 */
export async function markCuttingPlanStaleForDetail(
  detailOrderId: number,
  supabase: SupabaseClient
) {
  await supabase.rpc('mark_cutting_plan_stale', { p_order_id: detailOrderId });
}

/**
 * Mark the cutting plan as stale for a given order.
 */
export async function markCuttingPlanStale(
  orderId: number,
  supabase: SupabaseClient
) {
  await supabase.rpc('mark_cutting_plan_stale', { p_order_id: orderId });
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/orders/cutting-plan-utils.ts
git commit -m "feat: add cutting plan utility functions"
```

---

## Phase 2: Aggregate & Confirm API

### Task 4: Aggregate Endpoint

**Files:**
- Create: `app/api/orders/[orderId]/cutting-plan/aggregate/route.ts`

- [ ] **Step 1: Write the aggregate endpoint**

This extends the existing `export-cutlist` logic with three-part grouping key, namespaced part IDs, full part model, and source revision.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getRouteClient } from '@/lib/supabase-route';
import { computeSourceRevision } from '@/lib/orders/cutting-plan-utils';
import type {
  AggregatedPart,
  AggregatedPartGroup,
  AggregateResponse,
} from '@/lib/orders/cutting-plan-types';

type RouteParams = { orderId: string };

type SnapshotPart = {
  id: string;
  name: string;
  grain: string;
  quantity: number;
  width_mm: number;
  length_mm: number;
  band_edges: Record<string, boolean>;
  lamination_type: string;
  lamination_config?: unknown;
  material_thickness?: number;
  edging_material_id?: string;
  material_label?: string;
};

type SnapshotGroup = {
  source_group_id: number;
  name: string;
  board_type: string;
  primary_material_id: number | null;
  primary_material_name: string | null;
  backer_material_id: number | null;
  backer_material_name: string | null;
  parts: SnapshotPart[];
};

export async function GET(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await getRouteClient(request);
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { orderId } = await context.params;
  const orderIdNum = Number(orderId);
  if (!Number.isFinite(orderIdNum) || orderIdNum <= 0) {
    return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
  }

  const { data: details, error } = await auth.supabase
    .from('order_details')
    .select('order_detail_id, product_id, quantity, cutlist_snapshot, products(name)')
    .eq('order_id', orderIdNum);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!details || details.length === 0) {
    return NextResponse.json({ error: 'No order details found' }, { status: 404 });
  }

  const sourceRevision = computeSourceRevision(
    details.map((d) => ({
      order_detail_id: d.order_detail_id,
      quantity: d.quantity ?? 1,
      cutlist_snapshot: d.cutlist_snapshot,
    }))
  );

  // Three-part grouping key: board_type + primary_material_id + backer_material_id
  const groupMap = new Map<string, AggregatedPartGroup>();
  let totalParts = 0;
  let hasCutlistItems = false;

  for (const detail of details) {
    const groups: SnapshotGroup[] = detail.cutlist_snapshot ?? [];
    if (groups.length === 0) continue;
    hasCutlistItems = true;

    const lineQty = detail.quantity ?? 1;
    const productName = (detail.products as any)?.name ?? '';

    for (const group of groups) {
      const key = `${group.board_type}|${group.primary_material_id ?? 'none'}|${group.backer_material_id ?? 'none'}`;

      if (!groupMap.has(key)) {
        groupMap.set(key, {
          board_type: group.board_type,
          primary_material_id: group.primary_material_id,
          primary_material_name: group.primary_material_name,
          backer_material_id: group.backer_material_id,
          backer_material_name: group.backer_material_name,
          parts: [],
        });
      }

      const target = groupMap.get(key)!;
      for (const part of group.parts) {
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
  }

  const response: AggregateResponse = {
    order_id: orderIdNum,
    source_revision: sourceRevision,
    material_groups: Array.from(groupMap.values()),
    total_parts: totalParts,
    has_cutlist_items: hasCutlistItems,
  };

  return NextResponse.json(response);
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/orders/\[orderId\]/cutting-plan/aggregate/route.ts
git commit -m "feat: add cutting plan aggregate endpoint"
```

---

### Task 5: Confirm (PUT) and Clear (DELETE) Endpoints

**Files:**
- Create: `app/api/orders/[orderId]/cutting-plan/route.ts`

- [ ] **Step 1: Write PUT and DELETE handlers**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { computeSourceRevision } from '@/lib/orders/cutting-plan-utils';
import type { CuttingPlan } from '@/lib/orders/cutting-plan-types';

type RouteParams = { orderId: string };

function parseOrderId(orderId: string): number | null {
  const parsed = Number.parseInt(orderId, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function PUT(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const access = await requireModuleAccess(request, MODULE_KEYS.ORDERS_FULFILLMENT);
  if ('error' in access) return access.error;
  if (!access.orgId) {
    return NextResponse.json({ error: 'Organization context required' }, { status: 403 });
  }

  const { orderId: orderIdParam } = await context.params;
  const orderId = parseOrderId(orderIdParam);
  if (!orderId) return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });

  let body: CuttingPlan;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.source_revision || !Array.isArray(body.material_groups)) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Verify source revision — reject if order details changed since aggregation
  const { data: details, error: detailsError } = await supabaseAdmin
    .from('order_details')
    .select('order_detail_id, quantity, cutlist_snapshot')
    .eq('order_id', orderId);

  if (detailsError) {
    return NextResponse.json({ error: 'Failed to verify order state' }, { status: 500 });
  }

  const currentRevision = computeSourceRevision(
    (details ?? []).map((d) => ({
      order_detail_id: d.order_detail_id,
      quantity: d.quantity ?? 1,
      cutlist_snapshot: d.cutlist_snapshot,
    }))
  );

  if (currentRevision !== body.source_revision) {
    return NextResponse.json(
      {
        error: 'Order has changed since cutting plan was generated. Please re-aggregate.',
        code: 'REVISION_MISMATCH',
        current_revision: currentRevision,
      },
      { status: 409 }
    );
  }

  // Persist with stale = false
  const planToSave: CuttingPlan = { ...body, stale: false };

  const { error: updateError } = await supabaseAdmin
    .from('orders')
    .update({ cutting_plan: planToSave })
    .eq('order_id', orderId)
    .eq('org_id', access.orgId);

  if (updateError) {
    return NextResponse.json({ error: 'Failed to save cutting plan' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const access = await requireModuleAccess(request, MODULE_KEYS.ORDERS_FULFILLMENT);
  if ('error' in access) return access.error;
  if (!access.orgId) {
    return NextResponse.json({ error: 'Organization context required' }, { status: 403 });
  }

  const { orderId: orderIdParam } = await context.params;
  const orderId = parseOrderId(orderIdParam);
  if (!orderId) return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('orders')
    .update({ cutting_plan: null })
    .eq('order_id', orderId)
    .eq('org_id', access.orgId);

  if (error) {
    return NextResponse.json({ error: 'Failed to clear cutting plan' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/orders/\[orderId\]/cutting-plan/route.ts
git commit -m "feat: add cutting plan confirm (PUT) and clear (DELETE) endpoints"
```

---

## Phase 3: Stale-Marking Hooks

### Task 6: Hook Mutation Endpoints

**Files:**
- Modify: `app/api/order-details/[detailId]/route.ts`
- Modify: `app/api/orders/[orderId]/add-products/route.ts`
- Modify: `app/api/orders/[orderId]/details/[detailId]/cutlist/route.ts`

- [ ] **Step 1: Hook the order-details PATCH and DELETE**

In `app/api/order-details/[detailId]/route.ts`, add stale-marking after successful operations.

At the top of the file, add:
```typescript
import { markCuttingPlanStaleForDetail } from '@/lib/orders/cutting-plan-utils';
```

In the **PATCH handler**, after the successful update (after the `updateData` call succeeds, before the success response), add:
```typescript
// Mark cutting plan stale if order details changed
if (detailExists.order_id) {
  await markCuttingPlanStaleForDetail(detailExists.order_id, supabaseAdmin);
}
```

In the **DELETE handler**, after successful deletion (before the success response), add:
```typescript
// Mark cutting plan stale since a product was removed
await markCuttingPlanStaleForDetail(detailExists.order_id, supabaseAdmin);
```

Note: The existing code already fetches `detailExists` with `order_id` before both operations. Use the `supabaseAdmin` client already imported in the file.

- [ ] **Step 2: Hook the add-products endpoint**

In `app/api/orders/[orderId]/add-products/route.ts`, add stale-marking after inserting new details.

At the top, add:
```typescript
import { markCuttingPlanStale } from '@/lib/orders/cutting-plan-utils';
```

After the successful insert of order details (after the `supabaseAdmin.from('order_details').insert(insertRows)` call), add:
```typescript
// Mark cutting plan stale since products were added
await markCuttingPlanStale(orderId, supabaseAdmin);
```

- [ ] **Step 3: Hook the cutlist edit endpoint**

In `app/api/orders/[orderId]/details/[detailId]/cutlist/route.ts`, add stale-marking after PATCH.

At the top, add:
```typescript
import { markCuttingPlanStale } from '@/lib/orders/cutting-plan-utils';
```

In the PATCH handler, after the successful update, add:
```typescript
await markCuttingPlanStale(orderIdNum, supabase);
```

Note: Use the route's existing `supabase` client (from `getRouteClient`). The `orderId` is already parsed as `orderIdNum` from the route params.

- [ ] **Step 4: Commit**

```bash
git add app/api/order-details/\[detailId\]/route.ts \
  app/api/orders/\[orderId\]/add-products/route.ts \
  app/api/orders/\[orderId\]/details/\[detailId\]/cutlist/route.ts
git commit -m "feat: hook mutation endpoints for cutting plan stale-marking"
```

---

## Phase 4: Purchasing RPC Updates

### Task 7: Snapshot-Aware RPCs with Cutlist/Non-Cutlist Split

**Files:**
- Create: `supabase/migrations/20260401000001_cutting_plan_aware_rpcs.sql`

This is the most critical task — the RPCs must correctly split cutlist vs non-cutlist demand and apply cutting plan overrides.

- [ ] **Step 1: Write the migration**

```sql
-- Update get_detailed_component_status to:
-- 1. Return NUMERIC for order_required/total_required (not INT) for fractional edging
-- 2. Split BOM demand into cutlist vs non-cutlist
-- 3. Use cutting_plan.component_overrides for cutlist demand when plan is fresh
-- 4. Fall back to bom_snapshot for cutlist demand when no plan or plan is stale

DROP FUNCTION IF EXISTS get_detailed_component_status(INT);

CREATE OR REPLACE FUNCTION get_detailed_component_status(p_order_id INT)
RETURNS TABLE (
    component_id INT,
    internal_code TEXT,
    description TEXT,
    order_required NUMERIC,       -- Changed from INT to NUMERIC
    total_required NUMERIC,       -- Changed from INT to NUMERIC
    order_count INT,
    in_stock INT,
    on_order INT,
    apparent_shortfall NUMERIC,
    real_shortfall NUMERIC,
    global_apparent_shortfall NUMERIC,
    global_real_shortfall NUMERIC,
    order_breakdown JSON,
    on_order_breakdown JSON,
    reserved_this_order NUMERIC,
    reserved_by_others NUMERIC
)
LANGUAGE sql
AS $$
WITH
-- Load the cutting plan for the target order (may be NULL)
target_plan AS (
    SELECT
        o.cutting_plan,
        CASE
            WHEN o.cutting_plan IS NOT NULL
                 AND jsonb_typeof(o.cutting_plan) = 'object'
                 AND (o.cutting_plan->>'stale')::boolean IS DISTINCT FROM true
            THEN true
            ELSE false
        END AS plan_is_fresh
    FROM public.orders o
    WHERE o.order_id = p_order_id
),

-- Extract component overrides from the cutting plan (if fresh)
plan_overrides AS (
    SELECT
        (entry->>'component_id')::INT AS component_id,
        (entry->>'quantity')::NUMERIC AS qty
    FROM target_plan tp,
         LATERAL jsonb_array_elements(tp.cutting_plan->'component_overrides') AS entry
    WHERE tp.plan_is_fresh = true
),

-- Set of component IDs that are overridden by the cutting plan
overridden_ids AS (
    SELECT component_id FROM plan_overrides
),

-- NON-CUTLIST demand from bom_snapshot (never overridden)
-- Plus CUTLIST demand when there's no fresh plan
non_cutlist_raw AS (
    -- From snapshot: non-cutlist items always, cutlist items only when no fresh plan
    SELECT
        (entry->>'component_id')::INT AS component_id,
        ((entry->>'quantity_required')::NUMERIC) * od.quantity AS qty
    FROM public.order_details od,
         LATERAL jsonb_array_elements(od.bom_snapshot) AS entry
    WHERE od.order_id = p_order_id
      AND od.bom_snapshot IS NOT NULL
      AND jsonb_typeof(od.bom_snapshot) = 'array'
      AND jsonb_array_length(od.bom_snapshot) > 0
      AND (
          -- Always include non-cutlist items
          COALESCE((entry->>'is_cutlist_item')::boolean, false) = false
          -- Include cutlist items only when plan is NOT fresh
          OR (SELECT NOT plan_is_fresh FROM target_plan)
      )

    UNION ALL

    -- Fallback: live BOM for rows without snapshot (always included)
    SELECT
        bom.component_id,
        bom.quantity_required * od.quantity AS qty
    FROM public.order_details od
    JOIN public.billofmaterials bom ON od.product_id = bom.product_id
    WHERE od.order_id = p_order_id
      AND (od.bom_snapshot IS NULL
           OR jsonb_typeof(od.bom_snapshot) != 'array'
           OR jsonb_array_length(od.bom_snapshot) = 0)
),

-- Combine: non-cutlist/fallback BOM demand + cutting plan overrides
order_components AS (
    -- Non-cutlist BOM demand (and cutlist demand when no fresh plan)
    SELECT r.component_id, SUM(r.qty) AS order_required
    FROM non_cutlist_raw r
    GROUP BY r.component_id

    UNION ALL

    -- Cutting plan overrides (cutlist demand when plan is fresh)
    SELECT po.component_id, po.qty AS order_required
    FROM plan_overrides po
),

-- Final aggregation: if a component appears in both streams, SUM them
order_components_final AS (
    SELECT oc.component_id, SUM(oc.order_required) AS order_required
    FROM order_components oc
    GROUP BY oc.component_id
),

-- Global requirements across all open orders (cutting-plan-aware)
global_raw AS (
    -- For each open order: check if it has a fresh cutting plan
    -- If yes: use overrides for cutlist items, bom for non-cutlist
    -- If no: use bom for everything

    -- Non-cutlist demand (always from BOM snapshot)
    SELECT
        (entry->>'component_id')::INT AS component_id,
        ((entry->>'quantity_required')::NUMERIC) * od.quantity AS qty,
        od.order_id
    FROM public.order_details od
    JOIN public.orders o ON od.order_id = o.order_id
    JOIN public.order_statuses os ON o.status_id = os.status_id
    CROSS JOIN LATERAL jsonb_array_elements(od.bom_snapshot) AS entry
    WHERE os.status_name NOT IN ('Completed', 'Cancelled')
      AND od.bom_snapshot IS NOT NULL
      AND jsonb_typeof(od.bom_snapshot) = 'array'
      AND jsonb_array_length(od.bom_snapshot) > 0
      AND (
          COALESCE((entry->>'is_cutlist_item')::boolean, false) = false
          OR o.cutting_plan IS NULL
          OR jsonb_typeof(o.cutting_plan) != 'object'
          OR (o.cutting_plan->>'stale')::boolean = true
      )

    UNION ALL

    -- Cutlist demand from cutting plan overrides (for orders with fresh plans)
    SELECT
        (entry->>'component_id')::INT AS component_id,
        (entry->>'quantity')::NUMERIC AS qty,
        o.order_id
    FROM public.orders o
    JOIN public.order_statuses os ON o.status_id = os.status_id
    CROSS JOIN LATERAL jsonb_array_elements(o.cutting_plan->'component_overrides') AS entry
    WHERE os.status_name NOT IN ('Completed', 'Cancelled')
      AND o.cutting_plan IS NOT NULL
      AND jsonb_typeof(o.cutting_plan) = 'object'
      AND (o.cutting_plan->>'stale')::boolean IS DISTINCT FROM true

    UNION ALL

    -- Fallback: live BOM for rows without snapshot
    SELECT
        bom.component_id,
        bom.quantity_required * od.quantity AS qty,
        od.order_id
    FROM public.order_details od
    JOIN public.orders o ON od.order_id = o.order_id
    JOIN public.order_statuses os ON o.status_id = os.status_id
    JOIN public.billofmaterials bom ON od.product_id = bom.product_id
    WHERE os.status_name NOT IN ('Completed', 'Cancelled')
      AND (od.bom_snapshot IS NULL
           OR jsonb_typeof(od.bom_snapshot) != 'array'
           OR jsonb_array_length(od.bom_snapshot) = 0)
),
global_requirements AS (
    SELECT
        gr.component_id,
        SUM(gr.qty) AS total_required,
        COUNT(DISTINCT gr.order_id) AS order_count
    FROM global_raw gr
    GROUP BY gr.component_id
),

-- Per-order breakdown (same cutting-plan-aware logic as global_raw)
order_details_raw AS (
    SELECT
        (entry->>'component_id')::INT AS component_id,
        od.order_id,
        ((entry->>'quantity_required')::NUMERIC) * od.quantity AS qty,
        o.order_date,
        os.status_name
    FROM public.order_details od
    JOIN public.orders o ON od.order_id = o.order_id
    JOIN public.order_statuses os ON o.status_id = os.status_id
    CROSS JOIN LATERAL jsonb_array_elements(od.bom_snapshot) AS entry
    WHERE os.status_name NOT IN ('Completed', 'Cancelled')
      AND od.bom_snapshot IS NOT NULL
      AND jsonb_typeof(od.bom_snapshot) = 'array'
      AND jsonb_array_length(od.bom_snapshot) > 0
      AND (
          COALESCE((entry->>'is_cutlist_item')::boolean, false) = false
          OR o.cutting_plan IS NULL
          OR jsonb_typeof(o.cutting_plan) != 'object'
          OR (o.cutting_plan->>'stale')::boolean = true
      )

    UNION ALL

    SELECT
        (entry->>'component_id')::INT AS component_id,
        o.order_id,
        (entry->>'quantity')::NUMERIC AS qty,
        o.order_date,
        os.status_name
    FROM public.orders o
    JOIN public.order_statuses os ON o.status_id = os.status_id
    CROSS JOIN LATERAL jsonb_array_elements(o.cutting_plan->'component_overrides') AS entry
    WHERE os.status_name NOT IN ('Completed', 'Cancelled')
      AND o.cutting_plan IS NOT NULL
      AND jsonb_typeof(o.cutting_plan) = 'object'
      AND (o.cutting_plan->>'stale')::boolean IS DISTINCT FROM true

    UNION ALL

    SELECT
        bom.component_id,
        od.order_id,
        bom.quantity_required * od.quantity AS qty,
        o.order_date,
        os.status_name
    FROM public.order_details od
    JOIN public.orders o ON od.order_id = o.order_id
    JOIN public.order_statuses os ON o.status_id = os.status_id
    JOIN public.billofmaterials bom ON od.product_id = bom.product_id
    WHERE os.status_name NOT IN ('Completed', 'Cancelled')
      AND (od.bom_snapshot IS NULL
           OR jsonb_typeof(od.bom_snapshot) != 'array'
           OR jsonb_array_length(od.bom_snapshot) = 0)
),
order_details AS (
    SELECT
        odr.component_id,
        jsonb_agg(
            jsonb_build_object(
                'order_id', odr.order_id,
                'quantity', odr.qty,
                'order_date', odr.order_date,
                'status', odr.status_name
            )
        ) AS order_breakdown
    FROM order_details_raw odr
    WHERE odr.component_id IN (SELECT oc.component_id FROM order_components_final oc)
    GROUP BY odr.component_id
),

supplier_orders AS (
    SELECT
        sc.component_id,
        jsonb_agg(
            jsonb_build_object(
                'supplier_order_id', so.order_id,
                'supplier_name', s.name,
                'quantity', so.order_quantity,
                'received', so.total_received,
                'status', sos.status_name,
                'order_date', so.order_date
            )
        ) AS on_order_breakdown
    FROM public.supplier_orders so
    JOIN public.suppliercomponents sc ON so.supplier_component_id = sc.supplier_component_id
    JOIN public.suppliers s ON sc.supplier_id = s.supplier_id
    JOIN public.supplier_order_statuses sos ON so.status_id = sos.status_id
    WHERE sos.status_name IN ('Open', 'In Progress', 'Approved', 'Partially Received')
      AND sc.component_id IN (SELECT oc.component_id FROM order_components_final oc)
    GROUP BY sc.component_id
),
reservations_this AS (
    SELECT cr.component_id, COALESCE(SUM(cr.qty_reserved), 0) AS reserved
    FROM public.component_reservations cr
    WHERE cr.order_id = p_order_id
    GROUP BY cr.component_id
),
reservations_others AS (
    SELECT cr.component_id, COALESCE(SUM(cr.qty_reserved), 0) AS reserved
    FROM public.component_reservations cr
    WHERE cr.order_id <> p_order_id
    GROUP BY cr.component_id
)
SELECT
    cs.component_id,
    cs.internal_code,
    cs.description,
    oc.order_required,     -- Now NUMERIC
    gr.total_required,     -- Now NUMERIC
    gr.order_count,
    cs.in_stock::INTEGER,
    cs.allocated_to_orders::INTEGER AS on_order,
    GREATEST(oc.order_required - GREATEST(cs.in_stock - COALESCE(ro.reserved, 0), 0), 0)::NUMERIC AS apparent_shortfall,
    GREATEST(oc.order_required - GREATEST(cs.in_stock - COALESCE(ro.reserved, 0), 0) - cs.allocated_to_orders, 0)::NUMERIC AS real_shortfall,
    GREATEST(gr.total_required - cs.in_stock, 0)::NUMERIC AS global_apparent_shortfall,
    GREATEST(gr.total_required - cs.in_stock - cs.allocated_to_orders, 0)::NUMERIC AS global_real_shortfall,
    COALESCE(od.order_breakdown::JSON, '[]'::JSON) AS order_breakdown,
    COALESCE(so.on_order_breakdown::JSON, '[]'::JSON) AS on_order_breakdown,
    COALESCE(rt.reserved, 0)::NUMERIC AS reserved_this_order,
    COALESCE(ro.reserved, 0)::NUMERIC AS reserved_by_others
FROM
    order_components_final oc
JOIN
    public.component_status_mv cs ON oc.component_id = cs.component_id
JOIN
    global_requirements gr ON oc.component_id = gr.component_id
LEFT JOIN
    order_details od ON oc.component_id = od.component_id
LEFT JOIN
    supplier_orders so ON oc.component_id = so.component_id
LEFT JOIN
    reservations_this rt ON oc.component_id = rt.component_id
LEFT JOIN
    reservations_others ro ON oc.component_id = ro.component_id;
$$;


-- =============================================================================
-- reserve_order_components — cutting-plan-aware
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reserve_order_components(p_order_id INT, p_org_id UUID)
RETURNS TABLE(component_id INT, qty_reserved NUMERIC)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_plan_fresh boolean;
BEGIN
  -- Check if order has a fresh cutting plan
  SELECT
    CASE
      WHEN o.cutting_plan IS NOT NULL
           AND jsonb_typeof(o.cutting_plan) = 'object'
           AND (o.cutting_plan->>'stale')::boolean IS DISTINCT FROM true
      THEN true
      ELSE false
    END INTO v_plan_fresh
  FROM public.orders o
  WHERE o.order_id = p_order_id;

  DELETE FROM public.component_reservations cr
  WHERE cr.order_id = p_order_id AND cr.org_id = p_org_id;

  RETURN QUERY
  INSERT INTO public.component_reservations(order_id, component_id, qty_reserved, org_id)
  SELECT
    p_order_id,
    req.cid,
    GREATEST(0, LEAST(
      req.required_qty,
      COALESCE(inv.on_hand, 0) - COALESCE(other_res.reserved, 0)
    )),
    p_org_id
  FROM (
    SELECT cid, SUM(qty)::NUMERIC AS required_qty
    FROM (
      -- Non-cutlist from snapshot (always included)
      -- Plus cutlist from snapshot when no fresh plan
      SELECT
        (entry->>'component_id')::INT AS cid,
        ((entry->>'quantity_required')::NUMERIC) * od.quantity AS qty
      FROM public.order_details od,
           LATERAL jsonb_array_elements(od.bom_snapshot) AS entry
      WHERE od.order_id = p_order_id
        AND od.bom_snapshot IS NOT NULL
        AND jsonb_typeof(od.bom_snapshot) = 'array'
        AND jsonb_array_length(od.bom_snapshot) > 0
        AND (
            COALESCE((entry->>'is_cutlist_item')::boolean, false) = false
            OR v_plan_fresh IS NOT TRUE
        )

      UNION ALL

      -- Cutting plan overrides (when fresh)
      SELECT
        (entry->>'component_id')::INT AS cid,
        (entry->>'quantity')::NUMERIC AS qty
      FROM public.orders o,
           LATERAL jsonb_array_elements(o.cutting_plan->'component_overrides') AS entry
      WHERE o.order_id = p_order_id
        AND v_plan_fresh = true

      UNION ALL

      -- Fallback: live BOM for rows without snapshot
      SELECT
        bom.component_id AS cid,
        (bom.quantity_required * od.quantity) AS qty
      FROM public.order_details od
      JOIN public.billofmaterials bom ON od.product_id = bom.product_id
      WHERE od.order_id = p_order_id
        AND (od.bom_snapshot IS NULL
             OR jsonb_typeof(od.bom_snapshot) != 'array'
             OR jsonb_array_length(od.bom_snapshot) = 0)
    ) raw
    GROUP BY cid
  ) req
  LEFT JOIN (
    SELECT i.component_id AS cid, COALESCE(i.quantity_on_hand, 0)::NUMERIC AS on_hand
    FROM public.inventory i
  ) inv ON inv.cid = req.cid
  LEFT JOIN (
    SELECT cr2.component_id AS cid, SUM(cr2.qty_reserved)::NUMERIC AS reserved
    FROM public.component_reservations cr2
    WHERE cr2.order_id <> p_order_id AND cr2.org_id = p_org_id
    GROUP BY cr2.component_id
  ) other_res ON other_res.cid = req.cid
  WHERE GREATEST(0, LEAST(
    req.required_qty,
    COALESCE(inv.on_hand, 0) - COALESCE(other_res.reserved, 0)
  )) > 0
  RETURNING component_reservations.component_id, component_reservations.qty_reserved;
END;
$function$;
```

- [ ] **Step 2: Apply the migration**

Run via Supabase MCP `execute_sql` or dashboard SQL editor.

- [ ] **Step 3: Verify with test query**

```sql
-- Should return NUMERIC columns now
SELECT component_id, order_required, total_required
FROM get_detailed_component_status(401)
LIMIT 3;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260401000001_cutting_plan_aware_rpcs.sql
git commit -m "feat: cutting-plan-aware RPCs with cutlist/non-cutlist split and NUMERIC columns"
```

---

## Phase 5: Components Tab Effective Requirements

### Task 8: Update fetchOrderComponentRequirements

**Files:**
- Modify: `lib/queries/order-components.ts`

- [ ] **Step 1: Read cutting_plan in the order query**

The RPC now handles cutting plan awareness server-side, so the TypeScript layer just needs to pass through the NUMERIC values correctly. The key change: `fetchOrderComponentRequirements` must also fetch the order's `cutting_plan` to determine if a plan is active (for UI display purposes — e.g., showing "optimized" badge).

At the top of `fetchOrderComponentRequirements`, modify the order_details query to also fetch the order's cutting plan:

```typescript
// Add after fetching orderDetails (around line 96):
const { data: orderData } = await supabase
  .from('orders')
  .select('cutting_plan')
  .eq('order_id', orderId)
  .maybeSingle();

const cuttingPlan = orderData?.cutting_plan as CuttingPlan | null;
const hasFreshPlan = cuttingPlan != null && !cuttingPlan.stale;
```

Add the import at the top:
```typescript
import type { CuttingPlan } from '@/lib/orders/cutting-plan-types';
```

The RPC results already reflect the cutting plan (since the RPCs now read it server-side). The `quantity_required` computed client-side from `bom_snapshot` multiplication is used for display in the per-product breakdown, while the RPC's `order_required` (which now accounts for the cutting plan) is the authoritative shortfall number. This is already how the code works — it uses `status?.apparent_shortfall` from the RPC for shortfall display.

No other changes needed — the RPCs handle the cutting plan logic.

- [ ] **Step 2: Commit**

```bash
git add lib/queries/order-components.ts
git commit -m "feat: fetch cutting_plan in component requirements for UI awareness"
```

---

## Phase 6: Cutting Plan Tab UI

### Task 9: Order Cutting Plan Hook

**Files:**
- Create: `hooks/useOrderCuttingPlan.ts`

- [ ] **Step 1: Write the hook**

```typescript
'use client';

import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authorizedFetch } from '@/lib/client/auth-fetch';
import type {
  AggregateResponse,
  CuttingPlan,
} from '@/lib/orders/cutting-plan-types';

export function useOrderCuttingPlan(orderId: number) {
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);

  // Fetch current cutting plan from order
  const planQuery = useQuery({
    queryKey: ['order-cutting-plan', orderId],
    queryFn: async () => {
      const res = await authorizedFetch(`/api/orders/${orderId}`);
      if (!res.ok) throw new Error('Failed to fetch order');
      const data = await res.json();
      return (data.cutting_plan ?? null) as CuttingPlan | null;
    },
  });

  // Fetch aggregated cutlist data for packing
  const aggregate = useCallback(async (): Promise<AggregateResponse> => {
    const res = await authorizedFetch(
      `/api/orders/${orderId}/cutting-plan/aggregate`
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to aggregate cutlist data');
    }
    return res.json();
  }, [orderId]);

  // Confirm (save) the cutting plan
  const confirm = useCallback(
    async (plan: CuttingPlan) => {
      setIsSaving(true);
      try {
        const res = await authorizedFetch(
          `/api/orders/${orderId}/cutting-plan`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(plan),
          }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (body.code === 'REVISION_MISMATCH') {
            throw new Error(
              'Order has changed since the cutting plan was generated. Please re-generate.'
            );
          }
          throw new Error(body.error || 'Failed to save cutting plan');
        }
        // Invalidate related queries
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['order-cutting-plan', orderId] }),
          queryClient.invalidateQueries({ queryKey: ['order-components', orderId] }),
          queryClient.invalidateQueries({ queryKey: ['component-suppliers', orderId] }),
        ]);
      } finally {
        setIsSaving(false);
      }
    },
    [orderId, queryClient]
  );

  // Clear the cutting plan
  const clear = useCallback(async () => {
    const res = await authorizedFetch(
      `/api/orders/${orderId}/cutting-plan`,
      { method: 'DELETE' }
    );
    if (!res.ok) throw new Error('Failed to clear cutting plan');
    await queryClient.invalidateQueries({ queryKey: ['order-cutting-plan', orderId] });
  }, [orderId, queryClient]);

  return {
    plan: planQuery.data ?? null,
    isLoading: planQuery.isLoading,
    isSaving,
    aggregate,
    confirm,
    clear,
    refetch: planQuery.refetch,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add hooks/useOrderCuttingPlan.ts
git commit -m "feat: add useOrderCuttingPlan hook"
```

---

### Task 10: CuttingPlanTab Component

**Files:**
- Create: `components/features/orders/CuttingPlanTab.tsx`

This is the largest UI task. It implements the four states: hidden (handled by parent), empty, stale, fresh.

- [ ] **Step 1: Write the component**

This component handles:
- Empty state with generate button + quality picker
- Stale state with warning banner
- Fresh state with summary cards + material breakdown table
- Generate/re-optimize flow using the existing packing algorithms client-side
- Confirm flow via the hook

The implementation should:
1. Use `useOrderCuttingPlan` hook for data and actions
2. Use the packing functions from `components/features/cutlist/packing.ts` for client-side optimization
3. Use `expandPartsWithLamination` from `lib/cutlist/boardCalculator.ts` for lamination expansion
4. Build the `CuttingPlan` JSONB payload from the `CutlistSummary` and calculator state

Due to the complexity, this component should be built iteratively:
- First: empty and stale states (static UI)
- Then: the generate flow (aggregate → pack → display results)
- Then: the confirm flow (build payload → PUT)
- Then: the material breakdown table with BOM comparison

The exact implementation will depend on how the packing functions are integrated (they need stock sheet specs and kerf config). Follow the patterns in `CutlistCalculator.tsx` lines 600-900 for how the calculator runs packing.

- [ ] **Step 2: Commit incrementally as each sub-feature is completed**

---

### Task 11: Add Tab to Order Page

**Files:**
- Modify: `components/features/orders/SmartButtonsRow.tsx`
- Modify: `app/orders/[orderId]/page.tsx`

- [ ] **Step 1: Add tab button to SmartButtonsRow**

In the tabs array (around line 42-81), add after the `job-cards` entry:

```typescript
{
  id: 'cutting-plan',
  label: 'Cutting Plan',
  icon: <Scissors className="h-4 w-4" />,
  count: 0, // Will be enhanced later to show sheet count
},
```

Add the Scissors import at the top:
```typescript
import { Scissors } from 'lucide-react';
```

Note: Only show this tab when the order has cutlist items. The parent should pass a `hasCutlistItems` prop. If the order has no cutlist snapshots at all, omit it from the array.

- [ ] **Step 2: Render CuttingPlanTab in the order page**

In `app/orders/[orderId]/page.tsx`, add the conditional render block after the `job-cards` block (around line 1413):

```typescript
{activeTab === 'cutting-plan' && (
  <CuttingPlanTab orderId={orderId} />
)}
```

Add the import:
```typescript
import CuttingPlanTab from '@/components/features/orders/CuttingPlanTab';
```

- [ ] **Step 3: Commit**

```bash
git add components/features/orders/SmartButtonsRow.tsx app/orders/\[orderId\]/page.tsx
git commit -m "feat: add Cutting Plan tab to order page"
```

---

## Phase 7: Sheet Layout Viewer

### Task 12: CuttingPlanViewer Component

**Files:**
- Create: `components/features/orders/CuttingPlanViewer.tsx`

- [ ] **Step 1: Write the viewer**

Build from existing `SheetLayoutGrid` (`components/features/cutlist/primitives/SheetLayoutGrid.tsx`) which already handles sheet pagination, placement visualization, and the `CuttingDiagramButton` for PDF export.

```typescript
'use client';

import { useState } from 'react';
import type { CuttingPlanMaterialGroup } from '@/lib/orders/cutting-plan-types';
import type { LayoutResult, StockSheetSpec } from '@/lib/cutlist/types';

// Dynamic import for SheetLayoutGrid (uses react-pdf internally)
import dynamic from 'next/dynamic';
const SheetLayoutGrid = dynamic(
  () => import('@/components/features/cutlist/primitives/SheetLayoutGrid').then(m => m.SheetLayoutGrid),
  { ssr: false }
);

interface CuttingPlanViewerProps {
  materialGroups: CuttingPlanMaterialGroup[];
  onClose: () => void;
}

export default function CuttingPlanViewer({ materialGroups, onClose }: CuttingPlanViewerProps) {
  const [selectedGroupIdx, setSelectedGroupIdx] = useState(0);
  const group = materialGroups[selectedGroupIdx];

  if (!group) return null;

  const result: LayoutResult = {
    sheets: group.layouts,
    stats: {
      used_area_mm2: 0,
      waste_area_mm2: 0,
      cuts: 0,
      cut_length_mm: 0,
    },
  };

  const stockSheet: StockSheetSpec = {
    id: 'stock',
    length_mm: group.stock_sheet_spec.length_mm,
    width_mm: group.stock_sheet_spec.width_mm,
    qty: group.sheets_required,
  };

  return (
    <div className="space-y-4">
      {/* Material group selector */}
      {materialGroups.length > 1 && (
        <div className="flex gap-2">
          {materialGroups.map((mg, i) => (
            <button
              key={`${mg.primary_material_id}-${mg.backer_material_id}`}
              onClick={() => setSelectedGroupIdx(i)}
              className={`px-3 py-1.5 rounded-sm text-sm ${
                i === selectedGroupIdx
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {mg.primary_material_name ?? 'Unknown'} ({mg.sheets_required} sheets)
            </button>
          ))}
        </div>
      )}

      {/* Sheet layouts */}
      <SheetLayoutGrid
        result={result}
        stockSheet={stockSheet}
        globalFullBoard={false}
        onGlobalFullBoardChange={() => {}}
        sheetOverrides={{}}
        onSheetOverridesChange={() => {}}
      />

      <button
        onClick={onClose}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Back to summary
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/features/orders/CuttingPlanViewer.tsx
git commit -m "feat: add CuttingPlanViewer for read-only sheet layout display"
```

---

## Phase 8: Verification

### Task 13: End-to-End Verification

- [ ] **Step 1: Verify with existing test order (401)**

This order has `bom_snapshot` with substituted components and `cutlist_snapshot`. Use the Chrome MCP to:
1. Navigate to order 401
2. Confirm the Cutting Plan tab appears
3. Click "Generate Cutting Plan" with "Fast" quality
4. Verify the material breakdown table renders with sheet counts
5. Click "Confirm" and verify it saves

- [ ] **Step 2: Verify purchasing integration**

After confirming the cutting plan:
1. Navigate to the Components tab — verify quantities reflect the cutting plan
2. Open "Order Components" dialog — verify shortfalls use cutting plan quantities
3. Verify non-cutlist components (hardware) are unaffected

- [ ] **Step 3: Verify invalidation**

1. Add a product to the order
2. Verify the Cutting Plan tab shows the stale warning banner
3. Verify the Components tab falls back to BOM quantities

- [ ] **Step 4: Verify stale-save protection**

1. Generate a cutting plan (note the revision)
2. In another tab, change a product quantity
3. Try to confirm the stale plan — verify 409 error

- [ ] **Step 5: Verify fractional edging**

Check that the Components tab correctly shows fractional edging quantities (not truncated to integer).

- [ ] **Step 6: Run lint**

```bash
npm run lint
```

- [ ] **Step 7: Commit any fixes**

```bash
git add -A
git commit -m "fix: verification fixes for cutting plan integration"
```

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1: Data Foundation | 1-3 | Migration, types, utils |
| 2: Aggregate & Confirm API | 4-5 | Server endpoints with revision safety |
| 3: Stale-Marking Hooks | 6 | Hook all mutation endpoints |
| 4: Purchasing RPCs | 7 | Cutlist/non-cutlist split, NUMERIC columns |
| 5: Components Tab | 8 | Effective requirements awareness |
| 6: Cutting Plan Tab UI | 9-11 | Hook, tab component, page integration |
| 7: Sheet Layout Viewer | 12 | Read-only viewer from SheetLayoutGrid |
| 8: Verification | 13 | End-to-end testing |
