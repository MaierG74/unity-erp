# Work Pool Exception & Audit Spec

**Scope:** Production exceptions created by work-pool over-issuance and reconciliation drift in the job-card issuance flow.

**Audience:** Engineering, product, and implementation agents.

**Status:** Approved working spec derived from the March 5, 2026 interview decisions.

**Related plan:** [`2026-03-05-work-pool-job-card-issuance.md`](./2026-03-05-work-pool-job-card-issuance.md)

## Purpose

The work pool introduces a demand layer between Bill of Labour generation and issued job cards. Once demand and issuance are decoupled, the system needs a durable way to track operational exceptions when issued work exceeds required work.

This spec defines the canonical exception model for that problem.

## Decision Summary

- Over-issuance is blocked by default.
- Over-issuance may be allowed only after the user sees an explicit warning and enters a required reason.
- Any current user who can issue job cards may approve that override.
- Order quantity changes apply immediately.
- If reconciliation reduces demand below issued work, the system creates or updates a production exception immediately.
- Exceptions are tracked per `job_work_pool` row, not per order event.
- Exceptions live in a shared all-users production queue by default.
- One open exception per pool row per exception type. If the situation changes, update that record rather than creating duplicates.
- Acknowledged exceptions remain visible until resolved.
- Resolving an exception requires selecting a resolution path; notes are optional.
- If the mismatch disappears, the system auto-resolves the exception and records a system audit event.

## Exception Types

- `over_issued_override`
  Created when a user intentionally issues more than the pool row's remaining quantity.

- `over_issued_after_reconcile`
  Created when current order/BOL demand is reconciled downward below already-issued work.

These types stay separate in reporting and UI because they have different causes and different ownership conversations.

## State Model

Allowed statuses on `job_work_pool_exceptions`:

- `open`
  Visible in the active queue, not yet acknowledged by production.

- `acknowledged`
  Visible in the active queue. A user has seen and accepted responsibility for the decision path, but the issue is not closed.

- `resolved`
  Removed from the active queue and retained in history.

Initial state rules:

- `over_issued_override` starts as `acknowledged`, because the user saw the warning and confirmed the override with a reason.
- `over_issued_after_reconcile` starts as `open`, because production has not yet acknowledged the downstream impact.

## Resolution Types

Resolution choice is required when a user resolves the exception:

- `cancel_unstarted_cards`
- `move_excess_to_stock`
- `accept_overproduction_rework`

Notes are optional. The structured resolution is the required audit signal.

## Data Model

### `job_work_pool_exceptions`

This is the current-state table.

Recommended columns:

- `exception_id` `bigserial primary key`
- `org_id` `uuid not null`
- `order_id` `integer not null`
- `work_pool_id` `integer not null`
- `exception_type` `text not null`
- `status` `text not null`
- `required_qty_snapshot` `integer not null`
- `issued_qty_snapshot` `integer not null`
- `variance_qty` `integer not null`
- `trigger_source` `text not null`
- `trigger_context` `jsonb not null default '{}'::jsonb`
- `triggered_by` `uuid null`
- `triggered_at` `timestamptz not null default now()`
- `acknowledged_by` `uuid null`
- `acknowledged_at` `timestamptz null`
- `resolution_type` `text null`
- `resolution_notes` `text null`
- `resolved_by` `uuid null`
- `resolved_at` `timestamptz null`
- `created_at` `timestamptz not null default now()`
- `updated_at` `timestamptz not null default now()`

Required uniqueness:

- one active record per `work_pool_id + exception_type`
- implement with a partial unique index where `status in ('open', 'acknowledged')`

### `job_work_pool_exception_activity`

This is the append-only audit table.

Recommended columns:

- `activity_id` `bigserial primary key`
- `exception_id` `bigint not null`
- `org_id` `uuid not null`
- `event_type` `text not null`
- `performed_by` `uuid null`
- `notes` `text null`
- `payload` `jsonb not null default '{}'::jsonb`
- `created_at` `timestamptz not null default now()`

