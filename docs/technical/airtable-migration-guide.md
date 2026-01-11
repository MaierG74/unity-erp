# Airtable to Supabase Migration Guide

> ⚠️ **Security Reminder:** Never store live credentials in this repository. Replace the placeholders in the examples below with your own values via environment variables or secret managers and rotate any keys that were previously committed elsewhere.

This guide describes how we migrate data from Airtable into Unity ERP (Supabase) and how we configure MCP servers so AI assistants can work with Airtable alongside Supabase.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Environment Setup](#environment-setup)
4. [MCP Server Configuration](#mcp-server-configuration)
5. [Database Schema](#database-schema)
6. [Migration Scripts](#migration-scripts)
7. [Usage Examples](#usage-examples)
8. [Troubleshooting](#troubleshooting)
9. [Project Structure](#project-structure)
10. [Security Notes](#security-notes)

---

## Overview

Unity ERP needs to migrate several Airtable bases into Supabase:

- **Components** – raw materials and supplier mappings
- **Products** – finished goods with categories and images
- **Orders** – customer orders with file attachments
- **Staff** – employee roster and HR documents

The migration handles linked records, storage uploads, category assignments, and deduplication/upserts so Airtable can remain a short-term source while Supabase becomes the system of record.

---

## Prerequisites

### Software Requirements

- Python 3.8+
- Node.js 18+ (required for MCP servers)
- npm or npx

### Accounts Required

- **Airtable** workspace with API access
- **Supabase** project (`ttlyfhkrsjjrzxiagzpb`) with:
  - Database access
  - Storage bucket configured
  - Service role key

---

## Environment Setup

### 1. Install Python Dependencies

```bash
pip install pyairtable>=2.2.0 supabase>=2.4.0 python-dotenv>=1.0.1 requests>=2.31.0
```

Or via `requirements.txt`:

```
pyairtable>=2.2.0
supabase>=2.4.0
python-dotenv>=1.0.1
requests>=2.31.0
```

### 2. Configure Environment Variables

Create a `.env` (or `.env.local`) file in the project root:

```bash
# Airtable Configuration
AIRTABLE_API_KEY=YOUR_AIRTABLE_API_KEY
AIRTABLE_BASE_ID=YOUR_AIRTABLE_BASE_ID

# Supabase Configuration
SUPABASE_URL=https://ttlyfhkrsjjrzxiagzpb.supabase.co
SUPABASE_SERVICE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
```

#### How to Retrieve Credentials

- **Airtable API key / PAT**: https://airtable.com/create/tokens → scopes `data.records:read`, `data.records:write`, `schema.bases:read`. Add your base access.
- **Airtable Base ID**: In the base URL (`https://airtable.com/appXXXXXXXXXXXXXX/...`).
- **Supabase URL & service key**: Supabase dashboard → *Settings → API*.

> ❗ Do **not** commit `.env` files. Add them to `.gitignore`.

---

## MCP Server Configuration

MCP (Model Context Protocol) servers let our IDE copilot run Airtable + Supabase commands.

### Cursor IDE (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@supabase/mcp-server-supabase@latest", "--project-ref=ttlyfhkrsjjrzxiagzpb"],
      "env": {
        "SUPABASE_ACCESS_TOKEN": "${SUPABASE_ACCESS_TOKEN}"
      }
    },
    "sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
    },
    "airtable": {
      "command": "npx",
      "args": ["-y", "airtable-mcp-server"],
      "env": {
        "AIRTABLE_API_KEY": "YOUR_AIRTABLE_API_KEY"
      }
    }
  }
}
```

### Windsurf / CLI (`.mcp.json`)

```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "POSTGRES_CONNECTION_STRING": "postgresql://postgres.ttlyfhkrsjjrzxiagzpb:YOUR_DB_PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
      },
      "autoapprove": ["query"]
    },
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "--headless=true", "--isolated=true"],
      "autoapprove": ["navigate_page", "take_snapshot", "take_screenshot", "click", "fill", "fill_form", "press_key", "hover", "drag", "evaluate_script", "get_console_message", "list_console_messages", "get_network_request", "list_network_requests", "list_pages", "select_page", "new_page", "close_page", "resize_page", "emulate", "wait_for", "upload_file", "handle_dialog", "performance_start_trace", "performance_stop_trace", "performance_analyze_insight"]
    },
    "airtable": {
      "command": "npx",
      "args": ["-y", "airtable-mcp-server"],
      "env": {
        "AIRTABLE_API_KEY": "YOUR_AIRTABLE_API_KEY"
      }
    }
  }
}
```

After editing these files, restart the IDE (or reload MCP servers) so Airtable commands become available.

### Supabase Connection String Format

```
postgresql://postgres.ttlyfhkrsjjrzxiagzpb:YOUR_DB_PASSWORD@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
```

Use the transaction pooler connection string from *Settings → Database*. Substitute your database password before running commands.

---

## Database Schema

We migrate into (or derive from) the following Supabase tables:

```sql
-- Units of Measure
CREATE TABLE public.unitsofmeasure (
  unit_id serial PRIMARY KEY,
  unit_code text NOT NULL UNIQUE,
  unit_name text NOT NULL
);

