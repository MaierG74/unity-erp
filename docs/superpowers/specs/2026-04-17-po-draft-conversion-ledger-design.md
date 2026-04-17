# PO Draft Conversion Ledger — Design

**Status:** Approved design, awaiting implementation plan
**Date:** 2026-04-17
**Follow-up to:** commit `2b1546d` (PO draft recovery hardening + save RPC ambiguity fix)
**Target branch:** `codex/po-draft-conversion-ledger` (off `codex/integration`)

---

## 1. Problem

Users submit a purchase order draft on `/purchasing/purchase-orders/new`. The submit path:

1. Calls `create_purchase_order_with_lines` (and/or `add_lines_to_purchase_order` in the consolidation flow) per supplier, creating real POs.
2. Calls `set_purchase_order_draft_status('converted', [po_ids])` to flip the draft out of the active list.

The second call's failure is swallowed by `.catch((err) => console.error(err))` at `components/features/purchasing/new-purchase-order-form.tsx:1469` and `:1689`. On failure:

- POs exist in the database.
- The draft stays `status='draft'`, still appears in the shared drafts dropdown.
- The draft's localStorage backup may still be intact.
- **Any user in the org** (including the original submitter) can reopen the draft and click Create Purchase Order → **duplicate POs created**.

The primary correctness hole is not the swallow itself; it is the absence of a server-side idempotency guard tying draft → POs. The swallow surfaces the hole, but removing the swallow alone is not sufficient — a user who misses the warning toast can still resubmit and duplicate.

## 2. Scope

**In scope (A + B in the three-layer framing):**

- **A — Surface the partial-success state:** stop swallowing status-flip failures. Present a retryable sticky toast in the immediate-path case where all supplier RPCs succeeded and only the status flip failed.
- **B — Server-side idempotency guard:** record every materialization of a draft into the database, keyed by draft + operation. Reject any cross-submit attempt to materialize the same draft again.

**Deferred (C — follow-up design):**

- Single atomic RPC that does "create POs + convert draft" in one transaction. Cleanest long-term shape, but too large to bundle with this branch. Ledger + token design is a valid bridge.

**Deferred (follow-up after this branch ships):**

- Durable completion metadata for silent cross-reload auto-heal. See §6.2.
- "Needs support" flagging workflow. Design-noted; storage choice unresolved. Ship read-only + Finalize only in this branch.
- Audit pass on every `RETURNS TABLE` PL/pgSQL function in the codebase for the column-shadowing class. This design fixes one such incidental shadowing (see §4.5).
- In-app navigation guard for Next.js router transitions.

**Explicitly not covered:**

- Cleanup of pre-existing phantom drafts that were created by the bug this design prevents going forward. See §7.

## 3. Data model

### 3.1 New table

```sql
CREATE TABLE public.purchase_order_draft_conversions (
  draft_id            bigint   NOT NULL,
  operation_key       text     NOT NULL,
  purchase_order_id   integer  NOT NULL
                               REFERENCES public.purchase_orders(purchase_order_id)
                               ON DELETE CASCADE,
  conversion_token    uuid     NOT NULL,
  mode                text     NOT NULL CHECK (mode IN ('created','appended')),
  supplier_order_ids  integer[] NOT NULL DEFAULT '{}',
  org_id              uuid     NOT NULL DEFAULT public.current_org_id(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid     NOT NULL DEFAULT auth.uid(),
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
```

**Key shape notes:**

- **Primary key `(draft_id, operation_key)`.** This is the idempotency key. A same-op replay hits the unique constraint (or is intercepted in the RPC before we get that far) and returns the prior result without new business writes.
- **`operation_key` is RPC-derived, not client-provided.** Form: `'create:supplier:' || supplier_id` or `'append:po:' || target_purchase_order_id`. The client never constructs or passes it.
- **`conversion_token` is not unique.** Multiple ledger rows per submit share the same token.
- **`supplier_order_ids`** stored on the row so same-op replay can return the original array verbatim rather than doing a live lookup (which would pull in lines from unrelated later operations).
- **`mode`** distinguishes create-new from append-to-existing for audit and UX copy.
- **`org_id`** default via `public.current_org_id()`, FK via the composite `(draft_id, org_id)` pair against `purchase_order_drafts` — matches the existing house pattern.

