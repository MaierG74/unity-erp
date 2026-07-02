# Cash-Supplier Module Completion — Payment Lifecycle, Finance Board, Escalation

**Status:** Spec approved by Greg (design conversation) · amended per xhigh plan-review (14 findings) · 2026-07-01
**Author:** Claude (local desktop) · **Branch:** `codex/local-cash-payment-lifecycle` (worktree `unity-erp-cash-supplier-tracking`, off `codex/integration` @ `46c3f274`)
**Parent:** [2026-06-27-cash-supplier-invoice-tracking-plan.md](2026-06-27-cash-supplier-invoice-tracking-plan.md) (POL-128). Parts One+Two shipped (POL-129/130 Done).
**Grounding:** 3-agent dcx research pass + adversarial xhigh plan-review, both against this repo; file:line claims verified.

## 0. Real-world flow being modeled (Greg, 2026-07-01)

> Invoice arrives → finance clerk receives it → clerk gives it to the **owner**, who decides and **makes the payment** → owner hands the **POP** back to the clerk → clerk sends POP to the supplier.

Mapping: `record_invoice` (shipped) → clerk/owner `record_payment` → owner `sign_off_payment` (role-gated, locks) → clerk `mark_pop_sent` → `closed`. `request_payment` from the parent plan is **dropped** — recording an invoice already lands in `awaiting_payment`.

## 1. Decisions (locked with Greg, 2026-07-01)

| # | Decision | Choice |
|---|---|---|
| 1 | Sign-off authority | **Org role check** — `organization_members.role IN ('owner','admin')` inside the RPC (no per-user permission system exists; only org roles / module entitlements / platform_admins). Client shows the button via `caller_can_authorise` on the finance API response. |
| 2 | Escalation chain | buyer (`owner` target) → **org accounts team** (new mapping table) → daily brief; 2/4/6-day cadence (see §3.1 calibration). |
| 3 | Scheduler | **External OpenClaw runtime cron** via the existing `agent-closure-rpc` edge router (`RPC_CONFIG` additions). No pg_cron. |
| 4 | File privacy | **New private `finance-docs` bucket** for NEW invoice/POP uploads; reads/deletes server-authorized (see §2.3). 48 legacy public POP files stay put (separate task). |
| 5 | Scope | Cash suppliers only for v1. **Slice 1 = C+E+bucket**, **Slice 2 = D**; each reviews + merges separately. |

## 2. Slice 1 — payment lifecycle + operational finance board + private bucket

### 2.1 Migration S1-A: lifecycle RPCs

All four RPCs: `SECURITY DEFINER`, `SET search_path = public`, `#variable_conflict use_column`, `REVOKE PUBLIC/anon` + `GRANT authenticated, service_role`, and the **20260701205117 hardening pattern**: lock the parent `purchase_orders` row `FOR UPDATE` (serializes every lifecycle transition for a PO — sign-off/reopen/mark-sent cannot interleave), resolve + verify org (`is_org_member`, service_role bypass), validate attachment ownership (belongs to the same PO), write **both** audit trails.

State machine (enforced in-RPC; violations → `check_violation`):
`awaiting_payment →(record_payment)→ awaiting_pop →(mark_pop_sent)→ closed`; `reopen_payment: awaiting_pop|closed → awaiting_payment`.

- `record_payment(p_invoice_id uuid, p_amount_paid numeric, p_payment_date date, p_payment_method text, p_payment_reference text, p_pop_attachment_id uuid DEFAULT NULL, p_note text DEFAULT NULL)` — requires `payment_status='awaiting_payment'` and `signed_off_at IS NULL`; `p_amount_paid > 0`; `p_payment_method IN ('eft','cash','card')`; sets payment fields + `paid_at=now()` + `payment_status='awaiting_pop'`.
- `sign_off_payment(p_invoice_id uuid, p_note text DEFAULT NULL)` — role check: caller must be active `organization_members.role IN ('owner','admin')` for the invoice org (service_role bypasses); requires `payment_status='awaiting_pop'` **and** `pop_sent_at IS NULL` and not already signed off (retro-signing a closed row goes through `reopen_payment` first). Sets `signed_off_by=auth.uid(), signed_off_at=now()`.
- `mark_pop_sent(p_invoice_id uuid, p_pop_attachment_id uuid DEFAULT NULL, p_note text DEFAULT NULL)` — requires `payment_status='awaiting_pop'`; if `p_pop_attachment_id` given, validates + stores it (covers payments recorded without a POP file); if the row still has **no** POP attachment, `p_note` is **required** ("closed without POP because…"). Sets `pop_sent_at=now()`, `payment_status='closed'`. Does not require sign-off (clerk closes the loop; Slice 2 detection flags unsigned closures).
- `reopen_payment(p_invoice_id uuid, p_note text)` — same role check as sign-off; note required; from `awaiting_pop|closed` to `awaiting_payment`; clears payment/sign-off/POP-sent fields.

