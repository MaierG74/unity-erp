# Cash-Supplier Invoice & Payment Tracking — Implementation Plan

**Status:** Draft for review · **Author:** Claude (local desktop session) · **Date:** 2026-06-27
**Branch:** `codex/local-cash-supplier-tracking` (worktree `unity-erp-cash-supplier-tracking`, off `codex/integration`)
**Grounding report:** produced by the `cash-supplier-research` workflow (7 agents, live-DB verified) this session.

> **Part Two status (2026-07-01):** ✅ Phase C `record_invoice` + both entry points shipped on `codex/local-cash-supplier-tracking` (not yet merged). Migration `20260701132156_record_invoice_rpc` applied live; advisors clean. Recording an invoice (PO-detail control or finance-board card drop) now transitions `awaiting_invoice → awaiting_payment`, writes both audit trails, and surfaces the real invoice amount. Detailed design/verification: [2026-07-01-cash-supplier-record-invoice-part-two.md](2026-07-01-cash-supplier-record-invoice-part-two.md). Still pending: the remaining Phase C RPCs (`request_payment`, `record_payment`, `sign_off_payment`, `mark_pop_sent`), Phase D (detection/escalation/notifications/scheduler), Phase E sign-off + POP drag-drop, and the invoice/POP private-bucket migration.

---

## 1. Problem statement

When a buyer places an order with a **cash supplier** (pay-now, no trade account), a fragile manual handoff has to complete and **nothing in Unity guards it**:

1. Purchasing raises and sends the **PO** to the supplier.
2. The supplier sends an **invoice**.
3. Purchasing routes the invoice to **Accounts** to *request payment*.
4. Accounts **pays** (with sign-off) and sends **proof of payment (POP)** to the supplier — either directly, or back to Purchasing who forwards it.

Because buyers are busy, the loop stalls silently in predictable places:

- The supplier never sends the invoice.
- The invoice *was* sent but sits unread in an inbox.
- Accounts doesn't notice / doesn't action it.

Out of ~50 live orders, **order #7 quietly falls through**. Everything else arrives, staff are ready to start, and the one missing item causes havoc — discovered far too late. This is a **workload blind-spot**, not carelessness, so the fix must be **systemic visibility + active nudging**, not "remember harder."

### What we're building

1. **ETA at order time** — capture an expected-delivery date the moment a PO is placed (today the column exists but is dead), with stale/overdue warnings.
2. **A cash-supplier payment lifecycle** — track invoice → payment-request → paid+sign-off → POP-sent as first-class state, with a structured invoice/payment record (not just a file).
3. **Escalating reminders** — buyer first, then accounts/manager, then daily brief — when any stage goes stale.
4. **An Accounts / Finance dashboard** — every pending supplier payment in one place; drag-and-drop POP onto a PO; a payment sign-off step; send POP from inside Unity.
5. **Make the forgettable visible** — at-a-glance "what's waiting and who must chase it."

---

## 2. Current state (verified live — project `ttlyfhkrsjjrzxiagzpb`)

