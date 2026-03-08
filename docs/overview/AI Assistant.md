# AI Assistant for Unity ERP

This document proposes an integrated AI Assistant for Unity ERP that enables natural-language insights and actions across Inventory, Orders, Quotes, Components, Collections (BOM), Attendance, and more. The assistant will be safe-by-default, RLS-aware, and auditable. We outline practical use cases, technical architecture, data access patterns for Supabase, guardrails, and a phased rollout.

---

## Goals
- Provide fast, natural-language answers for day-to-day operational questions (stock levels, open orders, quote status, etc.).
- Offer page-scoped “copilot” assistance (context-aware explanations, suggestions, and shortcuts).
- Stay safe-by-default: enforce RLS, log/audit every tool call, and require explicit human confirmation for any write action.
- Reduce training overhead by answering “how do I…?” questions using our own `docs/` as the knowledge base.
- Build reusable assistant “tools” on top of Supabase, so we can expand capabilities incrementally.

## Non-Goals (initially)
- Fully autonomous operations (placing POs, updating BOMs) without human confirmation.
- Arbitrary free-form SQL generation against production. We will begin with a curated query catalog and RPCs.

---

## High-Value Use Cases (Initial Targets)
These map to current tables (from Supabase) like `components`, `inventory`, `inventory_transactions`, `orders`, `customers`, `quotes`, `quote_items`, `billofmaterials`, `bom_collections`, and related joins.

- Inventory
  - “How much stock do we have for component X?” → `inventory` joined to `components` by `component_id`; support filtering by `location`.
  - “Which items are below reorder level?” → `quantity_on_hand < reorder_level` in `inventory`.
  - “Show recent inventory movements for [component]” → `inventory_transactions` by `component_id`, last N days.

- Orders (Customer) and Fulfillment
  - “List current open customer orders” → `orders` filtered by status; join `customers` for name and contact info.
  - “Which orders are late or due this week?” → `orders.delivery_date` vs today; status filter.
  - “What’s blocking order #123?” → summarize shortages by expanding BOM (from `billofmaterials`) and comparing with `inventory` (shortage report).

- Quotes and Sales
  - “Find quotes for customer X from last month” → `quotes` with `customer_id` joined to `customers`, date range filter.
  - “Summarize quote Q-001” → aggregate `quote_items` (and clusters if present) and show totals, VAT, terms (via `quote_company_settings`).
  - “Draft a follow-up email for quote Q-001” → text generation only (no send), user approves and sends through existing workflow.

- Components and BOM/Collections
  - “What components are used in product P?” → `billofmaterials` join `components`.
  - “Show the BASE-CHAIR collection content” → `bom_collections` + `bom_collection_items` join `components`.
  - “Which components are most frequently used in quotes?” → aggregate over `quote_items` and `quote_cluster_lines` (when applicable).

- Attendance (optional early read-only scope)
  - “Who has clocked in today?” → query current day clock events/summary tables (respect RLS and known API caveats on `time_daily_summary`).
  - “Show [staff] work segments for [date]” → existing segments/events logic, with careful filtering and timezone handling.

- Knowledge and Onboarding
  - “How do I publish a collection?” → RAG over `docs/` (e.g., `docs/domains/components/subcomponent-planning-and-execution.md`) to answer from our own documentation.
  - “Explain this screen” → page-scoped assistant that knows UI routes and relevant docs.

---

## UX Patterns
- Global Command Palette / Chat Dock
  - Keyboard shortcut opens a small prompt window; answers stream inline with quick actions (e.g., “Open order detail”, “Export as CSV”).
- Page-Scoped Copilot
  - On a product page: “Why is this product’s cost high?” → shows cost breakdown using BOM and current supplier costs where available.
  - On quotes: “Turn this draft into a customer-ready PDF and summarize changes since last version.”
- Slack/Email Summaries (later phase)
  - “Every morning at 8am, send a summary of late POs and low stock” → scheduled queries + webhook/email.

