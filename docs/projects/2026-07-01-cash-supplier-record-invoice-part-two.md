# Cash-Supplier Invoice Tracking — Part Two: Record Invoice

**Status:** Approved design (Greg, 2026-07-01) · **Author:** Claude (local desktop session)
**Branch:** `codex/local-cash-supplier-tracking` (worktree `unity-erp-cash-supplier-tracking`)
**Parent plan:** [`docs/projects/2026-06-27-cash-supplier-invoice-tracking-plan.md`](2026-06-27-cash-supplier-invoice-tracking-plan.md) — this implements **Phase C `record_invoice`** + the two entry points.
**Linear:** POL-128 (parent), POL-129 (Part One). Part Two = a new sub-issue of POL-128.

---

## 1. Scope

Build **one shared "record invoice" action** for a purchase order, reachable from **two entry points**, that performs the first lifecycle transition **`awaiting_invoice` → `awaiting_payment`**.

In scope:
- A shared `RecordInvoiceDialog` + `recordPurchaseOrderInvoice` client helper.
- A `record_invoice` SECURITY DEFINER RPC (atomic write of the invoice row + both audit tables).
- Entry point 1 — PO detail page control (cash suppliers only).
- Entry point 2 — Finance board per-card drop-target with optimistic move.
- Supporting: `PO_ATTACHMENT_TYPES += 'invoice'`, `types/purchasing.ts` invoice types, docs.

Out of scope (later phases): recording payment / sign-off, sending POP, escalating reminders, the scheduler, and the private-bucket migration.

## 2. Confirmed decisions (Greg, 2026-07-01)

| # | Decision | Choice |
|---|---|---|
| 1 | What to capture on invoice-drop | **File + invoice number + date + amount** — small post-drop dialog; amount pre-filled with the derived estimate; all fields optional. |
| 2 | Write mechanism | **SECURITY DEFINER RPC** `record_invoice` — writes invoice row + `po_payment_signoff_activity` + `purchase_order_activity` atomically. Full migration discipline. |
| 3 | Invoice file privacy | **Public `QButton` bucket** (reuse `uploadPOAttachment` as-is). Flagged; private-bucket move is a separate task. |
| 4 | PO-detail control visibility | **Cash suppliers only** (`supplier.payment_type = 'cash'`). Account suppliers opt in later. |
| 5 | RPC call transport | **Direct `supabase.rpc('record_invoice', …)`** from the client helper — no new `/api` route. The RPC enforces its own org check and runs as the authenticated user. |

## 3. Architecture — the shared action

A single dialog + helper are the core; both entry points call them.

### 3.1 `recordPurchaseOrderInvoice` (new `lib/db/purchase-order-invoices.ts`)

```ts
export async function recordPurchaseOrderInvoice(input: {
  file: File;
  purchaseOrderId: number;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;   // yyyy-mm-dd
  invoiceAmount?: number | null;
}): Promise<PurchaseOrderInvoice> {
  // 1) upload file as an invoice-type attachment (reused, public QButton bucket)
  const attachment = await uploadPOAttachment(input.file, input.purchaseOrderId, {
    attachmentType: 'invoice',
  });
  // 2) atomic write via SECURITY DEFINER RPC
  const supabase = createClient();
  const { data, error } = await supabase.rpc('record_invoice', {
    p_purchase_order_id: input.purchaseOrderId,
    p_invoice_number: input.invoiceNumber ?? null,
    p_invoice_date: input.invoiceDate ?? null,
    p_invoice_amount: input.invoiceAmount ?? null,
    p_attachment_id: attachment.id,
  });
  if (error) throw error;
  return data as PurchaseOrderInvoice;
}
```

- Upload happens **before** the RPC so the row is created with `invoice_attachment_id` set in one shot.
- No new `/api` route → the `authorizedFetch` acceptance criterion is satisfied trivially (the browser Supabase client carries the session; the RPC runs as the authenticated user).

### 3.2 `RecordInvoiceDialog` (new `components/features/purchasing/RecordInvoiceDialog.tsx`)

