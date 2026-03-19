# Tasks Module Redesign - Design Document

**Date:** 2026-03-05
**Status:** Approved

## Problem Statement

The current tasks page (`/todos`) has several UX issues:
- Card grid layout is hard to scan (3 columns of cards vs clean list)
- Detail view navigates to a full page, losing list context
- Quick-add bar is cluttered with too many inline controls
- No keyboard shortcuts for rapid task capture or navigation
- Contextual task creation (linking to orders/POs/quotes) is buried behind multiple dialogs
- The page feels like a data entry form, not a productivity tool

## Design Goals

1. Fast scanning and triage (list, not cards)
2. Never lose list context when viewing task detail (side panel)
3. Create tasks from anywhere in the app in 2 keystrokes + title
4. Auto-link tasks to the entity you're currently viewing
5. Keyboard-first UX for power users
6. Match the existing Unity ERP dark theme and design system
7. Support low-resolution screens (compact spacing)

## Research Basis

Patterns drawn from Todoist, Linear, Things 3, TickTick, Notion, and Height.
Key takeaway: the dominant modern pattern is a compact list + side panel detail + command-palette-style quick create.

---

## Design

### 1. List View (replaces card grid)

**Layout:** Single-column list, full width, ~40px row height.

**Row contents:** Checkbox | Title (truncated) | Priority dot | Assignee avatar+name | Due date | Entity link icon

**Default grouping:** By due date sections:
- Overdue (red header)
- Today
- Upcoming (next 7 days)
- Later
- No due date

**Grouping options (dropdown):** None, Due date, Priority, Assignee, Status

**Sorting within groups:** Priority descending (urgent first), then created_at descending

**Scope filter:** Pill buttons - "Assigned to me" | "Created by me" | "Watching" | "All tasks"

**Search:** Single search input, debounced, searches title + description (existing behavior)

**Inline quick-add:** A text input row at the top of the list area. Type title, press Enter. Task created with defaults (assigned to current user, medium priority, no due date). No date/priority/assignee selects in the quick-add row -- set those in the side panel after creation.

**Status toggle:** Clicking the checkbox marks a task as done. The row gets strikethrough + muted opacity, then fades out after ~2 seconds (if not showing completed tasks).

**Overdue:** Due dates in the past shown in red text.

**Entity link indicator:** Small link icon at end of row. Tooltip on hover shows linked entity name (e.g., "ORD-0042 - Ukhuni Cabinets").

**Active/completed toggle:** Single button toggles between "Active" and "All" (includes done/archived).

**Empty state:** Centered message with subtle icon. "No tasks yet -- press T to create one."

### 2. Side Panel Detail (replaces full-page detail)

**Component:** Sheet (Radix/shadcn) sliding in from the right, ~480px wide.

**Trigger:** Click any task row in the list. The list narrows to accommodate the panel.

**Panel layout (top to bottom):**

1. **Header row:** Back arrow (closes panel) + overflow menu (archive, delete, copy link, open full page)

2. **Title:** Large editable text input (borderless, ~20px font). Click to edit, auto-saves on blur with 500ms debounce.

3. **Metadata chip row:** Horizontal flex row of inline-editable chips:
   - Status chip (click for dropdown: open/in_progress/blocked/done)
   - Priority chip with color dot (click for dropdown)
   - Assignee chip with avatar (click for dropdown)
   - Due date chip (click for calendar popover)
   - Entity link chip (shows linked entity label, click navigates, x to clear, "+ Link" button if none)

4. **Description:** Auto-growing textarea, full width, plain text. Generous min-height (~120px) for a spacious feel. Placeholder: "Add details..."

5. **Checklist:** Shown if items exist, with "Add item" input at bottom. Each item: checkbox + text + delete on hover. Drag handle for reordering (stretch).

6. **Attachments section:**
   - File list with icon, name, size, uploader, delete button
   - Drag-and-drop zone at bottom ("Drop files or click to upload")
   - Inline image thumbnails for image files
   - Screenshots can be pasted directly (Ctrl+V in the description or attachment zone)

7. **Comments section:**
   - Chronological list with avatar, name, relative time, body
   - Sticky comment input at the bottom of the panel
   - No collapsible -- always visible

8. **Activity log:** Hidden behind "Show activity" toggle link at the very bottom. Rarely needed.

**Auto-save:** All field changes auto-save with debounce. No "Save" button. A subtle "Saved" text fades in/out briefly after successful save.