| Capability | Today | Evidence |
|---|---|---|
| Cash-vs-account supplier flag | **MISSING** | `suppliers` is 5 cols only (`supplier_id, name, contact_info, is_active, org_id`). No payment-type/terms. |
| ETA at order time | **DEAD column** | `purchase_orders.expected_delivery_date date` exists but is never written by the create form / `create_purchase_order_with_lines` RPC, and never read. |
| Supplier-confirmed ETA | **Live** | `supplier_follow_up_responses.expected_delivery_date`, shown as "Supplier ETA". Keep distinct from buyer-ETA. |
| Invoice entity | **MISSING** | No invoice table/columns anywhere. |
| Proof of payment | **File only** | `purchase_order_attachments.attachment_type='proof_of_payment'` (48 live rows) in the **public** `QButton` bucket. No structured payment record. |
| Payment status / sign-off | **MISSING** | `approved_by/at` is *order* approval (single stamp), not payment. |
| Finance/Accounts module | **MISSING** | No route, no sidebar entry, no payment/invoice tables. |
| Reminders / escalation | **Partial, reusable** | Closure engine (`closure_items` + `escalate_due_closure_items`) has `escalation_level`/`escalation_policy` JSONB with targets `owner`/`supervisor`/`daily_brief`. Gaps: external scheduler only (no pg_cron); escalation events are **not** turned into emails/notifications. |
| Outbound email | **Mature (Resend)** | `lib/email.tsx`; `send-po-follow-up` is the existing reminder precedent; webhook delivery tracking; `purchase_order_emails` typed log. |
| Audit hook | **Exists** | `purchase_order_activity` (append-only) — log invoice/payment events here too. |
| Card→target DnD lib | **MISSING** | Only `react-dropzone` (file-drop) + native HTML5 DnD (`app/labor-planning/`). No `@dnd-kit`/`react-dnd`. |

**Key files:** create form `components/features/purchasing/new-purchase-order-form.tsx` (RPC `create_purchase_order_with_lines`); dashboard `app/purchasing/page.tsx`; PO detail `app/purchasing/purchase-orders/[id]/page.tsx`; attachments `lib/db/purchase-order-attachments.ts` + `components/features/purchasing/POAttachmentManager.tsx`; supplier form `components/features/suppliers/supplier-form.tsx`; closure RPCs `supabase/migrations/20260509083000_closure_engine_rpcs.sql`.

---

## 3. Design

### 3.1 Supplier payment type (Phase A1)

Add to `suppliers` (inherits existing org RLS):

```sql
ALTER TABLE public.suppliers
  ADD COLUMN payment_type text NOT NULL DEFAULT 'account'
    CHECK (payment_type IN ('cash','account'));
-- optional, account suppliers only:
ALTER TABLE public.suppliers ADD COLUMN payment_terms_days int;
```

- Default `'account'` so all existing suppliers are unchanged (backward-compatible).
- Extend `Supplier` type (`types/suppliers.ts` L1-6) + supplier form (`supplier-form.tsx`) with a Cash/Account toggle.
- The cash payment lifecycle (3.3) applies to POs whose supplier is `payment_type='cash'`. Designed generically so account suppliers can opt in later.

### 3.2 ETA at order time (Phase B)

The column already exists — wire it end-to-end:

- **Form:** add an "Expected delivery" date input to the create-form header (`new-purchase-order-form.tsx`, beside Order Date). Prefill a suggested ETA from `suppliercomponents.lead_time` (days, already fetched but unused) — `order_date + max(lead_time)`.
- **RPC:** extend `create_purchase_order_with_lines` with an **optional** `p_expected_delivery_date date DEFAULT NULL` param; insert into the existing `purchase_orders.expected_delivery_date`. Backward-compatible (existing callers omit it). `CREATE OR REPLACE` preserving all current behavior.
- **Surface:** show buyer-ETA on PO list / detail / purchasing dashboard, **labelled "Expected"** and visually distinct from "Supplier ETA" (`supplier_follow_up_responses.expected_delivery_date`). Overdue (`expected_delivery_date < today` and not fully received) → amber/destructive badge, reusing the `getDeliveryDateInfo` pattern from `app/orders/page.tsx:372-405`.

### 3.3 Invoice + payment entity (Phase A2)

New org-scoped table (one PO → many invoices; cash v1 typically 1:1):

