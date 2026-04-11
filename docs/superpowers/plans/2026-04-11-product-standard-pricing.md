# Product Standard Pricing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pricing section to the product Costing tab that lets users set a standard selling price via percentage or fixed markup over unit cost.

**Architecture:** Two new tables (`product_price_lists`, `product_prices`) with org-scoped RLS. A React hook (`useProductPricing`) handles fetch/upsert. The pricing UI is a new `ProductPricingSection` component rendered inside `product-costing.tsx`'s summary sub-tab, below the cost summary card.

**Tech Stack:** Supabase (Postgres + RLS), React, TanStack Query, shadcn UI, Tailwind v4

**Spec:** `docs/superpowers/specs/2026-04-11-product-standard-pricing-design.md`

---

### File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/20260411_product_pricing.sql` | Tables, RLS, seed data |
| Create | `hooks/useProductPricing.ts` | Fetch + upsert product price for default list |
| Create | `components/features/products/ProductPricingSection.tsx` | Markup controls + price flow UI |
| Modify | `components/features/products/product-costing.tsx` | Render `ProductPricingSection` in summary |

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260411_product_pricing.sql`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260411_product_pricing.sql`:

```sql
begin;

-- ============================================================
-- 1. product_price_lists — named price lists per org
-- ============================================================
create table if not exists public.product_price_lists (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  name       text not null,
  description text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists product_price_lists_org_id_idx
  on public.product_price_lists(org_id);

alter table public.product_price_lists enable row level security;

-- RLS policies
drop policy if exists product_price_lists_select on public.product_price_lists;
create policy product_price_lists_select on public.product_price_lists
  for select to authenticated
  using (
    exists (
      select 1 from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id = product_price_lists.org_id
        and m.is_active = true
        and (m.banned_until is null or m.banned_until <= now())
    )
  );

drop policy if exists product_price_lists_insert on public.product_price_lists;
create policy product_price_lists_insert on public.product_price_lists
  for insert to authenticated
  with check (
    exists (
      select 1 from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id = product_price_lists.org_id
        and m.is_active = true
        and (m.banned_until is null or m.banned_until <= now())
    )
  );

drop policy if exists product_price_lists_update on public.product_price_lists;
create policy product_price_lists_update on public.product_price_lists
  for update to authenticated
  using (
    exists (
      select 1 from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id = product_price_lists.org_id
        and m.is_active = true
        and (m.banned_until is null or m.banned_until <= now())
    )
  );

-- ============================================================
-- 2. product_prices — per-product pricing within a list
-- ============================================================
create table if not exists public.product_prices (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  product_id    integer not null references public.products(product_id) on delete cascade,
  price_list_id uuid not null references public.product_price_lists(id) on delete cascade,
  markup_type   text not null check (markup_type in ('percentage', 'fixed')),
  markup_value  numeric(12,2) not null default 0,
  selling_price numeric(12,2) not null default 0,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- One price per product per list
create unique index if not exists product_prices_product_list_uq
  on public.product_prices(product_id, price_list_id);

create index if not exists product_prices_org_id_idx
  on public.product_prices(org_id);

alter table public.product_prices enable row level security;

-- RLS policies
drop policy if exists product_prices_select on public.product_prices;
create policy product_prices_select on public.product_prices
  for select to authenticated
  using (
    exists (
      select 1 from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id = product_prices.org_id
        and m.is_active = true
        and (m.banned_until is null or m.banned_until <= now())
    )
  );

drop policy if exists product_prices_insert on public.product_prices;
create policy product_prices_insert on public.product_prices
  for insert to authenticated
  with check (
    exists (
      select 1 from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id = product_prices.org_id
        and m.is_active = true
        and (m.banned_until is null or m.banned_until <= now())
    )
  );

drop policy if exists product_prices_update on public.product_prices;
create policy product_prices_update on public.product_prices
  for update to authenticated
  using (
    exists (
      select 1 from public.organization_members m
      where m.user_id = auth.uid()
        and m.org_id = product_prices.org_id
        and m.is_active = true
        and (m.banned_until is null or m.banned_until <= now())
    )
  );

-- ============================================================
-- 3. Seed: one "Standard" price list per existing org
-- ============================================================
insert into public.product_price_lists (org_id, name, is_default)
select id, 'Standard', true
from public.organizations
on conflict do nothing;

commit;
```

