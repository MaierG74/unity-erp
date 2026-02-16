-- Tenant RLS rollout Step 9b (baby step): remove broad inventory_transactions policy.

begin;

drop policy if exists authenticated_users_all_access on public.inventory_transactions;

commit;

