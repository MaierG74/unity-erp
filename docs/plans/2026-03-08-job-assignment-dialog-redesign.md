# Job Assignment Dialog Redesign

**Date**: 2026-03-08
**Status**: Approved

## Problem

The "Job Assignment Details" dialog shown when clicking a scheduled job bar on the labor planning board is visually basic — plain label-value pairs with no hierarchy. It's the user's primary reference for understanding what an order is and what they're manufacturing, but it lacks key context (customer name), uses awkward time formatting ("0.5h"), and doesn't link back to the order page.

## Design

### Header — Order Identity (hero section)

- **Order number** as a clickable link (opens `/orders/{id}` in new tab) with external-link icon
- **Customer name** displayed prominently next to order number
- **Job name · Product name** on second line
- **Status badge, pay type, quantity** as compact metadata chips below a subtle divider
- Left border gets a colored accent stripe matching the job's category color

### Schedule Time — Smart Duration

- **Inline time range**: "7:00 AM → 7:30 AM" instead of separate Start/End labels
- **Smart duration formatting**: "10 min", "1h 30min", "2h" — never decimals
- **Time per item**: shown when quantity > 1, e.g. "10 min/item × 3 items"

### Expandable Details

Collapsible "More details" section, closed by default:
- Delivery date
- Assigned staff name and role
- Raw order/job IDs

### Actions Footer

Same buttons (Issue, Complete Job, Close) with tighter layout. Issue quantity input stays inline when relevant.

### Data Changes

- `StaffAssignment` type gets `customerName?: string` and `dueDate?: string`
- Populated from parent `PlanningOrder` when building assignments in the labor planning query
- No extra DB calls — data already fetched in orders payload

## Files to Change

1. `components/labor-planning/types.ts` — add fields to `StaffAssignment`
2. `lib/queries/laborPlanning.ts` — pass customer/dueDate through to assignments
3. `components/labor-planning/staff-lane-list.tsx` — redesign dialog JSX
4. `src/lib/laborScheduling.ts` — add smart duration formatter