-- Component Categories
CREATE TABLE public.component_categories (
  cat_id serial PRIMARY KEY,
  categoryname text NOT NULL UNIQUE
);

-- Components
CREATE TABLE public.components (
  component_id serial PRIMARY KEY,
  internal_code text NOT NULL UNIQUE,
  description text,
  unit_id integer REFERENCES unitsofmeasure(unit_id),
  category_id integer REFERENCES component_categories(cat_id),
  image_url text
);

-- Suppliers and Supplier Components (excerpt)
CREATE TABLE public.suppliers (
  supplier_id serial PRIMARY KEY,
  name text NOT NULL,
  contact_info text
);

CREATE TABLE public.suppliercomponents (
  supplier_component_id serial PRIMARY KEY,
  component_id integer REFERENCES components(component_id),
  supplier_id integer REFERENCES suppliers(supplier_id),
  supplier_code text NOT NULL,
  price numeric(10,2),
  lead_time integer,
  min_order_quantity integer,
  UNIQUE (component_id, supplier_id)
);

-- Products and Categories
CREATE TABLE public.product_categories (
  product_cat_id serial PRIMARY KEY,
  categoryname text NOT NULL UNIQUE
);

CREATE TABLE public.products (
  product_id serial PRIMARY KEY,
  internal_code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text
);

CREATE TABLE public.product_category_assignments (
  product_id integer REFERENCES products(product_id) ON DELETE CASCADE,
  product_cat_id integer REFERENCES product_categories(product_cat_id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, product_cat_id)
);

-- Customers and Orders
CREATE TABLE public.customers (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  name text,
  contact text,
  email text UNIQUE,
  telephone text UNIQUE
);

CREATE TABLE public.order_statuses (
  status_id serial PRIMARY KEY,
  status_name varchar(50) NOT NULL UNIQUE
);

CREATE TABLE public.orders (
  order_id serial PRIMARY KEY,
  customer_id bigint REFERENCES customers(id),
  order_date timestamp DEFAULT CURRENT_TIMESTAMP,
  total_amount numeric,
  status_id integer REFERENCES order_statuses(status_id),
  order_number text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  delivery_date date
);

CREATE TABLE public.order_attachments (
  id serial PRIMARY KEY,
  order_id integer REFERENCES orders(order_id) ON DELETE CASCADE,
  file_url text NOT NULL,
  file_name text NOT NULL,
  uploaded_at timestamp DEFAULT now()
);