### Prototype Status (2026-03-06)
- A first UI shell now exists as a floating assistant launcher rendered from the shared app layout.
- The first structured assistant card is now live for production staffing answers, so the dock can render a compact table with metrics instead of only plain-text chat output.
- Structured assistant table cards are now live for production staffing, unassigned production work, inventory snapshot answers, open-order answers, order-search answers, late-order answers, low-stock answers, due-this-week order answers, supplier follow-up answers, supplier-order-by-item answers, next-delivery answers, late-supplier-order answers, manufacturing-progress answers, manufacturing-status answers, and latest-customer-order answers, and the first structured chart card is now live for "orders last 7 days" trend questions, so the dock can render compact operational summaries instead of only plain-text chat output.
- The chat dock now gives these cards clearer visual hierarchy with domain-tinted headers, stronger metric tiles, status badges, and cleaner row treatment so operational answers read more like mini dashboards than raw tables.
- Card actions can now expose clickable record links for high-value answers like recent customer orders, so the assistant can open the matching order directly instead of only naming it in chat text.
- Current prototype behavior is intentionally narrow:
  - Unity-only scope
  - no general web/world knowledge
  - no hallucinated answers
  - if no trusted tool is available, the assistant says "I don't know" instead of guessing
  - request interpretation is now model-assisted with `gpt-5-mini`, but verified answers still come only from trusted Unity data tools
- Live read-only tools now shipped:
  - inventory snapshot questions from the assistant chat dock
  - operational summary questions for open customer orders, due-this-week orders, late orders, and below-reorder inventory
  - customer-scoped operational summaries and short order lists for prompts like "How many open orders for Office Group?", "Show open orders for Office Group", "Which orders are due this week for Typestar?", and "Which orders are late for Typestar?"
  - per-order blocker summary using the existing component shortfall RPC where order component data exists
  - product and order manufacturing status questions for prompts like "Has product TEST-002 been manufactured?", "Who manufactured TEST-002?", "When was TEST-002 completed?", "Has order TEST-LC-001 been manufactured?", and "Who completed order Test5566?"
  - production-list summaries for prompts like "Which orders are still in production?", "Which orders finished this week?", "Who is working on orders in production?", and "Which orders have unassigned work?"
  - a structured table card for production-staffing answers, with summary metrics and per-order staff assignment rows inside the chat dock
  - a structured table card for unassigned production work, showing which active orders still need staff assignment
  - a structured card for inventory snapshot answers, including on-hand, reserved, available, and on-order context from the same verified component snapshot
  - a structured table card for open customer orders, showing order, customer, due date, and status rows for either the next due sample or customer-scoped list requests
  - a structured table card for late orders, showing due date and days-late ranking
  - a structured table card for due-this-week orders, showing current-week delivery commitments
  - a structured chart card for order-creation trends over the last 7 days, showing daily counts, total orders, average per day, and busiest day
  - a structured table card for latest-customer-order lookups, showing the newest matching order, recent order history, and direct open-order actions
  - a structured table card for order-number searches, showing recent matching orders for prompts like "Which orders start with TEST?"
  - a structured table card for low-stock items, showing on-hand, reorder, and shortage values
  - a structured table card for supplier follow-up, showing which open supplier lines need chasing first
  - a structured table card for supplier orders by item, showing supplier, status, ordered date, and outstanding quantities for the requested component
  - a structured card for next-delivery lookups, showing either the verified ETA set or the open supplier lines when no ETA is recorded
  - a structured card for late supplier orders, including the explicit no-ETA and no-late-lines states
  - a structured card for manufacturing progress, showing completion percentages, quantities, open job cards, and recent verified completions for products or orders
  - a structured card for manufacturing status, showing latest completion, completed-by, and active/completed job-card state for products or orders
  - order production-progress questions for prompts like "Show production progress for order TEST-LC-001" and "How far along is order Test5566?"
  - purchasing item lookups for open supplier orders and next-delivery checks
  - purchasing-wide follow-up summary for open supplier lines that are old or missing verified ETA data
  - supplier lateness checks that explicitly refuse to guess when no verified ETA exists
  - component demand questions for "which orders need this item?" and "do we have enough for open demand?"
  - examples:
    - "How much of 400mm Runner WHT do we have in stock?"
    - "How much of 400mm Runner WHT do we have on order?"
    - "How much of WID2 is reserved?"
    - "How many open customer orders do we have?"
    - "How many open orders for Office Group?"
    - "What was the last order from Office Group?"
    - "What orders start with TEST?"
    - "Show open orders for Office Group"
    - "Which orders are due this week for Typestar?"
    - "Which orders are late for Typestar?"
    - "Has product TEST-002 been manufactured?"
    - "Who manufactured TEST-002?"
    - "When was TEST-002 completed?"
    - "Has order TEST-LC-001 been manufactured?"
    - "Who completed order Test5566?"
    - "When was order Test5566 completed?"
    - "Which orders are still in production?"
    - "Who is working on orders in production?"
    - "Which orders have unassigned work?"
    - "Which orders finished this week?"
    - "Show production progress for order TEST-LC-001"
    - "How far along is order Test5566?"
    - "For Typestar order number 1841, do we have all the components?"
    - "Which orders are due this week?"
    - "How many orders did we create in the last 7 days?"
    - "What were last week's orders?"
    - "Which orders are late?"
    - "Which items are below reorder level?"
    - "What is blocking order TEST-LC-001?"
    - "Which supplier orders need follow-up?"
    - "Which supplier orders are late?"
    - "Which supplier orders include 400mm Runner WHT?"
    - "When is the next delivery for 400mm Runner WHT?"
    - "Which customer orders need WID2?"
    - "Do we have enough WID2 for open demand?"
  - current verified fields:
    - on hand
    - reserved
    - available
    - on order
    - received on open supplier lines
    - open supplier order count
    - open purchase order count
    - supplier breakdown
    - reservation breakdown
    - open customer order count
    - overdue order count
    - due-this-week order count
    - late order list with days-late ranking
    - short open-order list by customer
    - open-order status breakdown
    - below-reorder item count
    - per-order blocked component count
    - per-order waiting-on-deliveries component count
    - open supplier line list by item
    - open purchase-order count by item
    - explicit supplier ETA, but only when a supplier follow-up response has a recorded `expected_delivery_date`
    - follow-up supplier line count, oldest open supplier lines, and supplier chase ranking
    - open order count requiring a component
    - tracked open demand quantity by component
    - ready-now / waiting-on-deliveries / blocked-now demand coverage by component
    - linked product manufacturing completion status
    - latest linked manufacturing completion date
    - latest linked completing staff member
    - active linked job-card count for in-production checks
    - order-level manufacturing completion status
    - order-level latest verified completion date
    - order-level latest completing staff member
    - order-level active vs completed job-card counts
    - list of orders with active manufacturing job cards
    - current staff assignments across active manufacturing job cards, including unassigned work
    - list of active orders with unassigned production job cards
    - list of orders completed in the current week
    - order-level completed quantity vs planned quantity progress
    - order-level progress percentage using linked job-card quantities
