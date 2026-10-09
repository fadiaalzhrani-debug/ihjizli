-- احجزلي · القاعدة الأساسية
-- منصة متعددة المنشآت: كل جدول بيانات فيه business_id، وRLS تفصل كل منشأة عن الثانية.
-- الأدوار: مدير المنصة (platform_admins)، مالك المنشأة (members.role=owner)، الموظف (members.role=staff).
-- الدخول بروابط خاصة (access_links) تتحول لجلسة Supabase عبر الدالة api، بدون كلمات مرور.
begin;

-- ───────── المنصة ─────────
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  label text not null default '',
  created_at timestamptz not null default now()
);

-- ───────── المنشآت ─────────
create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name text not null check (char_length(name) between 2 and 80),
  name_en text not null default '',
  activity text not null default '',
  city text not null default '',
  wa_number text not null default '',
  owner_name text not null default '',
  owner_phone text not null default '',
  logo_url text not null default '',
  brand_color text not null default '#0B7A55' check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  plan text not null default 'bot' check (plan in ('bot','bot_pay')),
  wants_app boolean not null default false,
  status text not null default 'setup' check (status in ('setup','live','paused','ended')),
  bot_enabled boolean not null default true,
  is_demo boolean not null default false,
  timezone text not null default 'Asia/Riyadh',
  cr_number text not null default '',
  vat_number text not null default '',
  address text not null default '',
  sim_key text not null default encode(extensions.gen_random_bytes(12), 'hex'),
  lead_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  slot_minutes int not null default 60 check (slot_minutes between 10 and 480),
  days_ahead int not null default 7 check (days_ahead between 1 and 30),
  lead_minutes int not null default 120 check (lead_minutes between 0 and 2880),
  buffer_minutes int not null default 0 check (buffer_minutes between 0 and 240),
  capacity_mode text not null default 'staff' check (capacity_mode in ('staff','fixed')),
  capacity_per_slot int not null default 1 check (capacity_per_slot between 1 and 100),
  reminder_minutes int not null default 120 check (reminder_minutes between 0 and 2880),
  resume_hours int not null default 12 check (resume_hours between 0 and 168),
  vat_percent numeric(5,2) not null default 0 check (vat_percent between 0 and 30),
  pay_provider text not null default 'none' check (pay_provider in ('none','moyasar','demo')),
  texts jsonb not null default '{}'::jsonb,
  notify_owner boolean not null default false,
  export_kind text not null default 'none' check (export_kind in ('none','webhook','sheet')),
  export_url text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.cities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  name_en text not null default '',
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  radius_km numeric(6,1) not null default 25 check (radius_km > 0 and radius_km <= 300),
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists cities_biz on public.cities (business_id);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  name_en text not null default '',
  price numeric(10,2) check (price is null or price >= 0),
  duration_min int check (duration_min is null or duration_min between 10 and 720),
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists services_biz on public.services (business_id);

create table if not exists public.hours (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  open_time time not null,
  close_time time not null,
  city_id uuid references public.cities(id) on delete cascade
);
create index if not exists hours_biz on public.hours (business_id, weekday);

create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  day date not null,
  note text not null default '',
  city_id uuid references public.cities(id) on delete cascade,
  unique nulls not distinct (business_id, day, city_id)
);

