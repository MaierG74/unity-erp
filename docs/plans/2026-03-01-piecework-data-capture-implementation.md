# Piecework Data Capture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure every completed job correctly captures earnings data (including transfer splits and support employee relationships) so the weekly payroll review page can calculate piecework totals.

**Architecture:** Three database additions (column, table, view) plus updates to the transfer RPC and dialog for custom earnings splits, and a new Support Assignments tab under Staff. All org-scoped with RLS.

**Tech Stack:** Supabase Postgres (RPCs, views, RLS), Next.js, React, TanStack Query, shadcn/ui, Tailwind

**Design doc:** `docs/plans/2026-03-01-piecework-data-capture-design.md`

---

### Task 1: Add `piece_rate_override` column to `job_card_items`

**Files:**
- Apply migration via Supabase MCP

**Step 1: Apply migration**

```sql
-- Add piece_rate_override for custom earnings splits (e.g., single-item transfer)
ALTER TABLE job_card_items
  ADD COLUMN IF NOT EXISTS piece_rate_override NUMERIC(10,2);

COMMENT ON COLUMN job_card_items.piece_rate_override IS
  'Manager-specified override of piece_rate for custom transfer splits. NULL = use piece_rate.';
```

Apply via `mcp__supabase__apply_migration` with name `add_piece_rate_override_to_job_card_items`.

**Step 2: Verify**

Run SQL to confirm column exists:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'job_card_items' AND column_name = 'piece_rate_override';
```

Expected: one row with `numeric`, `YES`.

**Step 3: Commit**

No local file changes for this task (migration applied via MCP).

---

### Task 2: Create `staff_support_links` table with RLS

**Files:**
- Apply migration via Supabase MCP

**Step 1: Apply migration**

Use the org-scoped RLS pattern from `assignment_pause_events`.

```sql
-- Table for semi-permanent support employee relationships
CREATE TABLE staff_support_links (
  link_id          SERIAL PRIMARY KEY,
  primary_staff_id INTEGER NOT NULL REFERENCES staff(staff_id) ON DELETE CASCADE,
  support_staff_id INTEGER NOT NULL REFERENCES staff(staff_id) ON DELETE CASCADE,
  cost_share_pct   NUMERIC(5,2) NOT NULL DEFAULT 100.00,
  effective_from   DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_until   DATE,
  org_id           UUID NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (primary_staff_id != support_staff_id),
  CHECK (cost_share_pct > 0 AND cost_share_pct <= 100)
);

CREATE INDEX idx_staff_support_links_primary ON staff_support_links(primary_staff_id);
CREATE INDEX idx_staff_support_links_support ON staff_support_links(support_staff_id);
CREATE INDEX idx_staff_support_links_org ON staff_support_links(org_id);

-- Enable RLS
ALTER TABLE staff_support_links ENABLE ROW LEVEL SECURITY;

-- Org-scoped SELECT
CREATE POLICY staff_support_links_select_org_member
ON staff_support_links FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = staff_support_links.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

-- Org-scoped INSERT
CREATE POLICY staff_support_links_insert_org_member
ON staff_support_links FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = staff_support_links.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

-- Org-scoped UPDATE
CREATE POLICY staff_support_links_update_org_member
ON staff_support_links FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = staff_support_links.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = staff_support_links.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);

-- Org-scoped DELETE
CREATE POLICY staff_support_links_delete_org_member
ON staff_support_links FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.user_id = auth.uid()
      AND m.org_id = staff_support_links.org_id
      AND m.is_active = true
      AND (m.banned_until IS NULL OR m.banned_until <= now())
  )
);
```

Apply via `mcp__supabase__apply_migration` with name `create_staff_support_links`.

**Step 2: Verify**

```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'staff_support_links';
```

Then run `mcp__supabase__get_advisors` with type `security` to confirm no missing RLS warnings.

---

### Task 3: Create `staff_piecework_earnings` SQL view

**Files:**
- Apply migration via Supabase MCP

**Step 1: Apply migration**

```sql
CREATE OR REPLACE VIEW staff_piecework_earnings AS
SELECT
  jc.staff_id,
  jc.org_id,
  jci.item_id,
  jc.job_card_id,
  jc.order_id,
  jc.completion_date,
  jci.job_id,
  jci.product_id,
  jci.completed_quantity,
  jci.piece_rate,
  jci.piece_rate_override,
  (jci.completed_quantity * COALESCE(jci.piece_rate_override, jci.piece_rate)) AS earned_amount
