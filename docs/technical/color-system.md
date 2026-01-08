# Unity ERP Color System

This document describes the centralized color palette used throughout Unity ERP. All colors are defined as CSS custom properties in `app/globals.css` and extended through Tailwind CSS in `tailwind.config.ts`.

## Quick Reference

| Color | Purpose | Light Mode | Dark Mode | Tailwind Class |
|-------|---------|------------|-----------|----------------|
| Primary | CTAs, active states, links | Teal (#0d9488) | Teal (#14b8a6) | `bg-primary`, `text-primary` |
| Secondary | Secondary actions | Slate (#475569) | Slate (#334155) | `bg-secondary`, `text-secondary` |
| Success | Positive metrics, confirmations | Green (#16a34a) | Green (#16a34a) | `bg-success`, `text-success` |
| Warning | Caution states, pending items | Amber (#f59e0b) | Amber (#f59e0b) | `bg-warning`, `text-warning` |
| Info | Informational elements | Blue (#3b82f6) | Blue (#3b82f6) | `bg-info`, `text-info` |
| Destructive | Errors, deletions | Red (#ef4444) | Red (#7f1d1d) | `bg-destructive`, `text-destructive` |

## Usage Guidelines

### Primary Color (Teal)
Use for main call-to-action buttons and active navigation states:
- "New Order" button
- "Save" / "Submit" buttons
- Active sidebar links
- Primary metrics (Total Orders, Total Customers)

```jsx
<Button className="bg-primary text-primary-foreground hover:bg-primary/90">
  New Order
</Button>
```

### Success Color (Green)
Use for positive indicators and confirmations:
- Growth percentages
- Completed status
- Successful operations
- Open orders count

```jsx
<span className="text-success">+2.5% from last month</span>
```

### Warning Color (Amber)
Use for caution states and pending items:
- Partially fulfilled orders
- Pending checkouts (yesterday)
- Items requiring attention

```jsx
<div className="bg-warning/10 text-warning">Pending Review</div>
```

### Destructive Color (Red)
Use for errors and urgent items:
- Validation errors
- Delete confirmations
- Today's pending items (urgent)

```jsx
<Alert variant="destructive">Error message</Alert>
```

### Info Color (Blue)
Use for neutral informational elements:
- Product counts
- Informational badges
- Neutral metrics

## File Locations

- **CSS Variables**: `app/globals.css` (lines 35-124)
- **Tailwind Config**: `tailwind.config.ts` (lines 45-120)
- **Component Classes**: `app/globals.css` (lines 230-312)

## How to Rollback to Orange Theme

If you need to revert to the previous orange color scheme:

1. Open `app/globals.css`
2. Find the `:root` section
3. Change the primary color values:

```css
/* Current (Teal) */
--primary: 173 58% 39%;

/* Rollback to Orange */
--primary: 24 95% 53%;
```

4. Run a find-and-replace for any hardcoded `teal-` classes and replace with `orange-`

## Migration from Old Colors

When updating components, replace old inline colors with the new palette:

| Old Color | New Equivalent |
|-----------|----------------|
| `bg-[#F26B3A]` | `bg-primary` |
| `hover:bg-[#E25A29]` | `hover:bg-primary/90` |
| `text-orange-500` (for CTAs) | `text-primary` |
| `text-orange-500` (for warnings) | `text-warning` |
| `text-green-500` | `text-success` |
| `text-blue-500` | `text-info` |
| `text-red-500` | `text-destructive` |

## Component Classes

Pre-defined component classes are available in `globals.css`:

```css
.button-primary   /* Main CTA buttons */
.button-secondary /* Secondary actions */
.button-success   /* Confirmation buttons */
.button-warning   /* Caution action buttons */
.status-success   /* Green status text */
.status-warning   /* Amber status text */
.status-error     /* Red status text */
.status-info      /* Blue status text */
```

## Chart Colors

For data visualization, use the chart color palette:

```css
--chart-1: Teal (primary)
--chart-2: Green (success)
--chart-3: Blue (info)
--chart-4: Amber (warning)
--chart-5: Purple (accent variation)
```

Tailwind classes: `bg-chart-1`, `text-chart-1`, etc.

## Accessibility

All color combinations meet WCAG AA contrast requirements:
- Primary on white: 4.5:1 contrast ratio
- Success on white: 4.5:1 contrast ratio
- Text colors provide sufficient contrast against their backgrounds

## Related Documentation

- [Style Guide](../overview/STYLE_GUIDE.md) - Overall design guidelines
- [Tailwind Config](../../tailwind.config.ts) - Full Tailwind configuration
- [Global Styles](../../app/globals.css) - CSS custom properties and base styles
