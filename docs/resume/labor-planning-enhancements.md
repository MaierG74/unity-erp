# Labor Planning Board Enhancements - Session Resume

**Last Updated:** February 24, 2026

## Current Work in Progress

### Completed Features

#### 1. Visual Status Indicators on Assignment Bars
- **Status:** ✅ Complete
- Assignment bars now show colored icons for job lifecycle:
  - 🟢 **Completed**: Green checkmark, 60% opacity
  - 🟡 **In Progress**: Amber play icon
  - 🔵 **Issued**: Blue clipboard icon
  - 🟠 **On Hold**: Orange pause icon
- Left accent stripe colors match job status
- Tooltips display status with icon and label

**Files:** `components/labor-planning/staff-lane-list.tsx`, `components/labor-planning/types.ts`

#### 2. Supabase Realtime Live-Sync
- **Status:** ✅ Complete
- Tables in `supabase_realtime` publication: `labor_plan_assignments`, `job_cards`, `job_card_items`, `time_clock_events`
- Custom hook `hooks/use-labor-realtime.ts` subscribes to changes and invalidates TanStack Query caches
- When jobs move, get issued, or complete on any device/phone, the board auto-updates via Realtime
- **Verification:** Open board on laptop, complete job on phone → board updates without refresh

**Files:** `hooks/use-labor-realtime.ts`, `app/labor-planning/labor-planning-board.tsx`

#### 3. Job Status Sync from Mobile Scan Page
- **Status:** ✅ Complete
- Phone scan page (`/scan/jc/[id]`) now syncs `job_status` back to `labor_plan_assignments`
- When you "Start Job" → sets `job_status = 'in_progress'`, `started_at` timestamp
- When you "Complete Job" → sets `job_status = 'completed'`, `completed_at` timestamp
- Helper: `syncAssignmentStatus()` in scan page

**Files:** `app/scan/jc/[id]/page.tsx`, scan page has additional features now (QR scanner, document picker, lazy-loaded components)

#### 4. Completed Quantity Auto-Fill
- **Status:** ✅ Complete
- When completing a job on phone:
  - **Untouched items** (completed_qty = 0) → auto-fill to full quantity
  - **Partial entries** (e.g., 80/100) → preserve the entered value
  - **Partial items** → mark status = 'completed', keep qty as-is
- Pattern: Smart enough to not override manual entries
- **Data cleanup:** Fixed item #10 (was 0/60, now 60/60)

**Files:** `app/scan/jc/[id]/page.tsx` → `handleCompleteJob()`

#### 5. Green Ring Highlight on Job Click
- **Status:** ✅ Complete
- When clicking a job in the order tree, assignment bar now shows green outline ring
- Technical fix: Switched from Tailwind `ring-*` (uses box-shadow, overridden by bar's inline styles) to CSS `outline` + `outlineOffset`
- Ring appears for 1.5 seconds, then fades

**Files:** `app/labor-planning/labor-planning-board.tsx` → `handleJobClick()`

#### 6. Fixed Issue Quantity Calculation
- **Status:** ✅ Complete
- **Bug:** Was summing ALL job card items (including already-issued/completed ones) → showed 120 available instead of 60
- **Fix:** Query now only counts:
  - Items on **unassigned cards** (`staff_id IS NULL`)
  - With **non-completed status** (`status != 'completed'`)
- Shows correct available qty for issuing

**Files:** `components/labor-planning/staff-lane-list.tsx` → `useEffect` for availableQty

#### 7. Job Lifecycle Status in Order Tree
- **Status:** ✅ Complete
- Left panel order tree now shows colored status labels for each job:
  - 🟢 **Completed** (green)
  - 🟡 **In Progress** (amber)
  - 🔵 **Issued** (blue)
  - 🟠 **On Hold** (orange)
  - 🟣 **Scheduled** (violet) — if assigned but not issued yet
  - Gray → **Ready** (unscheduled)
- Replaces generic "Ready/Scheduled" text with actionable status

**Files:** `components/labor-planning/order-tree.tsx`, `lib/queries/laborPlanning.ts`

#### 8. Historical Data for Completed Jobs
- **Status:** ✅ Complete (with type issues TBD)
- **Problem:** Completed jobs from closed orders weren't showing product name, order number, customer in tooltips
- **Solution:** Enrichment in `fetchLaborPlanningPayload()`:
  - Identifies "orphaned" assignments (jobs not in open-orders list)
  - Queries `orders`, `jobs`, `order_details` tables to fetch missing metadata
  - Synthesizes `PlanningOrder` entries for display
- Completed jobs now retain full details in bars & tooltips for historical reference

**Files:** `lib/queries/laborPlanning.ts` → `fetchLaborPlanningPayload()`
**Note:** Pre-existing type errors at lines 623/632/633 (unrelated to recent changes). Mutations file had missing fields added to `LaborPlanAssignment` normalizers.

---

## Known Issues & Blockers

### Type Errors (Non-blocking)
- `lib/queries/laborPlanning.ts` lines 623, 632, 633: Pre-existing type issues (not from recent work)
- All labor-planning and scan-related types now compile cleanly
- Build/dev mode not blocked

### Next Steps (If Resuming)
1. **Test real-time on multiple devices** — open board on 2 laptops, complete job on phone, verify both boards update
2. **Verify historical data** — complete a job, navigate away, come back → order details should still show in tooltip
3. **Mobile phone testing** — link: `http://192.168.68.116:3000/scan/jc/{card-id}`

---

## Key Queries & Data Flows

### Week Summary Cache
- Key: `['labor-planning-week-summary', mondayDate]`
- 5-minute staleTime
- Shows utilization bars for Mon-Fri

### Labor Planning Query
- Key: `['labor-planning', selectedDate]`
- Fetches: orders with jobs, staff roster, assignments for the day
- Enriches orphaned assignments with metadata from closed orders

### Realtime Subscriptions
- Channel: `labor-board-sync`
- Watches: `labor_plan_assignments.*`, `job_cards.*`, `job_card_items.*`
- Action: Invalidate `['labor-planning', *]` and `['labor-planning-week-summary', *]`

---

## File Structure

```
app/
  labor-planning/
    labor-planning-board.tsx     (Main board, Realtime hook, handleJobClick)
    page.tsx
  scan/jc/[id]/
    page.tsx                     (Mobile scan, syncAssignmentStatus, auto-fill)

components/
  labor-planning/
    order-tree.tsx               (Status labels in left panel)
    staff-lane-list.tsx          (Bars with status icons, issue/un-issue)
    types.ts                     (Added jobStatus to PlanningJob)
    week-strip.tsx               (Already built)

hooks/
  use-labor-realtime.ts          (NEW: Realtime subscriptions)

lib/queries/
  laborPlanning.ts               (Week summary, orphaned enrichment)

src/lib/mutations/
  laborPlanning.ts               (Cache invalidation)
```

---

## Testing Checklist

- [ ] Start job on phone → board shows "In Progress" in real-time
- [ ] Complete job on phone → board shows "Completed" with green checkmark
- [ ] Completed job quantity shows correct final value (e.g., 80/100 if you entered 80)
- [ ] Click job in order tree → jumps to/highlights assignment bar with green ring
- [ ] Completed job bar shows faded appearance and full historical details in tooltip
- [ ] Order tree shows colored status badges for all jobs
- [ ] Week strip updates when jobs change
- [ ] No console errors on navigation

---

## Session Notes

- Realtime working perfectly after adding tables to publication
- Mobile sync now bidirectional (was only phone → DB before)
- Historical data enrichment handles closed orders gracefully
- Type system mostly clean, pre-existing issues isolated
