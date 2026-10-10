-- احجزلي · إصلاحات التشغيل بعد التدقيق الكامل (2026-10-10):
--  · تجارب المحاكي في منشأة حقيقية ما تحجز مواعيد ولا موظفين (في المنشآت التجريبية تبقى مثل ما هي)
--  · توثيق ميتا ينحفظ من لوحة المدير (كان التحديث يرجع بدون خطأ وبدون ما يتغير شي)
--  · تطبيق بيانات العميل ما يفعّل «الدفع قبل الحجز» إلا لباقة الدفع
--  · تنبيهات المالك شغّالة افتراضيًا، والمدير يوصله تنبيه لما العميل يوافق أو يعبّي النموذج
--  · إحصاءات المدير فيها آخر رسالة حقيقية وصلت (تثبت إن الربط يستقبل فعلًا)
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
  v_demo boolean;
begin
  select * into s from public.settings where business_id = p_business;
  if not found then return; end if;
  select b.timezone, b.is_demo into v_tz, v_demo from public.businesses b where b.id = p_business;
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
                          where o.staff_id = st.id and o.status <> 'cancelled' and (v_demo or not o.is_test)
                            and (p_exclude is null or o.id <> p_exclude)
                            and o.slot_start < t.en + v_buf and o.slot_end + v_buf > t.st))
      else
        s.capacity_per_slot - (select count(*)::int from public.orders o
                               where o.business_id = p_business and o.status <> 'cancelled' and (v_demo or not o.is_test)
                                 and (p_exclude is null or o.id <> p_exclude)
                                 and o.slot_start < t.en and o.slot_end > t.st)
      end as fr
    from t
    where t.st >= v_min
  )
  select f.st, f.en, f.fr from f where f.fr > 0 order by f.st;
end $$;

create or replace function public.ihj_pick_staff(p_business uuid, p_city uuid, p_start timestamptz, p_end timestamptz, p_exclude uuid default null)
returns uuid language sql stable security definer set search_path = public as $$
  with s as (select buffer_minutes, (select timezone from public.businesses where id = p_business) tz, (select is_demo from public.businesses where id = p_business) demo from public.settings where business_id = p_business)
  select st.id from public.staff st, s
  where st.business_id = p_business and st.active
    and (p_city is null or cardinality(st.city_ids) = 0 or p_city = any (st.city_ids))
    and not exists (select 1 from public.orders o where o.staff_id = st.id and o.status <> 'cancelled' and (s.demo or not o.is_test)
                      and (p_exclude is null or o.id <> p_exclude)
                      and o.slot_start < p_end + make_interval(mins => s.buffer_minutes)
                      and o.slot_end + make_interval(mins => s.buffer_minutes) > p_start)
  order by (select count(*) from public.orders o2 where o2.staff_id = st.id and o2.status <> 'cancelled'
              and (o2.slot_start at time zone s.tz)::date = (p_start at time zone s.tz)::date),
           (select max(o3.created_at) from public.orders o3 where o3.staff_id = st.id) nulls first
  limit 1
$$;

