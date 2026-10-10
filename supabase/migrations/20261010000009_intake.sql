-- احجزلي · بيانات العميل من نموذجه (start.html) تنطبق على منشأته بضغطة، وإنشاء المنشأة يقبل خيارات المجالات
begin;

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
    pay_timing = case when d->>'pay_timing' in ('after','before','none') then d->>'pay_timing' else pay_timing end
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
revoke all on function public.ihj_apply_intake(uuid) from public, anon;
grant execute on function public.ihj_apply_intake(uuid) to authenticated, service_role;

-- إنشاء المنشأة: يقبل مكان الخدمة وتوقيت الدفع وأسلوب الردود والأسئلة
create or replace function public.ihj_create_business(p jsonb)
returns public.businesses language plpgsql security definer set search_path = public as $$
declare
  b public.businesses; v_slug text; v_base text; i int := 0; x jsonb; v_ids uuid[]; v_fees jsonb; v_set jsonb;
begin
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'name_required' using errcode = 'P0001'; end if;
  v_base := lower(coalesce(nullif(trim(p->>'slug'), ''), 'biz'));
  v_base := trim(both '-' from regexp_replace(v_base, '[^a-z0-9]+', '-', 'g'));
  if length(v_base) < 2 then v_base := 'biz'; end if;
  v_base := left(v_base, 34);
  v_slug := v_base;
  while exists (select 1 from public.businesses where slug = v_slug) loop
    i := i + 1; v_slug := v_base || '-' || i;
  end loop;

  insert into public.businesses (slug, name, name_en, activity, city, wa_number, owner_name, owner_phone, plan, wants_app, is_demo,
                                 cr_number, vat_number, address, brand_color, lead_id, status)
  values (v_slug, trim(p->>'name'), coalesce(p->>'name_en', ''), coalesce(p->>'activity', ''), coalesce(p->>'city', ''),
          coalesce(p->>'wa_number', ''), coalesce(p->>'owner_name', ''), coalesce(p->>'owner_phone', ''),
          case when p->>'plan' = 'bot_pay' then 'bot_pay' else 'bot' end, coalesce((p->>'wants_app')::boolean, false),
          coalesce((p->>'is_demo')::boolean, false), coalesce(p->>'cr_number', ''), coalesce(p->>'vat_number', ''), coalesce(p->>'address', ''),
          coalesce(nullif(p->>'brand_color', ''), '#4338CA'), nullif(p->>'lead_id', '')::uuid, 'setup')
  returning * into b;

  i := 0;
  for x in select * from jsonb_array_elements(coalesce(p->'cities', '[]'::jsonb)) loop
    insert into public.cities (business_id, name, name_en, lat, lng, radius_km, sort)
    values (b.id, x->>'name', coalesce(x->>'name_en', ''), (x->>'lat')::float8, (x->>'lng')::float8, coalesce((x->>'radius_km')::numeric, 25), i);
    i := i + 1;
  end loop;

  i := 0;
  for x in select * from jsonb_array_elements(coalesce(p->'services', '[]'::jsonb)) loop
    if coalesce(trim(x->>'name'), '') <> '' then
      insert into public.services (business_id, name, name_en, price, duration_min, sort, place_mode)
      values (b.id, left(trim(x->>'name'), 24), coalesce(x->>'name_en', ''), nullif(x->>'price', '')::numeric, nullif(x->>'duration_min', '')::int, i,
              case when x->>'place_mode' in ('visit','shop','online') then x->>'place_mode' end);
      i := i + 1;
    end if;
  end loop;

  if jsonb_array_length(coalesce(p->'hours', '[]'::jsonb)) = 0 then
    insert into public.hours (business_id, weekday, open_time, close_time)
    select b.id, d, case when d = 5 then time '16:00' else time '09:00' end, time '21:00' from generate_series(0, 6) d;
  else
    for x in select * from jsonb_array_elements(p->'hours') loop
      insert into public.hours (business_id, weekday, open_time, close_time)
      values (b.id, (x->>'weekday')::smallint, (x->>'open')::time, (x->>'close')::time);
    end loop;
  end if;

  for x in select * from jsonb_array_elements(coalesce(p->'staff', '[]'::jsonb)) loop
    if coalesce(trim(x->>'name'), '') <> '' then
      select coalesce(array_agg(c.id), '{}') into v_ids from public.cities c
       where c.business_id = b.id and c.name in (select jsonb_array_elements_text(coalesce(x->'cities', '[]'::jsonb)));
      insert into public.staff (business_id, name, phone, city_ids) values (b.id, left(trim(x->>'name'), 40), coalesce(x->>'phone', ''), v_ids);
    end if;
  end loop;

  v_set := coalesce(p->'settings', '{}'::jsonb);
  update public.settings set
    slot_minutes = coalesce((v_set->>'slot_minutes')::int, slot_minutes),
    days_ahead = coalesce((v_set->>'days_ahead')::int, days_ahead),
    lead_minutes = coalesce((v_set->>'lead_minutes')::int, lead_minutes),
    capacity_mode = coalesce(v_set->>'capacity_mode', capacity_mode),
    capacity_per_slot = coalesce((v_set->>'capacity_per_slot')::int, capacity_per_slot),
    reminder_minutes = coalesce((v_set->>'reminder_minutes')::int, reminder_minutes),
    vat_percent = coalesce((v_set->>'vat_percent')::numeric, vat_percent),
    pay_provider = coalesce(v_set->>'pay_provider', pay_provider),
    place_mode = case when v_set->>'place_mode' in ('visit','shop','online') then v_set->>'place_mode' else place_mode end,
    pay_timing = case when v_set->>'pay_timing' in ('after','before','none') then v_set->>'pay_timing' else pay_timing end,
    tone = case when v_set->>'tone' in ('friendly','formal','short') then v_set->>'tone' else tone end,
    prepay_amount = coalesce((v_set->>'prepay_amount')::numeric, prepay_amount),
    hold_minutes = coalesce((v_set->>'hold_minutes')::int, hold_minutes),
    online_note = coalesce(v_set->>'online_note', online_note),
    faq = coalesce(v_set->'faq', faq)
  where business_id = b.id;

  v_fees := public.ihj_plan_fees(b.plan, b.wants_app);
  update public.subscriptions set plan = b.plan,
    setup_fee = (v_fees->>'setup_fee')::numeric, monthly_fee = (v_fees->>'monthly_fee')::numeric,
    app_setup_fee = (v_fees->>'app_setup_fee')::numeric, app_monthly_fee = (v_fees->>'app_monthly_fee')::numeric
  where business_id = b.id;

  if nullif(p->>'lead_id', '') is not null then
    update public.signup_requests set business_id = b.id, status = case when status in ('new', 'contacted', 'agreed') then 'setup' else status end
     where id = (p->>'lead_id')::uuid;
  end if;
  return b;
end $$;
revoke all on function public.ihj_create_business(jsonb) from public, anon, authenticated;
grant execute on function public.ihj_create_business(jsonb) to service_role;

commit;
