-- Fix save_purchase_order_draft: every UPDATE-path call throws
-- "column reference 'draft_id' is ambiguous" because the RETURNS TABLE
-- signature declares an output variable named `draft_id` (and `org_id`
-- via derived scope — actually only draft_id, but same pattern) that
-- shadows the table column inside the function body.
--
-- Repro:
--   CREATE OR REPLACE FUNCTION pg_temp.demo()
--   RETURNS TABLE(draft_id bigint)
--   LANGUAGE plpgsql AS $$
--   BEGIN UPDATE purchase_order_drafts SET notes = notes WHERE draft_id = 1; RETURN; END; $$;
--   SELECT * FROM pg_temp.demo();  -- 42702: column reference "draft_id" is ambiguous
--
-- Impact in production: the first autosave of a draft (INSERT path) succeeds,
-- but every subsequent edit (UPDATE path) throws silently in the UI. Users
-- see "only the first line survived" on refresh because no subsequent save
-- has ever reached the database.
--
-- Fix: add `#variable_conflict use_column` so unqualified `draft_id` /
-- `org_id` resolve to columns rather than the output-table variables.
-- All intentional variable references in the body are already qualified
-- (`v_draft.draft_id`, `p_draft_id`, `v_org_id`), so this is safe.

begin;

create or replace function public.save_purchase_order_draft(
  p_draft_id bigint default null,
  p_expected_version integer default null,
  p_title text default null,
  p_order_date date default null,
  p_notes text default '',
  p_lines jsonb default '[]'::jsonb
) returns table (
  draft_id bigint,
  version integer,
  updated_at timestamptz,
  updated_by uuid,
  locked_by uuid,
  locked_at timestamptz,
  status text
)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org_id uuid := public.current_org_id();
  v_user_id uuid := auth.uid();
  v_draft public.purchase_order_drafts%rowtype;
  v_lines jsonb := coalesce(p_lines, '[]'::jsonb);
begin
  if v_user_id is null then
    raise exception 'You must be signed in to save a purchase-order draft';
  end if;

  if v_org_id is null then
    raise exception 'No active organization context found for this user';
  end if;

  if jsonb_typeof(v_lines) <> 'array' then
    raise exception 'p_lines must be a JSON array';
  end if;

  if p_draft_id is null then
    insert into public.purchase_order_drafts (
      org_id,
      title,
      order_date,
      notes,
      status,
      version,
      created_by,
      updated_by,
      locked_by,
      locked_at
    )
    values (
      v_org_id,
      nullif(btrim(coalesce(p_title, '')), ''),
      p_order_date,
      coalesce(p_notes, ''),
      'draft',
      1,
      v_user_id,
      v_user_id,
      v_user_id,
      now()
    )
    returning *
    into v_draft;
  else
    select *
    into v_draft
    from public.purchase_order_drafts d
    where d.draft_id = p_draft_id
      and d.org_id = v_org_id
      and d.status = 'draft'
    for update;

    if not found then
      raise exception 'Purchase-order draft % was not found or is no longer editable', p_draft_id;
    end if;

    if p_expected_version is not null and v_draft.version <> p_expected_version then
      raise exception 'Draft version conflict. Please reload the latest draft before saving.';
    end if;

    update public.purchase_order_drafts
    set title = nullif(btrim(coalesce(p_title, '')), ''),
        order_date = p_order_date,
        notes = coalesce(p_notes, ''),
        version = v_draft.version + 1,
        updated_by = v_user_id,
        locked_by = v_user_id,
        locked_at = now()
    where draft_id = p_draft_id
      and org_id = v_org_id
    returning *
    into v_draft;

    delete from public.purchase_order_draft_lines
    where draft_id = v_draft.draft_id
      and org_id = v_org_id;
  end if;

  insert into public.purchase_order_draft_lines (
    draft_id,
    org_id,
    sort_order,
    component_id,
    supplier_component_id,
    quantity,
    customer_order_id,
    allocations,
    notes,
    created_by,
    updated_by
  )
  select
    v_draft.draft_id,
    v_org_id,
    coalesce((line.value->>'sort_order')::integer, line.ordinality::integer - 1),
    nullif((line.value->>'component_id')::integer, 0),
    nullif((line.value->>'supplier_component_id')::integer, 0),
    (line.value->>'quantity')::numeric,
    nullif((line.value->>'customer_order_id')::integer, 0),
    coalesce(line.value->'allocations', '[]'::jsonb),
    coalesce(line.value->>'notes', ''),
    v_user_id,
    v_user_id
  from jsonb_array_elements(v_lines) with ordinality as line(value, ordinality);

  return query
  select
    v_draft.draft_id,
    v_draft.version,
    v_draft.updated_at,
    v_draft.updated_by,
    v_draft.locked_by,
    v_draft.locked_at,
    v_draft.status;
end;
$$;

grant execute on function public.save_purchase_order_draft(bigint, integer, text, date, text, jsonb)
to authenticated, service_role;

commit;
