-- Tenant RLS rollout Step 8: enable RLS on order_details after policy prep.

alter table public.order_details enable row level security;
