# Order Panel Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-row ＋ reserve buttons to the Order Line Setup panel's Component Readiness section, backed by a new per-component reservation RPC. Operators can reserve a single component (claim on-hand stock for this order) without firing the order-wide Reserve all.

**Architecture:** New Postgres RPC `reserve_order_component_single(p_order_id, p_component_id, p_org_id)` mirrors the existing snapshot/effective-field/cutting-plan-aware demand calculation from `reserve_order_components`, then filters to one component and upserts the reservation. New API route `POST /api/orders/[orderId]/reserve-component/[componentId]` wraps it with order-ownership validation. New `useReserveOrderComponent` TanStack Query mutation hook drives the UI. The existing `ReadinessRow` component gains a third action slot for ＋ reserve, gated by `canReserveMore` from the helper that already ships in Phase 2.

**Tech Stack:** Postgres (SQL function, `LANGUAGE plpgsql`), Next.js 16 app-router route handler, TypeScript, TanStack Query v5, Tailwind v4.2 + shadcn 4.0, lucide-react. Test runners: vitest. Supabase MCP tools (`apply_migration`, `list_migrations`).

**Spec:** [docs/superpowers/specs/2026-05-12-order-panel-phase-2-3-design.md](../specs/2026-05-12-order-panel-phase-2-3-design.md) — Phase 3 sections specifically.

**Predecessors:**
- Phase 1 shipped in PR #98 (merge `644a4df`) — initial panel.
- Phase 1 hotfix shipped in PR #100 (merge `04437af`) — per-part materials surfacing.
- Phase 2 shipped in PR #108 (merge `2a9a834`) — collapsed-by-default, single-line readiness rows, ＋ Reserve all, 🛒 per-row order. Phase 2 also added `lib/orders/reservation-predicate.ts` (`targetReservable`, `canReserveMore`) which Phase 3 reuses.

**Branch strategy:** Implementation lands on a fresh branch `codex/local-order-panel-phase-3` cut from `origin/codex/integration`. PR target is `codex/integration`. Greg sign-off REQUIRED before merge because Phase 3 includes a live migration.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `supabase/migrations/<timestamp>_reserve_order_component_single.sql` | The new RPC function. Snapshot/effective-field/cutting-plan-aware demand calculation mirrored from the existing `reserve_order_components`, then filtered to `p_component_id`. CHECK-constraint-safe (deletes when reservable is 0). Org-scoped DELETE branch. `SET search_path = public, pg_temp` pinned. |
| `app/api/orders/[orderId]/reserve-component/[componentId]/route.ts` | POST handler. Mirrors the existing `reserve-components` route's auth → parse → order-ownership-validation → RPC → response pattern. |
| `hooks/useReserveOrderComponent.ts` | TanStack Query mutation hook. Invalidates `['order', orderId]` + `['orderComponentRequirements', orderId]` on success. |

### Modified files

| File | Change |
|---|---|
| `components/features/orders/setup-panel/ReadinessRow.tsx` | Add `showReserveAction` + `reserveEnabled` + `reservePending` + `onReserve` props. Render ＋ reserve button in a new 9th column when `showReserveAction` is true. Update grid template to 9 columns. |
| `components/features/orders/setup-panel/ComponentReadinessSection.tsx` | Pass per-component `canReserveMore` + reserve handlers through to `ReadinessRow`. Wire up the new mutation hook per-row. |
| `components/features/orders/OrderLineSetupPanel.tsx` | Pass `onReserveComponent` prop through to `ComponentReadinessSection`. |
| `app/orders/[orderId]/page.tsx` | Use `useReserveOrderComponent` hook. Pass mutation through to the panel. |
| `docs/operations/migration-status.md` | Append the new migration entry. |

### Untouched

- `components/features/shared/CutlistMaterialDialog.tsx` — out of scope.
- `lib/orders/reservation-predicate.ts` — Phase 2 contract; reused as-is.
- `lib/orders/panel-collapse.ts` — Phase 2 contract.
- `supabase/migrations/20260428143200_snapshot_effective_field_rpcs.sql` — DO NOT modify the existing `reserve_order_components` in this PR.
- Order-wide reserve API at `app/api/orders/[orderId]/reserve-components/route.ts` — Phase 1 + Phase 2 contract.
- `OrderComponentsDialog.tsx` — Phase 2 contract.

---

## Task 1: Create implementation branch

**Files:** none

- [ ] **Step 1.1: Verify clean working tree on integration**

```bash
git fetch origin
git checkout codex/integration
git pull --ff-only origin codex/integration
git status
```

Expected: `nothing to commit, working tree clean`. If untracked files belong to other sessions (e.g. product-collab work), they will travel with branch switches without affecting the new branch — leave them alone. If tracked files are modified, stash them with a labeled message before continuing:

```bash
git stash push --message "codex: pre-phase-3 stash (<reason>) — 2026-05-13"
```

- [ ] **Step 1.2: Create the implementation branch**

```bash
git checkout -b codex/local-order-panel-phase-3
```

Expected: `Switched to a new branch 'codex/local-order-panel-phase-3'`.

- [ ] **Step 1.3: Confirm Phase 2 is live on integration**

```bash
git log --oneline -5 | grep -i "phase 2\|order-panel\|setup panel"
```

Expected: at least one commit mentioning Phase 2 setup panel. If absent, stop — Phase 3 builds on Phase 2; integration must include it.

Also verify the Phase 2 files exist:

```bash
test -f lib/orders/reservation-predicate.ts && echo "OK predicate helper" || echo "MISSING predicate helper"
test -f components/features/orders/setup-panel/ReadinessRow.tsx && echo "OK ReadinessRow" || echo "MISSING ReadinessRow"
```

Expected: both OK lines. If either is missing, stop and surface to Greg.

---

