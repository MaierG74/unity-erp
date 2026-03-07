# Tasks Module Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the card-grid tasks page with a Linear-style list view + side panel detail + contextual quick-create from anywhere in the app.

**Architecture:** New components replace (not modify) the old TodoDashboard/TodoDetailDialog. The existing API routes, hooks (`useTodosApi.ts`), and client lib (`lib/client/todos.ts`) are reused as-is. A `useTaskContext` hook auto-detects entity context from the current URL. A `useTaskKeyboard` hook registers global shortcuts. The Sheet component provides the side panel.

**Tech Stack:** Next.js 14, React, shadcn/ui (Sheet, Popover, Badge, Checkbox, Dialog), Tailwind CSS, React Query, Supabase, Lucide icons, date-fns.

**Design doc:** `docs/plans/2026-03-05-tasks-redesign-design.md`

---

## Task 1: useTaskContext Hook — Auto-Detect Entity from URL

**Files:**
- Create: `hooks/useTaskContext.ts`

**What it does:** Reads `window.location.pathname`, matches against known entity routes, fetches the entity label from Supabase, returns `{ contextType, contextId, contextPath, contextLabel } | null`.

**Step 1: Create the hook**

```typescript
// hooks/useTaskContext.ts
'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export interface TaskContext {
  contextType: string;
  contextId: string;
  contextPath: string;
  contextLabel: string;
}

// Route patterns that map to entity types
const ROUTE_PATTERNS: { pattern: RegExp; type: string; table: string; labelCol: string; prefix: string }[] = [
  { pattern: /^\/orders\/([0-9a-f-]{36})/, type: 'order', table: 'orders', labelCol: 'order_number', prefix: 'Order' },
  { pattern: /^\/purchasing\/purchase-orders\/([0-9a-f-]{36})/, type: 'supplier_order', table: 'supplier_orders', labelCol: 'po_number', prefix: 'PO' },
  { pattern: /^\/quotes\/([0-9a-f-]{36})/, type: 'quote', table: 'quotes', labelCol: 'quote_number', prefix: 'Quote' },
  { pattern: /^\/customers\/([0-9a-f-]{36})/, type: 'customer', table: 'customers', labelCol: 'name', prefix: '' },
  { pattern: /^\/products\/([0-9a-f-]{36})/, type: 'product', table: 'products', labelCol: 'name', prefix: '' },
];

export function useTaskContext(): TaskContext | null {
  const pathname = usePathname();
  const [context, setContext] = useState<TaskContext | null>(null);

  useEffect(() => {
    if (!pathname) {
      setContext(null);
      return;
    }

    let cancelled = false;

    const match = ROUTE_PATTERNS.find(r => r.pattern.test(pathname));
    if (!match) {
      setContext(null);
      return;
    }

    const id = pathname.match(match.pattern)?.[1];
    if (!id) {
      setContext(null);
      return;
    }

    (async () => {
      try {
        const { data } = await supabase
          .from(match.table)
          .select(match.labelCol)
          .eq('id', id)
          .maybeSingle();

        if (cancelled) return;

        const rawLabel = data?.[match.labelCol] ?? id;
        const label = match.prefix ? `${match.prefix} ${rawLabel}` : String(rawLabel);

        setContext({
          contextType: match.type,
          contextId: id,
          contextPath: pathname,
          contextLabel: label,
        });
      } catch {
        if (!cancelled) setContext(null);
      }
    })();

    return () => { cancelled = true; };
  }, [pathname]);

  return context;
}
```

**Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: No errors related to useTaskContext.

**Step 3: Commit**

```bash
git add hooks/useTaskContext.ts
git commit -m "feat(tasks): add useTaskContext hook for URL-based entity detection"
```

---

## Task 2: useTaskKeyboard Hook — Global Keyboard Shortcuts

**Files:**
- Create: `hooks/useTaskKeyboard.ts`

**What it does:** Registers global `keydown` listeners for task shortcuts. Suppresses when an input/textarea/select is focused (except Esc). Calls provided callbacks for each action.

**Step 1: Create the hook**