Props:
```ts
interface RecordInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchaseOrderId: number;
  suggestedAmount?: number | null;   // pre-fills the amount field (derived estimate)
  initialFile?: File | null;         // finance-board drop pre-loads the dropped file
  onRecorded?: (invoice: PurchaseOrderInvoice) => void;  // caller invalidates / optimistic-updates
}
```

Contents:
- A `react-dropzone` file area (skipped/collapsed when `initialFile` is provided — show the dropped file name with a "replace" affordance).
- Fields: **Invoice number** (text), **Invoice date** (date), **Amount** (numeric, pre-filled with `suggestedAmount`; follows the numeric-input UX rule — `value={x || ''}`, `placeholder="0"`, select-on-focus, reset-empty-to-0 on blur).
- Submit button disabled until a file is present. On submit: call `recordPurchaseOrderInvoice`, on success `onRecorded(invoice)` + success toast + close; on error a destructive toast (dialog stays open for retry).
- Reuse the segmented-control / shadcn styling already in the branch for visual consistency.

The dialog owns the file + field state; it does **not** own cache invalidation — each entry point handles its own react-query effects via `onRecorded`.

## 4. The RPC — `record_invoice` (new migration)

Modeled on `close_supplier_order_balance` (`supabase/migrations/20260428120545_supplier_order_balance_closures.sql`).

```sql
CREATE OR REPLACE FUNCTION public.record_invoice(
  p_purchase_order_id bigint,
  p_invoice_number     text    DEFAULT NULL,
  p_invoice_date       date    DEFAULT NULL,
  p_invoice_amount     numeric DEFAULT NULL,
  p_attachment_id      uuid    DEFAULT NULL,
  p_note               text    DEFAULT NULL
)
RETURNS public.purchase_order_invoices
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_org_id      uuid;
  v_actor       uuid := auth.uid();
  v_existing_id uuid;
  v_invoice     public.purchase_order_invoices;
BEGIN
  SELECT org_id INTO v_org_id
  FROM public.purchase_orders
  WHERE purchase_order_id = p_purchase_order_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_purchase_order_id;
  END IF;

  IF auth.role() <> 'service_role' AND NOT public.is_org_member(v_org_id) THEN
    RAISE EXCEPTION 'Not authorized for organization %', v_org_id;
  END IF;

  -- reuse an existing open awaiting_invoice row if present, else create one
  SELECT id INTO v_existing_id
  FROM public.purchase_order_invoices
  WHERE purchase_order_id = p_purchase_order_id
    AND payment_status = 'awaiting_invoice'
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing_id IS NULL THEN
    INSERT INTO public.purchase_order_invoices (
      org_id, purchase_order_id, invoice_number, invoice_date, invoice_amount,
      invoice_received_at, invoice_attachment_id, payment_status, created_by
    ) VALUES (
      v_org_id, p_purchase_order_id, p_invoice_number, p_invoice_date, p_invoice_amount,
      now(), p_attachment_id, 'awaiting_payment', v_actor
    )
    RETURNING * INTO v_invoice;
  ELSE
    UPDATE public.purchase_order_invoices SET
      invoice_number       = COALESCE(p_invoice_number, invoice_number),
      invoice_date         = COALESCE(p_invoice_date, invoice_date),
      invoice_amount       = COALESCE(p_invoice_amount, invoice_amount),
      invoice_attachment_id= COALESCE(p_attachment_id, invoice_attachment_id),
      invoice_received_at  = now(),
      payment_status       = 'awaiting_payment',
      updated_at           = now()
    WHERE id = v_existing_id
    RETURNING * INTO v_invoice;
  END IF;

  INSERT INTO public.po_payment_signoff_activity (org_id, invoice_id, action, actor, note, metadata)
  VALUES (v_org_id, v_invoice.id, 'invoice_recorded', v_actor, p_note,
    jsonb_build_object(
      'purchase_order_id', p_purchase_order_id,
      'invoice_number',    p_invoice_number,
      'invoice_amount',    p_invoice_amount,
      'attachment_id',     p_attachment_id
    ));

  INSERT INTO public.purchase_order_activity (org_id, purchase_order_id, action_type, description, metadata, performed_by)
  VALUES (v_org_id, p_purchase_order_id, 'invoice_recorded',
    'Invoice recorded'
      || COALESCE(' #' || p_invoice_number, '')
      || COALESCE(' — ' || p_invoice_amount::text, ''),
    jsonb_build_object('invoice_id', v_invoice.id, 'invoice_amount', p_invoice_amount, 'attachment_id', p_attachment_id),
    v_actor);

  RETURN v_invoice;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_invoice(bigint, text, date, numeric, uuid, text) TO authenticated;
```

