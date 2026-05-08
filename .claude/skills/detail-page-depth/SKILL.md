---
name: detail-page-depth
description: Blueprint for building or upgrading detail pages (entity views with tabs/sections) to match Unity ERP's visual depth standard. Use when creating a new detail page, upgrading an existing one that feels flat, or adding tabs/sections to an entity view. Covers page canvas, sticky headers, sidebar decisions, gradient stat cards, and accent borders.
disable-model-invocation: true
argument-hint: "[page or component to upgrade]"
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# Detail Page Depth Blueprint

Apply visual depth patterns to: **$ARGUMENTS**

## Reference Pages

Read these before starting — they are the gold standard:

| Pattern | Reference File |
|---------|---------------|
| Sidebar + depth | `app/orders/[orderId]/page.tsx` |
| Sidebar component | `components/features/orders/OrderSidebar.tsx` |
| Gradient stat cards | `components/features/inventory/component-detail/OverviewTab.tsx` |
| Component sidebar | `components/features/inventory/component-detail/ComponentSidebar.tsx` |
| Dashboard KPIs | `app/purchasing/page.tsx` |

## Workflow

1. **Read the target page** and all its tab components
2. **Read `patterns.md`** in this skill directory for exact Tailwind classes
3. **Walk through the Decision Tree** below for each aspect
4. **Apply changes** using the patterns from `patterns.md`
5. **Verify** with `npx tsc --noEmit` and visual check

## Decision Tree

Work through each decision in order. Every detail page gets Steps 1-2. Steps 3-5 require judgment.

### Step 1: Page Canvas (ALWAYS apply)

Wrap the page's root container in the muted background:

```
Before: <div className="max-w-7xl space-y-4">
After:  <div className="max-w-7xl space-y-5 bg-muted/30 -mx-4 md:-mx-6 px-4 md:px-6 min-h-screen">
```

This subtle gray canvas is the single biggest visual improvement — it makes cards float with depth instead of sitting on flat black/white. Non-negotiable for all detail pages.

### Step 2: Sticky Header (ALWAYS apply)

Wrap the title row + tab triggers in a sticky container:

```tsx
<div className="sticky top-0 z-10 -mx-4 md:-mx-6 px-4 md:px-6 pt-2 pb-3 space-y-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b shadow-sm">
  {/* Title row: back button + entity name + action buttons */}
  {/* Tab triggers */}
</div>
```

When using Tabs component, lift tab state to a `useState` so TabsList (in sticky header) and TabsContent (below) can be in separate DOM containers.

### Step 3: Sidebar Assessment (USE JUDGMENT)

**Ask:** For each tab, does the main content benefit from a sidebar?

| Content Type | Sidebar? | Reason |
|-------------|----------|--------|
| Wide data tables | NO | Tables need full width for columns |
| Charts/analytics | NO | Visualizations need breathing room |
| Forms | NO | Form fields need width |
| Overview/summary | YES | Summary cards + main info benefit from side context |
| Section cards (POs, BOMs, orders) | YES | Quick reference while scrolling sections |
| Simple list of items | MAYBE | Only if there's useful context to show alongside |

**Sidebar content candidates:**
- At-a-glance summary (stock levels, key metrics)
- Links to related entities (suppliers, products, orders)
- Quick action buttons (edit, navigate to other tabs)
- Progress/status summary

**Sidebar content anti-patterns:**
- Primary content (belongs in main column)
- Data tables (too wide)
- Forms or inputs
- Duplicate info already on the page

**Layout:** `grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5` with sidebar in `hidden lg:block`

**Sidebar card pattern:**
```tsx
<Card className="shadow-sm">
  <CardHeader className="pb-2">
    <CardTitle className="text-sm font-semibold flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      Section Title
    </CardTitle>
  </CardHeader>
  <CardContent className="space-y-3">
    {/* Key-value rows */}
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">Label</span>
      <span className="font-medium">Value</span>
    </div>
  </CardContent>
</Card>
```

### Step 4: Stat Card Assessment

**Ask:** Does this tab have summary metric cards at the top?

**If yes — choose the right style:**

| Card Purpose | Style | Example |
|-------------|-------|---------|
| Display-only metrics | Gradient background | Component Overview stock cards |
| Filterable/clickable KPIs | Left border + active ring | Purchasing dashboard cards |

**Gradient color mapping (by semantic meaning):**

| Meaning | Light gradient | Dark gradient | Border |
|---------|--------------|---------------|--------|
| Procurement/orders | `from-blue-50 to-blue-100/50` | `from-blue-950/30 to-blue-900/20` | `border-blue-200 dark:border-blue-800` |
| Demand/required | `from-purple-50 to-purple-100/50` | `from-purple-950/30 to-purple-900/20` | `border-purple-200 dark:border-purple-800` |
| Stock/health/positive | `from-green-50 to-green-100/50` | `from-green-950/30 to-green-900/20` | `border-green-200 dark:border-green-800` |
| Warnings/pending | `from-amber-50 to-amber-100/50` | `from-amber-950/30 to-amber-900/20` | `border-amber-200 dark:border-amber-800` |
| Critical/shortage | `from-red-50 to-red-100/50` | `from-red-950/30 to-red-900/20` | `border-red-200 dark:border-red-800` |
| Neutral/general | `from-slate-50 to-slate-100/50` | `from-slate-800/30 to-slate-700/20` | `border-slate-200 dark:border-slate-700` |

**Pattern:** `bg-gradient-to-br {light} dark:{dark} {border}`

### Step 5: Section Card Accent Borders

**Ask:** Does this page have 3+ distinct section cards that represent different domains?

**If yes:** Add left accent borders to distinguish section types:

```tsx
<Card className="shadow-sm border-l-3 border-l-blue-500/40">
```

**Color by domain:**

| Domain | Border Color |
|--------|-------------|
| Procurement (POs, suppliers) | `border-l-blue-500/40` |
| Products/manufacturing | `border-l-emerald-500/40` |
| Demand (orders, requirements) | `border-l-purple-500/40` |
| Financial (costs, pricing) | `border-l-amber-500/40` |
| Alerts/warnings | `border-l-red-500/40` |

**If fewer than 3 sections:** Skip accent borders — they add visual noise without enough variety to be meaningful.

**ALL cards** regardless of accent borders should have `shadow-sm` for baseline depth against the `bg-muted/30` canvas.

## Scope Boundaries

This skill covers **detail pages** (entity views with tabs/sections).

It does NOT cover:
- Dashboard/list pages (use `design-review` skill)
- Forms or dialog styling
- Mobile card fallbacks (use `design-review` skill)
- Navigation or layout shell
