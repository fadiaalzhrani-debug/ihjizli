-- احجزلي · المواعيد والحجز والتقرير
-- المواعيد المتاحة تُحسب من أوقات العمل والعطل ومدة الموعد والموظفين المتاحين في المدينة (أو سعة ثابتة)،
-- والحجز وتغيير الموعد يقفلان المنشأة لحظيًا عشان ما ينحجز نفس الوقت مرتين.
begin;

create or replace function public.ihj_free_slots(
  p_business uuid, p_city uuid, p_service uuid, p_from date, p_days int, p_exclude uuid default null)
returns table (slot_start timestamptz, slot_end timestamptz, free int)
language plpgsql stable security definer set search_path = public as $$
declare
  s public.settings;
  v_tz text;
  v_step int;
  v_dur int;
  v_buf interval;
  v_min timestamptz;
  v_staff_mode boolean;
begin
  select * into s from public.settings where business_id = p_business;
  if not found then return; end if;
  select b.timezone into v_tz from public.businesses b where b.id = p_business;
  v_tz := coalesce(v_tz, 'Asia/Riyadh');
  v_step := s.slot_minutes;
  v_dur := coalesce((select sv.duration_min from public.services sv where sv.id = p_service and sv.business_id = p_business), v_step);
  v_buf := make_interval(mins => s.buffer_minutes);
  v_min := now() + make_interval(mins => s.lead_minutes);
  v_staff_mode := s.capacity_mode = 'staff' and exists (
    select 1 from public.staff st where st.business_id = p_business and st.active
      and (p_city is null or cardinality(st.city_ids) = 0 or p_city = any (st.city_ids)));

  return query
  with d as (
    select (p_from + g)::date as day from generate_series(0, greatest(p_days, 1) - 1) g
  ), w as (
    select (d.day + h.open_time) as o,
           (d.day + h.close_time + case when h.close_time <= h.open_time then interval '1 day' else interval '0' end) as c
    from d
    join public.hours h on h.business_id = p_business and h.weekday = extract(dow from d.day)::int
      and (h.city_id is null or h.city_id is not distinct from p_city)
    where not exists (select 1 from public.holidays ho where ho.business_id = p_business and ho.day = d.day
                        and (ho.city_id is null or ho.city_id is not distinct from p_city))
  ), c as (
    select distinct (w.o + make_interval(mins => v_step * k)) as ls
    from w cross join generate_series(0, 287) k
    where w.o + make_interval(mins => v_step * k + v_dur) <= w.c
  ), t as (
    select (c.ls at time zone v_tz) as st, ((c.ls at time zone v_tz) + make_interval(mins => v_dur)) as en from c
  ), f as (
    select t.st, t.en,
      case when v_staff_mode then (
        select count(*)::int from public.staff st
        where st.business_id = p_business and st.active
          and (p_city is null or cardinality(st.city_ids) = 0 or p_city = any (st.city_ids))
          and not exists (select 1 from public.orders o
                          where o.staff_id = st.id and o.status <> 'cancelled'
                            and (p_exclude is null or o.id <> p_exclude)
                            and o.slot_start < t.en + v_buf and o.slot_end + v_buf > t.st))
      else
        s.capacity_per_slot - (select count(*)::int from public.orders o
                               where o.business_id = p_business and o.status <> 'cancelled'
                                 and (p_exclude is null or o.id <> p_exclude)
                                 and o.slot_start < t.en and o.slot_end > t.st)
      end as fr
    from t
    where t.st >= v_min
  )
  select f.st, f.en, f.fr from f where f.fr > 0 order by f.st;
end $$;

-- أنسب موظف للموعد: يغطي المدينة، فاضي، وأقل طلبات في ذاك اليوم
create or replace function public.ihj_pick_staff(p_business uuid, p_city uuid, p_start timestamptz, p_end timestamptz, p_exclude uuid default null)
returns uuid language sql stable security definer set search_path = public as $$
  with s as (select buffer_minutes, (select timezone from public.businesses where id = p_business) tz from public.settings where business_id = p_business)
  select st.id from public.staff st, s
  where st.business_id = p_business and st.active
    and (p_city is null or cardinality(st.city_ids) = 0 or p_city = any (st.city_ids))
    and not exists (select 1 from public.orders o where o.staff_id = st.id and o.status <> 'cancelled'
                      and (p_exclude is null or o.id <> p_exclude)
                      and o.slot_start < p_end + make_interval(mins => s.buffer_minutes)
                      and o.slot_end + make_interval(mins => s.buffer_minutes) > p_start)
  order by (select count(*) from public.orders o2 where o2.staff_id = st.id and o2.status <> 'cancelled'
              and (o2.slot_start at time zone s.tz)::date = (p_start at time zone s.tz)::date),
           (select max(o3.created_at) from public.orders o3 where o3.staff_id = st.id) nulls first
  limit 1
$$;