Notes / gotchas honored:
- `SET search_path = public` on a SECURITY DEFINER function → avoids the `function_search_path_mutable` advisor; keeps `is_org_member`/table refs resolvable.
- `#variable_conflict use_column` per the PL/pgSQL RETURNS-shadowing memory (the function returns a table type).
- All audit inserts pass `org_id` **explicitly** (SECURITY DEFINER bypasses RLS auto-fill; mirrors `close_supplier_order_balance`).
- `now()` is correct here (event stamps, not elapsed-duration math).
- Create-or-update: the finance API defaults every cash PO with no open invoice to `awaiting_invoice`, so most POs have **no** invoice row yet → the insert path is the common case; the update path covers a pre-seeded/demo row.

## 5. Entry point 1 — PO detail page

`app/purchasing/purchase-orders/[id]/page.tsx`:
- Ensure the PO fetch carries `supplier.payment_type` (add to the select if missing).
- Render an **"Upload / record invoice"** button near the attachments section, **only when `payment_type === 'cash'`** and no invoice has been recorded yet (no invoice row, or latest open status is `awaiting_invoice`).
- Button opens `RecordInvoiceDialog` (empty dropzone; **`suggestedAmount` omitted → amount starts blank** — the buyer reads it off the invoice in hand. The derived-estimate pre-fill is a finance-board affordance only, where the estimate already sits on the card; we do not import that derivation into the PO page).
- `onRecorded`: invalidate `['poAttachments', id]` and the PO/invoice queries, show toast.
- Once recorded: replace the button with a status chip **"Awaiting payment · Invoice #{n} · R{amount}"** linking to the invoice attachment `file_url`, so the transition is visible.

## 6. Entry point 2 — Finance board

