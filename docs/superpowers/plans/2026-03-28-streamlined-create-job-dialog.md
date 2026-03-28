# Streamlined Create Job Dialog — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the Create Job modal to include all commonly-needed fields (estimated time, piecework rate) and add a "Create & Add Another" button for rapid bulk job creation.

**Architecture:** Single file modification to `create-job-modal.tsx` — widen the dialog, add new form fields in a responsive two-column grid, extend the mutation to optionally insert a piecework rate, and add a second submit button that resets the form without closing. One line change in the parent `jobs-rates-table.tsx` to enable the bulk-create button.

**Tech Stack:** React, React Hook Form + Zod, TanStack Query, Supabase JS client, shadcn Dialog/Form/Select/Input, Tailwind CSS v4

**Spec:** `docs/superpowers/specs/2026-03-24-streamlined-create-job-dialog-design.md`

---

### Task 1: Expand the Zod schema and form types

**Files:**
- Modify: `components/features/labor/create-job-modal.tsx:52-58`

- [ ] **Step 1: Update the Zod schema to include new fields**

Replace the existing `jobSchema` and `JobFormValues` type with:

```typescript
const jobSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  description: z.string().optional(),
  category_id: z.string().min(1, 'Category is required'),
  estimated_time: z
    .string()
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : parseFloat(v)))
    .refine((v) => v === null || v > 0, { message: 'Must be greater than 0' }),
  time_unit: z.string().optional(),
  piecework_rate: z
    .string()
    .optional()
    .transform((v) => (v === '' || v === undefined ? null : parseFloat(v)))
    .refine((v) => v === null || v > 0, { message: 'Must be greater than 0' }),
});

type JobFormValues = z.input<typeof jobSchema>;
type JobParsedValues = z.output<typeof jobSchema>;
```

Note: `estimated_time` and `piecework_rate` are strings in the form inputs but get transformed to `number | null` by Zod's `.transform()`. Using `z.input` for form field types and `z.output` for the mutation. This enforces the spec's "> 0 when present" rule at the schema level. Using `.trim()` on name per review finding.

- [ ] **Step 2: Update the form defaultValues**

In the `useForm` call (line 156), update `defaultValues`:

```typescript
const form = useForm<JobFormValues>({
  resolver: zodResolver(jobSchema),
  defaultValues: {
    name: '',
    description: '',
    category_id: '',
    estimated_time: '',
    time_unit: 'minutes',
    piecework_rate: '',
  },
});
```

Default `time_unit` to `'minutes'` (most common unit for this business).

- [ ] **Step 3: Update the reset in the close effect**

In the `useEffect` that resets on close (line 171), update the reset call:

```typescript
useEffect(() => {
  if (!isOpen) {
    form.reset({
      name: '',
      description: '',
      category_id: '',
      estimated_time: '',
      time_unit: 'minutes',
      piecework_rate: '',
    });
    setSelectedParentId('');
    setSelectedSubId('');
  }
}, [isOpen, form]);
```

- [ ] **Step 4: Verify the app compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors from this file (existing unrelated errors may appear).

- [ ] **Step 5: Commit**

```bash
git add components/features/labor/create-job-modal.tsx
git commit -m "feat(labor): expand create job schema with time and rate fields"
```

---

### Task 2: Extend the mutation to insert job with time fields + optional piecework rate

**Files:**
- Modify: `components/features/labor/create-job-modal.tsx:60-65, 179-212`

- [ ] **Step 1: Add `showAddAnother` prop and update the interface**

Update `CreatedJob` to include the new fields, and add the `showAddAnother` prop:

```typescript
interface CreatedJob {
  job_id: number;
  name: string;
  description: string | null;
  category_id: number;
  estimated_minutes: number | null;
  time_unit: string | null;
}

interface CreateJobModalProps {
  isOpen: boolean;
  onClose: () => void;
  onJobCreated: (job: CreatedJob) => void;
  initialCategoryId?: number;
  showAddAnother?: boolean;
}
```

