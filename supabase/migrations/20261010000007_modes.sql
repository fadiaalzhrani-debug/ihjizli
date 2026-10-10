-- احجزلي · لكل المجالات: مكان الخدمة (عند العميل/في المحل/أونلاين)، الدفع (قبل/بعد/في المحل) مع مهلة الدفع،
-- أسلوب الردود، الأسئلة والأجوبة، تخصيص المحاكي لكل جلسة، وصفحات العميل (الاتفاقية ونموذج البيانات)
begin;

alter table public.settings add column if not exists place_mode text not null default 'visit';
alter table public.settings add column if not exists pay_timing text not null default 'after';
alter table public.settings add column if not exists prepay_amount numeric(10,2) not null default 0;
alter table public.settings add column if not exists hold_minutes int not null default 30;
alter table public.settings add column if not exists online_note text not null default '';
alter table public.settings add column if not exists tone text not null default 'friendly';
alter table public.settings add column if not exists faq jsonb not null default '[]'::jsonb;
do $$ begin
  alter table public.settings add constraint settings_place_mode_check check (place_mode in ('visit','shop','online'));
  alter table public.settings add constraint settings_pay_timing_check check (pay_timing in ('after','before','none'));
  alter table public.settings add constraint settings_prepay_check check (prepay_amount >= 0 and prepay_amount <= 100000);
  alter table public.settings add constraint settings_hold_check check (hold_minutes between 5 and 1440);
  alter table public.settings add constraint settings_tone_check check (tone in ('friendly','formal','short'));
exception when duplicate_object then null; end $$;

alter table public.services add column if not exists place_mode text;
do $$ begin
  alter table public.services add constraint services_place_mode_check check (place_mode is null or place_mode in ('visit','shop','online'));
exception when duplicate_object then null; end $$;

alter table public.customers add column if not exists sim_config jsonb not null default '{}'::jsonb;

-- حالة «بانتظار الدفع» للحجز المدفوع مقدمًا (الموعد محجوز لين تنتهي المهلة)
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending_payment','confirmed','on_the_way','arrived','invoiced','done','cancelled'));
alter table public.orders add column if not exists hold_until timestamptz;
alter table public.orders add column if not exists prepaid boolean not null default false;
create index if not exists orders_hold on public.orders (hold_until) where status = 'pending_payment';

-- مفتاح صفحات العميل (الاتفاقية ونموذج البيانات)
alter table public.businesses add column if not exists client_key text;
update public.businesses set client_key = encode(extensions.gen_random_bytes(12), 'hex') where client_key is null;
alter table public.businesses alter column client_key set default encode(extensions.gen_random_bytes(12), 'hex');
alter table public.businesses alter column client_key set not null;
create unique index if not exists businesses_client_key on public.businesses (client_key);

create table if not exists public.client_docs (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  agreed_at timestamptz,
  agreed_name text not null default '',
  agreed_phone text not null default '',
  agreed_terms jsonb not null default '{}'::jsonb,
  agreed_ip text,
  intake jsonb not null default '{}'::jsonb,
  intake_at timestamptz,
  intake_applied_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.client_docs enable row level security;
drop policy if exists p_client_docs_all on public.client_docs;
create policy p_client_docs_all on public.client_docs for all to authenticated using (public.ihj_is_admin()) with check (public.ihj_is_admin());
grant select, insert, update, delete on public.client_docs to authenticated;
grant all on public.client_docs to service_role;
revoke all on public.client_docs from anon;

-- حراس: المالك ما يغيّر مفتاح صفحاته، والدفع المقدم يحتاج باقة الدفع
create or replace function public.ihj_guard_business() returns trigger language plpgsql as $$
begin
  if public.ihj_is_client() then
    new.slug := old.slug; new.plan := old.plan; new.wants_app := old.wants_app; new.status := old.status;
    new.is_demo := old.is_demo; new.sim_key := old.sim_key; new.lead_id := old.lead_id; new.wa_number := old.wa_number;
    new.client_key := old.client_key; new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.ihj_guard_settings() returns trigger language plpgsql as $$
declare v_pay boolean;
begin
  if public.ihj_is_client() then
    select (b.plan = 'bot_pay' or b.is_demo) into v_pay from public.businesses b where b.id = new.business_id;
    if new.pay_provider = 'demo' and old.pay_provider <> 'demo' then new.pay_provider := old.pay_provider; end if;
    if new.pay_provider = 'moyasar' and not v_pay then new.pay_provider := old.pay_provider; end if;
    if new.pay_timing = 'before' and not v_pay then new.pay_timing := old.pay_timing; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- الحجز: يقبل حالة البداية (مؤكد، أو بانتظار الدفع لين وقت محدد)
drop function if exists public.ihj_book(uuid, uuid, uuid, uuid, timestamptz, double precision, double precision, text, text, text, text);
create or replace function public.ihj_book(
  p_business uuid, p_customer uuid, p_city uuid, p_service uuid, p_start timestamptz,
  p_lat double precision, p_lng double precision, p_maps_url text, p_address text, p_channel text, p_notes text default '',
  p_status text default 'confirmed', p_hold_until timestamptz default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_tz text; v_end timestamptz; v_staff uuid; v_no int; v_price numeric; v_o public.orders; v_mode text;
begin
  if p_status not in ('confirmed', 'pending_payment') then raise exception 'bad_status' using errcode = 'P0001'; end if;
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
revoke all on function public.ihj_book(uuid, uuid, uuid, uuid, timestamptz, double precision, double precision, text, text, text, text, text, timestamptz) from public, anon, authenticated;

create or replace function public.ihj_cancel(p_order uuid, p_by text, p_reason text default '')
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders;
begin
  update public.orders set status = 'cancelled', cancelled_at = now(), cancelled_by = coalesce(p_by, ''), cancel_reason = coalesce(p_reason, ''), hold_until = null
   where id = p_order and status in ('pending_payment', 'confirmed', 'on_the_way')
  returning * into o;
  if not found then raise exception 'locked' using errcode = 'P0001'; end if;
  insert into public.order_events (business_id, order_id, kind, data, by_who)
  values (o.business_id, o.id, 'cancelled', jsonb_build_object('reason', p_reason), p_by);
  return o;
end $$;

-- الحجوزات اللي انتهت مهلة دفعها تنلغى وتفضى مواعيدها
create or replace function public.ihj_expire_holds(p_limit int)
returns setof public.orders language sql volatile security definer set search_path = public as $$
  update public.orders o set status = 'cancelled', cancelled_at = now(), cancelled_by = 'system', cancel_reason = 'unpaid', hold_until = null
   where o.id in (select x.id from public.orders x where x.status = 'pending_payment' and x.hold_until < now()
                   order by x.hold_until limit p_limit for update skip locked)
  returning o.*
$$;
revoke all on function public.ihj_expire_holds(int) from public, anon, authenticated;

-- تجارب المحاكي في المنشآت التجريبية تنمسح بعد مدة (عشان تبقى المواعيد فاضية للزوار)
create or replace function public.ihj_cleanup_demo(p_hours int)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from public.customers c using public.businesses b
   where b.id = c.business_id and b.is_demo and c.is_sim
     and coalesce(c.last_inbound_at, c.created_at) < now() - make_interval(hours => p_hours);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.ihj_cleanup_demo(int) from public, anon, authenticated;

grant execute on all functions in schema public to service_role;
commit;