`app/finance/page.tsx`:
- Wrap each **`awaiting_invoice`** `PendingPaymentCard` in a `react-dropzone` drop-target (`noClick: true`, `noKeyboard: true` so the card's `Link` navigation is preserved). Show a drag-over highlight + "Drop invoice to record" overlay. Only `awaiting_invoice` cards accept the invoice drop (a POP drop on `awaiting_payment` is a later phase).
- On drop: store `{ file, card }` and open `RecordInvoiceDialog` (`initialFile` = dropped file, `suggestedAmount` = `card.amount`).
- `onRecorded`: run the **optimistic move** mutation (canonical `onMutate`/`onError`/`onSettled`, key `['finance','pending-supplier-payments']`):
  - `onMutate`: cancel query, snapshot, move the card from `groups.awaiting_invoice` → `groups.awaiting_payment`, set its `amount` to the entered `invoiceAmount` (fallback to prior), return snapshot.
  - `onError`: restore snapshot + destructive toast.
  - `onSettled`: `invalidateQueries(['finance','pending-supplier-payments'])`.
- The finance page gains `useMutation` + `useQueryClient` (it currently only uses `useQuery`).

## 7. Supporting changes

- `lib/db/purchase-order-attachments.ts`: add `'invoice'` to `PO_ATTACHMENT_TYPES` (+ a label/description entry). Verify the `POAttachmentType` union and any switch/label maps include it.
- `types/purchasing.ts`: add
  ```ts
  export type PaymentStatus = 'awaiting_invoice' | 'awaiting_payment' | 'awaiting_pop' | 'closed' | 'cancelled';
  export type PurchaseOrderInvoice = { /* mirror the table columns */ };
  ```
  and reuse them in the finance API route / dialog / helper instead of the inline `InvoiceRow`.

## 8. Migration discipline (four artifacts — Claude owns live-ops)

1. Write `supabase/migrations/<timestamp>_record_invoice_rpc.sql` (§4).
2. Apply via Supabase MCP `apply_migration` (project `ttlyfhkrsjjrzxiagzpb`).
3. Reconcile with `list_migrations`; realign the auto-recorded version to the filename.
4. Update `docs/operations/migration-status.md`.
5. Run `get_advisors` (security) — **no new findings** for `record_invoice`.

## 9. Acceptance criteria

- **PO detail:** on a cash-supplier PO, uploading an invoice records it and `payment_status` becomes `awaiting_payment`; the status chip appears.
- **Finance board:** dragging an invoice file onto an `awaiting_invoice` PO card records it and the card moves to "Awaiting payment" (optimistic, persisted after refetch), showing the entered amount.
- The file is retrievable as an **`invoice`-type** attachment on the PO.
- `po_payment_signoff_activity` has an `invoice_recorded` row for that invoice; `purchase_order_activity` has a matching summary row.
- No console/server errors. Any new `/api` call (none planned) would use `authorizedFetch`.

## 10. Verification commands

- `npm run lint` (touched files) — clean.
- `npx tsc --noEmit` — no NEW errors (~96 pre-existing in untouched files; touched area clean).
- `get_advisors` (security) — clean for `record_invoice`.
- Browser smoke on `:3000` via preview MCP (`cash-supplier-preview` launch, minted `test@me.com` session): exercise both entry points, confirm the state transition and the recorded attachment/activity rows.

## 11. Guardrails / release notes

- **Do NOT merge** to `codex/integration` — this feature carries schema; Greg approves the merge.
- Pre-PR self-check: `git diff origin/codex/integration --stat` shows **only** cash-supplier files (Part One + Part Two). Stop and surface if unrelated deletions appear.
- Never touch wage tables.
- Additive & backward-compatible: new RPC + new attachment type + new UI. Rollback = `DROP FUNCTION public.record_invoice(...)` and revert the client files; no data mutated destructively (invoice rows are new).
- Supplier 65 (PEKAY CHEMICALS) is temporarily `payment_type='cash'` to keep the board populated for demos — revert to `'account'` when testing is done.

## 12. Build orchestration (drive-cmux split)

Per the coding-workflow-split rule (substantial slice → GPT-5.5 fleet; live-ops → Claude direct):
- **Claude:** write + apply the `record_invoice` RPC migration, run `get_advisors` (so the RPC is live first); then review the fleet diff, run the browser smoke, file the Linear sub-issue, reconcile.
- **drive-cmux GPT-5.5 fleet:** build the client slice against the live RPC — `recordPurchaseOrderInvoice` helper, `RecordInvoiceDialog`, PO-detail entry point (cash-only), finance-board drop-target + optimistic mutation, `PO_ATTACHMENT_TYPES`, `types/purchasing.ts`, docs.

## 13. Docs to update

- `docs/domains/purchasing/purchasing-master.md` — invoice recording + finance flow. ✅
- Tick the Part-Two items in the parent plan doc (`2026-06-27-cash-supplier-invoice-tracking-plan.md`). ✅

## 14. Known follow-ups (v2 — noted from the /simplify altitude pass)

- **Carry `supplier_id`/`payment_type` in the PO fetch.** The PO-detail control reads `(purchaseOrder as any)?.supplier_id` and runs a separate `suppliers` query for `payment_type`. Deliberately kept separate for v1 to avoid a top-level PostgREST embed (`supplier:suppliers(...)`) that risks embed-ambiguity (see the "second FK breaks embeds" gotcha). v2: type `supplier_id` on the PO shape and/or embed `payment_type` once the embed is browser-verified, removing the cast + extra round-trip.
- **`FinanceCard` could carry `supplier_id`** for future supplier drill-down (the API already has it). Not needed for recording.
- **PO-detail `onRecorded` refetches** (invoice + attachments) rather than doing a targeted optimistic update like the finance board; correct but slightly less snappy. Acceptable for v1.
