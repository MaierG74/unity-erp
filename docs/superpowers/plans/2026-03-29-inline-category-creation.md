# Inline Category Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "+ New Category" and "+ New Subcategory" options to the Create Job dialog's dropdowns so users can create categories without leaving the job creation flow.

**Architecture:** A single new `InlineCategoryForm` component renders as a small Dialog with Name + Hourly Rate fields. It handles its own Supabase mutation (insert into `job_categories` + initial `job_category_rates` row) and calls back with the created category. The Create Job modal gets two dialog open states and wires the `onCreated` callbacks to auto-select the new category.

**Tech Stack:** React, Supabase client, react-hook-form + zod, shadcn Dialog/Select/Input, @tanstack/react-query

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `components/features/labor/inline-category-form.tsx` | Create | Minimal dialog form: Name + Hourly Rate, insert mutation, callback |
| `components/features/labor/create-job-modal.tsx` | Modify | Add "+ New" items to selects, dialog states, wire onCreated callbacks |

---

### Task 1: Create InlineCategoryForm Component

**Files:**
- Create: `components/features/labor/inline-category-form.tsx`

- [ ] **Step 1: Create the component file**

```tsx
'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

interface JobCategory {
  category_id: number;
  name: string;
  current_hourly_rate: number;
  parent_category_id: number | null;
}

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  hourly_rate: z.coerce.number().positive('Rate must be greater than 0'),
});

type FormValues = z.infer<typeof schema>;

interface InlineCategoryFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId?: number;
  parentName?: string;
  defaultRate?: number;
  onCreated: (category: JobCategory) => void;
}

export function InlineCategoryForm({
  open,
  onOpenChange,
  parentId,
  parentName,
  defaultRate,
  onCreated,
}: InlineCategoryFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      hourly_rate: defaultRate ?? 0,
    },
  });

  // Reset form when dialog opens with fresh defaultRate
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      form.reset({ name: '', hourly_rate: defaultRate ?? 0 });
    }
    onOpenChange(nextOpen);
  };

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      // Insert category
      const { data, error } = await supabase
        .from('job_categories')
        .insert({
          name: values.name,
          current_hourly_rate: values.hourly_rate,
          parent_category_id: parentId ?? null,
        })
        .select()
        .single();

      if (error) throw error;

      // Insert initial rate row
      const { error: rateError } = await supabase
        .from('job_category_rates')
        .insert({
          category_id: data.category_id,
          hourly_rate: values.hourly_rate,
          effective_date: new Date().toISOString().split('T')[0],
        });

      if (rateError) {
        console.error('Failed to insert initial rate row:', rateError);
        // Non-fatal — category was created, rate can be added later
      }

      return data as JobCategory;
    },
    onSuccess: (category) => {
      queryClient.invalidateQueries({ queryKey: ['jobCategories'] });
      queryClient.invalidateQueries({ queryKey: ['jobCategoryRates'] });
      toast({ title: parentId ? 'Subcategory created' : 'Category created' });
      onOpenChange(false);
      onCreated(category);
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create category',
        variant: 'destructive',
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {parentId ? 'New Subcategory' : 'New Category'}
          </DialogTitle>
          {parentName && (
            <DialogDescription>Under: {parentName}</DialogDescription>
          )}
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="space-y-3"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} autoFocus />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="hourly_rate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Hourly Rate</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                        R
                      </span>
                      <Input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className="pl-7 pr-10"
                        placeholder="0.00"
                        {...field}
                        value={field.value || ''}
                        onChange={(e) => field.onChange(e.target.valueAsNumber || 0)}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                        /hr
                      </span>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify file compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep inline-category-form || echo "No errors in new file"`

- [ ] **Step 3: Commit**

```bash
git add components/features/labor/inline-category-form.tsx
git commit -m "feat: add InlineCategoryForm component for inline category creation"
```

---

### Task 2: Add "+ New Category" to the Category Dropdown

**Files:**
- Modify: `components/features/labor/create-job-modal.tsx`

- [ ] **Step 1: Add imports**

At the top of `create-job-modal.tsx`, add the new imports. Find the existing select imports:

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
```

Replace with:

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
```

Then add the `Plus` icon import and the `InlineCategoryForm` import. Add after the `useToast` import:

```tsx
import { Plus } from 'lucide-react';
import { InlineCategoryForm } from './inline-category-form';
```

- [ ] **Step 2: Add dialog open state**

Inside the `CreateJobModal` function, after the `const [selectedSubId, setSelectedSubId] = useState('');` line, add:

```tsx
const [isNewCategoryOpen, setIsNewCategoryOpen] = useState(false);
const [isNewSubcategoryOpen, setIsNewSubcategoryOpen] = useState(false);
```

- [ ] **Step 3: Add the "+ New Category" item and handler**

