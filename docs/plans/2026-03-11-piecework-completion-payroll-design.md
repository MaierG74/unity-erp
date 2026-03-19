# Piecework Completion → Payroll Design

**Date**: 2026-03-11
**Status**: Backend phase 1 applied — UI completion flow and payroll review refinements pending
**Scope**: Production completion flow, partial completion, remainder handling, piecework payroll attribution
**Decision owners**: Greg (product), Codex (backend review), Claude (UI implementation)

---

## 0. Current System Summary

### What works today

| Flow | Status |
|------|--------|
| Work pool → issued job card → scheduled on labor board | Working |
| Complete from scheduler → completes linked job card | Working (recently fixed) |
| Production queue completed filter reads from completed job cards | Working |
| Piecework payroll reads from `staff_piecework_earnings` view | Working |
| Transfer RPC splits cards and applies `piece_rate_override` | Working |
| Hourly payroll from time summaries / clocking | Working (separate system) |

### What's broken or missing

| Problem | Impact |
|---------|--------|
| `complete_job_card` RPC auto-fills untouched items to full quantity | No true partial completion — remaining qty silently marked complete |
| Scheduler drag-drop updates `labor_plan_assignments.staff_id` only, NOT `job_cards.staff_id` | Payroll attribution diverges from schedule after casual reassignment |
| No explicit completion actor on job cards | Can't audit who actually completed the work vs who gets paid |
| No remainder disposition model | Short completions vanish — no return-to-pool, no follow-up card, no scrap tracking |
| `complete_assignment_with_card` RPC exists in Supabase but has NO migration file in repo | DB reality vs repo history is out of sync |
| No payroll lock mechanism | Completed cards can be reopened/modified after payroll is approved |

### Key design decisions (confirmed with Greg)

1. **Worker self-completes, supervisor reviews/corrects in payroll** — no approval bottleneck on the floor
2. **Remainder disposition is mandatory at completion time** — nothing silently vanishes
3. **`job_cards.staff_id` remains the single source of truth for piecework pay** — no new earnings table
4. **Scheduler reassignment must update card ownership atomically** — no split-brain between scheduler and payroll

---

## 1. Source of Truth Model

### Ownership Matrix

| Concept | Source of Truth | Sync Mechanism |
|---------|----------------|----------------|
| Schedule ownership | `labor_plan_assignments.staff_id` | Scheduler UI drag-drop |
| Payroll ownership | `job_cards.staff_id` | Synced from assignment on pre-start reassign; transfer RPC on mid-work move |
| Completion actor | `job_cards.completed_by_user_id` (**new column**) | Set to the logged-in user who completed the card |
| Remainder disposition | `job_card_items.remainder_action` + `job_card_items.remainder_reason` (**new columns**) | Forced at completion time for short items |

### Rule: Scheduler reassignment must sync to job card

When a card is dragged to a different staff lane on the scheduler:

- **If `job_status` is `issued` or `scheduled` (work not started)**: Update both `labor_plan_assignments.staff_id` AND `job_cards.staff_id` in the same mutation. Simple reassignment.
- **If `job_status` is `in_progress`**: Block the drag-drop. Force the user through the transfer flow (which correctly handles splits via the existing `transfer_assignment` RPC).

This is the **highest-value structural change** needed to close the payroll-schedule divergence gap.

### Implementation note

The `updateJobSchedule()` function in `src/lib/mutations/laborPlanning.ts` (line 274) currently only updates `labor_plan_assignments`. It needs to also update `job_cards.staff_id` when the linked card exists and work hasn't started.

**Recommendation**: use an atomic RPC (`reassign_scheduled_card`) that updates both `labor_plan_assignments` and `job_cards` in one transaction. This is payroll-affecting state, so atomicity matters more than keeping the mutation purely client-driven.

---

## 2. State Lifecycle

### Job Card Item Lifecycle

```
pending ──→ in_progress ──→ completed
                │                │
                │                ├──→ full completion
                │                └──→ partial completion metadata
                │                       ├──→ remainder: 'return_to_pool'
                │                       ├──→ remainder: 'follow_up_card'
                │                       ├──→ remainder: 'scrap'
                │                       └──→ remainder: 'shortage'
                │
                └──→ cancelled
```

### Item status strategy

Do **not** introduce a new `partial_complete` item status in Phase 1.