FROM job_cards jc
JOIN job_card_items jci ON jci.job_card_id = jc.job_card_id
WHERE jc.status = 'completed'
  AND jci.piece_rate IS NOT NULL
  AND jci.piece_rate > 0;

COMMENT ON VIEW staff_piecework_earnings IS
  'Read-only view of piecework earnings per job card item. Used by payroll review to aggregate weekly totals.';
```

Apply via `mcp__supabase__apply_migration` with name `create_staff_piecework_earnings_view`.

**Step 2: Verify**

```sql
SELECT * FROM staff_piecework_earnings LIMIT 5;
```

Should return rows (or empty if no completed piecework cards exist yet).

---

### Task 4: Update `transfer_assignment` RPC to support earnings split

**Files:**
- Apply migration via Supabase MCP

The RPC currently accepts `(p_assignment_id, p_new_staff_id, p_notes)`. We add an optional `p_earnings_split JSONB` parameter.

**Step 1: Apply migration**

Replace the function with the updated version. Key changes marked with `-- NEW`:

```sql
CREATE OR REPLACE FUNCTION transfer_assignment(
  p_assignment_id INTEGER,
  p_new_staff_id INTEGER,
  p_notes TEXT DEFAULT NULL,
  p_earnings_split JSONB DEFAULT NULL  -- NEW: [{item_id, original_amount}]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id UUID;
  v_job_status TEXT;
  v_old_staff_id INTEGER;
  v_order_id INTEGER;
  v_job_id INTEGER;
  v_order_detail_id INTEGER;
  v_bol_id INTEGER;
  v_job_instance_id TEXT;
  v_assignment_date DATE;
  v_start_minutes INTEGER;
  v_end_minutes INTEGER;
  v_pay_type TEXT;
  v_hourly_rate_id INTEGER;
  v_piece_rate_id INTEGER;
  v_job_card_id INTEGER;
  v_new_job_card_id INTEGER;
  v_new_assignment_id INTEGER;
  v_now TIMESTAMPTZ := now();
  v_item RECORD;
  v_has_progress BOOLEAN := false;
  v_split_entry JSONB;  -- NEW
  v_original_amount NUMERIC;  -- NEW
BEGIN
  SELECT o.org_id, lpa.job_status, lpa.staff_id, lpa.order_id, lpa.job_id,
         lpa.order_detail_id, lpa.bol_id, lpa.job_instance_id,
         lpa.assignment_date, lpa.start_minutes, lpa.end_minutes,
         lpa.pay_type, lpa.hourly_rate_id, lpa.piece_rate_id
  INTO v_org_id, v_job_status, v_old_staff_id, v_order_id, v_job_id,
       v_order_detail_id, v_bol_id, v_job_instance_id,
       v_assignment_date, v_start_minutes, v_end_minutes,
       v_pay_type, v_hourly_rate_id, v_piece_rate_id
  FROM labor_plan_assignments lpa
  JOIN orders o ON o.order_id = lpa.order_id
  WHERE lpa.assignment_id = p_assignment_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Assignment % not found or has no linked order', p_assignment_id;
  END IF;
  IF NOT is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'Access denied: not a member of this organisation';
  END IF;
  IF v_job_status NOT IN ('scheduled', 'issued', 'in_progress', 'on_hold') THEN
    RAISE EXCEPTION 'Cannot transfer assignment with status %', v_job_status;
  END IF;
  IF v_old_staff_id = p_new_staff_id THEN
    RAISE EXCEPTION 'Cannot transfer to the same staff member';
  END IF;

  UPDATE assignment_pause_events
  SET resumed_at = v_now
  WHERE assignment_id = p_assignment_id AND resumed_at IS NULL;

  SELECT jk.job_card_id INTO v_job_card_id
  FROM job_cards jk
  WHERE jk.order_id = v_order_id AND jk.staff_id = v_old_staff_id
  ORDER BY jk.created_at DESC LIMIT 1;

  IF v_job_card_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM job_card_items
      WHERE job_card_id = v_job_card_id AND completed_quantity > 0
    ) INTO v_has_progress;
  END IF;

  -- CASE A: Pre-start (no progress)
  IF v_job_status IN ('scheduled', 'issued') OR NOT v_has_progress THEN
    UPDATE labor_plan_assignments
    SET staff_id = p_new_staff_id, updated_at = v_now,
        completion_notes = COALESCE(p_notes, '') || ' [Transferred from staff ' || v_old_staff_id || ']'
    WHERE assignment_id = p_assignment_id;

    IF v_job_card_id IS NOT NULL THEN
      UPDATE job_cards SET staff_id = p_new_staff_id, updated_at = v_now
      WHERE job_card_id = v_job_card_id;
    END IF;

    RETURN jsonb_build_object(
      'type', 'reassigned',
      'assignment_id', p_assignment_id,
      'job_card_id', v_job_card_id,
      'old_staff_id', v_old_staff_id,
      'new_staff_id', p_new_staff_id
    );

  -- CASE B: Mid-work (has progress)
  ELSE
    -- Complete original assignment
    UPDATE labor_plan_assignments SET
      job_status = 'completed', completed_at = v_now,
      completion_notes = COALESCE(p_notes, '') || ' [Transferred remainder to staff ' || p_new_staff_id || ']',
      updated_at = v_now
    WHERE assignment_id = p_assignment_id;

    -- Complete original job card items
    IF v_job_card_id IS NOT NULL THEN
      -- NEW: Apply earnings split overrides to original worker's items
      IF p_earnings_split IS NOT NULL THEN
        FOR v_split_entry IN SELECT * FROM jsonb_array_elements(p_earnings_split) LOOP
          UPDATE job_card_items
          SET piece_rate_override = (v_split_entry->>'original_amount')::NUMERIC,
              status = 'completed',
              completion_time = v_now
          WHERE item_id = (v_split_entry->>'item_id')::INTEGER
            AND job_card_id = v_job_card_id;
        END LOOP;
      END IF;

      -- Mark remaining items as completed (those not already handled by split)
      UPDATE job_card_items
      SET status = 'completed', completion_time = v_now
      WHERE job_card_id = v_job_card_id AND status != 'completed';

      UPDATE job_cards
      SET status = 'completed', completion_date = v_now::date
      WHERE job_card_id = v_job_card_id;
    END IF;

    -- Create new job card for new worker
    INSERT INTO job_cards (order_id, staff_id, issue_date, status, notes, created_at, updated_at)
    VALUES (v_order_id, p_new_staff_id, CURRENT_DATE, 'pending',
            'Transferred from staff ' || v_old_staff_id || '. ' || COALESCE(p_notes, ''),
            v_now, v_now)
    RETURNING job_card_id INTO v_new_job_card_id;

    -- Copy items to new card with remaining quantities
    FOR v_item IN
      SELECT item_id, job_id, product_id, quantity, completed_quantity, piece_rate
      FROM job_card_items WHERE job_card_id = v_job_card_id
    LOOP
      IF v_item.quantity - v_item.completed_quantity > 0 THEN
        -- NEW: Calculate new worker's piece_rate_override from split
        v_original_amount := NULL;
        IF p_earnings_split IS NOT NULL THEN
          SELECT (elem->>'original_amount')::NUMERIC INTO v_original_amount
          FROM jsonb_array_elements(p_earnings_split) elem
          WHERE (elem->>'item_id')::INTEGER = v_item.item_id;
        END IF;

        INSERT INTO job_card_items (
          job_card_id, job_id, product_id, quantity, completed_quantity,
          piece_rate, piece_rate_override, status, created_at, updated_at
        ) VALUES (
          v_new_job_card_id, v_item.job_id, v_item.product_id,
          v_item.quantity - v_item.completed_quantity, 0,
          v_item.piece_rate,
          CASE WHEN v_original_amount IS NOT NULL
               THEN v_item.piece_rate - v_original_amount
               ELSE NULL END,
          'pending', v_now, v_now
        );
      END IF;
    END LOOP;

    -- Create new assignment
    INSERT INTO labor_plan_assignments (
      job_instance_id, order_id, order_detail_id, bol_id, job_id,
      staff_id, assignment_date, start_minutes, end_minutes,
      status, pay_type, hourly_rate_id, piece_rate_id,
      job_status, issued_at, created_at, updated_at, completion_notes
    ) VALUES (
      v_job_instance_id || ':transfer', v_order_id, v_order_detail_id, v_bol_id, v_job_id,
      p_new_staff_id, CURRENT_DATE, v_start_minutes, v_end_minutes,
      'scheduled', v_pay_type, v_hourly_rate_id, v_piece_rate_id,
      'issued', v_now, v_now, v_now,
      'Transferred from staff ' || v_old_staff_id
    ) RETURNING assignment_id INTO v_new_assignment_id;

    RETURN jsonb_build_object(
      'type', 'split',
      'old_assignment_id', p_assignment_id,
      'new_assignment_id', v_new_assignment_id,
      'old_job_card_id', v_job_card_id,
      'new_job_card_id', v_new_job_card_id,
      'old_staff_id', v_old_staff_id,
      'new_staff_id', p_new_staff_id
    );
  END IF;
