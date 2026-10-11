-- عميل يبي يشتري بكج والمنشأة بدون دفع إلكتروني: يتحوّل لها بسبب «package»
begin;
alter table public.handoffs drop constraint if exists handoffs_reason_check;
alter table public.handoffs add constraint handoffs_reason_check check (reason in ('unknown','complaint','human','location','order','package'));
commit;
