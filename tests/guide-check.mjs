// فحص دليل التشغيل من أوله لآخره على منشأة فحص مؤقتة (تنحذف في النهاية):
// إنشاء بطريقة شغل (محل، دفع قبل، رسمي) ← الاتفاقية ← نموذج البيانات ← «طبّق بياناته» ← خطوات الدليل وروابطها في لوحتي
// ما يرسل أي واتساب: المنشأة تجريبية بدون رقم مربوط، وزر «أرسل له» يتفحص كرابط بدون ما ينضغط
// usage: node tests/guide-check.mjs
import fs from 'node:fs';
import { sessionFor, api } from './link-check.mjs';
import { sql } from '../tools/sql.mjs';
import { launch, sleep } from '../tools/cdp.mjs';

const P = JSON.parse(fs.readFileSync(new URL('../.secrets/project.json', import.meta.url)));
const FN = `${P.url}/functions/v1`;
const BASE = 'http://localhost:5610/';
const PUBLIC = 'https://fadiaalzhrani-debug.github.io/ihjizli/';
const adminTok = fs.readFileSync(new URL('../.secrets/admin-link.txt', import.meta.url), 'utf8').trim().split('#k=')[1];
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('✓ ' + name); } else { fail++; console.log('✗ ' + name + (extra ? ' · ' + extra : '')); } };
const client = (path, body) => fetch(`${FN}/api/client/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

sql(`delete from businesses where slug like 'guide-test%'`);
const a = await sessionFor(adminTok);
let bizId = '';
try {
  // 1) إنشاء بطريقة شغل كاملة
  const r = await api(a.jwt, 'admin/business/create', { name: 'منشأة فحص الدليل', name_en: 'guide test', slug: 'guide-test', activity: 'صالون', plan: 'bot_pay', is_demo: true,
    place_mode: 'shop', pay_timing: 'before', tone: 'formal', prepay_amount: 50, settings: { pay_provider: 'demo' },
    services: [{ name: 'قص', price: null }], cities: [{ name: 'الرياض', lat: 24.7136, lng: 46.6753, radius_km: 40 }] });
  ok(r.ok && r.business, 'إنشاء منشأة بطريقة الشغل', JSON.stringify(r).slice(0, 200));
  bizId = r.business.id;
  const st = sql(`select place_mode, pay_timing, tone, prepay_amount from settings where business_id = '${bizId}'`)[0];
  ok(st.place_mode === 'shop' && st.pay_timing === 'before' && st.tone === 'formal' && Number(st.prepay_amount) === 50, 'المكان والدفع والأسلوب ومبلغ الحجز انحفظت', JSON.stringify(st));
  const k = sql(`select client_key from businesses where id = '${bizId}'`)[0].client_key;

  // 2) الاتفاقية
  const info = await client('info', { k });
  ok(info.ok && info.business.name === 'منشأة فحص الدليل' && !info.agreed, 'صفحة الاتفاقية تفتح بمفتاح المنشأة');
  const bad = await client('info', { k: '0'.repeat(24) });
  ok(!bad.ok, 'مفتاح غلط ما يفتح شي');
  const ag = await client('agree', { k, name: 'فحص آلي', phone: '0500000000', accept: true });
  ok(ag.ok && ag.agreed, 'الموافقة تتسجل');

  // 3) نموذج البيانات
  const intake = await client('intake', { k, data: { name: 'منشأة فحص الدليل', activity: 'صالون', place_mode: 'shop', pay_timing: 'before',
    services: [{ name: 'قص شعر', price: 60 }, { name: 'صبغة', price: '' }],
    cities: [{ name: 'الفرع الرئيسي', maps: 'https://maps.google.com/?q=24.70001,46.60002' }],
    hours: [0, 1, 2, 3, 4].map((d) => ({ weekday: d, open: '10:00', close: '22:00' })) } });
  ok(intake.ok && intake.saved, 'نموذج البيانات انحفظ', JSON.stringify(intake).slice(0, 200));

  // 4) لوحتي: الخطوات وروابطها وزر «طبّق بياناته»
  const b = await launch({ width: 1360, height: 1000 });
  try {
    await b.go(`${BASE}admin.html#k=${adminTok}`, 500);
    await b.waitFor(`window.__admin && document.getElementById('view').children.length > 0`, 25000);
    await b.ev(`__admin.S.obBiz = '${bizId}'; __admin.go('onboard')`);
    await b.waitFor(`document.querySelectorAll('.ost').length === 10`, 15000); await sleep(1200);
    const g = JSON.parse(await b.ev(`JSON.stringify({ n: document.querySelectorAll('.ost').length, urls: [...document.querySelectorAll('.ost .copybox code')].map(x => x.textContent), sel: document.getElementById('obSel').value, txt: document.querySelector('.ost').innerText, apply: !!document.querySelector('[data-act=apply]'), wa: document.querySelectorAll('.ost a[href^="https://wa.me/"]').length, phoneBox: !!document.getElementById('stPhone') })`));
    ok(g.n === 10 && g.sel === bizId, 'الدليل يعرض 10 خطوات للمنشأة المختارة');
    ok(g.urls.includes(`${PUBLIC}agree.html?k=${k}`) && g.urls.includes(`${PUBLIC}start.html?k=${k}`) && g.urls.some((u) => u.startsWith(`${PUBLIC}sim.html?b=guide-test`)), 'روابط الاتفاقية والنموذج والمحاكي جنب خطواتها', g.urls.join(' | '));
    ok(g.urls.includes(`${PUBLIC}help.html#connect`) && g.urls.includes(`${PUBLIC}help.html#meta`) && g.urls.includes(`${PUBLIC}help.html#moyasar`), 'روابط شرح الربط وميتا وميسر');
    ok(/وافق فحص آلي/.test(g.txt), 'الموافقة تطلع في خطوة الاتفاقية', g.txt.slice(0, 160));
    ok(g.apply && g.wa === 0 && g.phoneBox, 'زر «طبّق بياناته» موجود، وبدون جوال ما يطلع زر الإرسال');
    // جوال في الذاكرة فقط (ما ينحفظ) عشان نتأكد من رابط «أرسل له»
    await b.ev(`(() => { const x = __admin.S.biz.find(y => y.id === '${bizId}'); x.owner_phone = '966500000000'; __admin.go('onboard'); })()`); await sleep(600);
    const w = JSON.parse(await b.ev(`JSON.stringify([...document.querySelectorAll('.ost a[href^="https://wa.me/"]')].map(a => decodeURIComponent(a.href)))`));
    ok(w.length >= 6 && w[0].startsWith('https://wa.me/966500000000?text=') && w[0].includes(`agree.html?k=${k}`), 'زر «أرسل له» يفتح واتساب العميل والرسالة فيها الرابط', w[0] && w[0].slice(0, 120));
    // طبّق بياناته
    await b.ev(`document.querySelector('[data-act=apply]').click()`);
    await b.waitFor(`/انطبقت بياناته/.test(document.querySelectorAll('.ost')[1].innerText)`, 20000);
    ok(true, '«طبّق بياناته» يشتغل من الدليل');
    await b.shot('tests/out/v3/guide-check.png');
    const errs = b.log.filter((l) => l.type === 'error' || l.type === 'exception');
    ok(!errs.length, 'بدون أخطاء في الكونسول', errs.map((e) => e.text).join(' | '));
  } finally { await b.close(); }
  const sv = sql(`select name, price, active from services where business_id = '${bizId}' order by sort, name`);
  ok(sv.some((x) => x.name === 'قص شعر' && Number(x.price) === 60 && x.active) && sv.some((x) => x.name === 'قص' && !x.active), 'الخدمات انطبقت (الجديدة فعّالة والقديمة موقفة)', JSON.stringify(sv));
  const ct = sql(`select name, lat, active from cities where business_id = '${bizId}' and active`);
  ok(ct.length === 1 && ct[0].name === 'الفرع الرئيسي' && Math.abs(ct[0].lat - 24.70001) < 1e-4, 'الفرع انطبق بموقعه من رابط قوقل ماب', JSON.stringify(ct));
  const hr = sql(`select count(*)::int n from hours where business_id = '${bizId}'`)[0].n;
  ok(hr === 5, 'الأوقات انطبقت', String(hr));
} finally {
  sql(`delete from businesses where slug like 'guide-test%'`);
  const left = sql(`select count(*)::int n from businesses where slug like 'guide-test%'`)[0].n;
  ok(left === 0, 'منشأة الفحص انحذفت');
}
console.log(`\n${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
