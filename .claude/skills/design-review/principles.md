# Design Principles & Review Checklist

## Design Philosophy

### 1. Dashboard-First
Every module landing page shows actionable KPIs at the top with the most important work queue below. Users should act from the dashboard, not just view. The Purchasing page is the gold standard: summary cards that filter + direct action buttons in the table.

### 2. Minimize Clicks
Every common workflow should be 1-2 clicks from the module dashboard. On Purchasing, receiving stock is one click. Apply to Orders (fulfill), Inventory (adjust), etc.

### 3. Consistent Page Anatomy
Header -> Action buttons -> Summary cards -> Main content. Every module page should feel familiar.

### 4. Data Density Over Whitespace
This is ERP software, not a marketing site. Optimize for scanability: tighter row heights (52-56px), visible data columns, minimal decorative spacing.

### 5. Smart Defaults
Pre-select the most likely filter (e.g., in-progress orders). Show the most relevant sort. Pre-fill dates to today.

### 6. Status at a Glance
Every record with a lifecycle shows its status via a color-coded badge in list views. Use badges, not plain text.

### 7. Mobile Responsive
Tables use `hidden md:block` desktop table + `md:hidden` card view. The Purchasing dashboard does this correctly.

### 8. Empty States with Guidance
Never show a blank page. Always: icon + heading + descriptive text + optional CTA button.

### 9. Sticky Headers and Action Bars
Table headers sticky for long lists. Detail pages have sticky action bars so primary actions are always accessible.

### 10. Don't Stack Endlessly
Detail pages with many sections (items + receipts + returns + history) should collapse secondary sections by default or use tabs. Works for 4 items but won't scale to 20+ line items.

---

## Review Checklist

Use this checklist when auditing any page:

### Layout
- [ ] Uses PageToolbar for header (or has a plan to migrate)
- [ ] Follows structure: header -> actions -> cards -> content
- [ ] Root container uses appropriate spacing (`space-y-2` for PageToolbar pages, `space-y-6` for legacy)
- [ ] Container padding: `px-4 md:px-6 py-2` (handled by root layout)

### Tables
- [ ] TableCell padding is `px-4 py-2.5` (NOT `p-4`)
- [ ] Row height is 52-56px for single-line, 56-60px for two-line content
- [ ] Headers are sticky (`sticky top-0 bg-background z-10`)
- [ ] Hover state: `hover:bg-muted/50`
- [ ] Mobile card fallback exists (`md:hidden` cards + `hidden md:block` table)

### Text & Pluralization
- [ ] All countable nouns use correct singular/plural: `${count} item${count !== 1 ? 's' : ''}`
- [ ] Applies to: items, orders, receipts, returns, results, records, etc.

### Colors & Tokens
- [ ] Only semantic color tokens used (never raw hex/rgb)
- [ ] Destructive red for "owing" quantities and errors: `text-destructive font-semibold`
- [ ] Muted grey for subtitles: `text-muted-foreground`
- [ ] Primary teal for CTAs and active states

### Status Badges
- [ ] Use consistent variant mapping (see components.md Status Badge Consistency table)
- [ ] Same status shows same color on both list and detail views
- [ ] All statuses have a badge, not plain text

### Cards (KPI/Summary)
- [ ] Grid: `grid gap-4 md:grid-cols-3` (or appropriate column count)
- [ ] Left border color varies by status type
- [ ] Active filter state is clearly visible (ring + background tint + shadow)
- [ ] "(clear filter)" text or mechanism available when filtered
- [ ] Cards are clickable with keyboard support (role="button", tabIndex, onKeyDown)

### Actions & Buttons
- [ ] Primary CTA is top-right of page header
- [ ] No redundant buttons (same action in multiple locations)
- [ ] Primary actions on detail pages in ONE location (prefer sticky bottom bar)
- [ ] Toolbar buttons use `size="sm"` (h-9), standalone CTAs use default (h-10)

### Empty States
- [ ] Icon + heading + description + optional CTA
- [ ] Different message for "no results with filters active" vs "no data at all"

### Pagination / Load More
- [ ] Lists over 10-15 items have pagination or "Load More"
- [ ] Count text uses correct pluralization
- [ ] Page size selector available for paginated lists
- [ ] **URL-based state persistence**: Pagination and filters are persisted in URL query parameters
  - When navigating to detail pages and back, users return to the same page with filters intact
  - Page number stored as `?page=N` (1-based), defaults omitted for clean URLs
  - Page size stored as `?pageSize=N` if not default (10)
  - Filters stored as `?category=X&supplier=Y&q=search` etc.
  - Reference implementation: `components/features/inventory/ComponentsTab.tsx`

### Responsiveness
- [ ] Page stacks vertically on mobile
- [ ] Tables have mobile card fallback
- [ ] Action buttons collapse to dropdown on mobile (PageToolbar handles this)
- [ ] Touch targets are minimum 36px (h-9)

### Accessibility
- [ ] Interactive cards have `role="button"`, `tabIndex={0}`, keyboard handlers
- [ ] Buttons have descriptive labels or `aria-label`
- [ ] Focus rings visible (`focus-visible:ring-2 focus-visible:ring-ring`)
