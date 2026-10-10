-- «عبّيها من صورة أو موقع»: سجل القراءات (للحدود والتكلفة)، سعر «يبدأ من» للخدمات، والأسئلة من نموذج البيانات

create table if not exists public.ai_usage (
  id bigserial primary key,
  at timestamptz not null default now(),
  scope text not null check (scope in ('public', 'biz')),
  business_id uuid references public.businesses(id) on delete set null,
  ip text not null default '',
  kind text not null default '',
  ok boolean not null default false,
  ms int not null default 0,
  model text not null default '',
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  error text not null default ''
);
create index if not exists ai_usage_at on public.ai_usage (at desc);
create index if not exists ai_usage_scope on public.ai_usage (scope, ip, at desc);
create index if not exists ai_usage_biz on public.ai_usage (business_id, at desc);
alter table public.ai_usage enable row level security;
drop policy if exists p_ai_usage_admin on public.ai_usage;
create policy p_ai_usage_admin on public.ai_usage for select to authenticated using (public.ihj_is_admin());

-- السعر «يبدأ من»: البوت يقول «يبدأ من 150 ريال» بدل سعر ثابت
alter table public.services add column if not exists price_from boolean not null default false;

create or replace function public.ihj_apply_intake(p_business uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d jsonb; x jsonb; v_ids uuid[]; i int := 0; v_names text[]; v_id uuid; v_faq jsonb; v_pos int;
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
        insert into public.services (business_id, name, name_en, price, price_from, duration_min, sort)
        values (p_business, left(trim(x->>'name'), 24), left(coalesce(trim(x->>'name_en'), ''), 24), nullif(x->>'price', '')::numeric,
                coalesce((x->>'price_from')::boolean, false) and nullif(x->>'price', '') is not null, nullif(x->>'duration_min', '')::int, i);
      else
        update public.services set price = nullif(x->>'price', '')::numeric,
          price_from = coalesce((x->>'price_from')::boolean, false) and nullif(x->>'price', '') is not null,
          name_en = coalesce(nullif(left(trim(x->>'name_en'), 24), ''), name_en),
          duration_min = coalesce(nullif(x->>'duration_min', '')::int, duration_min), active = true, sort = i where id = v_id;
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

  -- الأسئلة والأجوبة: نفس السؤال يتحدّث جوابه بمكانه (عشان أزرار faq:N تبقى صحيحة)، والجديد ينضاف لين 12
  if jsonb_typeof(d->'faq') = 'array' and jsonb_array_length(d->'faq') > 0 then
    select coalesce(faq, '[]'::jsonb) into v_faq from public.settings where business_id = p_business;
    if jsonb_typeof(v_faq) <> 'array' then v_faq := '[]'::jsonb; end if;
    for x in select * from jsonb_array_elements(d->'faq') loop
      if coalesce(trim(x->>'a'), '') = '' or coalesce(trim(x->>'q'), '') = '' then continue; end if;
      x := jsonb_build_object('chip', left(coalesce(trim(x->>'chip'), ''), 60), 'q', left(trim(x->>'q'), 200), 'a', left(trim(x->>'a'), 600));
      v_pos := null;
      select (t.o - 1)::int into v_pos from jsonb_array_elements(v_faq) with ordinality t(e, o)
       where coalesce(trim(x->>'chip'), '') <> '' and lower(trim(t.e->>'chip')) = lower(trim(x->>'chip')) limit 1;
      if v_pos is not null then v_faq := jsonb_set(v_faq, array[v_pos::text], x);
      elsif jsonb_array_length(v_faq) < 12 then v_faq := v_faq || jsonb_build_array(x);
      end if;
    end loop;
    update public.settings set faq = v_faq where business_id = p_business;
  end if;

  update public.client_docs set intake_applied_at = now() where business_id = p_business;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.ihj_apply_intake(uuid) from public, anon;
grant execute on function public.ihj_apply_intake(uuid) to authenticated, service_role;
