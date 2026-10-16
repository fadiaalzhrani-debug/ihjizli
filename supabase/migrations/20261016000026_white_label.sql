-- منشأة «مفصولة عن المناوب» (بطلب فادية لسو كلين: «خله مفصول عن المناوب»):
-- صفحاتها للعميل (نموذج البيانات) تطلع باسم المنشأة وشعارها ولونها، بدون اسم المناوب ولا روابطه.
alter table public.businesses add column if not exists white_label boolean not null default false;
update public.businesses set white_label = true where slug = 'soclean';
