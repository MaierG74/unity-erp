# Work Pool & Job Card Issuance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current "Generate from BOL creates job cards directly" model with a two-phase system: (1) a Work Pool that captures demand (snapshot) from BOL or manual entry, and (2) an Issue Job Card action that atomically pulls quantities from the pool into independent, assignable job cards. The scheduler sidebar shows pool demand and triggers issuance via drag-and-drop with time estimates.

**Architecture:** New `job_work_pool` table holds demand rows (one per order + BOL line or manual entry). A `source` column distinguishes `'bol'` vs `'manual'` entries as first-class citizens. Job cards reference a `work_pool_id`. Issuance state (issued_qty, remaining_qty) is always **computed** from active card items — never stored. Issuance is atomic via a Postgres RPC that locks the pool row, validates availability, creates the card+item, and returns the result in one transaction. Pool rows are **snapshots** of demand at generation time; a reconciliation banner warns when order/BOL quantities have drifted.

**Tech Stack:** Supabase (Postgres migration + RLS + RPC), React/Next.js, TanStack Query, shadcn/ui components.

**Companion spec:** See [`2026-03-05-work-pool-exception-audit-spec.md`](./2026-03-05-work-pool-exception-audit-spec.md) for the canonical exception, acknowledgement, and audit model that this plan now depends on.

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Issuance state | Computed, not stored | Codex P2: `remaining = required - SUM(active issued)`. No `fully_issued` status to drift. Pool status is only `active` or `cancelled`. |
| Issuance atomicity | Postgres RPC | Codex P1: Single transaction with `SELECT ... FOR UPDATE` lock. No multi-step client orchestration. |
| Manual jobs | First-class `source` column | Codex P1: `source TEXT NOT NULL CHECK (source IN ('bol', 'manual'))`. Unique constraint only on BOL rows. |
| Pool model | Snapshot with reconciliation | Codex P3 + user decision: Pool captures demand at generation time. Stale detection compares pool vs current order×BOL. Banner on order page + icon on scheduler sidebar. |
| Scheduler behavior | Shows demand (pool items with remaining > 0) | User decision: Dragging a pool job onto a staff lane opens an issue dialog with quantity + time estimate. Scheduling and issuance happen together. |
| Over-issuance on issuance | Block by default, allow override with required reason | User decision: Any user who can issue job cards may override, but only after an explicit warning + reason. Override creates/updates an exception immediately. |
| Reconciliation over-issue | Apply order change immediately, create production exception | User decision: order reality changes immediately; production handles the downstream variance through an active exception queue. |
| Exception model | Dedicated tables, per pool row, one open record per exception type | Current state lives in `job_work_pool_exceptions`; every change appends to `job_work_pool_exception_activity` for full auditability. |
| Queue visibility | Acknowledged exceptions stay visible until resolved | Acknowledgement is a handshake, not closure. Auto-resolve only when the mismatch disappears or a user explicitly chooses a resolution path. |
| Tenancy | `org_id` + org-member RLS on new tables; RPC validates org server-side | Use standard `public.is_org_member(org_id)` / `organization_members` pattern. Full RLS tightening for `job_cards` remains separate work. |

---

## Important Context

### Current Schema (relevant tables)

**`job_cards`** — No `org_id` column, no org-scoped RLS (currently just `auth.role() = 'authenticated'`). Columns: `job_card_id` (PK serial), `order_id`, `staff_id`, `issue_date`, `due_date`, `completion_date`, `status` (text, default 'pending'), `notes`, `created_at`, `updated_at`.

**`job_card_items`** — Same RLS situation. Columns: `item_id` (PK serial), `job_card_id` (FK), `product_id`, `job_id`, `quantity`, `completed_quantity`, `piece_rate`, `status`, `start_time`, `completion_time`, `notes`, `piece_rate_override`.

**`billoflabour`** — Has `org_id`. Columns: `bol_id` (PK), `product_id`, `job_id`, `time_required`, `quantity`, `time_unit`, `rate_id`, `pay_type`, `piece_rate_id`, `hourly_rate_id`.

**`order_details`** — Has `org_id`. Columns: `order_detail_id` (PK), `order_id`, `product_id`, `quantity`, `unit_price`.

**`labor_plan_assignments`** — No `org_id`. References jobs via composite `job_instance_id` string (e.g. `order-321:detail-48:bol-18:job-11`).

### Key Files

- **Job Cards Tab UI**: `components/features/orders/JobCardsTab.tsx` — Contains `JobCardsTab`, `AddJobDialog`, `GenerateBOLDialog`, and the helper `createJobCard()`
- **Labor Planning Queries**: `lib/queries/laborPlanning.ts` — Contains `fetchOpenOrdersWithLabor()`, `loadJobCardItemsByOrder()`, `normalizeOrderRow()`, orphaned-assignment filtering, `fetchLaborPlanningPayload()`
- **Job Card Detail Page**: `app/staff/job-cards/[id]/page.tsx` — Status mutations, item completion, cancel cascade
- **Job Queue Table**: `components/production/job-queue-table.tsx` — Lists all job cards with filters
- **Scheduler Board**: `components/production/labor-planning-board.tsx` — Drag-and-drop staff lanes, sidebar with order jobs
- **Staff Lane List**: `components/labor-planning/staff-lane-list.tsx` — Drop handler that creates assignments + job cards

### Scheduler Integration (current state)