Use the existing terminal `completed` status together with explicit remainder metadata:

```
status = 'completed'
completed_quantity < quantity
remainder_action IS NOT NULL
```

That keeps existing queue/payroll/reporting filters stable while still making partial completion explicit.

### New Columns on `job_card_items`

| Column | Type | Purpose |
|--------|------|---------|
| `remainder_action` | TEXT CHECK (`'return_to_pool'`, `'follow_up_card'`, `'scrap'`, `'shortage'`) | What happened to the unfinished portion |
| `remainder_qty` | INTEGER | Explicit: `quantity - completed_quantity` at completion time |
| `remainder_reason` | TEXT | Free-text reason (e.g., "board shortage", "machine breakdown") |
| `remainder_follow_up_card_id` | INTEGER FK → job_cards | If `follow_up_card`, links to the new card created for remainder |
| `issued_quantity_snapshot` | INTEGER | Preserves the original issued qty when pool math needs to subtract a returned remainder |

### New Columns on `job_cards`

| Column | Type | Purpose |
|--------|------|---------|
| `completed_by_user_id` | UUID FK → auth.users | The logged-in actor who completed the card (audit trail) |
| `completion_type` | TEXT CHECK (`'full'`, `'partial'`, `'cancelled'`) | Quick filter for payroll review |

### Job Card Lifecycle

```
pending ──→ in_progress ──→ completed (all items full or partial_complete with disposition)
                │
                └──→ cancelled (cascade: all pending/in_progress items → cancelled)
```

**No new card-level statuses needed.** A card with some short items is still `completed` at card level — it went through the completion flow and everything is accounted for.

---

## 3. Completion UX Strategy

### Unified Completion Dialog

Currently there are 3 completion paths (job card detail, scheduler, factory floor) with different levels of granularity. **Unify them into a single completion dialog component** used everywhere.

#### Dialog Flow

**Step 1: Confirm Worker**

```
┌─────────────────────────────────────────┐
│  Complete Job Card #247                  │
│                                          │
│  Assigned to: John Smith                 │
│  ☐ Change worker (dropdown if checked)   │
│                                          │
│  Actual start: [09:15]  End: [11:30]     │
│  Duration: 2h 15m (scheduled: 2h 00m)   │
└─────────────────────────────────────────┘
```

- Shows `job_cards.staff_id` name as default
- Checkbox to override (rare — for when someone else actually did the work)
- If overridden, updates `job_cards.staff_id` before completion
- `completed_by_user_id` always records the logged-in user

**Step 2: Confirm Quantities + Handle Remainders**

```
┌──────────────────────────────────────────────────────┐
│  Items                                                │
│                                                       │
│  Edge Banding - Oak         Issued: 30                │
│  Completed: [20]  Rate: R12.50  Earned: R250.00      │
│                                                       │
│  ⚠ 10 units remaining — what happened?                │
│  ○ Return to pool (re-issuable)                       │
│  ○ Create follow-up card (assign to someone)          │
│  ○ Mark as scrap / waste                              │
│  ○ Mark as shortage (material/upstream issue)          │
│  Reason: [board shortage from supplier___________]    │
│                                                       │
│  ─────────────────────────────────────────────────    │
│  Cutting - Panels           Issued: 30                │
│  Completed: [30]  Rate: R8.00   Earned: R240.00      │
│  ✓ Full completion                                    │
│                                                       │
│  ─────────────────────────────────────────────────    │
│  Total piecework: R490.00                             │
└──────────────────────────────────────────────────────┘
```

- Each item shows issued qty and an editable completed qty (pre-filled with issued qty)
- If `completed_qty < issued_qty`, the remainder section appears **inline for that item**
- Remainder disposition is **required** — dialog cannot submit without choosing
- Reason field is required for scrap/shortage, optional for return-to-pool and follow-up
- Running total of piecework earnings shown at bottom

**Step 3: Confirm and Submit**

```
┌──────────────────────────────────────────┐
│  Summary                                  │
│                                           │
│  Worker: John Smith                       │
│  Items completed: 2 of 2                  │
│  Total earned: R490.00                    │
│  Remainders: 10 units → return to pool    │
│                                           │
│  [Cancel]              [Complete Job Card] │
└──────────────────────────────────────────┘
```

### Remainder Actions — What Each Does

