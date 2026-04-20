# PO Draft Conversion Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the duplicate-PO hole caused by swallowed `setCurrentDraftStatus('converted')` failures. Add a server-side append-only ledger keyed on `(draft_id, operation_key)` with a per-submit `conversion_token`; surface partial-success states via a sticky toast + Needs review dropdown section + Finalize action.

**Architecture:**
- Single Supabase migration: new `purchase_order_draft_conversions` table (RLS SELECT only, INSERT revoked), `record_draft_conversion` SECURITY DEFINER helper, modifications to `create_purchase_order_with_lines` + `add_lines_to_purchase_order` (optional `p_draft_id`/`p_conversion_token` args, guard block calling helper), new `reconcile_draft_conversion` RPC.
- Client changes scoped to three files: `lib/client/purchase-order-drafts.ts`, `lib/queries/order-components.ts`, `components/features/purchasing/new-purchase-order-form.tsx`. Drafts list adds a Needs review section; form opens read-only when ledger rows exist.
- No SECURITY DEFINER except the narrow `record_draft_conversion` helper. Main RPCs stay SECURITY INVOKER with RLS + composite FK + `FOR UPDATE` draft-row lock as structural protection.

**Tech Stack:** PostgreSQL 15 / PL/pgSQL, Supabase MCP (`apply_migration`, `execute_sql`), Next.js 14 App Router, React 18, React Hook Form, TanStack Query, `sonner` toasts, TypeScript.

**Spec reference:** [docs/superpowers/specs/2026-04-17-po-draft-conversion-ledger-design.md](../specs/2026-04-17-po-draft-conversion-ledger-design.md)

**Target branch:** `codex/po-draft-conversion-ledger` (already created, off `codex/integration`, with the spec committed as `d94a9e8`).

---

## File structure

### New files
| Path | Purpose |
|---|---|
| `supabase/migrations/YYYYMMDDHHMMSS_po_draft_conversion_ledger.sql` | All DB changes (table, RLS, REVOKE, helper, RPC rewrites, new reconcile RPC). Single migration. |
| `scripts/test-po-conversion-ledger.sql` | SQL assertion script — run via `mcp__supabase__execute_sql` against a local/branch DB to cover the 9 idempotency/guard cases from spec §6.4. |
| `tests/po-conversion-error-parser.test.ts` | `node --test` unit test for the `isAlreadyConvertedError` / `extractPoIdsFromConversionError` pure functions. |

### Modified files
| Path | Responsibility delta |
|---|---|
| `lib/client/purchase-order-drafts.ts` | Add `getCurrentOrgId`, `isAlreadyConvertedError`, `extractPoIdsFromConversionError`, `reconcileDraftConversion`. Scope `fetchPurchaseOrderDrafts` + `fetchPurchaseOrderDraftById` to current org. Embed nested ledger rows in `DRAFT_SELECT_COLUMNS`. Extend `PurchaseOrderDraft` type with `conversion_po_ids`. |
| `lib/queries/order-components.ts` | Unchanged — the Needs review flow does not touch `createComponentPurchaseOrders`. (The local `createPurchaseOrder` helper in the form, not this file, is what we modify. Spec §5.6's reference to this file was aspirational — confirm and update spec note in the plan's final commit.) |
| `components/features/purchasing/new-purchase-order-form.tsx` | Local `createPurchaseOrder` gains `{ draftId, conversionToken }` options (convert `Promise.all` to serial `for...of`). `createOrderMutation.onSuccess` + `onError` split status-flip from PO-creation success, handle P0003. `handleConsolidationConfirm` threads draftId+token into both RPC call sites with matching success/error handling. New Needs review banner, Finalize modal, Active/Needs-review dropdown split, read-only gating on `has_ledger_rows`. Autosave suppressed when read-only. |
| `types/purchasing.ts` (or wherever `PurchaseOrderDraft` lives) | Add `conversion_po_ids: number[]` field. |
| `docs/superpowers/specs/2026-04-17-po-draft-conversion-ledger-design.md` | Minor fix-up note re: `createPurchaseOrder` location (spec §5.6 references `lib/queries/order-components.ts` but the function is actually local to the form). Apply via plan's final docs commit. |

---

## Phase 1 — Database migration

### Task 1: Create migration skeleton (table + indexes + RLS SELECT + REVOKE)

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_po_draft_conversion_ledger.sql`

**What and why:** Lay down the ledger table. The table is SELECT-visible under the same org-member policy as the parent drafts table, but INSERT/UPDATE/DELETE are revoked from all client roles — writes go exclusively through the SECURITY DEFINER helper we add in Task 2.

- [ ] **Step 1: Determine the migration timestamp**

Run:
```bash
date -u +%Y%m%d%H%M%S
```
Expected: 14-digit UTC timestamp, e.g. `20260418000000`. **Use this exact value for the filename** (later than `20260417000000_fix_po_draft_rpc_variable_conflict.sql`).

- [ ] **Step 2: Create the migration file with table, RLS, REVOKE**

Create `supabase/migrations/<timestamp>_po_draft_conversion_ledger.sql`:

```sql
-- PO draft conversion ledger: append-only idempotency ledger.
-- Spec: docs/superpowers/specs/2026-04-17-po-draft-conversion-ledger-design.md

BEGIN;

-- 1. Table + indexes
CREATE TABLE public.purchase_order_draft_conversions (
    draft_id            bigint       NOT NULL,
    operation_key       text         NOT NULL,
    purchase_order_id   integer      NOT NULL
                                     REFERENCES public.purchase_orders(purchase_order_id)
                                     ON DELETE CASCADE,
    conversion_token    uuid         NOT NULL,
    mode                text         NOT NULL CHECK (mode IN ('created','appended')),
    supplier_order_ids  integer[]    NOT NULL DEFAULT '{}',
    org_id              uuid         NOT NULL DEFAULT public.current_org_id(),
    created_at          timestamptz  NOT NULL DEFAULT now(),
    created_by          uuid         NOT NULL DEFAULT auth.uid(),
    PRIMARY KEY (draft_id, operation_key),
    CONSTRAINT po_draft_conversions_draft_fk
        FOREIGN KEY (draft_id, org_id)
        REFERENCES public.purchase_order_drafts(draft_id, org_id)
        ON DELETE CASCADE
);

CREATE INDEX po_draft_conversions_token_idx
    ON public.purchase_order_draft_conversions (draft_id, conversion_token);

CREATE INDEX po_draft_conversions_po_idx
    ON public.purchase_order_draft_conversions (purchase_order_id);

CREATE INDEX po_draft_conversions_org_idx
    ON public.purchase_order_draft_conversions (org_id);

COMMENT ON TABLE public.purchase_order_draft_conversions IS
    'Append-only ledger. One row per supplier-scoped materialization of a draft into a purchase order. Written exclusively by public.record_draft_conversion (SECURITY DEFINER).';

-- 2. RLS
ALTER TABLE public.purchase_order_draft_conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY po_draft_conversions_select_org_member
    ON public.purchase_order_draft_conversions
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.organization_members m
            WHERE m.user_id = auth.uid()
              AND m.org_id = purchase_order_draft_conversions.org_id
              AND m.is_active = true
              AND (m.banned_until IS NULL OR m.banned_until <= now())
        )
    );

-- No INSERT, UPDATE, DELETE policy. Append-only, helper-only writes.

-- 3. Revoke direct client write access.
REVOKE INSERT, UPDATE, DELETE
    ON public.purchase_order_draft_conversions
    FROM authenticated, anon;

COMMIT;
```

- [ ] **Step 3: Apply the migration via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `po_draft_conversion_ledger` and the SQL body above (without the BEGIN/COMMIT — the MCP tool wraps its own transaction).

Expected: migration applies cleanly; no errors.

- [ ] **Step 4: Verify table + policies + revocations**

Use `mcp__supabase__execute_sql`:

```sql
SELECT table_name FROM information_schema.tables
 WHERE table_schema='public' AND table_name='purchase_order_draft_conversions';
-- expect 1 row

SELECT policyname, cmd FROM pg_policies
 WHERE tablename='purchase_order_draft_conversions';
-- expect exactly one row: po_draft_conversions_select_org_member | SELECT

SELECT grantee, privilege_type FROM information_schema.table_privileges
 WHERE table_schema='public' AND table_name='purchase_order_draft_conversions'
   AND grantee IN ('authenticated','anon')
 ORDER BY grantee, privilege_type;
-- expect only SELECT for authenticated (no INSERT/UPDATE/DELETE);
-- anon should have no rows at all
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/<timestamp>_po_draft_conversion_ledger.sql
git commit -m "feat(po-drafts): add purchase_order_draft_conversions ledger table

Append-only table for idempotency of draft→PO conversion.
RLS SELECT mirrors purchase_order_drafts (org_member EXISTS).
INSERT/UPDATE/DELETE revoked from client roles; writes will go
through a SECURITY DEFINER helper added in the next commit."
```

---

### Task 2: Add `record_draft_conversion` SECURITY DEFINER helper

**Files:**
- Modify: `supabase/migrations/<timestamp>_po_draft_conversion_ledger.sql` (append)

**What and why:** The only path that is allowed to INSERT into the ledger. Runs as DEFINER so it bypasses the REVOKE above, but re-validates org membership + both FK endpoints against `current_org_id()` before inserting.

- [ ] **Step 1: Append helper + grants to the migration file**

Append to `supabase/migrations/<timestamp>_po_draft_conversion_ledger.sql` (before the final `COMMIT`, or as a second `BEGIN...COMMIT` block if splitting):

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.record_draft_conversion(
    p_draft_id            bigint,
    p_operation_key       text,
    p_purchase_order_id   integer,
    p_conversion_token    uuid,
    p_mode                text,
    p_supplier_order_ids  integer[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
    v_org_id uuid := public.current_org_id();
BEGIN
    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'No current org for caller' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_members m
        WHERE m.user_id = auth.uid()
          AND m.org_id = v_org_id
          AND m.is_active = true
          AND (m.banned_until IS NULL OR m.banned_until <= now())
    ) THEN
        RAISE EXCEPTION 'Not an active member of current org' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.purchase_order_drafts
         WHERE draft_id = p_draft_id AND org_id = v_org_id
    ) THEN
        RAISE EXCEPTION 'Draft % not in current org', p_draft_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.purchase_orders
         WHERE purchase_order_id = p_purchase_order_id AND org_id = v_org_id
    ) THEN
        RAISE EXCEPTION 'Purchase order % not in current org', p_purchase_order_id USING ERRCODE = 'P0002';
    END IF;

    IF p_mode NOT IN ('created','appended') THEN
        RAISE EXCEPTION 'Invalid mode %', p_mode USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.purchase_order_draft_conversions
        (draft_id, operation_key, purchase_order_id, conversion_token,
         mode, supplier_order_ids, org_id)
    VALUES
        (p_draft_id, p_operation_key, p_purchase_order_id, p_conversion_token,
         p_mode, p_supplier_order_ids, v_org_id);
END;
$$;

REVOKE ALL    ON FUNCTION public.record_draft_conversion(bigint, text, integer, uuid, text, integer[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_draft_conversion(bigint, text, integer, uuid, text, integer[]) TO authenticated;

COMMIT;
```