**Audit contract (pinned):** each RPC writes `po_payment_signoff_activity(action, actor, note, metadata)` with actions `payment_recorded | signed_off | pop_sent | reopened`, and `purchase_order_activity(action_type, description, metadata, performed_by)` with `action_type` = `payment_recorded | payment_signed_off | pop_sent | payment_reopened`, description human-readable (`'Payment recorded — R1740.00 (eft)'` style), metadata = `jsonb_build_object('invoice_id', …, 'amount_paid'/'payment_reference'/'pop_attachment_id'/'note' as relevant)`.

### 2.2 Migration S1-B: private bucket, attachment tenancy, email types

- **Bucket**: insert `finance-docs` into `storage.buckets` with `public=false`. Storage policies: `authenticated` gets **INSERT only**, scoped `bucket_id='finance-docs' AND (storage.foldername(name))[1] = (SELECT org_id::text FROM …caller's org…)` — uploads write to `<org_id>/purchase-orders/<po_id>/<uuid>.<ext>`. **No authenticated SELECT/DELETE** — reads and deletes go through server routes using the service role after row-level authorization (plan-review blocker: bucket-wide SELECT would let any signed-in user sign any path they learn).
- **Attachment tenancy (plan-review blocker)**: `uploadPOAttachment` inserts no `org_id`; the column is NOT NULL with a hard-coded QButton default. Add BEFORE INSERT/UPDATE trigger `po_attachments_enforce_org` deriving/validating `org_id` from the parent PO (same shape as `po_invoices_enforce_org`, `20260701205117`), then **drop the column default**. This also closes the pre-existing app-wide gap (supersedes the spun-off background task).
- `ALTER TABLE purchase_order_attachments ADD COLUMN storage_bucket text, ADD COLUMN storage_path text;` (nullable; legacy rows null → `file_url` authoritative for them).
- `purchase_order_emails.email_type` CHECK: recreate with `'po_pop_send'`, `'po_payment_reminder'`, **and** the already-drifted `'po_balance_close'` (inserted by `send-po-balance-closure-email/route.ts:284`, never added to the constraint).

### 2.3 Client + server: attachment access

`lib/db/purchase-order-attachments.ts`:
- `POAttachment` type gains `storage_bucket: string | null; storage_path: string | null`.
- `uploadPOAttachment`: for `attachmentType IN ('invoice','proof_of_payment')` → upload to `finance-docs` under the org-prefixed path, store `storage_bucket`/`storage_path`, `file_url` = non-authoritative locator; other types unchanged (`QButton`, public URL). (`org_id` on the row comes from the new trigger.)
- `deletePOAttachment(attachment: POAttachment)` (signature change; today it hard-parses QButton from a URL, `:144`): public rows delete client-side as before; `finance-docs` rows call the server delete route.