- Current data caveat:
  - most existing customer orders do not yet have an explicit order status row linked in production data
  - the assistant currently treats missing order status as open, matching the current Orders UI behavior instead of hiding those orders
  - order blocker answers depend on `order_details` + BOM/component requirement data being present for that order
  - current supplier follow-up data often has no explicit `expected_delivery_date`, so next-delivery questions intentionally return "I don't know" rather than guessing from PO dates
  - current supplier "late order" questions also intentionally return "I don't know" when no verified `expected_delivery_date` exists on the open supplier lines, even if some lines are very old
  - current component-demand answers only cover orders that have verifiable BOM / requirement data for that component; if no verified demand rows exist, the assistant answers conservatively instead of inferring
  - current product manufacturing answers only work where `job_card_items.product_id` is populated on the linked manufacturing records; some older completed job-card rows still have `product_id = null`, so the assistant will refuse to infer completion history from partial data
  - order-level manufacturing answers are broader than product-level answers because `job_cards.order_id` is populated more consistently than `job_card_items.product_id`; however, per-product details inside older order history may still be incomplete
  - the model layer is limited to choosing from known Unity assistant actions and extracting refs like customer / component / order; it does not answer from model memory
- Current limitation:
  - documentation/RAG, broader business metrics, and audit logging are still pending
  - the current assistant route is still a curated prototype, not a freeform NLQ system
  - model routing currently uses live API calls and should be monitored for latency/cost before broader rollout
- Next backend milestone: add more trusted read-only tools, starting with richer shortage drilldowns, supplier follow-up drilldowns by supplier/item, and doc-backed "how do I...?" answers.

### Digests (Scheduled Summaries) — Explained
Purpose: automated, read-only summaries sent on a schedule (e.g., daily at 8am) to keep teams aligned without opening the app. These DO NOT modify data.

Examples
- Daily Ops Digest: late customer orders, components below reorder, top shortages by impact.
- Sales Digest: new quotes created, quotes about to expire, quote win rate week-to-date.
- Inventory Digest: items below reorder with suggested purchase quantities.
- Production/Jobs Digest: jobs running long vs estimate, blockers by component shortage.