```sql
CREATE TABLE public.purchase_order_invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id),
  purchase_order_id bigint NOT NULL REFERENCES public.purchase_orders(purchase_order_id),
  -- invoice
  invoice_number    text,
  invoice_date      date,
  invoice_amount    numeric,
  invoice_received_at timestamptz,
  invoice_attachment_id uuid REFERENCES public.purchase_order_attachments(id),
  -- payment
  amount_paid       numeric,
  payment_date      date,
  payment_method    text,          -- eft / cash / card
  payment_reference text,
  pop_attachment_id uuid REFERENCES public.purchase_order_attachments(id),
  -- lifecycle
  payment_status    text NOT NULL DEFAULT 'awaiting_invoice'
    CHECK (payment_status IN
      ('awaiting_invoice','awaiting_payment','awaiting_pop','closed','cancelled')),
  payment_requested_at timestamptz,
  paid_at           timestamptz,
  pop_sent_at       timestamptz,
  -- sign-off
  signed_off_by     uuid,
  signed_off_at     timestamptz,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_po_invoices_org_status ON public.purchase_order_invoices (org_id, payment_status);
CREATE INDEX ix_po_invoices_po ON public.purchase_order_invoices (org_id, purchase_order_id);
ALTER TABLE public.purchase_order_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY po_invoices_rw ON public.purchase_order_invoices
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));
-- set_updated_at trigger
```

**Lifecycle (the watch points where things stall):**

```
awaiting_invoice ──record_invoice──▶ awaiting_payment ──record_payment+sign_off──▶ awaiting_pop ──mark_pop_sent──▶ closed
        │ (no invoice in N days → escalate)      │ (not paid in N days → escalate)        │ (paid but POP not sent → escalate)
```

- **Amount owed** for display when no invoice yet: derive `SUM(supplier_orders.order_quantity * suppliercomponents.price)` for the PO. Per project rule, the detection/board RPC must `EXPLAIN (ANALYZE, BUFFERS)` and use a single grouped scan, not per-row LATERALs. The authoritative figure once known is the supplier's `invoice_amount`.

### 3.4 Payment sign-off audit (Phase A3)

Append-only (mirror `job_work_pool_exception_activity` / `purchase_order_activity`):

```sql
CREATE TABLE public.po_payment_signoff_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  invoice_id uuid NOT NULL REFERENCES public.purchase_order_invoices(id),
  action text NOT NULL,            -- invoice_recorded / payment_requested / payment_recorded / signed_off / pop_sent / reopened
  actor uuid,
  note text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- org RLS SELECT; writes via SECURITY DEFINER RPCs only.
```

Every lifecycle transition writes here **and** a summary row to `purchase_order_activity` (so the PO timeline shows it).

### 3.5 RPCs (Phase C)

All `SECURITY DEFINER`, org-checked, write both audit tables. Follow the PLpgSQL gotchas in project memory (`#variable_conflict use_column`; explicit `jsonb_build_object`; `clock_timestamp()` only for elapsed math).

- `record_invoice(p_po_id, p_invoice_number, p_invoice_date, p_invoice_amount, p_attachment_id)` → creates/updates the invoice row, sets `invoice_received_at = now()`, `payment_status='awaiting_payment'`.
- `request_payment(p_invoice_id)` → `payment_requested_at = now()` (surfaces on the finance board). *(Optional; recording an invoice can auto-request.)*
- `record_payment(p_invoice_id, p_amount_paid, p_payment_date, p_method, p_reference, p_pop_attachment_id)` → fills payment fields, `paid_at = now()`, `payment_status='awaiting_pop'`.
- `sign_off_payment(p_invoice_id)` → `signed_off_by/at`, **locks** the record (mirror payroll lock). Two-step: record then authorise.
- `mark_pop_sent(p_invoice_id)` → `pop_sent_at`, `payment_status='closed'` (called after the POP email send succeeds).

### 3.6 Detection + escalation (Phase D)

Reuse the **closure engine** rather than inventing a parallel SLA system.

- **Detection RPC** `detect_cash_po_exceptions(p_org_id)` (modeled on `compute_customer_order_shortfalls`): for cash POs, open/refresh `closure_items` when:
  - `awaiting_invoice` older than threshold → `source_type='cash_invoice_overdue'`
  - `awaiting_payment` older than threshold → `source_type='cash_payment_overdue'`
  - `awaiting_pop` older than threshold → `source_type='cash_pop_overdue'`
  - buyer-ETA passed & not received → `source_type='po_eta_overdue'`
  - `source_fingerprint = <po_id>:<type>` for idempotent dedup; **auto-close** the closure_item when the condition clears.
