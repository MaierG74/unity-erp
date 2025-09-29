# Unity ERP – To-Do Module Plan

---
## Status
- Draft – 2025-03-05
- Owners: Product + Engineering (TBD)

## Purpose & Vision
Create a lightweight but reliable tasking system so teammates can assign, track, and complete actionable items without leaving Unity ERP. Every task must anchor back to the underlying business record (order, quote, supplier PO, time entry, etc.) so context is instant and nobody has to hunt for the right screen.

## Goals (MVP)
- Per-user dashboard that lists tasks assigned to me, tasks I delegated, and any team tasks I am watching.
- Simple task authoring with title, description, due date, priority, and contextual link to an ERP record.
- Real-time updates when a task changes state (open → in_progress → done → archived), including completion visibility for both assignee and assigner.
- Supabase-authenticated access with secure RLS: only participants (assignee, creator, watchers) can view or mutate a task.
- Inline navigation: clicking the linked record opens the correct screen and scrolls/highlights if deep-linking is supported.

## Non-goals (for later phases)
- Recurring or templated tasks.
- External email/SMS delivery.
- Kanban / calendar visualization.
- Cross-tenant sharing or public tasks.
- Automation rules that auto-create tasks from business events (capture ideas but do not ship in MVP).

## Primary Use Cases
1. **Manager → Employee Follow-up**: assign a supplier order follow-up, include due date and link to the purchase order detail screen.
2. **Peer Review**: request a teammate to double-check a customer quote; both parties track completion and comments.
3. **Self Reminders**: create personal tasks linked to a customer or order to remind future action.
4. **Handoffs**: log plant-floor TODOs when shifts change, referencing the production job or time entry.

## Entity Reference Strategy
Link the task to any ERP record without hard-coding each table per feature.
- Introduce an `app_entities` registry that stores the canonical ID, type (`order`, `purchase_order`, `quote`, `component`, etc.), display label, and deep-link URL/route. Existing modules can register entities when data loads or via migrations.
- Tasks store a pointer (`entity_id` FK -> `app_entities.id`). This keeps the task schema stable while new modules register additional entity types.
- If `app_entities` is too heavy for MVP, fallback: keep `context_type` (enum) + `context_id` (UUID) + `context_path` (string) with validation functions per type. Note in plan which path we pick before implementation.
- Capture `context_snapshot` JSON (title, status, key metrics) so the dashboard can render helpful summary even if the linked record changes or the user loses access later.

## UX Overview
### Entry Points
- Global “Create Task” button in the top navigation (consistent with `[docs/overview/STYLE_GUIDE.md]` modal patterns).
- Contextual quick actions in entity detail views (e.g., `/orders/[orderId]` gets a “Create Task” button pre-filled with the order reference).

### Task Composer Modal
- Fields: `Title`, `Description (rich text lite)`, `Due date`, `Priority`, `Assign to`, `Watchers`, `Linked record` (search across entity registry), optional `attachments` (plan for later, not MVP).
- Default assignee is the creator; due date optional; watchers optional.

### Dashboard (`/todos`)
- Tabs or filters: `Assigned to me`, `Created by me`, `Watching`, `Completed` history.
- Each row shows status pill, due date, linked entity chip, participants avatars, last activity timestamp.
- Inline actions: mark done, reopen, edit, add comment.
- Activity pane: chronological feed (created, status changes, comments) aligning with existing feed patterns in other modules if available.

### Detail Drawer / Modal
- Clicking a row opens a drawer with full description, comments, audit log, and quick link navigation to the referenced entity.

## Data Model (Proposed)
### Tables
- **todo_items**
  - `id` (uuid, pk)
  - `title` (text)
  - `description` (text, nullable)
  - `status` (enum: `open`, `in_progress`, `blocked`, `done`, `archived`)
  - `priority` (enum: `low`, `medium`, `high`, future `urgent`)
  - `due_at` (timestamp with time zone, nullable)
  - `created_by` (uuid referencing `auth.users.id`)
  - `assigned_to` (uuid referencing `auth.users.id`)
  - `entity_id` (uuid referencing `app_entities.id` if registry chosen)
  - `context_type`, `context_id`, `context_path` (fallback fields if registry not ready)
  - `context_snapshot` (jsonb)
  - `completed_at` (timestamp)
  - `completed_by` (uuid; for audit when someone else closes on behalf of assignee)
  - `acknowledged_at` (timestamp; optional handshake so assigner can confirm completion)
  - `created_at`, `updated_at`

- **todo_watchers**
  - `todo_id` (uuid fk -> `todo_items.id`)
  - `user_id` (uuid fk -> `auth.users.id`)
  - `created_at`
  - Composite pk `(todo_id, user_id)`.