In the Category select's `<SelectContent>`, after the `{parentCategories.map(...)}` block and before the closing `</SelectContent>`, add:

```tsx
<SelectSeparator />
<SelectItem value="__new_category__" className="text-muted-foreground">
  <span className="flex items-center gap-1.5">
    <Plus className="h-3 w-3" />
    New Category
  </span>
</SelectItem>
```

Then update the `handleParentChange` function. Replace:

```tsx
const handleParentChange = (value: string) => {
    setSelectedParentId(value);
    setSelectedSubId('');
  };
```

With:

```tsx
const handleParentChange = (value: string) => {
    if (value === '__new_category__') {
      setIsNewCategoryOpen(true);
      return;
    }
    setSelectedParentId(value);
    setSelectedSubId('');
  };
```

- [ ] **Step 4: Add the "+ New Subcategory" item and handler**

In the Subcategory select's `<SelectContent>`, after the `{subcategoriesForParent.map(...)}` block and before the closing `</SelectContent>`, add:

```tsx
<SelectSeparator />
<SelectItem value="__new_subcategory__" className="text-muted-foreground">
  <span className="flex items-center gap-1.5">
    <Plus className="h-3 w-3" />
    New Subcategory
  </span>
</SelectItem>
```

Then update the subcategory `onValueChange`. Replace:

```tsx
onValueChange={(v) => setSelectedSubId(v === '_none' ? '' : v)}
```

With:

```tsx
onValueChange={(v) => {
  if (v === '__new_subcategory__') {
    setIsNewSubcategoryOpen(true);
    return;
  }
  setSelectedSubId(v === '_none' ? '' : v);
}}
```

- [ ] **Step 5: Add InlineCategoryForm dialogs**

Before the closing `</Dialog>` of the main modal (just before line 515), add:

```tsx
{/* Inline category creation dialogs */}
<InlineCategoryForm
  open={isNewCategoryOpen}
  onOpenChange={setIsNewCategoryOpen}
  onCreated={(cat) => {
    setSelectedParentId(cat.category_id.toString());
    setSelectedSubId('');
  }}
/>

<InlineCategoryForm
  open={isNewSubcategoryOpen}
  onOpenChange={setIsNewSubcategoryOpen}
  parentId={selectedParentId ? parseInt(selectedParentId) : undefined}
  parentName={parentCategories.find((c) => c.category_id.toString() === selectedParentId)?.name}
  defaultRate={parentCategories.find((c) => c.category_id.toString() === selectedParentId)?.current_hourly_rate}
  onCreated={(cat) => {
    setSelectedSubId(cat.category_id.toString());
  }}
/>
```

- [ ] **Step 6: Reset inline dialog state on modal close**

In the existing `useEffect` that resets state when `!isOpen`, add the two new states. Replace:

```tsx
useEffect(() => {
    if (!isOpen) {
      form.reset(DEFAULT_FORM_VALUES);
      setSelectedParentId('');
      setSelectedSubId('');
    }
  }, [isOpen, form]);
```

With:

```tsx
useEffect(() => {
    if (!isOpen) {
      form.reset(DEFAULT_FORM_VALUES);
      setSelectedParentId('');
      setSelectedSubId('');
      setIsNewCategoryOpen(false);
      setIsNewSubcategoryOpen(false);
    }
  }, [isOpen, form]);
```

- [ ] **Step 7: Verify compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`

- [ ] **Step 8: Commit**

```bash
git add components/features/labor/create-job-modal.tsx
git commit -m "feat: add inline category/subcategory creation to Create Job dialog"
```

---

### Task 3: Browser Verification

**Files:** None (verification only)

- [ ] **Step 1: Navigate to the labor page and open Create Job**

Use Chrome MCP to navigate to `http://localhost:3000` and open the Create Job dialog. Verify:
- The Category dropdown shows existing categories plus a separator and "+ New Category" at the bottom
- Clicking "+ New Category" opens a small dialog with Name and Hourly Rate fields
- Creating a category auto-selects it in the dropdown

- [ ] **Step 2: Test subcategory creation**

Select a parent category that has subcategories. Verify:
- The Subcategory dropdown shows existing subs plus "+ New Subcategory"
- Clicking it opens the dialog with "Under: [ParentName]" context
- The hourly rate is pre-filled from the parent
- Creating a subcategory auto-selects it

- [ ] **Step 3: Test edge cases**

- Select a parent with no existing subcategories — the subcategory dropdown should still appear after creating one via "+ New Subcategory" (query invalidation triggers re-render)
- Use "Create & Add Another" — verify the inline dialogs don't interfere with the flow
- Close and reopen the main dialog — verify no stale inline dialog state

- [ ] **Step 4: Run lint**

```bash
npm run lint
```

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address lint/verification issues from inline category creation"
```
