# Production Exceptions

Production exceptions are operational records that stay visible until a user acknowledges or resolves them. They are not deleted during normal workflow.

## Work Pool Exceptions

`job_work_pool_exceptions` tracks over-issued or stale work-pool demand:

- `over_issued_override`
- `over_issued_after_reconcile`

Operators acknowledge or resolve these from the Production exceptions queue. Resolution choices are tied to cancelling unstarted cards, moving excess to stock, or accepting overproduction/rework.

## BOM Swap Exceptions

`bom_swap_exceptions` tracks order-side BOM swaps that happen after downstream activity has already started. The current type is:

- `bom_swapped_after_downstream_event`

The exception is created automatically when an order-side swap detects at least one of these downstream sources:

- outstanding supplier orders for the source component
- cutting-plan work-pool rows for the order
- issued job-card items for the order
- dispatched or shipped order status

Quote-side swaps never create production exceptions.

## BOM Swap Resolution

BOM swap exceptions support these resolution paths:

- `accept_swap_no_action`
- `cancel_or_amend_po`
- `return_old_stock_to_inventory`
- `accept_swap_with_rework`

The Production exceptions queue shows BOM swap exceptions separately from work-pool exceptions with a yellow BOM-swap treatment. Resolving an exception updates `bom_swap_exceptions.status` to `resolved` and appends a `resolved` row to `bom_swap_exception_activity`.

## Safety Notes

The BOM swap write path writes only `bom_swap_exceptions` and `bom_swap_exception_activity`. It does not write wage, payroll, staff-hour, or piecework earnings tables.
