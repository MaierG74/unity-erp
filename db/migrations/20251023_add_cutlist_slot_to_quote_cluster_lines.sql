-- Add cutlist_slot marker to quote_cluster_lines so the cutlist export
-- route can identify and upsert only the lines created by the cutlist tool.

begin;

alter table if exists public.quote_cluster_lines
  add column if not exists cutlist_slot text check (
    cutlist_slot in ('primary', 'backer', 'band16', 'band32')
  );

-- Optional index to speed up lookups by slot when clusters get large.
create index if not exists quote_cluster_lines_cutlist_slot_idx
  on public.quote_cluster_lines (cutlist_slot)
  where cutlist_slot is not null;

comment on column public.quote_cluster_lines.cutlist_slot is 'Identifies lines managed by the cutlist calculator (primary/backer/band16/band32).';

commit;