### 3.2 RLS

Match the `purchase_order_drafts` pattern exactly — subquery against `organization_members` — not the shorter `org_id = public.current_org_id()` form. This keeps the ledger's row-access semantics aligned with its parent table (active membership, ban check included).

```sql
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

CREATE POLICY po_draft_conversions_insert_org_member
  ON public.purchase_order_draft_conversions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_members m
      WHERE m.user_id = auth.uid()
        AND m.org_id = purchase_order_draft_conversions.org_id
        AND m.is_active = true
        AND (m.banned_until IS NULL OR m.banned_until <= now())
    )
  );

-- No UPDATE policy. No DELETE policy. Ledger is append-only.
```

**Write path — main RPCs stay `SECURITY INVOKER`.** The existing `create_purchase_order_with_lines` and `add_lines_to_purchase_order` are invoker; this design keeps them that way. No `SECURITY DEFINER` helper needed for the ledger write. Three things combine to make this safe:

1. **RLS INSERT policy** (above) requires the caller to be an active member of `ledger.org_id`.
2. **FK constraint `(draft_id, org_id) → purchase_order_drafts(draft_id, org_id)`** ensures the draft actually belongs to the org the ledger row claims.
3. **`FOR UPDATE` lock on the draft row** (§4.2) confirms the caller already had read/lock-level access to that draft before any ledger write runs.

A forged write trying to claim a different org's draft fails at the FK. A write from a user who isn't a member of the stated org fails at the RLS check. A concurrent submit from a second user is serialized by the draft-row lock. None of these protections depend on elevated privilege — they're structural.

**Note on embedded reads:** the frontend fetches drafts via nested relation (`purchase_order_drafts.select('*, purchase_order_draft_conversions(...)')`). The SELECT policy above covers the embed; per house convention (`CLAUDE.md`), nested relations can still come back `null` under RLS denial. Client normalizes `conv ?? []`.

### 3.3 No changes to existing tables

`purchase_order_drafts`, `purchase_orders`, `supplier_orders` are all untouched. The existing `converted_purchase_order_ids bigint[]` column on drafts is preserved; `set_purchase_order_draft_status` still populates it atomically with the status flip.

## 4. RPC changes

### 4.1 Summary

| RPC | Change |
|---|---|
| `create_purchase_order_with_lines` | Add optional `p_draft_id bigint`, `p_conversion_token uuid`. Guard + ledger insert. |
| `add_lines_to_purchase_order` | Same additions. |
| `set_purchase_order_draft_status` | Unchanged. |
| `reconcile_draft_conversion` (new) | Reads ledger; calls status flip with its po_ids. `SECURITY INVOKER`. |

### 4.2 Guard block (inserted near the top of both modified RPCs)