New server routes (both `requireModuleAccess('finance')`-free — they serve PO attachments generally — but **authenticated + row-authorized**: fetch the attachment row via the caller's RLS client first; no row → 404):
- `GET /api/purchase-orders/attachments/[id]/access-url` → returns a fresh 300s signed URL (service-role `createSignedUrl`), following the todos-route pattern (`app/api/todos/[todoId]/attachments/[attachmentId]/route.ts:86` — row check **before** signing).
- `DELETE /api/purchase-orders/attachments/[id]` → removes the object (service role) + the row (caller RLS client).

**Render sites** switch from raw `att.file_url` to an async resolver `getPOAttachmentAccessUrl(att)` (returns `file_url` for legacy/public; calls the access-url route for `finance-docs`), resolving **freshly on each action** (plan-review: a 300s URL must not be cached in `href`/`img.src` — resolve on click/open, and preview-modal callers resolve at open time): `POAttachmentManager.tsx` download `:240` / open `:253` / link `:298` / image preview `:551,:628,:641`; PO-detail invoice chip `[id]/page.tsx:996/:3511` (the chip now points at the resolver-backed handler since new invoices are private); PO-detail email-attachment fetch `:1289`; receipt paperclip `:2852`.

### 2.4 Client: finance board becomes operational (`app/finance/page.tsx`)

- **Awaiting payment** cards: "Record payment" dialog (new `RecordPaymentDialog`; amount prefilled from `invoice_amount`, method eft/cash/card, reference, date, optional POP file) → uploads POP (if given) then `record_payment`; optimistic move to Awaiting POP (record-invoice pattern). Per-card `react-dropzone`: dropping a POP opens the dialog with the file attached.
- **Awaiting POP** cards: sign-off chip (Signed off ✓ / Awaiting sign-off) + "Sign off" button when `caller_can_authorise`; "Send POP to supplier" → email route → on success `mark_pop_sent`; "Mark sent" fallback → `mark_pop_sent` (dialog collects the required note when no POP file exists). Closed cards leave the board (already shipped).
- **Board API** additions: `caller_can_authorise`; per-card `invoice_id`, `paid_at`, `signed_off_at`, `pop_attachment_id`.
- **Module gate (all three surfaces, plan-review)**: `finance` in `MODULE_KEYS` + `module_catalog` seed + QButton entitlement (migration S1-B); page gates rendering **and** the react-query `enabled` on `useModuleAccess(MODULE_KEYS.FINANCE).allowed` (today it fetches whenever `!!user`, `page.tsx:152`); board API + send-POP route use `requireModuleAccess`.

### 2.5 Send-POP email

`app/api/send-pop-email/route.ts`: **authenticated route client + `requireModuleAccess('finance')` + org-scoped queries** (unlike the `send-po-follow-up` precedent, which is service-role without route auth — do not copy that part). Resolve supplier primary email (`supplier_emails`, `is_primary` first); render minimal React Email template `emails/pop-email.tsx`; fetch POP bytes server-side (service role, storage path); send via Resend; log `purchase_order_emails` with `email_type='po_pop_send'` **and `org_id`**. Client calls via `authorizedFetch`. Update the email-type TS unions + labels (`app/purchasing/purchase-orders/page.tsx:85`, `[id]/page.tsx:3048`) for `po_pop_send`/`po_payment_reminder`/`po_balance_close`.

### 2.6 Slice 1 acceptance criteria

1. Clerk records a payment (with/without POP) → card moves to Awaiting POP; payment fields + `paid_at` set; both audit tables carry `payment_recorded`.
2. `sign_off_payment` refuses `staff` (`insufficient_privilege`), succeeds for owner/admin, requires awaiting_pop + POP-not-sent; a signed-off row refuses `record_payment`.
3. "Send POP" emails the supplier's primary address with the POP attached, logs `po_pop_send` (with org_id), closes the card; "Mark sent" without a POP file demands a note. `mark_pop_sent(p_pop_attachment_id)` can attach a late POP.
4. New invoice/POP uploads land in `finance-docs` under `<org>/purchase-orders/<po>/…` with `storage_bucket/path` + correct `org_id` (trigger); preview/download/open work via fresh server-signed URLs; a direct client `storage.from('finance-docs').download()` fails (no SELECT policy); legacy public attachments still render; deleting a finance attachment removes object + row.
5. `/finance` page, board API, and send-POP route are module-gated; non-entitled org member sees the gate, API returns 403.
6. Advisors clean; tsc/lint clean on touched files; browser smoke of the full lifecycle on an Apex Manufacturing PO (record payment → sign off → send/mark POP → card leaves board → reopen), then test data reverted.

## 3. Slice 2 — detection, escalation, notifications, cron

### 3.1 Migration S2-A: accounts team + detection

- `org_accounts_team (org_id, user_id, added_by, created_at, PK(org_id,user_id))`, org RLS (SELECT members; INSERT/DELETE owner/admin).
- `detect_cash_po_exceptions(p_org_id uuid) RETURNS integer` — modeled on `compute_customer_order_shortfalls` + `register_closure_item`:
  - One grouped scan (EXPLAIN ANALYZE-verified) with a **LEFT JOIN** from cash-supplier POs to open `purchase_order_invoices` (plan-review: POs with no invoice row ARE the `awaiting_invoice` population — an inner join misses them; mirror the board's null-handling, `route.ts:174`). Candidates: `cash_invoice_overdue` (no open invoice, PO age > 2d, not fully received/cancelled), `cash_payment_overdue` (`awaiting_payment` > 2d), `cash_pop_overdue` (`awaiting_pop` > 2d), `po_eta_overdue` (`expected_delivery_date < today`, not fully received), `cash_closed_unsigned` (`payment_status='closed'` with `signed_off_at IS NULL`, `pop_sent_at` within the last 30 days — the clerk closed the loop without the owner's stamp; auto-closes when signed off after reopen, or when it ages out of the window).
  - `register_closure_item` per candidate, fingerprint `'<po_id>:<type>'`, policy `{"steps":[{"target":"owner","after_minutes":0,"channel":"email"},{"target":"supervisor","after_minutes":2880,"channel":"email"},{"target":"daily_brief","after_minutes":5760,"channel":"brief"}]}` — **and `p_next_escalation_at := now()` for newly-registered items** (plan-review blocker: the default is NULL and `escalate_due_closure_items` skips NULL rows, `closure_engine_rpcs.sql:147/:646`). Calibration: items open at the 2-day stall mark; owner fires on open (=day 2), accounts +2d (=day 4), brief +4d (=day 6). **No catch-up for pre-existing backlog**: an already-old PO opens today and starts its chain today (declared v1 behavior).
  - **Auto-close**: active `cash_*`/`po_eta_overdue` items whose condition cleared → `close_closure_item(..., 'auto-resolved: condition cleared')` (the engine has no auto-close worker; detection owns it).
- `ALTER TABLE closure_escalation_events ADD COLUMN processing_started_at timestamptz, ADD COLUMN processed_at timestamptz, ADD COLUMN delivery_status text;` + UPDATE policy for service role (table is append-only today) — plus **claim RPC** `claim_escalation_events(p_org_id, p_source_types text[], p_limit int)`: atomic `UPDATE … SET processing_started_at=now() WHERE processed_at IS NULL AND (processing_started_at IS NULL OR processing_started_at < now()-interval '15 minutes') RETURNING …` (plan-review blocker: `processed_at` alone is not idempotent; stale claims become reclaimable after 15 min).

### 3.2 Notification worker (edge function `process-payment-escalations`)

Deno edge function (service role): `claim_escalation_events` → per event: `owner` → email buyer + todo; `supervisor` → email + todo per `org_accounts_team` member; `daily_brief` → mark processed only. **Todos**: insert `todo_items` with `created_by = assigned_to = <target's profiles.id>` (FK is to `profiles`, not auth.users — skip + log `delivery_status='no_profile'` if absent), `context_path='/purchasing/purchase-orders/<id>'`, PO snapshot in `context_snapshot` (numeric ids don't persist in `context_id`, `lib/todos/context-links.ts:16`), **plus a `todo_activity` 'created' row** (the API does this; the worker must too, `app/api/todos/route.ts:164`). **Idempotency**: delivery key `<event_id>:<recipient>` recorded in email/todo metadata; the claim mechanism prevents re-sends, the key makes retries detectable. **Emails**: Resend REST directly (no React Email in Deno — simple HTML), logged to `purchase_order_emails` with `email_type='po_payment_reminder'` + `org_id`. Finish: `processed_at=now(), delivery_status='sent'|'partial'|'failed'`.

### 3.3 Cron + router wiring

- `RPC_CONFIG` additions in `agent-closure-rpc` (`index.ts:60`): `detect_cash_po_exceptions` (router already overwrites `p_org_id` from the agent credential) — `escalate_due_closure_items` is already exposed.
- OpenClaw runtime cron: every 30 min, `detect_cash_po_exceptions` → `escalate_due_closure_items` → invoke `process-payment-escalations`. Deliverable: documented curl sequence + cron entry for the OpenClaw mac (install via SSH if reachable, else hand to Greg).

### 3.4 Slice 2 acceptance criteria

1. A stalled awaiting-invoice cash PO (> 2d, **including one with zero invoice rows**) yields a closure item with correct fingerprint/policy **and non-null `next_escalation_at`**; recording the invoice auto-closes it on the next run. A closure marked POP-sent without sign-off yields a `cash_closed_unsigned` item.
2. Escalate + worker produce: buyer email + todo (with `todo_activity`) at level 1; accounts-team email + todo at level 2; daily-brief item at level 3 — re-running the worker sends **zero** duplicates (claim + delivery keys).
3. Full chain callable through `agent-closure-rpc` with an agent credential; `EXPLAIN ANALYZE` on detection shows a grouped scan.
4. Advisors/tsc/lint clean; live end-to-end escalation smoke, then test data cleaned.

## 4. Explicit non-goals (v1)

Migrating the 48 legacy public POP files · account-supplier tracking · working-day-precise thresholds · backlog catch-up for pre-existing stalls · correspondence internalisation (Phase F) · in-app notification centre (todos + email only).

## 5. Verification & rollout

Per slice: migration files + `apply_migration` + `list_migrations` realign + `migration-status.md` + `get_advisors`; `npx tsc --noEmit` + `npm run lint`; authenticated browser smoke on `:3000` (minted `test@me.com`, Apex Manufacturing data) with test-data cleanup; dcx code-review fleet vs `codex/integration` before each merge; Greg approves each schema-carrying merge. Docs: `purchasing-master.md`, `email-integration.md`, `migration-status.md`. Linear: sub-issues under POL-128 per slice.
