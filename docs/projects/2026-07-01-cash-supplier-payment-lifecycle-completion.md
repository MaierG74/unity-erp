# Cash-Supplier Module Completion — Payment Lifecycle, Finance Board, Escalation

**Status:** Spec approved by Greg (design conversation, 2026-07-01) · **Author:** Claude (local desktop)
**Branch:** `codex/local-cash-payment-lifecycle` (worktree `unity-erp-cash-supplier-tracking`, off `codex/integration` @ `46c3f274`)
**Parent:** [2026-06-27-cash-supplier-invoice-tracking-plan.md](2026-06-27-cash-supplier-invoice-tracking-plan.md) (POL-128). Parts One+Two shipped (POL-129/130 Done).
**Grounding:** 3-agent dcx research pass this session (permissions, storage, closure/email) — all file:line claims below verified against the repo.

## 0. Real-world flow being modeled (Greg, 2026-07-01)

> Invoice arrives → finance clerk receives it → clerk gives it to the **owner**, who decides and **makes the payment** → owner hands the **POP** back to the clerk → clerk sends POP to the supplier.

Mapping: `record_invoice` (shipped) → clerk/owner `record_payment` → owner `sign_off_payment` (role-gated, locks) → clerk `mark_pop_sent` → `closed`. `request_payment` from the parent plan is **dropped** — recording an invoice already lands in `awaiting_payment`.

## 1. Decisions (locked with Greg, 2026-07-01)

| # | Decision | Choice |
|---|---|---|
| 1 | Sign-off authority | **Org role check** — `organization_members.role IN ('owner','admin')` inside the RPC (no per-user permission system exists in the codebase; only org roles / module entitlements / platform_admins). Client shows the button via a `caller_can_authorise` flag on the finance API response. |
| 2 | Escalation chain | buyer (`owner` target) → **org accounts team** (new small mapping table) → daily brief. Thresholds **2 / 4 / 6 days** per stage (calendar-day minutes in `escalation_policy.steps[].after_minutes`; working-day precision deferred). |
| 3 | Scheduler | **External OpenClaw runtime cron** via the existing `agent-closure-rpc` edge router (`RPC_CONFIG` additions). No pg_cron. |
| 4 | File privacy | **New private `finance-docs` bucket** for NEW invoice/POP uploads, signed URLs at read time. 48 legacy public POP files stay put (separate task). |
| 5 | Scope | Cash suppliers only for v1. Two slices: **Slice 1 = C+E+bucket** (payments, sign-off, POP, board interactions, module gate), **Slice 2 = D** (detection, escalation, notifications, cron). Each slice reviews + merges separately. |

## 2. Slice 1 — payment lifecycle + operational finance board + private bucket

### 2.1 Migration S1-A: lifecycle RPCs (`record_payment`, `sign_off_payment`, `mark_pop_sent`, `reopen_payment`)

All four: `SECURITY DEFINER`, `SET search_path = public`, `#variable_conflict use_column`, `REVOKE PUBLIC/anon` + `GRANT authenticated, service_role`, and the **20260701205117 hardening pattern**: lock the parent `purchase_orders` row `FOR UPDATE` via the invoice's `purchase_order_id`, resolve + verify org (`is_org_member`, service_role bypass), validate attachment ownership, write **both** audit trails (`po_payment_signoff_activity` + `purchase_order_activity`).

- `record_payment(p_invoice_id uuid, p_amount_paid numeric, p_payment_date date, p_payment_method text, p_payment_reference text, p_pop_attachment_id uuid DEFAULT NULL, p_note text DEFAULT NULL)` — requires current `payment_status='awaiting_payment'` (else `check_violation`); `p_amount_paid` must be `> 0`; sets payment fields + `paid_at=now()` + `payment_status='awaiting_pop'`; audit action `payment_recorded`.
- `sign_off_payment(p_invoice_id uuid, p_note text DEFAULT NULL)` — **role check**: caller must be active `organization_members.role IN ('owner','admin')` for the invoice org (service_role bypasses); requires `paid_at IS NOT NULL` and not already signed off; sets `signed_off_by=auth.uid(), signed_off_at=now()`; audit `signed_off`. Once signed off, `record_payment`/`reopen` on the row is refused except via `reopen_payment`.
- `mark_pop_sent(p_invoice_id uuid, p_note text DEFAULT NULL)` — requires `payment_status='awaiting_pop'`; sets `pop_sent_at=now()`, `payment_status='closed'`; audit `pop_sent`. Does NOT require sign-off (clerk can close the loop; the sign-off column shows whether the owner stamped it — detection in Slice 2 can flag unsigned closures).
- `reopen_payment(p_invoice_id uuid, p_note text)` — same role check as sign-off; note required; from `awaiting_pop`/`closed` back to `awaiting_payment`; clears payment + sign-off + pop fields; audit `reopened`.

State machine enforced in-RPC: `awaiting_payment → (record_payment) → awaiting_pop → (mark_pop_sent) → closed`, `reopen_payment: awaiting_pop|closed → awaiting_payment`.

### 2.2 Migration S1-B: private bucket + attachment locators