create or replace function public.ihj_next_number(p_business uuid, p_kind text, p_start int)
returns int language sql volatile security definer set search_path = public as $$
  insert into public.counters (business_id, kind, last) values (p_business, p_kind, p_start)
  on conflict (business_id, kind) do update set last = public.counters.last + 1
  returning last
$$;

create or replace function public.ihj_book(
  p_business uuid, p_customer uuid, p_city uuid, p_service uuid, p_start timestamptz,
  p_lat double precision, p_lng double precision, p_maps_url text, p_address text, p_channel text, p_notes text default '')
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_tz text; v_end timestamptz; v_staff uuid; v_no int; v_price numeric; v_o public.orders; v_mode text;
begin
  perform pg_advisory_xact_lock(hashtextextended('ihj_book:' || p_business::text, 0));
  select timezone into v_tz from public.businesses where id = p_business;
  select f.slot_end into v_end
    from public.ihj_free_slots(p_business, p_city, p_service, (p_start at time zone v_tz)::date, 1) f
   where f.slot_start = p_start;
  if v_end is null then raise exception 'slot_taken' using errcode = 'P0001'; end if;
  select capacity_mode into v_mode from public.settings where business_id = p_business;
  if v_mode = 'staff' then v_staff := public.ihj_pick_staff(p_business, p_city, p_start, v_end); end if;
  v_no := public.ihj_next_number(p_business, 'order', 1001);
  select price into v_price from public.services where id = p_service and business_id = p_business;
  insert into public.orders (business_id, number, customer_id, service_id, city_id, staff_id, status, slot_start, slot_end,
                             lat, lng, maps_url, address, price, notes, channel, is_test)
  values (p_business, v_no, p_customer, p_service, p_city, v_staff, 'confirmed', p_start, v_end,
          p_lat, p_lng, coalesce(p_maps_url, ''), coalesce(p_address, ''), v_price, coalesce(p_notes, ''),
          coalesce(p_channel, 'wa'), coalesce(p_channel, 'wa') = 'sim')
  returning * into v_o;
  insert into public.order_events (business_id, order_id, kind, data, by_who)
  values (p_business, v_o.id, 'created', jsonb_build_object('staff_id', v_staff, 'slot', p_start), 'bot');
  if v_staff is not null then
    insert into public.order_events (business_id, order_id, kind, data, by_who)
    values (p_business, v_o.id, 'assigned', jsonb_build_object('staff_id', v_staff), 'system');
  end if;
  return v_o;
end $$;

create or replace function public.ihj_reschedule(p_order uuid, p_start timestamptz, p_by text default 'bot')
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  o public.orders; v_tz text; v_end timestamptz; v_staff uuid; v_mode text; v_buf int;
begin
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ihj_book:' || o.business_id::text, 0));
  select * into o from public.orders where id = p_order for update;
  if o.status <> 'confirmed' then raise exception 'locked' using errcode = 'P0001'; end if;
  select timezone into v_tz from public.businesses where id = o.business_id;
  select f.slot_end into v_end
    from public.ihj_free_slots(o.business_id, o.city_id, o.service_id, (p_start at time zone v_tz)::date, 1, o.id) f
   where f.slot_start = p_start;
  if v_end is null then raise exception 'slot_taken' using errcode = 'P0001'; end if;
  select capacity_mode, buffer_minutes into v_mode, v_buf from public.settings where business_id = o.business_id;
  v_staff := o.staff_id;
  if v_mode = 'staff' then
    if v_staff is null or exists (select 1 from public.orders x where x.staff_id = v_staff and x.id <> o.id and x.status <> 'cancelled'
                                    and x.slot_start < v_end + make_interval(mins => v_buf)
                                    and x.slot_end + make_interval(mins => v_buf) > p_start) then
      v_staff := public.ihj_pick_staff(o.business_id, o.city_id, p_start, v_end, o.id);
    end if;
  end if;
  update public.orders set slot_start = p_start, slot_end = v_end, staff_id = v_staff, reminded_at = null
   where id = o.id returning * into o;
  insert into public.order_events (business_id, order_id, kind, data, by_who)
  values (o.business_id, o.id, 'rescheduled', jsonb_build_object('slot', p_start, 'staff_id', v_staff), p_by);
  return o;
end $$;

create or replace function public.ihj_cancel(p_order uuid, p_by text, p_reason text default '')
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  update public.orders set status = 'cancelled', cancelled_at = now(), cancelled_by = coalesce(p_by, ''), cancel_reason = coalesce(p_reason, '')
   where id = p_order and status in ('confirmed', 'on_the_way')
  returning * into o;
  if not found then raise exception 'locked' using errcode = 'P0001'; end if;
  insert into public.order_events (business_id, order_id, kind, data, by_who)
  values (o.business_id, o.id, 'cancelled', jsonb_build_object('reason', p_reason), p_by);
  return o;
end $$;