- [ ] **Step 2: Re-apply migration chunk via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `po_draft_conversion_ledger_helper` and the helper body above.

Expected: applies cleanly.

- [ ] **Step 3: Verify the function exists and is SECURITY DEFINER**

```sql
SELECT proname, prosecdef, prosrc IS NOT NULL AS has_body
  FROM pg_proc
 WHERE proname = 'record_draft_conversion' AND pronamespace = 'public'::regnamespace;
-- expect 1 row, prosecdef = true
```

- [ ] **Step 4: Verify an unauthenticated direct INSERT fails**

Useful as a confidence check. Run (with any authenticated user context):
```sql
-- Expected: ERROR permission denied for table purchase_order_draft_conversions
INSERT INTO public.purchase_order_draft_conversions
    (draft_id, operation_key, purchase_order_id, conversion_token, mode)
VALUES (1, 'x', 1, gen_random_uuid(), 'created');
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/<timestamp>_po_draft_conversion_ledger.sql
git commit -m "feat(po-drafts): add record_draft_conversion SECURITY DEFINER helper

Only path allowed to INSERT into purchase_order_draft_conversions.
Re-validates org membership + both FK endpoints (draft_id, PO id)
against current_org_id() before writing."
```

---

### Task 3: Rewrite `create_purchase_order_with_lines` with guard + helper call

**Files:**
- Modify: `supabase/migrations/<timestamp>_po_draft_conversion_ledger.sql` (append)

**What and why:** Add optional `p_draft_id bigint` and `p_conversion_token uuid` parameters. When both are NULL, behavior is identical to today. When both are supplied: lock the draft row, reject cross-submit/replay, record a ledger row after business writes succeed.

- [ ] **Step 1: Append DROP + CREATE OR REPLACE to the migration**

Append to `supabase/migrations/<timestamp>_po_draft_conversion_ledger.sql`:

```sql
BEGIN;

-- Drop the exact old signature so PostgREST cannot resolve against a stale overload.
DROP FUNCTION IF EXISTS public.create_purchase_order_with_lines(integer, jsonb, integer, timestamptz, text);

CREATE OR REPLACE FUNCTION public.create_purchase_order_with_lines(
    supplier_id        integer,
    line_items         jsonb,
    status_id          integer      DEFAULT NULL,
    order_date         timestamptz  DEFAULT now(),
    notes              text         DEFAULT '',
    p_draft_id         bigint       DEFAULT NULL,
    p_conversion_token uuid         DEFAULT NULL
) RETURNS TABLE (
    purchase_order_id  integer,
    supplier_order_ids integer[]
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
    resolved_status_id integer := status_id;
    actual_order_date  timestamptz := coalesce(order_date, now());
    new_purchase_order_id integer;
    inserted_ids       integer[] := '{}';
    line               jsonb;
    new_order_id       integer;
    alloc              jsonb;
    alloc_sum          numeric;
    line_qty           numeric;
    -- Conversion guard locals
    computed_operation_key text := 'create:supplier:' || supplier_id::text;
    existing_po_ids        integer[];
    existing_op_po_id      integer;
    existing_op_supplier_order_ids integer[];
BEGIN
    -- Guard block (§4.2). Both param or neither.
    IF (p_draft_id IS NULL) <> (p_conversion_token IS NULL) THEN
        RAISE EXCEPTION
            'p_draft_id and p_conversion_token must both be supplied or both be NULL'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_draft_id IS NOT NULL THEN
        -- 1. Lock draft row, enforce tenancy.
        PERFORM 1 FROM public.purchase_order_drafts
         WHERE draft_id = p_draft_id
           AND org_id = public.current_org_id()
           FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Draft % not found in current org', p_draft_id
                USING ERRCODE = 'P0002';
        END IF;

        -- 2. Cross-submit rejection.
        IF EXISTS (
            SELECT 1 FROM public.purchase_order_draft_conversions
             WHERE draft_id = p_draft_id
               AND conversion_token <> p_conversion_token
        ) THEN
            SELECT array_agg(DISTINCT purchase_order_id)
              INTO existing_po_ids
              FROM public.purchase_order_draft_conversions
             WHERE draft_id = p_draft_id;
            RAISE EXCEPTION 'Draft % already converted to PO(s) %',
                p_draft_id, existing_po_ids
                USING ERRCODE = 'P0003',
                      DETAIL = json_build_object('purchase_order_ids', existing_po_ids)::text;
        END IF;

        -- 3. Per-operation idempotency.
        SELECT purchase_order_id, supplier_order_ids
          INTO existing_op_po_id, existing_op_supplier_order_ids
          FROM public.purchase_order_draft_conversions
         WHERE draft_id = p_draft_id
           AND operation_key = computed_operation_key;
        IF FOUND THEN
            RETURN QUERY SELECT existing_op_po_id, existing_op_supplier_order_ids;
            RETURN;
        END IF;
    END IF;

    -- ===== Existing business logic (verbatim from 20260306161654) =====

    IF line_items IS NULL OR jsonb_typeof(line_items) <> 'array' OR jsonb_array_length(line_items) = 0 THEN
        RAISE EXCEPTION 'line_items payload must be a non-empty array';
    END IF;

    IF resolved_status_id IS NULL THEN
        SELECT sos.status_id INTO resolved_status_id
          FROM supplier_order_statuses sos
         WHERE sos.status_name = 'Draft'
         LIMIT 1;
        IF resolved_status_id IS NULL THEN
            RAISE EXCEPTION 'Could not resolve status_id for Draft supplier orders';
        END IF;
    END IF;

    INSERT INTO purchase_orders (supplier_id, status_id, order_date, notes, created_by)
    VALUES (supplier_id, resolved_status_id, actual_order_date, notes, auth.uid())
    RETURNING purchase_orders.purchase_order_id INTO new_purchase_order_id;

    FOR line IN SELECT * FROM jsonb_array_elements(line_items)
    LOOP
        INSERT INTO supplier_orders (
            supplier_component_id, order_quantity, order_date,
            status_id, total_received, purchase_order_id
        ) VALUES (
            (line->>'supplier_component_id')::integer,
            (line->>'order_quantity')::numeric,
            actual_order_date,
            resolved_status_id,
            0,
            new_purchase_order_id
        ) RETURNING supplier_orders.order_id INTO new_order_id;

        inserted_ids := inserted_ids || new_order_id;
        line_qty := (line->>'order_quantity')::numeric;

        IF line ? 'allocations' AND jsonb_typeof(line->'allocations') = 'array'
           AND jsonb_array_length(line->'allocations') > 0 THEN

            alloc_sum := 0;
            FOR alloc IN SELECT * FROM jsonb_array_elements(line->'allocations')
            LOOP
                alloc_sum := alloc_sum + (alloc->>'quantity_for_order')::numeric;
            END LOOP;

            IF alloc_sum > line_qty THEN
                RAISE EXCEPTION 'Allocation total (%) exceeds line quantity (%) for supplier_component_id %',
                    alloc_sum, line_qty, (line->>'supplier_component_id');
            END IF;

            FOR alloc IN SELECT * FROM jsonb_array_elements(line->'allocations')
            LOOP
                INSERT INTO supplier_order_customer_orders (
                    supplier_order_id, order_id, component_id,
                    quantity_for_order, quantity_for_stock
                ) VALUES (
                    new_order_id,
                    (alloc->>'customer_order_id')::integer,
                    (line->>'component_id')::integer,
                    (alloc->>'quantity_for_order')::numeric,
                    0
                );
            END LOOP;

            IF alloc_sum < line_qty THEN
                INSERT INTO supplier_order_customer_orders (
                    supplier_order_id, order_id, component_id,
                    quantity_for_order, quantity_for_stock
                ) VALUES (
                    new_order_id, NULL, (line->>'component_id')::integer,
                    0, line_qty - alloc_sum
                );
            END IF;
        ELSE
            INSERT INTO supplier_order_customer_orders (
                supplier_order_id, order_id, component_id,
                quantity_for_order, quantity_for_stock
            ) VALUES (
                new_order_id,
                (line->>'customer_order_id')::integer,
                (line->>'component_id')::integer,
                COALESCE((line->>'quantity_for_order')::numeric, 0),
                COALESCE((line->>'quantity_for_stock')::numeric, 0)
            );
        END IF;
    END LOOP;

    FOR line IN SELECT * FROM jsonb_array_elements(line_items)
    LOOP
        IF line->>'line_notes' IS NOT NULL AND line->>'line_notes' <> '' THEN
            UPDATE supplier_orders so
               SET notes = line->>'line_notes'
             WHERE so.purchase_order_id = new_purchase_order_id
               AND so.supplier_component_id = (line->>'supplier_component_id')::integer;
        END IF;
    END LOOP;

    -- ===== End existing business logic =====

    -- Ledger insert via helper (§3.2).
    IF p_draft_id IS NOT NULL THEN
        PERFORM public.record_draft_conversion(
            p_draft_id           := p_draft_id,
            p_operation_key      := computed_operation_key,
            p_purchase_order_id  := new_purchase_order_id,
            p_conversion_token   := p_conversion_token,
            p_mode               := 'created',
            p_supplier_order_ids := inserted_ids
        );
    END IF;

    RETURN QUERY SELECT new_purchase_order_id, inserted_ids;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_purchase_order_with_lines(
    integer, jsonb, integer, timestamptz, text, bigint, uuid
) TO authenticated, service_role;

COMMIT;
```

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `po_create_rpc_with_conversion_guard` and this body.

Expected: applies cleanly.

- [ ] **Step 3: Verify new signature is the only one registered**