## Task 2: Create the migration file

**Files:**
- Create: `supabase/migrations/<TIMESTAMP>_reserve_order_component_single.sql`

The `<TIMESTAMP>` is the current UTC time in `YYYYMMDDHHMMSS` format. Generate it freshly to ensure it sorts after the most recent existing migration.

- [ ] **Step 2.1: Generate the migration filename**

```bash
TIMESTAMP=$(date -u +%Y%m%d%H%M%S)
MIGRATION_FILE="supabase/migrations/${TIMESTAMP}_reserve_order_component_single.sql"
echo "Will create: $MIGRATION_FILE"
ls -la supabase/migrations/ | tail -5  # confirm $TIMESTAMP > all existing
```

Expected: the new timestamp is greater than every existing filename's timestamp.

- [ ] **Step 2.2: Write the migration file**

Create the migration file with this exact content (replace `<MIGRATION_FILE>` with the path from Step 2.1):

```sql
-- Per-component reservation RPC — snapshot/effective-field/cutting-plan-aware,
-- mirrors the demand calculation from reserve_order_components and filters to
-- one component, then upserts the reservation idempotently.
--
-- Design constraints baked in:
--   1. CHECK (qty_reserved > 0) on component_reservations means we MUST branch
--      on v_reservable > 0 — naive upsert of zero would trip the CHECK.
--   2. SET search_path keeps the function out of the "role mutable search_path"
--      advisor that the existing reserve_order_components currently inherits.
--   3. DELETE branch and UPDATE branch are both org-scoped — never cross-org.
--
-- Spec: docs/superpowers/specs/2026-05-12-order-panel-phase-2-3-design.md

CREATE OR REPLACE FUNCTION public.reserve_order_component_single(
  p_order_id INT,
  p_component_id INT,
  p_org_id UUID
)
RETURNS TABLE(component_id INT, qty_reserved NUMERIC, qty_available NUMERIC, qty_required NUMERIC)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_plan_fresh boolean;
  v_required NUMERIC;
  v_available NUMERIC;
  v_other_reserved NUMERIC;
  v_reservable NUMERIC;
BEGIN
  -- Mirror the fresh-plan check from reserve_order_components.
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

  -- Demand for THIS component on THIS order. Mirrors the existing
  -- reserve_order_components demand calculation exactly (snapshot effective
  -- fields, fresh-plan cutlist overrides, live-BOM fallback for snapshot-less
  -- rows) then filters the result to p_component_id.
  SELECT COALESCE(SUM(qty), 0)::NUMERIC
  INTO v_required
  FROM (
    -- Non-cutlist demand from bom_snapshot (always);
    -- cutlist demand from snapshot ONLY when there is no fresh cutting plan.
    SELECT
      snap.comp_id AS cid,
      snap.qty_req * od.quantity AS qty
    FROM public.order_details od,
         LATERAL (
           SELECT
             COALESCE((entry->>'effective_component_id')::int, (entry->>'component_id')::int) AS comp_id,
             COALESCE((entry->>'effective_quantity_required')::numeric, (entry->>'quantity_required')::numeric) AS qty_req,
             COALESCE((entry->>'is_cutlist_item')::boolean, false) AS is_cutlist_item
           FROM jsonb_array_elements(od.bom_snapshot) AS entry
         ) AS snap
    WHERE od.order_id = p_order_id
      AND od.bom_snapshot IS NOT NULL
      AND jsonb_typeof(od.bom_snapshot) = 'array'
      AND jsonb_array_length(od.bom_snapshot) > 0
      AND (
          snap.is_cutlist_item = false
          OR v_plan_fresh IS NOT TRUE
      )

    UNION ALL

    -- Fresh cutting-plan component overrides (cutlist demand when plan is fresh).
    SELECT
      (entry->>'component_id')::INT AS cid,
      (entry->>'quantity')::NUMERIC AS qty
    FROM public.orders o,
         LATERAL jsonb_array_elements(o.cutting_plan->'component_overrides') AS entry
    WHERE o.order_id = p_order_id
      AND v_plan_fresh = true

    UNION ALL

    -- Fallback: live BOM for any order_details row that lacks a usable snapshot.
    SELECT
      bom.component_id AS cid,
      bom.quantity_required * od.quantity AS qty
    FROM public.order_details od
    JOIN public.billofmaterials bom ON od.product_id = bom.product_id
    WHERE od.order_id = p_order_id
      AND (od.bom_snapshot IS NULL
           OR jsonb_typeof(od.bom_snapshot) != 'array'
           OR jsonb_array_length(od.bom_snapshot) = 0)
  ) raw
  WHERE cid = p_component_id
    AND qty > 0;

  -- Inventory on hand.
  SELECT COALESCE(quantity_on_hand, 0)::NUMERIC
  INTO v_available
  FROM public.inventory
  WHERE component_id = p_component_id;

  -- Other orders' active reservations for this component (this org only).
  SELECT COALESCE(SUM(qty_reserved), 0)::NUMERIC
  INTO v_other_reserved
  FROM public.component_reservations
  WHERE component_id = p_component_id
    AND order_id <> p_order_id
    AND org_id = p_org_id;

  v_reservable := GREATEST(0, LEAST(v_required, COALESCE(v_available, 0) - COALESCE(v_other_reserved, 0)));

  IF v_reservable > 0 THEN
    INSERT INTO public.component_reservations (order_id, component_id, qty_reserved, org_id)
    VALUES (p_order_id, p_component_id, v_reservable, p_org_id)
    ON CONFLICT (order_id, component_id) DO UPDATE
      SET qty_reserved = EXCLUDED.qty_reserved,
          org_id       = EXCLUDED.org_id;
  ELSE
    -- Nothing reservable. Org-scoped DELETE so we never touch cross-org rows
    -- even if a future bug ever calls this function with a wrong org_id.
    DELETE FROM public.component_reservations
    WHERE order_id = p_order_id
      AND component_id = p_component_id
      AND org_id = p_org_id;
  END IF;

  RETURN QUERY
  SELECT
    p_component_id,
    v_reservable,
    COALESCE(v_available, 0),
    COALESCE(v_required, 0);
END;
$function$;

COMMENT ON FUNCTION public.reserve_order_component_single(INT, INT, UUID) IS
  'Per-component reservation. Mirrors reserve_order_components demand calc, filtered to one component. Upserts the reservation idempotently; deletes when nothing reservable. Org-scoped. Spec: docs/superpowers/specs/2026-05-12-order-panel-phase-2-3-design.md';
```

