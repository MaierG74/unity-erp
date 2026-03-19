# Component Stock Reservation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to reserve on-hand component stock against specific orders, so multiple orders competing for the same materials have clear visibility into what's truly available vs. already spoken for.

**Architecture:** Mirrors the existing `product_reservations` (FG) pattern — a new `component_reservations` table stores per-order component reservations. A new RPC `reserve_order_components` calculates available component qty (on-hand minus reserved-by-other-orders) and reserves up to what the order needs. The existing `get_detailed_component_status` RPC is extended with a `reserved_by_others` column so the UI can show true availability. The order page gets a "Reserve Components" button next to the existing "Reserve Stock" (FG) button, and the ProductsTableRow BOM expansion gains an "AVAILABLE" column.

**Tech Stack:** PostgreSQL (Supabase migrations), Next.js API routes, React Query mutations, existing Supabase RPC pattern

**Key Reference Files:**
- FG reservation pattern to mirror: `db/migrations/20250920_fg_reservations.sql`
- Component status RPC to extend: `sql/create_component_views.sql` (lines 164-298)
- Order page orchestration: `app/orders/[orderId]/page.tsx`
- BOM row rendering: `components/features/orders/ProductsTableRow.tsx`
- Component data fetching: `lib/queries/order-components.ts`
- API route pattern: `app/api/orders/[orderId]/reserve-fg/route.ts`

---

## Task 1: Create `component_reservations` table

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_component_reservations.sql`

**Context:** This mirrors `product_reservations` (see `db/migrations/20250920_fg_reservations.sql` lines 5-15). The table stores how many units of a component are earmarked for a specific order. RLS must be org-scoped per `CLAUDE.md` tenancy rules.

**Step 1: Write the migration**

```sql
-- Component-level stock reservations
-- Mirrors product_reservations (FG) but for raw materials/components

CREATE TABLE IF NOT EXISTS public.component_reservations (
  id          BIGSERIAL PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES public.orders(order_id) ON DELETE CASCADE,
  component_id INTEGER NOT NULL REFERENCES public.components(component_id) ON DELETE CASCADE,
  qty_reserved NUMERIC NOT NULL DEFAULT 0 CHECK (qty_reserved > 0),
  reserved_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  org_id      UUID NOT NULL REFERENCES public.organizations(id),
  UNIQUE(order_id, component_id)
);

CREATE INDEX idx_component_reservations_order ON public.component_reservations(order_id);
CREATE INDEX idx_component_reservations_component ON public.component_reservations(component_id);
CREATE INDEX idx_component_reservations_org ON public.component_reservations(org_id);

-- RLS
ALTER TABLE public.component_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view component reservations in their org"
  ON public.component_reservations FOR SELECT
  USING (org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Users can manage component reservations in their org"
  ON public.component_reservations FOR ALL
  USING (org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid()));
```

**Step 2: Apply the migration**

Run via Supabase MCP: `apply_migration` with name `component_reservations`

**Step 3: Verify with security advisor**

Run: `mcp__supabase__get_advisors` (security) — confirm no missing RLS warnings for the new table.

**Step 4: Commit**

```
feat: add component_reservations table with RLS
```

---

## Task 2: Create `reserve_order_components` RPC

**Files:**
- Create: add to the same migration or a new migration file

**Context:** This mirrors `reserve_finished_goods` (see `db/migrations/20250920_fg_reservations.sql` lines 18-59). For each component required by the order's BOM, it calculates: available = on_hand - reserved_by_other_orders, then reserves min(required, available). Idempotent — clears existing reservations for the order first.

**Step 1: Write the RPC function**

```sql
CREATE OR REPLACE FUNCTION public.reserve_order_components(
  p_order_id INTEGER,
  p_org_id UUID
)
RETURNS TABLE(component_id INTEGER, qty_reserved NUMERIC)
LANGUAGE plpgsql
AS $$
BEGIN
  -- Idempotent: clear existing reservations for this order
  DELETE FROM public.component_reservations cr
  WHERE cr.order_id = p_order_id AND cr.org_id = p_org_id;

  -- Calculate and insert reservations
  RETURN QUERY
  INSERT INTO public.component_reservations(order_id, component_id, qty_reserved, org_id)
  SELECT
    p_order_id,
    req.component_id,
    GREATEST(0, LEAST(
      req.required_qty,
      COALESCE(inv.on_hand, 0) - COALESCE(other_res.reserved, 0)
    )) AS qty_to_reserve,
    p_org_id
  FROM (
    -- Components required for this order (BOM × order qty)
    SELECT
      bom.component_id,
      SUM(bom.quantity_required * od.quantity)::NUMERIC AS required_qty
    FROM public.order_details od
    JOIN public.billofmaterials bom ON od.product_id = bom.product_id
    WHERE od.order_id = p_order_id
    GROUP BY bom.component_id
  ) req
  LEFT JOIN (
    -- Current on-hand inventory
    SELECT i.component_id, COALESCE(i.quantity_on_hand, 0)::NUMERIC AS on_hand
    FROM public.inventory i
  ) inv ON inv.component_id = req.component_id
  LEFT JOIN (
    -- Already reserved by OTHER orders
    SELECT cr.component_id, SUM(cr.qty_reserved)::NUMERIC AS reserved
    FROM public.component_reservations cr
    WHERE cr.order_id <> p_order_id AND cr.org_id = p_org_id
    GROUP BY cr.component_id
  ) other_res ON other_res.component_id = req.component_id
  WHERE GREATEST(0, LEAST(
    req.required_qty,
    COALESCE(inv.on_hand, 0) - COALESCE(other_res.reserved, 0)
  )) > 0
  RETURNING component_id, qty_reserved;
