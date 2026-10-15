// يبني صفحات احجزلي المنشورة في docs/ من site-src/:
//   index.html        = الموقع العام (landing.html + نموذج الاشتراك form.html + بطاقات المجالات)
//   admin.html        = لوحتي (site-src/admin.html)
//   assets/demos.json = مجالات «جرّبه بنفسك» (منشآت تجريبية) لصفحة المحاكي
// ويتأكد إن ما فيه أي ارتباط بمشروع ثاني (اسم خافت، رقمه، مشروعه في Supabase)
// usage: node tools/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from './sql.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'site-src'), OUT = path.join(ROOT, 'docs');
const SITE_URL = 'https://almunawib.com/';
const LEAD_API = 'https://kvreqxdgjeietzsfamei.supabase.co/functions/v1/lead';
const SIM = 'sim.html?demo=1';
// الأسعار والباقات والاشتراك في الموقع العام. مطفية من 2026-10-11 بطلبها («صديقي يجرب الموقع ولا يدفع أو يعرف حتى إن فيه دفع»).
// لما تبيها ترجع: خلها true وابنِ. الصفحات الداخلية (لوحتها، الدفعة الأولى) ما تتأثر.
const SHOW_PRICES = false;

// مجالات «جرّبه بنفسك» (المنشآت التجريبية في tools/seed-presets.sql)
const PRESETS = [
  { slug: 'mahalak', icon: '🔧', color: '#4338CA', label: 'صيانة', desc: 'صيانة منزلية: الفني يجيك', tags: ['عند العميل', 'الدفع بعد الخدمة'] },
  { slug: 'salon', icon: '✂️', color: '#C2185B', label: 'صالون', desc: 'صالون وحلاقة: تحجز وتجي', tags: ['في المحل', 'الدفع قبل الحجز'] },
  { slug: 'clinic', icon: '🩺', color: '#1565C0', label: 'عيادة', desc: 'عيادة بفرعين وأسلوب رسمي', tags: ['في المحل بفرعين', 'الدفع في العيادة'] },
  { slug: 'consult', icon: '💻', color: '#6A1B9A', label: 'أونلاين', desc: 'استشارات أونلاين برابط الجلسة', tags: ['أونلاين', 'الدفع قبل الحجز'] },
  { slug: 'carwash', icon: '🚗', color: '#00838F', label: 'مغسلة', desc: 'مغسلة متنقلة بأسعار ثابتة', tags: ['عند العميل', 'فاتورة ورابط دفع'] },
  { slug: 'resto', icon: '🍽️', color: '#E65100', label: 'مطعم', desc: 'حجز طاولة في المطعم', tags: ['في المحل', 'بدون دفع'] },
];
const rows = Object.fromEntries(sql(`select slug, name, sim_key from businesses where is_demo and slug in (${PRESETS.map((p) => `'${p.slug}'`).join(',')})`).map((r) => [r.slug, r]));
const demos = PRESETS.map((p) => { const r = rows[p.slug]; if (!r) throw new Error('missing demo ' + p.slug); return { ...p, name: r.name, k: r.sim_key }; });
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'assets', 'demos.json'), JSON.stringify(demos));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fields = demos.map((d) => `<a class="field" href="sim.html?demo=1&amp;open=${d.slug}" target="_blank" rel="noopener"><div class="h"><span class="em">${d.icon}</span><div><b>${esc(d.label)}</b><div class="tiny">${esc(d.desc)}</div></div></div><div class="tags">${d.tags.map((t) => `<i>${esc(t)}</i>`).join('')}</div><span class="go">جرّبه ←</span></a>`).join('\n    ');

const meta = `<meta name="description" content="المناوب: الشغل كله أوتوماتيك على نفس رقم واتسابك، من أول رد لين الحجز والتذكير والفاتورة، والتجهيز كله علينا، ومعه موقع باسمك. لأي نشاط: صيانة، صالون، عيادة، أونلاين، مغسلة، مطعم.${SHOW_PRICES ? " تأسيس مرة وحدة واشتراك شهري ثابت." : ""}">
<meta name="theme-color" content="#F6FAF8">
<link rel="canonical" href="${SITE_URL}">
<meta property="og:type" content="website">
<meta property="og:locale" content="ar_SA">
<meta property="og:url" content="${SITE_URL}">
<meta property="og:site_name" content="المناوب">
<meta property="og:title" content="المناوب · يرد، ينسّق، ويحجز. كلّه عنك">
<meta property="og:description" content="المناوب يتولّى محادثات عملائك ومواعيدهم على الواتساب، على نفس رقمك: يعرض المتاح ويحجز، يذكّرهم، والفاتورة في نفس المحادثة. التجهيز علينا.">
<meta property="og:image" content="${SITE_URL}img/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="المناوب · يرد، ينسّق، ويحجز. كلّه عنك">
<meta name="twitter:image" content="${SITE_URL}img/og.png">`;

