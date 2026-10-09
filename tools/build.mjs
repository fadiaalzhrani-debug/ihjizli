// يبني صفحات احجزلي المنشورة في docs/ من site-src/:
//   index.html  = صفحة العرض landing.html + نموذج الاشتراك form.html (الخلفية: دالة lead في مشروع ihjizli)
//   admin.html  = لوحتي + دليل البيع
// ويتأكد إن ما فيه أي ارتباط بمشروع ثاني (اسم خافت، رقمه، مشروعه في Supabase)
// usage: node tools/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from './sql.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'site-src'), OUT = path.join(ROOT, 'docs');
const SITE_URL = 'https://fadiaalzhrani-debug.github.io/ihjizli/';
const LEAD_API = 'https://kvreqxdgjeietzsfamei.supabase.co/functions/v1/lead';
// رقم واتساب احجزلي للتواصل (فاضي = بدون زر واتساب، والتواصل من النموذج والمحاكي)
const CONTACT_WA = '';

const demo = sql(`select slug, sim_key from businesses where slug = 'mahalak'`)[0];
if (!demo) throw new Error('demo business mahalak missing');
const SIM = `sim.html?b=${demo.slug}&k=${demo.sim_key}`;

let page = fs.readFileSync(path.join(SRC, 'landing.html'), 'utf8');
let form = fs.readFileSync(path.join(SRC, 'form.html'), 'utf8');
const must = (from, to, where = 'page') => {
  const s = where === 'page' ? page : form;
  if (!s.includes(from)) throw new Error(`missing in ${where}: ${from.slice(0, 70)}`);
  if (where === 'page') page = s.split(from).join(to); else form = s.split(from).join(to);
};

// ── نموذج الاشتراك: الخلفية الجديدة، وبدون رقم مشروع ثاني ──
must("var API='https://zulogtqxbuqxmdmjpzqj.supabase.co/functions/v1/ihjizli/lead';", `var API='${LEAD_API}';`, 'form');
form = form.replace(/<p>نتواصل معك على الواتساب خلال يوم عمل\.[^<]*<\/p>\s*<a class="btn" href="https:\/\/wa\.me\/[^"]*"[^>]*>افتح الواتساب<\/a>/,
  `<p>نتواصل معك على الواتساب خلال يوم عمل. وبالانتظار، جرّب النظام بنفسك:</p>\n    <a class="btn" href="${SIM}" target="_blank" rel="noopener">جرّبه بنفسك</a>`);

// ── صفحة العرض ──
const waHref = /https:\/\/wa\.me\/966504652455\?text=[^"]*/g;
must('<span class="live"><i></i>النظام نفسه يشتغل اليوم عند مؤسسة صيانة منزلية في الخبر</span>',
  `<a class="live" href="${SIM}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit"><i></i>جرّبه الحين: محادثة واتساب حية، بدون تسجيل</a>`);
must('<li><svg class="ic"><use href="#i-check"/></svg>فواتير PDF بالعربي ورابط دفع (مدى، أبل باي، بطاقة، تمارا)</li>',
  '<li><svg class="ic"><use href="#i-check"/></svg>فواتير PDF بالعربي ورابط دفع (مدى، أبل باي، بطاقة)</li>');
must('<li><svg class="ic"><use href="#i-check"/></svg>صفحة حجز داخل الواتساب بعد توثيق النشاط عند ميتا</li>',
  '<li><svg class="ic"><use href="#i-check"/></svg>الدفع يتأكد لحاله، ويوصل العميل «وصلنا دفعك» وينقفل الطلب</li>');
must('<div><span>صفحة الحجز داخل الواتساب</span><b>بعد توثيق ميتا</b></div>', '');
must('بدون توثيق النشاط النظام يشتغل بالرسائل والأزرار العادية. بعد التوثيق تنفتح «صفحة الحجز» داخل الواتساب (شاشة كاملة فيها الأيام والأوقات) وتزيد حدود الإرسال. التوثيق باسم السجل التجاري ونساعدك فيه.',
  'النظام يشتغل كامل من أول يوم بالرسائل والأزرار. التوثيق يعتمد اسم نشاطك الظاهر للعملاء ويرفع حدود الإرسال اليومية، ويكون باسم السجل التجاري ونساعدك فيه.');
if (CONTACT_WA) {
  page = page.replace(waHref, `https://wa.me/${CONTACT_WA}`);
} else {
  must(/<a class="btn ghost" href="https:\/\/wa\.me\/966504652455[^"]*" target="_blank" rel="noopener">كلّمنا على واتساب<\/a>/.exec(page)[0],
    `<a class="btn ghost" href="${SIM}" target="_blank" rel="noopener">جرّبه بنفسك</a>`);
  page = page.replace(/<div class="num"><span id="num">[^<]*<\/span><button type="button" id="copyBtn">نسخ الرقم<\/button><\/div>\s*<a class="btn" href="https:\/\/wa\.me\/966504652455[^"]*" target="_blank" rel="noopener">افتح الواتساب<\/a>/,
    `<div class="row-cta" style="display:flex;gap:10px;flex-wrap:wrap"><a class="btn" href="#signup">اشترك الحين</a><a class="btn ghost" href="${SIM}" target="_blank" rel="noopener">جرّب النظام بنفسك</a></div>`);
  page = page.replace(/<a class="btn ghost" href="https:\/\/wa\.me\/966504652455[^"]*" target="_blank" rel="noopener">واتساب<\/a>/, `<a class="btn ghost" href="${SIM}" target="_blank" rel="noopener">جرّبه</a>`);
}
must(`<title>احجزلي</title>`, `<title>احجزلي · طلبات الواتساب تمشي لحالها</title>`);
must(`<section id="contact">`, form + `\n<section id="contact">`);
must(`/* التواصل */`, `/* نموذج الاشتراك */
.lead-form{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:22px;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px;position:relative}
.lead-form .f{display:grid;gap:6px;min-width:0} .lead-form .wide{grid-column:1/-1}
.lead-form label,.lead-form legend{font-size:14px;color:var(--muted)}
.lead-form input,.lead-form select,.lead-form textarea{width:100%;font:inherit;font-size:15px;color:var(--fg);background:var(--bg);border:1.5px solid var(--line);border-radius:10px;padding:10px 12px}
.lead-form input:focus,.lead-form select:focus,.lead-form textarea:focus{outline:3px solid color-mix(in srgb,var(--accent) 35%,transparent);outline-offset:1px}
.lead-form fieldset{border:0;padding:0;margin:0;display:grid;gap:8px}
.lead-form .opt{display:flex;gap:10px;align-items:center;border:1.5px solid var(--line);border-radius:10px;padding:10px 12px;cursor:pointer;color:var(--fg);font-size:15px}
.lead-form .opt input{width:auto;margin:0} .lead-form .opt b{font-family:var(--display)}
.lead-form .actions{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.hp{position:absolute;top:0;right:0;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none;border:0;padding:0}
.done{margin-top:22px;background:var(--soft);border-radius:18px;padding:24px;display:grid;gap:10px;justify-items:start}
.lead-form[hidden],.done[hidden]{display:none}
@media (max-width:620px){ .lead-form{grid-template-columns:1fr} }
/* التواصل */`);
// زر «نسخ الرقم» انشال، فسكربته ينشال معه
if (!CONTACT_WA) {
  const before = page.length;
  page = page.replace(/\(function\(\)\{\s*var btn=document\.getElementById\('copyBtn'\)[\s\S]*?\n\}\)\(\);\n/, '');
  if (page.length === before) throw new Error('copy script not found');
}

