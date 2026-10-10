// فحص «عبّيها من صورة أو موقع» من الواجهات، بقراءة تجريبية: نتيجة القراءة بس تتبدل داخل المتصفح، والحفظ والتطبيق حقيقي.
//  1) لوحة المنشأة: الزر ← صورة ← المراجعة ← الحفظ (خدمة تتحدث وخدمات تنضاف بـ«يبدأ من»، الأوقات، الأسئلة بمكانها)
//  2) دليل التشغيل: «عبّيها من صورة أو موقع» ← «طبّقها على منشأته» (نموذج البيانات + التطبيق)
//  3) نموذج العميل: «عبّيها عني» يطلع بس لو القراءة مفعّلة، ويعبّي الاسم والخدمات والأوقات والفرع والأسئلة، والإرسال يحفظها
// على منشأة حقيقية مؤقتة وطلب اشتراك بجوال وهمي، وينحذفون بالنهاية. ما يرسل أي واتساب.
import fs from 'node:fs';
import { launch, sleep } from '../tools/cdp.mjs';
import { sessionFor, api } from './link-check.mjs';
import { sql } from '../tools/sql.mjs';
import { MOCK, PICK } from './extract-mock.mjs';
const BASE = 'http://localhost:5610/';
const adminTok = fs.readFileSync(new URL('../.secrets/admin-link.txt', import.meta.url), 'utf8').trim().split('#k=')[1];
const PHONE = '0599000007', PHONE_INTL = '966599000007';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('✓ ' + name); } else { fail++; console.log('✗ ' + name + (extra ? ' · ' + extra : '')); } };
const errs = [];
const grab = (b, tag) => { for (const l of b.log) if (l.type === 'error' || l.type === 'exception') errs.push(`${tag}: ${l.text}`); };

async function withMock(o, aiReady = true) { const b = await launch(o); await b.cmd('Page.addScriptToEvaluateOnNewDocument', { source: MOCK(aiReady) }); return b; }
async function readFlow(b, tag) {
  ok(await b.waitFor(`document.getElementById('rdFile')`, 8000), `${tag}: نافذة «عبّيها من صورة أو موقع» انفتحت`);
  await b.ev(PICK);
  ok(await b.waitFor(`document.querySelectorAll('#rdThumbs img').length === 1 && !document.getElementById('rdGo').disabled`, 8000), `${tag}: الصورة انضافت وزر القراءة شغّال`);
  await b.ev(`document.getElementById('rdGo').click()`);
  ok(await b.waitFor(`!document.getElementById('rdRun').hidden`, 3000), `${tag}: يبين إنه يقرأ`);
}

