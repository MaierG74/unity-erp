# Database Migrations

This directory contains SQL migration files for the Unity ERP database.

## How to Run Migrations

Migrations should be run through the Supabase Dashboard SQL Editor:

1. Open https://supabase.com/dashboard/project/ttlyfhkrsjjrzxiagzpb/sql
2. Click "New query"
3. Copy the contents of the migration file
4. Paste and execute

## Migration Files

### 20250930_quote_totals_triggers.sql
**Created:** 2025-09-30
**Purpose:** Automatic totals calculation for quotes system

**What it does:**
- Creates `update_quote_item_total()` function to auto-calculate `quote_items.total = qty * unit_price`
- Creates `update_quote_totals()` function to auto-calculate quote subtotal, VAT amount, and grand total
- Adds triggers on `quote_items` table to automatically maintain totals on INSERT/UPDATE/DELETE
- Fixes all existing quote data with correct total calculations
- Handles VAT rate stored as percentage (15.00 = 15%) and converts to decimal for calculations

**Database objects created:**
- Function: `update_quote_item_total()`
- Function: `update_quote_totals()`
- Trigger: `quote_item_total_trigger` on `quote_items`
- Trigger: `quote_items_total_update_trigger` on `quote_items`

**Safe to re-run:** Yes (uses `CREATE OR REPLACE` and `DROP TRIGGER IF EXISTS`)

**Rollback:** To rollback, drop the triggers and functions:
```sql
DROP TRIGGER IF EXISTS quote_item_total_trigger ON quote_items;
DROP TRIGGER IF EXISTS quote_items_total_update_trigger ON quote_items;
DROP FUNCTION IF EXISTS update_quote_item_total();
DROP FUNCTION IF EXISTS update_quote_totals();
```

---

## Migration Naming Convention

Migrations are named: `YYYYMMDD_descriptive_name.sql`

Example: `20250930_quote_totals_triggers.sql`