The scheduler sidebar builds its job list from two sources:
1. **BOL entries** on order products (via `normalizeDetailJobs`)
2. **Active job card items** (via `loadJobCardItemsByOrder`)

A recent fix added logic: if an order has ANY job cards (including cancelled), only BOL jobs with active card items appear. Orphaned `labor_plan_assignments` for all-cancelled-card orders are filtered out.

**After this feature:** The scheduler reads from `job_work_pool_status` instead of raw BOL. Pool items with `remaining_qty > 0` appear as draggable demand. Dropping onto a staff lane triggers the issuance RPC + creates the schedule assignment.

### Tenancy Note

`job_cards` and `job_card_items` currently lack `org_id` and have permissive RLS. The new `job_work_pool` table MUST have `org_id` with proper org-scoped RLS. The issuance RPC validates org ownership server-side. Tightening RLS on `job_cards`/`job_card_items` is out of scope but tracked separately.

---

## Phase 1: Database — Work Pool, Exception Tables, and Issuance RPC

### Task 1: Create `job_work_pool`, exception tables, and issuance RPC

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_create_job_work_pool.sql`

**Step 1: Write the migration SQL**

```sql
-- =============================================================================
-- Work Pool: captures labour demand (snapshot) for an order.
-- One row per order_detail + BOL line (source='bol') or manual entry (source='manual').
-- Issuance state is ALWAYS computed, never stored.
-- =============================================================================