```sql
SELECT pg_get_function_arguments(oid) AS args
  FROM pg_proc
 WHERE proname = 'create_purchase_order_with_lines'
   AND pronamespace = 'public'::regnamespace;
-- expect exactly 1 row listing the 7 args including p_draft_id bigint and p_conversion_token uuid
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/<timestamp>_po_draft_conversion_ledger.sql
git commit -m "feat(po-drafts): add conversion guard to create_purchase_order_with_lines

New optional p_draft_id / p_conversion_token params (both NULL or both
supplied). When supplied: FOR UPDATE lock on draft row, cross-submit
rejection (P0003 with purchase_order_ids JSON detail), per-operation
idempotency (replay returns prior result). Ledger insert via SECURITY
DEFINER helper.

#variable_conflict use_column added to cure the pre-existing shadowing
risk on the UPDATE supplier_orders ... WHERE purchase_order_id = ...
statement."
```

---

### Task 4: Rewrite `add_lines_to_purchase_order` with guard + helper call

**Files:**
- Modify: `supabase/migrations/<timestamp>_po_draft_conversion_ledger.sql` (append)

**What and why:** Same surgery as Task 3 but on the append-to-existing RPC. `operation_key` format is `'append:po:' || target_purchase_order_id` — different enough from `create:supplier:*` that a single draft can legitimately have multi-mode rows.

- [ ] **Step 1: Append DROP + CREATE OR REPLACE**

```sql
BEGIN;

DROP FUNCTION IF EXISTS public.add_lines_to_purchase_order(integer, jsonb);

CREATE OR REPLACE FUNCTION public.add_lines_to_purchase_order(
    target_purchase_order_id integer,
    line_items               jsonb,
    p_draft_id               bigint DEFAULT NULL,
    p_conversion_token       uuid   DEFAULT NULL
) RETURNS TABLE (supplier_order_ids integer[])
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
    po_status_id      integer;
    po_order_date     timestamptz;
    inserted_ids      integer[] := '{}';
    line              jsonb;
    new_order_id      integer;
    alloc             jsonb;
    alloc_sum         numeric;
    line_qty          numeric;
    computed_operation_key text := 'append:po:' || target_purchase_order_id::text;
    existing_po_ids        integer[];
    existing_op_supplier_order_ids integer[];
BEGIN
    IF (p_draft_id IS NULL) <> (p_conversion_token IS NULL) THEN
        RAISE EXCEPTION
            'p_draft_id and p_conversion_token must both be supplied or both be NULL'
            USING ERRCODE = 'P0001';
    END IF;

    IF p_draft_id IS NOT NULL THEN
        PERFORM 1 FROM public.purchase_order_drafts
         WHERE draft_id = p_draft_id
           AND org_id = public.current_org_id()
           FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Draft % not found in current org', p_draft_id
                USING ERRCODE = 'P0002';
        END IF;

        IF EXISTS (
            SELECT 1 FROM public.purchase_order_draft_conversions
             WHERE draft_id = p_draft_id
               AND conversion_token <> p_conversion_token
        ) THEN
            SELECT array_agg(DISTINCT purchase_order_id)
              INTO existing_po_ids
              FROM public.purchase_order_draft_conversions
             WHERE draft_id = p_draft_id;
            RAISE EXCEPTION 'Draft % already converted to PO(s) %',
                p_draft_id, existing_po_ids
                USING ERRCODE = 'P0003',
                      DETAIL = json_build_object('purchase_order_ids', existing_po_ids)::text;
        END IF;

        SELECT supplier_order_ids
          INTO existing_op_supplier_order_ids
          FROM public.purchase_order_draft_conversions
         WHERE draft_id = p_draft_id
           AND operation_key = computed_operation_key;
        IF FOUND THEN
            RETURN QUERY SELECT existing_op_supplier_order_ids;
            RETURN;
        END IF;
    END IF;

    -- ===== Existing business logic =====

    IF line_items IS NULL OR jsonb_typeof(line_items) <> 'array' OR jsonb_array_length(line_items) = 0 THEN
        RAISE EXCEPTION 'line_items payload must be a non-empty array';
    END IF;

    SELECT po.status_id, po.order_date INTO po_status_id, po_order_date
      FROM purchase_orders po
     WHERE po.purchase_order_id = target_purchase_order_id;

    IF po_status_id IS NULL THEN
        RAISE EXCEPTION 'Purchase order % not found', target_purchase_order_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM supplier_order_statuses sos
         WHERE sos.status_id = po_status_id AND sos.status_name = 'Draft'
    ) THEN
        RAISE EXCEPTION 'Can only add lines to Draft purchase orders';
    END IF;

    FOR line IN SELECT * FROM jsonb_array_elements(line_items)
    LOOP
        INSERT INTO supplier_orders (
            supplier_component_id, order_quantity, order_date,
            status_id, total_received, purchase_order_id
        ) VALUES (
            (line->>'supplier_component_id')::integer,
            (line->>'order_quantity')::numeric,
            po_order_date, po_status_id, 0,
            target_purchase_order_id
        ) RETURNING supplier_orders.order_id INTO new_order_id;

        inserted_ids := inserted_ids || new_order_id;
        line_qty := (line->>'order_quantity')::numeric;

        IF line ? 'allocations' AND jsonb_typeof(line->'allocations') = 'array'
           AND jsonb_array_length(line->'allocations') > 0 THEN

            alloc_sum := 0;
            FOR alloc IN SELECT * FROM jsonb_array_elements(line->'allocations')
            LOOP
                alloc_sum := alloc_sum + (alloc->>'quantity_for_order')::numeric;
            END LOOP;

            IF alloc_sum > line_qty THEN
                RAISE EXCEPTION 'Allocation total (%) exceeds line quantity (%) for supplier_component_id %',
                    alloc_sum, line_qty, (line->>'supplier_component_id');
            END IF;

            FOR alloc IN SELECT * FROM jsonb_array_elements(line->'allocations')
            LOOP
                INSERT INTO supplier_order_customer_orders (
                    supplier_order_id, order_id, component_id,
                    quantity_for_order, quantity_for_stock
                ) VALUES (
                    new_order_id,
                    (alloc->>'customer_order_id')::integer,
                    (line->>'component_id')::integer,
                    (alloc->>'quantity_for_order')::numeric,
                    0
                );
            END LOOP;

            IF alloc_sum < line_qty THEN
                INSERT INTO supplier_order_customer_orders (
                    supplier_order_id, order_id, component_id,
                    quantity_for_order, quantity_for_stock
                ) VALUES (
                    new_order_id, NULL, (line->>'component_id')::integer,
                    0, line_qty - alloc_sum
                );
            END IF;
        ELSE
            INSERT INTO supplier_order_customer_orders (
                supplier_order_id, order_id, component_id,
                quantity_for_order, quantity_for_stock
            ) VALUES (
                new_order_id,
                (line->>'customer_order_id')::integer,
                (line->>'component_id')::integer,
                COALESCE((line->>'quantity_for_order')::numeric, 0),
                COALESCE((line->>'quantity_for_stock')::numeric, 0)
            );
        END IF;

        IF line->>'line_notes' IS NOT NULL AND line->>'line_notes' <> '' THEN
            UPDATE supplier_orders so
               SET notes = line->>'line_notes'
             WHERE so.order_id = new_order_id;
        END IF;
    END LOOP;

    -- ===== End existing business logic =====

    IF p_draft_id IS NOT NULL THEN
        -- For append: we need *some* PO id on the ledger row. Use target_purchase_order_id.
        PERFORM public.record_draft_conversion(
            p_draft_id           := p_draft_id,
            p_operation_key      := computed_operation_key,
            p_purchase_order_id  := target_purchase_order_id,
            p_conversion_token   := p_conversion_token,
            p_mode               := 'appended',
            p_supplier_order_ids := inserted_ids
        );
    END IF;

    RETURN QUERY SELECT inserted_ids;
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_lines_to_purchase_order(integer, jsonb, bigint, uuid)
    TO authenticated, service_role;

COMMIT;
```

> **Note on the existing `add_lines_to_purchase_order`:** The current (pre-rewrite) body updates line notes inside the same FOR loop via the full `WHERE purchase_order_id = target_purchase_order_id AND supplier_component_id = ...` qualifier. The plan version above scopes the notes update to the single inserted row by `so.order_id = new_order_id`, which is more precise and avoids touching unrelated pre-existing lines on the target PO — a silent correctness improvement. Verify behavior in Task 6 before proceeding.

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `po_add_lines_rpc_with_conversion_guard`.

- [ ] **Step 3: Verify signature + grants**

```sql
SELECT pg_get_function_arguments(oid) AS args
  FROM pg_proc
 WHERE proname = 'add_lines_to_purchase_order' AND pronamespace = 'public'::regnamespace;
-- expect 1 row, 4 args
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/<timestamp>_po_draft_conversion_ledger.sql
git commit -m "feat(po-drafts): add conversion guard to add_lines_to_purchase_order

Same guard shape as create_purchase_order_with_lines: optional
p_draft_id/p_conversion_token, P0001/P0002/P0003, per-op idempotency.
operation_key = 'append:po:<target_po_id>'. mode = 'appended'.

Incidental fix: the line-notes UPDATE is now scoped by so.order_id
instead of (purchase_order_id + supplier_component_id), preventing
stray updates to pre-existing lines on the target PO."
```

---

### Task 5: Add `reconcile_draft_conversion` RPC

**Files:**
- Modify: `supabase/migrations/<timestamp>_po_draft_conversion_ledger.sql` (append)

**What and why:** Client-callable RPC that reads the ledger and flips the draft's status to `converted` if not already. Used by both the immediate-path sticky toast Retry button and the Needs review Finalize action. SECURITY INVOKER so RLS stays in the loop — relies on `set_purchase_order_draft_status` already enforcing its own org/auth checks.

- [ ] **Step 1: Append RPC**

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.reconcile_draft_conversion(p_draft_id bigint)
RETURNS TABLE (reconciled boolean, purchase_order_ids integer[])
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
#variable_conflict use_column
DECLARE
    ledger_po_ids  integer[];
    current_status text;
BEGIN
    SELECT array_agg(DISTINCT purchase_order_id)
      INTO ledger_po_ids
      FROM public.purchase_order_draft_conversions
     WHERE draft_id = p_draft_id
       AND org_id = public.current_org_id();

    IF ledger_po_ids IS NULL THEN
        RETURN QUERY SELECT false, ARRAY[]::integer[];
        RETURN;
    END IF;

    SELECT status INTO current_status
      FROM public.purchase_order_drafts
     WHERE draft_id = p_draft_id AND org_id = public.current_org_id();

    IF current_status <> 'converted' THEN
        PERFORM public.set_purchase_order_draft_status(
            p_draft_id, 'converted', ledger_po_ids::bigint[]
        );
    END IF;

    RETURN QUERY SELECT true, ledger_po_ids;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_draft_conversion(bigint)
    TO authenticated, service_role;