**Watchers:** Moved to overflow menu -> "Manage watchers" (rarely used, doesn't need prominent placement).

**Acknowledge completion:** Shown as a banner at the top of the panel when applicable (task marked done by assignee, creator can acknowledge).

### 3. Contextual Quick-Create (new feature)

**Trigger:** Press `T` from any page in the app, OR click a task icon button in the navbar.

**UI:** Compact modal/popover (~400px wide), centered or anchored to navbar button:
- Auto-focused title input
- Row of optional chips: Assignee (defaults to current user), Priority (defaults to medium), Due date (defaults to none)
- Auto-detected entity link chip (if on an entity page)
- "Create" button + "Esc to cancel" hint

**Context auto-detection:**
The quick-create reads `window.location.pathname` and matches against known entity routes:
- `/orders/[id]` -> type: "order", fetches order label
- `/purchasing/purchase-orders/[id]` -> type: "supplier_order", fetches PO label
- `/quotes/[id]` -> type: "quote", fetches quote label
- `/customers/[id]` -> type: "customer", fetches customer name
- `/products/[id]` -> type: "product", fetches product name
- All other pages -> no auto-link

The entity label and path are stored in `context_type`, `context_id`, `context_path`, and `context_snapshot` (existing columns).

User can clear the auto-link with x if not wanted.

**Flow:** Press T -> type title -> press Enter -> task created, popover closes, toast confirms.

**Navbar indicator:** Small checkbox/task icon next to notification bell. Badge shows count of overdue tasks assigned to current user. Click opens the quick-create popover.

### 4. Keyboard Shortcuts

| Key | Context | Action |
|-----|---------|--------|
| `T` | Any page | Open quick-create |
| Up/Down | Task list | Navigate between rows |
| `Enter` | Task list (row focused) | Open side panel |
| `Space` | Task list (row focused) | Quick peek (tooltip-style preview) |
| `Esc` | Side panel open | Close panel |
| `Esc` | Quick-create open | Close quick-create |
| `X` | Task list (row focused) | Toggle complete |
| `E` | Task list (row focused) | Open panel + focus title |

Keyboard shortcuts are registered globally via a `useEffect` with `keydown` listener. They're suppressed when any input/textarea/select is focused (except Esc).

### 5. Visual Design

**Colors (matching existing dark theme):**
- Row hover: `bg-muted/30`
- Row separator: `border-b border-border/50` (subtle)
- Selected/active row: `bg-primary/10 border-l-2 border-primary` (teal accent)
- Priority dots: red (urgent), orange (high), blue (medium), gray (low)
- Status chips: teal bg (done), blue bg (in_progress), red bg (blocked), gray bg (open)
- Overdue dates: `text-red-500`
- Completed row: `opacity-50 line-through`

**Typography:**
- Row title: 14px, font-medium
- Row metadata: 12px, text-muted-foreground
- Panel title: 20px, font-semibold
- Panel description: 14px
- Comments: 14px body, 12px metadata

**Spacing:**
- Row height: 40px (py-2 px-3)
- Panel padding: p-5
- Section gaps in panel: space-y-5
- Chip gaps: gap-2

**Animations:**
- Panel slide-in: 200ms ease-out (Sheet default)
- Row completion fade-out: 300ms opacity transition + 2s delay
- Chip dropdown: 150ms fade-in (Popover default)
- Quick-create modal: 150ms zoom-in-95 (Dialog default)

### 6. Database Changes

**New column on `todo_items`:**
- `position` (integer, nullable) -- for future manual reordering. Default null means "sort by other criteria."

**No other schema changes needed.** The existing columns cover everything:
- `context_type`, `context_id`, `context_path`, `context_snapshot` for entity linking
- `todo_checklist_items` for checklists
- `todo_attachments` for files
- `todo_comments` for comments
- `todo_activity` for activity log
- `todo_watchers` for watchers

### 7. Route / File Changes

**Keep:** `/todos` route (list page), `/todos/[id]` route (full page, kept as fallback via "Open full page" in overflow menu)

**New components:**
- `components/features/todos/TaskList.tsx` -- the new list view (replaces TodoDashboard)
- `components/features/todos/TaskRow.tsx` -- individual list row
- `components/features/todos/TaskSidePanel.tsx` -- the Sheet-based detail panel (replaces TodoDetailDialog)
- `components/features/todos/TaskQuickCreate.tsx` -- the contextual creation popover
- `components/features/todos/TaskMetadataChips.tsx` -- reusable inline chip editor row
- `hooks/useTaskContext.ts` -- auto-detects entity context from current URL
- `hooks/useTaskKeyboard.ts` -- global keyboard shortcut handler

**Modified:**
- `components/layout/navbar.tsx` -- add task icon + badge + quick-create trigger
- `app/todos/page.tsx` -- swap TodoDashboard for TaskList

**Removed after rollout cleanup:**
- `TodoDashboard.tsx` -- replaced by TaskList
- `TodoCreateDialog.tsx` -- replaced by TaskQuickCreate
- `TodoDetailDialog.tsx` -- replaced by TaskSidePanel

### 8. Out of Scope

- Kanban board view
- Natural language date parsing
- Subtask nesting (checklists are sufficient)
- Drag-and-drop reordering (v1 uses sort-by-property)
- Global Cmd+K command palette (separate feature)
- Rich text / markdown in descriptions
- Notifications / reminders
- Mobile-specific layout (existing responsive works)
