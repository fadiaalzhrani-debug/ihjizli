-- احجزلي · إشعار واتساب للموظف المسؤول مع كل طلب ينسند له (قالب ihj_staff_order)
begin;
alter table public.settings add column if not exists notify_staff boolean not null default true;
commit;
