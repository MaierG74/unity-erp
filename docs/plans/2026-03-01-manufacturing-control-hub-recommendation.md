# Manufacturing Control Hub Recommendation

**Date:** 2026-03-01
**Purpose:** Handoff summary for product discussion and comparison against alternative design proposals
**Status:** Discussion only, no implementation yet

## Summary

Unity ERP should keep job cards visible from the Orders area, but planners should not need to bounce between Orders, Labor Planning, Factory Floor, and staff-specific views to run the factory day to day.

The recommended direction is a single planner-facing **Manufacturing Control Hub** with fast view switching between:

1. **Queue** — outstanding and unscheduled work
2. **Schedule** — planner board for assigning and moving work
3. **Floor** — issued and in-progress execution view
4. **Exceptions** — blocked, overdue, paused, or at-risk work

This is not a recommendation to force everything onto one page. It is a recommendation to create one operational area with multiple tightly connected views.

## Current State in Unity ERP

The current product already has the main building blocks, but they are split across different entry points:

- **Orders** shows job-card context per order and is still useful because job cards relate directly to a customer order.
- **Labor Planning** is the closest existing planner cockpit and already works as a scheduling board.
- **Factory Floor** is the live execution surface for issued and in-progress assignments.
- Some job-card interactions still require indirect navigation patterns that are slower than a planner workflow should be.

Relevant repo references:

- [docs/domains/timekeeping/labor-section.md](/Users/gregorymaier/developer/unity-erp/docs/domains/timekeeping/labor-section.md)
- [docs/features/factory-floor.md](/Users/gregorymaier/developer/unity-erp/docs/features/factory-floor.md)
- [docs/plans/2026-02-28-orders-page-redesign.md](/Users/gregorymaier/developer/unity-erp/docs/plans/2026-02-28-orders-page-redesign.md)
- [docs/plans/2026-03-01-job-actions-design.md](/Users/gregorymaier/developer/unity-erp/docs/plans/2026-03-01-job-actions-design.md)

## Core Product Recommendation

### 1. Make planning queue-first, not staff-first

The planner’s primary question is usually:

- What is waiting?
- What is late?
- What can be scheduled next?
- What is blocked?

That means the default manufacturing control surface should center on the work queue, not require the planner to start from a staff member and then drill into job cards.

### 2. Preserve order context without making Orders the planner workspace

Orders should still expose job cards because that relationship matters for customer-specific work, status checks, and traceability.

But the Orders page should act as a contextual entry point, not the main daily planning surface. The right pattern is:

- Keep job-card counts and visibility on the order
- Allow deep linking into the manufacturing hub with that order pre-filtered
- Avoid making a planner manage the factory from order-level modals

### 3. Separate planner workflow from operator workflow

Planners and supervisors need one consolidated control area. Operators need a simpler execution-oriented surface.

Recommended separation:

- **Planner/Supervisor:** queue, scheduling, reassignments, exceptions, factory-wide visibility
- **Operator/Shop floor:** assigned work, start/pause/complete, simple execution status

The existing `Labor Planning` and `Factory Floor` split already points in this direction and should be consolidated under one manufacturing area rather than expanded as separate islands.

### 4. Build around fast switching, not deep drilling

The goal is quick operational switching:

- outstanding job cards
- what is coming through
- schedule this one
- see the factory plan quickly
- handle quick wins without leaving the area

This supports one manufacturing hub with internal tabs or segmented views rather than several unrelated sidebar destinations.

## Recommended Information Architecture

### Manufacturing Control Hub

One top-level manufacturing/planning area with four main views:

#### A. Queue

Purpose:
- Show all outstanding work not yet completed
- Surface unscheduled and ready-to-issue jobs first

Key content:
- job card/work order
- order number
- customer
- product
- job/operation
- section/category
- due date
- priority
- current status
- blocked reason if any

Key actions:
- schedule
- assign
- reprioritize
- open order context

#### B. Schedule

Purpose:
- Central scheduling board
- Drag/drop or quick assign across staff, sections, or work centers

This should likely evolve from the current `/labor-planning` board rather than inventing a new planner surface.

Key additions to support the hub model:
- stronger queue panel
- better filtering
- easier jump from queue item to factory status
- easier jump from order to filtered schedule

#### C. Floor

Purpose:
- Live execution view for issued and in-progress work
- Supervisor actions for completion, pause, and transfer

This should likely remain the execution-focused surface currently represented by `/factory-floor`, but nested inside the same manufacturing area.

#### D. Exceptions

Purpose:
- Reduce hidden operational failures
- Give planners a short list of things that need intervention now

Examples:
- overdue jobs
- paused jobs
- waiting materials
- unassigned urgent work
- shift overruns
- jobs at risk of missing due date

## External Pattern Comparison

These products broadly support the same direction:

### Katana

Katana uses a central production scheduling area plus a separate shop-floor execution experience. That pattern supports a clear distinction between planning and doing.

Useful takeaway:
- One planner hub
- Separate operator-facing execution surface

### Odoo

Odoo keeps manufacturing planning and execution under one manufacturing domain, with schedule/work-center visibility and shop-floor execution tools.

Useful takeaway:
- Shared manufacturing area
- Multiple views for the same operational workflow

### ERPNext

ERPNext is more document-driven, but still keeps a clear chain from production planning to work orders to job cards.

Useful takeaway:
- Job cards are downstream execution records, not the only planning surface

## Design Principles to Use When Reviewing Other Proposals

Use this checklist when comparing alternative AI plans:

1. **Does it keep order context without forcing planning to happen inside the Orders page?**
2. **Does it create one planner-facing manufacturing hub instead of multiple disconnected pages?**
3. **Does it distinguish planner/supervisor workflow from operator/shop-floor workflow?**
4. **Does it make outstanding, late, paused, and blocked work visible without drilling into staff first?**
5. **Does it optimize for rapid switching between queue, schedule, and floor status?**
6. **Does it avoid burying job cards behind indirect navigation such as staff-first drilldown?**

If a proposal starts with “pick a staff member, then inspect their job cards,” it is probably centered on the wrong user mental model for daily planning.

## Concrete Recommendation for Unity ERP

Recommended product direction:

- Keep job cards on Orders
- Keep the current Labor Planning board
- Keep the current Factory Floor execution view
- Reframe them as one connected manufacturing/planning area
- Add a queue-first view for outstanding work
- Add an exceptions view for late, blocked, paused, and urgent items
- Use order pages as contextual entry points into the manufacturing area, not as the main planning home

## Suggested Next Discussion

When comparing this recommendation with Claude’s proposal, decide:

1. What should be the default landing view for planners: Queue or Schedule?
2. Whether “Factory Floor” stays a named sub-view or becomes part of a broader “Execution” view
3. Whether the first implementation should be a unified page with internal tabs, or a manufacturing section with tightly linked sibling routes
4. Which metrics must be visible at all times: overdue count, unscheduled count, paused count, shift overrun count, due-today count