- [ ] **Step 2.3: Verify the migration file is syntactically valid SQL**

Use a lightweight syntax check (PostgreSQL parser via `mcp__supabase__execute_sql` against an EXPLAIN or via `psql --command='\\d'` if available). The simplest robust check:

```bash
grep -c "CREATE OR REPLACE FUNCTION public.reserve_order_component_single" "<MIGRATION_FILE>"
grep -c "RETURN QUERY" "<MIGRATION_FILE>"
grep -c "SET search_path = public, pg_temp" "<MIGRATION_FILE>"
```

Expected: each returns `1`.

- [ ] **Step 2.4: Commit the migration file (do NOT apply yet)**

```bash
git add supabase/migrations/<TIMESTAMP>_reserve_order_component_single.sql
git commit -m "feat(orders): add reserve_order_component_single migration"
```

---

## Task 3: Apply the migration to the live project

**Files:** none (calls Supabase MCP)

Unity ERP's live project is `ttlyfhkrsjjrzxiagzpb`. This migration is pure additive DDL (a new function, no table or column changes), so it follows the "no preview branch, apply direct" pattern documented in MEMORY for Sam/agent-support migrations.

- [ ] **Step 3.1: Apply the migration via MCP**

Call `mcp__supabase__apply_migration` with:
- `name`: `<TIMESTAMP>_reserve_order_component_single` (the basename without the `.sql` extension)
- `query`: the full SQL body from Task 2.2

The MCP tool applies the migration to the live project and records it in the migration history.

Expected: success response. If error, stop and surface to Greg with the error message.

- [ ] **Step 3.2: Verify with list_migrations**

Call `mcp__supabase__list_migrations`. Expected: the new migration name appears in the returned list with a timestamp matching the file you applied.

If the new entry is absent OR the timestamp doesn't match what's in `supabase/migrations/`, stop — the local file and remote state have drifted.

- [ ] **Step 3.3: Test-call the new RPC with a known order**

Pick an order that has at least one BOM component with `available > 0`. Order 613 (1500mm Cupboard, line 66) is a known test order from Phase 2 smoke. Find one of its components and its `org_id`:

```sql
-- via mcp__supabase__execute_sql
SELECT
  od.order_id,
  od.org_id,
  comp.component_id,
  comp.internal_code,
  comp.description
FROM public.order_details od
JOIN public.billofmaterials bom ON od.product_id = bom.product_id
JOIN public.components comp ON bom.component_id = comp.component_id
WHERE od.order_id = 613
LIMIT 5;
```

Then call the RPC with one of those `(order_id, component_id, org_id)` triples:

```sql
-- via mcp__supabase__execute_sql
SELECT * FROM public.reserve_order_component_single(613, <COMPONENT_ID>, '<ORG_ID>'::uuid);
```

Expected: a single row with `component_id`, `qty_reserved`, `qty_available`, `qty_required`. The `qty_reserved` should equal `min(qty_required, qty_available)` clamped to 0.

Verify the reservation actually landed:

```sql
SELECT * FROM public.component_reservations
WHERE order_id = 613 AND component_id = <COMPONENT_ID>;
```

Expected: one row with `qty_reserved` matching the RPC's return value.

- [ ] **Step 3.4: Clean up the test reservation**

```sql
DELETE FROM public.component_reservations
WHERE order_id = 613 AND component_id = <COMPONENT_ID>;
```

Expected: 1 row deleted.

- [ ] **Step 3.5: Update docs/operations/migration-status.md**

Open `docs/operations/migration-status.md`. Find the "Applied migrations" or equivalent section (the file has been growing chronologically). Append a new entry at the appropriate location:

```markdown
- `<TIMESTAMP>_reserve_order_component_single` — Per-component reservation RPC; mirrors `reserve_order_components` demand calc filtered to one component; org-scoped; CHECK-constraint-safe; SET search_path pinned. Applied to live <DATE>. Spec: [docs/superpowers/specs/2026-05-12-order-panel-phase-2-3-design.md](../superpowers/specs/2026-05-12-order-panel-phase-2-3-design.md).
```

Replace `<TIMESTAMP>` with the migration's timestamp and `<DATE>` with today's date in `YYYY-MM-DD` form.

- [ ] **Step 3.6: Commit the migration-status update**

```bash
git add docs/operations/migration-status.md
git commit -m "docs(operations): record reserve_order_component_single migration"
```

---

## Task 4: New API route

**Files:**
- Create: `app/api/orders/[orderId]/reserve-component/[componentId]/route.ts`

The route mirrors the existing `app/api/orders/[orderId]/reserve-components/route.ts` exactly, including the order-ownership validation pattern. Read that file before starting:

```bash
cat app/api/orders/[orderId]/reserve-components/route.ts
```

- [ ] **Step 4.1: Create the directory and file**

```bash
mkdir -p "app/api/orders/[orderId]/reserve-component/[componentId]"
```

Then create `app/api/orders/[orderId]/reserve-component/[componentId]/route.ts` with this exact content:

```typescript
import { NextRequest, NextResponse } from 'next/server';

import { requireModuleAccess } from '@/lib/api/module-access';
import { MODULE_KEYS } from '@/lib/modules/keys';
import { supabaseAdmin } from '@/lib/supabase-admin';

type RouteParams = {
  orderId: string;
  componentId: string;
};

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

async function requireOrdersAccess(request: NextRequest) {
  const access = await requireModuleAccess(request, MODULE_KEYS.ORDERS_FULFILLMENT, {
    forbiddenMessage: 'Orders module access is disabled for your organization',
  });
  if ('error' in access) {
    return { error: access.error };
  }
  if (!access.orgId) {
    return {
      error: NextResponse.json(
        {
          error: 'Organization context is required for orders access',
          reason: 'missing_org_context',
          module_key: access.moduleKey,
        },
        { status: 403 }
      ),
    };
  }
  return { orgId: access.orgId };
}

type ReserveSingleRpcRow = {
  component_id?: number | null;
  qty_reserved?: number | string | null;
  qty_available?: number | string | null;
  qty_required?: number | string | null;
};

export async function POST(request: NextRequest, context: { params: Promise<RouteParams> }) {
  const auth = await requireOrdersAccess(request);
  if ('error' in auth) return auth.error;

  const { orderId: orderIdParam, componentId: componentIdParam } = await context.params;
  const orderId = parsePositiveInt(orderIdParam);
  if (!orderId) {
    return NextResponse.json({ error: 'Invalid order id' }, { status: 400 });
  }
  const componentId = parsePositiveInt(componentIdParam);
  if (!componentId) {
    return NextResponse.json({ error: 'Invalid component id' }, { status: 400 });
  }

  // Order ownership: caller must belong to the org that owns this order.
  // Mirrors the pattern in /api/orders/[orderId]/reserve-components/route.ts.
  const { data: order, error: orderError } = await supabaseAdmin
    .from('orders')
    .select('order_id')
    .eq('order_id', orderId)
    .eq('org_id', auth.orgId)
    .maybeSingle();

  if (orderError) {
    return NextResponse.json({ error: 'Failed to validate order' }, { status: 500 });
  }
  if (!order) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('reserve_order_component_single', {
      p_order_id: orderId,
      p_component_id: componentId,
      p_org_id: auth.orgId,
    });

    if (error) {
      console.error('[reserve-component] Failed to reserve component', error);
      return NextResponse.json(
        { error: 'Failed to reserve component' },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as ReserveSingleRpcRow[];
    const row = rows[0] ?? {};

    const reservation = {
      component_id: row.component_id ?? componentId,
      qty_reserved: Number(row.qty_reserved ?? 0),
      qty_available: Number(row.qty_available ?? 0),
      qty_required: Number(row.qty_required ?? 0),
    };

    return NextResponse.json({ success: true, reservation });
  } catch (error: unknown) {
    console.error('[reserve-component] Unexpected error', error);
    return NextResponse.json(
      { error: 'Unexpected error while reserving component' },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 4.2: Verify compile**

```bash
npx tsc --noEmit 2>&1 | grep "reserve-component" | head
```

Expected: empty output.

- [ ] **Step 4.3: Commit**

```bash
git add app/api/orders/\[orderId\]/reserve-component/
git commit -m "feat(orders): add reserve-component API route with ownership validation"
```

---

## Task 5: New useReserveOrderComponent hook

**Files:**
- Create: `hooks/useReserveOrderComponent.ts`

Before writing the hook, check the existing reserve-components hook (if any) for the auth helper convention:

```bash
grep -rln "useMutation\|reserveComponentsMutation" hooks/ lib/ 2>&1 | head -5
```

The Phase 1 + Phase 2 setup uses `authorizedFetch` from `@/lib/client/auth-fetch` for any UI hitting `/api/...` routes (per Greg's MEMORY: "Reviewer must run browser smoke when Codex CLI can't ... Specifically check `authorizedFetch` vs plain `fetch` for any new UI hitting `/api/...` routes").

- [ ] **Step 5.1: Create the hook**

Create `hooks/useReserveOrderComponent.ts` with this exact content:

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authorizedFetch } from '@/lib/client/auth-fetch';

export type ReserveOrderComponentResult = {
  component_id: number;
  qty_reserved: number;
  qty_available: number;
  qty_required: number;
};

export function useReserveOrderComponent(orderId: number) {
  const queryClient = useQueryClient();

  return useMutation<ReserveOrderComponentResult, Error, number>({
    mutationFn: async (componentId: number) => {
      const response = await authorizedFetch(
        `/api/orders/${orderId}/reserve-component/${componentId}`,
        { method: 'POST' }
      );
      if (!response.ok) {
        let message = 'Failed to reserve component';
        try {
          const body = await response.json();
          if (body?.error) message = body.error;
        } catch {
          // fallthrough — keep default message
        }
        throw new Error(message);
      }
      const body = await response.json();
      return body.reservation as ReserveOrderComponentResult;
    },
    onSuccess: (_data, _componentId) => {
      // Invalidate the per-order query keys that source the panel's
      // readiness data so RES / AVAIL / SHORT refresh.
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['orderComponentRequirements', orderId] });
    },
  });
}
```

- [ ] **Step 5.2: Verify compile**

```bash
npx tsc --noEmit 2>&1 | grep "useReserveOrderComponent" | head
```

Expected: empty.

- [ ] **Step 5.3: Commit**

```bash
git add hooks/useReserveOrderComponent.ts
git commit -m "feat(orders): add useReserveOrderComponent mutation hook"
```

---

## Task 6: Update ReadinessRow to support per-row reserve

**Files:**
- Modify: `components/features/orders/setup-panel/ReadinessRow.tsx`