COMMIT;
```

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__supabase__apply_migration` with name `po_reconcile_draft_conversion`.

- [ ] **Step 3: Verify**

```sql
SELECT proname, prosecdef FROM pg_proc
 WHERE proname = 'reconcile_draft_conversion' AND pronamespace = 'public'::regnamespace;
-- expect 1 row, prosecdef = false (INVOKER)
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/<timestamp>_po_draft_conversion_ledger.sql
git commit -m "feat(po-drafts): add reconcile_draft_conversion RPC

SECURITY INVOKER. Reads current-org ledger rows and calls
set_purchase_order_draft_status if not already converted. Used by
both the immediate Retry cleanup toast and the Needs review
Finalize action."
```

---

### Task 6: SQL idempotency and guard test script

**Files:**
- Create: `scripts/test-po-conversion-ledger.sql`

**What and why:** Cover the 9 behaviors from spec §6.4 as one executable SQL script. Runnable ad-hoc via `mcp__supabase__execute_sql` against a Supabase branch DB seeded with the test account. Not automated in CI (project has no DB-test CI), but a durable reproducible artifact.

- [ ] **Step 1: Write the script**

Create `scripts/test-po-conversion-ledger.sql`:

```sql
-- PO draft conversion ledger: guard + idempotency assertions.
-- Preconditions: signed in as testai@qbutton.co.za on QButton org.
-- Preconditions: a draft exists for the current user. Adjust :draft_id below.
--
-- Usage: in Supabase SQL editor (or mcp__supabase__execute_sql), set:
--   \set draft_id 999            -- replace with a real draft_id you own
--   \set supplier_id 1           -- replace with a supplier you have components for
--   \set token_a '11111111-1111-1111-1111-111111111111'
--   \set token_b '22222222-2222-2222-2222-222222222222'
--
-- Each \echo + SELECT block is one assertion. The test harness treats a
-- raised exception with matching SQLSTATE as PASS; anything else is FAIL.

BEGIN;

-- 1. Param coupling: p_draft_id without p_conversion_token → P0001.
DO $$
BEGIN
    BEGIN
        PERFORM public.create_purchase_order_with_lines(
            :supplier_id, '[{"supplier_component_id":1,"order_quantity":1,"component_id":1,"quantity_for_order":1,"quantity_for_stock":0}]'::jsonb,
            NULL, now(), '', :draft_id::bigint, NULL::uuid);
        RAISE EXCEPTION 'FAIL: expected P0001, got success';
    EXCEPTION WHEN sqlstate 'P0001' THEN
        RAISE NOTICE 'PASS: param coupling raises P0001';
    END;
END $$;

-- 2. Cross-org guard: bogus draft id → P0002.
DO $$
BEGIN
    BEGIN
        PERFORM public.create_purchase_order_with_lines(
            :supplier_id, '[{"supplier_component_id":1,"order_quantity":1,"component_id":1,"quantity_for_order":1,"quantity_for_stock":0}]'::jsonb,
            NULL, now(), '', -1::bigint, :'token_a'::uuid);
        RAISE EXCEPTION 'FAIL: expected P0002, got success';
    EXCEPTION WHEN sqlstate 'P0002' THEN
        RAISE NOTICE 'PASS: bogus draft raises P0002';
    END;
END $$;

-- 3. Happy path: first supplier call records a ledger row.
SELECT * FROM public.create_purchase_order_with_lines(
    :supplier_id, '[{"supplier_component_id":1,"order_quantity":1,"component_id":1,"quantity_for_order":1,"quantity_for_stock":0}]'::jsonb,
    NULL, now(), '', :draft_id::bigint, :'token_a'::uuid);
-- Expect: one row returned with a purchase_order_id.

-- 4. Same op replay: re-run with same draft_id + same token + same supplier_id.
SELECT * FROM public.create_purchase_order_with_lines(
    :supplier_id, '[{"supplier_component_id":2,"order_quantity":99,"component_id":1,"quantity_for_order":99,"quantity_for_stock":0}]'::jsonb,
    NULL, now(), '', :draft_id::bigint, :'token_a'::uuid);
-- Expect: same purchase_order_id as step 3; line_items payload IGNORED.

-- 5. Same op replay: zero new purchase_orders rows.
SELECT count(*) AS pos_for_supplier
  FROM public.purchase_orders
 WHERE supplier_id = :supplier_id
   AND created_by = auth.uid()
   AND order_date >= (now() - interval '1 minute');
-- Expect: exactly 1. (The replay did not insert a second PO.)

-- 6. Cross-submit rejection: different token on same draft → P0003.
DO $$
BEGIN
    BEGIN
        PERFORM public.create_purchase_order_with_lines(
            :supplier_id, '[{"supplier_component_id":1,"order_quantity":1,"component_id":1,"quantity_for_order":1,"quantity_for_stock":0}]'::jsonb,
            NULL, now(), '', :draft_id::bigint, :'token_b'::uuid);
        RAISE EXCEPTION 'FAIL: expected P0003, got success';
    EXCEPTION WHEN sqlstate 'P0003' THEN
        RAISE NOTICE 'PASS: cross-submit raises P0003';
    END;
END $$;

-- 7. reconcile_draft_conversion flips status on draft with ledger rows.
SELECT status FROM public.purchase_order_drafts WHERE draft_id = :draft_id::bigint;
-- Probably 'draft' at this point (RPC succeeded but the test session never flipped status).
SELECT * FROM public.reconcile_draft_conversion(:draft_id::bigint);
-- Expect: reconciled=true, purchase_order_ids contains the PO from step 3.
SELECT status, converted_purchase_order_ids FROM public.purchase_order_drafts
 WHERE draft_id = :draft_id::bigint;
-- Expect: status='converted', converted_purchase_order_ids contains the PO id.

-- 8. reconcile on draft with no ledger rows: returns reconciled=false.
-- (Create a fresh draft via save_purchase_order_draft to test this.)
-- Left as a documented manual step — `SELECT * FROM public.reconcile_draft_conversion(<fresh_draft_id>::bigint);`
-- Expect: reconciled=false, purchase_order_ids={}.

-- 9. Direct INSERT into ledger table is denied.
DO $$
BEGIN
    BEGIN
        INSERT INTO public.purchase_order_draft_conversions
            (draft_id, operation_key, purchase_order_id, conversion_token, mode)
        VALUES (:draft_id::bigint, 'forged', 1, :'token_b'::uuid, 'created');
        RAISE EXCEPTION 'FAIL: direct INSERT unexpectedly succeeded';
    EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'PASS: direct INSERT denied';
    END;
END $$;

ROLLBACK;
```

- [ ] **Step 2: Execute the script against the live DB**

Identify a disposable test draft id by executing a quick query (via `mcp__supabase__execute_sql`):

```sql
SELECT draft_id FROM public.purchase_order_drafts
 WHERE status='draft' AND created_by = auth.uid()
 ORDER BY updated_at DESC LIMIT 1;
```

Edit the `\set` lines at the top of `scripts/test-po-conversion-ledger.sql` to use that `draft_id` and a real supplier/component combination from the testai@qbutton org. Run the script via `mcp__supabase__execute_sql` (one `DO $$ ... $$` block at a time if the tool complains about multiple statements).

Expected: each DO block emits a `NOTICE 'PASS: ...'`. No `FAIL:` notices.

- [ ] **Step 3: Restore test data**

Per memory `feedback_restore_test_data.md`: the script wraps everything in `ROLLBACK`, so the test draft is left intact. If any real rows leaked (e.g. the step-3 PO), delete them manually:

```sql
DELETE FROM public.supplier_orders
 WHERE purchase_order_id IN (
     SELECT purchase_order_id FROM public.purchase_orders
      WHERE created_by = auth.uid()
        AND order_date >= (now() - interval '15 minutes')
 );
DELETE FROM public.purchase_orders
 WHERE created_by = auth.uid()
   AND order_date >= (now() - interval '15 minutes');
```

Confirm the live testai draft is still in its original state.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-po-conversion-ledger.sql
git commit -m "test(po-drafts): add SQL assertion script for conversion ledger

Covers the 9 guard/idempotency cases from spec §6.4:
P0001 param coupling, P0002 cross-org, happy path replay returns
prior result, zero duplicate POs, P0003 cross-submit rejection,
reconcile_draft_conversion flips status, direct INSERT denial."
```

---

## Phase 2 — Client helpers

### Task 7: Unit test for error-parser helpers

**Files:**
- Create: `tests/po-conversion-error-parser.test.ts`

**What and why:** `isAlreadyConvertedError` and `extractPoIdsFromConversionError` are pure functions — exactly the shape the project tests with `node --test`. Write the test first (TDD); make it fail; implement.

- [ ] **Step 1: Write the failing test**

Create `tests/po-conversion-error-parser.test.ts`:

```ts
// Stub env vars before imports (pattern from tests/quote-report-data.test.ts).
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.test'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'service-role-key'

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isAlreadyConvertedError,
  extractPoIdsFromConversionError,
} from '../lib/client/purchase-order-drafts'

test('isAlreadyConvertedError detects P0003', () => {
  const err = { code: 'P0003', message: 'anything', details: '{}' }
  assert.equal(isAlreadyConvertedError(err), true)
})

test('isAlreadyConvertedError rejects other codes', () => {
  for (const code of ['P0001', 'P0002', '42501', undefined]) {
    assert.equal(isAlreadyConvertedError({ code, message: '', details: '' }), false)
  }
})

test('isAlreadyConvertedError tolerates non-object input', () => {
  assert.equal(isAlreadyConvertedError(null), false)
  assert.equal(isAlreadyConvertedError(undefined), false)
  assert.equal(isAlreadyConvertedError('string error'), false)
})

test('extractPoIdsFromConversionError parses integer[] from details JSON', () => {
  const err = {
    code: 'P0003',
    message: 'already converted',
    details: JSON.stringify({ purchase_order_ids: [42, 43, 44] }),
  }
  assert.deepEqual(extractPoIdsFromConversionError(err), [42, 43, 44])
})