const a = await sessionFor(adminTok);
sql(`delete from businesses where slug like 'rd-test%'`);
sql(`delete from signup_requests where phone = '${PHONE_INTL}'`);
let bizId = '';
try {
  const r = await api(a.jwt, 'admin/business/create', { name: 'منشأة فحص القراءة', slug: 'rd-test', plan: 'bot', is_demo: false, place_mode: 'shop',
    services: [{ name: 'قص شعر', price: 50 }], cities: [{ name: 'فرع الفحص', lat: 24.7, lng: 46.68, radius_km: 10 }] });
  ok(r.ok && r.business, 'منشأة مؤقتة للفحص', JSON.stringify(r).slice(0, 120));
  bizId = r.business.id;
  sql(`update settings set faq = '[{"chip":"فيه مواقف؟","q":"مواقف","a":"لا للأسف"},{"chip":"تقصون للأطفال؟","q":"اطفال","a":"إيه"}]'::jsonb where business_id = '${bizId}'`);

  // ── 1) لوحة المنشأة ──
  const b = await withMock({ width: 1360, height: 980 });
  try {
    await b.go(`${BASE}admin.html#k=${adminTok}`, 500); await b.waitFor(`window.__admin`, 25000);
    await b.go(`${BASE}biz.html?b=${bizId}#catalog`, 500);
    ok(await b.waitFor(`document.getElementById('svImport')`, 25000), 'لوحة المنشأة: زر «عبّيها من صورة أو موقع» فوق الخدمات');
    ok(await b.ev(`!!document.querySelector('[data-sv] input[data-k=price_from]')`), 'لوحة المنشأة: خانة «يبدأ من» لكل خدمة');
    await b.ev(`document.getElementById('svImport').click()`);
    await readFlow(b, 'لوحة المنشأة');
    ok(await b.waitFor(`document.querySelectorAll('.rv-s').length === 8`, 10000), 'المراجعة: 8 خدمات بأسعارها', String(await b.ev(`document.querySelectorAll('.rv-s').length`)));
    const tags = await b.ev(`[...document.querySelectorAll('.rv-s')].map((x) => x.querySelector('[data-sk=name]').value + ':' + x.querySelector('.tag').textContent)`);
    ok(tags[0] === 'قص شعر:موجودة' && tags.slice(1).every((t) => t.endsWith('جديدة')), 'المراجعة تفرّق الموجودة من الجديدة', JSON.stringify(tags));
    ok(await b.ev(`document.querySelectorAll('.rv-s [data-sk=price_from]:checked').length === 2 && document.querySelectorAll('.rv-hours div').length >= 2 && document.querySelectorAll('[data-f]').length === 2`), 'المراجعة: «يبدأ من» والأوقات والأسئلة');
    await b.ev(`(() => { const x = [...document.querySelectorAll('.rv-s')].pop().querySelector('[data-si]'); x.checked = false; x.dispatchEvent(new Event('change')); })()`);
    await b.shot('tests/out/extract/biz-review.png');
    await b.ev(`document.getElementById('rvGo').click()`);
    ok(await b.waitFor(`!document.getElementById('modal').classList.contains('on')`, 20000), 'الحفظ خلص وانقفلت النافذة');
    await sleep(800);
    const sv = sql(`select name, price::float, price_from, active from services where business_id = '${bizId}' order by sort`);
    const by = Object.fromEntries(sv.map((s) => [s.name, s]));
    ok(sv.filter((s) => s.active).length === 7 && !by['مساج رأس'], 'انحفظت 7 خدمات واللي شلناها ما انضافت', JSON.stringify(sv.map((s) => s.name)));
    ok(by['قص شعر'] && by['قص شعر'].price === 60 && !by['قص شعر'].price_from && by['صبغة'].price_from && by['بروتين'].price === 250, 'الموجودة تحدّث سعرها و«يبدأ من» انحفظ', JSON.stringify([by['قص شعر'], by['صبغة']]));
    const hrs = sql(`select weekday, to_char(open_time,'HH24:MI') o, to_char(close_time,'HH24:MI') c from hours where business_id = '${bizId}' and city_id is null order by weekday`);
    ok(hrs.length === 7 && hrs[5].o === '16:00' && hrs[0].c === '00:00', 'الأوقات تبدّلت (والجمعة من 4)', JSON.stringify(hrs));
    const faq = sql(`select faq from settings where business_id = '${bizId}'`)[0].faq;
    ok(faq.length === 3 && faq[0].chip === 'فيه مواقف؟' && faq[0].a.startsWith('إيه') && faq[1].chip === 'تقصون للأطفال؟' && faq[2].chip === 'وش طرق الدفع؟', 'الأسئلة: نفس السؤال تحدّث بمكانه والجديد انضاف آخر', JSON.stringify(faq.map((f) => f.chip)));
    ok(await b.waitFor(`document.querySelectorAll('[data-sv]').length === 7`, 8000), 'اللوحة تحدّثت بالخدمات الجديدة');
    await b.shot('tests/out/extract/biz-after.png');
    grab(b, 'biz');
  } finally { await b.close(); }

  // ── 2) دليل التشغيل ──
  const g = await withMock({ width: 1360, height: 1000 });
  try {
    await g.go(`${BASE}admin.html#k=${adminTok}`, 500); await g.waitFor(`window.__admin`, 25000);
    await g.go(`${BASE}admin.html?t=1#onboard/${bizId}`, 500); await g.waitFor(`window.__admin`, 25000);
    ok(await g.waitFor(`document.querySelector('[data-act=import]')`, 20000), 'دليل التشغيل: «عبّيها من صورة أو موقع» في خطوة «بياناته»');
    await g.ev(`document.querySelector('[data-act=import]').click()`);
    await readFlow(g, 'دليل التشغيل');
    ok(await g.waitFor(`document.querySelectorAll('.rv-s').length === 8 && /طبّقها على منشأته/.test(document.getElementById('rvGo').textContent)`, 10000), 'المراجعة بزر «طبّقها على منشأته»');
    ok(await g.ev(`/تتوقف/.test(document.querySelector('.rv .hint') ? document.querySelector('.rv .hint').textContent : '')`), 'تنبيه إن خدماته الحالية اللي مو في القائمة تتوقف');
    await g.ev(`document.getElementById('rvGo').click()`);
    ok(await g.waitFor(`!document.getElementById('modal').classList.contains('on')`, 25000), 'انطبقت وانقفلت النافذة');
    await sleep(800);
    const d = sql(`select intake_applied_at, jsonb_array_length(intake->'services') n, intake->'services'->4->>'price_from' pf, jsonb_array_length(intake->'faq') nf from client_docs where business_id = '${bizId}'`)[0];
    ok(d && d.intake_applied_at && d.n === 8 && d.pf === 'true' && d.nf === 2, 'نموذج بياناته فيه الخدمات بـ«يبدأ من» والأسئلة، وانطبق', JSON.stringify(d));
    const act = sql(`select count(*)::int n from services where business_id = '${bizId}' and active`)[0].n;
    ok(act === 8 && sql(`select price_from from services where business_id = '${bizId}' and name = 'بروتين'`)[0].price_from === true, 'التطبيق: 8 خدمات فعّالة و«يبدأ من» محفوظ', String(act));
    await g.shot('tests/out/extract/guide-after.png');
    grab(g, 'guide');
  } finally { await g.close(); }

  // ── 3) نموذج العميل (الرابط العام) ──
  const off = await withMock({ width: 390, height: 844, scale: 2, mobile: true }, false);
  try {
    await off.go(`${BASE}start.html`, 500); await off.waitFor(`window.__start`, 20000); await sleep(400);
    ok(!(await off.ev(`!!document.querySelector('[data-imp]')`)), 'النموذج: الزر مخفي لو القراءة مو مفعّلة');
  } finally { await off.close(); }
  const c = await withMock({ width: 390, height: 844, scale: 2, mobile: true });
  try {
    await c.go(`${BASE}start.html`, 500); await c.waitFor(`window.__start`, 20000);
    ok(await c.waitFor(`document.querySelector('.import-cta [data-imp]')`, 8000), 'النموذج: «عندك قائمة أسعار أو موقع؟ عبّيها عني» في أول خطوة');
    await c.shot('tests/out/extract/start-card.png');
    await c.ev(`document.querySelector('.import-cta [data-imp]').click()`);
    await readFlow(c, 'النموذج');
    ok(await c.waitFor(`window.__start.st.imported`, 10000), 'النموذج تعبّى من القراءة');
    const st = await c.ev(`JSON.parse(JSON.stringify(window.__start.st))`);
    ok(st.name === 'صالونك' && st.activity === 'صالون حلاقة رجالي' && st.place === 'shop', 'الاسم والنشاط والمكان', JSON.stringify([st.name, st.activity, st.place]));
    ok(st.services.length === 8 && st.services.filter((s) => s.from).length === 2 && st.hoursPreset === 'custom' && st.hours.length === 7, 'الخدمات و«يبدأ من» والأوقات', JSON.stringify([st.services.length, st.hoursPreset, st.hours.length]));
    ok(st.cities.some((x) => x.name === 'فرع العليا') && st.faq.length === 2 && /الضريبة/.test(st.notes), 'الفرع والأسئلة والملاحظة', JSON.stringify([st.cities, st.faq.length, st.notes]));
    ok(await c.ev(`/عبّينا من القائمة/.test(document.querySelector('.import-cta').textContent)`), 'البطاقة تقول وش تعبّى');
    await c.shot('tests/out/extract/start-filled.png');
    await c.ev(`window.__start.go(2)`); await sleep(500);
    ok(await c.ev(`document.querySelectorAll('.fr').length === 2 && document.querySelectorAll('#svcs .line').length === 8`), 'خطوة الخدمات: «السعر يبدأ من» يبان');
    await c.shot('tests/out/extract/start-services.png');
    // الإرسال: الفرع بدون رابط موقع يطلب الرابط، وبعده ينحفظ مع «يبدأ من» والأسئلة
    await c.ev(`Object.assign(window.__start.st, { ownerp: '${PHONE}', owner: 'فحص القراءة', pay: 'after' }); window.__start.go(6)`); await sleep(400);
    await c.ev(`document.getElementById('go').click()`);
    ok(await c.waitFor(`!document.getElementById('err').hidden && /فرع العليا/.test(document.getElementById('err').textContent)`, 20000), 'فرع بدون رابط موقع: يطلب منه الرابط', await c.ev(`document.getElementById('err').textContent`));
    await c.ev(`window.__start.st.cities.forEach((x) => { if (!x.lat) x.maps = 'https://maps.google.com/?q=24.6995,46.6837'; }); window.__start.go(6)`); await sleep(400);
    await c.ev(`document.getElementById('go').click()`);
    ok(await c.waitFor(`/وصلتنا بياناتك/.test(document.getElementById('sendBox').textContent)`, 25000), 'انرسلت البيانات');
    const lead = sql(`select intake->'services'->4->>'price_from' pf, jsonb_array_length(intake->'faq') nf, jsonb_array_length(intake->'hours') nh from signup_requests where phone = '${PHONE_INTL}'`)[0];
    ok(lead && lead.pf === 'true' && lead.nf === 2 && lead.nh === 7, 'طلب الاشتراك فيه «يبدأ من» والأسئلة والأوقات', JSON.stringify(lead));
    grab(c, 'start');
  } finally { await c.close(); }
} finally {
  sql(`delete from businesses where slug like 'rd-test%'`);
  sql(`delete from signup_requests where phone = '${PHONE_INTL}'`);
  ok(!sql(`select 1 from businesses where slug like 'rd-test%'`).length && !sql(`select 1 from signup_requests where phone = '${PHONE_INTL}'`).length, 'المنشأة المؤقتة وطلب الفحص انحذفوا');
}
if (errs.length) { console.log('أخطاء الصفحات:\n' + errs.slice(0, 10).join('\n')); fail += errs.length; }
console.log(`\n${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
