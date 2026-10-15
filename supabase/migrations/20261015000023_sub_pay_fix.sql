-- إصلاحات مراجعة دفع الاشتراكات بالبطاقة:
-- روابط الدفع لمنشآت بس (بدون طلبات اشتراك عامة)، التسجيل ذرّي مرة وحدة، التجربة ما تنسجل دفعة،
-- أي دفعة تلغي الروابط المفتوحة لنفس النوع، والدفعات توصل لوحتي لحظيًا.

delete from public.sub_invoices where business_id is null;
alter table public.sub_invoices drop constraint if exists sub_invoices_check;
alter table public.sub_invoices drop column if exists lead_id;
alter table public.sub_invoices drop constraint if exists sub_invoices_business_id_fkey;
alter table public.sub_invoices alter column business_id set not null;
alter table public.sub_invoices add constraint sub_invoices_business_id_fkey foreign key (business_id) references public.businesses(id) on delete cascade;
alter table public.sub_invoices add column if not exists checked_at timestamptz;

alter table public.sub_payments add column if not exists sub_invoice_id uuid unique references public.sub_invoices(id) on delete set null;

-- اعتماد دفعة بطاقة: مرة وحدة بقفل الصف. التجربة تنعلّم مدفوعة بدون ما تنسجل دفعة.
-- الشهري قبل التشغيل (ما بدأ الاشتراك): ينسجل بدون ما يغيّر تاريخ التجديد.
create or replace function public.ihj_sub_settle(p_id uuid, p_method text, p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.sub_invoices; s public.subscriptions;
  v_today date := (now() at time zone 'Asia/Riyadh')::date; v_cov date; v_pre boolean; v_note text;
begin
  select * into r from public.sub_invoices where id = p_id for update;
  if not found then return jsonb_build_object('ok', false); end if;
  if r.status = 'paid' then return jsonb_build_object('ok', true, 'already', true); end if;
  update public.sub_invoices set status = 'paid', paid_at = now(), method = coalesce(p_method, ''), ref = coalesce(p_ref, '') where id = p_id;
  if r.test then return jsonb_build_object('ok', true, 'test', true); end if;
  select * into s from public.subscriptions where business_id = r.business_id;
  v_pre := r.kind = 'monthly' and s.started_on is null;
  if r.kind = 'monthly' and not v_pre then
    v_cov := (greatest(coalesce(s.next_renewal, v_today), v_today) + interval '1 month')::date;
  end if;
  v_note := 'بطاقة عبر ميسر (' || coalesce(nullif(p_method, ''), 'بطاقة') || ')'
    || case when r.status = 'void' then ' · دفع رابط كان ملغي' else '' end
    || case when v_pre then ' · أول شهر، يبدأ من التشغيل' else '' end;
  insert into public.sub_payments (business_id, amount, kind, paid_on, covers_until, note, sub_invoice_id)
  values (r.business_id, r.amount, r.kind, v_today, v_cov, v_note, r.id);
  if v_cov is not null then update public.subscriptions set next_renewal = v_cov, updated_at = now() where business_id = r.business_id; end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.ihj_sub_settle(uuid, text, text) from public, anon, authenticated;
grant execute on function public.ihj_sub_settle(uuid, text, text) to service_role;

-- أي دفعة (بطاقة أو مسجلة يدويًا) تلغي روابط البطاقة المفتوحة لنفس المنشأة ونفس النوع
create or replace function public.ihj_sub_void_open() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.sub_invoices set status = 'void'
   where business_id = new.business_id and kind = new.kind and status = 'issued' and id is distinct from new.sub_invoice_id;
  return new;
end $$;
drop trigger if exists t_subpay_void on public.sub_payments;
create trigger t_subpay_void after insert on public.sub_payments for each row execute function public.ihj_sub_void_open();

do $$ begin
  begin alter publication supabase_realtime add table public.sub_payments; exception when duplicate_object then null; end;
end $$;