- [ ] **Step 2: Apply the migration**

Use Supabase MCP `apply_migration` or run via Supabase CLI:
```bash
supabase db push
```

- [ ] **Step 3: Refresh schema cache**

```bash
npm run schema
```

- [ ] **Step 4: Verify tables exist**

Run via Supabase MCP `execute_sql`:
```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('product_price_lists', 'product_prices');
```
Expected: both tables listed.

- [ ] **Step 5: Verify RLS is enabled**

Run via Supabase MCP `execute_sql`:
```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public'
  and tablename in ('product_price_lists', 'product_prices');
```
Expected: `rowsecurity = true` for both.

- [ ] **Step 6: Verify seed data**

```sql
select * from public.product_price_lists where is_default = true;
```
Expected: one row per org with name "Standard".

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260411_product_pricing.sql
git commit -m "feat: add product_price_lists and product_prices tables with RLS"
```

---

### Task 2: useProductPricing Hook

**Files:**
- Create: `hooks/useProductPricing.ts`

- [ ] **Step 1: Create the hook file**

Create `hooks/useProductPricing.ts`:

```typescript
'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/common/auth-provider'
import { getOrgId } from '@/lib/utils'
import { useToast } from '@/components/ui/use-toast'

export type MarkupType = 'percentage' | 'fixed'

export interface ProductPrice {
  id: string
  product_id: number
  price_list_id: string
  markup_type: MarkupType
  markup_value: number
  selling_price: number
}