- **Escalation policy** per item: `steps = [{target:'owner', after_minutes:…}, {target:'supervisor', after_minutes:…}, {target:'daily_brief', after_minutes:…}]`. The existing `escalate_due_closure_items(p_org_id)` advances levels.
- **Recipient resolver** (`owner`→buyer = `purchase_orders.created_by`; `supervisor`→accounts/manager). **Gap:** no manager/accounts mapping exists today → introduce a small mapping (org-level "accounts team" role, or `manager_id` on membership). **Decision needed (see §6).**
- **Notification delivery** (the true missing primitive): a worker converts new `closure_escalation_events` into:
  - an **email** (`emails/payment-reminder.tsx` + `app/api/send-payment-reminder-email/route.ts`, cloning `send-po-follow-up`; log to `purchase_order_emails` with a new `email_type='po_payment_reminder'`), and/or
  - an **in-app todo** (`todo_items`, assigned to buyer/accounts, `context_*` → the PO).
- **Scheduler:** no in-platform cron (pg_cron/pg_net available but not installed). **Decision needed (see §6):** (A) drive `detect_cash_po_exceptions` + `escalate_due_closure_items` + the notification worker from the **external OpenClaw runtime cron** (existing pattern — recommended, no new infra), or (B) install `pg_cron`+`pg_net`.

### 3.7 Finance / Accounts dashboard (Phase E)

- **Route** `app/finance/` + sidebar entry (`components/layout/sidebar.tsx`) + module gate (`lib/hooks/use-module-access.ts`, `app/admin/modules`) + a new **`payment-authorise`** permission.
- **Pending-payments board:** cash POs grouped by `payment_status` (Awaiting invoice / Awaiting payment / Awaiting POP), each card: PO + supplier + amount (invoice or derived) + age + escalation badge + buyer. Server-paginated / server-counted (client-memory rule — operators on old machines).
- **Drag-and-drop POP onto a PO:** reuse `POAttachmentManager` + `uploadPOAttachment(..., {attachmentType:'proof_of_payment'})` — do **not** rebuild upload. Dropping a POP also calls `record_payment`/`mark_pop_sent` to **transition state** (today the upload changes nothing). Use a `react-dropzone` drop-target per row (no card-DnD lib needed for v1).
- **Sign-off step:** two-step submit→authorise (mirror PO-approval `app/purchasing/purchase-orders/[id]/page.tsx:520-577`); lock on sign-off (mirror payroll); write `po_payment_signoff_activity`.
- **Send POP email** button → the new POP email route.

### 3.8 Security & tenancy

- Every new table: `org_id NOT NULL`, `org_id`-leading index, RLS via `public.is_org_member(org_id)` in `USING` + `WITH CHECK`. Append-only tables: SELECT policy only; writes via SECURITY DEFINER RPCs. Run `get_advisors` (security) after each migration. Any new/replaced VIEW must carry `WITH (security_invoker = true)`.
- **POP/invoice file privacy (Decision §6):** POP files currently live in the **public** `QButton` bucket (banking detail world-readable by URL). Recommend a **private** bucket for finance attachments (precedent: `supplier-returns`). Migrating the 48 existing POP files is a separate, careful task — **not** done autonomously.

---

## 4. Phasing & the first slice