create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  phone text not null default '',
  city_ids uuid[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists staff_biz on public.staff (business_id);

create table if not exists public.members (
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  role text not null check (role in ('owner','staff')),
  staff_id uuid references public.staff(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, business_id)
);

create table if not exists public.access_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  kind text not null check (kind in ('admin','owner','staff')),
  business_id uuid references public.businesses(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists access_links_biz on public.access_links (business_id);

-- ربط واتساب (بدون أسرار) والأسرار في جدول مستقل لا يقرؤه إلا الخادم
create table if not exists public.channels (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  provider text not null default 'none' check (provider in ('none','meta','dualhook','d360')),
  phone_number_id text unique,
  waba_id text not null default '',
  api_base text not null default '',
  display_phone text not null default '',
  verified_name text not null default '',
  name_status text not null default '',
  quality text not null default '',
  meta_verification text not null default 'unknown' check (meta_verification in ('unknown','not_started','pending','verified','rejected')),
  status text not null default 'not_connected' check (status in ('not_connected','connected','error')),
  last_check_at timestamptz,
  last_error text not null default '',
  templates jsonb not null default '[]'::jsonb,
  templates_checked_at timestamptz,
  dry_run boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.business_secrets (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  wa_token text not null default '',
  wa_app_secret text not null default '',
  wa_verify_token text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  wa_hook_key text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  moyasar_sk text not null default '',
  moyasar_pk text not null default '',
  export_secret text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  updated_at timestamptz not null default now()
);

-- ───────── العملاء والطلبات ─────────
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  wa_id text not null,
  is_sim boolean not null default false,
  name text not null default '',
  lang text not null default 'ar' check (lang in ('ar','en')),
  state text not null default 'idle',
  state_data jsonb not null default '{}'::jsonb,
  bot_paused boolean not null default false,
  paused_at timestamptz,
  paused_reason text not null default '',
  misses int not null default 0,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, wa_id)
);

create table if not exists public.counters (
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null,
  last int not null default 0,
  primary key (business_id, kind)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  number int not null,
  customer_id uuid not null references public.customers(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  city_id uuid references public.cities(id) on delete set null,
  staff_id uuid references public.staff(id) on delete set null,
  status text not null default 'confirmed' check (status in ('confirmed','on_the_way','arrived','invoiced','done','cancelled')),
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  lat double precision,
  lng double precision,
  maps_url text not null default '',
  address text not null default '',
  price numeric(10,2),
  notes text not null default '',
  channel text not null default 'wa' check (channel in ('wa','sim','dashboard')),
  is_test boolean not null default false,
  reminded_at timestamptz,
  on_the_way_at timestamptz,
  arrived_at timestamptz,
  invoiced_at timestamptz,
  paid_at timestamptz,
  done_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text not null default '',
  cancel_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, number)
);
create index if not exists orders_biz_slot on public.orders (business_id, slot_start);
create index if not exists orders_biz_created on public.orders (business_id, created_at desc);
create index if not exists orders_staff_slot on public.orders (staff_id, slot_start);
create index if not exists orders_customer on public.orders (customer_id);

create table if not exists public.order_events (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  kind text not null,
  data jsonb not null default '{}'::jsonb,
  by_who text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists order_events_order on public.order_events (order_id, id);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  number int not null,
  items jsonb not null default '[]'::jsonb,
  subtotal numeric(10,2) not null default 0,
  vat_percent numeric(5,2) not null default 0,
  vat numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  pdf_path text not null default '',
  status text not null default 'issued' check (status in ('issued','paid','void')),
  pay_provider text not null default 'none',
  pay_ref text not null default '',
  pay_url text not null default '',
  pay_token text not null default encode(extensions.gen_random_bytes(16), 'hex'),
  paid_at timestamptz,
  paid_method text not null default '',
  created_at timestamptz not null default now(),
  unique (business_id, number)
);
create index if not exists invoices_order on public.invoices (order_id);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  provider text not null,
  provider_ref text not null default '',
  amount numeric(10,2) not null,
  status text not null,
  method text not null default '',
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, provider_ref)
);

create table if not exists public.wa_log (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  channel text not null default 'wa' check (channel in ('wa','sim')),
  kind text not null default 'text',
  body jsonb not null default '{}'::jsonb,
  preview text not null default '',
  wa_msg_id text,
  status text not null default '',
  error text not null default '',
  by_who text not null default 'bot',
  created_at timestamptz not null default now()
);
create index if not exists wa_log_biz on public.wa_log (business_id, id desc);
create index if not exists wa_log_customer on public.wa_log (customer_id, id);
create unique index if not exists wa_log_in_dedupe on public.wa_log (business_id, wa_msg_id) where direction = 'in' and wa_msg_id is not null;
create index if not exists wa_log_out_msg on public.wa_log (wa_msg_id) where direction = 'out' and wa_msg_id is not null;

create table if not exists public.handoffs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  reason text not null default 'unknown' check (reason in ('unknown','complaint','human','location','order')),
  last_text text not null default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text not null default ''
);
create index if not exists handoffs_open on public.handoffs (business_id) where resolved_at is null;