- **todo_activity** (append-only for audit + realtime broadcasting)
  - `id` (uuid)
  - `todo_id`
  - `event_type` (`created`, `status_changed`, `comment`, `due_date_changed`, `acknowledged`)
  - `payload` (jsonb with diff details)
  - `performed_by` (uuid)
  - `created_at`

- **todo_comments** (optional for MVP; otherwise merge into `todo_activity`)
  - `id`, `todo_id`, `body`, `created_by`, `created_at`.

### Supporting Views
- `todo_dashboard_view` – pre-joins tasks with entity snapshot + participants for UI.
- `todo_notifications_queue` – view or materialized view for new events to push via edge functions.

## Supabase Auth & RLS
- All user IDs reference `auth.users.id`; continue surfacing display names via `profiles` table.
- RLS on `todo_items`:
  - `SELECT`: allowed for `created_by`, `assigned_to`, or watchers.
  - `INSERT`: only authenticated users; `created_by` must equal `auth.uid()`.
  - `UPDATE`: permitted for `assigned_to` (status, comments) and `created_by` (edits). Use policies scoped to event type (e.g., assignment changes only by creator).
  - `DELETE`: disabled; use `archived` status instead.
- `todo_watchers`: `SELECT`/`INSERT` for participants.
- `todo_activity`: `SELECT` for participants, `INSERT` by Postgres function (`log_todo_event`) invoked via Supabase RPC to centralize validation.
- Consider Postgres triggers to ensure `todo_activity` records mirror key mutations (status, due date, assignment). Avoid trusting client for audit.

## API Surface
- REST endpoints via Next.js Route Handlers mirroring existing patterns (see `app/api/quotes/...`).
- Core routes:
  - `POST /api/todos` – create task. Validates entity reference and participants.
  - `GET /api/todos` – list tasks with filters (`assigned_to`, `created_by`, `status`, `search`).
  - `GET /api/todos/[id]` – fetch detail including activity.
  - `PATCH /api/todos/[id]` – update status, due date, participants.
  - `POST /api/todos/[id]/comments` – add comment (if separate table).
  - `POST /api/todos/[id]/acknowledge` – assigner confirms completion.
- Server helpers in `lib/db/todos.ts` with typed responses; ensures entity metadata is hydrated for UI.

## Notifications & Realtime
- Use Supabase Realtime on `todo_activity` to push UI updates for participants.
- Optional: Edge Function to queue email/push notifications later; MVP can rely on in-app toasts + realtime.
- Desktop notifications: reuse global notification system if available (see `docs/overview/master-plan.md` for messaging vision).

## Phased Implementation
1. **Foundation**
   - Create schema, RLS, minimal API, and `/todos` dashboard listing `Assigned to me` & `Created by me`.
   - Entity reference uses `context_type/context_id` fallback; store `context_path` to navigate.
2. **Entity Registry Upgrade**
   - Implement `app_entities` population for core modules (orders, quotes, suppliers, products).
   - Migrate tasks to use `entity_id` FK; keep snapshots for resiliency.
3. **Collaboration Enhancements**
   - Comments feed, watchers, realtime presence indicators, `acknowledged` handshake.
   - Integrate notifications panel.
4. **Stretch**
   - Attachments, recurring tasks, automation triggers, cross-module analytics (tasks per module, overdue counts).

## Integration Touchpoints
- Orders, Quotes, Products, Suppliers detail pages need APIs to fetch open tasks referencing the record (badge counts, inline list).
- Global search component extends to include tasks and entity registry results.
- Sidebar or top-nav indicator for number of open tasks assigned to current user.

## Risks & Mitigations
- **Entity explosion**: Without a registry we risk brittle enum lists. Mitigation: align on registry before shipping or keep strong validation functions per module.
- **RLS complexity**: More participants mean more policies. Keep policies narrow and rely on Postgres functions for complex writes.
- **Notification fatigue**: Provide notification preferences per user in future iterations.
- **Performance**: Dashboard queries may join multiple tables; use materialized view or denormalized snapshot fields to keep UI fast.

## Open Questions
- Do we need sub-tasks or checklist items in MVP?
- Should we allow multi-assignee tasks or enforce single owner with watchers?
- How do we seed historical tasks or migrate from existing tracking methods (if any)?
- What is the minimal entity metadata required for a useful snapshot (status, reference number, customer)?
- Should comments support attachments from day one?

## Next Steps
1. Align on entity reference approach (`app_entities` vs enum fallback) and document population strategy.
2. Validate dashboard UX with stakeholders; confirm priority/due-date fields satisfy workflows.
3. Draft Supabase migration scripts and RLS policies; schedule review with security owner.
4. Spike on entity search experience to ensure linking is fast for large datasets.