The Phase 2 grid is `grid-cols-[90px_1fr_32px_38px_50px_32px_22px_22px]` (8 columns). Phase 3 appends one 22px slot for ＋ reserve, making 9 columns. The reserve button is gated by `canReserveMore` from `lib/orders/reservation-predicate.ts` (shipped in Phase 2).

- [ ] **Step 6.1: Read the current ReadinessRow signature**

```bash
sed -n '1,60p' components/features/orders/setup-panel/ReadinessRow.tsx
```

Note the current `ReadinessRowProps` interface — it has `componentId`, `internalCode`, `description`, `required`, `reservedThisOrder`, `available`, `shortfall`, `canSwap`, `showOrderAction`, `onSwap`, `onOrder`. The new props extend this.

- [ ] **Step 6.2: Update the props interface**

In `components/features/orders/setup-panel/ReadinessRow.tsx`, locate the `ReadinessRowProps` interface near the top. Add three new fields:

```typescript
export interface ReadinessRowProps {
  componentId: number | null;
  internalCode: string;
  description: string | null;
  required: number;
  reservedThisOrder: number;
  available: number;
  shortfall: number;
  canSwap: boolean;
  showOrderAction?: boolean;
  /** Whether to render the ＋ reserve column (Phase 3 introduces this). */
  showReserveAction?: boolean;
  /** Enabled state — typically `canReserveMore(required, available, reservedThisOrder)`. */
  reserveEnabled?: boolean;
  /** Loading state during the per-row reserve mutation. */
  reservePending?: boolean;
  onSwap: () => void;
  onOrder: () => void;
  /** Required when `showReserveAction` is true. */
  onReserve?: () => void;
}
```

- [ ] **Step 6.3: Update the grid template**

Find the `ROW_GRID` constant near the top of the file (currently `'grid grid-cols-[90px_1fr_32px_38px_50px_32px_22px_22px] items-center gap-x-1.5'`). Replace with a function that returns the right grid based on whether reserve is shown, OR define two constants:

```typescript
// Phase 2 grid: 8 columns. Phase 3 with showReserveAction: 9 columns.
const ROW_GRID_PHASE_2 = 'grid grid-cols-[90px_1fr_32px_38px_50px_32px_22px_22px] items-center gap-x-1.5';
const ROW_GRID_PHASE_3 = 'grid grid-cols-[90px_1fr_32px_38px_50px_32px_22px_22px_22px] items-center gap-x-1.5';
```

Then update the row's className to switch:

```tsx
<div
  className={cn(
    showReserveAction ? ROW_GRID_PHASE_3 : ROW_GRID_PHASE_2,
    'px-2 py-2 -mx-2 text-xs rounded-sm',
    'odd:bg-transparent even:bg-black/[0.03]',
    isShort && 'bg-destructive/[0.05] even:bg-destructive/[0.05]'
  )}
>
```

- [ ] **Step 6.4: Add the ＋ reserve button slot at the end of the row**

Locate the existing 🛒 order button (last cell of the row currently). After it, add the new ＋ reserve cell:

```tsx
{/* ＋ Reserve (Phase 3) */}
{showReserveAction ? (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        onClick={onReserve}
        disabled={!reserveEnabled || reservePending}
        className={cn(
          'w-[22px] h-[22px] rounded-sm',
          reserveEnabled && !reservePending
            ? 'text-primary hover:bg-primary/[0.10] hover:text-primary'
            : 'text-muted-foreground/30 cursor-not-allowed'
        )}
        aria-label="Reserve this component"
        data-row-action
      >
        {reservePending ? (
          <Loader2 className="h-3 w-3 mx-auto animate-spin" />
        ) : (
          <Plus className="h-3.5 w-3.5 mx-auto" />
        )}
      </button>
    </TooltipTrigger>
    <TooltipContent side="top" align="end" className="text-xs">
      {!reserveEnabled
        ? (available === 0
            ? 'Nothing in stock to reserve - order instead'
            : `Already at max reservable (${formatQuantity(reservedThisOrder)} reserved)`)
        : `Reserve up to ${formatQuantity(Math.max(0, Math.min(required, available)) - reservedThisOrder)} more`}
    </TooltipContent>
  </Tooltip>
) : null}
```

Make sure to import `Plus` and `Loader2` from `lucide-react` at the top of the file (alongside the existing `Replace, ShoppingCart` imports):

```tsx
import { Loader2, Plus, Replace, ShoppingCart } from 'lucide-react';
```

- [ ] **Step 6.5: Verify compile**

```bash
npx tsc --noEmit 2>&1 | grep "ReadinessRow" | head
```

Expected: empty.

- [ ] **Step 6.6: Commit**

```bash
git add components/features/orders/setup-panel/ReadinessRow.tsx
git commit -m "feat(orders): add ＋ reserve column to ReadinessRow (Phase 3)"
```

---

## Task 7: Update ComponentReadinessSection to wire per-row reserve

**Files:**
- Modify: `components/features/orders/setup-panel/ComponentReadinessSection.tsx`

The section gains a new prop `onReserveComponent: (componentId: number) => void` and a new prop for per-component pending state. The header row's column header span needs to extend to 9 columns.

- [ ] **Step 7.1: Read the current props interface**

```bash
sed -n '1,40p' components/features/orders/setup-panel/ComponentReadinessSection.tsx
```

Note the current interface fields.

- [ ] **Step 7.2: Update the props interface**

Find the `ComponentReadinessSectionProps` interface. Add two new fields:

```typescript
interface ComponentReadinessSectionProps {
  detail: any;
  bomComponents: any[];
  computeComponentMetrics: (component: any, productId: number) => any;
  showGlobalContext: boolean;
  onSwapBomEntry: (entry: BomSnapshotEntry) => void;
  onOrderComponent: (componentId: number) => void;
  onReserveAll: () => void | Promise<void>;
  onReserveComponent: (componentId: number) => void;
  /** The component currently mutating (or null), so we can show per-row spinner. */
  pendingReserveComponentId: number | null;
  reservePending: boolean;
  isOpen: boolean;
  onToggle: () => void;
}
```

