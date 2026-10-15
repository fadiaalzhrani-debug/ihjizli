-- أكواد الخصم (طلبها: «خل السعر نفسه وعطني كود يخلي السعر 99 ريال فقط»): كود يحدد الشهري والتأسيس.
-- الزائر يكتبه في نموذج الموقع أو صفحة الدفعة الأولى، وينحفظ على طلب الاشتراك، ولما الطلب يصير منشأة ينطبق على اشتراكها.
-- الأكواد نفسها ما تنحط هنا (المستودع عام)، تنضاف من لوحتي.

create table if not exists public.promo_codes (
  code text primary key check (code ~ '^[A-Z0-9]{3,24}$'),
  label text not null default '' check (char_length(label) <= 80),
  setup_fee numeric(10,2) not null default 0 check (setup_fee >= 0),
  monthly_fee numeric(10,2) not null default 99 check (monthly_fee >= 0),
  max_uses int check (max_uses is null or max_uses > 0),
  uses int not null default 0 check (uses >= 0),
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.promo_codes enable row level security;
revoke all on public.promo_codes from anon;
grant select, insert, update, delete on public.promo_codes to authenticated;
drop policy if exists p_promo_admin on public.promo_codes;
create policy p_promo_admin on public.promo_codes for all to authenticated using (public.ihj_is_admin()) with check (public.ihj_is_admin());

alter table public.signup_requests add column if not exists promo_code text not null default '';

-- فحص كود بدون كشف باقي الأكواد
create or replace function public.ihj_promo_check(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object('ok', true, 'code', c.code, 'setup_fee', c.setup_fee, 'monthly_fee', c.monthly_fee)
      from public.promo_codes c
     where c.code = upper(trim(coalesce(p_code, '')))
       and c.active and (c.expires_at is null or c.expires_at > now())
       and (c.max_uses is null or c.uses < c.max_uses)
  ), jsonb_build_object('ok', false));
$$;
revoke all on function public.ihj_promo_check(text) from public;
grant execute on function public.ihj_promo_check(text) to anon, authenticated, service_role;

-- لما طلب الاشتراك يتحوّل لمنشأة: سعر الكود ينطبق على اشتراكها، والكود ينحسب استخدام
create or replace function public.ihj_apply_promo() returns trigger
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if new.business_id is not null and old.business_id is null and coalesce(new.promo_code, '') <> '' then
    v := public.ihj_promo_check(new.promo_code);
    if (v->>'ok')::boolean then
      update public.subscriptions set setup_fee = (v->>'setup_fee')::numeric, monthly_fee = (v->>'monthly_fee')::numeric
       where business_id = new.business_id;
      update public.promo_codes set uses = uses + 1 where code = v->>'code';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists t_lead_promo on public.signup_requests;
create trigger t_lead_promo after update of business_id on public.signup_requests for each row execute function public.ihj_apply_promo();
