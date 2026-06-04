-- ============================================================================
-- Picking List Stock Reservation — wiring migration
-- Spec: docs/plans/2026-06-04-picking-list-reservation.md
-- ----------------------------------------------------------------------------
-- TWO-LAYER MODEL (these are ORTHOGONAL — never conflate the two numbers):
--
--   1. PICKING HARD HOLD  (introduced here)
--        inventory.quantity_reserved  NUMERIC NOT NULL DEFAULT 0
--        available = quantity_on_hand - quantity_reserved   (NEVER stored)
--        Incremented when a picking list is created (create_pending_stock_issuance),
--        drawn DOWN as the list is issued (complete_/issue_pending_items_batch),
--        released when the list is cancelled/expired. Per-item progress lives in
--        pending_stock_issuance_items.quantity_issued. This is the physical
--        "Reserved (held)" quantity surfaced to operators.
--
--   2. PLANNING EARMARK  (pre-existing — LEFT UNTOUCHED by this migration)
--        component_reservations  (UNIQUE(order_id, component_id))
--        Written by reserve_order_component(s) ("Reserve Components" button),
--        surfaced as reserved_this_order / reserved_by_others. A soft, order-level
--        paper earmark decoupled from physical movement. This is "Earmarked".
--
--   UI COPY RULE: "Reserved (held)" = inventory.quantity_reserved (this hold).
--                 "Earmarked"       = component_reservations. Never show two
--                 columns both labelled just "Reserved".
--
-- GREG'S DECISIONS BAKED IN HERE:
--   * NO BACKFILL. Columns default 0; existing open picking lists do NOT
--     retroactively start holding stock. (Spec edge case 8 — intentionally
--     omitted.) reconcile_inventory_reserved() exists as a manual drift guard
--     but is NOT run here.
--   * EARMARK RPCs STAY INDEPENDENT. reserve_order_component_single /
--     reserve_order_components are NOT modified (spec decision point 9).
--   * The component_reservations INSERT-policy RLS "fix" is DROPPED — the live
--     policy already carries a valid with_check; there is no gap (spec edge 12).
--
-- The reservation invariant (reconciliation anchor), true after every lifecycle
-- transition, for every component in an org:
--   inventory.quantity_reserved
--     == COALESCE(SUM(i.quantity - i.quantity_issued), 0)
--        over pending_stock_issuance_items i
--        JOIN pending_stock_issuances p ON p.pending_id = i.pending_id
--        WHERE p.status IN ('pending','partially_issued')
--
-- Concurrency: create/complete/batch lock the inventory row (UNIQUE(component_id))
-- FOR UPDATE before reading-then-writing quantity_reserved — inheriting the exact
-- row lock that already serializes on-hand deduction. cancel/expire instead apply
-- an atomic self-referential UPDATE (SET quantity_reserved = quantity_reserved - n),
-- which takes the same row lock implicitly and re-reads the latest committed value,
-- so no prior SELECT ... FOR UPDATE is needed. Batch/complete additionally lock the
-- header + each item FOR UPDATE, and every per-item loop locks in component_id order
-- to avoid ABBA deadlocks. A RAISE EXCEPTION rolls back the whole function
-- transaction. reconcile_inventory_reserved() is a MANUAL drift guard that writes
-- absolute values from a snapshot aggregate — run it only when picking traffic is
-- quiescent.
--
-- GUARDRAIL: this is migration + schema + RLS-adjacent + behavior change to
-- existing RPCs. Apply to live ONLY with Greg's sign-off (per CLAUDE.md).
-- ============================================================================

-- ============================================================================
-- 1. DDL — additive columns, status CHECK, audit link
-- ============================================================================

-- A. The hard-hold counter (the picking "Reserved (held)" quantity).
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS quantity_reserved NUMERIC NOT NULL DEFAULT 0
  CHECK (quantity_reserved >= 0);

-- B. Per-item issued progress, so one picking list can be drawn down in batches.
ALTER TABLE public.pending_stock_issuance_items
  ADD COLUMN IF NOT EXISTS quantity_issued NUMERIC NOT NULL DEFAULT 0
  CHECK (quantity_issued >= 0 AND quantity_issued <= quantity);

-- C. New lifecycle statuses (partial issuance + expiry).
ALTER TABLE public.pending_stock_issuances
  DROP CONSTRAINT IF EXISTS pending_stock_issuances_status_check;
ALTER TABLE public.pending_stock_issuances
  ADD CONSTRAINT pending_stock_issuances_status_check
  CHECK (status IN ('pending','partially_issued','issued','cancelled','expired'));

-- D. Optional expiry support (stale picks squatting on stock).
ALTER TABLE public.pending_stock_issuances
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NULL;

