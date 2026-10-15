-- كود الخصم يقبل حرفين أو رقمين (طلبها: «خل الكود 99 بس»)
alter table public.promo_codes drop constraint if exists promo_codes_code_check;
alter table public.promo_codes add constraint promo_codes_code_check check (code ~ '^[A-Z0-9]{2,24}$');
