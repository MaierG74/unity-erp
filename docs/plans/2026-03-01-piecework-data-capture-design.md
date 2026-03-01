# Piecework Data Capture — Design Document

**Date:** 2026-03-01
**Status:** Approved
**Phase:** Data capture hardening (Phase 1 of piecework earnings pipeline)

## Goal

Ensure every completed job correctly captures who did the work, what quantity, and what they earn — so the weekly payroll review page (future Phase 2) can calculate `piece_work_total`, apply support employee deductions, and compare against `hourly_wage_total`.

## Context

The job completion flow was just built (Job Actions feature). It captures `completed_quantity` per `job_card_item` and the `piece_rate` is already stored at issuance. The `staff_weekly_payroll` table exists with the comparison logic (`final_payment = MAX(hourly_wage_total, piece_work_total)`), but `piece_work_total` has never been populated from actual completions.

### What works today
- Complete Job dialog captures `completed_quantity` per item
- `piece_rate` stored on `job_card_items` at card issuance (historical accuracy)
- Transfer RPC splits multi-unit jobs by quantity (two separate cards)
- `staff_weekly_payroll` table + payroll UI with hourly vs piece comparison

### What's missing
1. **Single-item transfer split** — qty=1 jobs can't be split by quantity; manager needs to specify a rand amount
2. **Support employee relationships** — support workers' costs must be deducted from primary workers' piecework before the hourly comparison
3. **Earnings queryability** — no easy way to sum "what did this staff member earn in piecework this week?"

## Not In Scope

- Weekly review / auto-calculate page (Phase 2)
- Team job cards — multiple staff on one card (Phase 3)
- Weighted team splits (Phase 3)
- Actual payroll deduction calculation (Phase 2 — reads the structures we build here)

---

## Data Model Changes

### 1. `piece_rate_override` on `job_card_items`

Add column:
```sql
ALTER TABLE job_card_items
  ADD COLUMN piece_rate_override NUMERIC(10,2) NULL;
```

- `NULL` = use standard `piece_rate` (normal case, 99% of the time)
- Set by the transfer RPC when a manager specifies a custom earnings split for an indivisible item

**Earnings formula:** `completed_quantity × COALESCE(piece_rate_override, piece_rate)`

**Transfer split example (single-item, R300 job):**
- Original worker's card: `completed_quantity = 1`, `piece_rate_override = 180` (manager's amount)
- New worker's card: `quantity = 1`, `piece_rate = 300`, `piece_rate_override = 120` (remainder)

### 2. `staff_support_links` table

Stores semi-permanent relationships between primary workers and their support employees. Many-to-many: a primary can have multiple support staff, and a support person can serve multiple primaries.

```sql
CREATE TABLE staff_support_links (
  link_id         SERIAL PRIMARY KEY,
  primary_staff_id INTEGER NOT NULL REFERENCES staff(staff_id),
  support_staff_id INTEGER NOT NULL REFERENCES staff(staff_id),
  cost_share_pct  NUMERIC(5,2) NOT NULL DEFAULT 100.00,
  effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_until  DATE,  -- NULL = still active
  org_id          UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (primary_staff_id != support_staff_id),
  CHECK (cost_share_pct > 0 AND cost_share_pct <= 100)
);
```

**Example:** Support employee B helps cutters A and C.
- Row 1: primary=A, support=B, cost_share_pct=60
- Row 2: primary=C, support=B, cost_share_pct=40

At payroll time (Phase 2), B's weekly earnings (R2,000) get deducted:
- R1,200 from A's piecework total
- R800 from C's piecework total

Then A's `final_payment = MAX(hourly_wage_total, adjusted_piece_work_total)`.

RLS: org-scoped SELECT/INSERT/UPDATE/DELETE for authenticated users who are org members.

### 3. `staff_piecework_earnings` SQL view

Read-only view for querying earnings by staff and date range:

```sql
CREATE VIEW staff_piecework_earnings AS
SELECT
  jc.staff_id,
  jc.org_id,
  jci.item_id,
  jc.job_card_id,
  jc.completion_date,
  jci.completed_quantity,
  jci.piece_rate,
  jci.piece_rate_override,
  (jci.completed_quantity * COALESCE(jci.piece_rate_override, jci.piece_rate)) AS earned_amount
FROM job_cards jc
JOIN job_card_items jci ON jci.job_card_id = jc.job_card_id
WHERE jc.status = 'completed'
  AND jci.piece_rate IS NOT NULL
  AND jci.piece_rate > 0;
```

Payroll review page (Phase 2) queries: `SELECT staff_id, SUM(earned_amount) FROM staff_piecework_earnings WHERE completion_date BETWEEN week_start AND week_end GROUP BY staff_id`

### 4. Update `transfer_assignment` RPC

Add optional parameter `p_earnings_split JSONB` — array of `{item_id, original_worker_amount}`.

When provided:
- Original worker's items get `piece_rate_override = original_worker_amount`
- New worker's items get `piece_rate_override = piece_rate - original_worker_amount`

When not provided (default): existing quantity-based split, no override.

---

## Frontend Changes

### 5. Transfer Job Dialog — Earnings Split Section

When transferring a piecework job that's `in_progress`:

**Multi-unit items (qty > 1):**
- Shows "Completed by current worker" number input per item
- Remaining quantity goes to new worker
- Earnings auto-calculated: `qty × piece_rate`
- This is the default behavior (same as current, just more visible)

**Single-unit items (qty = 1) or custom split toggle:**
- Shows "Current worker earns: R___" input per item
- "New worker earns: R___" auto-calculates as remainder
- These values become `piece_rate_override`

**The dialog adapts** — if all items are multi-unit, quantity split is default. Rand split only appears for qty=1 items or when manager toggles "Custom split".

### 6. Support Assignments Page — `/staff` section

Tab or sub-page under Staff for managing support relationships.

**Table columns:** Primary Worker | Support Employee | Cost Share % | Active Since | Actions
**Add Link:** Form with staff pickers + percentage input
**Edit:** Inline edit of cost_share_pct
**Deactivate:** Sets `effective_until` to today (soft delete)
**Validation:** Shares for a given support employee across all their primary workers should sum to ≤ 100%

---

## Future Phases

### Phase 2: Weekly Payroll Review Page
- Shows all completed job cards per staff member for the week
- Manual fix capability (add missing cards, adjust quantities, handle forgotten transfers)
- "Auto Calculate" button sums piecework, applies support deductions, compares to hourly
- Lock/approve payroll

### Phase 3: Team Job Cards
- Multiple staff on one card (e.g., steel section)
- Weighted split of earnings among team members
- Manager-defined or role-weighted splits