let page = fs.readFileSync(path.join(SRC, 'landing.html'), 'utf8');
let form = fs.readFileSync(path.join(SRC, 'form.html'), 'utf8');
const sitebot = fs.readFileSync(path.join(SRC, 'sitebot.html'), 'utf8');
for (const [k, v] of [['<!--HEAD_META-->', meta], ['<!--FIELDS-->', fields], ['<!--FORM-->', form], ['<!--SITEBOT-->', sitebot]]) {
  if (!page.includes(k)) { if (k === '<!--FIELDS-->') continue; throw new Error('missing placeholder ' + k); }
  page = page.replace(k, v);
}
// آراء العملاء تنقرا من القاعدة بمفتاح القراءة العام (نفس اللي في اللوحات، والجدول يعرض المنشور بس)
const ANON_KEY = (/const ANON = '([^']+)'/.exec(fs.readFileSync(path.join(OUT, 'assets/ihj.js'), 'utf8')) || [])[1];
if (!ANON_KEY) throw new Error('anon key not found in assets/ihj.js');
page = page.split('SIMLINK').join(SIM).split('LEADAPI').join(LEAD_API).split('TESTIAPI').join('https://kvreqxdgjeietzsfamei.supabase.co/rest/v1/testimonials').split('ANONKEY').join(ANON_KEY);
// علامات الأسعار: <!--P--> و/*P*/ للي يطلع مع الأسعار بس، و<!--NP--> و/*NP*/ للي يطلع بدونها
const keep = (re, on) => { page = page.replace(re, on ? '$1' : ''); };
keep(/<!--P-->([\s\S]*?)<!--\/P-->/g, SHOW_PRICES); keep(/\/\*P\*\/([\s\S]*?)\/\*\/P\*\//g, SHOW_PRICES);
keep(/<!--NP-->([\s\S]*?)<!--\/NP-->/g, !SHOW_PRICES); keep(/\/\*NP\*\/([\s\S]*?)\/\*\/NP\*\//g, !SHOW_PRICES);
if (/<!--\/?N?P-->|\/\*\/?N?P\*\//.test(page)) throw new Error('علامة أسعار ما انشالت في index');
if (!SHOW_PRICES) {
  // الأرقام وجمل الاشتراك ممنوعة في كل الصفحة (حتى السكربت)، وكلمة اشتراك أو باقة ممنوعة في النص الظاهر
  const visible = page.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  for (const [text, re] of [[page, /3,500|5,500|9,000|350 ريال|600 ريال|150 شهريًا|45 ريال|قبل الضريبة|تأسيس|الاشتراك الشهري|ضمن الاشتراك|نموذج الاشتراك \(|باقتين/], [visible, /اشتراك|اشترك|الباقات|الباقة/]]) {
    const m = re.exec(text);
    if (m) throw new Error('الأسعار مخفية بس باقي في الموقع: «' + m[0] + '» عند: ' + text.slice(Math.max(0, m.index - 80), m.index + 40).replace(/\s+/g, ' '));
  }
}
{ const vis = page.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, ''); const m = /البوت|بوت واتساب|رد تلقائي/.exec(vis); if (m) throw new Error('كلمة ممنوعة في الرئيسية: «' + m[0] + '» (نقول «رد آلي»)'); }
if (/SIMLINK|LEADAPI|TESTIAPI|ANONKEY|<!--[A-Z_]+-->/.test(page)) throw new Error('unreplaced placeholder in index');

let admin = fs.readFileSync(path.join(SRC, 'admin.html'), 'utf8');
if (/<!--[A-Z_]+-->/.test(admin)) throw new Error('unreplaced placeholder in admin');

// فحوص الاستقلال على كل الصفحات المنشورة
const files = { 'index.html': page, 'admin.html': admin };
for (const f of fs.readdirSync(OUT)) if (/\.html$/.test(f) && !files[f]) files[f] = fs.readFileSync(path.join(OUT, f), 'utf8');
for (const f of ['assets/ihj.js', 'assets/ihj.css', 'assets/demos.json']) files[f] = fs.readFileSync(path.join(OUT, f), 'utf8');
for (const [name, s] of Object.entries(files)) {
  if (/خاف[ً-ْ]*ت|khafet|Khaft/i.test(s)) throw new Error(`اسم خافت في ${name}`);
  if (/966504652455|0504652455|zulogtqxbuqxmdmjpzqj/.test(s)) throw new Error(`رقم أو مشروع خارجي في ${name}`);
  if (/[—–]/.test(s.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, ''))) console.warn(`تنبيه: شرطة اعتراضية في نصوص ${name}`);
}
fs.writeFileSync(path.join(OUT, 'index.html'), page);
fs.writeFileSync(path.join(OUT, 'admin.html'), admin);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log('built: index', Math.round(page.length / 1024) + 'KB', '| admin', Math.round(admin.length / 1024) + 'KB', '| demos', demos.length);