- [ ] **Step 7.3: Import canReserveMore and update grid header**

Add the import (if not already present):

```typescript
import { canReserveMore } from '@/lib/orders/reservation-predicate';
```

Find the column header `<div className="grid grid-cols-[90px_1fr_32px_38px_50px_32px_22px_22px] ...">` near the top of the section body. Update it to 9 columns:

```tsx
<div className="grid grid-cols-[90px_1fr_32px_38px_50px_32px_22px_22px_22px] items-center gap-x-1.5 px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
  <span>Code</span>
  <span>Description</span>
  <span className="text-right">Req</span>
  <span className="text-right">Res</span>
  <span className="text-right">Avail</span>
  <span className="text-right">Short</span>
  <span aria-hidden />
  <span aria-hidden />
  <span aria-hidden />
</div>
```

- [ ] **Step 7.4: Pass new props through to each ReadinessRow**

Find the `<ReadinessRow ... />` instance inside the `enriched.map(...)` loop. Add the new props:

```tsx
{enriched.map(({ component, metrics }) => {
  const componentId = component.component_id ? Number(component.component_id) : null;
  const snapshotEntry = findSnapshotEntry(component);
  const required = Number(metrics.required ?? 0);
  const available = Number(metrics.available ?? metrics.inStock ?? 0);
  const reservedThisOrder = Number(metrics.reservedThisOrder ?? 0);
  const rowReserveEnabled = componentId != null && canReserveMore(required, available, reservedThisOrder);
  const rowReservePending = pendingReserveComponentId === componentId;
  return (
    <ReadinessRow
      key={componentId ?? component.internal_code}
      componentId={componentId}
      internalCode={component.internal_code ?? 'Unknown'}
      description={component.description ?? null}
      required={required}
      reservedThisOrder={reservedThisOrder}
      available={available}
      shortfall={Number(metrics.real ?? 0)}
      canSwap={!!snapshotEntry}
      showReserveAction
      reserveEnabled={rowReserveEnabled}
      reservePending={rowReservePending}
      onSwap={() => snapshotEntry && onSwapBomEntry(snapshotEntry)}
      onOrder={() => componentId && onOrderComponent(componentId)}
      onReserve={() => componentId && onReserveComponent(componentId)}
    />
  );
})}
```

The existing `enriched` definition and `findSnapshotEntry` helper stay unchanged.

- [ ] **Step 7.5: Verify compile**

```bash
npx tsc --noEmit 2>&1 | grep "ComponentReadinessSection" | head
```

Expected: empty.

- [ ] **Step 7.6: Commit**

```bash
git add components/features/orders/setup-panel/ComponentReadinessSection.tsx
git commit -m "feat(orders): wire per-row reserve in ComponentReadinessSection"
```

---

## Task 8: Update OrderLineSetupPanel to thread the new props

**Files:**
- Modify: `components/features/orders/OrderLineSetupPanel.tsx`

The panel composer gains two new props (`onReserveComponent` + `pendingReserveComponentId`) and forwards them to `ComponentReadinessSection`.

- [ ] **Step 8.1: Update the props interface**

Find the `OrderLineSetupPanelProps` interface near the top. Add:

```typescript
  onReserveComponent: (componentId: number) => void;
  pendingReserveComponentId: number | null;
```

- [ ] **Step 8.2: Forward the props in PanelBody**

Find the `<ComponentReadinessSection ... />` render inside `PanelBody`. Add:

```tsx
onReserveComponent={onReserveComponent}
pendingReserveComponentId={pendingReserveComponentId}
```

Also destructure both new props in the `function PanelBody({ ... }) { ... }` signature.

- [ ] **Step 8.3: Verify compile**

```bash
npx tsc --noEmit 2>&1 | grep "OrderLineSetupPanel" | head
```

Expected: empty.

- [ ] **Step 8.4: Commit**

```bash
git add components/features/orders/OrderLineSetupPanel.tsx
git commit -m "feat(orders): thread onReserveComponent + pending state through panel"
```

---

## Task 9: Wire useReserveOrderComponent in page.tsx

**Files:**
- Modify: `app/orders/[orderId]/page.tsx`

The page calls the new hook and passes its `mutate` + variable state to the panel.

- [ ] **Step 9.1: Add the hook import**

Locate the existing TanStack Query mutation imports near the top of `app/orders/[orderId]/page.tsx` (search for `useMutation` or `reserveComponentsMutation`). After the existing hook imports, add:

```typescript
import { useReserveOrderComponent } from '@/hooks/useReserveOrderComponent';
```

- [ ] **Step 9.2: Use the hook inside the component**

Find the existing `reserveComponentsMutation = useMutation(...)` definition (this is the order-wide reserve). After it, add the per-component hook:

```typescript
const reserveOrderComponentMutation = useReserveOrderComponent(orderId);
```

- [ ] **Step 9.3: Pass the new props to the panel**

Find `<OrderLineSetupPanel ... />` (in the right column conditional render — the existing block from Phase 2). Add:

```tsx
onReserveComponent={(componentId) => {
  reserveOrderComponentMutation.mutate(componentId, {
    onError: (error) => {
      toast.error(error.message || 'Failed to reserve component');
    },
  });
}}
pendingReserveComponentId={
  reserveOrderComponentMutation.isPending ? reserveOrderComponentMutation.variables ?? null : null
}
```

The `toast.error` import comes from `sonner` — if it's not already imported, add it:

```typescript
import { toast } from 'sonner';  // probably already present
```

