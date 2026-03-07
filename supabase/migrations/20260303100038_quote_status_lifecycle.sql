begin;

update public.quotes as q
set status = case
  when exists (
    select 1
    from public.orders o
    where o.quote_id = q.id
  ) then 'ordered'
  when q.status in ('sent', 'accepted', 'rejected', 'expired', 'won', 'lost') then 'sent'
  else 'draft'
end
where q.status not in ('draft', 'sent', 'ordered')
   or exists (
     select 1
     from public.orders o
     where o.quote_id = q.id
       and q.status <> 'ordered'
   );

alter table public.quotes
drop constraint if exists quotes_status_check;

alter table public.quotes
add constraint quotes_status_check
check (status in ('draft', 'sent', 'ordered'));

commit;
