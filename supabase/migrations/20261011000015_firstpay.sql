-- الدفعة الأولى: الموافقة على الاتفاقية صارت خانة صح داخل صفحة الدفع، وبيانات التحويل تنحفظ من لوحتها
-- (وتطلع للعميل بعد ما يوافق بس)، وزر «حوّلت» يسجّل ويوصلها تنبيه.

create table if not exists public.ihj_config (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.ihj_config enable row level security;
revoke all on public.ihj_config from anon;
grant select, insert, update, delete on public.ihj_config to authenticated;
drop policy if exists p_cfg_admin on public.ihj_config;
create policy p_cfg_admin on public.ihj_config for all to authenticated using (public.ihj_is_admin()) with check (public.ihj_is_admin());

alter table public.client_docs add column if not exists paid_claim_at timestamptz;
alter table public.signup_requests add column if not exists paid_claim_at timestamptz;

-- لما الطلب يتحوّل لمنشأة: الموافقة والبيانات و«حوّلت» تنتقل معه
create or replace function public.ihj_docs_from_lead() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.lead_id is null then return new; end if;
  select agreed_at, agreed_name, phone, agreed_terms, intake, intake_at, paid_claim_at into r from public.signup_requests where id = new.lead_id;
  if not found or (r.agreed_at is null and r.intake_at is null and r.paid_claim_at is null) then return new; end if;
  insert into public.client_docs (business_id, agreed_at, agreed_name, agreed_phone, agreed_terms, intake, intake_at, paid_claim_at, updated_at)
  values (new.id, r.agreed_at, coalesce(r.agreed_name, ''), coalesce(r.phone, ''), coalesce(r.agreed_terms, '{}'::jsonb),
          case when r.intake_at is null then '{}'::jsonb else coalesce(r.intake, '{}'::jsonb) end, r.intake_at, r.paid_claim_at, now())
  on conflict (business_id) do update set
    agreed_at = coalesce(public.client_docs.agreed_at, excluded.agreed_at),
    agreed_name = case when public.client_docs.agreed_at is null then excluded.agreed_name else public.client_docs.agreed_name end,
    agreed_phone = case when public.client_docs.agreed_at is null then excluded.agreed_phone else public.client_docs.agreed_phone end,
    agreed_terms = case when public.client_docs.agreed_at is null then excluded.agreed_terms else public.client_docs.agreed_terms end,
    intake = case when public.client_docs.intake_at is null then excluded.intake else public.client_docs.intake end,
    intake_at = coalesce(public.client_docs.intake_at, excluded.intake_at),
    paid_claim_at = coalesce(public.client_docs.paid_claim_at, excluded.paid_claim_at),
    updated_at = now();
  return new;
end $$;
revoke all on function public.ihj_docs_from_lead() from public, anon, authenticated;
