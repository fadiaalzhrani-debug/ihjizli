-- مجالات «جرّبه بنفسك»: منشآت تجريبية بأسماء عامة (صالونك، عيادتك...) كل وحدة بطريقة مختلفة
-- (عند العميل / في المحل / أونلاين) × (الدفع بعد / قبل / في المحل). آمن للتكرار.
do $$
begin
  -- محلك: صيانة منزلية · زيارة · الدفع بعد الخدمة (موجودة من قبل): أسئلتها وعربون التجربة
  update public.settings set prepay_amount = 50,
    faq = $j$[
      {"q": "ضمان, الضمان", "a": "شغلنا عليه ضمان 30 يوم، ولو صار شي خلال الضمان نجيك بدون تكلفة 👍", "chip": "عندكم ضمان؟"},
      {"q": "قطع غيار, القطع", "a": "الفني يجيب القطع الأساسية معه، ولو احتجنا قطعة خاصة نبلغك بسعرها قبل التركيب.", "chip": "تجيبون القطع؟"}
    ]$j$::jsonb
  where business_id = (select id from public.businesses where slug = 'mahalak');

  if not exists (select 1 from public.businesses where slug = 'salon') then
    perform public.ihj_create_business($j${
      "slug": "salon", "name": "صالونك", "name_en": "Your Salon", "activity": "صالون وحلاقة", "city": "الخبر", "is_demo": true, "plan": "bot_pay",
      "cities": [{"name": "فرع الخبر", "name_en": "Khobar branch", "lat": 26.2869, "lng": 50.2097, "radius_km": 30}],
      "services": [{"name": "قص شعر", "name_en": "Haircut", "price": 60, "duration_min": 30}, {"name": "حلاقة ذقن", "name_en": "Beard", "price": 30, "duration_min": 30}, {"name": "صبغة", "name_en": "Coloring", "price": 120, "duration_min": 60}],
      "hours": [{"weekday":0,"open":"10:00","close":"23:00"},{"weekday":1,"open":"10:00","close":"23:00"},{"weekday":2,"open":"10:00","close":"23:00"},{"weekday":3,"open":"10:00","close":"23:00"},{"weekday":4,"open":"10:00","close":"23:30"},{"weekday":5,"open":"16:00","close":"23:30"},{"weekday":6,"open":"10:00","close":"23:00"}],
      "settings": {"slot_minutes": 30, "days_ahead": 7, "lead_minutes": 30, "capacity_mode": "fixed", "capacity_per_slot": 3, "pay_provider": "demo",
        "place_mode": "shop", "pay_timing": "before", "tone": "friendly", "hold_minutes": 20,
        "faq": [{"q": "بدون موعد, بدون حجز, اجي الحين", "a": "نستقبل بدون موعد لو فيه كرسي فاضي، والحجز يضمن لك دورك بدون انتظار ✂️", "chip": "تستقبلون بدون موعد؟"},
                {"q": "اطفال, طفل, ولدي", "a": "إيه، نقص للأطفال بنفس أسعار القص 👦", "chip": "تقصون للأطفال؟"}]}
    }$j$::jsonb);
  end if;

  if not exists (select 1 from public.businesses where slug = 'clinic') then
    perform public.ihj_create_business($j${
      "slug": "clinic", "name": "عيادتك", "name_en": "Your Clinic", "activity": "عيادة أو مركز", "city": "الرياض", "is_demo": true, "plan": "bot",
      "cities": [{"name": "فرع الملقا", "name_en": "Malqa branch", "lat": 24.8064, "lng": 46.6119, "radius_km": 40}, {"name": "فرع الحمراء", "name_en": "Hamra branch", "lat": 24.7745, "lng": 46.7522, "radius_km": 40}],
      "services": [{"name": "كشف عام", "name_en": "Consultation", "price": 150, "duration_min": 20}, {"name": "متابعة", "name_en": "Follow-up", "price": 100, "duration_min": 20}],
      "hours": [{"weekday":0,"open":"09:00","close":"21:00"},{"weekday":1,"open":"09:00","close":"21:00"},{"weekday":2,"open":"09:00","close":"21:00"},{"weekday":3,"open":"09:00","close":"21:00"},{"weekday":4,"open":"09:00","close":"21:00"},{"weekday":6,"open":"16:00","close":"21:00"}],
      "settings": {"slot_minutes": 20, "days_ahead": 10, "lead_minutes": 60, "capacity_mode": "fixed", "capacity_per_slot": 2, "pay_provider": "demo",
        "place_mode": "shop", "pay_timing": "none", "tone": "formal",
        "faq": [{"q": "تامين, التامين", "a": "نستقبل أغلب شركات التأمين. أرسل لنا اسم شركة التأمين ونؤكد لك قبل الموعد.", "chip": "تقبلون التأمين؟"},
                {"q": "صيام, صايم, اكل قبل", "a": "الكشف العام ما يحتاج صيام. لو فيه تحليل يحتاج صيام نبلغك قبل الموعد.", "chip": "يحتاج صيام؟"}]}
    }$j$::jsonb);
  end if;

  if not exists (select 1 from public.businesses where slug = 'consult') then
    perform public.ihj_create_business($j${
      "slug": "consult", "name": "استشارتك", "name_en": "Your Consultancy", "activity": "استشارات أونلاين", "city": "", "is_demo": true, "plan": "bot_pay",
      "services": [{"name": "استشارة 30 دقيقة", "name_en": "30 min session", "price": 150, "duration_min": 30}, {"name": "جلسة ساعة", "name_en": "1 hour session", "price": 250, "duration_min": 60}],
      "hours": [{"weekday":0,"open":"16:00","close":"23:00"},{"weekday":1,"open":"16:00","close":"23:00"},{"weekday":2,"open":"16:00","close":"23:00"},{"weekday":3,"open":"16:00","close":"23:00"},{"weekday":4,"open":"16:00","close":"23:00"},{"weekday":6,"open":"12:00","close":"20:00"}],
      "settings": {"slot_minutes": 30, "days_ahead": 7, "lead_minutes": 120, "capacity_mode": "fixed", "capacity_per_slot": 1, "pay_provider": "demo",
        "place_mode": "online", "pay_timing": "before", "tone": "formal", "hold_minutes": 30,
        "online_note": "أونلاين عبر قوقل ميت، ويوصلك رابط الجلسة قبل الموعد بساعة",
        "faq": [{"q": "الغاء, استرجاع, استرداد", "a": "تقدر تلغي أو تغيّر الموعد من «طلباتي» قبل الموعد بـ 12 ساعة.", "chip": "أقدر أغيّر الموعد؟"},
                {"q": "زوم, قوقل ميت, تطبيق", "a": "الجلسة على قوقل ميت من الجوال أو الكمبيوتر، وما تحتاج تحمّل شي.", "chip": "على أي برنامج؟"}]}
    }$j$::jsonb);
  end if;

  if not exists (select 1 from public.businesses where slug = 'carwash') then
    perform public.ihj_create_business($j${
      "slug": "carwash", "name": "مغسلتك", "name_en": "Your Car Wash", "activity": "مغسلة متنقلة", "city": "الرياض", "is_demo": true, "plan": "bot_pay",
      "cities": [{"name": "الرياض", "name_en": "Riyadh", "lat": 24.7136, "lng": 46.6753, "radius_km": 40}],
      "services": [{"name": "غسيل خارجي", "name_en": "Exterior wash", "price": 40, "duration_min": 30}, {"name": "غسيل كامل", "name_en": "Full wash", "price": 90, "duration_min": 60}, {"name": "تلميع", "name_en": "Polish", "price": 250, "duration_min": 120}],
      "staff": [{"name": "فريق 1", "cities": ["الرياض"]}, {"name": "فريق 2", "cities": ["الرياض"]}],
      "settings": {"slot_minutes": 60, "days_ahead": 7, "lead_minutes": 60, "pay_provider": "demo", "place_mode": "visit", "pay_timing": "after", "tone": "friendly",
        "faq": [{"q": "موية, ماء, كهربا", "a": "نجيك بمعداتنا ومويتنا، ما نحتاج منك شي غير مكان السيارة 🚗", "chip": "تحتاجون موية؟"},
                {"q": "عمارة, قبو, مواقف", "a": "نغسل في مواقف العماير والقبو لو فيه مساحة حول السيارة.", "chip": "تجون للعمارة؟"}]}
    }$j$::jsonb);
  end if;

  if not exists (select 1 from public.businesses where slug = 'resto') then
    perform public.ihj_create_business($j${
      "slug": "resto", "name": "مطعمك", "name_en": "Your Restaurant", "activity": "مطعم أو كافيه", "city": "جدة", "is_demo": true, "plan": "bot",
      "cities": [{"name": "فرع جدة", "name_en": "Jeddah branch", "lat": 21.5433, "lng": 39.1728, "radius_km": 40}],
      "services": [{"name": "طاولة لشخصين", "name_en": "Table for 2", "duration_min": 90}, {"name": "طاولة 4 أشخاص", "name_en": "Table for 4", "duration_min": 90}, {"name": "جلسة عائلية", "name_en": "Family room", "duration_min": 120}],
      "hours": [{"weekday":0,"open":"13:00","close":"00:30"},{"weekday":1,"open":"13:00","close":"00:30"},{"weekday":2,"open":"13:00","close":"00:30"},{"weekday":3,"open":"13:00","close":"00:30"},{"weekday":4,"open":"13:00","close":"01:30"},{"weekday":5,"open":"13:00","close":"01:30"},{"weekday":6,"open":"13:00","close":"00:30"}],
      "settings": {"slot_minutes": 30, "days_ahead": 7, "lead_minutes": 30, "capacity_mode": "fixed", "capacity_per_slot": 6, "pay_provider": "none",
        "place_mode": "shop", "pay_timing": "none", "tone": "friendly",
        "faq": [{"q": "منيو, المنيو, القائمه", "a": "المنيو يوصلك هنا قبل موعدك، وتقدر تطلب أول ما توصل 🍽️", "chip": "وين المنيو؟"},
                {"q": "عيد ميلاد, مناسبه, تزيين", "a": "نجهز لمناسبتك تزيين بسيط وكيكة لو طلبتها قبل يوم 🎉", "chip": "تجهزون لمناسبة؟"}]}
    }$j$::jsonb);
  end if;
end $$;
select slug, name, sim_key from public.businesses where is_demo order by created_at;