export function useProductPricing(productId: number) {
  const { user } = useAuth()
  const orgId = getOrgId(user)
  const queryClient = useQueryClient()
  const { toast } = useToast()

  // Fetch the default price list ID for this org
  const { data: defaultListId } = useQuery({
    queryKey: ['default-price-list', orgId],
    enabled: !!orgId,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_price_lists')
        .select('id')
        .eq('org_id', orgId!)
        .eq('is_default', true)
        .single()
      if (error) throw error
      return data.id as string
    },
  })

  // Fetch existing price for this product + default list
  const {
    data: price,
    isLoading,
  } = useQuery({
    queryKey: ['product-price', productId, defaultListId],
    enabled: !!defaultListId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_prices')
        .select('id, product_id, price_list_id, markup_type, markup_value, selling_price')
        .eq('product_id', productId)
        .eq('price_list_id', defaultListId!)
        .maybeSingle()
      if (error) throw error
      return data as ProductPrice | null
    },
  })

  // Upsert price
  const saveMutation = useMutation({
    mutationFn: async (input: {
      markupType: MarkupType
      markupValue: number
      sellingPrice: number
    }) => {
      if (!orgId || !defaultListId) throw new Error('Missing org or price list')

      const payload = {
        org_id: orgId,
        product_id: productId,
        price_list_id: defaultListId,
        markup_type: input.markupType,
        markup_value: input.markupValue,
        selling_price: input.sellingPrice,
        updated_at: new Date().toISOString(),
      }

      if (price?.id) {
        // Update existing
        const { data, error } = await supabase
          .from('product_prices')
          .update(payload)
          .eq('id', price.id)
          .select()
          .single()
        if (error) throw error
        return data
      } else {
        // Insert new
        const { data, error } = await supabase
          .from('product_prices')
          .insert(payload)
          .select()
          .single()
        if (error) throw error
        return data
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-price', productId, defaultListId] })
      toast({
        title: 'Price saved',
        description: 'Standard pricing has been updated.',
      })
    },
    onError: (error) => {
      console.error('Failed to save price:', error)
      toast({
        title: 'Save failed',
        description: 'Could not save pricing. Please try again.',
        variant: 'destructive',
      })
    },
  })

  return {
    price,
    isLoading,
    isSaving: saveMutation.isPending,
    savePrice: saveMutation.mutate,
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit hooks/useProductPricing.ts 2>&1 | head -20
```

If there are unrelated project-wide errors, just verify no errors reference `useProductPricing.ts`.

- [ ] **Step 3: Commit**

```bash
git add hooks/useProductPricing.ts
git commit -m "feat: add useProductPricing hook for standard pricing"
```

---

### Task 3: ProductPricingSection Component

**Files:**
- Create: `components/features/products/ProductPricingSection.tsx`

- [ ] **Step 1: Create the component**

Create `components/features/products/ProductPricingSection.tsx`:

```tsx
'use client'

import { useState, useEffect } from 'react'
import { DollarSign } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useProductPricing, type MarkupType } from '@/hooks/useProductPricing'

function fmtMoney(v: number | null | undefined) {
  if (v == null) return '—'
  return `R${v.toFixed(2)}`
}

interface ProductPricingSectionProps {
  productId: number
  unitCost: number
}

export function ProductPricingSection({ productId, unitCost }: ProductPricingSectionProps) {
  const { price, isLoading, isSaving, savePrice } = useProductPricing(productId)

  const [markupType, setMarkupType] = useState<MarkupType>('percentage')
  const [markupValue, setMarkupValue] = useState<number>(0)
  const [dirty, setDirty] = useState(false)

  // Sync from saved price when loaded
  useEffect(() => {
    if (price) {
      setMarkupType(price.markup_type)
      setMarkupValue(price.markup_value)
      setDirty(false)
    }
  }, [price])

  // Calculate derived values
  const markupAmount =
    markupType === 'percentage' ? unitCost * (markupValue / 100) : markupValue
  const sellingPrice = unitCost + markupAmount
  const margin = sellingPrice > 0 ? (markupAmount / sellingPrice) * 100 : 0

  const handleSave = () => {
    savePrice({
      markupType,
      markupValue,
      sellingPrice,
    })
    setDirty(false)
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <DollarSign className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Standard Pricing</span>
        </div>
        <div className="py-4 text-center text-sm text-muted-foreground">Loading pricing...</div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border bg-card p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <DollarSign className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Standard Pricing</span>
      </div>

      {/* Markup controls */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* Markup type toggle */}
        <div>
          <div className="text-xs uppercase text-muted-foreground tracking-wide mb-1.5">
            Markup Type
          </div>
          <div className="flex rounded-md border bg-muted/30 p-0.5">
            <button
              type="button"
              onClick={() => {
                setMarkupType('percentage')
                setDirty(true)
              }}
              className={`flex-1 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${
                markupType === 'percentage'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              % Percentage
            </button>
            <button
              type="button"
              onClick={() => {
                setMarkupType('fixed')
                setDirty(true)
              }}
              className={`flex-1 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors ${
                markupType === 'fixed'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              R Fixed
            </button>
          </div>
        </div>

        {/* Markup value input */}
        <div>
          <div className="text-xs uppercase text-muted-foreground tracking-wide mb-1.5">
            Markup
          </div>
          <div className="relative">
            <Input
              type="number"
              value={markupValue || ''}
              placeholder="0"
              onBlur={(e) => {
                if (e.target.value === '') setMarkupValue(0)
              }}
              onChange={(e) => {
                setMarkupValue(parseFloat(e.target.value) || 0)
                setDirty(true)
              }}
              className="pr-8"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              {markupType === 'percentage' ? '%' : 'R'}
            </span>
          </div>
        </div>
      </div>

      {/* Price flow: Cost + Markup = Selling Price */}
      <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-0">
        {/* Unit Cost */}
        <div className="rounded-lg border bg-muted/30 p-3 text-center">
          <div className="text-[11px] uppercase text-muted-foreground tracking-wide mb-1">
            Unit Cost
          </div>
          <div className="text-lg font-bold tabular-nums">{fmtMoney(unitCost)}</div>
        </div>

        <div className="px-2 text-muted-foreground/50 text-lg font-light">+</div>

        {/* Markup Amount */}
        <div className="rounded-lg border bg-muted/30 p-3 text-center">
          <div className="text-[11px] uppercase text-muted-foreground tracking-wide mb-1">
            Markup{markupType === 'percentage' ? ` (${markupValue}%)` : ''}
          </div>
          <div className="text-lg font-bold tabular-nums text-amber-500">
            {fmtMoney(markupAmount)}
          </div>
        </div>

        <div className="px-2 text-muted-foreground/50 text-lg font-light">=</div>

        {/* Selling Price */}
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-center">
          <div className="text-[11px] uppercase text-emerald-400 tracking-wide mb-1">
            Selling Price
          </div>
          <div className="text-lg font-bold tabular-nums text-emerald-500">
            {fmtMoney(sellingPrice)}
          </div>
        </div>
      </div>

      {/* Footer: margin + save */}
      <div className="flex items-center justify-between mt-3">
        <div className="flex gap-3 text-[11px] text-muted-foreground">
          <span>Margin: {margin.toFixed(1)}%</span>
          <span>Profit: {fmtMoney(markupAmount)} per unit</span>
        </div>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!dirty || unitCost === 0 || isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Price'}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit components/features/products/ProductPricingSection.tsx 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add components/features/products/ProductPricingSection.tsx
git commit -m "feat: add ProductPricingSection component"
```

---

### Task 4: Wire Into product-costing.tsx

**Files:**
- Modify: `components/features/products/product-costing.tsx`

- [ ] **Step 1: Add import**

At the top of `product-costing.tsx`, after the existing imports (around line 20), add:

```typescript
import { ProductPricingSection } from './ProductPricingSection'
```

- [ ] **Step 2: Insert the pricing section in the summary sub-tab**

In `product-costing.tsx`, find the closing `</div>` of the hero cost card (the `{/* Hero unit cost + composition bar */}` section ends around line 469 with `</div>`). Insert the pricing section immediately after that card and before the `{/* Category cards */}` comment.

Find this code (around line 469–471):

```
                )}
                </div>

                {/* Category cards */}
```

Insert between the closing `</div>` and `{/* Category cards */}`:

```tsx
                {/* Standard Pricing */}
                <ProductPricingSection productId={productId} unitCost={unitCost} />
```

The result should be:

```tsx
                )}
                </div>

                {/* Standard Pricing */}
                <ProductPricingSection productId={productId} unitCost={unitCost} />

                {/* Category cards */}
```

- [ ] **Step 3: Verify it compiles**

```bash
npx tsc --noEmit components/features/products/product-costing.tsx 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add components/features/products/product-costing.tsx
git commit -m "feat: wire ProductPricingSection into costing tab summary"
```

---

### Task 5: Lint, Test in Browser, and Verify

- [ ] **Step 1: Run lint**

```bash
npm run lint
```

Fix any lint errors in the new/modified files.

- [ ] **Step 2: Open the product page in Chrome**

Navigate to `http://localhost:3000/products/828?tab=costing` (or any product with costing data) using Chrome MCP.

- [ ] **Step 3: Verify the pricing section renders**

Confirm:
- The "Standard Pricing" section appears below the cost summary card
- The percentage/fixed toggle works
- Typing a markup value recalculates the selling price live
- The Cost + Markup = Selling Price flow displays correctly

- [ ] **Step 4: Test saving a price**

1. Set markup type to "% Percentage"
2. Enter a markup value (e.g. 40)
3. Click "Save Price"
4. Verify the success toast appears
5. Refresh the page and confirm the values persist

- [ ] **Step 5: Test fixed markup**

1. Toggle to "R Fixed"
2. Enter a fixed amount (e.g. 100)
3. Save and verify persistence

- [ ] **Step 6: Take a screenshot as proof**

Use Chrome MCP to screenshot the completed pricing section.

- [ ] **Step 7: Run RLS security check**

Use Supabase MCP `get_advisors` to check for missing RLS on the new tables.

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "feat: product standard pricing — complete"
```