- [ ] **Step 9.4: Verify compile + lint**

```bash
npx tsc --noEmit 2>&1 | grep -E "(reserveOrderComponentMutation|page\.tsx)" | head
npm run lint
```

Expected: clean for touched files. Pre-existing warnings unchanged.

- [ ] **Step 9.5: Commit**

```bash
git add app/orders/\[orderId\]/page.tsx
git commit -m "feat(orders): wire useReserveOrderComponent in order page"
```

---

## Task 10: Browser smoke verification

**Files:** none (verification only)

The spec's Phase 3 acceptance includes **three mandatory pre-merge smokes**: tenant safety, demand parity for swapped BOM, cutting-plan parity for fresh-plan overrides. All three are required.

- [ ] **Step 10.1: Start the dev server**

Via Codex's preview MCP if available, start the Next.js dev server. If Codex CLI can't run the preview MCP (port collision, etc.), flag in the PR description so Claude (reviewer) runs smoke before merge.

- [ ] **Step 10.2: Sign in with the test account**

Test account: `testai@qbutton.co.za` / `ClaudeTest2026!` per CLAUDE.md verification rule.

- [ ] **Step 10.3: Verify ＋ reserve button appears and works on a healthy row**

Navigate to `/orders/613?line=66` (a test order with shortfalls + reservable components). Expand Component Readiness. The new ＋ button column should appear at the right edge after 🛒. On a row where the component has `available > 0` and `reservedThisOrder < required`, the ＋ button is enabled (teal). Click it. The mutation fires, the row's RES value updates to a non-zero number, the button returns to disabled (already at max).

Take a screenshot to `docs/screenshots/2026-05-13-order-panel-phase-3/desktop-reserve-success.png`.

- [ ] **Step 10.4: Verify ＋ reserve is disabled on the shortfall row**

The RIH1516 row has `available = 0`. Its ＋ button should be disabled (28% opacity, cursor not-allowed). Hover shows the tooltip "Nothing in stock to reserve - order instead". The 🛒 button on the same row remains enabled (amber).

- [ ] **Step 10.5: Tenant safety smoke (MANDATORY)**

Identify an order belonging to a different org than the caller. Use `mcp__supabase__execute_sql` to find one:

```sql
SELECT order_id, org_id FROM public.orders WHERE org_id != '<CALLER_ORG_ID>' LIMIT 1;
```

Then call the API directly with that foreign order_id and any component_id:

```bash
curl -X POST -H "Cookie: <SESSION>" \
  http://localhost:3000/api/orders/<FOREIGN_ORDER_ID>/reserve-component/<ANY_COMPONENT_ID>
```

Expected response: `{"error":"Order not found"}` with HTTP 404. Verify no row was created in `component_reservations` for that foreign order via execute_sql.

If you can't run curl from the smoke environment, document the test by reading the route's code path (lines that perform `select order_id from orders where order_id = $1 and org_id = $auth.orgId` then `if (!order) return 404`). Note in the PR description that the tenant smoke is verified by code inspection.

- [ ] **Step 10.6: Demand parity smoke for swapped BOM (MANDATORY)**

Identify an order line whose `bom_snapshot` contains an entry with `effective_component_id` differing from `component_id` (i.e. a swapped BOM row). Use execute_sql:

```sql
SELECT od.order_id, od.order_detail_id, entry->>'component_id' as default_id, entry->>'effective_component_id' as effective_id
FROM public.order_details od,
     LATERAL jsonb_array_elements(od.bom_snapshot) AS entry
WHERE entry->>'component_id' IS NOT NULL
  AND entry->>'effective_component_id' IS NOT NULL
  AND (entry->>'component_id')::int != (entry->>'effective_component_id')::int
LIMIT 5;
```