const head = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="احجزلي: أتمتة كاملة لطلبات الواتساب. الرد والحجز والتأكيد والتنبيه والفاتورة والدفع تصير لحالها بدون موظف. تأسيس مرة وحدة واشتراك شهري ثابت.">
<meta name="theme-color" content="#0B7A55">
<link rel="canonical" href="${SITE_URL}">
<meta property="og:type" content="website">
<meta property="og:locale" content="ar_SA">
<meta property="og:url" content="${SITE_URL}">
<meta property="og:site_name" content="احجزلي">
<meta property="og:title" content="احجزلي · طلبات الواتساب تمشي لحالها بالكامل">
<meta property="og:description" content="زباينك يراسلون رقمك، والنظام يرد ويحجز وينزّل الطلب عندك ويبلّغ موظفك، ويرسل الفاتورة ورابط الدفع بعد الخدمة. أوتوماتيك 100%.">
<meta property="og:image" content="${SITE_URL}img/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="احجزلي · طلبات الواتساب تمشي لحالها بالكامل">
<meta name="twitter:image" content="${SITE_URL}img/og.png">
<style>html{color-scheme:light dark} body{margin:0} img{max-width:100%}</style>
`;
const index = head + page.replace(`</style>`, `</style>\n</head>\n<body>`) + `\n</body>\n</html>\n`;

// ── لوحتي + دليل البيع ──
let admin = fs.readFileSync(path.join(SRC, 'admin.html'), 'utf8');
const guide = fs.readFileSync(path.join(SRC, 'sales-guide.html'), 'utf8');
if (!admin.includes('<!--SALES_GUIDE-->')) throw new Error('admin placeholder missing');
admin = admin.replace('<!--SALES_GUIDE-->', guide);

// ── فحوص الاستقلال ──
const files = { 'index.html': index, 'admin.html': admin };
for (const f of ['biz.html', 'staff.html', 'sim.html', 'pay.html', 'assets/ihj.js', 'assets/ihj.css']) files[f] = fs.readFileSync(path.join(OUT, f), 'utf8');
for (const [name, s] of Object.entries(files)) {
  if (/خاف[ً-ْ]*ت|khafet|Khaft/i.test(s)) throw new Error(`اسم خافت في ${name}`);
  if (/966504652455|0504652455|zulogtqxbuqxmdmjpzqj/.test(s)) throw new Error(`رقم أو مشروع خارجي في ${name}`);
}
fs.writeFileSync(path.join(OUT, 'index.html'), index);
fs.writeFileSync(path.join(OUT, 'admin.html'), admin);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log('built: index', Math.round(index.length / 1024) + 'KB', '| admin', Math.round(admin.length / 1024) + 'KB', '| sim link', SIM.slice(0, 30) + '…');