Delivery Options
- Slack via webhook to a channel or user DMs
- Email via SMTP provider
- In-app notifications panel (optional)

Notes
- Digests are optional for MVP. If enabled in Phase 2, they should use curated read-only queries, respect RLS when per-user, and include links back to relevant screens.

---

## Metrics & Dashboards (Initial Targets)
Key metrics to track and visualize for operational insights.

- Stock Shortages: `inventory.quantity_on_hand < inventory.reorder_level` (by component, location)
  - Data source: `inventory` table
  - Suggested view/RPC: `v_inventory_shortages` (includes `component`, `location`, `shortage_qty`)
- Late Orders: `orders.expected_ship_date < today` (by customer, order status)
  - Data source: `orders` table
  - Suggested view/RPC: `v_orders_late` (includes `order_id`, `customer`, `status`, `late_days`)
- Quote Win Rate: `quotes.status = 'won' / quotes.status = 'lost'` (by customer, date range)
  - Data source: `quotes` table
  - Suggested view/RPC: `v_quotes_win_rate` (includes `customer`, `date`, `win_rate`)
- Minimum Margin on a Product: sell price vs estimated cost rollup (by product, quote line)
  - Data source: `quote_items` (sell price), cost from exploded BOM (`billofmaterials` + `components` + `suppliercomponents`) and labor (`billoflabour` + `job_category_rates`)
  - Suggested view/RPC: `v_product_margins` (includes `product`, `quote_item`, `cost_rollup`, `sell_price`, `margin`, `margin_percent`)
- Job Card Duration Variance: actual vs estimated time (by job/product/date)
  - Data source: Estimated from `billoflabour.time_required` and/or job templates. Actual from attendance/time segments or job time logs (derive from clock events where available).
  - Suggested view/RPC: `v_job_duration_variance` (includes `job_id`/`product_id`, `estimated_minutes`, `actual_minutes`, `variance_minutes`, `percent_over`)

---

## Safety, Governance, and RLS
- Always enforce Row-Level Security (RLS)
  - Use user sessions when querying Supabase so the assistant cannot see more than the user can.
  - For scheduled jobs that need service-role access, add an application-level authorization layer and per-topic allowlists.
- Curated Query Catalog First (no free SQL at start)
  - Define a library of parameterized queries and Postgres RPCs the assistant can call.
  - Each tool documents: inputs, output columns, max row limits, and example prompts.
- Redaction & Rate Limits
  - Mask PII where not needed (e.g., emails/phones only if asked and user role permits).
  - Apply output row limits with “View more” continuation tokens.
- Full Audit Trail
  - Log: user, prompt, tools invoked, params, SQL/RPC identifiers (not raw SQL where possible), row counts, and timestamp.
  - Surface a “Why did I answer this?” toggle to view sources, filters, and docs used.

---

## Technical Architecture
- Model & Orchestration
  - Start with a hosted LLM (pluggable: OpenAI, Anthropic, etc.) behind server endpoints. Avoid vendor lock-in by abstracting the model client.
  - Use a tool-execution layer that exposes curated Supabase queries/RPCs as callable tools.
- Data Access (Supabase)
  - Prefer Supabase JS client with user session to preserve RLS for interactive use.
  - For complex joins or aggregations, provide Postgres RPCs or views to simplify/standardize interfaces.
- Retrieval-Augmented Generation (RAG)
  - Index `docs/` and selective schema descriptions into a Supabase `ai_embeddings` table (or pgvector extension).
  - Build a document store with metadata (path, section, updated_at) and an ingestion script that runs in CI.
- Observability & Cost Controls
  - Token usage tracking, per-user quotas, latency dashboards, tool error logs.
  - Caching for frequent queries (e.g., “low stock” list) with short TTL.

---

## Assistant Tooling (Initial Catalog)
Stable interfaces to call from the assistant. Each returns typed JSON with row limits and pagination.

- inventory.get_stock_on_hand(component_ref, location?)
  - Accepts `component_id` or `internal_code`.
  - Returns `component`, `quantity_on_hand`, `location`, `reorder_level`.

- inventory.list_below_reorder(limit=50)
  - Returns prioritized list with `component`, `on_hand`, `reorder_level`, `suggested_reorder_qty` (simple heuristic or policy-driven).

