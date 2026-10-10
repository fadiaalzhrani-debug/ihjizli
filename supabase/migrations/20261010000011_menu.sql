-- احجزلي · القائمة الذكية: أزرار الترحيب الأولى وترتيبها، واللي يظهر بعد كل رد (تتخصص من لوحة المنشأة ومن المحاكي لكل جلسة)
begin;
alter table public.settings add column if not exists menu jsonb not null default '{}'::jsonb;
commit;
