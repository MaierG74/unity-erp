# Inline Category Creation in Create Job Dialog

## Problem

During initial rollout, users creating hundreds of jobs frequently need categories that don't exist yet. The current flow forces them to leave the Create Job dialog, navigate to the Categories tab, create the category, then return. This breaks the rapid-fire "Create & Add Another" workflow.

## Design

### UX Model: Context-Driven Creation

The dropdown you clicked tells you what you're creating — no ambiguity, no "Parent Category" selector.

- **"+ New Category"** item at the bottom of the Category dropdown
- **"+ New Subcategory"** item at the bottom of the Subcategory dropdown (only visible when a parent is selected)

Each opens a small inline dialog (not a full modal — a popover or compact dialog) with a minimal form.

### Inline Form: Both Variants

Both "New Category" and "New Subcategory" use the same form fields:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| Name | Text input | Yes | Auto-focused |
| Hourly Rate | Number input (R prefix) | Yes | For subcategories, pre-fill from parent's rate |

That's it. No description, no parent selector, no rate versioning. Users can add those later in the Categories manager.

### Interaction Flow

**New Category:**
1. User clicks Category dropdown
2. Sees existing parent categories + "**+ New Category**" at bottom (visually separated)
3. Clicks "+ New Category" → small dialog opens
4. Fills Name + Hourly Rate → clicks "Create"
5. Dialog closes, new category is auto-selected in the Category dropdown
6. Subcategory dropdown resets (new category has no subs yet)

**New Subcategory:**
1. User has already selected a parent category
2. Clicks Subcategory dropdown
3. Sees existing subcategories for that parent + "**+ New Subcategory**" at bottom
4. Clicks "+ New Subcategory" → small dialog opens, shows parent name as read-only context (e.g., "Under: Upholstery")
5. Fills Name + Hourly Rate (pre-filled from parent) → clicks "Create"
6. Dialog closes, new subcategory is auto-selected in the Subcategory dropdown

### Component Architecture

**New component: `InlineCategoryForm`**
- Small dialog/popover with Name + Hourly Rate fields
- Props: `parentId?: number`, `parentName?: string`, `onCreated(category: JobCategory)`, `onCancel()`
- Handles its own mutation (insert into `job_categories` + initial `job_category_rates` row)
- Invalidates `['jobCategories']` query key on success

**Modifications to `create-job-modal.tsx`:**
- Add dialog open states: `isNewCategoryOpen`, `isNewSubcategoryOpen`
- Add "+ New Category" / "+ New Subcategory" items to the respective Select components
- Wire `onCreated` callbacks to set `selectedParentId` / `selectedSubId`

### Data Operations

On creation, two inserts (matching the existing pattern in `job-categories-manager.tsx`):

1. **`job_categories`**: `{ name, current_hourly_rate, parent_category_id: parentId ?? null, org_id }`
2. **`job_category_rates`**: `{ category_id: newId, hourly_rate, effective_date: today }`

Query invalidation: `['jobCategories']` — the shared key that `useCategoryTree` depends on.

### Error Handling

- Duplicate name validation: show inline error if category name already exists under the same parent
- Network errors: toast notification, form stays open so user can retry

### Visual Design

- The "+ New" items use muted text with a Plus icon, visually separated from real categories by a `SelectSeparator`
- The inline form is a small `Dialog` (not a popover — keeps consistent with the app's pattern and avoids z-index issues with the parent dialog)
- Form follows the compact convention: `space-y-3`, small labels, fits without scrolling

## Out of Scope

- Rate versioning (use Categories manager)
- Description field (use Categories manager)
- Editing or deleting categories inline
- Drag-to-reorder categories