END;
$$;
```

Apply via `mcp__supabase__apply_migration` with name `transfer_assignment_earnings_split`.

**Step 2: Verify**

```sql
SELECT proname, pronargs FROM pg_proc WHERE proname = 'transfer_assignment';
```

Should show 4 arguments.

---

### Task 5: Update `TransferParams` and `useJobActions` hook

**Files:**
- Modify: `hooks/use-job-actions.ts` (lines 21-25, 80-91)

**Step 1: Update TransferParams interface**

In `hooks/use-job-actions.ts`, change the `TransferParams` interface:

```typescript
interface TransferParams {
  assignmentId: number;
  newStaffId: number;
  notes?: string;
  earningsSplit?: { item_id: number; original_amount: number }[];
}
```

**Step 2: Update transferJob mutation**

Update the `mutationFn` to pass the new parameter:

```typescript
const transferJob = useMutation({
  mutationFn: async ({ assignmentId, newStaffId, notes, earningsSplit }: TransferParams) => {
    const { data, error } = await supabase.rpc('transfer_assignment', {
      p_assignment_id: assignmentId,
      p_new_staff_id: newStaffId,
      p_notes: notes ?? null,
      p_earnings_split: earningsSplit ?? null,
    });
    if (error) throw error;
    return data;
  },
  onSuccess: invalidateAll,
  onError: (error) => toast.error('Failed to transfer job', { description: (error as Error).message }),
});
```

**Step 3: Verify**

Run `npx tsc --noEmit` — should have no new errors.

**Step 4: Commit**

```bash
git add hooks/use-job-actions.ts
git commit -m "feat: add earningsSplit param to transfer mutation"
```

---

### Task 6: Add `fetchJobCardItemsForTransfer` query

**Files:**
- Modify: `lib/queries/factoryFloor.ts`

The transfer dialog needs to fetch job card items (with piece_rate) to show the earnings split section. We already have `fetchJobCardItems` for the complete dialog — reuse the same function.

**Step 1: Check existing function**

`fetchJobCardItems(jobCardId)` in `lib/queries/factoryFloor.ts` already returns `piece_rate`, `quantity`, `completed_quantity`, `item_id`. This is exactly what the transfer dialog needs. No new query function required.

**Step 2: Verify type includes piece_rate**

Check that `JobCardItemForCompletion` interface includes `piece_rate`. If not, add it.

The interface (around line 150 in `factoryFloor.ts`):
```typescript
export interface JobCardItemForCompletion {
  item_id: number;
  job_card_id: number;
  job_id: number | null;
  product_id: number | null;
  job_name: string | null;
  product_name: string | null;
  quantity: number;
  completed_quantity: number;
  piece_rate: number | null;
}
```

This already has `piece_rate`. No changes needed for this task.

---

### Task 7: Update Transfer Job Dialog with earnings split section

**Files:**
- Modify: `components/factory-floor/transfer-job-dialog.tsx`

This is the largest frontend change. The dialog needs to:
1. Detect if the job is piecework and in progress
2. Fetch job card items (to show piece rates)
3. Show an earnings split section for items where qty=1 or when custom split is toggled

**Step 1: Update imports and props**

```typescript
'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import type { FloorStaffJob } from './types';
import { fetchActiveStaff, fetchJobCardItems } from '@/lib/queries/factoryFloor';
```

**Step 2: Update the onTransfer prop signature**

```typescript
interface TransferJobDialogProps {
  job: FloorStaffJob | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTransfer: (newStaffId: number, notes?: string, earningsSplit?: { item_id: number; original_amount: number }[]) => void;
  isPending: boolean;
}
```

**Step 3: Add state and queries inside the component**

After existing state (`selectedStaffId`, `search`, `notes`), add:

```typescript
const [customSplit, setCustomSplit] = useState(false);
const [splitAmounts, setSplitAmounts] = useState<Record<number, number>>({});

