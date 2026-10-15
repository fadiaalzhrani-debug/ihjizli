-- دفع الاشتراكات بالبطاقة عبر ميسر حساب المناوب (طلبها: «اربطها بحسابي حق ميسر»): المفاتيح تلصقها فادية من لوحتي
-- وتنحفظ هنا بدون أي قراءة من المتصفح، وكل رابط دفع اشتراك له صف في sub_invoices، ولما ينتأكد من ميسر نفسه ينسجل في sub_payments.

create table if not exists public.ihj_secrets (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.ihj_secrets enable row level security;
revoke all on public.ihj_secrets from anon, authenticated;

create table if not exists public.sub_invoices (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  business_id uuid references public.businesses(id) on delete set null,
  lead_id uuid references public.signup_requests(id) on delete set null,
  kind text not null default 'monthly' check (kind in ('setup', 'monthly', 'app', 'other')),
  amount numeric(10,2) not null check (amount >= 1),
  description text not null default '',
  moyasar_id text not null default '',
  pay_url text not null default '',
  status text not null default 'issued' check (status in ('issued', 'paid', 'void')),
  paid_at timestamptz,
  method text not null default '',
  ref text not null default '',
  test boolean not null default false,
  created_at timestamptz not null default now(),
  check (business_id is not null or lead_id is not null)
);
create index if not exists sub_invoices_open on public.sub_invoices (status, created_at);
alter table public.sub_invoices enable row level security;
revoke all on public.sub_invoices from anon;
grant select on public.sub_invoices to authenticated;
drop policy if exists p_sub_invoices_admin on public.sub_invoices;
create policy p_sub_invoices_admin on public.sub_invoices for select to authenticated using (public.ihj_is_admin());
