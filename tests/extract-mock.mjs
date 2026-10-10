// قراءة تجريبية للفحص والصور: نتيجة مطابقة لصورة قائمة «صالونك» التجريبية، وتبديلها داخل المتصفح بدل الخادم
export const SAMPLE = {
  readable: true, name: 'صالونك', name_en: '', activity: 'صالون حلاقة رجالي', place_mode: 'shop',
  services: [
    { name: 'قص شعر', name_en: '', price: 60, price_from: false, duration_min: 30 },
    { name: 'قص شعر أطفال', name_en: '', price: 40, price_from: false, duration_min: 30 },
    { name: 'حلاقة ذقن', name_en: '', price: 30, price_from: false, duration_min: 20 },
    { name: 'تحديد لحية', name_en: '', price: 20, price_from: false, duration_min: null },
    { name: 'صبغة', name_en: '', price: 120, price_from: true, duration_min: 60 },
    { name: 'بروتين', name_en: '', price: 250, price_from: true, duration_min: 90 },
    { name: 'تنظيف بشرة', name_en: '', price: 90, price_from: false, duration_min: 45 },
    { name: 'مساج رأس', name_en: '', price: 40, price_from: false, duration_min: 20 },
  ],
  hours: [0, 1, 2, 3, 4, 6].map((w) => ({ weekday: w, open: '13:00', close: '00:00' })).concat([{ weekday: 5, open: '16:00', close: '00:00' }]).sort((a, b) => a.weekday - b.weekday),
  branches: [{ name: 'فرع العليا', city: 'الرياض', address: 'طريق العليا', maps: '' }], cities: [], phones: [],
  faq: [{ chip: 'وش طرق الدفع؟', q: 'دفع، شبكة، مدى، كاش، ابل باي', a: 'نقبل كاش ومدى وأبل باي 💳' }, { chip: 'فيه مواقف؟', q: 'مواقف، موقف، باركينق', a: 'إيه، فيه مواقف قدام الصالون 🚗' }],
  notes: 'الأسعار شاملة الضريبة',
};
// نتيجة القراءة تتبدل داخل المتصفح (بدون ما نلمس الخادم أو نصرف من الرصيد)
export const MOCK = (aiReady = true, data = SAMPLE) => `(() => { const real = window.fetch; window.__reads = 0; window.fetch = async (u, o) => { const s = String(u);
  if (/\\/api\\/(biz|client)\\/extract/.test(s)) { window.__reads++; window.__lastRead = o && o.body ? JSON.parse(o.body) : null; await new Promise((r) => setTimeout(r, 700)); return new Response(JSON.stringify({ ok: true, data: ${JSON.stringify(data)}, sources: [] }), { headers: { 'content-type': 'application/json' } }); }
  if (/\\/api\\/client\\/ai$/.test(s)) return new Response(JSON.stringify({ ok: true, ready: ${aiReady} }), { headers: { 'content-type': 'application/json' } });
  return real(u, o); }; })();`;
// صورة تجريبية تنحط في خانة الصور مثل ما يختارها المستخدم
export const PICK = `(async () => { const c = document.createElement('canvas'); c.width = 600; c.height = 800; const g = c.getContext('2d'); g.fillStyle = '#1d1b2e'; g.fillRect(0, 0, 600, 800); g.fillStyle = '#f2b705'; g.font = 'bold 44px Tahoma'; g.textAlign = 'center'; g.fillText('قائمة الأسعار', 300, 110);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png')); const dt = new DataTransfer(); dt.items.add(new File([blob], 'menu.png', { type: 'image/png' }));
  const inp = document.getElementById('rdFile'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`;
