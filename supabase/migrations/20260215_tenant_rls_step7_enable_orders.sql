-- Tenant RLS rollout Step 7: enable RLS on orders after policy prep.

alter table public.orders enable row level security;