Recommended event types:

- `created`
- `updated`
- `variance_changed`
- `acknowledged`
- `resolution_selected`
- `resolved`
- `auto_resolved`
- `auto_merged_update`
- `override_issued`

## Audit Rules

Every meaningful exception workflow change must append an activity row.

Minimum audit events:

- exception created
- exception updated because variance changed
- exception acknowledged
- resolution selected
- exception resolved manually
- exception resolved automatically because the mismatch disappeared
- issuance override executed

`order_activity` should also receive a short summary row for visibility in order history, but it is not the canonical audit ledger for this workflow.

## Creation and Update Rules

### Issuance override

When issuance exceeds `remaining_qty`:

1. block unless a reason is supplied
2. show explicit warning in UI before confirmation
3. create the job card through the atomic issuance RPC
4. create or update the `over_issued_override` exception in the same transaction
5. mark the exception as `acknowledged`
6. set `acknowledged_by` and `acknowledged_at` to the issuing user and transaction time
7. append activity rows for both the override and the resulting exception change

### Reconciliation mismatch

When pool `required_qty` is updated from current order/BOL reality:

1. apply the demand change immediately
2. if `issued_qty > required_qty`, create or update `over_issued_after_reconcile`
3. status starts as `open`
4. append activity row with before/after demand and variance
5. write order history summary

### Duplicate open exception

If the same pool row and exception type already has an `open` or `acknowledged` record:

- update the existing record to the new snapshots and variance
- do not create a second active record
- append `auto_merged_update` and `variance_changed` activity rows as appropriate

## Auto-Resolution Rules

If the mismatch disappears, the system auto-resolves the active exception.

Examples:

- cards are cancelled or reduced
- order quantity increases again
- reconciliation brings demand back above issued work

Auto-resolution behavior:

- set `status = 'resolved'`
- set `resolved_by = null` or a system actor strategy used elsewhere
- set `resolved_at = now()`
- append `auto_resolved` activity with reason in payload
- keep full history available

## UI Surfaces

The exception must be visible in all relevant operational surfaces.

### Order page

- warning banner on the Job Cards tab
- row-level badge on affected work pool rows
- if a job card is linked to an affected pool row, show an exception indicator on the issued card list

### Scheduler

- show order-level warning indicator when active reconcile exceptions exist
- drag-to-issue override flow must use the same warning and reason rules as the order-page issue dialog

### Production exceptions view

Extend the existing production exceptions area with DB-backed sections for:

- override over-issues
- reconciliation over-issues

The exception remains visible after acknowledgement and disappears only after resolution.

## RPC / Service Requirements

Implementation should prefer database RPCs or server routes over client multi-step workflows.

Required capabilities:

- `issue_job_card_from_pool(...)`
  - lock pool row
  - validate org membership
  - validate quantity
  - require reason when overriding
  - create job card and item
  - create/update override exception when needed
  - auto-resolve override exception if mismatch no longer exists

- `upsert_job_work_pool_exception(...)`
  - create or update active exception
  - append activity

- `resolve_job_work_pool_exception(...)`
  - apply acknowledgement or resolution choice
  - append activity

- `resolve_job_work_pool_exception_if_cleared(...)`
  - auto-resolve when variance is no longer negative

## RLS and Tenancy

These tables are tenant-scoped from day one.

- include `org_id`
- use `public.is_org_member(org_id)` in RLS policies
- RPCs must validate org ownership server-side because they touch `job_cards` and `job_card_items`, which are not yet fully org-scoped

## Reporting and History

Because exception types stay separate, reporting can answer:

- how many variances came from deliberate override vs order-demand change
- how long each class of exception stayed unresolved
- how often production chose each resolution path
- which pool rows churned repeatedly before resolution

This is the main reason not to collapse everything into banners or generic order history.
