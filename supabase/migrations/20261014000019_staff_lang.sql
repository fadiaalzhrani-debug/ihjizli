-- لغة رسائل الموظف: طلب جديد يوصله بالعربي أو بالإنجليزي (طلبها: «الرسالة توصل للعامل عربي أو إنجليزي»)
alter table public.staff add column if not exists lang text not null default 'ar';
alter table public.staff drop constraint if exists staff_lang_chk;
alter table public.staff add constraint staff_lang_chk check (lang in ('ar', 'en'));
