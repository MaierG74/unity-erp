# Factory Floor Map

Real-time overhead view of the factory showing active staff, their current jobs, and time-based progress across factory sections.

## Overview

The Factory Floor page (`/factory-floor`) provides supervisors with an at-a-glance view of what's happening across the factory. Staff who have been issued or started jobs via the [Labor Planning Board](/labor-planning) appear in their respective factory sections with live progress tracking.

**URL**: `/factory-floor`
**Sidebar**: Factory Floor (between Scheduling and Purchasing)
**Role access**: All authenticated users

## Factory Sections

Five configurable sections, stored in the `factory_sections` database table:

| Section | Color | Main Category Link | Grid Span |
|---------|-------|--------------------|-----------|
| Steel Section | Blue (`#0ea5e9`) | Steel Work | 1 col |
| Cut & Edge | Orange (`#f97316`) | — (unlinked) | 1 col |
| Assembly | Green (`#22c55e`) | Woodworking Assembly | 2 cols |
| QC | Red (`#e11d48`) | Quality Control | 1 col |
| Upholstery | Purple (`#a855f7`) | — (unlinked) | 1 col |

Sections are **configurable** — new sections can be added to `factory_sections` and linked to a top-level `job_categories` entry. Jobs are routed to sections automatically based on their main category, so child subcategories such as `Brackets` inherit the parent section mapped to `Steel Work`.

## How It Works

1. A supervisor schedules staff on the **Labor Planning Board** (`/labor-planning`)
2. Jobs are **issued** to staff (status: `issued`)
3. Staff **start** working (status: `in_progress`)
4. The Factory Floor shows all `issued` and `in_progress` jobs grouped by section
5. Progress is auto-calculated: `elapsed_minutes / estimated_minutes × 100`
6. `Issued` jobs follow their scheduled slot on the floor: before the slot they stay at `0%`, during the slot they advance automatically based on scheduled elapsed time, and manual progress overrides still win
7. The page refreshes every 60 seconds and also listens for realtime database changes

Jobs only render when their top-level category resolves to an active `factory_sections` row. If a main category is not linked to any active floor section yet, issued jobs in that category and its subcategories will not appear on the map until the section mapping is configured.

## Progress Tracking

### Auto-calculated progress
Progress percentage is computed from the job's estimated duration (from bill of labour) vs time elapsed since the job started. For `issued` jobs that have not been manually started yet, the Factory Floor UI instead follows the scheduled slot (`assignment_date`, `start_minutes`, `end_minutes`) so large teams do not need to manually start every card just to keep the floor current. Manual progress overrides still take precedence over both timing modes.

### Manual override
Supervisors can click any staff card to open a detail panel and override the auto-calculated progress with a manual value (0–100%, in 5% steps). Overrides persist until cleared.

### Status colors
- **Green**: On track or ahead of schedule
- **Amber**: Slightly behind (within 20% of expected)
- **Red**: Significantly behind (>20% of expected)

## UI Components

### Page layout
CSS Grid with 2 columns. Assembly spans both columns (largest section). Each section is a card/zone showing its staff.

### Staff cards
Each staff member shows:
- Status dot (blue = issued, amber = in progress, orange = on hold)
- Staff name
- Order number and job name
- Product name
- Color-coded progress bar with percentage
- For `issued` jobs, the bar follows the scheduled slot until the job is manually started

### Detail panel (slide-out)
Click any staff card to open a right-side panel showing:
- Full job details (job name, section, product, order)
- Time info (issued/started at, scheduled slot, estimated duration, elapsed)
- Progress bar with progress-health badge plus a lifecycle status badge that matches Queue and Schedule
- Override slider (set manual progress or reset to auto)
- Link to view the full order

## Database

### Tables

**`factory_sections`** — configurable factory zones
- `section_id` (PK), `name`, `display_order`, `category_id` (FK → `job_categories`), `color`, `grid_span` (1 or 2), `is_active`

**`labor_plan_assignments.progress_override`** — nullable SMALLINT (0–100)
- When NULL, progress is auto-calculated from time
- When set, overrides auto-progress display

### Views

**`factory_floor_status`** — main query view
- Joins: `labor_plan_assignments` → `jobs` → `job_categories` → `factory_sections` → `staff` → `orders` → `order_details` → `products` → `billoflabour`
- Filters: `job_status IN ('issued', 'in_progress')`
- Computes: `estimated_minutes`, `minutes_elapsed`, `auto_progress`, `progress_override`
- `minutes_elapsed` / `auto_progress` only advance after `started_at`; `issued` jobs remain visible at `0%`
- Sorted by: `section display_order`, then `staff first_name`