create table if not exists public.jobs (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  run_at timestamptz not null default now(),
  attempts int not null default 0,
  done_at timestamptz,
  last_error text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists jobs_due on public.jobs (run_at) where done_at is null;

-- ───────── اشتراكات المنصة (لوحة المدير فقط) ─────────
create table if not exists public.subscriptions (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  plan text not null default 'bot' check (plan in ('bot','bot_pay')),
  setup_fee numeric(10,2) not null default 0,
  monthly_fee numeric(10,2) not null default 0,
  app_setup_fee numeric(10,2) not null default 0,
  app_monthly_fee numeric(10,2) not null default 0,
  started_on date,
  next_renewal date,
  notes text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.sub_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  amount numeric(10,2) not null check (amount > 0),
  kind text not null default 'monthly' check (kind in ('setup','monthly','app','other')),
  paid_on date not null default current_date,
  covers_until date,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists sub_payments_biz on public.sub_payments (business_id, paid_on desc);

create table if not exists public.setup_steps (
  business_id uuid not null references public.businesses(id) on delete cascade,
  step text not null check (step ~ '^[a-z_]{2,24}$'),
  done_at timestamptz,
  note text not null default '',
  primary key (business_id, step)
);

-- طلبات الاشتراك من الموقع العام (business_id = المنشأة اللي تحوّل لها الطلب)
create table if not exists public.signup_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  business_name text not null,
  activity text not null default '',
  city text not null default '',
  contact_name text not null default '',
  phone text not null,
  package text not null default 'bot' check (package in ('bot','bot_pay')),
  wants_app boolean not null default false,
  orders_per_day text not null default '',
  notes text not null default '',
  source text not null default 'site',
  status text not null default 'new' check (status in ('new','contacted','agreed','setup','live','lost')),
  setup_fee numeric not null default 0,
  monthly_fee numeric not null default 0,
  paid numeric not null default 0,
  follow_up date,
  admin_notes text not null default '',
  checklist jsonb not null default '{}'::jsonb,
  log jsonb not null default '[]'::jsonb,
  ip text,
  business_id uuid references public.businesses(id) on delete set null
);
create index if not exists signup_requests_created on public.signup_requests (created_at desc);

-- مستقبل Webhook للفحص (يستقبل نسخة التصدير في الاختبار الآلي)
create table if not exists public.hook_sink (
  id bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  headers jsonb not null default '{}'::jsonb,
  body jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ───────── دوال الصلاحيات ─────────
create or replace function public.ihj_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

create or replace function public.ihj_is_member(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.ihj_is_admin() or exists (select 1 from public.members where user_id = auth.uid() and business_id = b)
$$;

create or replace function public.ihj_is_owner(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.ihj_is_admin() or exists (select 1 from public.members where user_id = auth.uid() and business_id = b and role = 'owner')
$$;

create or replace function public.ihj_staff_id(b uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select staff_id from public.members where user_id = auth.uid() and business_id = b and role = 'staff' limit 1
$$;

-- هل المستخدم الحالي جلسة عادية (مو الخادم ولا المدير)؟
create or replace function public.ihj_is_client() returns boolean
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'authenticated'
     and not public.ihj_is_admin()
$$;

-- ───────── حراس الأعمدة: المالك يعدّل البيانات التشغيلية فقط ─────────
create or replace function public.ihj_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create or replace function public.ihj_guard_business() returns trigger language plpgsql as $$
begin
  if public.ihj_is_client() then
    new.slug := old.slug; new.plan := old.plan; new.wants_app := old.wants_app; new.status := old.status;
    new.is_demo := old.is_demo; new.sim_key := old.sim_key; new.lead_id := old.lead_id; new.wa_number := old.wa_number;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.ihj_guard_settings() returns trigger language plpgsql as $$
begin
  if public.ihj_is_client() then
    if new.pay_provider = 'demo' and old.pay_provider <> 'demo' then new.pay_provider := old.pay_provider; end if;
    if new.pay_provider = 'moyasar' and not exists (select 1 from public.businesses b where b.id = new.business_id and b.plan = 'bot_pay') then
      new.pay_provider := old.pay_provider;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- الطلب: الجلسات العادية تعدّل الموظف المسند والملاحظات والسعر والعنوان فقط؛ الحالات تمشي عبر الدالة api (عشان توصل رسائل العميل)
create or replace function public.ihj_guard_order() returns trigger language plpgsql as $$
begin
  if public.ihj_is_client() then
    if (to_jsonb(new) - array['staff_id','notes','price','address','updated_at'])
       is distinct from (to_jsonb(old) - array['staff_id','notes','price','address','updated_at']) then
      raise exception 'order_fields_locked' using errcode = '42501';
    end if;
    if new.staff_id is not null and not exists (select 1 from public.staff s where s.id = new.staff_id and s.business_id = new.business_id) then
      raise exception 'staff_other_business' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.ihj_guard_customer() returns trigger language plpgsql as $$
begin
  if public.ihj_is_client() then
    if (to_jsonb(new) - array['name'])  is distinct from (to_jsonb(old) - array['name']) then
      raise exception 'customer_fields_locked' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- الموظف لازم تكون مدنه من نفس المنشأة
create or replace function public.ihj_guard_staff() returns trigger language plpgsql as $$
begin
  if exists (select 1 from unnest(new.city_ids) c where not exists (select 1 from public.cities ci where ci.id = c and ci.business_id = new.business_id)) then
    raise exception 'city_other_business' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists t_business_guard on public.businesses;
create trigger t_business_guard before update on public.businesses for each row execute function public.ihj_guard_business();
drop trigger if exists t_settings_guard on public.settings;
create trigger t_settings_guard before update on public.settings for each row execute function public.ihj_guard_settings();
drop trigger if exists t_order_guard on public.orders;
create trigger t_order_guard before update on public.orders for each row execute function public.ihj_guard_order();
drop trigger if exists t_customer_guard on public.customers;
create trigger t_customer_guard before update on public.customers for each row execute function public.ihj_guard_customer();
drop trigger if exists t_staff_guard on public.staff;
create trigger t_staff_guard before insert or update on public.staff for each row execute function public.ihj_guard_staff();
drop trigger if exists t_channels_touch on public.channels;
create trigger t_channels_touch before update on public.channels for each row execute function public.ihj_touch();
drop trigger if exists t_secrets_touch on public.business_secrets;
create trigger t_secrets_touch before update on public.business_secrets for each row execute function public.ihj_touch();
drop trigger if exists t_subs_touch on public.subscriptions;
create trigger t_subs_touch before update on public.subscriptions for each row execute function public.ihj_touch();
drop trigger if exists t_leads_touch on public.signup_requests;
create trigger t_leads_touch before update on public.signup_requests for each row execute function public.ihj_touch();

-- منشأة جديدة: إعداداتها واشتراكها وأسرارها وقناتها تنشأ معها
create or replace function public.ihj_business_defaults() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.settings (business_id, pay_provider) values (new.id, case when new.is_demo then 'demo' else 'none' end) on conflict do nothing;
  insert into public.business_secrets (business_id) values (new.id) on conflict do nothing;
  insert into public.channels (business_id) values (new.id) on conflict do nothing;
  insert into public.subscriptions (business_id, plan) values (new.id, new.plan) on conflict do nothing;
  return new;
end $$;
drop trigger if exists t_business_defaults on public.businesses;
create trigger t_business_defaults after insert on public.businesses for each row execute function public.ihj_business_defaults();

-- ───────── RLS ─────────
alter table public.platform_admins enable row level security;
alter table public.businesses enable row level security;
alter table public.settings enable row level security;
alter table public.cities enable row level security;
alter table public.services enable row level security;
alter table public.hours enable row level security;
alter table public.holidays enable row level security;
alter table public.staff enable row level security;
alter table public.members enable row level security;
alter table public.access_links enable row level security;
alter table public.channels enable row level security;
alter table public.business_secrets enable row level security;
alter table public.customers enable row level security;
alter table public.counters enable row level security;
alter table public.orders enable row level security;
alter table public.order_events enable row level security;
alter table public.invoices enable row level security;
alter table public.payments enable row level security;
alter table public.wa_log enable row level security;
alter table public.handoffs enable row level security;
alter table public.jobs enable row level security;
alter table public.subscriptions enable row level security;
alter table public.sub_payments enable row level security;
alter table public.setup_steps enable row level security;
alter table public.signup_requests enable row level security;
alter table public.hook_sink enable row level security;

-- المدير يشوف قائمة المدراء
drop policy if exists p_admins_sel on public.platform_admins;
create policy p_admins_sel on public.platform_admins for select to authenticated using (public.ihj_is_admin());

-- المنشأة: الأعضاء يشوفونها، المالك يعدّل، والمدير ينشئ ويحذف
drop policy if exists p_biz_sel on public.businesses;
create policy p_biz_sel on public.businesses for select to authenticated using (public.ihj_is_member(id));
drop policy if exists p_biz_upd on public.businesses;
create policy p_biz_upd on public.businesses for update to authenticated using (public.ihj_is_owner(id)) with check (public.ihj_is_owner(id));
drop policy if exists p_biz_ins on public.businesses;
create policy p_biz_ins on public.businesses for insert to authenticated with check (public.ihj_is_admin());
drop policy if exists p_biz_del on public.businesses;
create policy p_biz_del on public.businesses for delete to authenticated using (public.ihj_is_admin());

-- جداول التشغيل: الأعضاء يقرؤون، المالك يكتب
do $$
declare t text;
begin
  foreach t in array array['cities','services','hours','holidays','staff'] loop
    execute format('drop policy if exists p_%1$s_sel on public.%1$I', t);
    execute format('create policy p_%1$s_sel on public.%1$I for select to authenticated using (public.ihj_is_member(business_id))', t);
    execute format('drop policy if exists p_%1$s_ins on public.%1$I', t);
    execute format('create policy p_%1$s_ins on public.%1$I for insert to authenticated with check (public.ihj_is_owner(business_id))', t);
    execute format('drop policy if exists p_%1$s_upd on public.%1$I', t);
    execute format('create policy p_%1$s_upd on public.%1$I for update to authenticated using (public.ihj_is_owner(business_id)) with check (public.ihj_is_owner(business_id))', t);
    execute format('drop policy if exists p_%1$s_del on public.%1$I', t);
    execute format('create policy p_%1$s_del on public.%1$I for delete to authenticated using (public.ihj_is_owner(business_id))', t);
  end loop;
end $$;

drop policy if exists p_settings_sel on public.settings;
create policy p_settings_sel on public.settings for select to authenticated using (public.ihj_is_member(business_id));
drop policy if exists p_settings_upd on public.settings;
create policy p_settings_upd on public.settings for update to authenticated using (public.ihj_is_owner(business_id)) with check (public.ihj_is_owner(business_id));

drop policy if exists p_members_sel on public.members;
create policy p_members_sel on public.members for select to authenticated using (user_id = auth.uid() or public.ihj_is_owner(business_id));

drop policy if exists p_links_sel on public.access_links;
create policy p_links_sel on public.access_links for select to authenticated
  using (public.ihj_is_admin() or (business_id is not null and kind = 'staff' and public.ihj_is_owner(business_id)));

drop policy if exists p_channels_sel on public.channels;
create policy p_channels_sel on public.channels for select to authenticated using (public.ihj_is_owner(business_id));

-- العملاء: المالك كامل، والموظف يشوف عملاء طلباته فقط
drop policy if exists p_customers_sel on public.customers;
create policy p_customers_sel on public.customers for select to authenticated using (
  public.ihj_is_owner(business_id)
  or exists (select 1 from public.orders o where o.customer_id = customers.id and o.staff_id is not null and o.staff_id = public.ihj_staff_id(customers.business_id)));
drop policy if exists p_customers_upd on public.customers;
create policy p_customers_upd on public.customers for update to authenticated using (public.ihj_is_owner(business_id)) with check (public.ihj_is_owner(business_id));

-- الطلبات: المالك كامل، والموظف طلباته فقط (قراءة)
drop policy if exists p_orders_sel on public.orders;
create policy p_orders_sel on public.orders for select to authenticated using (
  public.ihj_is_owner(business_id) or (staff_id is not null and staff_id = public.ihj_staff_id(business_id)));
drop policy if exists p_orders_upd on public.orders;
create policy p_orders_upd on public.orders for update to authenticated using (public.ihj_is_owner(business_id)) with check (public.ihj_is_owner(business_id));

drop policy if exists p_events_sel on public.order_events;
create policy p_events_sel on public.order_events for select to authenticated using (
  public.ihj_is_owner(business_id)
  or exists (select 1 from public.orders o where o.id = order_events.order_id and o.staff_id is not null and o.staff_id = public.ihj_staff_id(order_events.business_id)));

drop policy if exists p_invoices_sel on public.invoices;
create policy p_invoices_sel on public.invoices for select to authenticated using (
  public.ihj_is_owner(business_id)
  or exists (select 1 from public.orders o where o.id = invoices.order_id and o.staff_id is not null and o.staff_id = public.ihj_staff_id(invoices.business_id)));

drop policy if exists p_payments_sel on public.payments;
create policy p_payments_sel on public.payments for select to authenticated using (public.ihj_is_owner(business_id));

drop policy if exists p_walog_sel on public.wa_log;
create policy p_walog_sel on public.wa_log for select to authenticated using (public.ihj_is_owner(business_id));

drop policy if exists p_handoffs_sel on public.handoffs;
create policy p_handoffs_sel on public.handoffs for select to authenticated using (public.ihj_is_owner(business_id));

-- لوحة المدير فقط
do $$
declare t text;
begin
  foreach t in array array['subscriptions','sub_payments','setup_steps','signup_requests','hook_sink'] loop
    execute format('drop policy if exists p_%1$s_all on public.%1$I', t);
    execute format('create policy p_%1$s_all on public.%1$I for all to authenticated using (public.ihj_is_admin()) with check (public.ihj_is_admin())', t);
  end loop;
end $$;
-- business_secrets و counters و jobs: بدون سياسات، يقرؤها الخادم فقط

-- ───────── الصلاحيات ─────────
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on public.business_secrets, public.counters, public.jobs from authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- ───────── البث المباشر للوحات ─────────
do $$
declare t text;
begin
  foreach t in array array['orders','handoffs','wa_log','signup_requests','invoices','customers'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ───────── التخزين ─────────
insert into storage.buckets (id, name, public) values ('public', 'public', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('invoices', 'invoices', false) on conflict (id) do nothing;

commit;