- orders.list_open(statuses=["open","in_progress"], due_before?)
  - Joins `orders` with `customers`. Returns `order_id`, `customer`, `status`, `due_date`, `late_days`.

- quotes.find_by_customer(customer_ref, since?)
  - Joins `quotes` and `customers`. Returns `quote_id`, `date`, `total`, `status`.

- quotes.summarize(quote_id)
  - Aggregates `quote_items` (+ clusters/attachments if present) and returns key figures and bullet summary.

- bom.get_product_bom(product_ref)
  - Returns exploded BOM rows with `component`, `qty_required`, and provenance (including `source_collection_id/version`).

- collections.get_collection(code_or_id)
  - Returns items in `bom_collections` -> `bom_collection_items` join `components`.

- attendance.who_is_in_today()
  - Returns currently clocked-in staff (read-only, role-gated).

Each tool can be implemented as a Next.js API route backed by a Supabase query or an RPC. Avoid exposing raw SQL via the assistant.

---

## MVP Tool Specifications (Phase 1)

Conventions
- All endpoints are read-only in Phase 1 and must enforce RLS by using the signed-in user's session.
- Default limit = 50 rows. Use `cursor`/`next_cursor` for pagination when applicable.
- Inputs accept either IDs or human references; ambiguous lookups should return a disambiguation list instead of guessing.
- Error responses include a safe message and a correlation ID (logged server-side with tool call details).

inventory.get_stock_on_hand
- Endpoint: GET `/api/assistant/tools/inventory/get-stock?component_ref={id|internal_code}&location={optional}`
- Auth/Roles: `inventory_viewer`, `admin`
- Uses: view `v_inventory_with_components`
- Input
  - `component_ref`: string (component_id or internal_code)
  - `location` (optional): string
- Output (JSON)
  ```json
  {
    "component": { "component_id": 123, "internal_code": "COMP-001", "description": "Widget" },
    "quantity_on_hand": 42,
    "location": "Main",
    "reorder_level": 10
  }
  ```
- Example prompt: "How much stock do we have for COMP-001 at Main?"

inventory.list_below_reorder
- Endpoint: GET `/api/assistant/tools/inventory/list-below-reorder?limit=50`
- Auth/Roles: `inventory_viewer`, `admin`
- Uses: view `v_inventory_with_components`
- Output (JSON)
  ```json
  {
    "items": [
      {
        "component": { "component_id": 123, "internal_code": "COMP-001", "description": "Widget" },
        "on_hand": 4,
        "reorder_level": 10,
        "suggested_reorder_qty": 50
      }
    ],
    "next_cursor": null
  }
  ```
- Example prompt: "Which components are below reorder?"

orders.list_open
- Endpoint: GET `/api/assistant/tools/orders/list-open?statuses=open,in_progress&due_before=2025-09-30`
- Auth/Roles: `sales_viewer`, `ops_viewer`, `admin`
- Uses: view `v_orders_with_customers`
- Output (JSON)
  ```json
  {
    "orders": [
      {
        "order_id": 456,
        "customer": { "id": 789, "name": "Acme Corp" },
        "status": "open",
        "due_date": "2025-09-10",
        "late_days": 0
      }
    ],
    "next_cursor": null
  }
  ```
- Example prompt: "List current open customer orders due this week."

quotes.find_by_customer
- Endpoint: GET `/api/assistant/tools/quotes/find-by-customer?customer_ref={id|name}&since=2025-08-01`
- Auth/Roles: `sales_viewer`, `admin`
- Uses: view `v_quotes_with_customers`
- Output (JSON)
  ```json
  {
    "quotes": [
      { "quote_id": "d5f...", "date": "2025-08-15", "total": 12345.67, "status": "draft", "customer": {"id": 1, "name": "Acme Corp"} }
    ],
    "next_cursor": null
  }
  ```
- Example prompt: "Find last month's quotes for Acme."

quotes.summarize
- Endpoint: GET `/api/assistant/tools/quotes/summarize?quote_id={uuid}`
- Auth/Roles: `sales_viewer`, `admin`
- Uses: RPC `rpc_quote_summary(quote_id uuid)` (returns totals, VAT, and a computed bullet summary)
- Output (JSON)
  ```json
  {
    "quote_id": "d5f...",
    "customer": { "id": 1, "name": "Acme Corp" },
    "subtotals": { "materials": 9000, "labor": 3000 },
    "vat": 1950,
    "total": 13950,
    "bullets": ["10x Widget A", "2x Custom frame", "Includes installation" ]
  }
  ```