The Factory Floor UI layers schedule-aware progress on top of the view for `issued` work: it uses `assignment_date`, `start_minutes`, and `end_minutes` to display upcoming, current-slot, and elapsed-slot progress without forcing supervisors to manually start every scheduled card.

## File Structure

```
app/factory-floor/
  page.tsx                          # Page route

components/factory-floor/
  types.ts                          # Types, shared color maps, progress helpers
  factory-floor-page.tsx            # Main page component
  floor-header.tsx                  # Header with stats and refresh
  section-zone.tsx                  # Factory section card
  staff-job-card.tsx                # Staff member card with progress
  progress-bar.tsx                  # Color-coded progress bar
  floor-detail-panel.tsx            # Slide-out detail sheet
  sections-settings-dialog.tsx      # Settings dialog for managing sections

lib/queries/factoryFloor.ts         # Supabase fetch + mutation functions (floor status + section CRUD)
hooks/use-factory-floor.ts          # TanStack Query hook + realtime subscription
hooks/use-factory-sections.ts       # TanStack Query hook for section CRUD mutations
```

## Managing Sections (Settings Dialog)

Click the **Sections** button in the Factory Floor header to open the settings dialog. From here you can:

- **Add** a new section (click "+ Add Section")
- **Rename** a section (edit the name field inline)
- **Link to a main job category** (select from the Main category dropdown — jobs in that category and its subcategories automatically appear in the section)
- **Change color** (click the color swatch to open a color picker)
- **Set grid span** (toggle between "1 col" and "Wide" — wide spans 2 columns on the floor map)
- **Activate/deactivate** (toggle the Active switch — inactive sections are hidden from the floor map)
- **Reorder** (use the up/down arrows)
- **Delete** (click the trash icon — shows a confirmation dialog)

All changes save immediately. The floor map updates in real time.

### Example: Adding Powder Coating

1. Click **Sections** button in the header
2. Click **+ Add Section**
3. Rename "New Section" to "Powder Coating"
4. Select "Powder Coating" from the Main category dropdown
5. Pick a color (e.g., yellow)
6. Close the dialog — the new section appears on the floor map

## Shift Awareness

The Factory Floor is shift-aware — it knows when the shift ends and warns about jobs that won't finish in time.

### Shift status bar

The header shows the current shift window (e.g., "7:00 AM – 5:00 PM"), a countdown to shift end, and an **Extend Shift** control for overtime.

### Overtime (Extend Shift)

Click **Extend Shift** in the header to set overtime for today:
- Quick presets: +1 hour, +2 hours
- Custom end time (e.g., 18:30)
- Optional reason (e.g., "Rush order")
- Click **Clear** to remove overtime and revert to normal shift

Overtime is stored in the `shift_overrides` table (one row per org per date). It only affects today — tomorrow reverts to the normal schedule from `work_schedules`.

### Shift warnings on staff cards

Each staff card shows a warning line when a job is at risk:
- **Red**: Won't finish before shift end (overrun)
- **Amber**: Will finish but tight (<30 min margin)
- **Blue**: Would overrun normal shift but fits within approved overtime

Section headers also show an overrun count (e.g., "1 overrun").

### Detail panel — Shift section

The slide-out detail panel includes a **Shift** section showing:
- Shift end time (and overtime end if set)
- Estimated finish time for the job
- Shift status (on track, tight, overrun, within overtime)

### Stale job warning

If jobs from yesterday are still in `issued`/`in_progress` status, a warning appears in the header (e.g., "2 jobs from yesterday still active"). The supervisor can then decide to continue, reassign, or complete them.

### How shift time is calculated

Shift schedules come from the `work_schedules` table (configurable in Settings > Work Schedules). The system uses the correct schedule for the day of the week (Mon-Thu, Friday, Sat-Sun). Estimated finish times account for remaining breaks using the existing `stretchForBreaks()` algorithm.

### Database

**`shift_overrides`** — date-specific shift extensions
- `override_id` (PK), `org_id`, `override_date`, `extended_end_minutes`, `reason`, `created_by`, `created_at`
- Unique constraint on `(org_id, override_date)` — one override per org per day
- Org-scoped RLS

### Additional files

```
lib/shift-utils.ts                # Shift-aware progress calculations
hooks/use-shift-info.ts           # Shift info hook (schedule + overrides)
```

## Future Enhancements

- Wall-mounted TV mode (auto-rotating, no interaction needed)
- Show queued/upcoming jobs per section
- Section capacity indicators (X of Y staff assigned)
- Historical view (what happened today/this week)
- Direct job actions from the floor (mark complete, reassign)