```plpgsql
-- #variable_conflict use_column  (precaution against RETURNS TABLE shadowing;
--  see feedback_plpgsql_returns_table_shadowing memory)
IF (p_draft_id IS NULL) <> (p_conversion_token IS NULL) THEN
    RAISE EXCEPTION
      'p_draft_id and p_conversion_token must both be supplied or both be NULL'
      USING ERRCODE = 'P0001';
END IF;

IF p_draft_id IS NOT NULL THEN
    -- 1. Lock draft row, enforce tenancy.
    --    Intentionally serializes same-draft supplier RPCs; see §4.6.
    PERFORM 1 FROM public.purchase_order_drafts
     WHERE draft_id = p_draft_id
       AND org_id = public.current_org_id()
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Draft % not found in current org', p_draft_id
          USING ERRCODE = 'P0002';
    END IF;

    -- 2. Cross-submit rejection: any ledger rows with a different token?
    IF EXISTS (
        SELECT 1 FROM public.purchase_order_draft_conversions
         WHERE draft_id = p_draft_id
           AND conversion_token <> p_conversion_token
    ) THEN
        SELECT array_agg(DISTINCT purchase_order_id)
          INTO existing_po_ids
          FROM public.purchase_order_draft_conversions
         WHERE draft_id = p_draft_id;
        RAISE EXCEPTION 'Draft % already converted to PO(s) %', p_draft_id, existing_po_ids
          USING ERRCODE = 'P0003',
                DETAIL = json_build_object('purchase_order_ids', existing_po_ids)::text;
    END IF;

    -- 3. Per-operation idempotency: has this exact op already run?
    SELECT purchase_order_id, supplier_order_ids
      INTO existing_op_po_id, existing_op_supplier_order_ids
      FROM public.purchase_order_draft_conversions
     WHERE draft_id = p_draft_id
       AND operation_key = computed_operation_key;
    IF FOUND THEN
        -- Same op replayed: return prior result verbatim, no new writes.
        RETURN QUERY SELECT <replay return shape per RPC below>;
        RETURN;
    END IF;
END IF;

-- ... existing PO creation / line append logic runs here ...

-- Ledger insert AFTER successful business writes.
IF p_draft_id IS NOT NULL THEN
    INSERT INTO public.purchase_order_draft_conversions
        (draft_id, operation_key, purchase_order_id, conversion_token,
         mode, supplier_order_ids, org_id)
    VALUES (p_draft_id, computed_operation_key, new_purchase_order_id,
            p_conversion_token, <'created'|'appended'>, inserted_supplier_order_ids,
            public.current_org_id());
    -- PK enforces uniqueness; no ON CONFLICT needed because the early return above
    -- catches replay before we reach here.
END IF;
```

### 4.3 Replay return shapes (per RPC)

- **`create_purchase_order_with_lines`** replay returns `(existing_op_po_id, existing_op_supplier_order_ids)` — same shape as the RPC's existing `RETURNS TABLE(purchase_order_id integer, supplier_order_ids integer[])`.
- **`add_lines_to_purchase_order`** replay returns `(existing_op_supplier_order_ids)` — same shape as its existing `RETURNS TABLE(supplier_order_ids integer[])`.

### 4.4 `reconcile_draft_conversion` — new RPC

```plpgsql
CREATE FUNCTION public.reconcile_draft_conversion(p_draft_id bigint)
RETURNS TABLE (reconciled boolean, purchase_order_ids integer[])
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
#variable_conflict use_column
DECLARE
    ledger_po_ids integer[];
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
```

`SECURITY INVOKER` — the underlying `set_purchase_order_draft_status` already enforces org/auth, and staying in invoker keeps RLS in the loop.

### 4.5 `#variable_conflict use_column` on all new/modified bodies

Precaution against the `RETURNS TABLE` output-variable shadowing class documented in `feedback_plpgsql_returns_table_shadowing` memory. The existing `create_purchase_order_with_lines` at its line 533 has an UPDATE with `WHERE purchase_order_id = new_purchase_order_id` — same shadowing pattern. The rewrite cures it incidentally. A follow-up audit of every `RETURNS TABLE` RPC in the codebase is tracked separately.

### 4.6 Serialization of same-draft supplier RPCs

The `FOR UPDATE` on the draft row in the guard block means supplier RPCs for the same draft in the same submit **cannot execute concurrently** at the database. Current client code is already serial (`for...of` loop at `lib/queries/order-components.ts:495` and `new-purchase-order-form.tsx:1614`), so there is no live-behavior regression. Document this explicitly so any future refactor that tries to parallelize the supplier fan-out knows the constraint is structural, not incidental.

### 4.7 Error signaling contract

| SQLSTATE | Meaning | Client UX |
|---|---|---|
| `P0001` | Param mismatch (one of draft_id/token is null) | Treat as unexpected client bug: log + generic "Something went wrong" toast; do not ship normally |
| `P0002` | Draft not found in current org | Toast: "This draft is no longer available." Form resets. |
| `P0003` | Draft already converted | Modal: "This draft was already converted to PO(s) #X, #Y." Form locks. |
| (other) | Existing behavior | Existing toast + `setError` path |

Client parser in `lib/client/purchase-order-drafts.ts` extracts `error.code` and `JSON.parse(error.details).purchase_order_ids`.

## 5. Client flow and UX

### 5.1 Token lifecycle

In `components/features/purchasing/new-purchase-order-form.tsx`:

```ts
const submitTokenRef = useRef<string | null>(null);
const ensureSubmitToken = () => {
  if (!submitTokenRef.current) submitTokenRef.current = crypto.randomUUID();
  return submitTokenRef.current;
};
const clearSubmitToken = () => { submitTokenRef.current = null; };
```

- **Generated** at the top of each submit handler (single-supplier and consolidation paths).
- **Reused** on retry-after-partial-failure (same logical attempt).
- **Cleared** on full success or on explicit "New Draft".
- **Not persisted across reloads.** Reload → token lost → cross-reload recovery uses the Needs review path (§5.4).

### 5.2 Submit handler

```ts
const token = ensureSubmitToken();
try {
  const results = await createPurchaseOrder(data, draftStatusId, supplierComponentsMap, {
    draftId: currentDraftIdRef.current,
    conversionToken: token,
  });

  try {
    await setCurrentDraftStatus('converted', results.map(r => r.purchase_order_id));
    clearSubmitToken();
  } catch (statusError) {
    // Immediate-path partial success: POs are safe, only status flip failed.
    showFinalizationPendingToast({
      draftId: currentDraftIdRef.current!,
      purchaseOrderIds: results.map(r => r.purchase_order_id),
    });
    // Token stays live so Retry cleanup works.
  }
  queryClient.invalidateQueries(/* drafts + POs + dashboard */);
  router.push(destinationFor(results));
} catch (rpcError) {
  if (isAlreadyConvertedError(rpcError)) {
    showAlreadyConvertedDialog(extractPoIds(rpcError));
    return;
  }
  // Existing error-handling path.
}
```

### 5.3 Immediate-path finalization pending toast

Sticky `sonner` toast, `duration: Infinity`, dedupe id `finalize-pending-<draftId>`:

> **Draft cleanup pending** — Purchase order(s) #X, #Y were created. Draft finalization didn't complete. **[Retry cleanup]**

`Retry cleanup` → `reconcile_draft_conversion(draftId)` → on success, dismiss toast + `clearSubmitToken()` + invalidate drafts; on failure, keep toast and surface a sub-error.

### 5.4 Cross-reload recovery — Needs review

On bootstrap, the drafts fetch returns nested `purchase_order_draft_conversions` per draft. Client computes:

- `has_ledger_rows = (conv ?? []).length > 0`
- `conversion_po_ids = (conv ?? []).map(c => c.purchase_order_id)`

**No auto-reconcile.** Drafts list treats drafts as:

| `status` | `has_ledger_rows` | UI placement |
|---|---|---|
| `'draft'` | false | Active drafts section — normal |
| `'draft'` | true | **Needs review** section (separate from active) |
| `'converted'` | (any) | Hidden from dropdown |

**Needs review banner on form mount:**

> This draft started conversion. Purchase order(s) #X, #Y were created from it. Review whether all intended POs were created before finalizing.
>
> *Recorded: N operations • Expected from draft lines: M*  ← soft heuristic hint, not authoritative
>
> [**Finalize draft**] [**Needs support**]

- **Finalize draft** → confirm modal: *"I verified all intended purchase orders were created from this draft."* → `reconcile_draft_conversion(draft_id)` → status flips, draft moves to converted.
- **Needs support** — **out of scope this branch.** Button shown but its storage is deferred. Implementation deferred to follow-up once storage shape is decided. For this branch, either omit the button entirely or disable it with a tooltip. Plan phase decides which.

### 5.5 Read-only rule

Form opens read-only when `status === 'converted' || has_ledger_rows === true`. Both lock inputs and the submit button. The distinction between fully-converted and needs-review shows in the banner copy and available actions, not in the input state.

Autosave is suppressed when the form is read-only (guard against save races on a materialized draft).

### 5.6 Client helpers to add/modify

- `lib/client/purchase-order-drafts.ts`:
  - `isAlreadyConvertedError(error)` — checks `error.code === 'P0003'`.
  - `extractPoIdsFromConversionError(error)` — parses `error.details` JSON.
  - `reconcileDraftConversion(draftId)` — thin wrapper over the new RPC.
- `lib/queries/order-components.ts` `createPurchaseOrder`:
  - Accept `{ draftId, conversionToken }` options; pass to both `create_purchase_order_with_lines` and `add_lines_to_purchase_order` call sites.