| Phase | Scope | Risk | In first slice? |
|---|---|---|---|
| **A1** Supplier `payment_type` flag (+ form/type) | additive column, safe default | low | ✅ |
| **A2** `purchase_order_invoices` table + RLS | new table | low | ✅ |
| **A3** `po_payment_signoff_activity` table | new table | low | ✅ (table only) |
| **B** ETA capture (form + RPC + surface) | optional RPC param, additive | low–med | ✅ |
| **C** Lifecycle RPCs | new RPCs | med | partial (record_invoice + stubs) |
| **D** Detection / escalation / notification / scheduler | reuse closure engine; **decisions** | med–high | ❌ (needs §6 decisions) |
| **E** Finance dashboard (route, board, DnD, sign-off) | new UI | med | ✅ skeleton (route + read-only board by status) |
| **F** Correspondence internalisation (manual/inbound log) | stretch | — | ❌ |

**First slice shipped today** = **A1 + A2 + A3 (tables) + B (ETA end-to-end) + E1/E2 skeleton** (finance route + read-only pending-payments board grouped by `payment_status`, amount derived). Sign-off, DnD-transition, escalation, notifications, scheduler, and bucket-privacy follow once §6 decisions land.

---

## 5. Acceptance criteria (first slice)

- A supplier can be marked **Cash** or **Account**; existing suppliers default to Account; the flag round-trips through the supplier form.
- The PO create form has an **Expected delivery** input (prefilled from lead time); saving a PO persists `purchase_orders.expected_delivery_date`; it renders on PO detail/list labelled "Expected" and distinct from "Supplier ETA"; an overdue PO shows an amber badge.
- `purchase_order_invoices` + `po_payment_signoff_activity` exist with org RLS; `get_advisors` (security) reports no new findings.
- `/finance` route exists, gated, with a sidebar entry, listing cash POs grouped by `payment_status` (read-only), amount shown, server-paginated.
- `npm run lint` clean on touched files; `npx tsc --noEmit` clean for the touched area; browser smoke (preview MCP, test@me.com) confirms the create-form ETA + `/finance` render with no console errors and `authorizedFetch` (not plain `fetch`) on any new `/api` calls.

## 6. Decision points (need Greg — async)

1. **Payment sign-off authority** — which role/permission may authorise payment? (new `payment-authorise` gate). Default: a new permission, granted to the accounts user(s).
2. **POP/invoice bucket privacy** — move finance files to a **private** bucket (recommended)? Migrating 48 existing POP files is a separate task.
3. **Scheduler** — external OpenClaw runtime cron (recommended, no new infra) vs install `pg_cron`+`pg_net`.
4. **Reminder thresholds/cadence** — defaults to confirm, e.g. awaiting-invoice nudge buyer @2 working days → accounts @4 → daily brief @6; payment & POP similar.
5. **Account suppliers** — cash-only for v1 (recommended), or include account suppliers in payment tracking now?
6. **Accounts/manager mapping** — how to model the escalation target (org-level "accounts team" role vs per-buyer manager). No mapping exists today.

## 7. Rollback / release notes

- All Phase A/B migrations are **additive and backward-compatible** (new column with safe default; new tables; optional RPC param). Rollback = drop the new tables/column and revert the RPC to its prior body (kept in the migration's down-notes).
- No existing data is mutated. No change to receiving lifecycle or existing PO statuses (payment lifecycle is a **parallel** state on a separate table).
- Live-DB changes applied via Supabase MCP `apply_migration`; `get_advisors` run after; migration files committed under `supabase/migrations/`.

## 8. Docs to update

- `docs/domains/purchasing/purchasing-master.md` (primary), `docs/domains/suppliers/suppliers-master.md` (payment_type), `docs/operations/email-integration.md` (payment-reminder template), `docs/technical/smoke-tests.md` (new flow). Reconcile (don't trust) `docs/scopes/scope_invoicing_payments.md`.

## 9. Reuse map (don't rebuild)

Closure engine (escalation) · Resend + `send-po-follow-up` (reminders) · `purchase_order_activity` (audit) · `POAttachmentManager` + `uploadPOAttachment` (POP upload) · PO-approval two-step (sign-off) · payroll lock (lock-on-signoff) · `getDeliveryDateInfo` (overdue badge) · `app/labor-planning/` (board pattern, if card-DnD later).
