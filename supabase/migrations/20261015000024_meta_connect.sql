-- الربط المباشر بواتساب: المناوب «مزوّد تقني» عند ميتا (Tech Provider)، وصاحب المحل يربط رقمه بنفسه
-- من connect.html بزر «اربط واتسابك» (Embedded Signup). إعدادات تطبيق ميتا في ihj_config (meta_es)
-- وسرّه ورمز تحقق الويبهوك في ihj_secrets، ومفتاح كل محل في business_secrets مثل قبل.

alter table public.channels add column if not exists onboarded_via text not null default '';
alter table public.channels add column if not exists coex boolean not null default false;
alter table public.channels add column if not exists portfolio_id text not null default '';
alter table public.channels add column if not exists token_expires_at timestamptz;
alter table public.channels add column if not exists connected_at timestamptz;
create index if not exists channels_waba_idx on public.channels (waba_id) where waba_id <> '';

alter table public.business_secrets add column if not exists wa_pin text not null default '';

-- طلبات الخصوصية من privacy.html (حذف بيانات أو سؤال): للمدير بس
create table if not exists public.data_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'delete' check (kind in ('delete', 'question')),
  name text not null default '',
  phone text not null default '',
  business text not null default '',
  note text not null default '',
  status text not null default 'new' check (status in ('new', 'done')),
  ip text not null default '',
  created_at timestamptz not null default now(),
  done_at timestamptz
);
alter table public.data_requests enable row level security;
revoke all on public.data_requests from anon;
grant select, update, delete on public.data_requests to authenticated;
drop policy if exists p_dr_admin on public.data_requests;
create policy p_dr_admin on public.data_requests for all to authenticated using (public.ihj_is_admin()) with check (public.ihj_is_admin());

do $$ begin
  begin alter publication supabase_realtime add table public.data_requests; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.channels; exception when duplicate_object then null; end;
end $$;

-- تسجيل الرقم الجديد عند ميتا لو فشل (يبقى لين ينجح، وفحص الربط ما يمسحه)
alter table public.channels add column if not exists register_error text not null default '';