- Create **private** bucket `finance-docs` (insert into `storage.buckets`, `public=false`) + `storage.objects` policies for `authenticated`: INSERT/SELECT/DELETE scoped `bucket_id='finance-docs'` (org-scoping via path is a non-goal for v1 — parity with `supplier-returns`; RLS on the attachments table governs discoverability, and object names are unguessable UUIDs).
- `ALTER TABLE purchase_order_attachments ADD COLUMN storage_bucket text, ADD COLUMN storage_path text;` (nullable; legacy rows stay null → `file_url` remains authoritative for them).
- Extend `purchase_order_emails` `email_type` CHECK to add `'po_pop_send'` (Slice 1) and `'po_payment_reminder'` (used by Slice 2) — and fold in the already-drifted `'po_balance_close'` (inserted by `app/api/send-po-balance-closure-email/route.ts:284` but missing from the constraint).

### 2.3 Client: attachment helper + render sites

`lib/db/purchase-order-attachments.ts`:
- `uploadPOAttachment`: `attachmentType IN ('invoice','proof_of_payment')` → upload to `finance-docs`, store `storage_bucket`+`storage_path`, and set `file_url` to the non-authoritative locator; other types unchanged (`QButton` public URL).
- New `getPOAttachmentAccessUrl(att): Promise<string>` — legacy/public rows return `file_url`; `finance-docs` rows return `createSignedUrl(storage_path, 300)` (todos-route precedent `app/api/todos/[todoId]/attachments/[attachmentId]/route.ts:98`; client-side `supabase.storage` works because the storage SELECT policy covers `authenticated`).
- `deletePOAttachment`: delete from the stored bucket/path when present (today it hard-assumes `QButton`, `lib/db/purchase-order-attachments.ts:144`).

Render sites switch from raw `att.file_url` to the resolver (verified list): `POAttachmentManager.tsx` (download :240, open :253, link :298, image :551/:628/:641, preview-modal input), PO-detail invoice chip (`[id]/page.tsx:996/:3511`), PO-detail email-attachment fetch (`[id]/page.tsx:1289`), receipt paperclip (`:2852`). `attachment-preview-modal` keeps taking a URL prop — callers resolve first.

### 2.4 Client: finance board becomes operational (`app/finance/page.tsx`)