-- E. Link a physical issuance back to its picking item (reversal/audit).
ALTER TABLE public.stock_issuances
  ADD COLUMN IF NOT EXISTS pending_item_id INTEGER NULL
  REFERENCES public.pending_stock_issuance_items(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_issuances_pending_item
  ON public.stock_issuances(pending_item_id);

-- ============================================================================
-- 2. Lifecycle + supporting RPCs
--    All: LANGUAGE plpgsql, SECURITY DEFINER, SET search_path = public,
--    re-check org membership, lock inventory(component_id) FOR UPDATE before
--    touching quantity_reserved.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 2a. create_pending_stock_issuance — create -> RESERVE
--     MANDATORY DROP of the prior 6-arg signature: appending 2 params would
--     otherwise create a coexisting overload -> PostgREST PGRST203.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_pending_stock_issuance(text, text, text, integer, text, integer);

CREATE OR REPLACE FUNCTION public.create_pending_stock_issuance(
  p_components        text,
  p_external_reference text DEFAULT NULL::text,
  p_issue_category    text DEFAULT 'production'::text,
  p_staff_id          integer DEFAULT NULL::integer,
  p_notes             text DEFAULT NULL::text,
  p_order_id          integer DEFAULT NULL::integer,
  p_allow_overpick    boolean DEFAULT false,
  p_expires_at        timestamptz DEFAULT NULL::timestamptz
)
RETURNS TABLE(success boolean, message text, pending_id integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
  v_pending_id integer;
  v_comp record;
  v_count integer := 0;
  v_order_number text;
  v_ext text;
  v_notes text;
  v_inv_id integer;
  v_on_hand numeric;
  v_reserved numeric;
  v_avail numeric;
  v_to_reserve numeric;
  v_shortfall numeric;
begin
  v_org := current_org_id();
  if v_org is null then
    return query select false, 'No organization context'::text, null::integer;
    return;
  end if;

  if p_order_id is not null then
    select o.order_number into v_order_number
    from public.orders o
    where o.order_id = p_order_id and o.org_id = v_org;
    if not found then
      return query select false, 'Order not found in your organization'::text, null::integer;
      return;
    end if;
  end if;

  v_ext := coalesce(
    nullif(btrim(p_external_reference), ''),
    v_order_number,
    case when p_order_id is not null then 'Order #' || p_order_id else null end
  );
  if v_ext is null or btrim(v_ext) = '' then
    return query select false, 'An external reference or order is required'::text, null::integer;
    return;
  end if;

  if p_components is null or btrim(p_components) = '' then
    return query select false, 'No components provided'::text, null::integer;
    return;
  end if;

  -- Accumulate any overpick shortfall into the header notes so the operator can
  -- see what could not be reserved when p_allow_overpick = true.
  v_notes := p_notes;

  insert into public.pending_stock_issuances (
    org_id, order_id, external_reference, issue_category, staff_id, notes, status, expires_at, created_by
  ) values (
    v_org, p_order_id, v_ext,
    coalesce(nullif(btrim(p_issue_category), ''), 'production'),
    p_staff_id, p_notes, 'pending', p_expires_at, auth.uid()
  )
  returning pending_stock_issuances.pending_id into v_pending_id;

  for v_comp in
    select x.component_id, x.quantity
    from jsonb_to_recordset(p_components::jsonb) as x(component_id integer, quantity numeric)
  loop
    if v_comp.component_id is null or v_comp.quantity is null or v_comp.quantity <= 0 then
      raise exception 'Invalid component line (component_id=%, quantity=%)', v_comp.component_id, v_comp.quantity;
    end if;
    if not exists (
      select 1 from public.components c
      where c.component_id = v_comp.component_id and c.org_id = v_org
    ) then
      raise exception 'Component % not found in your organization', v_comp.component_id;
    end if;

    -- Lock the inventory row (UNIQUE(component_id)) FOR UPDATE before reading or
    -- writing quantity_reserved. Lock by component_id ONLY — mirrors
    -- process_stock_issuance / process_manual_stock_issuance.
    select i.inventory_id, coalesce(i.quantity_on_hand, 0), coalesce(i.quantity_reserved, 0)
      into v_inv_id, v_on_hand, v_reserved
    from public.inventory i
    where i.component_id = v_comp.component_id
    for update;

    if not found then
      -- Auto-create a 0/0 inventory row (mirrors process_stock_issuance).
      insert into public.inventory (component_id, quantity_on_hand, quantity_reserved, reorder_level, org_id)
      values (v_comp.component_id, 0, 0, 0, v_org)
      returning inventory_id, quantity_on_hand, quantity_reserved
      into v_inv_id, v_on_hand, v_reserved;
    end if;

    v_avail := v_on_hand - v_reserved;

    if v_comp.quantity > v_avail then
      if p_allow_overpick then
        v_to_reserve := greatest(v_avail, 0);
        v_shortfall := v_comp.quantity - v_to_reserve;
        v_notes := coalesce(v_notes, '')
          || case when coalesce(v_notes, '') = '' then '' else E'\n' end
          || format('Overpick: component %s short by %s (requested %s, reserved %s)',
                    v_comp.component_id, v_shortfall, v_comp.quantity, v_to_reserve);
        -- Nothing physically available: record the shortfall (above) but create
        -- NO line. A 0-qty item would violate CHECK (quantity > 0), and — more
        -- importantly — it would keep the hold and the ledger in lock-step.
        if v_to_reserve <= 0 then
          continue;
        end if;
      else
        raise exception 'PICK_OVER_AVAILABLE: component % (available %, requested %)',
          v_comp.component_id, v_avail, v_comp.quantity;
      end if;
    else
      v_to_reserve := v_comp.quantity;
    end if;

    -- Store the line at exactly what was reserved (v_to_reserve): the full
    -- requested qty on a normal pick, or the clamped amount on an overpick (the
    -- shortfall is in the notes). This keeps the reservation invariant
    -- quantity_reserved == SUM(quantity - quantity_issued) true even under overpick,
    -- so cancel/complete/expire (which release quantity - quantity_issued) can never
    -- over-release into another list's hold.
    insert into public.pending_stock_issuance_items (pending_id, component_id, quantity, quantity_issued, org_id)
    values (v_pending_id, v_comp.component_id, v_to_reserve, 0, v_org);

    update public.inventory
    set quantity_reserved = quantity_reserved + v_to_reserve
    where inventory_id = v_inv_id;

    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'No valid components provided';
  end if;

  -- Persist any accumulated overpick shortfall notes.
  if v_notes is distinct from p_notes then
    update public.pending_stock_issuances
    set notes = v_notes
    where pending_stock_issuances.pending_id = v_pending_id;
  end if;

  return query select true, format('Picking list created with %s item(s)', v_count)::text, v_pending_id;
exception when others then
  return query select false, sqlerrm::text, null::integer;
end;
$function$;

-- ----------------------------------------------------------------------------
-- 2b. complete_pending_stock_issuance — complete -> RELEASE + DEDUCT
--     Signature UNCHANGED (CREATE OR REPLACE). Issues the REMAINING quantity of
--     every item to the header staff_id and draws the hold DOWN per item (never
--     a second deduction). Locks inventory FOR UPDATE on BOTH order and manual
--     paths. Status guard widened to pending OR partially_issued.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_pending_stock_issuance(p_pending_id integer)
RETURNS TABLE(success boolean, message text, items_issued integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_pending record;
  v_item record;
  v_result record;
  v_count integer := 0;
  v_missing text[];
  v_inv_id integer;
  v_on_hand numeric;
  v_reserved numeric;
  v_remaining numeric;
  v_avail_other numeric;
  v_ext text;
begin
  select * into v_pending
  from public.pending_stock_issuances
  where pending_id = p_pending_id
  for update;

  if not found then
    return query select false, 'Picking list not found'::text, 0;
    return;
  end if;
  if not is_org_member(v_pending.org_id) then
    return query select false, 'Picking list belongs to another organization'::text, 0;
    return;
  end if;
  if v_pending.status not in ('pending', 'partially_issued') then
    return query select false, format('Picking list already %s', v_pending.status)::text, 0;
    return;
  end if;

  -- Every item with remaining quantity must have an inventory record.
  select array_agg(c.internal_code)
  into v_missing
  from public.pending_stock_issuance_items psi
  join public.components c on c.component_id = psi.component_id
  left join public.inventory i on i.component_id = psi.component_id
  where psi.pending_id = p_pending_id
    and (psi.quantity - psi.quantity_issued) > 0
    and i.inventory_id is null;

  if v_missing is not null and array_length(v_missing, 1) > 0 then
    return query select false,
      format('Missing inventory records for: %s. Create inventory records first.', array_to_string(v_missing, ', '))::text,
      0;
    return;
  end if;

  -- Manual lists require a non-blank external_reference downstream.
  v_ext := coalesce(nullif(btrim(v_pending.external_reference), ''), 'PICK-' || p_pending_id);

  for v_item in
    select psi.item_id, psi.component_id, psi.quantity, psi.quantity_issued,
           (psi.quantity - psi.quantity_issued) as remaining
    from public.pending_stock_issuance_items psi
    where psi.pending_id = p_pending_id
      and (psi.quantity - psi.quantity_issued) > 0
    order by psi.component_id
  loop
    v_remaining := v_item.remaining;

    -- Lock the inventory row FOR UPDATE on BOTH paths (order + manual).
    select i.inventory_id, coalesce(i.quantity_on_hand, 0), coalesce(i.quantity_reserved, 0)
      into v_inv_id, v_on_hand, v_reserved
    from public.inventory i
    where i.component_id = v_item.component_id
    for update;

    -- Pre-check against availability for OTHER holds only — do NOT fail because
    -- THIS list reserved the stock. The hold attributable to this list's
    -- remaining qty is part of v_reserved, so subtract it back out.
    v_avail_other := v_on_hand - greatest(v_reserved - v_remaining, 0);
    if v_avail_other < v_remaining then
      raise exception 'PICK_ISSUE_FAILED: Insufficient stock for component % (available for other holds %, need %)',
        v_item.component_id, v_avail_other, v_remaining;
    end if;

    if v_pending.order_id is not null then
      select * into v_result from public.process_stock_issuance(
        p_order_id          => v_pending.order_id,
        p_component_id      => v_item.component_id,
        p_quantity          => v_remaining,
        p_purchase_order_id => null,
        p_notes             => v_pending.notes,
        p_issuance_date     => now(),
        p_staff_id          => v_pending.staff_id
      );
    else
      select * into v_result from public.process_manual_stock_issuance(
        p_component_id       => v_item.component_id,
        p_quantity           => v_remaining,
        p_notes              => v_pending.notes,
        p_external_reference => v_ext,
        p_issue_category     => v_pending.issue_category,
        p_staff_id           => v_pending.staff_id,
        p_issuance_date      => now()
      );
    end if;

    if not coalesce(v_result.success, false) then
      raise exception 'PICK_ISSUE_FAILED: %', coalesce(v_result.message, 'Unknown error issuing component');
    end if;

    -- Convert hold -> real deduction: release exactly the quantity issued.
    update public.inventory
    set quantity_reserved = greatest(quantity_reserved - v_remaining, 0)
    where inventory_id = v_inv_id;

    update public.pending_stock_issuance_items
    set quantity_issued = quantity
    where item_id = v_item.item_id;

    update public.stock_issuances
    set pending_item_id = v_item.item_id
    where issuance_id = v_result.issuance_id;

    v_count := v_count + 1;
  end loop;

  update public.pending_stock_issuances
  set status = 'issued', issued_at = now(), issued_by = auth.uid()
  where pending_id = p_pending_id;

  return query select true, 'Stock issued successfully'::text, v_count;
exception when others then
  return query select false, replace(sqlerrm, 'PICK_ISSUE_FAILED: ', '')::text, 0;
end;
$function$;

-- ----------------------------------------------------------------------------
-- 2c. cancel_pending_stock_issuance — cancel -> RELEASE
--     Signature UNCHANGED. Releases ONLY the unissued remainder of each item
--     (issued quantities already left the hold via draw-down). Status guard
--     widened to pending OR partially_issued.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cancel_pending_stock_issuance(p_pending_id integer)
RETURNS TABLE(success boolean, message text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_pending record;
  v_item record;
begin
  select * into v_pending
  from public.pending_stock_issuances
  where pending_id = p_pending_id
  for update;

  if not found then
    return query select false, 'Picking list not found'::text;
    return;
  end if;
  if not is_org_member(v_pending.org_id) then
    return query select false, 'Picking list belongs to another organization'::text;
    return;
  end if;
  if v_pending.status not in ('pending', 'partially_issued') then
    return query select false, format('Picking list already %s', v_pending.status)::text;
    return;
  end if;

  -- Release only the unissued remainder of each item back to the available pool.
  for v_item in
    select psi.component_id, (psi.quantity - psi.quantity_issued) as remaining
    from public.pending_stock_issuance_items psi
    where psi.pending_id = p_pending_id
      and (psi.quantity - psi.quantity_issued) > 0
    order by psi.component_id
  loop
    update public.inventory
    set quantity_reserved = greatest(quantity_reserved - v_item.remaining, 0)
    where component_id = v_item.component_id;
  end loop;

  update public.pending_stock_issuances
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
  where pending_id = p_pending_id;

  return query select true, 'Picking list cancelled'::text;
end;
$function$;

-- ----------------------------------------------------------------------------
-- 2d. issue_pending_items_batch — NEW: the 4x4 mechanism
--     Issues a chosen subset of items at chosen quantities to ONE staff member;
--     call N times for N staff. Locks header + each item + inventory FOR UPDATE,
--     validates each line against (quantity - quantity_issued), issues physical
--     stock via the audited RPCs, releases exactly that much hold, bumps
--     quantity_issued, then recomputes header status.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.issue_pending_items_batch(
  p_pending_id    integer,
  p_staff_id      integer,
  p_lines         text,
  p_notes         text DEFAULT NULL::text,
  p_issuance_date timestamptz DEFAULT now()
)
RETURNS TABLE(success boolean, message text, issuances_created integer, header_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_pending record;
  v_line record;
  v_item record;
  v_result record;     -- issuance_id is bigint (order path) / integer (manual path)
  v_inv_id integer;
  v_ext text;
  v_count integer := 0;
  v_new_status text;
begin
  select * into v_pending
  from public.pending_stock_issuances
  where pending_id = p_pending_id
  for update;

  if not found then
    return query select false, 'Picking list not found'::text, 0, null::text;
    return;
  end if;
  if not is_org_member(v_pending.org_id) then
    return query select false, 'Picking list belongs to another organization'::text, 0, null::text;
    return;
  end if;
  if v_pending.status not in ('pending', 'partially_issued') then
    return query select false, format('Picking list already %s', v_pending.status)::text, 0, v_pending.status;
    return;
  end if;

  -- Manual lists require a non-blank external_reference downstream.
  v_ext := coalesce(nullif(btrim(v_pending.external_reference), ''), 'PICK-' || p_pending_id);

  -- Lock every inventory row this batch will touch, in component_id order, BEFORE
  -- the per-line loop — so two batches over different lists that share components
  -- always acquire the shared rows in the same order and cannot ABBA-deadlock.
  perform 1
  from public.inventory i
  where i.component_id in (
    select psi.component_id
    from public.pending_stock_issuance_items psi
    join jsonb_to_recordset(p_lines::jsonb) as x(item_id int, quantity numeric)
      on x.item_id = psi.item_id
    where psi.pending_id = p_pending_id
  )
  order by i.component_id
  for update;

  for v_line in
    select (x.item_id)::int as item_id, (x.quantity)::numeric as quantity
    from jsonb_to_recordset(p_lines::jsonb) as x(item_id int, quantity numeric)
  loop
    if v_line.quantity is null or v_line.quantity <= 0 then
      continue;
    end if;

    select * into v_item
    from public.pending_stock_issuance_items
    where item_id = v_line.item_id and pending_id = p_pending_id
    for update;
    if not found then
      raise exception 'PICK_BATCH_FAILED: item % not on list %', v_line.item_id, p_pending_id;
    end if;

    if v_line.quantity > (v_item.quantity - v_item.quantity_issued) then
      raise exception 'PICK_BATCH_FAILED: item % over-issue (picked %, issued %, batch %)',
        v_line.item_id, v_item.quantity, v_item.quantity_issued, v_line.quantity;
    end if;

    -- Lock the inventory row FOR UPDATE before issuing / releasing the hold.
    select inventory_id into v_inv_id
    from public.inventory
    where component_id = v_item.component_id
    for update;
    if v_inv_id is null then
      raise exception 'PICK_BATCH_FAILED: missing inventory row for component %', v_item.component_id;
    end if;

    if v_pending.order_id is not null then
      select * into v_result from public.process_stock_issuance(
        p_order_id          => v_pending.order_id,
        p_component_id      => v_item.component_id,
        p_quantity          => v_line.quantity,
        p_purchase_order_id => null,
        p_notes             => coalesce(p_notes, v_pending.notes),
        p_issuance_date     => p_issuance_date,
        p_staff_id          => p_staff_id
      );
    else
      select * into v_result from public.process_manual_stock_issuance(
        p_component_id       => v_item.component_id,
        p_quantity           => v_line.quantity,
        p_notes              => coalesce(p_notes, v_pending.notes),
        p_external_reference => v_ext,
        p_issue_category     => v_pending.issue_category,
        p_staff_id           => p_staff_id,
        p_issuance_date      => p_issuance_date
      );
    end if;

    if not coalesce(v_result.success, false) then
      raise exception 'PICK_BATCH_FAILED: %', coalesce(v_result.message, 'issue error');
    end if;

    update public.stock_issuances
    set pending_item_id = v_item.item_id
    where issuance_id = v_result.issuance_id;

    -- Convert hold -> real deduction.
    update public.inventory
    set quantity_reserved = greatest(quantity_reserved - v_line.quantity, 0)
    where inventory_id = v_inv_id;

    update public.pending_stock_issuance_items
    set quantity_issued = quantity_issued + v_line.quantity
    where item_id = v_item.item_id;

    v_count := v_count + 1;
  end loop;

  -- Recompute header status: 'issued' iff no item is still short, else
  -- 'partially_issued'.
  if not exists (
    select 1 from public.pending_stock_issuance_items i
    where i.pending_id = p_pending_id and i.quantity_issued < i.quantity
  ) then
    v_new_status := 'issued';
  else
    v_new_status := 'partially_issued';
  end if;

  update public.pending_stock_issuances
  set status = v_new_status,
      issued_at = case when v_new_status = 'issued' then now() else issued_at end,
      issued_by = auth.uid()
  where pending_id = p_pending_id;

  return query select true, format('Issued %s line(s)', v_count)::text, v_count, v_new_status;
exception when others then
  return query select false, replace(sqlerrm, 'PICK_BATCH_FAILED: ', '')::text, 0, null::text;
end;
$function$;

-- ----------------------------------------------------------------------------
-- 2e. expire_stale_pending_issuances — NEW sweeper
--     For each pending/partially_issued list past expires_at, release each
--     item's remaining hold and set status = 'expired'. Returns count expired.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_stale_pending_issuances()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_pending record;
  v_item record;
  v_count integer := 0;
begin
  for v_pending in
    select p.pending_id
    from public.pending_stock_issuances p
    where p.status in ('pending', 'partially_issued')
      and p.expires_at is not null
      and p.expires_at < now()
    for update
  loop
    -- Release the unissued remainder of each item (same loop as cancel).
    for v_item in
      select psi.component_id, (psi.quantity - psi.quantity_issued) as remaining
      from public.pending_stock_issuance_items psi
      where psi.pending_id = v_pending.pending_id
        and (psi.quantity - psi.quantity_issued) > 0
      order by psi.component_id
    loop
      update public.inventory
      set quantity_reserved = greatest(quantity_reserved - v_item.remaining, 0)
      where component_id = v_item.component_id;
    end loop;

    update public.pending_stock_issuances
    set status = 'expired', cancelled_at = now()
    where pending_id = v_pending.pending_id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

-- ----------------------------------------------------------------------------
-- 2f. reconcile_inventory_reserved — NEW drift guard
--     Recompute inventory.quantity_reserved to the invariant's expected value
--     for any component where it diverges. Returns count corrected.
--     (Manual safety net — NOT run by this migration; NO backfill here.)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_inventory_reserved()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  with expected as (
    select inv.inventory_id,
           inv.quantity_reserved as current_reserved,
           coalesce(h.should_be, 0) as expected_reserved
    from public.inventory inv
    left join (
      select i.component_id, coalesce(sum(i.quantity - i.quantity_issued), 0) as should_be
      from public.pending_stock_issuance_items i
      join public.pending_stock_issuances p on p.pending_id = i.pending_id
      where p.status in ('pending', 'partially_issued')
      group by i.component_id
    ) h on h.component_id = inv.component_id
  ),
  corrected as (
    update public.inventory inv
    set quantity_reserved = e.expected_reserved
    from expected e
    where e.inventory_id = inv.inventory_id
      and e.current_reserved is distinct from e.expected_reserved
    returning 1
  )
  select count(*)::integer into v_count from corrected;

  return v_count;
end;
$function$;

-- ============================================================================
-- 3. Views / MV / availability functions — surface & subtract the hold
--    (view-drift: CREATE OR REPLACE VIEW does NOT auto-pick up new base cols;
--     a materialized view must be DROP+CREATE.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 3a. v_inventory_with_components — add quantity_reserved (raw) + quantity_available
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_inventory_with_components AS
SELECT
  i.inventory_id,
  i.component_id,
  c.internal_code,
  c.description,
  i.location,
  i.quantity_on_hand,
  i.reorder_level,
  i.average_cost,
  i.quantity_reserved,
  (i.quantity_on_hand - i.quantity_reserved) AS quantity_available
FROM inventory i
JOIN components c ON c.component_id = i.component_id;

-- ----------------------------------------------------------------------------
-- 3b. v_inventory_shortages — shortage off TRUE available (on_hand - reserved)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_inventory_shortages AS
SELECT
  c.component_id,
  c.internal_code,
  c.description,
  i.location,
  i.quantity_on_hand,
  i.reorder_level,
  GREATEST(i.reorder_level::numeric - (i.quantity_on_hand - i.quantity_reserved), 0::numeric) AS shortage_qty,
  i.average_cost,
  i.quantity_reserved
FROM inventory i
JOIN components c ON c.component_id = i.component_id
WHERE i.reorder_level IS NOT NULL
  AND (i.quantity_on_hand - i.quantity_reserved) < i.reorder_level::numeric;

-- ----------------------------------------------------------------------------
-- 3c. component_status_mv — add qty_reserved (MV can't be CREATE OR REPLACE'd).
--     DROP WITHOUT CASCADE: verified no dependents (pg_depend) before writing
--     this migration. The existing inventory-write refresh trigger
--     (trigger_refresh_component_views on inventory) keeps refreshing it; no
--     indexes existed, so none to recreate. Populates WITH DATA.
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS component_status_mv;
CREATE MATERIALIZED VIEW component_status_mv AS
SELECT
  c.component_id,
  c.internal_code,
  c.description,
  COALESCE(i.quantity_on_hand, (0)::numeric) AS in_stock,
  COALESCE(ca.allocated_to_orders, (0)::numeric) AS allocated_to_orders,
  COALESCE(i.quantity_reserved, (0)::numeric) AS qty_reserved
FROM components c
  LEFT JOIN inventory i ON c.component_id = i.component_id
  LEFT JOIN component_allocation_mv ca ON c.component_id = ca.component_id
WITH DATA;

-- ----------------------------------------------------------------------------
-- 3d. get_detailed_component_status — net the picking hold into GLOBAL shortfall
--     PRESERVE LANGUAGE sql + SECURITY INVOKER (default). Only the two global
--     shortfall expressions change (subtract COALESCE(cs.qty_reserved, 0));
--     per-order apparent/real_shortfall on the earmark stay unchanged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_detailed_component_status(p_order_id integer)
RETURNS TABLE(component_id integer, internal_code text, description text, order_required numeric, total_required numeric, order_count integer, in_stock integer, on_order integer, apparent_shortfall numeric, real_shortfall numeric, global_apparent_shortfall numeric, global_real_shortfall numeric, order_breakdown json, on_order_breakdown json, reserved_this_order numeric, reserved_by_others numeric)
LANGUAGE sql
AS $function$
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
        snap.comp_id AS component_id,
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
          -- Always include non-cutlist items
          snap.is_cutlist_item = false
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
    WHERE r.component_id IS NOT NULL
      AND r.qty > 0
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
    -- Non-cutlist demand (always from BOM snapshot)
    SELECT
        snap.comp_id AS component_id,
        snap.qty_req * od.quantity AS qty,
        od.order_id
    FROM public.order_details od
    JOIN public.orders o ON od.order_id = o.order_id
    JOIN public.order_statuses os ON o.status_id = os.status_id
    CROSS JOIN LATERAL (
      SELECT
        COALESCE((entry->>'effective_component_id')::int, (entry->>'component_id')::int) AS comp_id,
        COALESCE((entry->>'effective_quantity_required')::numeric, (entry->>'quantity_required')::numeric) AS qty_req,
        COALESCE((entry->>'is_cutlist_item')::boolean, false) AS is_cutlist_item
      FROM jsonb_array_elements(od.bom_snapshot) AS entry
    ) AS snap
    WHERE os.status_name NOT IN ('Completed', 'Cancelled')
      AND od.bom_snapshot IS NOT NULL
      AND jsonb_typeof(od.bom_snapshot) = 'array'
      AND jsonb_array_length(od.bom_snapshot) > 0
      AND (
          snap.is_cutlist_item = false
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
    WHERE gr.component_id IS NOT NULL
      AND gr.qty > 0
    GROUP BY gr.component_id
),

-- Per-order breakdown (same cutting-plan-aware logic as global_raw)
order_details_raw AS (
    SELECT
        snap.comp_id AS component_id,
        od.order_id,
        snap.qty_req * od.quantity AS qty,
        o.order_date,
        os.status_name
    FROM public.order_details od
    JOIN public.orders o ON od.order_id = o.order_id
    JOIN public.order_statuses os ON o.status_id = os.status_id
    CROSS JOIN LATERAL (
      SELECT
        COALESCE((entry->>'effective_component_id')::int, (entry->>'component_id')::int) AS comp_id,
        COALESCE((entry->>'effective_quantity_required')::numeric, (entry->>'quantity_required')::numeric) AS qty_req,
        COALESCE((entry->>'is_cutlist_item')::boolean, false) AS is_cutlist_item
      FROM jsonb_array_elements(od.bom_snapshot) AS entry
    ) AS snap
    WHERE os.status_name NOT IN ('Completed', 'Cancelled')
      AND od.bom_snapshot IS NOT NULL
      AND jsonb_typeof(od.bom_snapshot) = 'array'
      AND jsonb_array_length(od.bom_snapshot) > 0
      AND (
          snap.is_cutlist_item = false
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
      AND odr.qty > 0
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
    oc.order_required,
    gr.total_required,
    gr.order_count,
    cs.in_stock::INTEGER,
    cs.allocated_to_orders::INTEGER AS on_order,
    GREATEST(oc.order_required - GREATEST(cs.in_stock - COALESCE(ro.reserved, 0), 0), 0)::NUMERIC AS apparent_shortfall,
    GREATEST(oc.order_required - GREATEST(cs.in_stock - COALESCE(ro.reserved, 0), 0) - cs.allocated_to_orders, 0)::NUMERIC AS real_shortfall,
    -- GLOBAL shortfall now also nets the picking hard hold (cs.qty_reserved).
    GREATEST(gr.total_required - (cs.in_stock - COALESCE(cs.qty_reserved, 0)), 0)::NUMERIC AS global_apparent_shortfall,
    GREATEST(gr.total_required - (cs.in_stock - COALESCE(cs.qty_reserved, 0)) - cs.allocated_to_orders, 0)::NUMERIC AS global_real_shortfall,
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
$function$;

-- ----------------------------------------------------------------------------
-- 3e. get_all_component_requirements / get_global_component_requirements —
--     subtract COALESCE(cs.qty_reserved, 0) from cs.in_stock in their GLOBAL
--     apparent/real shortfall figures. PRESERVE LANGUAGE sql / INVOKER.
--     (get_order_component_status and get_total_component_requirements are dead
--      with zero callers — NOT touched.)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_all_component_requirements()
RETURNS SETOF jsonb
LANGUAGE sql
AS $function$
WITH
    open_orders AS (
        SELECT o.order_id
        FROM public.orders o
        JOIN public.order_statuses os ON o.status_id = os.status_id
        WHERE os.status_name IN ('Open', 'In Progress', 'Pending')
    ),
    all_order_components AS (
        SELECT
            c.component_id,
            c.internal_code,
            c.description,
            SUM(od.quantity * bom.quantity_required) AS total_required,
            COUNT(DISTINCT o.order_id) AS order_count
        FROM public.orders o
        JOIN public.order_details od ON o.order_id = od.order_id
        JOIN public.billofmaterials bom ON od.product_id = bom.product_id
        JOIN public.components c ON bom.component_id = c.component_id
        WHERE o.order_id IN (SELECT order_id FROM open_orders)
        GROUP BY c.component_id, c.internal_code, c.description
    ),
    order_details AS (
        SELECT
            c.component_id,
            jsonb_agg(
                jsonb_build_object(
                    'order_id', o.order_id,
                    'quantity', (od.quantity * bom.quantity_required)::INTEGER,
                    'order_date', o.created_at,
                    'status', os.status_name
                )
            ) AS order_breakdown
        FROM public.orders o
        JOIN public.order_statuses os ON o.status_id = os.status_id
        JOIN public.order_details od ON o.order_id = od.order_id
        JOIN public.billofmaterials bom ON od.product_id = bom.product_id
        JOIN public.components c ON bom.component_id = c.component_id
        WHERE o.order_id IN (SELECT order_id FROM open_orders)
        GROUP BY c.component_id
    )
SELECT jsonb_build_object(
        'component_id', aoc.component_id,
        'internal_code', COALESCE(cs.internal_code, aoc.internal_code),
        'description', COALESCE(cs.description, aoc.description),
        'total_required', aoc.total_required::INTEGER,
        'order_count', aoc.order_count,
        'in_stock', COALESCE(cs.in_stock, 0)::INTEGER,
        'allocated_to_orders', COALESCE(cs.allocated_to_orders, 0)::INTEGER,
        'global_apparent_shortfall', GREATEST(aoc.total_required - (COALESCE(cs.in_stock, 0) - COALESCE(cs.qty_reserved, 0)), 0)::INTEGER,
        'global_real_shortfall', GREATEST(aoc.total_required - (COALESCE(cs.in_stock, 0) - COALESCE(cs.qty_reserved, 0)) - COALESCE(cs.allocated_to_orders, 0), 0)::INTEGER,
        'order_breakdown', COALESCE(od.order_breakdown, '[]'::JSONB)
    )
FROM all_order_components aoc
LEFT JOIN public.component_status_mv cs ON aoc.component_id = cs.component_id
LEFT JOIN order_details od ON aoc.component_id = od.component_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_global_component_requirements()
RETURNS TABLE(component_id integer, internal_code text, description text, total_required integer, order_count integer, in_stock integer, on_order integer, global_apparent_shortfall numeric, global_real_shortfall numeric, draft_po_quantity integer)
LANGUAGE sql
AS $function$
WITH global_requirements AS (
    SELECT
        c.component_id,
        SUM(bom.quantity_required * od.quantity) AS total_required,
        COUNT(DISTINCT od.order_id) AS order_count
    FROM
        public.order_details od
    JOIN
        public.orders o ON od.order_id = o.order_id
    JOIN
        public.order_statuses os ON o.status_id = os.status_id
    JOIN
        public.billofmaterials bom ON od.product_id = bom.product_id
    JOIN
        public.components c ON bom.component_id = c.component_id
    WHERE
        -- Only include open/active orders, not completed or cancelled
        os.status_name NOT IN ('Completed', 'Cancelled')
    GROUP BY
        c.component_id
),
draft_supplier_orders AS (
    SELECT
        sc.component_id,
        SUM(so.order_quantity)::INT AS draft_quantity
    FROM
        public.supplier_orders so
    JOIN
        public.suppliercomponents sc ON so.supplier_component_id = sc.supplier_component_id
    JOIN
        public.supplier_order_statuses sos ON so.status_id = sos.status_id
    WHERE
        sos.status_name = 'Draft'
    GROUP BY
        sc.component_id
)
SELECT
    cs.component_id,
    cs.internal_code,
    cs.description,
    gr.total_required::INTEGER,
    gr.order_count,
    cs.in_stock::INTEGER,
    cs.allocated_to_orders::INTEGER AS on_order,
    GREATEST(gr.total_required - (cs.in_stock - COALESCE(cs.qty_reserved, 0)), 0)::NUMERIC AS global_apparent_shortfall,
    GREATEST(gr.total_required - (cs.in_stock - COALESCE(cs.qty_reserved, 0)) - cs.allocated_to_orders, 0)::NUMERIC AS global_real_shortfall,
    COALESCE(dso.draft_quantity, 0) AS draft_po_quantity
FROM
    global_requirements gr
JOIN
    public.component_status_mv cs ON gr.component_id = cs.component_id
LEFT JOIN
    draft_supplier_orders dso ON gr.component_id = dso.component_id;
$function$;

-- ============================================================================
-- 4. NO BACKFILL. NO component_reservations policy change. (Greg's decisions.)
--    Columns default 0; existing open picking lists do NOT retroactively hold
--    stock. reconcile_inventory_reserved() exists as a manual guard but is not
--    invoked here.
-- ============================================================================

-- ============================================================================
-- 5. GRANTS — mirror the live ACL on the lifecycle RPCs exactly.
--    The codebase convention (see 20260603140000_pending_stock_issuances_order_link.sql)
--    and the live pg_default_acl produce: EXECUTE for authenticated + service_role
--    + postgres, with PUBLIC and anon revoked. Pattern:
--        revoke all on function <sig> from public, anon;
--        grant execute on function <sig> to authenticated;
--    (service_role + postgres keep their ALTER DEFAULT PRIVILEGES grant.)
--    The create_pending DROP re-applies default privileges, so its revoke/grant
--    is MANDATORY; the others are re-affirmed idempotently for consistency.
-- ============================================================================

-- create_pending_stock_issuance (8-arg, freshly created)
REVOKE ALL ON FUNCTION public.create_pending_stock_issuance(text, text, text, integer, text, integer, boolean, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_pending_stock_issuance(text, text, text, integer, text, integer, boolean, timestamptz) TO authenticated;

-- complete_pending_stock_issuance (signature unchanged)
REVOKE ALL ON FUNCTION public.complete_pending_stock_issuance(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.complete_pending_stock_issuance(integer) TO authenticated;

-- cancel_pending_stock_issuance (signature unchanged)
REVOKE ALL ON FUNCTION public.cancel_pending_stock_issuance(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cancel_pending_stock_issuance(integer) TO authenticated;

-- issue_pending_items_batch (new)
REVOKE ALL ON FUNCTION public.issue_pending_items_batch(integer, integer, text, text, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.issue_pending_items_batch(integer, integer, text, text, timestamptz) TO authenticated;

-- expire_stale_pending_issuances (new)
REVOKE ALL ON FUNCTION public.expire_stale_pending_issuances() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.expire_stale_pending_issuances() TO authenticated;

-- reconcile_inventory_reserved (new)
REVOKE ALL ON FUNCTION public.reconcile_inventory_reserved() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_inventory_reserved() TO authenticated;
