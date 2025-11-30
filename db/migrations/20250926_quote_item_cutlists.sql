-- Creates quote_item_cutlists table to persist cutlist snapshots per quote item.
-- Uses updated_at trigger for automatic timestamp maintenance.

begin;

create table if not exists public.quote_item_cutlists (
    id uuid primary key default gen_random_uuid(),
    quote_item_id uuid not null references public.quote_items(id) on delete cascade,
    options_hash text,
    layout_json jsonb not null,
    billing_overrides jsonb,
    created_by uuid references public.profiles(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists quote_item_cutlists_quote_item_id_idx
    on public.quote_item_cutlists (quote_item_id);

create unique index if not exists quote_item_cutlists_quote_item_id_key
    on public.quote_item_cutlists (quote_item_id);

do $$ begin
    if exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where p.proname = 'set_updated_at'
          and n.nspname = 'public'
    ) then
        create or replace trigger trg_quote_item_cutlists_updated
            before update on public.quote_item_cutlists
            for each row execute function public.set_updated_at();
    end if;
end $$;

commit;