- **Awaiting payment** cards: "Record payment" dialog (new `RecordPaymentDialog` beside `RecordInvoiceDialog`; amount prefilled from `invoice_amount`, method eft/cash/card, reference, date, optional POP file) → uploads POP (if given) then `record_payment`; card moves to Awaiting POP optimistically (reconciled on refetch, same pattern as record-invoice). Per-card `react-dropzone` target: dropping a POP file opens the dialog with the file attached.
- **Awaiting POP** cards: sign-off state chip (Signed off ✓ / Awaiting sign-off) + "Sign off" button shown only when `caller_can_authorise`; "Send POP to supplier" button → new email route → on success calls `mark_pop_sent`; "Mark sent" manual fallback → `mark_pop_sent` directly.
- Board API (`/api/finance/pending-supplier-payments`) additions: `caller_can_authorise` (caller's `organization_members.role IN ('owner','admin')`), and per-card `invoice_id`, `signed_off_at`, `pop_attachment_id`, `paid_at` so the Awaiting-POP column can render state without extra queries.
- **Module gate**: add `finance` to `MODULE_KEYS` (`lib/modules/keys.ts`), seed `module_catalog` + `organization_module_entitlements` for QButton (migration S1-C or folded into S1-B), gate the page with `useModuleAccess('finance')` (resolving the page's `TODO(POL-128)` at `app/finance/page.tsx:187`) and the API route with `requireModuleAccess`.

### 2.5 Send-POP email

New route `app/api/send-pop-email/route.ts` cloning `send-po-follow-up` (`app/api/send-po-follow-up/route.ts`): resolve supplier primary email from `supplier_emails` (`is_primary` first), render a minimal React Email template (`emails/pop-email.tsx`) "Please find proof of payment for PO {q_number}", attach the POP file (fetch bytes via signed URL server-side), send via Resend, log `purchase_order_emails` with `email_type='po_pop_send'`. Auth: same authenticated-route pattern as the board API (`authorizedFetch` from the client, per house rule).

### 2.6 Slice 1 acceptance criteria

1. A clerk records a payment (with or without POP file) on an awaiting-payment card → card moves to Awaiting POP; `purchase_order_invoices` has payment fields + `paid_at`; both audit tables have `payment_recorded`.
2. `sign_off_payment` refuses a `staff`-role caller (`insufficient_privilege`) and succeeds for owner/admin; sign-off locks the record (second `record_payment` refused).
3. "Send POP" emails the supplier's primary address with the POP attached, logs `po_pop_send`, and closes the card; "Mark sent" closes without email. Closed cards leave the board.
4. New invoice/POP uploads land in `finance-docs` (private), preview/download works via signed URLs; legacy public attachments still render; deleting a new attachment removes the object from `finance-docs`.
5. `/finance` and its API are module-gated (`finance` key, QButton entitled).
6. Advisors clean (no new findings beyond the intended 0029 baseline); tsc/lint clean on touched files; browser smoke of the full lifecycle on an Apex Manufacturing PO, then test data reverted.

## 3. Slice 2 — detection, escalation, notifications, cron

### 3.1 Migration S2-A: accounts team + detection

- `org_accounts_team (org_id uuid NOT NULL REFERENCES organizations(id), user_id uuid NOT NULL REFERENCES auth.users(id), added_by uuid, created_at timestamptz DEFAULT now(), PRIMARY KEY (org_id, user_id))`, org RLS (SELECT for members; INSERT/DELETE for owner/admin role).
- `detect_cash_po_exceptions(p_org_id uuid) RETURNS integer` — modeled on `compute_customer_order_shortfalls` + `register_closure_item`:
  - One **grouped scan** (EXPLAIN ANALYZE-verified, per the report-RPC perf rule) over cash-supplier POs joined to open `purchase_order_invoices`, producing stall candidates: `cash_invoice_overdue` (no invoice, PO age > 2d), `cash_payment_overdue` (`awaiting_payment` > 2d), `cash_pop_overdue` (`awaiting_pop` > 2d), `po_eta_overdue` (`expected_delivery_date < today`, not fully received).
  - `register_closure_item` per candidate with `source_fingerprint = '<po_id>:<type>'` and `escalation_policy = {"steps":[{"target":"owner","after_minutes":0,"channel":"email"},{"target":"supervisor","after_minutes":2880,"channel":"email"},{"target":"daily_brief","after_minutes":5760,"channel":"brief"}]}`. Calibration: items open at the **2-day** stall mark and step delays are relative to `opened_at`, so owner fires immediately on open (= day 2), accounts at +2d (= day 4), daily brief at +4d (= day 6) — the agreed 2/4/6 cadence. (Owner = PO buyer `created_by`; supervisor target resolved to the accounts team at notification time.)
  - **Auto-close**: active `cash_*`/`po_eta_overdue` closure items whose condition cleared → `close_closure_item(..., 'auto-resolved: condition cleared')` (the engine has no auto-close worker — the detection RPC owns it).
- `ALTER TABLE closure_escalation_events ADD COLUMN processed_at timestamptz;` (notification cursor).

### 3.2 Notification worker (edge function `process-payment-escalations`)

Deno edge function (service role, same `_shared` auth as `agent-closure-rpc`): pull unprocessed `closure_escalation_events` for the cash/ETA source types; per event: `owner` → email the buyer + create a `todo_items` row (via `profiles` id, `context_path='/purchasing/purchase-orders/<id>'`, PO snapshot in `context_snapshot` — numeric ids don't persist in `context_id`, `lib/todos/context-links.ts:16`); `supervisor` → same for each `org_accounts_team` member; `daily_brief` → leave for the daily-brief reader (mark processed only). Emails via **Resend REST API** directly (no React Email in Deno — simple HTML), logged to `purchase_order_emails` with `email_type='po_payment_reminder'` (constraint already extended in S1-B). Stamp `processed_at`.

### 3.3 Cron + router wiring

- `RPC_CONFIG` additions in `agent-closure-rpc` (`supabase/functions/agent-closure-rpc/index.ts:60`): `detect_cash_po_exceptions` (`p_org_id` injected from credential, as the router already enforces).
- OpenClaw runtime cron (existing pattern, agent credential auth): every 30 min call `detect_cash_po_exceptions` → `escalate_due_closure_items` → `process-payment-escalations`. Deliverable: documented curl sequence + cron entry for the OpenClaw mac (install via SSH if reachable, else hand to Greg).

### 3.4 Slice 2 acceptance criteria

1. A stalled awaiting-invoice cash PO (age > 2d) yields a `closure_items` row with the right fingerprint/policy; recording the invoice auto-closes it on the next detection run.
2. `escalate_due_closure_items` + the worker produce: buyer email + todo at level 1; accounts-team email + todo at level 2; daily-brief-visible item at level 3 — each logged and idempotent (no duplicate emails on re-run; `processed_at` cursor).
3. Full RPC chain callable through `agent-closure-rpc` with an agent credential; `EXPLAIN ANALYZE` on detection shows a grouped scan.
4. Advisors/tsc/lint clean; live escalation smoke run end-to-end, then test data cleaned.

## 4. Explicit non-goals (v1)

Migrating the 48 legacy public POP files · account-supplier tracking · working-day-precise thresholds · org-scoped storage-path policies on `finance-docs` · correspondence internalisation (Phase F) · in-app notification centre (todos + email only).

## 5. Verification & rollout

Per slice: migration files + `apply_migration` + `list_migrations` realign + `migration-status.md` + `get_advisors`; `npx tsc --noEmit` + `npm run lint` (touched files); authenticated browser smoke on `:3000` (minted `test@me.com`, Apex Manufacturing data) with test-data cleanup; dcx code-review fleet vs `codex/integration` before each merge; Greg approves each schema-carrying merge. Docs: `purchasing-master.md` (lifecycle + board), `email-integration.md` (new email types), `migration-status.md`. Linear: sub-issues under POL-128 per slice.
