## User Activity Logging Plan

> Working document for adding per-action user logging across Unity ERP. Treat as the authoritative plan until implementation ships.

> **See also:** [`permissions-and-logging-plan.md`](../plans/permissions-and-logging-plan.md) for the coordinated roadmap covering role management, permissions UI, and RLS integration.

### Objectives
- Capture a durable audit trail for every meaningful user action (CRUD, auth, workflow transitions).
- Centralize logs in Supabase/Postgres so downstream analytics, compliance, and incident review share a single source of truth.
- Minimize friction for feature teams by providing shared utilities and conventions rather than ad-hoc logging.
- Respect privacy: only store data required for debugging/compliance and enforce row-level security for access.

### Scope & Priorities
1. **Critical write paths**: Orders, Quotes, Purchasing, Inventory adjustments, Staff & Attendance updates.
2. **High-signal reads**: Sensitive data access (e.g., downloading purchase order PDFs).
3. **Authentication & session**: Sign-in/out, password reset, bypass usage.
4. **System actions**: Scheduled jobs, automated emails, RPC invocations (mark as `actor_type = system`).

Roll out iteratively: start with server-driven mutations (API routes/server actions), then wrap client-side Supabase mutations, then add DB-trigger coverage for direct SQL/RPC paths.

### Target Architecture
```
[Next.js route / server action]
        │ (with request metadata: user, route, ip, request_id)
        ▼
  logUserActivity helper  ──▶ Supabase REST (service role) ──▶ user_activity_logs table
        ▲
        │ optional: include related entity metadata (type, id, snapshot)
```
Additional appenders:
- **Database triggers** on core tables to capture writes that bypass application code.
- **Supabase Edge Function** (optional) for logging from scripts/integrations outside Next.js.

### Data Model (Supabase `user_activity_logs`)
| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | `gen_random_uuid()` default. |
| `occurred_at` | `timestamptz` | Default `now()`. |
| `actor_id` | `uuid` | References `auth.users.id`; nullable for system events. |
| `actor_type` | `text` | Enum-ish: `user`, `service`, `system`. |
| `actor_email` | `text` | Denormalized for quick scans. |
| `session_id` | `text` | Supabase session UUID when available. |
| `action` | `text` | Verb such as `order.create`, `purchase_order.approve`. |
| `entity_type` | `text` | Domain noun (`order`, `purchase_order`, `inventory_transaction`). |
| `entity_id` | `text` | Flexible: store PK or composite key (`order:123`). |
| `metadata` | `jsonb` | Structured payload (diff, field values, context). |
| `request_id` | `uuid` | Generated per request to correlate multi-step flows. |
| `route` | `text` | Next.js pathname (`/purchasing/purchase-orders/123`). |
| `ip_address` | `inet` | From headers; sanitize per privacy policy. |
| `user_agent` | `text` | Optional for debugging. |
| `success` | `boolean` | `true` if action completed, `false` if aborted/error. |
| `error_message` | `text` | Short reason on failure events. |

**Indexes**
- `(entity_type, entity_id, occurred_at DESC)` for investigations.
- `(occurred_at DESC)` for recent activity feeds.
- `(actor_id, occurred_at DESC)` for user history.
- GIN on `metadata` for targeted JSON queries if needed later.

**Policies**
- Insert restricted to service role or dedicated `log_writer` role used by API layer.
- Select limited to privileged roles (`auditor`, `admin`). Consider row filters for department-specific auditors.
- Future: materialized view for per-user “Recent activity” if product needs it; separate from audit table to avoid exposing raw data.

### Logging Utilities
- `lib/logging.ts`
  - `createRequestContext(req)` → derives `requestId`, `route`, `ip`, `userAgent`.
  - `logUserActivity({ actor, action, entity, metadata, success, error })` → pushes record via `supabaseAdmin`.
  - `withActivityLogging(handler, descriptor)` higher-order helper for API routes/server actions to auto-log success/failure.
- Ensure helper gracefully degrades (warn to console in dev if Supabase not configured) but never blocks user flow.

### Instrumentation Strategy
1. **Next.js API routes & server actions**
   - Wrap every mutation route (e.g., `app/api/send-purchase-order-email`, `app/api/orders/*`).
   - Use middleware/HOF to log both completion and error cases with shared context.
   - Pass `entity_type`/`entity_id` + important fields in `metadata` (e.g., quantities, status transitions).
2. **Client components using Supabase directly**
   - Inventory forms, attendance adjustments currently call Supabase from the browser.
   - Plan: introduce backend endpoints (preferred) or call a Supabase RPC `log_user_activity(action, entity, metadata)` with the anon key. RPC enforces `auth.uid()` and writes via security definer.
   - Migration path: create wrappers (`useSupabaseMutationWithLogging`) to standardize instrumentation while teams gradually refactor.
