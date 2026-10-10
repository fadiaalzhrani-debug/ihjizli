// صور «كيف تضبطين البوت لعميل» في سير العمل (docs/img/how-*.webp) من الشاشات الحقيقية على «صالونك» التجريبية.
// القراءة نفسها تتبدل داخل المتصفح بنتيجة مطابقة لصورة القائمة التجريبية. الحفظ حقيقي عشان الأوقات والأسئلة والمحاكي
// يبينون بعد الحفظ، وبالنهاية ترجع خدمات «صالونك» وأوقاتها وأسئلتها مثل ما كانت بالضبط.
import fs from 'node:fs';
import { launch, sleep } from '../tools/cdp.mjs';
import { sql } from '../tools/sql.mjs';
import { MOCK } from './extract-mock.mjs';
const BASE = 'http://localhost:5610/';
const IMG = 'docs/img';
const adminTok = fs.readFileSync(new URL('../.secrets/admin-link.txt', import.meta.url), 'utf8').trim().split('#k=')[1];
const salon = sql(`select id, slug, sim_key from businesses where slug = 'salon'`)[0];
const q = (v) => v === null || v === undefined ? 'null' : "'" + String(v).replace(/'/g, "''") + "'";
const before = {
  services: sql(`select id, name, name_en, price, price_from, duration_min, active, sort from services where business_id = '${salon.id}'`),
  hours: sql(`select weekday, to_char(open_time, 'HH24:MI') o, to_char(close_time, 'HH24:MI') c, city_id from hours where business_id = '${salon.id}'`),
  faq: sql(`select faq from settings where business_id = '${salon.id}'`)[0].faq,
};
function restore() {
  const ids = before.services.map((x) => q(x.id)).join(',') || "'00000000-0000-0000-0000-000000000000'";
  sql([`delete from services where business_id = '${salon.id}' and id not in (${ids});`,
    ...before.services.map((x) => `update services set name = ${q(x.name)}, name_en = ${q(x.name_en)}, price = ${x.price === null ? 'null' : x.price}, price_from = ${!!x.price_from}, duration_min = ${x.duration_min ?? 'null'}, active = ${!!x.active}, sort = ${x.sort} where id = ${q(x.id)};`),
    `delete from hours where business_id = '${salon.id}';`,
    ...before.hours.map((h) => `insert into hours (business_id, weekday, open_time, close_time, city_id) values ('${salon.id}', ${h.weekday}, '${h.o}', '${h.c}', ${q(h.city_id)});`),
    `update settings set faq = ${q(JSON.stringify(before.faq))}::jsonb where business_id = '${salon.id}';`].join('\n'));
}

async function snap(b, file, sel, pad = 0) {
  let clip;
  if (sel) {
    const r = await b.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`);
    if (r) clip = { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.width + pad * 2, height: r.height + pad * 2, scale: 1 };
  }
  const res = await b.cmd('Page.captureScreenshot', { format: 'webp', quality: 84, ...(clip ? { clip } : {}) });
  fs.writeFileSync(`${IMG}/${file}.webp`, Buffer.from(res.data, 'base64'));
  console.log('✓', file, Math.round(Buffer.from(res.data, 'base64').length / 1024) + 'KB');
}

// 0) صورة قائمة الأسعار اللي «أرسلها العميل» (مثال توضيحي مطابق لنتيجة القراءة التجريبية)
const MENU = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Tajawal:wght@500;700;800&display=swap">
<style>body{margin:0;background:#141225;font-family:Tajawal,Tahoma,sans-serif}.m{width:520px;padding:34px 38px 26px;background:radial-gradient(120% 90% at 50% 0%,#2a2550,#141225 70%);color:#f3efe6;box-sizing:border-box}
h1{margin:0;text-align:center;font-size:44px;color:#f2b705;letter-spacing:1px}.sub{text-align:center;color:#c9c3e6;font-size:19px;margin:2px 0 18px}
.r{display:flex;align-items:baseline;gap:8px;font-size:21px;margin:9px 0}.r b{font-weight:700}.r i{flex:1;border-bottom:2px dotted #6b6496;transform:translateY(-6px)}.r span{color:#f2b705;font-weight:800;white-space:nowrap}
.f{margin-top:18px;border-top:1px solid #3a3466;padding-top:12px;font-size:16px;color:#d8d3ef;line-height:1.75;text-align:center}.tag{margin-top:10px;text-align:center;font-size:12px;color:#8f88b8}</style></head>
<body><div class="m" id="m"><h1>صالونك</h1><div class="sub">قائمة الأسعار</div>
${[['قص شعر', '60 ريال'], ['قص شعر أطفال', '40 ريال'], ['حلاقة ذقن', '30 ريال'], ['تحديد لحية', '20 ريال'], ['صبغة', 'من 120 ريال'], ['بروتين', 'من 250 ريال'], ['تنظيف بشرة', '90 ريال'], ['مساج رأس', '40 ريال']].map(([a, p]) => `<div class="r"><b>${a}</b><i></i><span>${p}</span></div>`).join('')}
<div class="f">نستقبلكم يوميًا من 1 الظهر إلى 12 الليل، والجمعة من 4 العصر<br>فرع العليا · الرياض<br>الدفع: كاش · مدى · Apple Pay · فيه مواقف<br>الأسعار شاملة الضريبة</div><div class="tag">مثال توضيحي</div></div></body></html>`;
{
  const b = await launch({ width: 600, height: 900, scale: 1 });
  try {
    await b.go('data:text/html;charset=utf-8,' + encodeURIComponent(MENU), 2200);
    await snap(b, 'how-menu', '#m');
  } finally { await b.close(); }
}

// 1 إلى 5) لوحة المنشأة
try {
const b = await launch({ width: 1180, height: 760, scale: 1 });
try {
  await b.cmd('Page.addScriptToEvaluateOnNewDocument', { source: MOCK(true) });
  await b.go(`${BASE}admin.html#k=${adminTok}`, 500); await b.waitFor(`window.__admin`, 25000);
  await b.go(`${BASE}biz.html?b=${salon.id}#catalog`, 500); await b.waitFor(`document.getElementById('svImport')`, 25000); await sleep(900);
  await snap(b, 'how-1');
  await b.ev(`document.getElementById('svImport').click()`); await b.waitFor(`document.getElementById('rdFile')`, 8000);
  await b.ev(`(async () => { const blob = await (await fetch('img/how-menu.webp')).blob(); const dt = new DataTransfer(); dt.items.add(new File([blob], 'menu.webp', { type: 'image/webp' })); const inp = document.getElementById('rdFile'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await b.waitFor(`document.querySelectorAll('#rdThumbs img').length === 1`, 8000); await sleep(500);
  await snap(b, 'how-2', '#modal .box');
  await b.ev(`document.getElementById('rdGo').click()`);
  await b.waitFor(`document.querySelectorAll('.rv-s').length === 8`, 10000); await sleep(600);
  await snap(b, 'how-3', '#modal .box');
  await b.ev(`document.getElementById('rvGo').click()`);
  await b.waitFor(`!document.getElementById('modal').classList.contains('on')`, 20000); await sleep(1500);
  await b.ev(`__biz.go('hours')`); await sleep(1200);
  await snap(b, 'how-4');
  await b.ev(`__biz.go('texts')`); await sleep(1200);
  await b.ev(`document.getElementById('mMain').closest('.card').scrollIntoView({ block: 'start' }); window.scrollBy(0, -12)`); await sleep(400);
  await snap(b, 'how-5');
} finally { await b.close(); }

// 6) المحاكي: «كم الأسعار؟»
const m = await launch({ width: 390, height: 700, scale: 1.5, mobile: true });
try {
  await m.go(`${BASE}sim.html?b=${salon.slug}&k=${salon.sim_key}`, 1500);
  await m.ev(`window.__sim.reset()`);
  await m.waitFor(`document.querySelectorAll('.msg.in').length >= 1 && !document.getElementById('typing')`, 20000); await sleep(1200);
  await m.ev(`window.__sim.sendMsg({ type: 'text', text: 'كم الأسعار؟' })`);
  await m.waitFor(`[...document.querySelectorAll('.msg.in')].some((x) => /ريال/.test(x.textContent)) && !document.getElementById('typing')`, 20000); await sleep(1200);
  await snap(m, 'how-6');
  await m.ev(`window.__sim.reset()`);
} finally { await m.close(); }
} finally {
  restore();
}
const now = sql(`select count(*)::int n from services where business_id = '${salon.id}'`)[0].n;
console.log(now === before.services.length ? '✓ رجعت «صالونك» مثل ما كانت' : '✗ «صالونك» ما رجعت: ' + now);