CREATE TABLE job_work_pool (
  pool_id         SERIAL PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organizations(id),
  order_id        INTEGER NOT NULL REFERENCES orders(order_id),
  order_detail_id INTEGER REFERENCES order_details(order_detail_id),  -- nullable for manual
  product_id      INTEGER REFERENCES products(product_id),
  job_id          INTEGER REFERENCES jobs(job_id),
  bol_id          INTEGER REFERENCES billoflabour(bol_id),            -- nullable for manual
  source          TEXT NOT NULL DEFAULT 'bol'
                    CHECK (source IN ('bol', 'manual')),
  required_qty    INTEGER NOT NULL DEFAULT 1,
  pay_type        TEXT NOT NULL DEFAULT 'hourly',
  piece_rate      NUMERIC,            -- snapshot from BOL/piece_work_rates at generation time
  hourly_rate_id  INTEGER,            -- snapshot
  piece_rate_id   INTEGER,            -- snapshot
  time_per_unit   NUMERIC,            -- snapshot: estimated minutes per unit (for time estimates)
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'cancelled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: only BOL-sourced rows are deduplicated by order_detail + bol line
CREATE UNIQUE INDEX idx_work_pool_bol_unique
  ON job_work_pool(order_detail_id, bol_id)
  WHERE bol_id IS NOT NULL;

-- Indexes
CREATE INDEX idx_job_work_pool_order ON job_work_pool(order_id);
CREATE INDEX idx_job_work_pool_org   ON job_work_pool(org_id);

-- RLS
ALTER TABLE job_work_pool ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_read_work_pool" ON job_work_pool
  FOR SELECT USING (public.is_org_member(org_id));

CREATE POLICY "org_insert_work_pool" ON job_work_pool
  FOR INSERT WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "org_update_work_pool" ON job_work_pool
  FOR UPDATE USING (public.is_org_member(org_id));

CREATE POLICY "org_delete_work_pool" ON job_work_pool
  FOR DELETE USING (public.is_org_member(org_id));

-- =============================================================================
-- Add work_pool_id FK to job_card_items
-- =============================================================================

ALTER TABLE job_card_items
  ADD COLUMN work_pool_id INTEGER REFERENCES job_work_pool(pool_id);

CREATE INDEX idx_job_card_items_pool ON job_card_items(work_pool_id);

-- =============================================================================
-- View: computes issued and remaining quantities per pool row
-- Issuance state is DERIVED, not stored. This is the single source of truth.
-- =============================================================================

CREATE OR REPLACE VIEW job_work_pool_status AS
SELECT
  p.*,
  COALESCE(agg.issued_qty, 0)    AS issued_qty,
  COALESCE(agg.completed_qty, 0) AS completed_qty,
  p.required_qty - COALESCE(agg.issued_qty, 0) AS remaining_qty
FROM job_work_pool p
LEFT JOIN LATERAL (
  SELECT
    SUM(jci.quantity)            AS issued_qty,
    SUM(jci.completed_quantity)  AS completed_qty
  FROM job_card_items jci
  JOIN job_cards jc ON jc.job_card_id = jci.job_card_id
  WHERE jci.work_pool_id = p.pool_id
    AND jc.status  NOT IN ('cancelled')
    AND jci.status NOT IN ('cancelled')
) agg ON TRUE;

-- =============================================================================
-- Production exceptions for over-issuance / reconciliation mismatches
-- Current state lives here; audit lives in the activity table below.
-- =============================================================================

CREATE TABLE job_work_pool_exceptions (
  exception_id               BIGSERIAL PRIMARY KEY,
  org_id                     UUID NOT NULL REFERENCES organizations(id),
  order_id                   INTEGER NOT NULL REFERENCES orders(order_id),
  work_pool_id               INTEGER NOT NULL REFERENCES job_work_pool(pool_id) ON DELETE CASCADE,
  exception_type             TEXT NOT NULL
                               CHECK (exception_type IN ('over_issued_override', 'over_issued_after_reconcile')),
  status                     TEXT NOT NULL
                               CHECK (status IN ('open', 'acknowledged', 'resolved')),
  required_qty_snapshot      INTEGER NOT NULL,
  issued_qty_snapshot        INTEGER NOT NULL,
  variance_qty               INTEGER NOT NULL,
  trigger_source             TEXT NOT NULL
                               CHECK (trigger_source IN ('issuance_override', 'order_quantity_change', 'pool_reconcile', 'system')),
  trigger_context            JSONB NOT NULL DEFAULT '{}'::jsonb,
  triggered_by               UUID REFERENCES auth.users(id),
  triggered_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_by            UUID REFERENCES auth.users(id),
  acknowledged_at            TIMESTAMPTZ,
  resolution_type            TEXT
                               CHECK (resolution_type IN ('cancel_unstarted_cards', 'move_excess_to_stock', 'accept_overproduction_rework')),
  resolution_notes           TEXT,
  resolved_by                UUID REFERENCES auth.users(id),
  resolved_at                TIMESTAMPTZ,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_job_work_pool_exceptions_open_unique
  ON job_work_pool_exceptions(work_pool_id, exception_type)
  WHERE status IN ('open', 'acknowledged');

CREATE INDEX idx_job_work_pool_exceptions_queue
  ON job_work_pool_exceptions(org_id, status, exception_type, triggered_at DESC);

ALTER TABLE job_work_pool_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_read_work_pool_exceptions" ON job_work_pool_exceptions
  FOR SELECT USING (public.is_org_member(org_id));

CREATE POLICY "org_insert_work_pool_exceptions" ON job_work_pool_exceptions
  FOR INSERT WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "org_update_work_pool_exceptions" ON job_work_pool_exceptions
  FOR UPDATE USING (public.is_org_member(org_id));

CREATE TABLE job_work_pool_exception_activity (
  activity_id                BIGSERIAL PRIMARY KEY,
  exception_id               BIGINT NOT NULL REFERENCES job_work_pool_exceptions(exception_id) ON DELETE CASCADE,
  org_id                     UUID NOT NULL REFERENCES organizations(id),
  event_type                 TEXT NOT NULL
                               CHECK (event_type IN (
                                 'created',
                                 'updated',
                                 'variance_changed',
                                 'acknowledged',
                                 'resolution_selected',
                                 'resolved',
                                 'auto_resolved',
                                 'auto_merged_update',
                                 'override_issued'
                               )),
  performed_by               UUID REFERENCES auth.users(id),
  notes                      TEXT,
  payload                    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_job_work_pool_exception_activity_exception
  ON job_work_pool_exception_activity(exception_id, created_at DESC);

ALTER TABLE job_work_pool_exception_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_read_work_pool_exception_activity" ON job_work_pool_exception_activity
  FOR SELECT USING (public.is_org_member(org_id));

CREATE POLICY "org_insert_work_pool_exception_activity" ON job_work_pool_exception_activity
  FOR INSERT WITH CHECK (public.is_org_member(org_id));

-- Helper functions (full body in companion spec):
--   1. log_job_work_pool_exception_activity(...)
--   2. upsert_job_work_pool_exception(...)
--   3. resolve_job_work_pool_exception_if_cleared(...)
--
-- Required behaviors:
--   - one open/acknowledged exception per pool row per exception type
--   - update existing open record when the same mismatch changes
--   - append audit activity on every create/update/acknowledge/resolve event
--   - auto-resolve with system activity when variance is no longer negative

-- =============================================================================
-- Atomic issuance RPC
-- Locks the pool row, validates remaining, creates job_card + job_card_item,
-- and optionally creates/updates an over-issuance exception in the same transaction.
-- Returns the new job_card_id.
-- =============================================================================

CREATE OR REPLACE FUNCTION issue_job_card_from_pool(
  p_pool_id            INTEGER,
  p_quantity           INTEGER,
  p_staff_id           INTEGER DEFAULT NULL,
  p_allow_overissue    BOOLEAN DEFAULT FALSE,
  p_override_reason    TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pool        RECORD;
  v_issued_qty  INTEGER;
  v_remaining   INTEGER;
  v_card_id     INTEGER;
  v_caller_org  UUID;
  v_new_variance INTEGER;
BEGIN
  SELECT m.org_id INTO v_caller_org
  FROM public.organization_members m
  WHERE m.user_id = auth.uid()
    AND COALESCE(m.is_active, TRUE) = TRUE
  ORDER BY m.created_at
  LIMIT 1;

  IF v_caller_org IS NULL THEN
    RAISE EXCEPTION 'No organization for current user';
  END IF;

  -- Lock the pool row for the duration of this transaction
  SELECT * INTO v_pool
  FROM job_work_pool
  WHERE pool_id = p_pool_id
  FOR UPDATE;

  IF v_pool IS NULL THEN
    RAISE EXCEPTION 'Work pool entry % not found', p_pool_id;
  END IF;

  IF v_pool.org_id != v_caller_org THEN
    RAISE EXCEPTION 'Access denied: pool belongs to different organization';
  END IF;

  IF v_pool.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cannot issue from a cancelled pool entry';
  END IF;

  -- Compute current issued quantity
  SELECT COALESCE(SUM(jci.quantity), 0) INTO v_issued_qty
  FROM job_card_items jci
  JOIN job_cards jc ON jc.job_card_id = jci.job_card_id
  WHERE jci.work_pool_id = p_pool_id
    AND jc.status  NOT IN ('cancelled')
    AND jci.status NOT IN ('cancelled');

  v_remaining := v_pool.required_qty - v_issued_qty;

  IF p_quantity < 1 THEN
    RAISE EXCEPTION 'Quantity must be at least 1';
  END IF;

  IF p_quantity > v_remaining THEN
    IF NOT p_allow_overissue THEN
      RAISE EXCEPTION 'Cannot issue % units - only % remaining in pool', p_quantity, v_remaining;
    END IF;

    IF COALESCE(BTRIM(p_override_reason), '') = '' THEN
      RAISE EXCEPTION 'Override reason is required when issuing beyond remaining quantity';
    END IF;
  END IF;

  -- Create job card
  INSERT INTO job_cards (order_id, staff_id, issue_date, status)
  VALUES (v_pool.order_id, p_staff_id, CURRENT_DATE, 'pending')
  RETURNING job_card_id INTO v_card_id;

  -- Create job card item linked to pool
  INSERT INTO job_card_items (job_card_id, product_id, job_id, quantity, completed_quantity, piece_rate, status, work_pool_id)
  VALUES (v_card_id, v_pool.product_id, v_pool.job_id, p_quantity, 0, v_pool.piece_rate, 'pending', p_pool_id);

  IF p_quantity > v_remaining THEN
    v_new_variance := (v_pool.required_qty - (v_issued_qty + p_quantity));

    PERFORM public.upsert_job_work_pool_exception(
      p_org_id => v_pool.org_id,
      p_order_id => v_pool.order_id,
      p_work_pool_id => p_pool_id,
      p_exception_type => 'over_issued_override',
      p_status => 'acknowledged',
      p_required_qty_snapshot => v_pool.required_qty,
      p_issued_qty_snapshot => v_issued_qty + p_quantity,
      p_variance_qty => v_new_variance,
      p_trigger_source => 'issuance_override',
      p_trigger_context => jsonb_build_object(
        'remaining_before_issue', v_remaining,
        'requested_quantity', p_quantity,
        'override_reason', p_override_reason,
        'job_card_id', v_card_id
      ),
      p_triggered_by => auth.uid(),
      p_acknowledged_by => auth.uid(),
      p_notes => p_override_reason
    );
  ELSE
    PERFORM public.resolve_job_work_pool_exception_if_cleared(
      p_work_pool_id => p_pool_id,
      p_exception_type => 'over_issued_override'
    );
  END IF;

  RETURN v_card_id;
END;
$$;
```

**Step 2: Apply the migration**

Run via Supabase MCP: `apply_migration` with filename `create_job_work_pool`.

**Step 3: Verify**

- `SELECT * FROM job_work_pool_status LIMIT 0;` — correct columns including `issued_qty`, `remaining_qty`, `completed_qty`
- `SELECT column_name FROM information_schema.columns WHERE table_name = 'job_card_items' AND column_name = 'work_pool_id';` — one row
- `SELECT proname FROM pg_proc WHERE proname = 'issue_job_card_from_pool';` — one row
- `SELECT * FROM job_work_pool_exceptions LIMIT 0;` — exception table exists
- `SELECT * FROM job_work_pool_exception_activity LIMIT 0;` — activity table exists

**Step 4: Commit**

```bash
git add supabase/migrations/*_create_job_work_pool.sql
git commit -m "feat(db): add work pool, exception audit tables, and atomic issuance RPC"
```

---

## Phase 2: "Generate from BOL" Populates Work Pool

### Task 2: Change GenerateBOLDialog to populate work pool

**Files:**
- Modify: `components/features/orders/JobCardsTab.tsx` (the `GenerateBOLDialog` component, ~lines 596-799)

**Overview:** The dialog's mutation inserts rows into `job_work_pool` instead of creating job cards. The preview stays the same — user sees the BOL jobs — but the button says "Add to Work Pool". Uses upsert on the partial unique index for idempotency.

**Step 1: Extend `BOLPreviewItem` type**

Add to the interface (~line 54):
```typescript
order_detail_id: number;
bol_id: number;
piece_rate_id: number | null;
hourly_rate_id: number | null;
time_per_unit: number | null;  // estimated minutes per unit
```

Update the query inside `GenerateBOLDialog` to pass these fields through from the existing `detail.order_detail_id`, `bol.bol_id`, rate IDs, and compute `time_per_unit` from `bol.time_required` / `job.estimated_minutes` (converting to minutes).

**Step 2: Replace the mutation**

```typescript
const generateMutation = useMutation({
  mutationFn: async (items: BOLPreviewItem[]) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { data: membership } = await supabase
      .from('organization_members')
      .select('org_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single();
    if (!membership?.org_id) throw new Error('No organization');

    const inserts = items.map((item) => ({
      org_id: membership.org_id,
      order_id: orderId,
      order_detail_id: item.order_detail_id,
      product_id: item.product_id,
      job_id: item.job_id,
      bol_id: item.bol_id,
      source: 'bol' as const,
      required_qty: item.quantity,
      pay_type: item.pay_type,
      piece_rate: item.piece_rate,
      piece_rate_id: item.piece_rate_id,
      hourly_rate_id: item.hourly_rate_id,
      time_per_unit: item.time_per_unit,
      status: 'active',
    }));

    const { error } = await supabase
      .from('job_work_pool')
      .upsert(inserts, { onConflict: 'order_detail_id,bol_id', ignoreDuplicates: false });
    if (error) throw error;
    return inserts.length;
  },
  onSuccess: (count) => {
    queryClient.invalidateQueries({ queryKey: ['orderWorkPool', orderId] });
    toast.success(`Added ${count} job${count !== 1 ? 's' : ''} to work pool`);
    onOpenChange(false);
  },
  onError: (error: any) => {
    toast.error(error.message || 'Failed to populate work pool');
  },
});
```

**Step 3:** Update button text from "Generate N Jobs" to "Add N to Work Pool".

**Step 4: Verify** — open dialog, click button, check `job_work_pool` table has rows with correct data.

**Step 5: Commit**

```bash
git add components/features/orders/JobCardsTab.tsx
git commit -m "feat(job-cards): Generate from BOL populates work pool instead of creating cards"
```

---

## Phase 3: Work Pool UI + Issue Dialog on Order Page

### Task 3: Add Work Pool section and Issue Job Card dialog

**Files:**
- Modify: `components/features/orders/JobCardsTab.tsx`

**Overview:** Two new UI pieces:
1. A **Work Pool** card above the job cards list showing each pool row with required/issued/remaining
2. An **Issue Job Card** dialog triggered by clicking "Issue Card" on a pool row — calls the `issue_job_card_from_pool` RPC atomically

**Step 1: Add work pool query**

```typescript
const { data: workPool = [] } = useQuery({
  queryKey: ['orderWorkPool', orderId],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('job_work_pool_status')
      .select(`
        pool_id, order_id, product_id, job_id, bol_id, order_detail_id,
        required_qty, issued_qty, completed_qty, remaining_qty,
        pay_type, piece_rate, piece_rate_id, hourly_rate_id,
        time_per_unit, source, status,
        jobs:job_id(name),
        products:product_id(name)
      `)
      .eq('order_id', orderId)
      .neq('status', 'cancelled')
      .order('pool_id');
    if (error) throw error;
    return data ?? [];
  },
});
```

**Step 2: Render Work Pool table**

Above the existing job cards Card, render a table with columns: Job, Product, Required, Issued, Remaining, Pay Type, Piece Rate, and an "Issue Card" button per row (disabled when remaining = 0, showing "Fully issued" badge instead).

**Step 3: Build `IssueJobCardDialog`**

The dialog shows:
- Read-only: Job name, Product, Remaining quantity
- Input: Quantity (number, default = remaining)
- Computed display: **Estimated time** = `quantity × time_per_unit` minutes — shown as "~X hours Y min"
- Optional: Staff dropdown (all active staff, or later filtered by job category)
- Button: "Issue Job Card"

If the entered quantity exceeds `remaining_qty`, the dialog must:
- show a destructive warning explaining that this is an over-issuance
- require a free-text reason before the submit button enables
- make clear that the resulting exception will enter the shared production queue immediately

The mutation calls the atomic RPC:
```typescript
const issueMutation = useMutation({
  mutationFn: async () => {
    const qty = parseInt(quantity) || 0;
    const isOverride = qty > pool.remaining_qty;
    const { data, error } = await supabase.rpc('issue_job_card_from_pool', {
      p_pool_id: pool.pool_id,
      p_quantity: qty,
      p_staff_id: staffId ? parseInt(staffId) : null,
      p_allow_overissue: isOverride,
      p_override_reason: isOverride ? overrideReason.trim() : null,
    });
    if (error) throw error;
    return { cardId: data, qty };
  },
  onSuccess: ({ cardId, qty }) => {
    queryClient.invalidateQueries({ queryKey: ['orderWorkPool', orderId] });
    queryClient.invalidateQueries({ queryKey: ['orderJobCardItems', orderId] });
    toast.success(`Issued job card #${cardId} for ${qty} units`);
    onOpenChange(false);
  },
  onError: (error: any) => {
    toast.error(error.message || 'Failed to issue job card');
  },
});
```

**Step 4: Verify** — issue a card from pool, confirm remaining decreases, card appears in list.

**Step 5: Commit**

```bash
git add components/features/orders/JobCardsTab.tsx
git commit -m "feat(job-cards): add Work Pool section and atomic Issue Job Card dialog"
```

---

## Phase 4: "Add Job" as First-Class Manual Pool Entry

### Task 4: Update AddJobDialog to create a manual pool entry

**Files:**
- Modify: `components/features/orders/JobCardsTab.tsx` (the `AddJobDialog` component)

**Overview:** Manual "Add Job" creates a pool entry with `source = 'manual'`, `bol_id = NULL`, `order_detail_id = NULL`. All demand flows through the pool. User then issues cards from it.

**Step 1:** Change `addMutation` to insert into `job_work_pool`:

```typescript
const addMutation = useMutation({
  mutationFn: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { data: membership } = await supabase
      .from('organization_members')
      .select('org_id')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single();
    if (!membership?.org_id) throw new Error('No organization');

    const qty = parseInt(quantity) || 1;
    const { error } = await supabase.from('job_work_pool').insert({
      org_id: membership.org_id,
      order_id: orderId,
      order_detail_id: null,
      product_id: null,
      job_id: parseInt(selectedJobId),
      bol_id: null,
      source: 'manual',
      required_qty: qty,
      pay_type: pieceRate ? 'piece' : 'hourly',
      piece_rate: pieceRate ? parseFloat(pieceRate) : null,
      status: 'active',
    });
    if (error) throw error;
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['orderWorkPool', orderId] });
    toast.success('Job added to work pool');
    resetForm();
    onOpenChange(false);
  },
});
```

**Step 2:** Update the button label from "Add Job" to "Add to Work Pool" for consistency.

**Step 3: Verify** — add a manual job, see it appear in work pool, issue a card from it.

**Step 4: Commit**

```bash
git add components/features/orders/JobCardsTab.tsx
git commit -m "feat(job-cards): Add Job creates first-class manual pool entry"
```

---

## Phase 5: Scheduler Integration — Pool as Demand Source

### Task 5: Update scheduler to read from work pool

**Files:**
- Modify: `lib/queries/laborPlanning.ts`

**Overview:** Replace the BOL-direct reading with pool-based reading. For orders with pool rows, the sidebar shows:
- Pool items with `remaining_qty > 0` as draggable "demand" jobs
- Issued (active) job card items as "issued" jobs

For orders WITHOUT pool rows (legacy), fall back to current BOL logic.

**Step 1: Add `loadWorkPoolByOrder()` function**

```typescript
interface WorkPoolRow {
  pool_id: number;
  order_id: number;
  product_id: number | null;
  job_id: number | null;
  bol_id: number | null;
  order_detail_id: number | null;
  required_qty: number;
  issued_qty: number;
  remaining_qty: number;
  pay_type: string;
  piece_rate: number | null;
  piece_rate_id: number | null;
  hourly_rate_id: number | null;
  time_per_unit: number | null;
  source: string;
  job_name: string | null;
  product_name: string | null;
  category_id: number | null;
  category_name: string | null;
}

async function loadWorkPoolByOrder(): Promise<Map<number, WorkPoolRow[]>> {
  const { data, error } = await supabase
    .from('job_work_pool_status')
    .select(`
      pool_id, order_id, product_id, job_id, bol_id, order_detail_id,
      required_qty, issued_qty, remaining_qty, pay_type, piece_rate,
      piece_rate_id, hourly_rate_id, time_per_unit, source,
      jobs:job_id(job_id, name, estimated_minutes, time_unit, job_categories:category_id(category_id, name)),
      products:product_id(product_id, name)
    `)
    .eq('status', 'active');

  if (error) {
    console.warn('[laborPlanning] Failed to load work pool', error);
    return new Map();
  }

  const result = new Map<number, WorkPoolRow[]>();
  for (const row of data ?? []) {
    const job = extractSingle((row as any).jobs);
    const product = extractSingle((row as any).products);
    const category = extractSingle(job?.job_categories);
    const mapped: WorkPoolRow = {
      pool_id: row.pool_id,
      order_id: row.order_id,
      product_id: row.product_id,
      job_id: row.job_id,
      bol_id: row.bol_id,
      order_detail_id: row.order_detail_id,
      required_qty: row.required_qty,
      issued_qty: row.issued_qty,
      remaining_qty: row.remaining_qty,
      pay_type: row.pay_type,
      piece_rate: row.piece_rate ? Number(row.piece_rate) : null,
      piece_rate_id: row.piece_rate_id,
      hourly_rate_id: row.hourly_rate_id,
      time_per_unit: row.time_per_unit ? Number(row.time_per_unit) : null,
      source: row.source,
      job_name: job?.name ?? null,
      product_name: product?.name ?? null,
      category_id: category?.category_id ?? null,
      category_name: category?.name ?? null,
    };
    if (!result.has(row.order_id)) result.set(row.order_id, []);
    result.get(row.order_id)!.push(mapped);
  }
  return result;
}
```

**Step 2: Update `normalizeOrderRow()` to prefer pool data**

```typescript
const poolRows = workPoolByOrder?.get(orderId) ?? [];
if (poolRows.length > 0) {
  // Pool items with remaining demand
  const poolJobs = poolRows
    .filter((p) => p.remaining_qty > 0)
    .map((p) => normalizePoolRow(orderId, p));
  jobs = [...poolJobs];
} else {
  // Legacy fallback: no pool, use raw BOL
  jobs = [...allBolJobs, ...manualJobs];
}
```

**Step 3: Add `normalizePoolRow()` helper** that converts a `WorkPoolRow` into a `PlanningJobWithMeta`, including `time_per_unit` for the drag-and-drop time estimate.

**Step 4: Thread `workPoolByOrder` through `fetchOpenOrdersWithLabor()` and `fetchLaborPlanningPayload()` similar to how `jobCardData` is already threaded.

**Step 5: Update orphaned assignment filtering** to also check pool status (same pattern as existing `ordersWithCards` check).

**Step 6: Verify** — pool populated, scheduler sidebar shows pool demand jobs. No pool = falls back to BOL.

**Step 7: Commit**

```bash
git add lib/queries/laborPlanning.ts
git commit -m "feat(scheduler): read from work pool as demand source, fallback to BOL for legacy"
```

---

## Phase 6: Scheduler Drag-to-Issue

### Task 6: Drag pool job onto staff lane triggers issuance + scheduling

**Files:**
- Modify: `components/labor-planning/staff-lane-list.tsx` (drop handler)
- Modify: `components/production/labor-planning-board.tsx` (sidebar job rendering)

**Overview:** When a pool-sourced job is dropped onto a staff lane:
1. Open a dialog: quantity input, estimated completion time display, staff pre-filled from the lane
2. If quantity exceeds remaining: require override reason and warn that an acknowledged exception will be created immediately
3. On confirm: call `issue_job_card_from_pool` RPC, then create the `labor_plan_assignment`
3. Sidebar updates: remaining qty decreases, issued card appears as scheduled

The estimated time display: `quantity × time_per_unit` minutes. Show alongside the staff member's remaining available hours for the day.

**Step 1:** Add a `poolId` field to the draggable job data when the job originates from a pool (vs a legacy BOL job or an already-issued card).

**Step 2:** In the drop handler, detect `poolId` presence. If present, open the issue dialog instead of directly creating an assignment.

**Step 3:** Build an `IssueAndScheduleDialog` component:
- Shows: Job name, Product, Remaining in pool, Staff member name (from lane)
- Input: Quantity (default = remaining)
- Computed: "Est. ~X hours Y min" based on `quantity × time_per_unit`
- Also shows: "Staff available: Z hours remaining today"
- If quantity exceeds remaining: destructive warning + required override reason field
- Button: "Issue & Schedule"

**Step 4:** On confirm:
```typescript
// 1. Atomic issuance
const { data: cardId } = await supabase.rpc('issue_job_card_from_pool', {
  p_pool_id: job.poolId,
  p_quantity: qty,
  p_staff_id: staffId,
  p_allow_overissue: qty > job.remainingQty,
  p_override_reason: qty > job.remainingQty ? overrideReason.trim() : null,
});

// 2. Create schedule assignment
await supabase.from('labor_plan_assignments').insert({
  job_instance_id: `pool-${job.poolId}:card-${cardId}`,
  order_id: job.orderId,
  order_detail_id: job.orderDetailId,
  bol_id: job.bolId,
  job_id: job.jobId,
  staff_id: staffId,
  assignment_date: selectedDate,
  start_minutes: dropStartMinutes,
  end_minutes: dropStartMinutes + (qty * timePerUnit),
  status: 'scheduled',
  pay_type: job.payType,
  piece_rate_id: job.pieceRateId,
  hourly_rate_id: job.hourlyRateId,
});
```

**Step 5: Verify** — drag pool job to staff lane, dialog opens with time estimate, issue & schedule, both pool and schedule update.

**Step 6: Commit**

```bash
git add components/labor-planning/staff-lane-list.tsx components/production/labor-planning-board.tsx
git commit -m "feat(scheduler): drag pool job to staff lane triggers issuance with time estimate"
```

---

## Phase 7: Cancel Cascade — Quantity Returns to Pool

### Task 7: Cancelling a job card returns quantity to pool automatically

**Files:**
- Modify: `app/staff/job-cards/[id]/page.tsx` (the `statusMutation`)

**Overview:** Since remaining is computed (`required - SUM(active)`), cancelling a card item automatically restores pool availability — no explicit "return" needed. However, we must add `work_pool_id` to the `JobCardItem` interface and fetch it in the items query so the UI knows which items are pool-linked.

**Step 1:** Add `work_pool_id: number | null` to the `JobCardItem` interface.

**Step 2:** Add `work_pool_id` to the items select query.

**Step 3: Verify** — issue card from pool (remaining decreases), cancel card (remaining increases back). No explicit pool update needed.

**Step 4: Commit**

```bash
git add app/staff/job-cards/[id]/page.tsx
git commit -m "feat(job-cards): add work_pool_id to card item interface for pool tracking"
```

---

## Phase 8: Stale Pool Detection, Reconciliation, and Exception Creation

### Task 8: Detect when pool snapshots have drifted from current order/BOL

**Files:**
- Modify: `components/features/orders/JobCardsTab.tsx` (add reconciliation banner)
- Modify: `components/production/labor-planning-board.tsx` (add stale icon on sidebar)

**Overview:** Compare current `order_detail.quantity × bol.quantity` against `pool.required_qty`. If different, show warnings. If reconciliation would reduce required demand below already-issued quantity, update the pool immediately and create or update a `over_issued_after_reconcile` production exception for that pool row.

**Step 1: Add stale detection query on order page**

When the Job Cards tab loads and work pool exists, also fetch current BOL-derived quantities:

```typescript
const { data: staleCheck } = useQuery({
  queryKey: ['orderPoolStaleCheck', orderId],
  queryFn: async () => {
    // Fetch current order_details + BOL quantities
    const { data } = await supabase
      .from('order_details')
      .select('order_detail_id, quantity, products:product_id(billoflabour(bol_id, quantity))')
      .eq('order_id', orderId);
    // Compare against pool required_qty...
    // Return list of { pool_id, pool_required, current_required, diff }
  },
  enabled: workPool.length > 0,
});
```

**Step 2: Render reconciliation banner**

If any pool rows are stale:
```tsx
<Alert variant="warning">
  <AlertTriangle className="h-4 w-4" />
  <AlertTitle>Work pool out of date</AlertTitle>
  <AlertDescription>
    Order quantities have changed since the work pool was generated.
    {staleItems.map(s => (
      <div key={s.pool_id}>
        {s.jobName}: Pool shows {s.poolRequired}, current demand is {s.currentRequired}
        {s.currentRequired < s.issuedQty && (
          <Badge variant="destructive" className="ml-2">Over-issued by {s.issuedQty - s.currentRequired}</Badge>
        )}
      </div>
    ))}
  </AlertDescription>
  <Button size="sm" onClick={handleUpdatePool}>Update Pool</Button>
</Alert>
```

The "Update Pool" button updates `required_qty` on the affected pool rows to match current demand immediately. For each affected row:
- if `issued_qty <= new_required_qty`, clear any existing reconcile exception via the auto-resolve helper
- if `issued_qty > new_required_qty`, create or update an `over_issued_after_reconcile` exception in `open` state
- append `job_work_pool_exception_activity` rows for every create/update/auto-resolve event
- write a summary row to `order_activity`

**Step 3: Add stale icon on scheduler sidebar**

In the order row in the sidebar, show a warning icon if any pool rows are stale. Tooltip: "Work pool quantities out of date — update on order page."

**Step 4: Reconcile exception handling** — If updating the pool results in `remaining_qty < 0`:
- show a warning banner in the order page and scheduler sidebar
- create/update the per-pool-row `over_issued_after_reconcile` exception in `open` state
- surface it in the shared production exceptions queue until a user acknowledges and resolves it
- keep the pool row visible with a red variance badge (for example `Issued 80 | Required 60 | Variance -20`)

**Step 5: Commit**

```bash
git add components/features/orders/JobCardsTab.tsx components/production/labor-planning-board.tsx
git commit -m "feat(job-cards): stale pool detection with reconciliation banner and scheduler warning"
```

---

## Phase 9: Production Exceptions Queue, Acknowledgement, and Audit

### Task 9: Surface pool exceptions in production UI and capture full workflow audit

**Files:**
- Modify: `lib/queries/production-exceptions.ts`
- Modify: `components/production/exceptions-tab.tsx`
- Modify: `components/features/orders/JobCardsTab.tsx`
- Modify: `app/staff/job-cards/[id]/page.tsx`

**Overview:** The production exceptions tab currently shows only derived schedule risk states. Extend it to show pool exceptions from `job_work_pool_exceptions` in dedicated tabs/sections, with full acknowledgement and resolution flows backed by `job_work_pool_exception_activity`.

**Step 1:** Extend the production exceptions query layer:
- keep current derived sections (`overdue`, `paused`, `behind`)
- add DB-backed sections for `over_issued_override` and `over_issued_after_reconcile`
- include current status (`open`, `acknowledged`) and variance snapshot in the payload

**Step 2:** Add exception actions:
- `acknowledge`
- `resolve` with required structured resolution choice:
  - `cancel_unstarted_cards`
  - `move_excess_to_stock`
  - `accept_overproduction_rework`
- optional note field

These actions should go through RPCs or server routes that:
- update `job_work_pool_exceptions`
- append `job_work_pool_exception_activity`
- write summary rows into `order_activity`

**Step 3:** Highlight active exceptions in the order job cards tab and job-card list:
- order page: banner + row-level badges on affected pool rows
- job-card list: visual indicator when a card belongs to a pool row with an active exception
- scheduler/sidebar: warning icon on orders with active pool exceptions

**Step 4:** Auto-resolution hooks:
- after card cancellation
- after successful pool reconciliation
- after any future action that changes the variance

Each hook should call the helper that auto-resolves open exceptions when the mismatch disappears, and append a `auto_resolved` activity row when it does.

**Step 5: Verify**
- over-issuance override creates/updates an `acknowledged` override exception immediately
- reconciliation mismatch creates/updates an `open` reconcile exception immediately
- acknowledging leaves the exception visible in the queue
- resolving closes it and removes it from the active queue
- mismatch disappearing auto-resolves the exception with history intact

**Step 6: Commit**

```bash
git add components/production/exceptions-tab.tsx lib/queries/production-exceptions.ts components/features/orders/JobCardsTab.tsx app/staff/job-cards/[id]/page.tsx
git commit -m "feat(production): add work pool exception queue with acknowledgement and audit trail"
```

---

## Summary of Changes

| Phase | What | Files | Key Pattern |
|-------|------|-------|-------------|
| 1 | DB: table + view + RPC | Migration SQL | Atomic RPC, computed state |
| 2 | Generate from BOL → pool | `JobCardsTab.tsx` | Upsert with snapshot |
| 3 | Work Pool UI + Issue dialog | `JobCardsTab.tsx` | RPC call, not multi-step |
| 4 | Manual Add Job → pool | `JobCardsTab.tsx` | `source='manual'` first-class |
| 5 | Scheduler reads pool | `laborPlanning.ts` | Pool-first, BOL fallback |
| 6 | Drag-to-issue on scheduler | `staff-lane-list.tsx`, `labor-planning-board.tsx` | Issue + schedule in one flow |
| 7 | Cancel returns to pool | `job-cards/[id]/page.tsx` | Computed remaining, no explicit return |
| 8 | Stale detection + reconciliation | `JobCardsTab.tsx`, `labor-planning-board.tsx` | Snapshot drift + exception creation |
| 9 | Production exception queue + audit | `exceptions-tab.tsx`, `production-exceptions.ts`, `JobCardsTab.tsx` | Dedicated exception workflow |

## Migration Path for Existing Data

Existing job cards (completed ones for Test5566, Test1133) were created before the pool and have no `work_pool_id`. They continue to work — the column is nullable. The scheduler fallback ("if no pool rows, use raw BOL") handles legacy orders.

No backfill migration is needed. New orders go through the pool flow; old orders work as before until their BOL is regenerated into the pool.
