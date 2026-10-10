// فحص الجزء الصافي من «عبّيها من صورة أو موقع»: تنظيف الصفحة، الروابط، وتنقية ناتج النموذج (بدون أي اتصال)
import { normalize, htmlToText, pickLinks, urlKind, fitName, SCHEMA } from '../supabase/functions/_shared/extract-core.ts';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('✓ ' + name); } else { fail++; console.log('✗ ' + name + (extra ? ' · ' + extra : '')); } };

// المخطط: كل كائن مقفول وكل حقوله مطلوبة (شرط المخرجات المنظمة)
const objs = []; (function walk(s) { if (!s || typeof s !== 'object') return; if (s.type === 'object') objs.push(s); Object.values(s).forEach(walk); })(SCHEMA);
ok(objs.length >= 5 && objs.every((o) => o.additionalProperties === false && o.required.length === Object.keys(o.properties).length), 'المخطط مقفول وكل الحقول مطلوبة', objs.length);

const n = normalize({
  readable: true, name: ' صالون  الأناقة ', activity: 'صالون حلاقة', place_mode: 'shop',
  services: [
    { name: 'قص شعر كبار', name_en: '', price: '٤٠', price_from: false, duration_min: 30 },
    { name: 'قص  شعر كبار', price: 45 },
    { name: 'تنظيف بشرة عميق مع ماسك الذهب والكولاجين', price: 150, price_from: true, duration_min: 5 },
    { name: 'استشوار', price: null, price_from: true },
    { name: 'x', price: 10 },
  ],
  hours: [{ weekday: 6, open: '9:00', close: '24:00' }, { weekday: 5, open: '16:00', close: '01:00' }, { weekday: 7, open: '09:00', close: '10:00' }, { weekday: 1, open: '10:00', close: '10:00' }, { weekday: 0, open: '00:00', close: '00:00' }],
  branches: [{ name: '', city: 'الدمام', address: 'حي الشاطئ', maps_url: 'https://maps.app.goo.gl/abc' }, { name: 'فرع العليا', city: 'الرياض', address: '', maps_url: 'http://localhost/x' }],
  cities_served: ['الدمام', 'الدمام', 'خ'], phones: ['٠٥٥١٢٣٤٥٦٧', '12'],
  faq: [{ q: 'وش طرق الدفع؟', a: 'كاش وشبكة', keywords: ['دفع', 'شبكة', 'كاش'] }, { q: 'فيه مواقف؟', a: 'إيه متوفرة', keywords: [] }, { q: '', a: 'x', keywords: [] }],
  notes: 'الأسعار شاملة الضريبة', place_mode_x: 1,
});
ok(n.name === 'صالون الأناقة' && n.place_mode === 'shop', 'الاسم ينظف والمكان صحيح', JSON.stringify([n.name, n.place_mode]));
ok(n.services.length === 3, 'المكرر والأسماء القصيرة تنشال', JSON.stringify(n.services.map((s) => s.name)));
ok(n.services[0].price === 40, 'الأرقام العربية تتحول', String(n.services[0].price));
ok(n.services[1].name.length <= 24 && !n.services[1].name.endsWith(' ') && n.services[1].price_from && n.services[1].duration_min === null, 'الاسم الطويل يتقص بكلمات كاملة والمدة الغلط تنشال', JSON.stringify(n.services[1]));
ok(n.services[2].price === null && n.services[2].price_from === false, 'بدون سعر = «يبدأ من» ما ينفع', JSON.stringify(n.services[2]));
ok(JSON.stringify(n.hours) === JSON.stringify([{ weekday: 0, open: '00:00', close: '23:59' }, { weekday: 5, open: '16:00', close: '01:00' }, { weekday: 6, open: '09:00', close: '23:59' }]), 'الأوقات: بعد منتصف الليل تبقى، 24 ساعة، والغلط ينشال', JSON.stringify(n.hours));
ok(n.branches.length === 2 && n.branches[0].name === 'الدمام' && n.branches[0].maps && !n.branches[1].maps, 'الفروع: رابط الخرائط بس يبقى', JSON.stringify(n.branches));
ok(JSON.stringify(n.cities) === '["الدمام"]' && n.phones.length === 1 && n.phones[0] === '0551234567', 'المدن والأرقام', JSON.stringify([n.cities, n.phones]));
ok(n.faq.length === 2 && n.faq[0].q === 'دفع، شبكة، كاش' && n.faq[1].q.includes('مواقف'), 'الأسئلة: كلمات التعرف من النموذج أو من السؤال', JSON.stringify(n.faq));
ok(n.readable && normalize({ readable: false }).readable === false && normalize({}).readable === false, 'المادة الفاضية ما تنقرأ');
ok(fitName('خدمة تنظيف المكيفات الشباك الكبيرة') === 'خدمة تنظيف المكيفات', 'قص الاسم على حدود الكلمات', fitName('خدمة تنظيف المكيفات الشباك الكبيرة'));

const page = `<!doctype html><html><head><title>صالون الأناقة &amp; السبا</title><meta name="description" content="أفضل صالون في الدمام"><meta property="og:title" content="الأناقة"><style>.x{}</style><script>alert(1)</script>
<script type="application/ld+json">{"@type":"HairSalon","openingHours":"Sa-Th 09:00-23:00"}</script></head>
<body><nav><a href="/">الرئيسية</a> <a href="/prices">الأسعار</a> <a href="https://other.com/menu">منيو</a> <a href="/about">من نحن</a> <a href="/services#top">خدماتنا</a></nav>
<h1>قائمة الأسعار</h1><table><tr><td>قص شعر</td><td>40&nbsp;ريال</td></tr><tr><td>صبغة</td><td>&#1633;&#1634;&#1632;</td></tr></table><!-- تعليق --><p>نفتح يوميًا<br>من 9 الصبح</p></body></html>`;
const t = htmlToText(page);
ok(t.title === 'صالون الأناقة & السبا', 'العنوان من الصفحة', t.title);
ok(t.text.includes('أفضل صالون في الدمام') && t.text.includes('قص شعر · 40 ريال') && t.text.includes('صبغة · ١٢٠'), 'النص والجدول والوصف', t.text.slice(0, 200));
ok(!t.text.includes('alert') && !t.text.includes('.x{}') && !t.text.includes('تعليق') && t.text.includes('HairSalon'), 'السكربتات والتنسيق تنشال وبيانات schema.org تبقى');
ok(t.text.includes('نفتح يوميًا\nمن 9 الصبح'), 'الأسطر تنفصل');
const links = pickLinks(page, 'https://salon.sa/');
ok(JSON.stringify(links) === JSON.stringify(['https://salon.sa/prices', 'https://salon.sa/services']), 'روابط الأسعار والخدمات من نفس الموقع بس', JSON.stringify(links));

ok(urlKind('salon.sa').kind === 'web' && urlKind('salon.sa').url === 'https://salon.sa/', 'رابط بدون https يكتمل');
ok(['http://localhost:3000', 'http://127.0.0.1', 'http://[::1]/', 'http://10.0.0.5/x', 'ftp://x.com', 'http://a.internal', 'http://user:pw@x.com', 'http://x.com:8080'].every((u) => urlKind(u).kind === 'bad'), 'العناوين الداخلية والغريبة مرفوضة');
ok(urlKind('https://www.instagram.com/salon').kind === 'social' && urlKind('https://wa.me/9665').kind === 'social', 'حسابات التواصل تتعرف');
ok(urlKind('https://maps.app.goo.gl/xyz').kind === 'maps' && urlKind('https://www.google.com/maps/place/x').kind === 'maps', 'روابط الخرائط تتعرف');

console.log(`\n${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
