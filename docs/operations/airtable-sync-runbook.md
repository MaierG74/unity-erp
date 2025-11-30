# Airtable Sync Runbook

This runbook describes the end-to-end process for migrating or re-syncing Airtable data into Unity ERP (Supabase). Follow it any time we pull fresh data, validate MCP connectivity, or handle incidents related to Airtable imports.

> Use this document together with:
> - [`technical/airtable-migration-guide.md`](../technical/airtable-migration-guide.md) for tooling details
> - [`technical/airtable-data-mapping.md`](../technical/airtable-data-mapping.md) for field-level mappings

---

## 1. Scope & Responsibilities

| Dataset | Owner | Primary Script | Storage Folder |
| --- | --- | --- | --- |
| Components + Supplier Mappings | Ops Engineering | `scripts/airtable/airtable_to_supabase.py` | `QButton/components/…` |
| Products + Images | Ops Engineering | `scripts/airtable/airtable_products_to_supabase.py` | `QButton/products/…` |
| Orders + Attachments | Order Admin | `scripts/airtable/airtable_orders_to_supabase.py` | `QButton/orders/…` |
| Staff + HR Docs | People Ops | `scripts/airtable/airtable_staff_to_supabase.py` | `QButton/staff/…` |

---

## 2. Preflight Checklist

1. **Confirm Schema**
   - Review [`airtable-data-mapping.md`](../technical/airtable-data-mapping.md) for new Airtable columns or Supabase changes.
   - Ensure required Supabase migrations have been applied.
2. **Validate Credentials**
   - `.env.local` contains `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.
   - Rotate any keys older than 90 days.
3. **MCP Connectivity**
   - From the IDE, run `mcp ping airtable` and `mcp ping supabase`. Reload MCP servers if failures occur.
4. **Data Snapshot (Optional but recommended)**
   - Export Airtable views to CSV for archival.
   - Take a Supabase backup or snapshot the modified tables.
5. **Storage Budget Check**
   - Confirm Supabase bucket (`QButton`) has enough capacity for attachments/images.
6. **Rate Limit Planning**
   - Large runs should be scheduled off-hours. Scripts throttle to 5 req/sec but may still hit Airtable limits if multiple operators run simultaneously.

---

## 3. Execution Steps

### 3.1 Components & Supplier Mappings

1. Activate virtualenv and install deps (`pip install -r requirements.txt`).
2. Run `python scripts/airtable/airtable_to_supabase.py`.
3. Monitor console output:
   - Category + unit upserts summary
   - Component count
   - Supplier-component rows created/updated
4. Re-run with `--dry-run` flag (if supported) to preview changes when testing new logic.

### 3.2 Products

1. `python scripts/airtable/airtable_products_to_supabase.py --skip-existing` for incremental syncs.
2. Use `--force-images` only when image assets changed; otherwise storage bandwidth increases unnecessarily.
3. Verify storage uploads succeed (see Post-Run Validation).

### 3.3 Orders

1. `python scripts/airtable/airtable_orders_to_supabase.py --filter-date YYYY-MM-DD` for daily syncs.
2. Add `--auto-create-customer` when new customers appear; otherwise script will log unresolved names.
3. Provide explicit `--table` and `--view` arguments to match Airtable naming.

### 3.4 Staff

1. `python scripts/airtable/airtable_staff_to_supabase.py` (no params needed for full sync).
2. The script merges duplicates by Airtable ID and keeps the latest attachments. Watch for warnings about “Team Header” rows—they should be skipped.
3. Expect higher runtime because document uploads use a thread pool.

---

## 4. Post-Run Validation

| Area | Check | How |
| --- | --- | --- |
| Counts | Compare record counts between Airtable view and Supabase table | Use MCP Supabase query: `select count(*) from components;` etc. |
| Spot Samples | Pick 5 records per dataset and verify fields | Use MCP Airtable server to fetch the record and compare vs Supabase row. |
| Attachments | Confirm Supabase Storage paths exist | In Supabase dashboard → Storage → `QButton`. Spot check product/order/staff folders. |
| UI Smoke Tests | - Inventory components table
- Products page images
- Orders attachments viewer
- Staff profile modal | Load relevant Next.js routes locally; ensure new data visible. |
| Logs | Review script output + `logs/airtable/*.log` (if configured) | Look for “skipped” or “failed” entries; rerun selectively if needed. |

---

## 5. MCP Workflows

Once MCP servers are configured:

```text
# List Airtable tables
mcp airtable list_tables

# Inspect Supabase components missing units
mcp supabase query "select component_id, internal_code from components where unit_id is null;"
```

Tips:
- Use the Airtable MCP server for quick schema introspection without leaving the IDE.
- Grant MCP servers only scoped API keys; rotate them when operators change.

---

## 6. Incident Response

| Scenario | Action |
| --- | --- |
| Script crashes mid-run | Fix error, rerun the script; upserts are idempotent. For partially uploaded attachments, delete the folder in Supabase Storage before rerun. |
| Duplicate records created | Identify via Supabase query, delete duplicates, and re-run script with `--skip-existing` disabled to force clean insert. |
| Airtable rate-limit (HTTP 429) | Scripts back off automatically; if it persists, reduce batch size or wait 60 seconds before resuming. |
| Wrong bucket/folder | Move files using Supabase Storage explorer and update URLs via SQL update script documented in the migration guide. |
| Credentials leaked | Immediately revoke the key in Airtable/Supabase, update `.env.local`, and rotate MCP config secrets. |

---

## 7. Communication & Sign-off

1. Post run summary in #ops-data with:
   - Scripts executed + flags
   - Record counts inserted/updated
   - Any anomalies or follow-up tasks
2. Update the consolidated TODO tracker (`docs/overview/todo-index.md`) if additional cleanup or schema work is required.

---

_Last updated: 2025-11-25_