- Example prompt: "Summarize quote Q-001 for a customer email."

bom.get_product_bom
- Endpoint: GET `/api/assistant/tools/bom/get-product-bom?product_ref={id|code}`
- Auth/Roles: `ops_viewer`, `admin`
- Uses: view `v_bom_with_components` (includes provenance `source_collection_id`/`version`)
- Output (JSON)
  ```json
  {
    "product": { "product_id": 321, "code": "CHAIR-BASE" },
    "bom": [
      { "component": {"component_id": 123, "internal_code": "LEG-01", "description": "Chair leg"}, "qty_required": 4, "source_collection_id": 1, "source_collection_version": 2 }
    ]
  }
  ```
- Example prompt: "Show the BOM for CHAIR-BASE."

collections.get_collection
- Endpoint: GET `/api/assistant/tools/collections/get?collection_ref={id|code}`
- Auth/Roles: `ops_viewer`, `admin`
- Uses: `bom_collections` + `bom_collection_items` join `components`
- Output (JSON)
  ```json
  {
    "collection": { "collection_id": 1, "code": "BASE-CHAIR", "name": "Base Chair" },
    "items": [
      { "component": {"component_id": 123, "internal_code": "LEG-01", "description": "Chair leg"}, "quantity_required": 4 }
    ]
  }
  ```
- Example prompt: "Show the BASE-CHAIR collection contents."

attendance.who_is_in_today
- Endpoint: GET `/api/assistant/tools/attendance/who-is-in-today?date=2025-09-06`
- Auth/Roles: `attendance_viewer`, `admin`
- Notes: Be cautious with tables known to cause API issues when using `select('*')`; request specific columns and use proper date filtering/timezone handling.
- Output (JSON)
  ```json
  {
    "date": "2025-09-06",
    "staff": [
      { "staff_id": 12, "name": "Jane Doe", "clocked_in_at": "2025-09-06T08:12:00+02:00" }
    ]
  }
  ```
- Example prompt: "Who is in today?"

Environment Setup: OpenAI API Key (do not share in chat)
- Local development (Next.js)
  - Create a `.env.local` file at the project root with:
    ```bash
    OPENAI_API_KEY=sk-...
    ```
  - Never commit `.env.local` to git. Server code should read `process.env.OPENAI_API_KEY`. Do not expose this key in the browser.
- Deployment
  - Netlify: set `OPENAI_API_KEY` in Site settings → Environment variables.
  - Vercel (if used): set `OPENAI_API_KEY` in Project Settings → Environment Variables.
- We will keep all model calls on the server to avoid leaking secrets. The assistant tools will run under server endpoints using the user's Supabase session for RLS.

---

## Data Model Aids (Optional but Recommended)
To simplify tools and improve performance:
- Create views that pre-join common entities:
  - `v_inventory_with_components`
  - `v_orders_with_customers`
  - `v_quotes_with_customers`
  - `v_bom_with_components`
- Add RPCs for complex logic:
  - `rpc_expand_bom(product_id)` to compute shortages vs inventory.
  - `rpc_quote_summary(quote_id)` to return totals and text snippets for the assistant.

---

## SQL Skeletons for Views & RPCs (to run later in Supabase)
These are starting points. Adjust table/column names to match your live schema (e.g., `quotes.id` vs `quotes.quote_id`, `quote_items` vs `quote_line_items`). Run in the Supabase SQL editor when ready.

-- View: Inventory with component details
```sql
create or replace view public.v_inventory_with_components as
select
  i.inventory_id,
  i.component_id,
  c.internal_code,
  c.description,
  i.location,
  i.quantity_on_hand,
  i.reorder_level
from public.inventory i
join public.components c on c.component_id = i.component_id;
```

-- View: Inventory shortages (below reorder)
```sql
create or replace view public.v_inventory_shortages as
select
  c.component_id,
  c.internal_code,
  c.description,
  i.location,
  i.quantity_on_hand,
  i.reorder_level,
  greatest(i.reorder_level - i.quantity_on_hand, 0) as shortage_qty
from public.inventory i
join public.components c on c.component_id = i.component_id
where i.reorder_level is not null
  and i.quantity_on_hand < i.reorder_level;
```