create or replace function public.ihj_book(
  p_business uuid, p_customer uuid, p_city uuid, p_service uuid, p_start timestamptz,
  p_lat double precision, p_lng double precision, p_maps_url text, p_address text, p_channel text, p_notes text default '',
  p_status text default 'confirmed', p_hold_until timestamptz default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_tz text; v_end timestamptz; v_staff uuid; v_no int; v_price numeric; v_o public.orders; v_mode text; v_demo boolean;
begin
  if p_status not in ('confirmed', 'pending_payment') then raise exception 'bad_status' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ihj_book:' || p_business::text, 0));
  select timezone, is_demo into v_tz, v_demo from public.businesses where id = p_business;
  select f.slot_end into v_end
    from public.ihj_free_slots(p_business, p_city, p_service, (p_start at time zone v_tz)::date, 1) f
   where f.slot_start = p_start;
  if v_end is null then raise exception 'slot_taken' using errcode = 'P0001'; end if;
  select capacity_mode into v_mode from public.settings where business_id = p_business;
  -- تجربة المحاكي في منشأة حقيقية ما تنسند لموظف (ما توصله ولا تشغله)
  if v_mode = 'staff' and (v_demo or coalesce(p_channel, 'wa') <> 'sim') then v_staff := public.ihj_pick_staff(p_business, p_city, p_start, v_end); end if;
  v_no := public.ihj_next_number(p_business, 'order', 1001);
  select price into v_price from public.services where id = p_service and business_id = p_business;
  insert into public.orders (business_id, number, customer_id, service_id, city_id, staff_id, status, slot_start, slot_end,
                             lat, lng, maps_url, address, price, notes, channel, is_test, hold_until)
  values (p_business, v_no, p_customer, p_service, p_city, v_staff, p_status, p_start, v_end,
          p_lat, p_lng, coalesce(p_maps_url, ''), coalesce(p_address, ''), v_price, coalesce(p_notes, ''),
          coalesce(p_channel, 'wa'), coalesce(p_channel, 'wa') = 'sim', case when p_status = 'pending_payment' then p_hold_until end)
  returning * into v_o;
  insert into public.order_events (business_id, order_id, kind, data, by_who)
  values (p_business, v_o.id, case when p_status = 'pending_payment' then 'held' else 'created' end, jsonb_build_object('staff_id', v_staff, 'slot', p_start), 'bot');
  if v_staff is not null then
    insert into public.order_events (business_id, order_id, kind, data, by_who)
    values (p_business, v_o.id, 'assigned', jsonb_build_object('staff_id', v_staff), 'system');
  end if;
  return v_o;
end $$;

create or replace function public.ihj_reschedule(p_order uuid, p_start timestamptz, p_by text default 'bot')
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  o public.orders; v_tz text; v_end timestamptz; v_staff uuid; v_mode text; v_buf int; v_demo boolean;
begin
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ihj_book:' || o.business_id::text, 0));
  select * into o from public.orders where id = p_order for update;
  if o.status <> 'confirmed' then raise exception 'locked' using errcode = 'P0001'; end if;
  select timezone, is_demo into v_tz, v_demo from public.businesses where id = o.business_id;
  select f.slot_end into v_end
    from public.ihj_free_slots(o.business_id, o.city_id, o.service_id, (p_start at time zone v_tz)::date, 1, o.id) f
   where f.slot_start = p_start;
  if v_end is null then raise exception 'slot_taken' using errcode = 'P0001'; end if;
  select capacity_mode, buffer_minutes into v_mode, v_buf from public.settings where business_id = o.business_id;
  v_staff := o.staff_id;
  if v_mode = 'staff' and (v_demo or not o.is_test) then
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

create or replace function public.ihj_apply_intake(p_business uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d jsonb; x jsonb; v_ids uuid[]; i int := 0; v_names text[]; v_id uuid;
begin
  if not public.ihj_is_admin() and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select intake into d from public.client_docs where business_id = p_business;
  if d is null or d = '{}'::jsonb then raise exception 'no_intake' using errcode = 'P0001'; end if;

  update public.businesses set
    name = coalesce(nullif(trim(d->>'name'), ''), name),
    name_en = coalesce(nullif(trim(d->>'name_en'), ''), name_en),
    activity = coalesce(nullif(trim(d->>'activity'), ''), activity),
    cr_number = coalesce(nullif(trim(d->>'cr_number'), ''), cr_number),
    vat_number = coalesce(nullif(trim(d->>'vat_number'), ''), vat_number),
    address = coalesce(nullif(trim(d->>'address'), ''), address),
    logo_url = coalesce(nullif(d->>'logo_url', ''), logo_url),
    owner_name = coalesce(nullif(trim(d->>'owner_name'), ''), owner_name),
    owner_phone = coalesce(nullif(d->>'owner_phone', ''), owner_phone),
    wa_number = coalesce(nullif(d->>'wa_number', ''), wa_number)
  where id = p_business;

  update public.settings set
    place_mode = case when d->>'place_mode' in ('visit','shop','online') then d->>'place_mode' else place_mode end,
    pay_timing = case when d->>'pay_timing' in ('after','none') then d->>'pay_timing'
                      when d->>'pay_timing' = 'before' and exists (select 1 from public.businesses x where x.id = p_business and (x.plan = 'bot_pay' or x.is_demo)) then 'before'
                      else pay_timing end
  where business_id = p_business;

  -- الخدمات: نفس الاسم يتحدّث، الجديد ينضاف، والباقي يتوقف (ما ننحذف عشان الطلبات القديمة)
  if jsonb_array_length(coalesce(d->'services', '[]'::jsonb)) > 0 then
    v_names := array(select left(trim(e->>'name'), 24) from jsonb_array_elements(d->'services') e where coalesce(trim(e->>'name'), '') <> '');
    update public.services set active = false where business_id = p_business and not (name = any (v_names));
    i := 0;
    for x in select * from jsonb_array_elements(d->'services') loop
      if coalesce(trim(x->>'name'), '') = '' then continue; end if;
      select id into v_id from public.services where business_id = p_business and name = left(trim(x->>'name'), 24) limit 1;
      if v_id is null then
        insert into public.services (business_id, name, price, duration_min, sort)
        values (p_business, left(trim(x->>'name'), 24), nullif(x->>'price', '')::numeric, nullif(x->>'duration_min', '')::int, i);
      else
        update public.services set price = nullif(x->>'price', '')::numeric, duration_min = coalesce(nullif(x->>'duration_min', '')::int, duration_min), active = true, sort = i where id = v_id;
      end if;
      v_id := null; i := i + 1;
    end loop;
  end if;

  -- المدن أو الفروع بنفس الطريقة
  if jsonb_array_length(coalesce(d->'cities', '[]'::jsonb)) > 0 then
    v_names := array(select left(trim(e->>'name'), 40) from jsonb_array_elements(d->'cities') e where coalesce(trim(e->>'name'), '') <> '');
    update public.cities set active = false where business_id = p_business and not (name = any (v_names));
    i := 0;
    for x in select * from jsonb_array_elements(d->'cities') loop
      if coalesce(trim(x->>'name'), '') = '' or (x->>'lat') is null then continue; end if;
      select id into v_id from public.cities where business_id = p_business and name = left(trim(x->>'name'), 40) limit 1;
      if v_id is null then
        insert into public.cities (business_id, name, lat, lng, radius_km, sort)
        values (p_business, left(trim(x->>'name'), 40), (x->>'lat')::float8, (x->>'lng')::float8, coalesce((x->>'radius_km')::numeric, 25), i);
      else
        update public.cities set lat = (x->>'lat')::float8, lng = (x->>'lng')::float8, radius_km = coalesce((x->>'radius_km')::numeric, radius_km), active = true, sort = i where id = v_id;
      end if;
      v_id := null; i := i + 1;
    end loop;
  end if;

  if jsonb_array_length(coalesce(d->'hours', '[]'::jsonb)) > 0 then
    delete from public.hours where business_id = p_business and city_id is null;
    insert into public.hours (business_id, weekday, open_time, close_time)
    select p_business, (h->>'weekday')::smallint, (h->>'open')::time, (h->>'close')::time from jsonb_array_elements(d->'hours') h
     where (h->>'weekday') ~ '^[0-6]$' and (h->>'open') ~ '^\d{2}:\d{2}$' and (h->>'close') ~ '^\d{2}:\d{2}$';
  end if;

  for x in select * from jsonb_array_elements(coalesce(d->'staff', '[]'::jsonb)) loop
    if coalesce(trim(x->>'name'), '') = '' then continue; end if;
    select coalesce(array_agg(c.id), '{}') into v_ids from public.cities c
     where c.business_id = p_business and c.active and c.name in (select jsonb_array_elements_text(coalesce(x->'cities', '[]'::jsonb)));
    if exists (select 1 from public.staff where business_id = p_business and name = left(trim(x->>'name'), 40)) then
      update public.staff set phone = coalesce(nullif(x->>'phone', ''), phone), city_ids = v_ids, active = true where business_id = p_business and name = left(trim(x->>'name'), 40);
    else
      insert into public.staff (business_id, name, phone, city_ids) values (p_business, left(trim(x->>'name'), 40), coalesce(x->>'phone', ''), v_ids);
    end if;
  end loop;

  update public.client_docs set intake_applied_at = now() where business_id = p_business;
  return jsonb_build_object('ok', true);
end $$;

-- توثيق ميتا: المدير يحدّث حالته من لوحته
grant update (meta_verification) on public.channels to authenticated;
drop policy if exists p_channels_admin_upd on public.channels;
create policy p_channels_admin_upd on public.channels for update to authenticated using (public.ihj_is_admin()) with check (public.ihj_is_admin());

-- تنبيهات المالك (طلب جديد، عميل يحتاج رد) شغّالة افتراضيًا للمنشآت الجديدة
alter table public.settings alter column notify_owner set default true;
update public.settings s set notify_owner = true from public.businesses b where b.id = s.business_id and not b.is_demo and not s.notify_owner;

-- لوحة المدير تسمع موافقات العملاء ونماذجهم لحظيًا
do $$ begin
  alter publication supabase_realtime add table public.client_docs;
exception when duplicate_object then null; end $$;

-- إحصاءات المدير: آخر رسالة حقيقية (مو من المحاكي) وصلت من الواتساب
drop function if exists public.ihj_admin_stats();
create or replace function public.ihj_admin_stats()
returns table (
  business_id uuid, orders_month int, orders_total int, sim_orders int, last_order_at timestamptz,
  services int, cities int, staff int, hours int, open_handoffs int, paid_month numeric, links_owner int, last_real_in timestamptz, failed_week int)
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
    (select count(*)::int from public.access_links l where l.business_id = b.id and l.kind = 'owner' and l.revoked_at is null),
    (select max(l.created_at) from public.wa_log l join public.customers c on c.id = l.customer_id where l.business_id = b.id and l.direction = 'in' and not c.is_sim),
    (select count(*)::int from public.wa_log l where l.business_id = b.id and l.direction = 'out' and l.status = 'failed' and l.created_at > now() - interval '7 days')
  from public.businesses b;
end $$;
revoke all on function public.ihj_admin_stats() from public, anon;
grant execute on function public.ihj_admin_stats() to authenticated;

grant execute on all functions in schema public to service_role;
commit;
