-- Server-side counters for dashboard + purchasing pages.
-- These replace client-side "fetch every row then count in JS" patterns so the
-- browser receives a number instead of the whole table (memory budget on the
-- low-spec machines operators run). All four are SECURITY INVOKER so RLS scopes
-- counts per-org via organization_members; search_path is pinned to avoid the
-- function_search_path_mutable advisor. Logic mirrors the JS call-sites exactly.

-- #1 DashboardKPICards.fetchKPIData -> openPOs (mirrors isOpenPurchaseOrder).
-- Open = status not Completed(3)/Cancelled(4)/Fully Received(9) (null status_id
-- coerces to 0 in JS, i.e. "not closed") AND (no supplier_order lines OR some
-- line has order_quantity - total_received - closed_quantity > 0, strict > 0).
create or replace function public.get_open_purchase_order_count()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::int
  from public.purchase_orders po
  where coalesce(po.status_id, 0) not in (3, 4, 9)
    and (
      not exists (
        select 1 from public.supplier_orders so
        where so.purchase_order_id = po.purchase_order_id
      )
      or exists (
        select 1 from public.supplier_orders so
        where so.purchase_order_id = po.purchase_order_id
          and coalesce(so.order_quantity, 0)
            - coalesce(so.total_received, 0)
            - coalesce(so.closed_quantity, 0) > 0
      )
    );
$$;

-- #2 purchasing/page.tsx metrics (pending / approved / partialReceived).
-- pending  = POs with status Draft(5) or Pending Approval(6).
-- approved = POs with status Approved(7) or Partially Received(8) that are NOT
--            fully received (fully received = has >=1 line AND every line has
--            remaining <= epsilon, where remaining uses the purchasing-quantities
--            helper: round(greatest(o-r-c,0),6) > 1e-6).
-- partial_received = subset of approved where some line has total_received > 1e-6.
-- NOTE: the status IDs below (Draft 5, Pending Approval 6, Approved 7,
-- Partially Received 8) are load-bearing and must stay in lockstep with
-- SO_STATUS in types/purchasing.ts and the supplier_order_statuses seed data.
create or replace function public.get_purchasing_metrics()
returns table(pending integer, approved integer, partial_received integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with po_class as (
    select
      po.status_id,
      coalesce(agg.n_lines, 0)       as n_lines,
      coalesce(agg.n_outstanding, 0) as n_outstanding,
      coalesce(agg.n_received, 0)    as n_received
    from public.purchase_orders po
    left join lateral (
      select
        count(*) as n_lines,
        count(*) filter (
          where round(greatest(
            coalesce(so.order_quantity, 0)
            - coalesce(so.total_received, 0)
            - coalesce(so.closed_quantity, 0), 0), 6) > 0.000001
        ) as n_outstanding,
        count(*) filter (
          where coalesce(so.total_received, 0) > 0.000001
        ) as n_received
      from public.supplier_orders so
      where so.purchase_order_id = po.purchase_order_id
    ) agg on true
    where po.status_id in (5, 6, 7, 8)
  )
  select
    count(*) filter (where status_id in (5, 6))::int as pending,
    count(*) filter (
      where status_id in (7, 8)
        and not (n_lines > 0 and n_outstanding = 0)
    )::int as approved,
    count(*) filter (
      where status_id in (7, 8)
        and not (n_lines > 0 and n_outstanding = 0)
        and n_received > 0
    )::int as partial_received
  from po_class;
$$;

-- #3 DashboardCharts.OrderStatusDonut: grouped count by status_id. Returns raw
-- status_id (incl. NULL / unmapped) + count; the client keeps its own
-- STATUS_ID_LABELS mapping (status 9 = "Received" label, NULL -> "Unknown").
create or replace function public.get_purchase_order_status_counts()
returns table(status_id integer, count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select po.status_id, count(*)::int as count
  from public.purchase_orders po
  group by po.status_id;
$$;

-- #4 orders/page.tsx fetchProcurementSummaries: per customer order, count linked
-- supplier-order lines and how many are fully received. INNER JOIN mirrors the
-- JS `if (so)` guard (junction rows with no linked supplier_order are skipped);
-- fully received = total_received >= order_quantity (null coerced to 0).
create or replace function public.get_procurement_summaries()
returns table(customer_order_id integer, total_po_lines integer, fully_received_lines integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    soco.order_id as customer_order_id,
    count(*)::int as total_po_lines,
    count(*) filter (
      where coalesce(so.total_received, 0) >= coalesce(so.order_quantity, 0)
    )::int as fully_received_lines
  from public.supplier_order_customer_orders soco
  join public.supplier_orders so on so.order_id = soco.supplier_order_id
  where soco.order_id is not null
  group by soco.order_id;
$$;
