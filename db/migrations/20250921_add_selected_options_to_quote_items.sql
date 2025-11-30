alter table public.quote_items
  add column if not exists selected_options jsonb;

comment on column public.quote_items.selected_options is 'Option selections captured when a product line is added; keyed by option group code.';