const isPiecework = job?.pay_type === 'piece';
const isInProgress = job?.job_status === 'in_progress';
const showEarningsSplit = isPiecework && isInProgress;

const { data: jobItems } = useQuery({
  queryKey: ['job-card-items', job?.job_card_id],
  queryFn: () => fetchJobCardItems(job!.job_card_id!),
  enabled: open && showEarningsSplit && !!job?.job_card_id,
});

// Items that need a custom rand split (qty=1 or custom toggle on)
const needsCustomSplit = useMemo(() => {
  if (!jobItems) return false;
  return jobItems.some((i) => i.quantity === 1 && (i.piece_rate ?? 0) > 0);
}, [jobItems]);

// Initialize split amounts when items load
useEffect(() => {
  if (jobItems && Object.keys(splitAmounts).length === 0) {
    const initial: Record<number, number> = {};
    for (const item of jobItems) {
      if ((item.piece_rate ?? 0) > 0) {
        // Default: proportional to completed/total
        const ratio = item.completed_quantity / Math.max(item.quantity, 1);
        initial[item.item_id] = Math.round((item.piece_rate ?? 0) * ratio * 100) / 100;
      }
    }
    setSplitAmounts(initial);
  }
}, [jobItems]);
```

**Step 4: Update handleSubmit**

```typescript
const handleSubmit = () => {
  if (!selectedStaffId) return;

  let earningsSplit: { item_id: number; original_amount: number }[] | undefined;
  if (showEarningsSplit && (needsCustomSplit || customSplit) && jobItems) {
    earningsSplit = jobItems
      .filter((i) => (i.piece_rate ?? 0) > 0 && splitAmounts[i.item_id] != null)
      .map((i) => ({
        item_id: i.item_id,
        original_amount: splitAmounts[i.item_id],
      }));
  }

  onTransfer(selectedStaffId, notes || undefined, earningsSplit);
  setSelectedStaffId(null);
  setSearch('');
  setNotes('');
  setSplitAmounts({});
  setCustomSplit(false);
};
```

**Step 5: Add earnings split section to the JSX**

Insert after the "From/To" summary block (after the `selectedStaff &&` section, before the Notes section):

```tsx
{/* Earnings split for piecework transfers */}
{showEarningsSplit && jobItems && jobItems.length > 0 && (
  <div className="space-y-3">
    <div className="flex items-center justify-between">
      <Label>Earnings Split</Label>
      {!needsCustomSplit && (
        <div className="flex items-center gap-2">
          <Label htmlFor="custom-split" className="text-xs text-muted-foreground">Custom split</Label>
          <Switch id="custom-split" checked={customSplit} onCheckedChange={setCustomSplit} />
        </div>
      )}
    </div>

    {(needsCustomSplit || customSplit) ? (
      <div className="space-y-2">
        {jobItems.filter((i) => (i.piece_rate ?? 0) > 0).map((item) => (
          <div key={item.item_id} className="p-3 rounded-md border bg-card space-y-2">
            <div className="text-sm font-medium truncate">
              {item.job_name ?? item.product_name ?? 'Item'}
            </div>
            <div className="text-xs text-muted-foreground">
              Total rate: R{(item.piece_rate ?? 0).toFixed(2)} per piece
              {item.quantity > 1 && ` × ${item.quantity} = R${((item.piece_rate ?? 0) * item.quantity).toFixed(2)}`}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{job?.staff_name} earns</Label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R</span>
                  <Input
                    type="number"
                    min={0}
                    max={item.piece_rate ?? 0}
                    step={0.01}
                    value={splitAmounts[item.item_id] ?? 0}
                    onChange={(e) => setSplitAmounts((prev) => ({
                      ...prev,
                      [item.item_id]: Math.min(item.piece_rate ?? 0, Math.max(0, parseFloat(e.target.value) || 0)),
                    }))}
                    className="pl-7 text-sm"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">New worker earns</Label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R</span>
                  <Input
                    type="number"
                    value={((item.piece_rate ?? 0) - (splitAmounts[item.item_id] ?? 0)).toFixed(2)}
                    readOnly
                    className="pl-7 text-sm bg-muted"
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    ) : (
      <p className="text-xs text-muted-foreground">
        Earnings will be split by completed quantities. Toggle &quot;Custom split&quot; to specify rand amounts.
      </p>
    )}
  </div>
)}
```

**Step 6: Update FloorStaffJob type**

The `FloorStaffJob` type in `components/factory-floor/types.ts` needs `pay_type` if not already present. Check and add:

```typescript
pay_type: 'hourly' | 'piece' | null;
```

Also update the `factory_floor_status` view to include `pay_type` from `labor_plan_assignments`.

**Step 7: Verify**

Run `npx tsc --noEmit` — no new errors.

**Step 8: Commit**

```bash
git add components/factory-floor/transfer-job-dialog.tsx components/factory-floor/types.ts
git commit -m "feat: add earnings split section to transfer dialog for piecework jobs"
```

---

### Task 8: Update factory-floor-page.tsx to pass earningsSplit

**Files:**
- Modify: `components/factory-floor/factory-floor-page.tsx` (lines 124-142)

**Step 1: Update the TransferJobDialog's onTransfer callback**

Change the current callback from:

```typescript
onTransfer={(newStaffId, notes) => {
  if (!selectedJob) return;
  transferJob.mutate({
    assignmentId: selectedJob.assignment_id,
    newStaffId,
    notes,
  }, {
    onSuccess: () => {
      setTransferDialogOpen(false);
      setSelectedJob(null);
    },
  });
}}
```

To:

```typescript
onTransfer={(newStaffId, notes, earningsSplit) => {
  if (!selectedJob) return;
  transferJob.mutate({
    assignmentId: selectedJob.assignment_id,
    newStaffId,
    notes,
    earningsSplit,
  }, {
    onSuccess: () => {
      setTransferDialogOpen(false);
      setSelectedJob(null);
    },
  });
}}
```

**Step 2: Verify**

Run `npx tsc --noEmit`.

**Step 3: Commit**

```bash
git add components/factory-floor/factory-floor-page.tsx
git commit -m "feat: pass earningsSplit from transfer dialog to mutation"
```

---

### Task 9: Add `pay_type` to factory floor status view

**Files:**
- Apply migration via Supabase MCP

**Step 1: Check if pay_type is already in the view**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'factory_floor_status' AND column_name = 'pay_type';
```

If not present, update the view to include `lpa.pay_type` from `labor_plan_assignments`.

**Step 2: Apply migration if needed**

Get the current view definition and add `lpa.pay_type` to the SELECT list. Apply via `mcp__supabase__apply_migration` with name `factory_floor_status_add_pay_type`.

**Step 3: Update FloorStaffJob type**

In `components/factory-floor/types.ts`, add `pay_type` to the `FloorStaffJob` interface if not already there.

**Step 4: Verify**

```sql
SELECT pay_type FROM factory_floor_status LIMIT 1;
```

**Step 5: Commit**

```bash
git add components/factory-floor/types.ts
git commit -m "feat: add pay_type to factory floor status view and types"
```

---

### Task 10: Create Support Assignments query functions

**Files:**
- Create: `lib/queries/staffSupport.ts`

**Step 1: Create query file**

```typescript
import { supabase } from '@/lib/supabase';

export interface SupportLink {
  link_id: number;
  primary_staff_id: number;
  primary_staff_name: string;
  support_staff_id: number;
  support_staff_name: string;
  cost_share_pct: number;
  effective_from: string;
  effective_until: string | null;
}

export async function fetchSupportLinks(): Promise<SupportLink[]> {
  const { data, error } = await supabase
    .from('staff_support_links')
    .select(`
      link_id,
      primary_staff_id,
      primary_staff:staff!staff_support_links_primary_staff_id_fkey(first_name, last_name),
      support_staff_id,
      support_staff:staff!staff_support_links_support_staff_id_fkey(first_name, last_name),
      cost_share_pct,
      effective_from,
      effective_until
    `)
    .is('effective_until', null)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    link_id: row.link_id,
    primary_staff_id: row.primary_staff_id,
    primary_staff_name: row.primary_staff
      ? `${row.primary_staff.first_name} ${row.primary_staff.last_name}`
      : 'Unknown',
    support_staff_id: row.support_staff_id,
    support_staff_name: row.support_staff
      ? `${row.support_staff.first_name} ${row.support_staff.last_name}`
      : 'Unknown',
    cost_share_pct: row.cost_share_pct,
    effective_from: row.effective_from,
    effective_until: row.effective_until,
  }));
}

export async function createSupportLink(params: {
  primaryStaffId: number;
  supportStaffId: number;
  costSharePct: number;
  orgId: string;
}): Promise<void> {
  const { error } = await supabase
    .from('staff_support_links')
    .insert({
      primary_staff_id: params.primaryStaffId,
      support_staff_id: params.supportStaffId,
      cost_share_pct: params.costSharePct,
      org_id: params.orgId,
    });
  if (error) throw error;
}

export async function updateSupportLink(
  linkId: number,
  costSharePct: number,
): Promise<void> {
  const { error } = await supabase
    .from('staff_support_links')
    .update({ cost_share_pct: costSharePct, updated_at: new Date().toISOString() })
    .eq('link_id', linkId);
  if (error) throw error;
}

export async function deactivateSupportLink(linkId: number): Promise<void> {
  const { error } = await supabase
    .from('staff_support_links')
    .update({ effective_until: new Date().toISOString().split('T')[0], updated_at: new Date().toISOString() })
    .eq('link_id', linkId);
  if (error) throw error;
}
```

**Step 2: Verify**

Run `npx tsc --noEmit`.

**Step 3: Commit**

```bash
git add lib/queries/staffSupport.ts
git commit -m "feat: add CRUD query functions for staff support links"
```

---

### Task 11: Create Support Assignments component

**Files:**
- Create: `components/features/staff/SupportAssignmentsTab.tsx`

**Step 1: Create the component**

```typescript
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Plus, Pencil, XCircle } from 'lucide-react';
import {
  fetchSupportLinks, createSupportLink, updateSupportLink, deactivateSupportLink,
  type SupportLink,
} from '@/lib/queries/staffSupport';
import { fetchActiveStaff, type StaffOption } from '@/lib/queries/factoryFloor';
import { useOrg } from '@/hooks/use-org';

export function SupportAssignmentsTab() {
  const queryClient = useQueryClient();
  const { orgId } = useOrg();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<SupportLink | null>(null);

  const { data: links, isLoading } = useQuery({
    queryKey: ['support-links'],
    queryFn: fetchSupportLinks,
  });

  const { data: allStaff } = useQuery({
    queryKey: ['active-staff'],
    queryFn: fetchActiveStaff,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['support-links'] });

  const createMutation = useMutation({
    mutationFn: createSupportLink,
    onSuccess: () => { invalidate(); setAddDialogOpen(false); toast.success('Support link created'); },
    onError: (e) => toast.error('Failed to create link', { description: (e as Error).message }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ linkId, pct }: { linkId: number; pct: number }) => updateSupportLink(linkId, pct),
    onSuccess: () => { invalidate(); setEditingLink(null); toast.success('Support link updated'); },
    onError: (e) => toast.error('Failed to update link', { description: (e as Error).message }),
  });

  const deactivateMutation = useMutation({
    mutationFn: deactivateSupportLink,
    onSuccess: () => { invalidate(); toast.success('Support link deactivated'); },
    onError: (e) => toast.error('Failed to deactivate link', { description: (e as Error).message }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Support Assignments</h3>
          <p className="text-sm text-muted-foreground">
            Link support employees to primary workers. Support costs are deducted from the primary worker&apos;s piecework at payroll time.
          </p>
        </div>
        <Button onClick={() => setAddDialogOpen(true)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Add Link
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : !links || links.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No support assignments configured.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Primary Worker</TableHead>
                <TableHead>Support Employee</TableHead>
                <TableHead className="text-right">Cost Share %</TableHead>
                <TableHead>Since</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((link) => (
                <TableRow key={link.link_id}>
                  <TableCell className="font-medium">{link.primary_staff_name}</TableCell>
                  <TableCell>{link.support_staff_name}</TableCell>
                  <TableCell className="text-right">{link.cost_share_pct}%</TableCell>
                  <TableCell>{link.effective_from}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => setEditingLink(link)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        onClick={() => deactivateMutation.mutate(link.link_id)}
                        disabled={deactivateMutation.isPending}
                      >
                        <XCircle className="h-3.5 w-3.5 text-red-400" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add Dialog */}
      <AddSupportLinkDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        staff={allStaff ?? []}
        orgId={orgId ?? ''}
        isPending={createMutation.isPending}
        onSubmit={(params) => createMutation.mutate(params)}
      />

      {/* Edit Dialog */}
      {editingLink && (
        <EditSupportLinkDialog
          link={editingLink}
          open={!!editingLink}
          onOpenChange={(open) => !open && setEditingLink(null)}
          isPending={updateMutation.isPending}
          onSubmit={(pct) => updateMutation.mutate({ linkId: editingLink.link_id, pct })}
        />
      )}
    </div>
  );
}

function AddSupportLinkDialog({
  open, onOpenChange, staff, orgId, isPending, onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staff: StaffOption[];
  orgId: string;
  isPending: boolean;
  onSubmit: (params: { primaryStaffId: number; supportStaffId: number; costSharePct: number; orgId: string }) => void;
}) {
  const [primaryId, setPrimaryId] = useState('');
  const [supportId, setSupportId] = useState('');
  const [pct, setPct] = useState('100');

  const handleSubmit = () => {
    if (!primaryId || !supportId || !pct) return;
    onSubmit({
      primaryStaffId: parseInt(primaryId),
      supportStaffId: parseInt(supportId),
      costSharePct: parseFloat(pct),
      orgId,
    });
    setPrimaryId('');
    setSupportId('');
    setPct('100');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Support Link</DialogTitle>
          <DialogDescription>
            Link a support employee to a primary worker. The support employee&apos;s cost will be deducted from the primary worker&apos;s piecework earnings.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Primary Worker</Label>
            <Select value={primaryId} onValueChange={setPrimaryId}>
              <SelectTrigger><SelectValue placeholder="Select primary worker..." /></SelectTrigger>
              <SelectContent>
                {staff.filter((s) => s.staff_id.toString() !== supportId).map((s) => (
                  <SelectItem key={s.staff_id} value={s.staff_id.toString()}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Support Employee</Label>
            <Select value={supportId} onValueChange={setSupportId}>
              <SelectTrigger><SelectValue placeholder="Select support employee..." /></SelectTrigger>
              <SelectContent>
                {staff.filter((s) => s.staff_id.toString() !== primaryId).map((s) => (
                  <SelectItem key={s.staff_id} value={s.staff_id.toString()}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Cost Share %</Label>
            <Input
              type="number" min={1} max={100} step={0.01}
              value={pct} onChange={(e) => setPct(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Percentage of the support employee&apos;s weekly cost charged to this primary worker.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!primaryId || !supportId || isPending}>
            {isPending ? 'Creating...' : 'Create Link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditSupportLinkDialog({
  link, open, onOpenChange, isPending, onSubmit,
}: {
  link: SupportLink;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  onSubmit: (pct: number) => void;
}) {
  const [pct, setPct] = useState(link.cost_share_pct.toString());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Cost Share</DialogTitle>
          <DialogDescription>
            Update the cost share percentage for {link.support_staff_name} supporting {link.primary_staff_name}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label>Cost Share %</Label>
          <Input
            type="number" min={1} max={100} step={0.01}
            value={pct} onChange={(e) => setPct(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onSubmit(parseFloat(pct))} disabled={isPending}>
            {isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Check `useOrg` hook exists**

Search for `useOrg` in the codebase. If it doesn't exist, we need an alternative way to get the current org_id. Check `hooks/` directory.

**Step 3: Verify**

Run `npx tsc --noEmit`.

**Step 4: Commit**

```bash
git add components/features/staff/SupportAssignmentsTab.tsx
git commit -m "feat: create Support Assignments tab component"
```

---

### Task 12: Add Support Assignments tab to Staff page

**Files:**
- Modify: `app/staff/page.tsx` (lines 50-104)

**Step 1: Add import**

```typescript
import { SupportAssignmentsTab } from '@/components/features/staff/SupportAssignmentsTab';
import { Link2 } from 'lucide-react';
```

**Step 2: Add tab trigger after Payroll (line 66)**

```tsx
<TabsTrigger value="support" onClick={() => router.push('/staff?tab=support')}>
  <Link2 className="mr-2 h-4 w-4" />
  Support
</TabsTrigger>
```

**Step 3: Add tab content after the Payroll TabsContent (before closing `</Tabs>`)**

```tsx
<TabsContent value="support" className="space-y-2">
  <div className="rounded-md border">
    <div className="p-4">
      <SupportAssignmentsTab />
    </div>
  </div>
</TabsContent>
```

**Step 4: Ensure activeTab handles the new value**

Check how `activeTab` is derived (likely from URL or default). Make sure `"support"` is a valid value.

**Step 5: Verify**

Run `npx tsc --noEmit`.

**Step 6: Commit**

```bash
git add app/staff/page.tsx
git commit -m "feat: add Support Assignments tab to Staff page"
```

---

### Task 13: Browser verification

**Step 1: Navigate to factory floor**

Open `http://localhost:3000/factory-floor` in Chrome. Click on a staff member with an active job.

**Step 2: Test transfer dialog**

Click "Transfer" → verify the dialog opens. If the job is piecework and in_progress, the earnings split section should appear.

**Step 3: Navigate to Staff > Support tab**

Open `http://localhost:3000/staff`. Click the "Support" tab. Verify the page loads with "No support assignments configured."

**Step 4: Test adding a support link**

Click "Add Link". Select a primary worker and support employee. Set cost share to 50%. Click "Create Link". Verify the table updates.

**Step 5: Check console for errors**

Run `mcp__chrome-devtools__list_console_messages` to verify no runtime errors.

**Step 6: Run type check and security advisors**

```bash
npx tsc --noEmit
```

Run `mcp__supabase__get_advisors` with type `security` to check for missing RLS on new tables.
