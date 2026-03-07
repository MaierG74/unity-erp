# Job Card Completion UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a completion confirmation dialog with quantity inputs and a reopen button to the job card detail page.

**Architecture:** Two additions to `app/staff/job-cards/[id]/page.tsx`: (1) a `Dialog` component with editable item quantities that opens when "Mark Complete" is clicked, replacing the direct mutation call, and (2) a "Reopen" `AlertDialog` on completed cards that reverses completion state across `job_cards`, `job_card_items`, and `labor_plan_assignments`.

**Tech Stack:** React, shadcn/ui Dialog + AlertDialog, Supabase client, TanStack Query mutations, sonner toasts

---

### Task 1: Add Completion Confirmation Dialog

**Files:**
- Modify: `app/staff/job-cards/[id]/page.tsx:308-313` (replace `handleMarkComplete`), `:452-457` (wire dialog open state)

**Context:**
- The page already has all the data: `items` array with `JobCardItem[]`, each having `quantity`, `completed_quantity`, `piece_rate`, `products.name`, `jobs.name`
- The page already has `statusMutation` (lines 186-239) that handles completion
- The page already has `itemMutation` (lines 242-284) for updating individual items
- The factory floor's `CompleteJobDialog` is a reference but we need a simpler version — no time tracking, just quantities

**Step 1: Add dialog state and quantities state**

At the top of the component (after line 123), add:

```tsx
const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
const [completeQuantities, setCompleteQuantities] = useState<Record<number, number>>({});
```

**Step 2: Add the dialog open handler**

Replace `handleMarkComplete` (lines 308-313) with:

```tsx
const handleMarkComplete = () => {
  // Pre-fill quantities: use current completed_quantity if > 0, else full quantity
  const initial: Record<number, number> = {};
  for (const item of items) {
    initial[item.item_id] = item.completed_quantity > 0 ? item.completed_quantity : item.quantity;
  }
  setCompleteQuantities(initial);
  setCompleteDialogOpen(true);
};
```

**Step 3: Add the completion submit handler**

Below `handleMarkComplete`, add:

```tsx
const handleConfirmComplete = async () => {
  // Update all item quantities first
  const now = new Date().toISOString();
  const itemUpdates = items.map((item) => {
    const qty = completeQuantities[item.item_id] ?? item.quantity;
    const newStatus: ItemStatus = qty >= item.quantity ? 'completed' : qty > 0 ? 'in_progress' : 'pending';
    return supabase
      .from('job_card_items')
      .update({
        completed_quantity: qty,
        status: newStatus,
        completion_time: newStatus === 'completed' && !item.completion_time ? now : item.completion_time,
        start_time: qty > 0 && !item.start_time ? now : item.start_time,
      })
      .eq('item_id', item.item_id);
  });

  const results = await Promise.all(itemUpdates);
  const failed = results.find((r) => r.error);
  if (failed?.error) {
    toast.error(failed.error.message || 'Failed to update items');
    return;
  }

  // Now mark the card complete
  statusMutation.mutate(
    { newStatus: 'completed', completionDate: new Date().toISOString().split('T')[0] },
    { onSuccess: () => setCompleteDialogOpen(false) },
  );
};
```

**Step 4: Compute dialog earnings total**

Add a memo for the dialog:

```tsx
const dialogEarnings = useMemo(() => {
  return items.reduce((sum, item) => {
    const qty = completeQuantities[item.item_id] ?? item.quantity;
    return sum + qty * item.piece_rate;
  }, 0);
}, [items, completeQuantities]);
```

**Step 5: Add the Dialog component to JSX**

Add the import for `Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription` from `@/components/ui/dialog` at the top of the file.

Then, just before the closing `</TooltipProvider>` (before line 779), add the dialog JSX:

```tsx
<Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
  <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
    <DialogHeader>
      <DialogTitle>Complete Job Card #{jobCard.job_card_id}</DialogTitle>
      <DialogDescription>
        Review and confirm completed quantities for each item.
      </DialogDescription>
    </DialogHeader>
    <div className="space-y-4 py-2">
      {items.map((item) => (
        <div key={item.item_id} className="flex items-center gap-3 p-3 rounded-md border bg-card">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{item.jobs?.name ?? item.products?.name ?? 'Item'}</div>
            {item.products?.name && item.jobs?.name && (
              <div className="text-xs text-muted-foreground truncate">{item.products.name}</div>
            )}
            {item.piece_rate > 0 && (
              <div className="text-xs text-muted-foreground">
                R{item.piece_rate.toFixed(2)}/pc = R{((completeQuantities[item.item_id] ?? item.quantity) * item.piece_rate).toFixed(2)}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              max={item.quantity}
              value={completeQuantities[item.item_id] ?? item.quantity}
              onChange={(e) => setCompleteQuantities((prev) => ({
                ...prev,
                [item.item_id]: Math.min(item.quantity, Math.max(0, parseInt(e.target.value) || 0)),
              }))}
              className="w-20 text-center"
            />
            <span className="text-sm text-muted-foreground">/ {item.quantity}</span>
          </div>
        </div>
      ))}
      {dialogEarnings > 0 && (
        <div className="text-sm font-medium text-right">
          Total Earnings: R{dialogEarnings.toFixed(2)}
        </div>
      )}
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={() => setCompleteDialogOpen(false)} disabled={statusMutation.isPending}>
        Cancel
      </Button>
      <Button
        onClick={handleConfirmComplete}
        disabled={statusMutation.isPending}
        className="bg-emerald-600 hover:bg-emerald-700"
      >
        {statusMutation.isPending ? 'Completing...' : 'Complete Job Card'}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

**Step 6: Add Dialog imports**

Add to the existing imports at the top of the file:

```tsx
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
```

**Step 7: Verify**

Run: `npx tsc --noEmit 2>&1 | grep "job-cards"`
Expected: No new errors from this file.

Run: `npm run lint`
Expected: Clean.

Test manually: Navigate to an in-progress job card → click "Mark Complete" → dialog should appear with item quantities pre-filled → adjust quantities → click "Complete Job Card" → card becomes completed with correct quantities.

**Step 8: Commit**

```bash
git add app/staff/job-cards/[id]/page.tsx
git commit -m "feat(job-cards): add completion confirmation dialog with quantity inputs"
```

---

### Task 2: Add Reopen Button

**Files:**
- Modify: `app/staff/job-cards/[id]/page.tsx:436-441` (add reopen button next to badge), `:766-777` (modify completed card footer)

**Context:**
- The page already has `AlertDialog` imports and usage (lines 28-36, 458-478 for cancel)
- `statusMutation` already handles status transitions but only sets `in_progress` side-effects for items in `pending` state (line 208). We need a new `reopenMutation` that reverses completion state more explicitly.
- The `Undo2` icon is already used in the labor planning un-issue flow — good precedent.

**Step 1: Add the reopen mutation**

After `itemMutation` (after line 284), add:

```tsx
const reopenMutation = useMutation({
  mutationFn: async () => {
    const now = new Date().toISOString();

    // 1. Reopen the job card
    const { error: cardErr } = await supabase
      .from('job_cards')
      .update({ status: 'in_progress', completion_date: null })
      .eq('job_card_id', jobCardId);
    if (cardErr) throw cardErr;

    // 2. Revert completed items to in_progress (keep their completed_quantity)
    const { error: itemsErr } = await supabase
      .from('job_card_items')
      .update({ status: 'in_progress', completion_time: null })
      .eq('job_card_id', jobCardId)
      .eq('status', 'completed');
    if (itemsErr) throw itemsErr;

    // 3. Revert linked assignments
    const jobIds = items.map((i) => i.job_id).filter(Boolean);
    if (jobIds.length > 0 && jobCard?.staff_id) {
      await supabase
        .from('labor_plan_assignments')
        .update({ job_status: 'in_progress', completed_at: null })
        .in('job_id', jobIds)
        .eq('staff_id', jobCard.staff_id)
        .eq('job_status', 'completed');
    }
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['jobCard', jobCardId] });
    queryClient.invalidateQueries({ queryKey: ['jobCardItems', jobCardId] });
    queryClient.invalidateQueries({ queryKey: ['jobCards'] });
    toast.success('Job card reopened');
  },
  onError: (error: any) => {
    toast.error(error.message || 'Failed to reopen job card');
  },
});
```

**Step 2: Add `Undo2` to the icon imports**

Update the lucide-react import (line 43) to include `Undo2`:

```tsx
import {
  ArrowLeft,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  Play,
  Square,
  Printer,
  Download,
  FileText,
  ExternalLink,
  Undo2,
} from 'lucide-react';
```

**Step 3: Add Reopen button in the header badge area**

Replace the badge area (lines 436-441):

```tsx
<div className="flex items-center gap-2">
  <Badge variant={status.variant} className={`gap-1 ${status.className || ''}`}>
    {status.icon}
    {status.label}
  </Badge>
  {jobCard.status === 'completed' && (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={reopenMutation.isPending}>
          <Undo2 className="h-3.5 w-3.5 mr-1.5" />
          Reopen
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reopen Job Card?</AlertDialogTitle>
          <AlertDialogDescription>
            This will return the job card to In Progress status. Completed quantities will be preserved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep Completed</AlertDialogCancel>
          <AlertDialogAction onClick={() => reopenMutation.mutate()}>
            Reopen Job Card
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )}
</div>
```

**Step 4: Verify**

Run: `npx tsc --noEmit 2>&1 | grep "job-cards"`
Expected: No new errors.

Test manually: Complete a job card → see Reopen button next to Completed badge → click Reopen → confirm → card returns to In Progress → items retain their quantities → can mark complete again.

**Step 5: Commit**

```bash
git add app/staff/job-cards/[id]/page.tsx
git commit -m "feat(job-cards): add reopen button to reverse mistaken completions"
```
