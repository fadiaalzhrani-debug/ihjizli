-- احجزلي · أرقام لوحة المدير لكل منشأة باستدعاء واحد (للمدير فقط)
begin;

create or replace function public.ihj_admin_stats()
returns table (
  business_id uuid, orders_month int, orders_total int, sim_orders int, last_order_at timestamptz,
  services int, cities int, staff int, hours int, open_handoffs int, paid_month numeric, links_owner int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ihj_is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
  select b.id,
    (select count(*)::int from public.orders o where o.business_id = b.id and o.created_at >= date_trunc('month', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh' and not o.is_test),
    (select count(*)::int from public.orders o where o.business_id = b.id and not o.is_test),
    (select count(*)::int from public.orders o where o.business_id = b.id and o.channel = 'sim'),
    (select max(o.created_at) from public.orders o where o.business_id = b.id),
    (select count(*)::int from public.services s where s.business_id = b.id and s.active),
    (select count(*)::int from public.cities c where c.business_id = b.id and c.active),
    (select count(*)::int from public.staff s where s.business_id = b.id and s.active),
    (select count(*)::int from public.hours h where h.business_id = b.id),
    (select count(*)::int from public.handoffs h where h.business_id = b.id and h.resolved_at is null),
    coalesce((select sum(i.total) from public.invoices i where i.business_id = b.id and i.status = 'paid' and i.paid_at >= date_trunc('month', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh'), 0),
    (select count(*)::int from public.access_links l where l.business_id = b.id and l.kind = 'owner' and l.revoked_at is null)
  from public.businesses b;
end $$;
revoke all on function public.ihj_admin_stats() from public, anon;
grant execute on function public.ihj_admin_stats() to authenticated;

commit;