Destructure `showAddAnother` in the component params (default `false`):

```typescript
export function CreateJobModal({
  isOpen,
  onClose,
  onJobCreated,
  initialCategoryId,
  showAddAnother = false,
}: CreateJobModalProps) {
```

- [ ] **Step 2: Add a ref for the name input**

At the top of the component, after the existing state declarations:

```typescript
import { useState, useMemo, useEffect, useRef } from 'react';

// ... inside component:
const nameInputRef = useRef<HTMLInputElement>(null);
```

No `submitMode` state — mode is passed through mutation variables to avoid state/timing issues.

- [ ] **Step 3: Replace the mutation with the two-step insert**

Replace the entire `addJob` mutation (lines 179-212):

```typescript
const addJob = useMutation({
  mutationFn: async ({
    values,
    mode,
  }: {
    values: JobParsedValues;
    mode: 'close' | 'another';
  }) => {
    const timeUnit = values.estimated_time !== null ? (values.time_unit || 'minutes') : null;

    // Step 1: Insert the job
    const { data, error } = await supabase
      .from('jobs')
      .insert({
        name: values.name,
        description: values.description || null,
        category_id: parseInt(values.category_id),
        estimated_minutes: values.estimated_time,
        time_unit: timeUnit,
      })
      .select();

    if (error) throw error;
    const job = data[0] as CreatedJob;

    // Step 2: Insert piecework rate if provided
    // effective_date omitted — DB default is CURRENT_DATE (server-side, timezone-safe)
    let rateError: Error | null = null;
    if (values.piecework_rate !== null) {
      const { error: prError } = await supabase
        .from('piece_work_rates')
        .insert({
          job_id: job.job_id,
          product_id: null,
          rate: values.piecework_rate,
        });

      if (prError) {
        rateError = new Error(prError.message);
      }
    }

    return { job, rateError, mode };
  },
  onSuccess: ({ job, rateError, mode }) => {
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
    queryClient.invalidateQueries({ queryKey: ['piece-rates'] });
    queryClient.invalidateQueries({ queryKey: ['all-piece-rates-current'] });

    if (rateError) {
      toast({
        title: 'Job created',
        description: 'Job created, but piecework rate failed — you can add it later.',
        variant: 'destructive',
      });
    } else {
      toast({ title: 'Job created' });
    }

    if (mode === 'another') {
      // Reset form but preserve category, subcategory, time unit
      const currentTimeUnit = form.getValues('time_unit');
      form.reset({
        name: '',
        description: '',
        category_id: effectiveCategoryId,
        estimated_time: '',
        time_unit: currentTimeUnit,
        piecework_rate: '',
      });
      // Re-focus name input
      setTimeout(() => nameInputRef.current?.focus(), 50);
    } else {
      onJobCreated(job);
      onClose();
    }
  },
  onError: (error) => {
    toast({
      title: 'Error',
      description: 'Failed to create job',
      variant: 'destructive',
    });
    console.error('Error adding job:', error);
  },
});
```

Key changes from earlier draft:
- Mode is passed through mutation variables (`{ values, mode }`) instead of component state — eliminates state/timing race condition.
- `effective_date` is omitted from the piecework rate insert — the DB column defaults to `CURRENT_DATE` server-side, which is timezone-safe. No more UTC midnight bug.
- Piecework rate `> 0` check is now handled by Zod transform — the mutation just checks `!== null`.
- Toast wording matches the approved spec copy verbatim.

- [ ] **Step 4: Update the submit handler to accept a mode**

Replace the `onSubmit` function:

```typescript
const handleSubmit = (mode: 'close' | 'another') => {
  form.handleSubmit((values) => addJob.mutate({ values: values as unknown as JobParsedValues, mode }))();
};
```

The cast is needed because `form.handleSubmit` uses the input type, but `mutate` expects the output type (after Zod transforms). The resolver guarantees the transform has run by this point.

- [ ] **Step 5: Verify the app compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors from this file.

- [ ] **Step 6: Commit**

