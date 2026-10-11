-- خيارات الطلب مثل مواقع الحجز (2026-10-11، طلبها: «اطلب من موقعهم كأنك عميل وشوف وش ينعرض عليك وحطه لهم في الواتس»):
--   الخدمة: إضافات اختيارية بسعرها (واكس، تكييس دعاسات) وعدد (كم سيارة)
--   أسئلة قبل الحجز (رقم اللوحة، تفاصيل الموقع)
--   البكجات: تنباع من الواتساب برابط دفع، ورصيدها ينخصم من الحجز ويرجع لو انلغى الطلب
begin;

-- ───────── الخدمة ─────────
-- addons: [{name, name_en, price, group}] (نفس group = يختار واحد بس منها، مثل تكييس دعاستين أو 4)
-- qty: {max, one, two, many, en_one, en_many} (max > 1 = البوت يسأل كم)
alter table public.services add column if not exists addons jsonb not null default '[]'::jsonb;
alter table public.services add column if not exists qty jsonb not null default '{}'::jsonb;

-- ───────── الإعدادات ─────────
-- ask: [{q, q_en, hint, hint_en, svc: [service ids] (فاضي = كل الخدمات)}]
-- pkg_unit: كلمة رصيد البكج {one, two, many, en_one, en_many} مثل غسلة/غسلتين/غسلات
alter table public.settings add column if not exists ask jsonb not null default '[]'::jsonb;
alter table public.settings add column if not exists pkg_unit jsonb not null default '{}'::jsonb;

-- ───────── البكجات ─────────
create table if not exists public.packages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  name_en text not null default '',
  uses int not null check (uses between 1 and 500),
  price numeric(10,2) not null check (price >= 0),
  compare_price numeric(10,2) check (compare_price is null or compare_price >= 0),
  service_ids uuid[] not null default '{}',
  note text not null default '',
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists packages_biz on public.packages (business_id, sort);

-- رصيد العميل: يتفعّل بعد الدفع (أو يضيفه المحل يدويًا لعميل اشترى من مكان ثاني)
create table if not exists public.customer_packages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  package_id uuid references public.packages(id) on delete set null,
  name text not null default '',
  uses_total int not null check (uses_total between 1 and 500),
  uses_left int not null check (uses_left >= 0),
  price numeric(10,2) not null default 0,
  service_ids uuid[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','active','used','void')),
  source text not null default 'wa' check (source in ('wa','sim','manual')),
  is_test boolean not null default false,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cpk_customer on public.customer_packages (customer_id, status);
create index if not exists cpk_biz on public.customer_packages (business_id, created_at desc);

-- ───────── الطلب ─────────
-- extras: {addons: [{name, price}], answers: [{q, a}], unit: 'سيارة'}؛ total = اللي يدفعه العميل؛ pkg_id/pkg_uses = اللي انخصم من رصيده
alter table public.orders add column if not exists qty int not null default 1;
alter table public.orders add column if not exists extras jsonb not null default '{}'::jsonb;
alter table public.orders add column if not exists total numeric(10,2);
alter table public.orders add column if not exists pkg_id uuid references public.customer_packages(id) on delete set null;
alter table public.orders add column if not exists pkg_uses int not null default 0;
do $$ begin
  alter table public.orders add constraint orders_qty_check check (qty between 1 and 50);
exception when duplicate_object then null; end $$;

-- ───────── الفاتورة: لطلب أو لبكج ─────────
alter table public.invoices alter column order_id drop not null;
alter table public.invoices add column if not exists customer_package_id uuid references public.customer_packages(id) on delete cascade;
do $$ begin
  alter table public.invoices add constraint invoices_target check (order_id is not null or customer_package_id is not null);
exception when duplicate_object then null; end $$;
create index if not exists invoices_cpk on public.invoices (customer_package_id) where customer_package_id is not null;

-- ───────── الحماية ─────────
alter table public.packages enable row level security;
drop policy if exists p_packages_sel on public.packages;
create policy p_packages_sel on public.packages for select to authenticated using (public.ihj_is_member(business_id));
drop policy if exists p_packages_ins on public.packages;
create policy p_packages_ins on public.packages for insert to authenticated with check (public.ihj_is_owner(business_id));
drop policy if exists p_packages_upd on public.packages;
create policy p_packages_upd on public.packages for update to authenticated using (public.ihj_is_owner(business_id)) with check (public.ihj_is_owner(business_id));
drop policy if exists p_packages_del on public.packages;
create policy p_packages_del on public.packages for delete to authenticated using (public.ihj_is_owner(business_id));

-- رصيد العملاء: المالك يشوفه، والتعديل من الخادم بس (عشان الخصم والإرجاع يبقون صحيحين)
alter table public.customer_packages enable row level security;
drop policy if exists p_cpk_sel on public.customer_packages;
create policy p_cpk_sel on public.customer_packages for select to authenticated using (public.ihj_is_owner(business_id));

-- ───────── الرصيد ─────────
-- يخصم من رصيد العميل ويربطه بالطلب ويحفظ تفاصيله، كله مرة وحدة (لو الرصيد ما يكفي: pkg_unavailable)
create or replace function public.ihj_order_extras(p_order uuid, p_qty int, p_extras jsonb, p_total numeric, p_pkg uuid, p_uses int)
returns public.orders language plpgsql security definer set search_path = public as $$
declare o public.orders; n int;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if p_pkg is not null and coalesce(p_uses, 0) > 0 then
    update public.customer_packages
       set uses_left = uses_left - p_uses, status = case when uses_left - p_uses = 0 then 'used' else status end, updated_at = now()
     where id = p_pkg and customer_id = o.customer_id and business_id = o.business_id and status = 'active' and uses_left >= p_uses
       and (cardinality(service_ids) = 0 or o.service_id = any (service_ids));
    get diagnostics n = row_count;
    if n = 0 then raise exception 'pkg_unavailable' using errcode = 'P0001'; end if;
  end if;
  update public.orders set qty = greatest(1, least(50, coalesce(p_qty, 1))), extras = coalesce(p_extras, '{}'::jsonb), total = p_total,
         pkg_id = case when coalesce(p_uses, 0) > 0 then p_pkg end, pkg_uses = case when p_pkg is not null then greatest(coalesce(p_uses, 0), 0) else 0 end
   where id = p_order returning * into o;
  return o;
end $$;

-- الطلب انلغى (من العميل أو المحل أو انتهاء مهلة الدفع): يرجع رصيده
create or replace function public.ihj_pkg_refund() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' and new.pkg_id is not null and new.pkg_uses > 0 then
    update public.customer_packages set uses_left = least(uses_total, uses_left + new.pkg_uses),
           status = case when status = 'used' then 'active' else status end, updated_at = now()
     where id = new.pkg_id;
    new.pkg_uses := 0;
  end if;
  return new;
end $$;
drop trigger if exists t_orders_pkg_refund on public.orders;
create trigger t_orders_pkg_refund before update of status on public.orders for each row execute function public.ihj_pkg_refund();

revoke all on function public.ihj_order_extras(uuid, int, jsonb, numeric, uuid, int) from public, anon, authenticated;
revoke all on function public.ihj_pkg_refund() from public, anon, authenticated;
grant all on table public.packages to service_role;
grant all on table public.customer_packages to service_role;
grant select, insert, update, delete on table public.packages to authenticated;
grant select on table public.customer_packages to authenticated;
grant execute on all functions in schema public to service_role;

-- لوحة المنشأة تسمع البكجات المباعة لحظيًا
do $$ begin
  alter publication supabase_realtime add table public.customer_packages;
exception when duplicate_object then null; end $$;
commit;
