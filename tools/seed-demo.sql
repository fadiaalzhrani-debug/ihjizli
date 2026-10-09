-- المنشآت التجريبية: «محلك» (للعرض والفحص) و«منشأة اختبار» (لفحص فصل البيانات والأسعار الثابتة والسعة الثابتة)
-- آمن للتكرار: ما ينشئ شي موجود
do $$
begin
  if not exists (select 1 from public.businesses where slug = 'mahalak') then
    perform public.ihj_create_business($j${
      "slug": "mahalak", "name": "محلك", "name_en": "Mahalak", "activity": "صيانة منزلية", "city": "الخبر",
      "is_demo": true, "plan": "bot_pay", "brand_color": "#0B7A55", "address": "الخبر",
      "cities": [
        {"name": "الخبر", "name_en": "Khobar", "lat": 26.2794, "lng": 50.2083, "radius_km": 18},
        {"name": "الدمام", "name_en": "Dammam", "lat": 26.4207, "lng": 50.0888, "radius_km": 20},
        {"name": "الظهران", "name_en": "Dhahran", "lat": 26.2886, "lng": 50.1140, "radius_km": 9}
      ],
      "services": [{"name": "زيارة فني", "name_en": "Technician visit"}],
      "staff": [
        {"name": "أحمد", "cities": ["الخبر", "الظهران"]},
        {"name": "خالد", "cities": ["الدمام", "الخبر"]}
      ],
      "settings": {"slot_minutes": 60, "days_ahead": 7, "lead_minutes": 60, "reminder_minutes": 120, "pay_provider": "demo"}
    }$j$::jsonb);
  end if;
  if not exists (select 1 from public.businesses where slug = 'test-b') then
    perform public.ihj_create_business($j${
      "slug": "test-b", "name": "منشأة اختبار", "name_en": "Test Biz", "activity": "اختبار", "city": "الرياض",
      "is_demo": true, "plan": "bot", "brand_color": "#1F4E79",
      "cities": [{"name": "الرياض", "name_en": "Riyadh", "lat": 24.7136, "lng": 46.6753, "radius_km": 40}],
      "services": [
        {"name": "غسيل", "name_en": "Wash", "price": 50, "duration_min": 60},
        {"name": "تلميع", "name_en": "Polish", "price": 120, "duration_min": 120}
      ],
      "settings": {"capacity_mode": "fixed", "capacity_per_slot": 2, "slot_minutes": 60, "lead_minutes": 30, "pay_provider": "demo"}
    }$j$::jsonb);
  end if;
end $$;
select slug, name, sim_key, plan, is_demo from public.businesses order by created_at;
