-- احجزلي · رابط اتفاقية ورابط نموذج عامّين (بدون مفتاح منشأة): الموافقة والبيانات تنحفظ على طلب الاشتراك بجوال العميل،
-- ولما يتحوّل الطلب لمنشأة تنتقل لها تلقائيًا (والخطوات في دليل التشغيل تتعلّم لحالها)
begin;

alter table public.signup_requests add column if not exists agreed_at timestamptz;
alter table public.signup_requests add column if not exists agreed_name text not null default '';
alter table public.signup_requests add column if not exists agreed_terms jsonb not null default '{}'::jsonb;
alter table public.signup_requests add column if not exists intake jsonb not null default '{}'::jsonb;
alter table public.signup_requests add column if not exists intake_at timestamptz;
create index if not exists signup_requests_phone on public.signup_requests (phone, created_at desc);

create or replace function public.ihj_docs_from_lead() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.lead_id is null then return new; end if;
  select agreed_at, agreed_name, phone, agreed_terms, intake, intake_at into r from public.signup_requests where id = new.lead_id;
  if not found or (r.agreed_at is null and r.intake_at is null) then return new; end if;
  insert into public.client_docs (business_id, agreed_at, agreed_name, agreed_phone, agreed_terms, intake, intake_at, updated_at)
  values (new.id, r.agreed_at, coalesce(r.agreed_name, ''), coalesce(r.phone, ''), coalesce(r.agreed_terms, '{}'::jsonb),
          case when r.intake_at is null then '{}'::jsonb else coalesce(r.intake, '{}'::jsonb) end, r.intake_at, now())
  on conflict (business_id) do update set
    agreed_at = coalesce(public.client_docs.agreed_at, excluded.agreed_at),
    agreed_name = case when public.client_docs.agreed_at is null then excluded.agreed_name else public.client_docs.agreed_name end,
    agreed_phone = case when public.client_docs.agreed_at is null then excluded.agreed_phone else public.client_docs.agreed_phone end,
    agreed_terms = case when public.client_docs.agreed_at is null then excluded.agreed_terms else public.client_docs.agreed_terms end,
    intake = case when public.client_docs.intake_at is null then excluded.intake else public.client_docs.intake end,
    intake_at = coalesce(public.client_docs.intake_at, excluded.intake_at),
    updated_at = now();
  return new;
end $$;
revoke all on function public.ihj_docs_from_lead() from public, anon, authenticated;

drop trigger if exists businesses_docs_from_lead on public.businesses;
create trigger businesses_docs_from_lead after insert on public.businesses
  for each row execute function public.ihj_docs_from_lead();

commit;