-- Staff
CREATE TABLE public.staff (
  staff_id serial PRIMARY KEY,
  airtable_id text,
  first_name text NOT NULL,
  last_name text,
  job_description text,
  phone text,
  id_document_urls text[],
  bank_account_image_urls text[],
  current_staff boolean DEFAULT false,
  hourly_rate numeric DEFAULT 0.0,
  weekly_hours numeric DEFAULT 40.0,
  is_active boolean DEFAULT false,
  hire_date date,
  date_of_birth date
);
```

### Supabase Storage Bucket

Create a bucket such as `QButton`:

```
QButton/
├── products/{product_code}/...
├── orders/{order_number}/...
└── staff/{staff_id}/...
```

Products and orders store images/docs referenced by the migration scripts.

---

## Migration Scripts

> Scripts live in `unity-erp/scripts/airtable/` (to be expanded) and can be copied from the historical `unity-move` repo if needed.

1. **`airtable_to_supabase.py` (Components)** – Suppliers, units, categories, linked supplier-component rows, image uploads.
2. **`airtable_products_to_supabase.py`** – Product metadata, multi-category assignments, Supabase Storage image uploads (supports `--force-images`, `--skip-existing`).
3. **`airtable_orders_to_supabase.py`** – Customer lookup/creation, order creation, attachment uploads (filters by `--filter-date`, supports custom field mapping flags).
4. **`airtable_staff_to_supabase.py`** – Staff roster, merged duplicates, document uploads via `ThreadPoolExecutor`.

All scripts share helpers for:

- Fetching Airtable tables/views by name
- Resolving linked records
- Uploading attachments to Supabase Storage via signed URLs
- Upsert patterns (`on_conflict`) to keep IDs stable

> ✅ Add new scripts under `scripts/airtable/` and update this section whenever functionality changes.

---

## Usage Examples

### Typical Migration Flow

```bash
# 1. Configure environment
cp .env.example .env  # then edit secrets

# 2. Install dependencies
pip install -r requirements.txt

# 3. Run migrations
python airtable_to_supabase.py             # Components first (creates suppliers)
python airtable_products_to_supabase.py    # Products
python airtable_orders_to_supabase.py      # Orders
python airtable_staff_to_supabase.py       # Staff
```

### Incremental Syncs

```bash
# Only todays orders
python airtable_orders_to_supabase.py --filter-date $(date +%Y-%m-%d)

# Update products but leave existing rows untouched
python airtable_products_to_supabase.py --skip-existing
```

### MCP Assistant Prompts

Once MCP servers are running you can ask:

```
"List all tables in the Airtable base"
"Query the Supabase products table for everything missing an image"
"Compare supplier price lists between Airtable and Supabase"
```

---

## Troubleshooting

1. **Missing env vars** – run `cat .env` to confirm values; ensure scripts load via `python-dotenv`.
2. **Airtable auth errors** – verify scopes, base access, and table/view spelling (case sensitive).
3. **Supabase upload failures** – check bucket existence and that you7re using the service role key (anon keys cannot write storage).
4. **MCP server not connecting** – run `npx -y airtable-mcp-server` manually, confirm Node 18+, and ensure API key env var is visible to the IDE.
5. **Airtable rate limiting** – scripts use batch processing, sleeps, and retries, but reduce batch size if you still hit limits.

Increase logging by configuring Python logging:

```python
logging.basicConfig(level=logging.DEBUG, ...)
```

---

## Project Structure

```
docs/technical/airtable-migration-guide.md  # This document
scripts/airtable/                           # (Add python migration scripts here)
.env / .env.local                           # Airtable + Supabase secrets (gitignored)
.cursor/mcp.json                            # Cursor MCP config
.mcp.json                                   # Windsurf MCP config
```

Update this section as the Airtable tooling inside Unity ERP grows.

---

## Security Notes

- Rotate Airtable + Supabase credentials whenever they are shared externally.
- Keep `.env` files local; use secret stores in deployed environments.
- Use Supabase service-role keys only on trusted servers (never in the browser).
- Review MCP config before committing to ensure no plaintext secrets slip into Git history.

---

_Last updated: 2025-11-25_