Call the new RPC for the **effective** component_id — expect a positive `qty_reserved` matching the effective demand. Call again for the **default** (un-effective) component_id — expect `qty_reserved = 0` (since the snapshot's effective field overrides). Use execute_sql:

```sql
SELECT * FROM public.reserve_order_component_single(<ORDER_ID>, <EFFECTIVE_ID>, '<ORG_ID>'::uuid);
SELECT * FROM public.reserve_order_component_single(<ORDER_ID>, <DEFAULT_ID>, '<ORG_ID>'::uuid);
```

Document the two responses in the PR description.

Clean up:

```sql
DELETE FROM public.component_reservations WHERE order_id = <ORDER_ID> AND component_id IN (<EFFECTIVE_ID>, <DEFAULT_ID>);
```

- [ ] **Step 10.7: Cutting-plan parity smoke (MANDATORY)**

Identify an order with a fresh (non-stale) cutting plan that has `component_overrides`:

```sql
SELECT order_id, jsonb_array_elements(cutting_plan->'component_overrides')
FROM public.orders
WHERE cutting_plan IS NOT NULL
  AND jsonb_typeof(cutting_plan) = 'object'
  AND (cutting_plan->>'stale')::boolean IS DISTINCT FROM true
  AND jsonb_typeof(cutting_plan->'component_overrides') = 'array'
LIMIT 5;
```

Pick a component_id that appears in `component_overrides` for some order. Call the new RPC for that order+component — `qty_reserved` should match the override quantity, not the snapshot's cutlist demand.

Document the response in the PR. Clean up the reservation.

- [ ] **Step 10.8: Reserve all regression check**

Click the ＋ Reserve all button in the section header. Verify all reservable components get reserved (or updated). Verify that any per-row reservation made in Step 10.3 is OVERWRITTEN by Reserve all (delete-then-insert behavior — this is documented expected behavior per the spec).

- [ ] **Step 10.9: Capture screenshots**

Take screenshots:
- `docs/screenshots/2026-05-13-order-panel-phase-3/desktop-reserve-success.png` (from Step 10.3)
- `docs/screenshots/2026-05-13-order-panel-phase-3/desktop-reserve-disabled-shortfall.png`
- `docs/screenshots/2026-05-13-order-panel-phase-3/desktop-readiness-with-reserve-column.png`

Create the folder if missing.

- [ ] **Step 10.10: Stop the dev server + clean up any test reservations**

Stop the preview server. Verify no test reservations remain:

```sql
SELECT * FROM public.component_reservations WHERE order_id IN (<TEST_ORDER_IDS>);
```

Delete any test rows that aren't intended state.

- [ ] **Step 10.11: Commit screenshots**

```bash
git add docs/screenshots/2026-05-13-order-panel-phase-3/
git commit -m "docs(orders): browser smoke screenshots for Phase 3"
```

---

## Task 11: Final verification + push + PR

**Files:** none (verification only)

- [ ] **Step 11.1: Run vitest**

```bash
npx vitest run lib/orders/panel-collapse.test.ts lib/orders/reservation-predicate.test.ts
```

Expected: 16/16 PASS (Phase 2 helpers still pass).

- [ ] **Step 11.2: Re-run lint + tsc filtered**

```bash
npm run lint
npx tsc --noEmit 2>&1 | grep -E "(setup-panel|OrderLineSetupPanel|reserve-component|useReserveOrderComponent|orders/\[orderId\]/page)" | head -10
```

Expected: 0 lint errors. Empty tsc output for touched paths. Pre-existing warnings unchanged.

- [ ] **Step 11.3: Pre-PR self-check**

```bash
git fetch origin
git diff origin/codex/integration --stat
```

Verify the file surface matches the plan's "Files likely touched":

- `supabase/migrations/<TIMESTAMP>_reserve_order_component_single.sql` (new)
- `app/api/orders/[orderId]/reserve-component/[componentId]/route.ts` (new)
- `hooks/useReserveOrderComponent.ts` (new)
- `components/features/orders/setup-panel/ReadinessRow.tsx` (modified)
- `components/features/orders/setup-panel/ComponentReadinessSection.tsx` (modified)
- `components/features/orders/OrderLineSetupPanel.tsx` (modified)
- `app/orders/[orderId]/page.tsx` (modified)
- `docs/operations/migration-status.md` (modified)
- `docs/screenshots/2026-05-13-order-panel-phase-3/*.png` (new)

If a file outside this surface appears, stop and surface to Greg — that signals a stale base or wrong branch cut.

- [ ] **Step 11.4: Push the branch**

```bash
git push -u origin codex/local-order-panel-phase-3
```

- [ ] **Step 11.5: Open the PR**

Create a pull request from `codex/local-order-panel-phase-3` into `codex/integration`. PR description must include:

- Spec link: `docs/superpowers/specs/2026-05-12-order-panel-phase-2-3-design.md`
- Plan link: `docs/superpowers/plans/2026-05-13-order-panel-phase-3.md`
- Migration applied to live: `<TIMESTAMP>_reserve_order_component_single` (timestamp from Task 2)
- Three mandatory smoke results from Task 10 (tenant safety, demand parity, cutting-plan parity) with the actual SQL responses captured
- Screenshots from Task 10 step 9
- Acceptance-criteria checklist (copy the Phase 3 list from the spec)
- Any pre-existing lint/tsc failures left untouched
- **Reviewer note: this PR includes a live migration. Greg sign-off required before merge per CLAUDE.md workflow guardrails.**

---

## Self-review checklist

Before declaring the plan ready:

**1. Spec coverage** — each Phase 3 acceptance criterion in the spec maps to at least one task:

- Migration applied + listed + advisors check → Tasks 3.1–3.4
- migration-status.md updated → Task 3.5
- New API route returns 200/400/403/404/500 with correct shape → Task 4
- Tenant safety smoke (cross-org 404) → Task 10.5
- Demand parity smoke (swapped BOM) → Task 10.6
- Cutting-plan parity smoke (fresh plan overrides) → Task 10.7
- `useReserveOrderComponent` invalidates the right query keys → Task 5
- ＋ reserve button per row, gated by `canReserveMore` → Tasks 6 + 7
- Per-row reserve preserves other components' reservations → Task 10.3
- Reserve all still works → Task 10.8
- RES column updates in real time → Task 10.3

**2. Placeholder scan** — none of "TBD", "TODO", "implement later", "add error handling" appear.

**3. Type consistency** — `ReserveOrderComponentResult`, `useReserveOrderComponent`, `ReadinessRowProps` field names consistent across tasks.

**4. Out-of-scope discipline** — `reserve_order_components` not modified, `OrderComponentsDialog` not modified, no schema/RLS/trigger changes, no new tables, no changes to `lib/orders/reservation-predicate.ts` (Phase 2 contract).

---

## Out-of-scope reminders

- Do NOT modify the existing `reserve_order_components` RPC — Reserve all still uses it unchanged.
- Do NOT modify `CutlistMaterialDialog.tsx` or `OrderComponentsDialog.tsx` (Phase 2 contracts).
- Do NOT add columns to `component_reservations` — existing schema is sufficient.
- Do NOT change RLS policies on `component_reservations` — existing `organization_members` policies cover the new RPC's writes.
- Do NOT add a trigger; auto-release via `trg_auto_release_component_reservations` already covers per-order reservations.
- Do NOT introduce row-level locking on `component_reservations` — matches the existing RPC's behavior (last write wins).
- Do NOT touch `lib/orders/reservation-predicate.ts` — it's the Phase 2 contract and works as-is.
- Do NOT delete `slideOutProduct` state — still compiled-but-unreachable.
- Do NOT skip the three mandatory pre-merge smokes (tenant safety, demand parity, cutting-plan parity) — they are explicit acceptance criteria in the spec.