-- سياق رسالة البوت في استدعاء واحد: المنشأة والإعدادات والعميل (ينشأ لو جديد) والخدمات والمدن
create or replace function public.ihj_ctx(p_business uuid, p_wa_id text, p_is_sim boolean, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.customers;
begin
  insert into public.customers (business_id, wa_id, is_sim, name)
  values (p_business, p_wa_id, coalesce(p_is_sim, false), coalesce(p_name, ''))
  on conflict (business_id, wa_id) do update
    set name = case when coalesce(excluded.name, '') <> '' then excluded.name else public.customers.name end
  returning * into c;
  return jsonb_build_object(
    'business', (select to_jsonb(b) - 'sim_key' from public.businesses b where b.id = p_business),
    'settings', (select to_jsonb(s) from public.settings s where s.business_id = p_business),
    'customer', to_jsonb(c),
    'services', coalesce((select jsonb_agg(to_jsonb(x) order by x.sort, x.created_at) from public.services x where x.business_id = p_business and x.active), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(to_jsonb(x) order by x.sort, x.created_at) from public.cities x where x.business_id = p_business and x.active), '[]'::jsonb),
    'hours', coalesce((select jsonb_agg(to_jsonb(x) order by x.weekday, x.open_time) from public.hours x where x.business_id = p_business), '[]'::jsonb),
    'channel', (select to_jsonb(ch) - 'templates' from public.channels ch where ch.business_id = p_business)
  );
end $$;

-- التقرير الشهري للمنشأة
create or replace function public.ihj_report(p_business uuid, p_month date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_tz text; v_from timestamptz; v_to timestamptz; v_demo boolean; r jsonb;
begin
  if not public.ihj_is_owner(p_business) and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select timezone, is_demo into v_tz, v_demo from public.businesses where id = p_business;
  v_from := (date_trunc('month', p_month)::timestamp) at time zone v_tz;
  v_to := ((date_trunc('month', p_month) + interval '1 month')::timestamp) at time zone v_tz;
  with o as (
    select * from public.orders
    where business_id = p_business and slot_start >= v_from and slot_start < v_to and (v_demo or not is_test)
  ), inv as (
    select i.* from public.invoices i join o on o.id = i.order_id where i.status <> 'void'
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to,
    'orders', (select count(*) from o),
    'done', (select count(*) from o where status = 'done'),
    'cancelled', (select count(*) from o where status = 'cancelled'),
    'open', (select count(*) from o where status in ('confirmed','on_the_way','arrived','invoiced')),
    'invoiced_total', coalesce((select sum(total) from inv), 0),
    'paid_total', coalesce((select sum(total) from inv where status = 'paid'), 0),
    'unpaid_total', coalesce((select sum(total) from inv where status = 'issued'), 0),
    'customers', (select count(distinct customer_id) from o),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'n', n) order by d) from (
        select (slot_start at time zone v_tz)::date d, count(*) n from o where status <> 'cancelled' group by 1) x), '[]'::jsonb),
    'by_staff', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(st.name, 'غير مسند'), 'n', x.n, 'done', x.done) order by x.n desc) from (
        select staff_id, count(*) n, count(*) filter (where status = 'done') done from o where status <> 'cancelled' group by 1) x
        left join public.staff st on st.id = x.staff_id), '[]'::jsonb),
    'by_city', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(ci.name, 'غير محدد'), 'n', x.n) order by x.n desc) from (
        select city_id, count(*) n from o where status <> 'cancelled' group by 1) x
        left join public.cities ci on ci.id = x.city_id), '[]'::jsonb),
    'by_service', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(sv.name, 'غير محدد'), 'n', x.n) order by x.n desc) from (
        select service_id, count(*) n from o where status <> 'cancelled' group by 1) x
        left join public.services sv on sv.id = x.service_id), '[]'::jsonb),
    'by_hour', coalesce((select jsonb_agg(jsonb_build_object('h', h, 'n', n) order by h) from (
        select extract(hour from slot_start at time zone v_tz)::int h, count(*) n from o where status <> 'cancelled' group by 1) x), '[]'::jsonb)
  ) into r;
  return r;
end $$;

revoke all on function public.ihj_free_slots(uuid, uuid, uuid, date, int, uuid) from public, anon, authenticated;
revoke all on function public.ihj_pick_staff(uuid, uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.ihj_next_number(uuid, text, int) from public, anon, authenticated;
revoke all on function public.ihj_book(uuid, uuid, uuid, uuid, timestamptz, double precision, double precision, text, text, text, text) from public, anon, authenticated;
revoke all on function public.ihj_reschedule(uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.ihj_cancel(uuid, text, text) from public, anon, authenticated;
revoke all on function public.ihj_ctx(uuid, text, boolean, text) from public, anon, authenticated;
revoke all on function public.ihj_report(uuid, date) from public, anon;
grant execute on function public.ihj_report(uuid, date) to authenticated;
grant execute on all functions in schema public to service_role;

commit;