```bash
git add components/features/labor/create-job-modal.tsx
git commit -m "feat(labor): extend create job mutation with time fields and piecework rate"
```

---

### Task 3: Build the two-column responsive layout with new fields

**Files:**
- Modify: `components/features/labor/create-job-modal.tsx:225-347` (the return/JSX block)

- [ ] **Step 1: Widen the dialog and restructure to two-column grid**

Replace the entire return block (from `return (` to the closing `);`) with the new layout. The key changes:
- Dialog width: `sm:max-w-2xl`
- Two-column grid: `grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3`
- Description as full-width row below the grid
- New fields: Estimated Time + Unit, Piecework Rate
- Three footer buttons: Cancel, Create Job, Create & Add Another (conditional)

```tsx
return (
  <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Create New Job</DialogTitle>
        <DialogDescription>
          Add a new job that can be used in bills of labor
        </DialogDescription>
      </DialogHeader>

      <Form {...form}>
        <form onSubmit={(e) => { e.preventDefault(); handleSubmit('close'); }} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
            {/* Left column */}
            <div className="space-y-3">
              {/* Category (parent) select */}
              <FormItem>
                <FormLabel>Category</FormLabel>
                <Select
                  onValueChange={handleParentChange}
                  value={selectedParentId}
                  disabled={categoriesLoading}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {parentCategories.map((category) => (
                      <SelectItem
                        key={category.category_id}
                        value={category.category_id.toString()}
                      >
                        {category.name} - R{category.current_hourly_rate.toFixed(2)}/hr
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.category_id && (
                  <p className="text-sm font-medium text-destructive">
                    {form.formState.errors.category_id.message}
                  </p>
                )}
              </FormItem>

              {/* Subcategory select */}
              {subcategoriesForParent.length > 0 && (
                <FormItem>
                  <FormLabel>Subcategory (optional)</FormLabel>
                  <Select
                    onValueChange={(v) => setSelectedSubId(v === '_none' ? '' : v)}
                    value={selectedSubId}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="None (use parent category)" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="_none">None (use parent category)</SelectItem>
                      {subcategoriesForParent.map((sub) => (
                        <SelectItem
                          key={sub.category_id}
                          value={sub.category_id.toString()}
                        >
                          {sub.name} - R{sub.current_hourly_rate.toFixed(2)}/hr
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}

              {/* Hidden field for category_id validation */}
              <input type="hidden" {...form.register('category_id')} />

              {/* Name */}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        ref={(e) => {
                          field.ref(e);
                          (nameInputRef as React.MutableRefObject<HTMLInputElement | null>).current = e;
                        }}
                        autoFocus
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Right column */}
            <div className="space-y-3">
              {/* Estimated Time */}
              <FormField
                control={form.control}
                name="estimated_time"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Estimated Time (optional)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="any"
                        min="0.01"
                        placeholder="0"
                        {...field}
                        value={field.value || ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Time Unit */}
              <FormField
                control={form.control}
                name="time_unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Time Unit</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value || 'minutes'}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="minutes">Minutes</SelectItem>
                        <SelectItem value="hours">Hours</SelectItem>
                        <SelectItem value="seconds">Seconds</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Default Piecework Rate */}
              <FormField
                control={form.control}
                name="piecework_rate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Default Piecework Rate (optional)</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">R</span>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          className="pl-7 pr-14"
                          {...field}
                          value={field.value || ''}
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">/piece</span>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          {/* Description - full width below grid */}
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description (optional)</FormLabel>
                <FormControl>
                  <Textarea {...field} rows={3} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
            >
              Cancel
            </Button>
            {showAddAnother && (
              <Button
                type="button"
                variant="outline"
                disabled={addJob.isPending}
                onClick={() => handleSubmit('another')}
              >
                {addJob.isPending ? 'Creating...' : 'Create & Add Another'}
              </Button>
            )}
            <Button
              type="submit"
              disabled={addJob.isPending}
            >
              {addJob.isPending ? 'Creating...' : 'Create Job'}
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </DialogContent>
  </Dialog>
);
```