| Action | Backend Effect |
|--------|---------------|
| **Return to pool** | Item stays `completed`. Remainder metadata is recorded and the pool `issued_qty` calculation subtracts the returned remainder instead of mutating away issuance history. |
| **Follow-up card** | Item stays `completed`. New job card created immediately with `quantity = remainder_qty`, linked via `remainder_follow_up_card_id`. New card is `pending`, unassigned — appears in pool/queue for scheduling. |
| **Scrap** | Item stays `completed`. Remainder recorded but no reissuance. `remainder_action = 'scrap'`. Visible in reporting. |
| **Shortage** | Same as scrap mechanically, but different category. `remainder_action = 'shortage'`. Signals upstream/material issue vs worker waste. |

---

## 4. Remainder Handling — Detailed Decision Model

### Recommended approach: Follow-Up Card as default, Return to Pool as alternative

**Why follow-up card is the primary mechanism:**

1. **Explicit ownership**: A new card means someone must be assigned and scheduled. Nothing floats in limbo.
2. **Clean payroll**: The follow-up card has its own `staff_id`, `piece_rate`, and `completed_quantity`. No shared-state complexity.
3. **Audit trail**: Original card → `remainder_follow_up_card_id` → new card. Complete chain of custody.
4. **Works with existing system**: `issue_job_card_from_pool` already creates cards. We just need a variant that creates from a remainder instead of from pool demand.

**When return-to-pool makes sense:**

- The work genuinely doesn't need to happen right now (e.g., order quantity changed, over-issued)
- Supervisor wants to batch remainders and reissue later

**Implementation for return-to-pool:**

Do **not** mutate away the original issued quantity just to make the pool math work. Preserve issuance history.

Instead:
1. Mark the item `completed` with `completed_quantity < quantity`
2. Record `remainder_action = 'return_to_pool'` and `remainder_qty = quantity - completed_quantity`
3. Preserve the original issued amount in `issued_quantity_snapshot`
4. Update the work-pool status view so `issued_qty` subtracts returned-to-pool remainder for those items
5. The pool's `remaining_qty` increases accordingly — remainder is now available for re-issuance

This keeps the audit trail intact while still making the pool reusable.

**What about scrap/shortage?**

