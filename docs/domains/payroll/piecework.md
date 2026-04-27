# Piecework Payroll

This page is the operator reference for cut and edge piecework completion.

## Activity Setup

Piecework activities live in `piecework_activities` and are configured from Settings. Each activity has an organization, code, label, default rate, unit label, and optional target labor role.

The default rate is used when cut or edge work-pool rows are generated. Issued job cards keep their own `rate_snapshot`, so later rate changes do not rewrite the value that payroll earns for already issued work.

## Card Generation

Cutting-plan work creates `job_work_pool` rows with `source = 'cutting_plan'`, `piecework_activity_id`, `expected_count`, `material_color_label`, and `cutting_plan_run_id`.

When that work is issued to a staff member, the resulting `job_cards` row carries:

- `piecework_activity_id`
- `expected_count`
- `rate_snapshot`
- `actual_count` once a supervisor completes the card

Cut and edge cards do not use `job_card_items` as the payroll source, so their piecework earnings keep `item_id`, `job_id`, and `product_id` null.

## Supervisor Completion

Supervisors complete piecework cards from the factory-floor completion dialog. For piecework cards the dialog shows the expected count, an editable actual count, the snapshotted rate, and the assigned staff member pre-attributed to 100% of the count.

The supervisor can split the count between multiple active staff members. The split total must equal the actual count before the completion can be submitted.

Organizations with zero active `piecework_activities` rows keep the previous cutting-plan behavior and create no cutting-plan work-pool rows.

## Printing Job Cards

Cut and edge piecework job cards can be printed from the job card detail page when the card is linked to a `piecework_activity_id` with code `cut_pieces` or `edge_bundles`.

The single-card PDF is a one-page A4 portrait shop-floor handout. It includes the card ID, CUT/EDGE type, company name/logo from Settings when available, issued date, order number, customer, due date, material/color label, expected count, assigned staff, configured piecework role, and cutting plan reference. The expected count is intentionally oversized so operators can reconcile against it quickly, and the lower third-plus of the page is reserved for handwritten notes and variances.

PDF generation is client-triggered and lazy-loads `@react-pdf/renderer` together with the new cut/edge document component, matching the cutting-diagram PDF import pattern so the renderer stays out of the initial app bundle. Bulk print remains out of scope for the first pass; supervisors print one cut or edge card at a time from the card detail actions.

## Count Adjustments

If the actual count differs from the expected count, a reason is required. The completion writes a `piecework_card_adjustments` audit row with the old count, new count, reason, supervisor user, and timestamp.

## Earnings Ledger

Completion writes one row per attributed staff member through `staff_piecework_earnings`. The row uses:

- `staff_id` from the supervisor attribution list
- `job_card_id` from the completed card
- `completed_quantity` from the attribution count
- `piece_rate` from `job_cards.rate_snapshot`
- `earned_amount` as `completed_quantity * piece_rate`
- `completion_date` from the actual end date
- null `item_id`, `job_id`, and `product_id` for cut and edge cards

The historical `staff_piecework_earnings` reader shape remains the payroll review source. Legacy item-based job-card earnings still appear there, while cut and edge completions are backed by explicit ledger rows.

## Reopen Policy

Completed piecework cards can be reopened by a supervisor from the job-card detail page.

Reopen is transactional. It writes negating earnings rows for the prior completion, records a `piecework_card_adjustments` row explaining the reopen, clears `job_cards.actual_count`, clears completion metadata, and returns the card and linked assignment to `in_progress`.

If payroll is already locked for any attributed staff member in the completion window, reopen is blocked.