- [ ] **Step 2: Verify the app compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add components/features/labor/create-job-modal.tsx
git commit -m "feat(labor): two-column responsive layout with time and rate fields"
```

---

### Task 4: Enable "Create & Add Another" in the labor list parent

**Files:**
- Modify: `components/features/labor/jobs-rates-table.tsx:792`

- [ ] **Step 1: Pass `showAddAnother` to the modal**

Find the `<CreateJobModal` usage (around line 792) and add the prop:

```tsx
<CreateJobModal
  isOpen={isAddJobOpen}
  onClose={() => setIsAddJobOpen(false)}
  onJobCreated={() => {
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
    setIsAddJobOpen(false);
  }}
  showAddAnother
/>
```

- [ ] **Step 2: Verify the app compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add components/features/labor/jobs-rates-table.tsx
git commit -m "feat(labor): enable Create & Add Another in labor list"
```

---

### Task 5: Run lint and verify in browser

**Files:**
- No modifications — verification only

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: No new errors from the modified files.

- [ ] **Step 2: Run TypeScript check**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No new errors from the modified files.

- [ ] **Step 3: Verify in browser — open the dialog**

1. Navigate to `http://localhost:3000` and log in with test account (testai@qbutton.co.za / ClaudeTest2026!)
2. Go to Labor Management page
3. Click "Add Job"
4. Verify: dialog is wider, has two-column layout on desktop
5. Verify: Category, Subcategory, Name on left; Estimated Time, Time Unit, Piecework Rate on right
6. Verify: Description is full-width below the grid
7. Verify: Three buttons in footer — Cancel, Create & Add Another, Create Job

- [ ] **Step 4: Verify — create a job with all fields**

1. Select a category (e.g., "Steel Work")
2. Select a subcategory (e.g., "Brackets")
3. Enter name: "Test Streamlined Job"
4. Enter estimated time: 15, unit: Minutes
5. Enter piecework rate: 3.50
6. Enter description: "Test job for streamlined dialog"
7. Click "Create Job"
8. Verify: dialog closes, toast shows "Job created", job appears in the list
9. Click into the new job in the list to verify estimated time and piecework rate are set correctly

- [ ] **Step 5: Verify — Create & Add Another flow**

1. Click "Add Job" again
2. Select a category, enter name and fields
3. Click "Create & Add Another"
4. Verify: toast shows "Job created", form resets
5. Verify: Category and Subcategory are still selected
6. Verify: Name is cleared and focused
7. Verify: Estimated Time and Piecework Rate are cleared
8. Verify: Time Unit is preserved
9. Create another job to confirm rapid-fire works
10. Click "Create Job" on the last one to close the dialog

- [ ] **Step 6: Verify — minimal job creation (no optional fields)**

1. Click "Add Job"
2. Select a category, enter only a name
3. Click "Create Job"
4. Verify: job is created with null estimated_minutes and no piecework rate

- [ ] **Step 7: Verify multi-parent contract — "Create & Add Another" is hidden in other contexts**

1. Navigate to a product page that has a Bill of Labor
2. Open the "Add Job" dialog from the BOL section (uses `AddJobDialog.tsx`)
3. Verify: only "Cancel" and "Create Job" buttons — NO "Create & Add Another"
4. Close the dialog

This confirms the `showAddAnother` prop defaults to `false` in non-labor-list contexts.

- [ ] **Step 8: Clean up test data**

Clean up the specific test jobs created during verification. Note the `job_id` values from the toasts/list during Steps 4-6, then delete by exact ID:

```sql
-- Via Supabase MCP execute_sql tool. Replace with actual job_ids noted during testing.
DELETE FROM piece_work_rates WHERE job_id IN (<job_id_1>, <job_id_2>, <job_id_3>);
DELETE FROM jobs WHERE job_id IN (<job_id_1>, <job_id_2>, <job_id_3>);
```

Do NOT use `LIKE` patterns — labor tables are not org-scoped, so a wildcard delete could hit other users' data.