```typescript
// hooks/useTaskKeyboard.ts
'use client';

import { useEffect } from 'react';

interface TaskKeyboardActions {
  onNewTask?: () => void;           // T
  onNavigateUp?: () => void;        // ArrowUp
  onNavigateDown?: () => void;      // ArrowDown
  onOpenPanel?: () => void;         // Enter
  onClosePanel?: () => void;        // Escape
  onToggleComplete?: () => void;    // X
  onEditTask?: () => void;          // E
}

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function useTaskKeyboard(actions: TaskKeyboardActions, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      // Esc always works (closes panels/modals)
      if (e.key === 'Escape') {
        actions.onClosePanel?.();
        return;
      }

      // All other shortcuts suppressed when typing
      if (isInputFocused()) return;

      // Don't intercept if modifier keys are held (Cmd+T, Ctrl+X, etc.)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key.toLowerCase()) {
        case 't':
          e.preventDefault();
          actions.onNewTask?.();
          break;
        case 'arrowup':
          e.preventDefault();
          actions.onNavigateUp?.();
          break;
        case 'arrowdown':
          e.preventDefault();
          actions.onNavigateDown?.();
          break;
        case 'enter':
          e.preventDefault();
          actions.onOpenPanel?.();
          break;
        case 'x':
          e.preventDefault();
          actions.onToggleComplete?.();
          break;
        case 'e':
          e.preventDefault();
          actions.onEditTask?.();
          break;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [actions, enabled]);
}
```

**Step 2: Verify**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add hooks/useTaskKeyboard.ts
git commit -m "feat(tasks): add useTaskKeyboard hook for global shortcuts"
```

---

## Task 3: TaskRow Component — List Row

**Files:**
- Create: `components/features/todos/TaskRow.tsx`

**Dependencies:** Uses existing types from `lib/db/todos.ts` (`TodoItem`, `TodoPriority`), existing `useUpdateTodo` from `hooks/useTodosApi.ts`.

**Key behaviors:**
- 40px row height, single line
- Checkbox toggles done status
- Click row (not checkbox) calls `onSelect(todoId)`
- Active row gets teal left border
- Completed rows get strikethrough + opacity
- Priority shown as colored dot (not badge)
- Assignee as small avatar + name
- Due date with red text if overdue
- Entity link icon if `contextPath` exists (tooltip shows label)

**Step 1: Create TaskRow**

```tsx
// components/features/todos/TaskRow.tsx
'use client';

import { useState } from 'react';
import { isBefore, parseISO, format, isToday } from 'date-fns';
import { Link2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useUpdateTodo } from '@/hooks/useTodosApi';
import type { TodoItem } from '@/lib/db/todos';

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-blue-500',
  low: 'bg-gray-400',
};

function initials(name?: string | null): string {
  if (!name) return '?';
  return name.split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('');
}

interface TaskRowProps {
  todo: TodoItem;
  isActive: boolean;
  isFocused: boolean;
  onSelect: (id: string) => void;
}