test('extractPoIdsFromConversionError returns empty array for malformed details', () => {
  assert.deepEqual(extractPoIdsFromConversionError({ code: 'P0003', details: 'not-json' }), [])
  assert.deepEqual(extractPoIdsFromConversionError({ code: 'P0003', details: '{}' }), [])
  assert.deepEqual(extractPoIdsFromConversionError({ code: 'P0003', details: undefined }), [])
  assert.deepEqual(extractPoIdsFromConversionError(null), [])
})
```

- [ ] **Step 2: Run to confirm it fails**

Run:
```bash
npx tsx --test tests/po-conversion-error-parser.test.ts
```
Expected: FAIL with `SyntaxError` or module-not-found on the exports — the functions don't exist yet.

- [ ] **Step 3: Implement the helpers**

Append to `lib/client/purchase-order-drafts.ts` (before the final newline):

```ts
type SupabaseLikeError = { code?: string; message?: string; details?: unknown };

function isSupabaseLikeError(v: unknown): v is SupabaseLikeError {
  return typeof v === 'object' && v !== null;
}

export function isAlreadyConvertedError(err: unknown): boolean {
  return isSupabaseLikeError(err) && err.code === 'P0003';
}

export function extractPoIdsFromConversionError(err: unknown): number[] {
  if (!isSupabaseLikeError(err)) return [];
  const details = err.details;
  if (typeof details !== 'string') return [];
  try {
    const parsed = JSON.parse(details) as { purchase_order_ids?: unknown };
    const ids = parsed.purchase_order_ids;
    if (!Array.isArray(ids)) return [];
    return ids.filter((n): n is number => typeof n === 'number');
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run to confirm it passes**

Run:
```bash
npx tsx --test tests/po-conversion-error-parser.test.ts
```
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/po-conversion-error-parser.test.ts lib/client/purchase-order-drafts.ts
git commit -m "feat(po-drafts): add P0003 error parsers + unit tests

Pure helpers for detecting the already-converted RPC error and
extracting the embedded purchase_order_ids from details JSON.
Covers all defensive branches (non-object input, malformed JSON,
wrong shape). Run: npx tsx --test tests/po-conversion-error-parser.test.ts"
```

---

### Task 8: Add `getCurrentOrgId` and `reconcileDraftConversion` helpers

**Files:**
- Modify: `lib/client/purchase-order-drafts.ts`

**What and why:** `getCurrentOrgId` is required by Task 9's fetch scoping fix (P2 from Codex review). `reconcileDraftConversion` is the thin wrapper used by both the sticky toast Retry button and the Finalize modal.

- [ ] **Step 1: Append helpers**

Append to `lib/client/purchase-order-drafts.ts`:

```ts
// Per-session cache of current org id. Invalidated on sign-out is implicit
// because the module is reloaded; we do NOT cache across logins.
let cachedOrgId: string | null = null;

export async function getCurrentOrgId(): Promise<string | null> {
  if (cachedOrgId) return cachedOrgId;
  const { data, error } = await supabase.rpc('current_org_id');
  if (error) {
    console.error('[po-drafts] current_org_id RPC failed:', error);
    return null;
  }
  cachedOrgId = (typeof data === 'string' ? data : null) ?? null;
  return cachedOrgId;
}

export async function reconcileDraftConversion(draftId: number): Promise<{
  reconciled: boolean;
  purchaseOrderIds: number[];
}> {
  const { data, error } = await supabase.rpc('reconcile_draft_conversion', {
    p_draft_id: draftId,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    reconciled: Boolean(row?.reconciled),
    purchaseOrderIds: Array.isArray(row?.purchase_order_ids)
      ? (row.purchase_order_ids as number[])
      : [],
  };
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: no new errors introduced by this file.

- [ ] **Step 3: Commit**

```bash
git add lib/client/purchase-order-drafts.ts
git commit -m "feat(po-drafts): add getCurrentOrgId + reconcileDraftConversion

getCurrentOrgId caches the current_org_id() RPC result per session.
reconcileDraftConversion is the thin wrapper used by the sticky toast
Retry action and the Needs review Finalize button."
```

---

### Task 9: Scope draft fetches to `current_org_id()` + embed nested ledger

**Files:**
- Modify: `lib/client/purchase-order-drafts.ts`

**What and why:** Codex P2 finding — action paths use `current_org_id()` but the fetch uses the broader `organization_members` RLS. Tighten the fetch to match. Also embed `purchase_order_draft_conversions (purchase_order_id)` in the select so the client can compute `has_ledger_rows` without a second round-trip.

- [ ] **Step 1: Extend `DRAFT_SELECT_COLUMNS` to embed ledger**

Replace the constant in `lib/client/purchase-order-drafts.ts`:

```ts
const DRAFT_SELECT_COLUMNS = `
  draft_id,
  org_id,
  title,
  order_date,
  notes,
  status,
  version,
  created_by,
  updated_by,
  locked_by,
  locked_at,
  converted_at,
  converted_purchase_order_ids,
  created_at,
  updated_at,
  purchase_order_draft_lines (
    draft_line_id,
    sort_order,
    component_id,
    supplier_component_id,
    quantity,
    customer_order_id,
    allocations,
    notes
  ),
  purchase_order_draft_conversions (
    purchase_order_id
  )
`;
```

- [ ] **Step 2: Extend `PurchaseOrderDraftRow` and `mapDraftRowToDraft`**

Add `purchase_order_draft_conversions` to the row type near the top of the file:

```ts
type PurchaseOrderDraftRow = {
  // ... existing fields unchanged ...
  purchase_order_draft_conversions?: Array<{ purchase_order_id: number }> | null;
};
```

Update `mapDraftRowToDraft` to read it (note: per CLAUDE.md RLS nested embeds may be null):

```ts
function mapDraftRowToDraft(row: PurchaseOrderDraftRow): PurchaseOrderDraft {
  const lines = /* unchanged */;

  const conversionPoIds = (row.purchase_order_draft_conversions ?? [])
    .map((r) => r.purchase_order_id)
    .filter((id): id is number => typeof id === 'number');

  return {
    // ... existing fields unchanged ...
    lines,
    conversion_po_ids: conversionPoIds,
  };
}
```

- [ ] **Step 3: Extend the `PurchaseOrderDraft` type**

Edit `types/purchasing.ts` (or whichever module declares the type). Find the `PurchaseOrderDraft` interface and add:

```ts
export interface PurchaseOrderDraft {
  // ... existing fields ...
  conversion_po_ids: number[];
}
```

If the `types/purchasing.ts` path isn't right, grep first: `grep -n "interface PurchaseOrderDraft\|type PurchaseOrderDraft " types/ lib/`.

- [ ] **Step 4: Scope both fetches to current org**

Replace `fetchPurchaseOrderDrafts`:

```ts
export async function fetchPurchaseOrderDrafts(): Promise<PurchaseOrderDraft[]> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return [];

  const { data, error } = await supabase
    .from('purchase_order_drafts')
    .select(DRAFT_SELECT_COLUMNS)
    .eq('status', 'draft')
    .eq('org_id', orgId)
    .order('updated_at', { ascending: false })
    .limit(20);

  if (error) throw new Error(error.message);
  return ((data ?? []) as PurchaseOrderDraftRow[]).map(mapDraftRowToDraft);
}
```

Replace `fetchPurchaseOrderDraftById`:

```ts
export async function fetchPurchaseOrderDraftById(
  draftId: number
): Promise<PurchaseOrderDraft | null> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return null;

  const { data, error } = await supabase
    .from('purchase_order_drafts')
    .select(DRAFT_SELECT_COLUMNS)
    .eq('draft_id', draftId)
    .eq('org_id', orgId)
    .eq('status', 'draft')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return mapDraftRowToDraft(data as PurchaseOrderDraftRow);
}
```

- [ ] **Step 5: Run typecheck**

```bash
npx tsc --noEmit
```
Expected: any remaining errors are pre-existing and not from this change. New errors in `new-purchase-order-form.tsx` referencing `conversion_po_ids` are expected and will be resolved in later tasks.

- [ ] **Step 6: Commit**

```bash
git add lib/client/purchase-order-drafts.ts types/purchasing.ts
git commit -m "feat(po-drafts): scope draft fetch to current_org_id + embed ledger

Tightens both fetchPurchaseOrderDrafts and fetchPurchaseOrderDraftById
to filter by org_id = current_org_id() (Codex P2). Action paths
already use current_org_id(); without this scope fix, a multi-org
user could see drafts the server would refuse to finalize.

DRAFT_SELECT_COLUMNS now embeds purchase_order_draft_conversions
(purchase_order_id). Mapped to conversion_po_ids on the draft model."
```

---

## Phase 3 — Submit-path rewrites

### Task 10: Thread `{ draftId, conversionToken }` through local `createPurchaseOrder`

**Files:**
- Modify: `components/features/purchasing/new-purchase-order-form.tsx` (function at line 268)

**What and why:** The local helper currently uses `Promise.all` to fan out supplier RPCs. Two changes: accept an optional conversion context, and switch to serial `for...of` so failures short-circuit predictably and the `FOR UPDATE` draft-row lock never creates wait contention across our own concurrent calls.

- [ ] **Step 1: Update the `createPurchaseOrder` signature and body**

Replace the function at `components/features/purchasing/new-purchase-order-form.tsx:268-363` with:

```ts
type ConversionContext = { draftId: number; conversionToken: string };

async function createPurchaseOrder(
  formData: PurchaseOrderFormData,
  statusId: number,
  supplierComponentsCache: Map<number, SupplierComponentFromAPI[]> = new Map(),
  conversion?: ConversionContext
): Promise<PurchaseOrderCreationResult[]> {
  const itemsBySupplier = new Map<
    number,
    Array<{
      supplier_component_id: number;
      quantity: number;
      component_id: number;
      customer_order_id?: number | null;
      allocations?: { customer_order_id: number; quantity: number }[];
      notes?: string;
    }>
  >();

  formData.items.forEach((item) => {
    const supplierOptions = supplierComponentsCache.get(item.component_id) || [];
    const supplierComponent = supplierOptions.find(
      (c) => c.supplier_component_id === item.supplier_component_id
    );
    if (!supplierComponent) {
      throw new Error(
        `Missing supplier data for component ${item.component_id}. Refresh suppliers and try again.`
      );
    }
    if (!supplierComponent.supplier_id) {
      throw new Error(
        `Supplier selection is missing its supplier reference for component ${item.component_id}.`
      );
    }
    if (!itemsBySupplier.has(supplierComponent.supplier_id)) {
      itemsBySupplier.set(supplierComponent.supplier_id, []);
    }
    itemsBySupplier.get(supplierComponent.supplier_id)?.push({
      supplier_component_id: item.supplier_component_id,
      quantity: item.quantity,
      component_id: item.component_id,
      customer_order_id: item.customer_order_id,
      allocations: item.allocations,
      notes: item.notes,
    });
  });

  const orderDateISO = formData.order_date
    ? new Date(formData.order_date).toISOString()
    : new Date().toISOString();

  const results: PurchaseOrderCreationResult[] = [];

  for (const [supplierId, items] of Array.from(itemsBySupplier.entries())) {
    const lineItems: SupplierOrderLinePayload[] = items.map((item) =>
      buildLinePayload(item)
    );

    const rpcArgs: Record<string, unknown> = {
      supplier_id: supplierId,
      line_items: lineItems,
      status_id: statusId,
      order_date: orderDateISO,
      notes: formData.notes ?? '',
    };
    if (conversion) {
      rpcArgs.p_draft_id = conversion.draftId;
      rpcArgs.p_conversion_token = conversion.conversionToken;
    }

    const { data, error: rpcError } = await supabase.rpc(
      'create_purchase_order_with_lines',
      rpcArgs
    );

    if (rpcError) {
      console.error('Error creating purchase order via RPC:', rpcError);
      throw rpcError;
    }

    const rpcResult = Array.isArray(data) ? data?.[0] : data;
    if (!rpcResult || typeof rpcResult.purchase_order_id !== 'number') {
      console.error('Unexpected RPC response when creating purchase order:', data);
      throw new Error('Failed to create purchase order');
    }

    results.push({
      purchase_order_id: rpcResult.purchase_order_id,
      supplier_order_ids: rpcResult.supplier_order_ids ?? [],
    });
  }

  return results;
}
```

Note two differences from the old body: (1) re-throw the raw `rpcError` so downstream can parse `code` / `details` — the old code wrapped it as `Error('Failed to create purchase order')` and lost the structured error; (2) serial `for...of` replaces `Promise.all`.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add components/features/purchasing/new-purchase-order-form.tsx
git commit -m "refactor(purchasing): thread conversion context through createPurchaseOrder

- Accept optional {draftId, conversionToken}; pass as p_draft_id /
  p_conversion_token to create_purchase_order_with_lines.
- Fan-out is now serial (for...of) instead of Promise.all: predictable
  failure ordering and no DB-side queuing on FOR UPDATE lock.
- Re-throw the raw rpcError so callers can parse .code / .details
  (previously wrapped as a generic Error, losing P0003 detection)."
```

---

### Task 11: Submit-mutation rewrite — single-supplier path

**Files:**
- Modify: `components/features/purchasing/new-purchase-order-form.tsx` (area around line 1455-1493 and nearby helpers)

**What and why:** Generate a `conversionToken` ref. Pass the context into `createPurchaseOrder`. In `onSuccess`, when `setCurrentDraftStatus('converted', ...)` throws, show the sticky Retry toast instead of silently `.catch(console.error)`. In `onError`, detect P0003 and show the already-converted dialog.

- [ ] **Step 1: Add imports and refs near the top of the component**

Find the top of the component function (look for `function NewPurchaseOrderForm` or `export default function`). Add to its import block near the existing imports:

```ts
import { toast } from 'sonner';
import {
  isAlreadyConvertedError,
  extractPoIdsFromConversionError,
  reconcileDraftConversion,
} from '@/lib/client/purchase-order-drafts';
```

Inside the component body, near other `useRef`/`useState` declarations, add:

```ts
const submitTokenRef = useRef<string | null>(null);
const ensureSubmitToken = () => {
  if (!submitTokenRef.current) submitTokenRef.current = crypto.randomUUID();
  return submitTokenRef.current;
};
const clearSubmitToken = () => { submitTokenRef.current = null; };

const [alreadyConvertedPoIds, setAlreadyConvertedPoIds] = useState<number[] | null>(null);
```

- [ ] **Step 2: Rewrite the mutation**

Replace the current `createOrderMutation` block (`new-purchase-order-form.tsx:1455-1493`) with:

```ts
const createOrderMutation = useMutation({
  mutationFn: async (data: PurchaseOrderFormData) => {
    if (!draftStatusId) throw new Error('Failed to get draft status');

    const draftId = currentDraftIdRef.current ?? null;
    const token = draftId ? ensureSubmitToken() : null;

    const results = await createPurchaseOrder(
      data,
      draftStatusId,
      supplierComponentsMap ?? new Map(),
      draftId && token ? { draftId, conversionToken: token } : undefined
    );

    // PO creation succeeded. Try to flip the draft status.
    if (draftId) {
      try {
        await setCurrentDraftStatus(
          'converted',
          results.map((r) => r.purchase_order_id)
        );
        clearSubmitToken();
      } catch (statusError) {
        console.error('[po-drafts] Status flip failed after PO create:', statusError);
        showFinalizationPendingToast({
          draftId,
          purchaseOrderIds: results.map((r) => r.purchase_order_id),
        });
        // Token stays live so the Retry action can reconcile with the same context.
      }
    }

    return results;
  },
  onSuccess: (results) => {
    queryClient.invalidateQueries({ queryKey: ['purchaseOrders'] });
    queryClient.invalidateQueries({ queryKey: ['purchasing-dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['purchaseOrderDrafts'] });

    const count = Array.isArray(results) ? results.length : 0;
    if (count > 1) router.push('/purchasing?filter=pending');
    else if (count === 1) router.push(`/purchasing/purchase-orders/${results[0].purchase_order_id}`);
    else router.push('/purchasing?filter=pending');
  },
  onError: (error: unknown) => {
    if (isAlreadyConvertedError(error)) {
      const poIds = extractPoIdsFromConversionError(error);
      setAlreadyConvertedPoIds(poIds);
      // Do not setError/toast — the modal renders the message.
      return;
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    setError(message);
    toast.error(`Failed to create purchase order: ${message}`, { duration: 8000 });
  },
});
```

- [ ] **Step 3: Add `showFinalizationPendingToast` helper inside the component**

Near the other helper functions inside the component body:

```ts
const showFinalizationPendingToast = ({
  draftId,
  purchaseOrderIds,
}: {
  draftId: number;
  purchaseOrderIds: number[];
}) => {
  const idsCopy = purchaseOrderIds.slice();
  toast(`Draft cleanup pending`, {
    id: `finalize-pending-${draftId}`,
    duration: Infinity,
    description: `Purchase order(s) #${idsCopy.join(', #')} were created. Draft finalization didn't complete.`,
    action: {
      label: 'Retry cleanup',
      onClick: async () => {
        try {
          await reconcileDraftConversion(draftId);
          clearSubmitToken();
          toast.dismiss(`finalize-pending-${draftId}`);
          queryClient.invalidateQueries({ queryKey: ['purchaseOrderDrafts'] });
          toast.success('Draft finalized.');
        } catch (e) {
          toast.error('Retry failed — try again in a moment.');
        }
      },
    },
  });
};
```

- [ ] **Step 4: Render the already-converted dialog**

Near the bottom of the JSX return (adjacent to other dialogs/modals), add:

```tsx
{alreadyConvertedPoIds !== null && (
  <AlertDialog open onOpenChange={(open) => !open && setAlreadyConvertedPoIds(null)}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Draft already converted</AlertDialogTitle>
        <AlertDialogDescription>
          This draft was already converted to purchase order
          {alreadyConvertedPoIds.length === 1 ? '' : 's'}{' '}
          {alreadyConvertedPoIds.map((id, i) => (
            <span key={id}>
              {i > 0 ? ', ' : ''}
              <a className="underline" href={`/purchasing/purchase-orders/${id}`}>#{id}</a>
            </span>
          ))}
          .
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogAction onClick={() => setAlreadyConvertedPoIds(null)}>Close</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)}
```

Confirm the file already imports `AlertDialog*` components; if not, add them from `@/components/ui/alert-dialog`.

- [ ] **Step 5: Typecheck and lint**

```bash
npx tsc --noEmit
npm run lint -- components/features/purchasing/new-purchase-order-form.tsx
```

- [ ] **Step 6: Commit**

```bash
git add components/features/purchasing/new-purchase-order-form.tsx
git commit -m "feat(purchasing): token-gated submit + partial-success sticky toast

- submitTokenRef ensures a stable conversion_token per logical attempt.
- Status-flip failure now surfaces a sticky 'Draft cleanup pending'
  toast with a Retry button that calls reconcile_draft_conversion.
  Previously swallowed by .catch(console.error).
- P0003 on the RPC opens an 'already converted' dialog linking to the
  existing POs, instead of a generic error toast."
```

---

### Task 12: Consolidation path — thread conversion context

**Files:**
- Modify: `components/features/purchasing/new-purchase-order-form.tsx:1614-1691` (inside `handleConsolidationConfirm`)

**What and why:** The consolidation path calls `create_purchase_order_with_lines` and `add_lines_to_purchase_order` directly (bypasses the local `createPurchaseOrder` helper). Same treatment: pass `p_draft_id`/`p_conversion_token`, split status-flip from PO creation, handle P0003.

- [ ] **Step 1: Rewrite the per-supplier loop to pass conversion context**

In `new-purchase-order-form.tsx:1614-1660`, update both RPC call sites. Before the loop, add:

```ts
const draftId = currentDraftIdRef.current ?? null;
const token = draftId ? ensureSubmitToken() : null;
```

Inside the loop, for the `add_lines_to_purchase_order` branch (~line 1624):

```ts
const addArgs: Record<string, unknown> = {
  target_purchase_order_id: decision,
  line_items: lineItems,
};
if (draftId && token) {
  addArgs.p_draft_id = draftId;
  addArgs.p_conversion_token = token;
}

const { data, error: rpcError } = await supabase.rpc('add_lines_to_purchase_order', addArgs);
```

For the `create_purchase_order_with_lines` branch (~line 1639):

```ts
const createArgs: Record<string, unknown> = {
  supplier_id: supplierId,
  line_items: lineItems,
  status_id: draftStatusId,
  order_date: orderDateISO,
  notes: pendingFormData.notes ?? '',
};
if (draftId && token) {
  createArgs.p_draft_id = draftId;
  createArgs.p_conversion_token = token;
}

const { data, error: rpcError } = await supabase.rpc('create_purchase_order_with_lines', createArgs);
```

- [ ] **Step 2: Replace the swallowed status-flip with toast-on-failure**

In the `handleConsolidationConfirm` tail block (currently `new-purchase-order-form.tsx:1686-1691`), replace:

```ts
await setCurrentDraftStatus(
  'converted',
  results.map((result) => result.purchase_order_id)
).catch((draftError) => {
  console.error('Failed to mark purchase-order draft converted:', draftError);
});
```

With:

```ts
if (draftId) {
  try {
    await setCurrentDraftStatus(
      'converted',
      results.map((result) => result.purchase_order_id)
    );
    clearSubmitToken();
  } catch (statusError) {
    console.error('[po-drafts] Status flip failed after consolidation:', statusError);
    showFinalizationPendingToast({
      draftId,
      purchaseOrderIds: results.map((r) => r.purchase_order_id),
    });
  }
}
```

- [ ] **Step 3: Add P0003 handling to the try/catch around the loop**

Find the `try/catch` around `handleConsolidationConfirm` (outer block at ~line 1705). Replace the generic `catch (err)` with:

```ts
} catch (err) {
  if (isAlreadyConvertedError(err)) {
    const poIds = extractPoIdsFromConversionError(err);
    setAlreadyConvertedPoIds(poIds);
    toast.dismiss(toastId);
    return;
  }
  console.error('Error in consolidation:', err);
  toast.error('Failed to create purchase orders', { id: toastId });
}
```

- [ ] **Step 4: Typecheck and lint**

```bash
npx tsc --noEmit
npm run lint -- components/features/purchasing/new-purchase-order-form.tsx
```

- [ ] **Step 5: Commit**

```bash
git add components/features/purchasing/new-purchase-order-form.tsx
git commit -m "feat(purchasing): thread conversion context through consolidation path

- handleConsolidationConfirm now generates/reuses submitTokenRef and
  passes p_draft_id + p_conversion_token to both RPC call sites.
- Same status-flip failure handling as the single-supplier path: sticky
  Retry toast instead of .catch(console.error).
- Same P0003 dialog handling as single-supplier path."
```

---

## Phase 4 — Needs review UX

### Task 13: Compute `has_ledger_rows` and split drafts dropdown

**Files:**
- Modify: `components/features/purchasing/new-purchase-order-form.tsx` (drafts dropdown area)

**What and why:** Drafts where `status='draft'` but `conversion_po_ids.length > 0` must surface in a separate Needs review section. Per spec §5.4: status 'converted' is hidden entirely; draft + has_ledger_rows=true is Needs review; draft + no ledger is Active.

- [ ] **Step 1: Locate the drafts dropdown**

Grep in the file:

```bash
grep -n "purchaseOrderDrafts\|DraftsDropdown\|draftsQuery\|SelectDraft" components/features/purchasing/new-purchase-order-form.tsx
```

Identify the component block that renders the drafts list (typically a `Select`, `Popover + Command`, or radix dropdown around 10-30 lines long).

- [ ] **Step 2: Compute the split from the draft list**

Near the query/dropdown block, compute:

```ts
const activeDrafts = (draftsQuery.data ?? []).filter(
  (d) => (d.conversion_po_ids?.length ?? 0) === 0
);
const needsReviewDrafts = (draftsQuery.data ?? []).filter(
  (d) => (d.conversion_po_ids?.length ?? 0) > 0
);
```

(Replace `draftsQuery` with whatever the current hook/local variable is named.)

- [ ] **Step 3: Render two sections in the dropdown**

Inside the existing dropdown body, wrap items in two labeled groups. With `@/components/ui/command` (most drafts use it):

```tsx
<Command>
  <CommandInput placeholder="Search drafts…" />
  <CommandList>
    {activeDrafts.length === 0 && needsReviewDrafts.length === 0 && (
      <CommandEmpty>No drafts</CommandEmpty>
    )}
    {activeDrafts.length > 0 && (
      <CommandGroup heading="Active drafts">
        {activeDrafts.map((d) => (
          <CommandItem key={d.draft_id} onSelect={() => openDraft(d.draft_id)}>
            {d.title || `Draft #${d.draft_id}`}
          </CommandItem>
        ))}
      </CommandGroup>
    )}
    {needsReviewDrafts.length > 0 && (
      <CommandGroup heading="Needs review">
        {needsReviewDrafts.map((d) => (
          <CommandItem key={d.draft_id} onSelect={() => openDraft(d.draft_id)}>
            <span className="flex-1">{d.title || `Draft #${d.draft_id}`}</span>
            <span className="text-xs text-muted-foreground">
              {d.conversion_po_ids.length} PO{d.conversion_po_ids.length === 1 ? '' : 's'}
            </span>
          </CommandItem>
        ))}
      </CommandGroup>
    )}
  </CommandList>
</Command>
```

If the dropdown uses Radix Select instead of Command, wrap each section in `SelectGroup` + `SelectLabel`.

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add components/features/purchasing/new-purchase-order-form.tsx
git commit -m "feat(purchasing): split drafts dropdown into Active / Needs review

Drafts with conversion ledger rows but status='draft' now appear in
a separate 'Needs review' section with a PO count badge. 'Converted'
drafts are already hidden by the status='draft' filter at the fetch."
```

---

### Task 14: Needs review banner on form mount + Finalize modal

**Files:**
- Modify: `components/features/purchasing/new-purchase-order-form.tsx`

**What and why:** When opening a draft with ledger rows (cross-reload recovery), show a banner explaining the state and offering a Finalize action. No `Needs support` button this branch (spec §5.4 defers storage design).

- [ ] **Step 1: Add banner rendering near the top of the form JSX**

Find where the draft is loaded into state (search for `setCurrentDraftId` or `currentDraft`). Near the form's top-level JSX (before the `<form>` or at the top of the form's content area), add:

```tsx
{currentDraft?.conversion_po_ids && currentDraft.conversion_po_ids.length > 0 && (
  <div className="rounded-sm border border-amber-500/40 bg-amber-500/10 p-3 mb-3">
    <p className="text-sm font-medium">This draft started conversion.</p>
    <p className="text-xs text-muted-foreground mt-1">
      Purchase order(s){' '}
      {currentDraft.conversion_po_ids.map((id, i) => (
        <span key={id}>
          {i > 0 ? ', ' : ''}
          <a className="underline" href={`/purchasing/purchase-orders/${id}`}>#{id}</a>
        </span>
      ))}{' '}
      were created from it. Review whether all intended POs were created before
      finalizing.
    </p>
    <p className="text-xs text-muted-foreground mt-2">
      Recorded: {currentDraft.conversion_po_ids.length}{' '}
      operation{currentDraft.conversion_po_ids.length === 1 ? '' : 's'} •
      Expected from draft lines: {currentDraft.lines?.length ?? 0}
    </p>
    <div className="mt-3">
      <Button
        type="button"
        size="sm"
        onClick={() => setFinalizeOpen(true)}
      >
        Finalize draft
      </Button>
    </div>
  </div>
)}
```

`currentDraft` is whichever local variable/ref holds the loaded draft object — adjust the name to match.

- [ ] **Step 2: Add Finalize confirm modal state + render**

Near other `useState` declarations:

```ts
const [finalizeOpen, setFinalizeOpen] = useState(false);
const [finalizing, setFinalizing] = useState(false);
```

Add the modal JSX near the other dialogs:

```tsx
<AlertDialog open={finalizeOpen} onOpenChange={setFinalizeOpen}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Finalize this draft?</AlertDialogTitle>
      <AlertDialogDescription>
        I verified all intended purchase orders were created from this draft.
        After finalizing, the draft moves out of the Needs review section.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel disabled={finalizing}>Cancel</AlertDialogCancel>
      <AlertDialogAction
        disabled={finalizing}
        onClick={async (e) => {
          e.preventDefault();
          if (!currentDraft?.draft_id) return;
          setFinalizing(true);
          try {
            await reconcileDraftConversion(currentDraft.draft_id);
            toast.success('Draft finalized.');
            queryClient.invalidateQueries({ queryKey: ['purchaseOrderDrafts'] });
            setFinalizeOpen(false);
            router.push('/purchasing/purchase-orders/new');
          } catch (err) {
            toast.error('Failed to finalize — try again.');
          } finally {
            setFinalizing(false);
          }
        }}
      >
        {finalizing ? 'Finalizing…' : 'Yes, finalize'}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit
npm run lint -- components/features/purchasing/new-purchase-order-form.tsx
```

- [ ] **Step 4: Commit**

```bash
git add components/features/purchasing/new-purchase-order-form.tsx
git commit -m "feat(purchasing): Needs review banner + Finalize modal

On draft mount with ledger rows, show a banner listing the existing
POs and a Finalize button. Confirm modal calls
reconcile_draft_conversion(draft_id) which flips status='converted'
and populates converted_purchase_order_ids.

No Needs support button — spec defers that design."
```

---

### Task 15: Read-only gating + autosave suppression on ledger rows

**Files:**
- Modify: `components/features/purchasing/new-purchase-order-form.tsx`

**What and why:** A draft that has ledger rows is no longer editable — either fully converted (hidden from the list) or awaiting Finalize. Lock all inputs and disable the submit button. Also suppress autosave to avoid save races on a materialized draft (spec §5.5).

- [ ] **Step 1: Compute the read-only flag**

Near the component top:

```ts
const isReadOnlyDraft = Boolean(
  currentDraft?.status === 'converted' ||
  (currentDraft?.conversion_po_ids && currentDraft.conversion_po_ids.length > 0)
);
```

- [ ] **Step 2: Guard the submit button**

Find the submit button in the JSX (typically `<Button type="submit"` or the react-hook-form handler). Add `disabled={isReadOnlyDraft || /* existing */}`. If the button already has a disabled expression, wrap: `disabled={isReadOnlyDraft || existingDisabled}`.

- [ ] **Step 3: Guard input/row editing**

Locate the react-hook-form `Controller`/`register` calls in the line-item editor. Pass `disabled={isReadOnlyDraft}` or use react-hook-form's `useFormContext` flag. For the add/remove row buttons: `disabled={isReadOnlyDraft}`.

If the form uses `<fieldset>`, the simplest change is to wrap the line-items section in:

```tsx
<fieldset disabled={isReadOnlyDraft} className={isReadOnlyDraft ? 'opacity-70 pointer-events-none' : ''}>
  {/* existing line items JSX */}
</fieldset>
```

- [ ] **Step 4: Suppress autosave**

Locate the autosave effect (grep: `savePurchaseOrderDraft\|useAutoSave\|autosave`). Add a guard at the top of the effect callback:

```ts
useEffect(() => {
  if (isReadOnlyDraft) return; // spec §5.5: no autosave on materialized drafts
  // ... existing autosave logic ...
}, [/* existing deps */, isReadOnlyDraft]);
```

- [ ] **Step 5: Typecheck and lint**

```bash
npx tsc --noEmit
npm run lint -- components/features/purchasing/new-purchase-order-form.tsx
```

- [ ] **Step 6: Commit**

```bash
git add components/features/purchasing/new-purchase-order-form.tsx
git commit -m "feat(purchasing): lock the form when a draft has ledger rows

- Disable line-item editing, add/remove rows, submit button.
- Suppress autosave — prevents save races on a materialized draft.
- Gate triggered by status='converted' OR conversion_po_ids.length > 0."
```

---

## Phase 5 — Verification

### Task 16: Lint and typecheck

- [ ] **Step 1: Full lint pass**

```bash
npm run lint
```
Expected: clean, or only pre-existing warnings outside the files this branch touches.

- [ ] **Step 2: Full type check**

```bash
npx tsc --noEmit
```
Expected: clean, or only pre-existing errors outside the files this branch touches. If unrelated errors exist, note them in the next commit message.

- [ ] **Step 3: Re-run the error-parser unit test**

```bash
npx tsx --test tests/po-conversion-error-parser.test.ts
```
Expected: 5/5 pass.

- [ ] **Step 4: If any failures, fix and re-run**

No commit at this step unless fixes were needed. If fixes are needed, commit as `fix(purchasing): <specific issue>`.

---

### Task 17: Browser smoke via Claude in Chrome

**Files:** none (manual / mcp-driven)

**What and why:** Per CLAUDE.md verification policy, UI work is confirmed in the browser. Cover the golden path + the partial-success path + the Needs review path. Test account: `testai@qbutton.co.za` / `ClaudeTest2026!` on QButton.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev -- --port 3000
```
(Run in background; the CLAUDE.md notes Turbopack+Tailwind can crash the machine, so prefer `--webpack` flag if available: `npm run dev -- --webpack --port 3000`.)

- [ ] **Step 2: Log in via Claude in Chrome**

Use `mcp__claude-in-chrome__tabs_context_mcp` first. Navigate to `http://localhost:3000`. If redirected to login, fill in testai@qbutton.co.za / ClaudeTest2026!.

- [ ] **Step 3: Smoke — happy path single-supplier**

- Navigate to `/purchasing/purchase-orders/new`.
- Add one line item with a valid supplier component + quantity.
- Click Create Purchase Order.
- Expect: redirect to `/purchasing/purchase-orders/<id>`. Back to `/purchasing/purchase-orders/new` — the draft is no longer in the Active drafts list.
- Verify in DB: `SELECT count(*) FROM purchase_order_draft_conversions WHERE created_by = <testai_user_id> AND created_at >= now() - interval '5 minutes';` → returns 1.

- [ ] **Step 4: Smoke — P0003 already converted**

- In DB: pick a draft that has a ledger row (from step 3). Manually reset its status to 'draft': `UPDATE purchase_order_drafts SET status='draft' WHERE draft_id = <id>;` (this simulates the phantom-state scenario).
- In the browser: open that draft via the Needs review section of the dropdown.
- Confirm: banner is shown with "This draft started conversion." text and the Finalize draft button.
- Confirm: form fields are disabled (read-only).
- Confirm: the dropdown shows the draft under "Needs review", not "Active drafts".

- [ ] **Step 5: Smoke — Finalize action**

- Click Finalize draft on the Needs review banner. Accept the confirm modal.
- Expect: toast "Draft finalized." and redirect to `/purchasing/purchase-orders/new` (fresh form).
- Verify in DB: `SELECT status, converted_purchase_order_ids FROM purchase_order_drafts WHERE draft_id = <id>;` → `converted`, array containing the PO from step 3.

- [ ] **Step 6: Smoke — already-converted dialog**

- Build a draft in a second tab. Save (autosave will pick it up).
- Open it in another tab so you have two sessions on the same draft.
- In tab A, submit. Draft converts.
- In tab B, attempt to submit the same draft (the page may need a reload to get fresh data if caches are stale).
- Expect: "Draft already converted" modal with linked PO number.

- [ ] **Step 7: Clean up**

Delete any leftover test POs / supplier_orders / ledger rows from the smoke (per memory `feedback_restore_test_data.md`):

```sql
DELETE FROM supplier_orders WHERE purchase_order_id IN (
  SELECT purchase_order_id FROM purchase_orders
   WHERE created_by = <testai_user_id> AND order_date >= now() - interval '30 minutes'
);
DELETE FROM purchase_orders WHERE created_by = <testai_user_id>
  AND order_date >= now() - interval '30 minutes';
-- ledger rows cascade via ON DELETE CASCADE on purchase_order_id FK.
```

Reset any test drafts that were manually flipped back to 'draft' in step 4 to their original state.

- [ ] **Step 8: Stop dev server**

Kill the background dev server process.

- [ ] **Step 9: Capture proof**

Take one screenshot each of: the Needs review dropdown section, the Finalize banner, and the already-converted dialog. Attach/reference in the final commit.

- [ ] **Step 10: Commit any smoke-triggered fixes**

If any smoke-driven issues were found, the fix commits should look like:
```bash
git commit -m "fix(purchasing): <specific smoke-driven issue>"
```

---

### Task 18: Run `/simplify` and Supabase security advisors

**Files:** the touched set

**What and why:** Per CLAUDE.md, run `/simplify` before PR close. Also run `mcp__supabase__get_advisors` since we added a new table.

- [ ] **Step 1: Run `/simplify`**

Invoke the `/simplify` slash command in-session. Accept the proposed simplifications if they're uncontroversial; reject any that change behavior.

- [ ] **Step 2: Supabase security advisor check**

Call `mcp__supabase__get_advisors` with type=`security`.

Expected: no new findings on `purchase_order_draft_conversions`. If the advisor flags missing RLS or public INSERT, re-check the migration.

- [ ] **Step 3: If advisor flags anything, fix and re-apply the migration chunk**

Fix the migration file, apply via MCP, commit as `fix(po-drafts): address advisor finding — <summary>`.

---

## Phase 6 — Rollout

### Task 19: Pre-deploy phantom drafts inventory

**Files:** none (runbook)

**What and why:** Per spec §7, pre-existing phantom drafts are a finite manual-cleanup backlog. Produce a list for the tenant ops contact before the migration lands in prod.

- [ ] **Step 1: Run the candidates query against prod**

Via `mcp__supabase__execute_sql`:

```sql
SELECT draft_id, org_id, title, updated_at, updated_by, created_by,
       jsonb_array_length(
         (SELECT coalesce(jsonb_agg(pol), '[]'::jsonb)
            FROM purchase_order_draft_lines pol
           WHERE pol.draft_id = pod.draft_id)
       ) AS line_count
  FROM purchase_order_drafts pod
 WHERE pod.status = 'draft'
   AND pod.updated_at < NOW() - INTERVAL '7 days'
 ORDER BY pod.updated_at DESC;
```

- [ ] **Step 2: Share the candidate list with the ops contact**

Send the output (draft_id, title, updated_at, line_count) to the user. The user decides per-row whether to archive manually via the existing Archive button, or leave it (e.g. legitimate long-running drafts).

- [ ] **Step 3: Record the handoff**

No commit. Note in the conversation that the runbook list was sent and the response deferred to operational follow-up.

---

### Task 20: Merge to `codex/integration` + deploy sequencing

**Files:** none (git + Supabase orchestration)

**What and why:** Per CLAUDE.md, `codex/integration` is the pre-release shared branch. Production deploy must put the migration live before the frontend. Old frontend against new backend is safe; new frontend against old backend is not.

- [ ] **Step 1: Rebase check against codex/integration**

```bash
git fetch origin codex/integration
git rebase origin/codex/integration
```
Expected: clean rebase, or minor conflicts resolved. If large conflicts appear, stop and evaluate.

- [ ] **Step 2: Merge to codex/integration**

```bash
git checkout codex/integration
git pull --ff-only origin codex/integration
git merge --no-ff codex/po-draft-conversion-ledger -m "merge: PO draft conversion ledger"
git push origin codex/integration
```

- [ ] **Step 3: Apply the migration on the prod Supabase branch**

Per CLAUDE.md Supabase MCP workflow: apply the migration to a Supabase branch, run the SQL test script from Task 6 against it, then merge to prod.

- [ ] **Step 4: Verify old frontend still works after migration**

Keep the current production frontend running. Hit `/purchasing/purchase-orders/new`, submit a test PO. New signature accepts NULL for the new params, so behavior should be identical.

- [ ] **Step 5: Deploy the frontend**

Standard Vercel deploy of `codex/integration` once the migration is live and verified. Smoke-check on prod immediately after.

- [ ] **Step 6: Post-deploy monitoring**

Watch for:
- Any P0001 in logs (client bug — should never fire normally).
- Spike in sticky "Draft cleanup pending" toasts (would indicate setCurrentDraftStatus is failing a lot — investigate).
- User reports of the Finalize modal being unexpected.

Set a one-week review horizon for Needs review state volume per spec §6.5.

---

## Self-review checklist (post-plan, pre-commit)

Before committing the plan:

- [ ] Every spec section §3 through §7 has at least one task covering it (table, RLS, helper, create RPC, add_lines RPC, reconcile RPC, error signaling, token lifecycle, submit path, sticky toast, Needs review, read-only, migration, runbook, deploy).
- [ ] No "TBD", "TODO", "fill in details", "handle edge cases" placeholders.
- [ ] Type and function names consistent: `getCurrentOrgId`, `isAlreadyConvertedError`, `extractPoIdsFromConversionError`, `reconcileDraftConversion`, `ensureSubmitToken`, `clearSubmitToken`, `showFinalizationPendingToast`, `conversion_po_ids`.
- [ ] SQLSTATE values consistent: P0001 / P0002 / P0003 map to the UX contract in spec §4.7.
- [ ] `operation_key` format is `create:supplier:<id>` for creates and `append:po:<id>` for appends — consistent across RPC bodies and test script.
- [ ] Deploy sequencing covered: migration first (Task 20 step 3), frontend after (Task 20 step 5).
- [ ] Rollback path thought through: the migration is additive (new table, new helper, new params with NULL defaults). The old frontend still works because it sends no new params.

## Open follow-ups (tracked, not in this plan)

- Durable completion metadata on drafts (spec §8 option A) — second design pass if Needs review state surfaces frequently.
- Single atomic "create POs + convert" RPC (spec §8 option C).
- Audit of every `RETURNS TABLE` PL/pgSQL function for column shadowing (per memory `feedback_plpgsql_returns_table_shadowing.md`).
- Needs support button implementation (storage shape unresolved).
- In-app navigation guard for Next.js router transitions.
- Restore the stashed breadcrumb edits to a separate short-lived branch (`app/products/[productId]/configurator/page.tsx`, `app/products/[productId]/cutlist-builder/page.tsx` — currently in `stash@{0}`).