These are terminal dispositions — the units are gone. The item stays at its original `quantity`, `completed_quantity` reflects reality, and the `remainder_qty` is explicitly recorded as lost. This affects:
- Yield reporting (future)
- Order fulfillment tracking (can the order still ship?)
- No payroll impact (you don't get paid for scrapped units)

### Decision Tree at Completion Time

```
completed_qty == issued_qty?
  YES → status = 'completed', done
  NO  → remainder_qty = issued_qty - completed_qty
        │
        User must choose:
        ├─ "Return to pool" → adjust item qty down, pool reabsorbs
        ├─ "Create follow-up card" → new card with remainder_qty
        ├─ "Scrap" → lost units, reason required
        └─ "Shortage" → upstream issue, reason required
```

---

## 5. Payroll Strategy

### Source of truth: `job_cards.staff_id` (no change)

The existing `staff_piecework_earnings` view already correctly computes:
```sql
earned_amount = completed_quantity × COALESCE(piece_rate_override, piece_rate)
```

With the changes in this design:
- **Full completion**: `completed_quantity = quantity`, `earned_amount` is the full piece rate. No change.
- **Partial completion**: `completed_quantity < quantity`, `earned_amount` is proportional. The worker gets paid for what they actually did. No change needed in the view.
- **Remainder follow-up card**: New card, new `staff_id` (maybe same worker, maybe different). Payroll naturally splits. No change needed in the view.
- **Scrap/shortage**: Worker gets paid for `completed_quantity` only. Correct by default.
- **Return to pool**: Item `quantity` is adjusted down to match `completed_quantity`, so `earned_amount` stays correct.

### Preventing wrong-worker pay

The gap today is scheduler reassignment not syncing to `job_cards.staff_id`. With Rule 1 from Section 1 (sync on drag-drop), this is closed.

Scenario walkthrough:

| Scenario | How it's handled |
|----------|-----------------|
| Full completion, same worker | Card staff_id = assigned worker. Payroll correct. |
| Reassignment before work starts (drag-drop) | New: mutation syncs staff_id to card. Payroll correct. |
| Mid-work transfer | Existing: transfer RPC splits cards with piece_rate_override. Payroll correct. |
| Someone else completes (e.g., supervisor finishing a card) | `completed_by` records who clicked. `staff_id` stays as the worker being paid. Override available in dialog if needed. |

### Preventing duplicate pay

| Risk | Mitigation |
|------|-----------|
| Remainder reissued as follow-up card | Original item has `completed_quantity` < `quantity`. Follow-up card starts at `completed_quantity = 0`. No overlap. |
| Remainder returned to pool, reissued | Original item's `quantity` adjusted down. New card from pool has its own quantities. No overlap. |
| Card reopened after payroll | **New: Payroll lock.** Once `staff_weekly_payroll.status = 'approved'`, cards with `completion_date` in that week cannot be reopened or modified. Enforced at RPC level. |

### Payroll lock mechanism

Add a check to any card-modification RPC:

```sql
-- Before allowing reopen/edit on a completed card:
SELECT 1 FROM staff_weekly_payroll
WHERE staff_id = card.staff_id
  AND week_start_date <= card.completion_date
  AND week_end_date >= card.completion_date
  AND status IN ('approved', 'paid');
-- If found, reject the modification.
```

This prevents post-approval tampering while keeping cards editable during the review window.

### Payroll review page enhancements

The payroll review page (`app/payroll-review/page.tsx`) should show:
- A **partial completion** indicator next to items where `completed_quantity < quantity`
- The `remainder_action` for context (returned to pool, follow-up, scrap, shortage)
- The `completed_by` if different from `staff_id` (flag for supervisor attention)
- Ability to override `staff_id` on a card during payroll review (before approval) — for cases where the wrong person was credited

---

## 6. Staged Implementation Plan

### Phase 1: Backend Foundation (Codex)

**1a. Reconcile `complete_assignment_with_card` RPC**
- Export the current function definition from Supabase (`pg_dump` or `\df+`)
- Create a migration file that matches the live DB state exactly
- Verify the migration applies cleanly on a fresh branch
- **Risk**: Low. This is a documentation/repo-hygiene fix, no behavior change.

**1b. Schema changes — new columns**
- Migration: Add to `job_card_items`:
  - `remainder_action` TEXT CHECK ('return_to_pool', 'follow_up_card', 'scrap', 'shortage') DEFAULT NULL
  - `remainder_qty` INTEGER DEFAULT NULL
  - `remainder_reason` TEXT DEFAULT NULL
  - `remainder_follow_up_card_id` INTEGER FK → job_cards DEFAULT NULL
- Migration: Add to `job_cards`:
  - `completed_by` INTEGER DEFAULT NULL
  - `completion_type` TEXT CHECK ('full', 'partial', 'cancelled') DEFAULT NULL
- Migration: Add `partial_complete` to `job_card_items.status` CHECK constraint
- **Risk**: Low. All new columns are nullable with defaults. No existing data changes.

**1c. New RPC: `complete_job_card_v2`**
- Replaces `complete_job_card` behavior (keep old one for backward compat during rollout)
- Parameters:
  ```
  p_job_card_id INTEGER,
  p_completed_by_user_id UUID,
  p_items JSONB — array of {
    item_id: INTEGER,
    completed_quantity: INTEGER,
    remainder_action: TEXT (nullable),
    remainder_reason: TEXT (nullable)
  }
  ```
- Logic:
  1. Lock card (FOR UPDATE)
  2. Verify org access
  3. For each item in `p_items`:
     - Set `completed_quantity` to provided value
     - If `completed_quantity = quantity`: set `status = 'completed'`
     - If `completed_quantity < quantity` AND `remainder_action` provided:
       - Keep `status = 'completed'`
       - Set `remainder_action`, `remainder_qty = quantity - completed_quantity`, `remainder_reason`
       - Set `issued_quantity_snapshot = quantity`
       - If `remainder_action = 'follow_up_card'`: call sub-function to create follow-up card
     - If `completed_quantity < quantity` AND no `remainder_action`: RAISE EXCEPTION (enforce the rule)
  4. Set `job_cards.completed_by_user_id = p_completed_by_user_id`
  5. Set `job_cards.completion_type` based on whether any items have remainder metadata
  6. Set `job_cards.status = 'completed'`, `completion_date = CURRENT_DATE`
  7. Set `completion_time` on all completed items
- **Risk**: Medium. New RPC, but old one stays until UI is migrated. No breaking change.

**1d. Follow-up card creation (sub-function of 1c)**
- When `remainder_action = 'follow_up_card'`:
  1. Create new `job_cards` row: same `order_id`, `staff_id = NULL` (unassigned), `status = 'pending'`
  2. Create new `job_card_items` row: same `product_id`, `job_id`, `piece_rate`, `work_pool_id`; `quantity = remainder_qty`, `completed_quantity = 0`
  3. Set `remainder_follow_up_card_id` on original item pointing to new card
  4. Return new card ID for UI display
- **Risk**: Low. Creates new rows only.

**1e. Scheduler reassignment sync**
- Modify `updateJobSchedule` path to also update `job_cards.staff_id` when:
  - The assignment has a linked job card (parse `job_instance_id` for `:card-{id}`)
  - The card's `job_status` is NOT `in_progress`
- If `job_status = 'in_progress'`, reject the reassignment with an error message directing user to use the transfer flow
- **Implementation choice**: use a new RPC `reassign_scheduled_card(...)` that updates both tables atomically and returns the updated assignment row. Do not rely on two client-side writes for payroll-affecting ownership.
- **Risk**: Medium. Changes existing reassignment behavior. Must test that existing drag-drop still works for non-card assignments.

**1f. Payroll lock check**
- Add a guard function: `is_job_card_payroll_locked(p_staff_id, p_completion_date)` → BOOLEAN
- Returns TRUE if `staff_weekly_payroll` has status `'approved'` or `'paid'` for the week containing that date
- Call this at the top of `complete_job_card_v2` (prevent re-completion into locked period)
- Call this before any card reopen/edit operation
- **Risk**: Low. Read-only check, no data changes.

### Phase 2: UI — Completion Dialog (Claude)

**2a. Unified completion dialog component**
- New component: `components/features/completion/CompletionDialog.tsx`
- Props: `jobCardId`, `assignmentId?`, `onComplete`
- Fetches card + items + staff info
- Implements the 3-step flow from Section 3:
  1. Confirm worker (with override option)
  2. Per-item quantities with inline remainder disposition
  3. Summary and confirm
- Calls `complete_job_card_v2` RPC
- If `assignmentId` provided, also updates `labor_plan_assignments.job_status` and actual times
- **Risk**: Medium. Replaces existing completion dialogs. Must handle all edge cases.

**2b. Wire unified dialog into existing completion points**
- Replace `components/labor-planning/complete-job-dialog.tsx` usage with new dialog
- Replace `components/factory-floor/complete-job-dialog.tsx` usage with new dialog
- Replace job card detail page inline completion with new dialog
- **Risk**: Medium. Regression risk on 3 existing flows. Test each.

**2c. Scheduler drag-drop guard**
- In `labor-planning-board.tsx` `handleDrop`: before calling `updateJobSchedule`, check if the assignment's `job_status === 'in_progress'`
- If yes, show toast: "This job is in progress. Use Transfer to reassign."
- If no, proceed with reassignment (which now syncs card staff_id via Phase 1e)
- **Risk**: Low. UI guard only.

### Phase 3: Payroll Review Enhancements (Claude)

**3a. Partial completion indicators**
- In payroll review page, when expanding a staff member's piecework details:
  - Show icon/badge for cards/items with remainder metadata
  - Show `remainder_action` label (returned, follow-up, scrap, shortage)
  - Show `completed_by_user_id` if different from the worker being paid

**3b. Staff override in payroll review**
- Add ability to reassign a completed card's `staff_id` during payroll review (before approval)
- This handles edge cases where the wrong person was credited
- Must update both `job_cards.staff_id` and refresh the `staff_piecework_earnings` view
- **Risk**: Low. Only available when payroll status is `pending` or `new`.

**3c. Remainder reporting**
- Add a "Remainders" tab or section to production page showing:
  - Items with `remainder_action = 'return_to_pool'` — now available for re-issuance
  - Items with `remainder_action = 'follow_up_card'` — pending scheduling
  - Items with `remainder_action = 'scrap'` or `'shortage'` — loss tracking
- **Risk**: Low. Read-only reporting.

### Phase 4: Validation & Testing (Both)

**4a. Migration testing**
- Apply all Phase 1 migrations to a Supabase branch
- Verify `complete_job_card_v2` with full completion, partial completion, each remainder action
- Verify payroll lock prevents modification of locked-week cards
- Verify reassignment sync updates card staff_id
- Run `get_advisors` security check for new columns/functions

**4b. Integration testing**
- Test each scenario from Section 7 via Chrome MCP
- Verify payroll review shows correct amounts after each scenario

**4c. Rollout**
- Deploy Phase 1 (backend) first — all backward compatible
- Deploy Phase 2 (completion dialog) — replaces existing dialogs
- Deploy Phase 3 (payroll enhancements) — additive only
- Remove old `complete_job_card` RPC after confirming no callers remain

---

## 7. Acceptance Criteria & Test Scenarios

### Scenario 1: Full completion, same worker
- Issue card to John, 30 units at R12.50
- Schedule on John's lane
- Complete: `completed_qty = 30`
- **Expected**: Card status `completed`, `completion_type = 'full'`. Payroll shows John earning R375.00.

### Scenario 2: Completion after scheduler reassignment (pre-start)
- Issue card to John, 30 units
- Drag to Mary's lane on scheduler (work not started)
- Complete: `completed_qty = 30`
- **Expected**: `job_cards.staff_id` updated to Mary during drag. Payroll shows Mary earning R375.00. John shows R0.

### Scenario 3: Completion after mid-work transfer
- Issue card to John, 30 units at R12.50
- John starts, completes 10 units
- Transfer to Mary (existing transfer RPC)
- Mary completes remaining 20 units
- **Expected**: John's card: 10 units × R12.50 = R125. Mary's card: 20 units × R12.50 = R250. Payroll correct for both.

### Scenario 4: Partial completion — return to pool
- Issue card to John, 30 units from pool (pool required = 30)
- Complete: `completed_qty = 20`, remainder action = `return_to_pool`, reason = "board shortage"
- **Expected**:
  - Item `status = 'completed'`, `completed_quantity = 20`
  - `remainder_qty = 10`, `remainder_action = 'return_to_pool'`
  - Pool `remaining_qty` now shows 10 available
  - Payroll: John earns R250.00 (20 × R12.50)

### Scenario 5: Partial completion — follow-up card
- Issue card to John, 30 units
- Complete: `completed_qty = 20`, remainder action = `follow_up_card`
- **Expected**:
  - Original item: `status = 'completed'`, `remainder_follow_up_card_id` points to new card
  - New card: `staff_id = NULL`, `status = 'pending'`, item `quantity = 10`
  - New card appears in production queue as pending/unassigned
  - Payroll: John earns R250.00. No duplicate when follow-up card is later completed.

### Scenario 6: Partial completion — scrap
- Issue card to John, 30 units
- Complete: `completed_qty = 20`, remainder action = `scrap`, reason = "defective material"
- **Expected**:
  - Item `status = 'completed'`, `remainder_action = 'scrap'`
  - 10 units are gone — not reissuable, not in pool
  - Payroll: John earns R250.00
  - Remainder reporting shows 10 scrapped units with reason

### Scenario 7: Payroll shows correct employee after reassignment
- Issue to John → drag to Mary (pre-start) → complete as Mary
- **Verify**: `staff_piecework_earnings` view returns Mary, not John
- **Verify**: Payroll review page shows earnings under Mary's row

### Scenario 8: No duplicate pay after remainder reissue
- Issue 30 to John → partial complete 20 (return to pool) → reissue 10 from pool to Mary → Mary completes 10
- **Verify**: John's payroll = 20 × rate. Mary's payroll = 10 × rate. Sum = 30 × rate. No overlap.

### Scenario 9: Payroll lock prevents post-approval tampering
- Complete card, approve payroll for that week
- Attempt to reopen card or modify completed_quantity
- **Expected**: Operation rejected with clear error message

### Scenario 10: Completion by different person than payee
- Card assigned to John. Supervisor Mary clicks Complete.
- **Expected**: `job_cards.staff_id = John` (payee), `job_cards.completed_by_user_id = Mary's auth user id` (actor). Payroll goes to John.

---

## 8. Risks & Edge Cases

### High risk
| Risk | Mitigation |
|------|-----------|
| Existing `complete_assignment_with_card` RPC is undocumented — changing completion behavior could break factory floor | Phase 1a: reconcile to repo first. Phase 2: replace callers before modifying. |
| Partial completion + return-to-pool can distort pool math | Preserve original issuance on the item and teach the pool view to subtract returned remainder instead of rewriting history. |
| Multiple follow-up cards from same original (re-partial) | Follow-up cards are independent. Each tracks its own `remainder_follow_up_card_id` back to its source. Chain is walkable. |

### Medium risk
| Risk | Mitigation |
|------|-----------|
| Scheduler drag-drop now has a side effect (card sync) | Only fires for assignments with linked cards. Non-card assignments unchanged. Test regression. |
| `in_progress` drag-drop block may frustrate supervisors | Clear toast explaining why + directing to transfer flow. Transfer is already built. |
| Payroll lock may be too restrictive (supervisor needs to fix after approval) | Add "unapprove" action on payroll review page that unlocks the week. Only available to org admins. |

### Low risk
| Risk | Mitigation |
|------|-----------|
| New columns on existing tables | All nullable with defaults. Zero-downtime migration. |
| Old `complete_job_card` RPC still called somewhere | Keep it working during rollout. Search for callers before removing. |
| `staff_piecework_earnings` view needs updating | Only if column names changed. With this design, no view changes needed — it already reads `completed_quantity × COALESCE(piece_rate_override, piece_rate)`. |

### Edge cases to handle

1. **Worker completes 0 of 30**: All items get `remainder_action`. Card status = `completed`, `completion_type = 'partial'`. Valid — e.g., machine broke, nothing was produced but the card is resolved.

2. **Multiple items on one card, mixed completion**: Item A = full, Item B = short (return to pool), Item C = short (scrap). Each item handles its own remainder independently. Card = `completed`, `completion_type = 'partial'`.

3. **Follow-up card is itself partially completed**: Creates another follow-up card. Chain continues. Each link is independent with its own `staff_id` and payroll attribution.

4. **Card with no piecework (hourly job)**: Completion dialog still shows but `piece_rate = 0` or null. No remainder disposition needed for hourly items (no pay-per-unit). Simplify: only show remainder section for items with `piece_rate > 0`.

5. **Concurrent completion attempts**: `FOR UPDATE` lock on card row in RPC prevents race conditions. Second caller gets "card already completed" error.

---

## 9. Final Recommendation

**Build this incrementally on the existing system.** The current architecture is 80% correct — `job_cards.staff_id` as payroll source of truth, `staff_piecework_earnings` view, transfer RPC with splits. The gaps are specific and fixable:

1. **Close the reassignment sync gap** (Phase 1e) — via an atomic RPC. This is the highest-value fix per line of code. It eliminates the most common source of wrong-worker pay.

2. **Replace `complete_job_card` with `complete_job_card_v2`** (Phase 1c) — this is the core behavioral change. It forces remainder disposition and records actual quantities. Everything else flows from this.

3. **Build one unified completion dialog** (Phase 2a) — three dialogs with different behavior is a UX and maintenance problem. One dialog, one flow, one source of truth.

4. **Add payroll lock last** (Phase 1f) — it's important but low urgency. The current system has no lock and hasn't caused payroll disasters yet. Ship the completion improvements first.

**Do NOT build a separate earnings allocation table.** The `job_cards` + `job_card_items` model with the existing `staff_piecework_earnings` view is sufficient. Adding another table would create two sources of truth and double the reconciliation surface.

**Do NOT change the payroll calculation logic** (`lib/payroll-calc.ts`). It already handles the math correctly: `SUM(earned_amount)` per staff. With correct `completed_quantity` values flowing in from the improved completion dialog, the payroll output will be correct without any calc changes.

**The riskiest moment is Phase 2b** — swapping out three existing completion dialogs. Mitigate by: building the unified dialog as a new component (not editing existing ones), wiring it in one location at a time, and testing each swap via Chrome MCP before moving to the next.

### Work split

| Owner | Phases | Deliverables |
|-------|--------|-------------|
| **Codex** (backend) | 1a, 1b, 1c, 1d, 1e, 1f | Migrations, RPCs, payroll lock |
| **Claude** (UI) | 2a, 2b, 2c, 3a, 3b, 3c | Completion dialog, scheduler guard, payroll review |
| **Both** | 4a, 4b, 4c | Testing, validation, rollout |

Codex ships Phase 1 first. Claude builds Phase 2 against the new RPCs. Phase 3 is additive and can be done in parallel or after.