- `components/features/purchasing/new-purchase-order-form.tsx`:
  - Token ref + helpers.
  - Rewrite `onSuccess` handlers at lines 1465 and 1686 to split "PO creation success" from "status flip success."
  - Rewrite consolidation path (`handleConsolidationConfirm`) to pass `draftId` + `conversionToken` to every `create_purchase_order_with_lines` and `add_lines_to_purchase_order` call it makes.
  - Add Needs review banner + Finalize modal.
  - Add read-only gating on `has_ledger_rows`.
  - Split drafts dropdown into Active / Needs review sections.

## 6. Migration, reconciliation lifecycle, testing, risks

### 6.1 Migration sequencing

Single date-stamped migration file (e.g. `YYYYMMDDHHMMSS_po_draft_conversion_ledger.sql`):

1. `CREATE TABLE purchase_order_draft_conversions` + indexes.
2. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` + SELECT policy.
3. `DROP FUNCTION IF EXISTS public.create_purchase_order_with_lines(integer, jsonb, integer, timestamptz, text);` (exact old signature) + `CREATE OR REPLACE FUNCTION ...` new signature with guard + ledger.
4. `DROP FUNCTION IF EXISTS public.add_lines_to_purchase_order(integer, jsonb);` + `CREATE OR REPLACE ...` new signature.
5. `CREATE FUNCTION public.reconcile_draft_conversion(bigint) ...`.
6. `GRANT EXECUTE ... TO authenticated, service_role` for all three.

**Explicitly DROP old signatures** before CREATE to prevent PostgREST resolving against a stale overload.

### 6.2 Deploy sequencing

**Migration MUST land in prod before the frontend deploys.**

- **Old frontend against new backend:** safe. New params default NULL; guard/ledger logic is skipped; behavior is identical to pre-migration.
- **New frontend against old backend:** NOT safe. The old RPC signature doesn't accept the new params and rejects the call.

Workflow: apply migration on Supabase branch → test → merge to prod Supabase → verify the old frontend still works → deploy the new frontend.

### 6.3 Reconciliation lifecycle (option b, narrow)

| Trigger | Action |
|---|---|
| Immediate post-submit, status flip fails | Sticky Retry cleanup toast → `reconcile_draft_conversion(draft_id)` |
| User clicks Finalize draft in Needs review | Confirm modal → `reconcile_draft_conversion(draft_id)` |
| Bootstrap / drafts-list fetch | **No auto-reconcile.** Drafts with ledger rows but status≠converted surface in Needs review section. |

### 6.4 Testing strategy

**Idempotency unit tests against the RPC (migration test harness or integration suite):**

1. Same token + same operation_key replay → returns prior `(purchase_order_id, supplier_order_ids)` verbatim; zero new `purchase_orders` rows; zero new `supplier_orders` rows.
2. Same token + different operation_key in same draft → proceeds, inserts new ledger row.
3. Partial-submit then retry (same token): supplier A already succeeded, supplier B failed — retry does not duplicate A, completes B.
4. `add_lines_to_purchase_order` replay with same operation_key → no duplicate `supplier_orders` rows inserted into the target PO.
5. `reconcile_draft_conversion` on a Needs-review draft → flips `status` and sets `converted_purchase_order_ids` only; zero ledger writes.
6. Read-only gate: even a manually-forged submit against a draft with ledger rows + a different token is rejected server-side with P0003.
7. Cross-org guard: `p_draft_id` pointing at another org's draft raises P0002.
8. Concurrent submit on the same draft: `FOR UPDATE` serializes; second caller sees the first's rows and fires P0003.
9. Param-coupling: `p_draft_id` without `p_conversion_token` (or vice versa) raises P0001.

**Integration / client flow tests:**

- Happy path single-supplier: submit, status flip succeeds, token cleared, redirect to PO page.
- Happy path multi-supplier: all RPCs use same token, all ledger rows written, status flip succeeds.
- Immediate partial-success (all supplier RPCs ok, status flip fails): sticky toast shown; Retry cleanup succeeds.
- Already-converted submit (P0003 at RPC): modal shown with PO links.
- Cross-reload partial state: draft appears in Needs review section; Finalize draft action works.

**E2E smoke via Claude in Chrome (per CLAUDE.md verification policy):**

- Log in as `testai@qbutton.co.za`, create draft, add lines, submit. Verify ledger row in Supabase, verify draft disappears from active dropdown. Clean up afterwards.

### 6.5 Risks and open items

- **Pre-existing phantom drafts** (§7): operational cleanup only. No automated fix this branch.
- **Pre-existing shadowing at `create_purchase_order_with_lines:533`:** cured incidentally by the rewrite. Full audit of every `RETURNS TABLE` PL/pgSQL function is a separate follow-up branch.
- **Needs review UX churn:** if this state shows up more than anecdotally in practice, that's the signal to design durable completion metadata (option a). Review after one week post-deploy; no pre-committed threshold.
- **Ledger table growth:** append-only, one row per supplier operation per draft. Volume estimate is well below supplier_orders velocity. No partitioning needed.
- **Concurrent autosave during submit:** governed by existing `draftVersion` optimistic concurrency. The `FOR UPDATE` lock means the second user's autosave briefly blocks on the first user's supplier RPC, then proceeds. Autosave and submit are separate RPCs — no deadlock potential.
- **Needs support button:** storage deferred; implementation deferred. Plan phase decides whether to show a disabled button with a tooltip or omit it entirely for now. Do not let this grow into a third feature on this branch.

## 7. Pre-existing phantom drafts — operational note

Drafts that were created during the original swallow bug (pre-migration, POs created but `status='draft'` and `converted_purchase_order_ids` NULL) have no structural signal the client can reliably detect. There is no ledger row and no `converted_purchase_order_ids` entry, so they are indistinguishable from genuine in-progress drafts.

**We do not backfill them.** Matching draft lines to PO lines by quantity/component is unreliable (quantities can diverge, allocations reshape, the same component can legitimately appear across unrelated POs).

**Rollout runbook:**

1. Before deploy, run per-org query: `SELECT draft_id, updated_at, updated_by FROM purchase_order_drafts WHERE status='draft' AND updated_at < NOW() - INTERVAL '7 days' ORDER BY updated_at DESC` — candidates for being stuck drafts.
2. Have the tenant's ops contact eyeball-review any drafts previously reported as "disappeared on refresh" and archive them manually via the existing Archive button.
3. Post-deploy, drafts that existed before this migration and never see another edit remain a finite manual-cleanup backlog. The ledger + guard prevents all *new* phantoms going forward.

## 8. Out of scope reconfirmation

- **Option C:** single atomic RPC for create-POs + convert-draft. Design only; follow-up branch.
- **Option A durable completion metadata:** (`expected_conversion_operations` on drafts or a sibling table) — follow-up if Needs review state surfaces too often.
- **Needs support workflow:** design-noted, implementation deferred.
- **In-app navigation guard for Next.js router transitions:** pre-existing gap; separate branch.
- **Consolidation-dialog partial-create error reporting polish:** pre-existing; not a correctness issue now that the ledger makes retries safe.
- **Full audit of every `RETURNS TABLE` RPC for the shadowing class:** separate branch.

## 9. Design decisions log (for reviewer context)

- Rejected (i) `source_draft_id` column on `purchase_orders` — doesn't survive append-into-existing.
- Rejected (iii) line-level `source_draft_id` on `purchase_order_line_items` — puts correctness state on a mutable operational table.
- Chose (ii) ledger + conversion_token, with per-operation idempotency via `operation_key` as the PK.
- Rejected bare "ledger presence ⇒ reject" — breaks legitimate multi-supplier same-submit.
- Rejected bare "same-token ⇒ always allow" — allows same-token retry to duplicate a successful supplier's PO.
- Chose "token distinct across submits, operation_key idempotent within a submit."
- Rejected bootstrap auto-reconcile on ledger presence alone — ledger presence only proves materialization, not completion; auto-reconciling a partial submit strands the remaining supplier's work.
- Chose narrow behavior (option b) with Needs review state for cross-reload recovery; durable completion metadata deferred to v2 if the state surfaces often.
