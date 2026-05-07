# Detail Page Depth — Pattern Reference

Copy-paste Tailwind classes for each pattern. All examples are from production code.

## 1. Page Canvas Wrapper

```tsx
<div className="max-w-7xl space-y-5 bg-muted/30 -mx-4 md:-mx-6 px-4 md:px-6 min-h-screen">
  {/* All page content */}
</div>
```

**Key classes:**
- `bg-muted/30` — Subtle gray canvas (30% opacity). Makes cards pop.
- `-mx-4 md:-mx-6` — Negative margin to bleed background edge-to-edge
- `px-4 md:px-6` — Counteracts negative margins for content padding
- `space-y-5` — 1.25rem vertical gap between major sections
- `min-h-screen` — Full-height fill

## 2. Sticky Header

```tsx
<div className="sticky top-0 z-10 -mx-4 md:-mx-6 px-4 md:px-6 pt-2 pb-3 space-y-3 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b shadow-sm">
  {/* Row 1: Back button + Title + Action buttons */}
  <div className="flex justify-between items-center">
    <div className="flex items-center space-x-4">
      <Button variant="outline" size="icon" onClick={() => router.back()}>
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <h1 className="text-3xl font-bold">{entityName}</h1>
    </div>
    <div className="flex space-x-2">
      {/* Edit, Delete, etc. */}
    </div>
  </div>

  {/* Row 2: Tab triggers */}
  <div className="flex">
    <TabsList>
      <TabsTrigger value="overview">Overview</TabsTrigger>
      {/* ... */}
    </TabsList>
  </div>
</div>
```

**Key classes:**
- `sticky top-0 z-10` — Fixed at top during scroll
- `bg-background/95 backdrop-blur` — Frosted glass effect
- `supports-[backdrop-filter]:bg-background/80` — More transparent when blur is supported
- `border-b shadow-sm` — Subtle bottom edge

**Controlled tabs pattern** (when TabsList and TabsContent are in separate containers):
```tsx
const [activeTab, setActiveTab] = useState('overview');

<Tabs value={activeTab} onValueChange={setActiveTab}>
  {/* TabsList in sticky header */}
  {/* TabsContent below */}
</Tabs>
```

## 3. Sidebar Grid Layout

```tsx
<TabsContent value="overview">
  <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5">
    {/* Main content (left) */}
    <div className="space-y-6">
      {/* Tab content */}
    </div>

    {/* Sidebar (right) — hidden on mobile */}
    <div className="hidden lg:block">
      <SidebarComponent />
    </div>
  </div>
</TabsContent>
```

**Sidebar card pattern:**
```tsx
<div className="space-y-4">
  {/* Summary Card */}
  <Card className="shadow-sm">
    <CardHeader className="pb-2">
      <CardTitle className="text-sm font-semibold flex items-center gap-2">
        <Package className="h-4 w-4 text-muted-foreground" />
        Stock Summary
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">In Stock</span>
        <span className={cn('font-medium', qty > 0 ? 'text-green-600' : 'text-red-600')}>
          {qty}
        </span>
      </div>
      {/* More rows... */}
    </CardContent>
  </Card>

  {/* Quick Actions Card */}
  <Card className="shadow-sm">
    <CardHeader className="pb-2">
      <CardTitle className="text-sm font-semibold">Quick Actions</CardTitle>
    </CardHeader>
    <CardContent className="space-y-2">
      <Button variant="outline" size="sm" className="w-full justify-start gap-2">
        <Edit className="h-4 w-4" />
        Edit
      </Button>
    </CardContent>
  </Card>
</div>
```

## 4. Gradient Stat Cards

```tsx
<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
  <Card className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/20 border-blue-200 dark:border-blue-800">
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium">On Order</CardTitle>
      <ShoppingCart className="h-4 w-4 text-blue-600" />
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold text-blue-600">{value}</div>
      <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
    </CardContent>
  </Card>
</div>
```

**Full gradient template:**
```
bg-gradient-to-br from-{color}-50 to-{color}-100/50 dark:from-{color}-950/30 dark:to-{color}-900/20 border-{color}-200 dark:border-{color}-800
```

**Conditional stock status gradients** (from OverviewTab):
```tsx
<Card className={cn(
  isOutOfStock && 'bg-gradient-to-br from-red-50 to-red-100/50 dark:from-red-950/30 dark:to-red-900/20 border-red-200 dark:border-red-800',
  isLowStock && 'bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/30 dark:to-amber-900/20 border-amber-200 dark:border-amber-800',
  isInStock && 'bg-gradient-to-br from-green-50 to-green-100/50 dark:from-green-950/30 dark:to-green-900/20 border-green-200 dark:border-green-800'
)}>
```

## 5. Section Accent Borders

```tsx
{/* Procurement section */}
<Card className="shadow-sm border-l-3 border-l-blue-500/40">
  <CardHeader>
    <CardTitle>Purchase Orders</CardTitle>
  </CardHeader>
  <CardContent>...</CardContent>
</Card>

{/* Product/manufacturing section */}
<Card className="shadow-sm border-l-3 border-l-emerald-500/40">
  <CardHeader>
    <CardTitle>Bill of Materials</CardTitle>
  </CardHeader>
  <CardContent>...</CardContent>
</Card>

{/* Demand section */}
<Card className="shadow-sm border-l-3 border-l-purple-500/40">
  <CardHeader>
    <CardTitle>Active Orders</CardTitle>
  </CardHeader>
  <CardContent>...</CardContent>
</Card>
```

## 6. Baseline Card Shadow

Every `<Card>` on a detail page should have `shadow-sm`:

```tsx
{/* Plain card */}
<Card className="shadow-sm">

{/* Card with accent border */}
<Card className="shadow-sm border-l-3 border-l-blue-500/40">

{/* Card with gradient (shadow-sm already implied by border) */}
<Card className="bg-gradient-to-br from-blue-50 ...">
```

## 7. Collapsible Section Pattern

For pages with many sections, use Collapsible for secondary content:

```tsx
<Collapsible>
  <Card className="shadow-sm border-l-3 border-l-primary/40">
    <CollapsibleTrigger asChild>
      <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
        <div className="flex items-center justify-between">
          <CardTitle>Section Title</CardTitle>
          <ChevronDown className="h-4 w-4 transition-transform" />
        </div>
        <p className="text-sm text-muted-foreground">Brief description</p>
      </CardHeader>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <CardContent>...</CardContent>
    </CollapsibleContent>
  </Card>
</Collapsible>
```

## Color Quick Reference

| Semantic | Tailwind Color | Use For |
|----------|---------------|---------|
| Blue | `blue-500/600` | Procurement, orders, on-order quantities |
| Purple | `purple-500/600` | Demand, requirements, active orders |
| Green | `green-500/600` | Stock, health, positive states |
| Emerald | `emerald-500/600` | Products, manufacturing, BOM |
| Amber | `amber-500/600` | Warnings, pending, financial |
| Red | `red-500/600` | Critical, shortage, out of stock |
| Slate | `slate-500/600` | Neutral, general, uncategorized |
