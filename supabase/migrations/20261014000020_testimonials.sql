-- آراء العملاء في الموقع العام: فادية تكتبها وتنشرها وترتّبها من لوحتي، والموقع يعرض المنشور بس
-- (طلبها: «حط تعليقات ناس وأنا أقدر أتحكم في المكتوب فيها من لوحتي»). الجدول يبدأ فاضي: ما نختلق آراء.
create table if not exists public.testimonials (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  business text not null default '' check (char_length(business) <= 80),
  body text not null check (char_length(body) between 1 and 600),
  stars int not null default 5 check (stars between 1 and 5),
  published boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists testimonials_pub on public.testimonials (published, sort);
alter table public.testimonials enable row level security;
grant select on public.testimonials to anon, authenticated;
grant insert, update, delete on public.testimonials to authenticated;
drop policy if exists p_testi_public on public.testimonials;
create policy p_testi_public on public.testimonials for select to anon using (published);
drop policy if exists p_testi_admin on public.testimonials;
drop policy if exists p_testi_auth_sel on public.testimonials;
create policy p_testi_auth_sel on public.testimonials for select to authenticated using (published or public.ihj_is_admin());
drop policy if exists p_testi_ins on public.testimonials;
create policy p_testi_ins on public.testimonials for insert to authenticated with check (public.ihj_is_admin());
drop policy if exists p_testi_upd on public.testimonials;
create policy p_testi_upd on public.testimonials for update to authenticated using (public.ihj_is_admin()) with check (public.ihj_is_admin());
drop policy if exists p_testi_del on public.testimonials;
create policy p_testi_del on public.testimonials for delete to authenticated using (public.ihj_is_admin());
drop trigger if exists t_testi_touch on public.testimonials;
create trigger t_testi_touch before update on public.testimonials for each row execute function public.ihj_touch();