3. **Database triggers / functions**
   - For tables modified via SQL scripts or Supabase dashboard, add AFTER INSERT/UPDATE/DELETE triggers that call a security-definer function writing to `user_activity_logs`.
   - Example: `orders`, `purchase_orders`, `supplier_orders`, `inventory_transactions`, `time_daily_summary`.
   - Function receives `current_setting('request.jwt.claim.sub', true)` to capture actor when available; fallback to `system`.
4. **Scheduled jobs / scripts**
   - Scripts in `/scripts/*.ts` using service role should call logging helper with `actor_type = service` and a synthetic actor ID.
5. **Supabase Auth events**
   - Subscribe to `supabase.auth.onAuthStateChange` client-side and send sign-in/out events via a lightweight `/api/activity/auth` endpoint to avoid storing secrets in logs.

### Event Taxonomy (initial)
| Action | When to log | Metadata highlights |
| --- | --- | --- |
| `auth.sign_in` | Successful login | `provider`, `user_email`, `ip_address`. |
| `auth.sign_out` | Manual or forced logout | `reason`. |
| `order.create` | New customer order | `order_number`, `customer_id`, `line_count`. |
| `order.update` | Any edit | Changed fields diff. |
| `order.status_change` | Workflow transitions | `from_status`, `to_status`. |
| `purchase_order.submit_for_approval` | Submit PO | `purchase_order_id`, `line_count`. |
| `purchase_order.approve` | Approvals | `q_number`, `total_value`. |
| `purchase_order.receive` | Receiving goods | `line_id`, `qty_received`, `remaining_qty`. |
| `quote.create / update / send` | Quote lifecycle | `quote_id`, `status`. |
| `inventory.adjust` | Manual adjustments | `component_id`, `qty_delta`, `reason`. |
| `attendance.edit` | Manual time edits | `staff_id`, `date`, `delta_minutes`. |
| `staff.create / update / deactivate` | Staff maintenance | `staff_id`, key fields. |
| `document.download` | PDF exports/email attachments | `doc_type`, `entity_id`. |
| `system.job` | Background job runs | `job_name`, `duration_ms`, `result`. |

Extend taxonomy as new modules appear; keep naming convention `<entity>.<verb>` for consistency.

### Request Correlation
- Generate a UUID per incoming request (Next.js middleware or helper) and attach to `res.locals` / React context.
- Include `request_id` in all logs generated during that request (UI mutation + downstream operations) to reconstruct sequences.
- Surface `request_id` to client on error responses for support teams.

### Data Retention & Monitoring
- Retain full audit history for ≥ 2 years (configurable). Consider nightly job to archive older logs to cold storage (Supabase storage bucket or external warehouse).
- Build Supabase dashboard or Metabase view for admins to query logs by user/entity/date.
- Add alerts for suspicious patterns (e.g., >50 deletes in 5 minutes) once baseline is established.

### Rollout Plan
1. **Design review & schema migration**
   - Finalize table definition, indexes, policies. Ship via SQL migration under `migrations/` + update `schema.txt`.
2. **Utility layer**
   - Implement `lib/logging.ts`, export typed helpers, add unit tests.
3. **Middleware & context plumbing**
   - Add Next.js request middleware to create `request_id`, capture route/ip/user-agent. Store on `NextRequest`/`NextResponse` objects.
4. **Instrument high-value API routes**
   - Start with Purchasing (`send-purchase-order-email`, PO approve/receive endpoints), Quotes, Orders.
   - Ensure failure paths log `success = false` with `error_message`.
5. **Refactor client-side mutations**
   - For each module, decide between migrating to server action or adding RPC logging wrapper.
   - Document progress in respective module plans (e.g., append to `purchasing-master.md`).
6. **Add DB triggers for bypass paths**
   - Focus on direct SQL updates (inventory adjustments, attendance recalculations).
7. **Reporting & tooling**
   - Create Supabase saved queries/dashboard; optional admin UI page for per-entity audit trail.
8. **QA & verification**
   - Create seed data and script to simulate actions; verify logs captured with correct metadata.
9. **Production rollout**
   - Deploy migration, utilities, instrumentation. Monitor log volume/perf. Adjust indexes or partitioning if needed.

### Open Questions
- Do we need soft-deletion tracking for logs (GDPR/PII erasure requests)? If so, implement encrypted columns or anonymization routine.
- Should certain modules (HR/payroll) require additional masking before storing metadata?
- Is there a requirement to stream logs to external SIEM (e.g., Splunk)? Keep architecture flexible by building helper around a provider interface.
- What retention/backup policy satisfies compliance? Confirm with stakeholders before enabling automatic purges.

Keep this plan current as implementation progresses. Add sections for schema snippets, API examples, and dashboard specs once work begins.