-- View: Orders with customers
```sql
create or replace view public.v_orders_with_customers as
select
  o.order_id,
  o.customer_id,
  cust.name as customer_name,
  o.status_id,
  o.created_at,
  o.delivery_date,
  case when o.delivery_date is not null and o.delivery_date < current_date then (current_date - o.delivery_date) else 0 end as late_days
from public.orders o
left join public.customers cust on cust.id = o.customer_id;
```

-- View: Late orders (derived)
```sql
create or replace view public.v_orders_late as
select *
from public.v_orders_with_customers
where delivery_date < current_date;
```

-- View: Quotes with customers (adjust PK column name if needed)
```sql
create or replace view public.v_quotes_with_customers as
select
  q.id as quote_id,           -- if your PK is quote_id, change to q.quote_id
  q.quote_number,
  q.customer_id,
  cust.name as customer_name,
  q.status,
  q.created_at
from public.quotes q
left join public.customers cust on cust.id = q.customer_id;
```

-- View: BOM exploded with component details
```sql
create or replace view public.v_bom_with_components as
select
  b.bom_id,
  b.product_id,
  b.component_id,
  c.internal_code,
  c.description,
  b.quantity_required,
  b.source_collection_id,
  b.source_collection_version,
  b.overridden
from public.billofmaterials b
join public.components c on c.component_id = b.component_id;
```

-- RPC: Expand BOM for a product (simplified)
```sql
create or replace function public.rpc_expand_bom(p_product_id int)
returns table (
  component_id int,
  internal_code text,
  description text,
  qty_required numeric
) as $$
begin
  return query
  select
    v.component_id,
    v.internal_code,
    v.description,
    v.quantity_required
  from public.v_bom_with_components v
  where v.product_id = p_product_id;
end;
$$ language plpgsql stable security definer;
```

-- RPC: Quote summary (skeleton; adapt to your quote schema)
```sql
create or replace function public.rpc_quote_summary(p_quote_id uuid)
returns table (
  quote_id uuid,
  customer_id bigint,
  customer_name text,
  subtotal numeric,
  vat numeric,
  total numeric
) as $$
begin
  return query
  select
    q.id,
    q.customer_id,
    c.name,
    coalesce((select sum(coalesce(total, qty * unit_price)) from public.quote_items qi where qi.quote_id = q.id), 0) as subtotal,
    coalesce(q.vat_amount, 0) as vat,
    coalesce(q.total_amount, 0) as total
  from public.quotes q
  left join public.customers c on c.id = q.customer_id
  where q.id = p_quote_id;
end;
$$ language plpgsql stable security definer;
```

-- View: Product/Quote margins (placeholder; refine costing sources as needed)
```sql
create or replace view public.v_product_margins as
select
  qi.quote_id,
  qi.id as quote_item_id,
  qi.description,
  coalesce(qi.total, qi.qty * qi.unit_price) as sell_price,
  0::numeric as cost_rollup, -- TODO: replace with exploded BOM + labor cost
  (coalesce(qi.total, qi.qty * qi.unit_price) - 0)::numeric as margin,
  case when coalesce(qi.total, qi.qty * qi.unit_price) > 0 then
    ((coalesce(qi.total, qi.qty * qi.unit_price) - 0) / coalesce(qi.total, qi.qty * qi.unit_price)) * 100
  else 0 end as margin_percent
from public.quote_items qi;
```

-- View: Job duration variance (placeholder; align with attendance/job logs)
```sql
create or replace view public.v_job_duration_variance as
select
  bl.bol_id,
  bl.product_id,
  bl.time_required as estimated_minutes,
  null::numeric as actual_minutes, -- TODO: derive from time segments / job logs
  null::numeric as variance_minutes,
  null::numeric as percent_over
from public.billoflabour bl;
```

---

## Implementation Plan (Phased)

### Phase 1 — Read-Only NLQ + RAG (2–3 weeks)
- Build a server-side assistant endpoint `POST /api/assistant` with streaming.
- Implement tool catalog for read queries listed above; enforce RLS by using user session.
- Add a small chat dock + command palette; add page-scoped context providers.
- Current delivered slice:
  - floating assistant launcher available in the shared authenticated layout
  - Unity-only scope enforcement with explicit "I don't know" fallback
  - trusted inventory snapshot tool backed by Supabase reads under the signed-in user's session
  - trusted operational summary tools for open customer orders, due-this-week orders, and low-stock questions
{{ ... }}
- Logging & analytics: prompt, tools, row counts, latency.