END;
$$;
```

**Step 2: Create `release_order_components` RPC**

```sql
CREATE OR REPLACE FUNCTION public.release_order_components(
  p_order_id INTEGER,
  p_org_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  DELETE FROM public.component_reservations
  WHERE order_id = p_order_id AND org_id = p_org_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
```

**Step 3: Apply the migration**

Run via Supabase MCP: `apply_migration`

**Step 4: Test with a SQL query**

```sql
-- Test: reserve components for an existing order
SELECT * FROM reserve_order_components(<test_order_id>, '<org_id>');

-- Verify rows were created
SELECT * FROM component_reservations WHERE order_id = <test_order_id>;

-- Release and verify
SELECT release_order_components(<test_order_id>, '<org_id>');
SELECT * FROM component_reservations WHERE order_id = <test_order_id>;
-- Should return 0 rows
```

**Step 5: Commit**

```
feat: add reserve/release RPCs for component stock reservation
```

---

## Task 3: Extend `get_detailed_component_status` with reservation data

**Files:**
- Modify: `sql/create_component_views.sql` (lines 164-298) — the `get_detailed_component_status` function

**Context:** The existing RPC returns `in_stock`, `on_order`, `apparent_shortfall`, `global_apparent_shortfall` etc. We need to add `reserved_by_others` (total reserved by all other orders) and `reserved_by_this_order` so the UI can show: Available = in_stock - reserved_by_others. The shortfall calculations should also factor in reservations.

**Step 1: Add two new CTEs and output columns**

Add a CTE for component reservations:

```sql
-- Add inside the function, after the existing CTEs:
component_reservations_this AS (
    SELECT cr.component_id, COALESCE(SUM(cr.qty_reserved), 0) AS reserved
    FROM public.component_reservations cr
    WHERE cr.order_id = p_order_id
    GROUP BY cr.component_id
),
component_reservations_others AS (
    SELECT cr.component_id, COALESCE(SUM(cr.qty_reserved), 0) AS reserved
    FROM public.component_reservations cr
    WHERE cr.order_id <> p_order_id
    GROUP BY cr.component_id
)
```

Add to the RETURNS TABLE clause:

```sql
reserved_this_order NUMERIC,
reserved_by_others NUMERIC
```

Add to the final SELECT:

```sql
COALESCE(crt.reserved, 0)::NUMERIC AS reserved_this_order,
COALESCE(cro.reserved, 0)::NUMERIC AS reserved_by_others
```

With LEFT JOINs:

```sql
LEFT JOIN component_reservations_this crt ON oc.component_id = crt.component_id
LEFT JOIN component_reservations_others cro ON oc.component_id = cro.component_id
```

**Step 2: Update the function via migration**

Write a new Supabase migration that runs `CREATE OR REPLACE FUNCTION get_detailed_component_status(...)` with the updated definition. Copy the full existing function from `sql/create_component_views.sql` and add the new CTEs/columns.

**Step 3: Also update `sql/create_component_views.sql`**

Keep the source-of-truth SQL file in sync with the migration.

**Step 4: Test**

```sql
SELECT component_id, in_stock, reserved_this_order, reserved_by_others
FROM get_detailed_component_status(<order_id>);
```

**Step 5: Commit**

```
feat: extend component status RPC with reservation columns
```

---

## Task 4: Create API routes for component reservation

**Files:**
- Create: `app/api/orders/[orderId]/reserve-components/route.ts`
- Create: `app/api/orders/[orderId]/release-components/route.ts`
- Reference: `app/api/orders/[orderId]/reserve-fg/route.ts` (copy this pattern exactly)

**Context:** These follow the exact same pattern as `reserve-fg/route.ts` and `release-fg/route.ts`. Auth check → org context → call RPC → return JSON.

**Step 1: Create reserve-components route**

```typescript
// app/api/orders/[orderId]/reserve-components/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth-context';

type RouteParams = { orderId: string };

export async function POST(
  request: NextRequest,
  context: { params: Promise<RouteParams> }
) {
  try {
    const { orderId: orderIdStr } = await context.params;
    const orderId = parseInt(orderIdStr, 10);
    if (isNaN(orderId)) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    const auth = await getAuthContext();
    if (!auth?.orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = await createRouteHandlerClient();
    const { data, error } = await supabase.rpc('reserve_order_components', {
      p_order_id: orderId,
      p_org_id: auth.orgId,
    });

    if (error) {
      console.error('[reserve-components] RPC error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const reservations = (data ?? []).map((row: any) => ({
      component_id: row.component_id,
      qty_reserved: Number(row.qty_reserved ?? 0),
    }));

    return NextResponse.json({ success: true, reservations });
  } catch (err: any) {
    console.error('[reserve-components] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

**Step 2: Create release-components route**

Same pattern as `release-fg/route.ts`, calling `release_order_components` RPC.

**Step 3: Create client-side query functions**

Add to `lib/queries/order-components.ts`:

```typescript
export async function reserveOrderComponents(orderId: number) {
  const res = await fetch(`/api/orders/${orderId}/reserve-components`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to reserve components');
  return res.json();
}

export async function releaseOrderComponents(orderId: number) {
  const res = await fetch(`/api/orders/${orderId}/release-components`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to release components');
  return res.json();
}

export async function fetchComponentReservations(orderId: number) {
  const res = await fetch(`/api/orders/${orderId}/component-reservations`);
  if (!res.ok) throw new Error('Failed to fetch component reservations');
  return res.json();
}
```

**Step 4: Commit**

```
feat: add API routes and client functions for component reservation
```

---

## Task 5: Update TypeScript types

**Files:**
- Modify: `types/components.ts` — add reservation fields to `ComponentRequirement`

**Step 1: Extend `ComponentRequirement` interface**

Add these fields (they come from the updated `get_detailed_component_status` RPC):

```typescript
// In ComponentRequirement interface:
reserved_this_order: number;    // Qty reserved for THIS order
reserved_by_others: number;     // Qty reserved by all OTHER orders
```

**Step 2: Add `ComponentReservation` type**

```typescript
export interface ComponentReservation {
  id: number;
  order_id: number;
  component_id: number;
  qty_reserved: number;
  internal_code?: string;
  description?: string;
}
```

**Step 3: Commit**

```
feat: add component reservation types
```

---

## Task 6: Update order page with Reserve/Release Components buttons

**Files:**
- Modify: `app/orders/[orderId]/page.tsx`

**Context:** The order page already has "Reserve Stock" (FG), "Release", and "Ship" buttons in the Stock Reservations section (around line 890+). We add a second row or section for component reservations with "Reserve Components" and "Release Components" buttons.

**Step 1: Add React Query hooks**

Near the existing `reserveFgMutation` (line 515), add:

```typescript
const reserveComponentsMutation = useMutation({
  mutationFn: () => reserveOrderComponents(orderId),
  onSuccess: async () => {
    toast.success('Components reserved');
    await refetchComponentRequirements();
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ['orderComponentRequirements', orderId] });
  },
});

const releaseComponentsMutation = useMutation({
  mutationFn: () => releaseOrderComponents(orderId),
  onSuccess: async () => {
    toast.success('Component reservations released');
    await refetchComponentRequirements();
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ['orderComponentRequirements', orderId] });
  },
});
```

**Step 2: Add UI buttons**

In the Stock Reservations section, add a "Component Reservations" subsection below the existing FG reservation buttons. Include:
- "Reserve Components" button — calls `reserveComponentsMutation.mutate()`
- "Release Components" button — calls `releaseComponentsMutation.mutate()`
- A small summary line: "X components reserved for this order"

Keep the design compact per the low-resolution screen principle in MEMORY.md.

**Step 3: Commit**

```
feat: add reserve/release component buttons to order page
```

---

## Task 7: Update BOM expansion row to show reservation data

**Files:**
- Modify: `components/features/orders/ProductsTableRow.tsx` (lines 196-288)
- Modify: `app/orders/[orderId]/page.tsx` — update `computeComponentMetrics`

**Context:** Currently the BOM expansion shows: REQUIRED | IN STOCK | ON ORDER | SHORTFALL | GLOBAL. We add RESERVED and AVAILABLE columns, and update shortfall to account for reservations.

**Step 1: Update `computeComponentMetrics`**

In `app/orders/[orderId]/page.tsx` (lines 464-487), extend the return value:

```typescript
const computeComponentMetrics = useCallback((component: any, productId: number) => {
  const baseRequired = Number(component?.quantity_required ?? component?.total_required ?? component?.order_required ?? 0);
  const inStock = Number(component?.quantity_in_stock ?? component?.in_stock ?? 0);
  const onOrder = Number(component?.quantity_on_order ?? component?.on_order ?? 0);
  const reservedByOthers = Number(component?.reserved_by_others ?? 0);
  const reservedThisOrder = Number(component?.reserved_this_order ?? 0);

  const coverage = coverageByProduct.get(productId);
  const factor = applyFgCoverage ? (coverage?.factor ?? 1) : 1;
  const required = baseRequired * factor;

  const available = Math.max(0, inStock - reservedByOthers);
  const apparent = Math.max(0, required - available);
  const real = Math.max(0, required - available - onOrder);

  return {
    required,
    inStock,
    onOrder,
    available,               // NEW: true available after other reservations
    reservedByOthers,        // NEW
    reservedThisOrder,       // NEW
    apparent,                // Updated: now uses available instead of inStock
    real,                    // Updated: now uses available instead of inStock
    factor,
  };
}, [applyFgCoverage, coverageByProduct]);
```

**Step 2: Update ProductsTableRow BOM header**

Change the header row (lines 199-212) to show the new columns. Replace or augment the existing columns:

```
COMPONENT | REQUIRED | IN STOCK | RESERVED | AVAILABLE | ON ORDER | SHORTFALL | GLOBAL
```

Where:
- RESERVED = reservedByOthers (how much is spoken for by other orders)
- AVAILABLE = inStock - reservedByOthers (what's truly free)
- SHORTFALL = required - available (updated calculation)

**Step 3: Update BOM data cells**

For each component row, render the new metrics. Use colour coding:
- AVAILABLE in green if >= required, orange/red if < required
- RESERVED in muted text (informational)

**Step 4: Commit**

```
feat: show component reservation data in BOM expansion rows
```

---

## Task 8: Auto-release component reservations on order completion/cancellation

**Files:**
- Modify: wherever order status changes are handled (look for status update logic in `app/api/orders/` or `lib/db/orders.ts`)

**Context:** When an order is completed or cancelled, its component reservations should be automatically released so they're available for other orders. This mirrors how FG reservations are handled.

**Step 1: Add a database trigger**

```sql
CREATE OR REPLACE FUNCTION public.auto_release_component_reservations()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- When order status changes to Completed or Cancelled, release component reservations
  IF NEW.status_id IN (
    SELECT status_id FROM public.order_statuses
    WHERE status_name IN ('Completed', 'Cancelled')
  ) AND OLD.status_id <> NEW.status_id THEN
    DELETE FROM public.component_reservations WHERE order_id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_release_component_reservations
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_release_component_reservations();
```

**Step 2: Apply migration and test**

**Step 3: Commit**

```
feat: auto-release component reservations on order completion/cancellation
```

---

## Task 9: Update Issue Stock tab to show reservation context

**Files:**
- Modify: `components/features/orders/IssueStockTab.tsx`

**Context:** When issuing stock, it's helpful to see which components are reserved for this order vs. unreserved. This is informational only — no enforcement in Phase 1.

**Step 1: Add a "Reserved" column to the issue stock table**

Show `reserved_this_order` next to each component's available quantity. If a component is being issued but isn't reserved, show a subtle info indicator (not a blocker).

**Step 2: Commit**

```
feat: show reservation status in Issue Stock tab
```

---

## Task 10: Verification and cleanup

**Step 1: Run TypeScript check**

```bash
npx tsc --noEmit
```

**Step 2: Run linter**

```bash
npm run lint
```

**Step 3: Run security advisor**

Check for missing RLS on the new table.

**Step 4: Manual test in browser**

1. Open an order with components that have stock
2. Click "Reserve Components" — verify reservations are created
3. Open a second order sharing the same components — verify "AVAILABLE" column reflects the first order's reservations
4. Release from first order — verify second order's availability updates
5. Complete/cancel an order — verify reservations auto-release

**Step 5: Final commit**

```
chore: verify component reservation feature end-to-end
```

---

## Out of Scope (Phase 2, future)

These are explicitly NOT part of this implementation:

- **Auto-reserve on order confirmation** — currently manual only
- **Enforcement at issue time** — warn but don't block issuing unreserved components
- **Priority-based allocation** — no order priority ranking
- **Partial reservation UI** — user can't choose "reserve only 3 of the 5 needed"
- **Reservation aging/expiry** — reservations persist until released or order completes
- **Component reservation in the Components tab** — only visible in Products tab BOM expansion for now
