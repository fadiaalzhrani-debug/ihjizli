-- احجزلي · التشغيل: طابور المهام، إنشاء منشأة كاملة باستدعاء واحد، وأسعار الباقات
begin;

create unique index if not exists invoices_pay_token on public.invoices (pay_token);

-- حجز دفعة مهام مستحقة (مع تأجيل إعادة المحاولة تصاعديًا)، بدون ما تتكرر بين نسختين شغالتين
create or replace function public.ihj_claim_jobs(p_limit int, p_business uuid default null)
returns setof public.jobs language sql volatile security definer set search_path = public as $$
  update public.jobs j
     set attempts = j.attempts + 1,
         run_at = now() + make_interval(mins => least(60, power(2, j.attempts)::int))
   where j.id in (select id from public.jobs
                   where done_at is null and run_at <= now() and attempts < 6
                     and (p_business is null or business_id = p_business)
                   order by id limit p_limit for update skip locked)
  returning j.*
$$;

-- أسعار الباقات (نفس الموقع): أتمتة الحجز 3,500 + 350، الحجز والدفع 5,500 + 600، التطبيق 9,000 + 150
create or replace function public.ihj_plan_fees(p_plan text, p_app boolean)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'setup_fee', case when p_plan = 'bot_pay' then 5500 else 3500 end,
    'monthly_fee', case when p_plan = 'bot_pay' then 600 else 350 end,
    'app_setup_fee', case when p_app then 9000 else 0 end,
    'app_monthly_fee', case when p_app then 150 else 0 end)
$$;

-- منشأة جديدة كاملة من نموذج لوحة المدير: البيانات والمدن والخدمات والأوقات والموظفون والإعدادات والاشتراك
create or replace function public.ihj_create_business(p jsonb)
returns public.businesses language plpgsql security definer set search_path = public as $$
declare
  b public.businesses; v_slug text; v_base text; i int := 0; x jsonb; v_city uuid; v_ids uuid[]; v_fees jsonb; v_set jsonb;
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
          coalesce(nullif(p->>'brand_color', ''), '#0B7A55'), nullif(p->>'lead_id', '')::uuid, 'setup')
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
      insert into public.services (business_id, name, name_en, price, duration_min, sort)
      values (b.id, left(trim(x->>'name'), 24), coalesce(x->>'name_en', ''), nullif(x->>'price', '')::numeric, nullif(x->>'duration_min', '')::int, i);
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
    pay_provider = coalesce(v_set->>'pay_provider', pay_provider)
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

-- الطلبات اللي جا وقت تذكيرها (تنعلّم مباشرة عشان ما يتكرر التذكير)
create or replace function public.ihj_due_reminders(p_limit int)
returns setof public.orders language sql volatile security definer set search_path = public as $$
  update public.orders o set reminded_at = now()
   where o.id in (select x.id from public.orders x join public.settings xs on xs.business_id = x.business_id
                   where x.status = 'confirmed' and x.reminded_at is null and xs.reminder_minutes > 0
                     and x.slot_start > now() and x.slot_start <= now() + make_interval(mins => xs.reminder_minutes)
                   order by x.slot_start limit p_limit for update of x skip locked)
  returning o.*
$$;

revoke all on function public.ihj_due_reminders(int) from public, anon, authenticated;
revoke all on function public.ihj_claim_jobs(int, uuid) from public, anon, authenticated;
revoke all on function public.ihj_create_business(jsonb) from public, anon, authenticated;
grant execute on function public.ihj_plan_fees(text, boolean) to authenticated;
grant execute on all functions in schema public to service_role;

commit;
