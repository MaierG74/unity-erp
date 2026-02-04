-- Allow dynamic cutlist slots (edging_*, primary_*, backer_*) in quote_cluster_lines.cutlist_slot

begin;

alter table if exists public.quote_cluster_lines
  drop constraint if exists quote_cluster_lines_cutlist_slot_check;

alter table if exists public.quote_cluster_lines
  add constraint quote_cluster_lines_cutlist_slot_check check (
    cutlist_slot in ('primary', 'backer', 'band16', 'band32')
    or cutlist_slot like 'edging_%'
    or cutlist_slot like 'primary_%'
    or cutlist_slot like 'backer_%'
  );

comment on column public.quote_cluster_lines.cutlist_slot is 'Identifies lines managed by the cutlist calculator (primary/backer/band16/band32/edging_*/primary_*/backer_*).';

commit;