export function TaskRow({ todo, isActive, isFocused, onSelect }: TaskRowProps) {
  const updateMutation = useUpdateTodo(todo.id);
  const isDone = todo.status === 'done' || todo.status === 'archived';
  const [fadingOut, setFadingOut] = useState(false);

  const overdue = (() => {
    if (!todo.dueAt || isDone) return false;
    try { return isBefore(parseISO(todo.dueAt), new Date()) && !isToday(parseISO(todo.dueAt)); }
    catch { return false; }
  })();

  const toggleComplete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const newStatus = isDone ? 'open' : 'done';
    if (newStatus === 'done') {
      setFadingOut(true);
    }
    await updateMutation.mutateAsync({ status: newStatus } as any);
  };

  const dueLabel = todo.dueAt
    ? format(parseISO(todo.dueAt), 'MMM d')
    : null;

  const contextLabel = todo.contextSnapshot
    ? (typeof todo.contextSnapshot === 'object' && 'label' in todo.contextSnapshot
        ? String(todo.contextSnapshot.label)
        : todo.contextPath)
    : todo.contextPath;

  return (
    <div
      role="row"
      tabIndex={0}
      onClick={() => onSelect(todo.id)}
      className={cn(
        'flex items-center gap-3 px-3 py-2 border-b border-border/40 cursor-pointer transition-all select-none',
        'hover:bg-muted/30',
        isActive && 'bg-primary/10 border-l-2 border-l-primary',
        isFocused && !isActive && 'bg-muted/20',
        isDone && 'opacity-50',
        fadingOut && 'opacity-30 transition-opacity duration-300',
      )}
    >
      {/* Checkbox */}
      <div onClick={toggleComplete} className="flex-shrink-0">
        <Checkbox checked={isDone} className="h-4 w-4" />
      </div>

      {/* Title */}
      <span className={cn(
        'flex-1 text-sm font-medium truncate min-w-0',
        isDone && 'line-through text-muted-foreground',
      )}>
        {todo.title}
      </span>

      {/* Priority dot */}
      <span
        className={cn('h-2 w-2 rounded-full flex-shrink-0', PRIORITY_COLORS[todo.priority] ?? PRIORITY_COLORS.medium)}
        title={todo.priority}
      />

      {/* Assignee */}
      {todo.assignee && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Avatar className="h-5 w-5">
            <AvatarFallback className="text-[9px] bg-muted">
              {initials(todo.assignee.username)}
            </AvatarFallback>
          </Avatar>
          <span className="text-xs text-muted-foreground truncate max-w-[80px] hidden sm:inline">
            {todo.assignee.username}
          </span>
        </div>
      )}

      {/* Due date */}
      {dueLabel && (
        <span className={cn(
          'text-xs flex-shrink-0 tabular-nums',
          overdue ? 'text-red-500 font-medium' : 'text-muted-foreground',
        )}>
          {dueLabel}
        </span>
      )}

      {/* Entity link icon */}
      {todo.contextPath && (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            </TooltipTrigger>
            <TooltipContent side="left">
              <p className="text-xs">{contextLabel}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
```

**Step 2: Verify**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add components/features/todos/TaskRow.tsx
git commit -m "feat(tasks): add TaskRow compact list row component"
```

---

## Task 4: TaskList Component — Main List View

**Files:**
- Create: `components/features/todos/TaskList.tsx`
- Modify: `app/todos/page.tsx` (swap TodoDashboard for TaskList)

**Dependencies:** TaskRow (Task 3), useTodoList/useCreateTodo from `hooks/useTodosApi.ts`, useProfiles from `hooks/useProfiles.ts`, useTaskKeyboard (Task 2).

**Key behaviors:**
- Scope filter pill buttons (Assigned to me / Created by me / Watching / All)
- Search input
- Group-by dropdown (Due date / Priority / Assignee / Status / None)
- Sort dropdown (Priority / Due date / Status)
- Active/All toggle
- Inline quick-add at top of list (just a text input, Enter to create)
- Grouping logic splits todos into collapsible sections with headers + counts
- Keyboard navigation (up/down moves focus, enter opens panel)
- Manages `selectedTodoId` state for the side panel
- Renders TaskSidePanel alongside the list

**Step 1: Create TaskList with grouping logic**

The component should be structured as:

```
<div className="flex h-[calc(100vh-4rem)]">
  {/* Left: list pane */}
  <div className={cn("flex-1 min-w-0 flex flex-col", selectedId && "max-w-[calc(100%-480px)]")}>
    {/* Header: title + scope pills */}
    {/* Toolbar: search, group-by, sort, active toggle */}
    {/* Inline quick-add input */}
    {/* Scrollable grouped list */}
  </div>

  {/* Right: side panel (conditional) */}
  {selectedId && <TaskSidePanel todoId={selectedId} onClose={() => setSelectedId(null)} />}
</div>
```

**Grouping logic** — a pure function `groupTodos(todos, groupBy)` that returns `{ label: string; todos: TodoItem[] }[]`:

- **Due date groups:** Overdue, Today, This week, Later, No due date
- **Priority groups:** Urgent, High, Medium, Low
- **Assignee groups:** Grouped by assignee name, then "Unassigned"
- **Status groups:** Open, In Progress, Blocked, Done
- **None:** Single flat group

Each group header is a collapsible `<div>` showing label + count. Clicking toggles collapse.

**Step 2: Wire the page**

Replace `app/todos/page.tsx`:

```tsx
'use client';

import { TaskList } from '@/components/features/todos/TaskList';

export default function TodosPage() {
  return <TaskList />;
}
```

**Step 3: Verify visually**

Open `http://localhost:3000/todos` in Chrome MCP, confirm the list renders with existing tasks.

**Step 4: Commit**

```bash
git add components/features/todos/TaskList.tsx app/todos/page.tsx
git commit -m "feat(tasks): add TaskList with grouping, search, filters, inline quick-add"
```

---

## Task 5: TaskMetadataChips — Inline Editable Chip Row

**Files:**
- Create: `components/features/todos/TaskMetadataChips.tsx`

**What it does:** Renders a horizontal flex row of clickable chips for Status, Priority, Assignee, Due Date, and Entity Link. Each chip opens a small Popover on click for editing. Changes call the `onUpdate` callback.

**Key behaviors:**
- Status chip: colored badge, click opens dropdown with status options
- Priority chip: dot + label, click opens dropdown
- Assignee chip: avatar + name, click opens profile list popover
- Due date chip: date text, click opens Calendar popover
- Entity link chip: link icon + label, click navigates to entity page. `x` button clears. If no link, shows `+ Link` button that opens TodoEntityLinkPicker.

All chips use the same visual pattern: `rounded-full px-2.5 py-1 text-xs border cursor-pointer hover:bg-muted/50 transition-colors`.

**Step 1: Create component**

The component signature:
```tsx
interface TaskMetadataChipsProps {
  todo: TodoItem;
  profiles: ProfileSummary[];
  onUpdate: (payload: UpdateTodoPayload) => void;
  onLinkClick?: () => void;
  onClearLink?: () => void;
  onOpenLinkPicker?: () => void;
}
```

Each chip is a Popover with `align="start"`. The calendar chip reuses the existing Calendar component from shadcn.

**Step 2: Verify**

Run: `npx tsc --noEmit`

**Step 3: Commit**

```bash
git add components/features/todos/TaskMetadataChips.tsx
git commit -m "feat(tasks): add TaskMetadataChips inline editable chip row"
```

---

## Task 6: TaskSidePanel — Sheet Detail Panel

**Files:**
- Create: `components/features/todos/TaskSidePanel.tsx`

**Dependencies:** TaskMetadataChips (Task 5), useTodoDetail/useUpdateTodo/useAddTodoComment/useUploadTodoAttachment/useDeleteTodoAttachment/useAcknowledgeTodo from `hooks/useTodosApi.ts`, TodoEntityLinkPicker (existing).

**Important:** This is NOT a Sheet (Radix dialog) because we want the list to stay interactive alongside it. Instead, it's a **fixed-width div** that slides in from the right using CSS transition. The Sheet component's overlay would block interaction with the list.

**Layout:**
```
<div className="w-[480px] border-l bg-background flex flex-col h-full overflow-hidden">
  {/* Header: close button + overflow menu */}
  {/* Scrollable content */}
  <div className="flex-1 overflow-y-auto p-5 space-y-5">
    {/* Title: borderless input, text-xl, auto-saves on blur */}
    {/* Metadata chips row */}
    {/* Description: auto-growing textarea */}
    {/* Checklist (if items exist) */}
    {/* Attachments */}
    {/* Comments list */}
  </div>
  {/* Sticky comment input at bottom */}
  <div className="border-t p-3">
    {/* Textarea + submit button */}
  </div>
</div>
```

**Key behaviors:**
- Title auto-saves on blur with 500ms debounce (using `useUpdateTodo`)
- Description auto-saves on blur with 500ms debounce
- Metadata chips use TaskMetadataChips, `onUpdate` calls `useUpdateTodo`
- Checklist items: toggle via existing `updateChecklistItem`, add via `createChecklistItem`, delete via `deleteChecklistItem` (all from `lib/client/todos.ts`)
- Attachments: drag-and-drop zone uses `useUploadTodoAttachment`, file list with download/delete
- Comments: list from `useTodoDetail`, input at bottom uses `useAddTodoComment`
- Overflow menu (DropdownMenu): Archive, Delete, Manage watchers, Open full page (`router.push(/todos/${id})`), Copy link
- Auto-save indicator: small "Saved" text that fades in/out after successful mutation
- Acknowledge banner: shown when applicable (creator can acknowledge done task)

**Step 1: Create TaskSidePanel**

Build the component following the layout above. Reuse patterns from the existing `TodoDetailDialog.tsx` (the detail page at `app/todos/[id]/page.tsx`) for comments, attachments, checklist logic — but restructured into the panel layout.

**Step 2: Integrate with TaskList**

In `TaskList.tsx`, render TaskSidePanel conditionally:

```tsx
{selectedId && (
  <TaskSidePanel
    todoId={selectedId}
    onClose={() => setSelectedId(null)}
  />
)}
```

**Step 3: Verify visually**

Open `http://localhost:3000/todos`, click a task, confirm the side panel slides in with correct data.

**Step 4: Commit**

```bash
git add components/features/todos/TaskSidePanel.tsx
git commit -m "feat(tasks): add TaskSidePanel with auto-save, comments, attachments"
```

---

## Task 7: TaskQuickCreate — Contextual Creation Popover

**Files:**
- Create: `components/features/todos/TaskQuickCreate.tsx`

**Dependencies:** useTaskContext (Task 1), useCreateTodo from `hooks/useTodosApi.ts`, useProfiles from `hooks/useProfiles.ts`.

**UI:** A Dialog (not Popover — needs to work from anywhere, including navbar). Compact, ~400px max-width.

```
<Dialog>
  <DialogContent className="max-w-[420px] p-4">
    {/* Title input, auto-focused */}
    {/* Chip row: assignee, priority, due date */}
    {/* Context chip (auto-detected, clearable) */}
    {/* Create button + Esc hint */}
  </DialogContent>
</Dialog>
```

**Key behaviors:**
- `open` / `onOpenChange` controlled externally (navbar or keyboard shortcut)
- Title input auto-focused on open
- Assignee defaults to current user, priority to medium, no due date
- Context auto-populated from `useTaskContext()` if available
- Context chip shows entity label, `x` to clear
- Enter in title input submits
- On success: close dialog, toast "Task created", invalidate todo list query
- Minimal — no description, no watchers, no checklist in quick-create

**Step 1: Create TaskQuickCreate**

```tsx
interface TaskQuickCreateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
```

**Step 2: Verify**

Open any entity page (e.g., `/orders/[id]`), trigger the dialog, confirm context is auto-detected.

**Step 3: Commit**

```bash
git add components/features/todos/TaskQuickCreate.tsx
git commit -m "feat(tasks): add TaskQuickCreate with context auto-detection"
```

---

## Task 8: Navbar Integration — Task Button + Global Shortcut

**Files:**
- Modify: `components/layout/navbar.tsx`

**What to add:**
1. A `ListTodo` (or `CheckSquare`) icon button next to the EmailIssuesIndicator
2. Badge on the icon showing count of overdue tasks assigned to current user
3. Clicking the icon opens TaskQuickCreate
4. A `useTaskKeyboard` call at the layout level for the `T` shortcut

**Implementation approach:**

Add state `const [quickCreateOpen, setQuickCreateOpen] = useState(false)` in Navbar.

Add a small React Query hook to fetch overdue count:
```tsx
const { data: overdueCount } = useQuery({
  queryKey: ['todos', 'overdue-count'],
  queryFn: async () => {
    const res = await fetch('/api/todos?scope=assigned&status=open&includeCompleted=false');
    const json = await res.json();
    const todos = json?.todos ?? [];
    return todos.filter((t: any) => t.due_at && isBefore(parseISO(t.due_at), new Date())).length;
  },
  staleTime: 60_000,
  enabled: !!user,
});
```

Actually, simpler: just use `useTodoList` with scope=assigned and count overdue client-side. But that's too heavy for the navbar. Better: add the icon + badge, fetch count with a lightweight query. The overdue count can use the existing `useTodoList` with a custom filter — but only if the user is on a page. For now, just use the icon without the badge (add badge as a follow-up if needed — YAGNI).

**Simplified approach:** Just add the icon button + TaskQuickCreate dialog. The global `T` shortcut is registered here since Navbar renders on every page.

```tsx
// In Navbar, after EmailIssuesIndicator:
<TaskQuickCreateTrigger />
```

Where `TaskQuickCreateTrigger` is a small wrapper component that:
1. Renders the icon button
2. Manages open state
3. Registers the `T` keyboard shortcut via useTaskKeyboard
4. Renders TaskQuickCreate dialog

**Step 1: Create the trigger wrapper**

Add it inline in navbar or as a small extracted component. Import TaskQuickCreate and useTaskKeyboard.

**Step 2: Verify**

Navigate to any page, press `T`, confirm the quick-create dialog opens. Click the icon, confirm it opens. Create a task from an entity page, confirm context is linked.

**Step 3: Commit**

```bash
git add components/layout/navbar.tsx
git commit -m "feat(tasks): add task quick-create button and T shortcut to navbar"
```

---

## Task 9: Polish & Visual QA

**Files:** All new components from Tasks 3-8

**Step 1: TypeScript check**

Run: `npx tsc --noEmit`
Fix any type errors.

**Step 2: Lint**

Run: `npm run lint`
Fix any lint warnings.

**Step 3: Visual QA via Chrome MCP**

Test the following flows:

1. **List view:** Navigate to `/todos`. Confirm tasks render as a list (not cards). Confirm grouping by due date works. Confirm scope filter pills work. Confirm search works.

2. **Inline quick-add:** Type a task title in the top input, press Enter. Confirm task appears in the list.

3. **Side panel:** Click a task row. Confirm the panel slides in from the right. Confirm title is editable. Confirm metadata chips are clickable and update correctly. Confirm description auto-saves. Confirm comments work. Confirm attachments work. Press Esc, confirm panel closes.

4. **Quick-create from entity page:** Navigate to an order page. Press `T`. Confirm the dialog opens with the order auto-linked. Type a title, press Enter. Confirm task is created with the link.

5. **Quick-create from tasks page:** On `/todos`, press `T`. Confirm the dialog opens with no auto-link.

6. **Keyboard navigation:** On `/todos`, press arrow keys to navigate rows. Press Enter to open panel. Press Esc to close. Press X to toggle complete.

7. **Dark theme:** Confirm all new components look correct in dark mode (default theme).

8. **Low-resolution:** Resize browser to ~1280x720, confirm nothing overflows or breaks.

**Step 4: Screenshot evidence**

Take a screenshot of the final list view and side panel via Chrome MCP as proof.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat(tasks): polish and visual QA fixes"
```

---

## Summary: File Map

| File | Action | Task |
|------|--------|------|
| `hooks/useTaskContext.ts` | Create | 1 |
| `hooks/useTaskKeyboard.ts` | Create | 2 |
| `components/features/todos/TaskRow.tsx` | Create | 3 |
| `components/features/todos/TaskList.tsx` | Create | 4 |
| `app/todos/page.tsx` | Modify | 4 |
| `components/features/todos/TaskMetadataChips.tsx` | Create | 5 |
| `components/features/todos/TaskSidePanel.tsx` | Create | 6 |
| `components/features/todos/TaskQuickCreate.tsx` | Create | 7 |
| `components/layout/navbar.tsx` | Modify | 8 |

**Existing files reused as-is (no changes):**
- `hooks/useTodosApi.ts` — all React Query hooks
- `lib/client/todos.ts` — all API client functions
- `lib/db/todos.ts` — types and server-side queries
- `app/api/todos/**` — all API routes
- `components/features/todos/TodoEntityLinkPicker.tsx` — reused in side panel
- `components/ui/sheet.tsx` — available but not used (using inline panel instead)

**Deprecated (kept, no longer imported from page):**
- `components/features/todos/TodoDashboard.tsx`
- `components/features/todos/TodoCreateDialog.tsx`
- `components/features/todos/TodoDetailDialog.tsx`
