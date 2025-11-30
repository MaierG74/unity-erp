-- Create product_bom_links table for Attach (Phase A)
create table if not exists public.product_bom_links (
  product_id int not null references public.products(product_id) on delete cascade,
  sub_product_id int not null references public.products(product_id) on delete cascade,
  scale numeric not null default 1,
  mode text not null default 'phantom',
  created_at timestamptz not null default now(),
  constraint product_bom_links_pkey primary key (product_id, sub_product_id),
  constraint product_bom_links_mode_check check (mode in ('phantom'))
);

create index if not exists idx_product_bom_links_sub_product on public.product_bom_links(sub_product_id);

comment on table public.product_bom_links is 'Links parent product to sub-product BOM for dynamic explosion (Attach mode).';
comment on column public.product_bom_links.scale is 'Scale factor applied to sub-product BOM quantities.';
comment on column public.product_bom_links.mode is 'Attach behavior: phantom only in Phase A.';

