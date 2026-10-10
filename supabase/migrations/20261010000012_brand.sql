-- احجزلي · اللون الافتراضي للمنشآت الجديدة (والتجريبية اللي ما غيّرت لونها) صار نيلي بدل الأخضر
begin;
alter table public.businesses alter column brand_color set default '#4338CA';
update public.businesses set brand_color = '#4338CA' where brand_color = '#0B7A55' and is_demo;
commit;