### Phase 2 — Light Actions with Confirmation (2–3 weeks)
- Enable “generate draft” actions that do not commit immediately:
  - Draft PO for below-reorder components; draft quote from a product/collection; draft follow-up email.
- Present a review diff and require explicit user confirmation to commit via existing APIs.
- Add Slack/email digests with scheduled read-only summaries.

### Phase 3 — Advanced Insights & Recommendations
- Shortage root-cause analysis on orders.
- Price variance analysis (supplier vs standard cost).
- Quote optimization suggestions (collections, alternatives, labor).
- Attendance anomaly detection (optional, gated, and carefully tested).

---

## Security, Privacy, and Compliance
- RLS-first: never bypass RLS for interactive user queries.
- PII minimization: only return PII when necessary and role-allowed.
- Secrets management: never expose service-role keys to the client or the model. Tools run on server only.
- Data retention: configurable retention of conversation logs; anonymize training/analytics data.
- Export controls: cap rows and require explicit confirmation for exports beyond safe thresholds.

### RBAC & Audit Logging (Future Work)
Roles
- Define least-privilege roles (examples): `inventory_viewer`, `sales_viewer`, `ops_viewer`, `attendance_viewer`, `admin`.
- Map assistant tools to allowed roles; enforce at the API layer in addition to RLS.
- Support per-endpoint row limits and field-level redaction by role.

Audit Logging
- Log every assistant interaction and tool call. Include:
  - `correlation_id`, `user_id`, `role`, `tool_name`, `action` (read/query vs draft action),
  - `params_redacted` (safely redacted inputs), `result_row_count`, `duration_ms`,
  - `http_status`/`error_code`, `source_ip`, `user_agent`, `page_url`, `created_at`.
- Store logs in a dedicated table and surface an admin viewer.

Audit table sketch
```sql
create table assistant_audit_logs (
  id uuid primary key default gen_random_uuid(),
  correlation_id text,
  user_id uuid not null,
  role text not null,
  tool_name text not null,
  action text not null check (action in ('read','draft','write')),
  params_redacted jsonb,
  result_row_count int,
  duration_ms int,
  http_status int,
  error_code text,
  source_ip inet,
  user_agent text,
  page_url text,
  created_at timestamptz not null default now()
);
```

Permissions
- Only admins can view all logs. Users can view their own interactions.
- Consider retention policies (e.g., 90 days) and export on demand.

---

## Testing & Evaluation
- Unit-test each tool with typical and edge cases (empty results, large results, permission denied).
- Prompt tests for ambiguous language (synonyms for products/components).
- Red-team flows for data leakage and prompt injection (especially within RAG citations).
- Success metrics: time-to-answer, reduced back-and-forth for common questions, adoption of command palette.

---

## What We’ll Need
- Model provider choice and API keys (pluggable—can start with any that fits cost and quality goals).
- Final list of MVP tools/queries and row limits per role.
- A Slack workspace/email SMTP for scheduled summaries (if desired in Phase 2).
- Decision on embedding store (pgvector in Supabase or external) and refresh cadence.
- UI decisions: placement of chat dock, keyboard shortcut, and page-scoped helper affordances.

---

## Open Questions for You
1. Which user roles should have access to the assistant, and what data can each role see (quotes, POs, attendance)?
2. Are any write actions allowed in Phase 2 (e.g., draft POs/quotes), or should Phase 2 remain strictly read-only with proposed diffs only?
3. Do you want Slack/email digests in the MVP, or keep them for Phase 2?
4. Any particular KPIs you want dashboards for (e.g., shortages, late orders, quote win rate)?
5. Any data domains we should hold back initially due to sensitivity (e.g., attendance)?
6. Preferred model/provider and budget constraints (token caps, latency targets)?
7. Do we need multi-language support for prompts/answers?

---

## Best Way Forward (Recommendation)
- Start with Phase 1 (read-only tools + RAG) focused on:
  - Inventory (stock on hand, below reorder),
  - Orders (open/late orders), and
  - Quotes (find/summarize by customer/date).
- Implement a curated tool catalog backed by Supabase views/RPCs to ensure safety and maintainability.
- Add a minimal, fast UI (command palette + chat dock) and prove value in daily workflows.
- Iterate with explicit user feedback; then expand into light write actions with confirmation in Phase 2.
