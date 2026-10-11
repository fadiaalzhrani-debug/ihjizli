// فحص «الدفعة الأولى» (agree.html): الموافقة على الاتفاقية خانة صح قبل الدفع، وبيانات التحويل ما تطلع إلا بعدها،
// وزر «حوّلت» يسجّل ويبان في دليل التشغيل. برابط المنشأة وبالرابط العام.
// بيانات تحويل تجريبية مؤقتة ترجع بعدها مثل ما كانت، ومنشأة مؤقتة وجوال وهمي ينحذفون. ما يرسل أي واتساب.
import fs from 'node:fs';
import { launch, sleep } from '../tools/cdp.mjs';
import { sessionFor, api } from './link-check.mjs';
import { sql } from '../tools/sql.mjs';
const BASE = 'http://localhost:5610/';
const P = JSON.parse(fs.readFileSync(new URL('../.secrets/project.json', import.meta.url)));
const FN = `${P.url}/functions/v1`;
const adminTok = fs.readFileSync(new URL('../.secrets/admin-link.txt', import.meta.url), 'utf8').trim().split('#k=')[1];
const PHONE = '0599000008', PHONE_INTL = '966599000008';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('✓ ' + name); } else { fail++; console.log('✗ ' + name + (extra ? ' · ' + extra : '')); } };
const errs = [];
const grab = (b, tag) => { for (const l of b.log) if (l.type === 'error' || l.type === 'exception') errs.push(`${tag}: ${l.text}`); };
const client = (path, body) => fetch(`${FN}/api/client/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";

const before = sql(`select value from ihj_config where key = 'pay'`)[0];
const TEST_PAY = { bank: 'بنك الفحص', holder: 'حساب الفحص', iban: 'SA4420000001234567891234', note: '' };
const setPay = (v) => v ? sql(`insert into ihj_config (key, value) values ('pay', ${q(JSON.stringify(v))}::jsonb) on conflict (key) do update set value = excluded.value, updated_at = now()`) : sql(`delete from ihj_config where key = 'pay'`);
sql(`delete from businesses where slug like 'fp-test%'`);
sql(`delete from signup_requests where phone = '${PHONE_INTL}'`);
const a = await sessionFor(adminTok);
try {
  setPay(TEST_PAY);
  const r = await api(a.jwt, 'admin/business/create', { name: 'منشأة فحص الدفعة', slug: 'fp-test', plan: 'bot', is_demo: false, owner_name: 'صاحب الفحص', owner_phone: '0599000009', services: [{ name: 'خدمة', price: null }] });
  ok(r.ok && r.business, 'منشأة مؤقتة للفحص', JSON.stringify(r).slice(0, 120));
  const id = r.business.id, k = sql(`select client_key from businesses where id = '${id}'`)[0].client_key;

  // ── رابط المنشأة ──
  const b = await launch({ width: 390, height: 844, scale: 2, mobile: true });
  try {
    await b.go(`${BASE}agree.html?k=${k}`, 500); await b.waitFor(`window.__firstpay`, 20000); await sleep(300);
    ok(await b.ev(`/1,750/.test(document.querySelector('.amount').textContent) && /3,500/.test(document.querySelector('.amount').textContent)`), 'المبلغ: نص التأسيس 1,750 من 3,500');
    ok(await b.ev(`document.getElementById('go').disabled && !document.getElementById('payBox') && !/SA44/.test(document.body.textContent)`), 'قبل الصح: الزر مقفل وبيانات التحويل ما تطلع');
    ok(await b.ev(`document.querySelectorAll('.agree details ol.terms li').length === 7`), 'الاتفاقية كاملة داخل «اقرأ الاتفاقية»');
    await b.shot('tests/out/firstpay/k-1.png');
    await b.ev(`(() => { const c = document.getElementById('ok'); c.checked = true; c.dispatchEvent(new Event('change')); })()`);
    ok(await b.ev(`!document.getElementById('go').disabled && document.getElementById('agreeBox').classList.contains('on')`), 'بعد الصح: «أكمل للدفع» يتفعّل');
    await b.ev(`document.getElementById('go').click()`);
    ok(await b.waitFor(`document.getElementById('payBox') && /SA44 2000/.test(document.getElementById('payBox').textContent)`, 15000), 'بعد الموافقة: تطلع بيانات التحويل');
    const d1 = sql(`select agreed_at, agreed_name, paid_claim_at from client_docs where business_id = '${id}'`)[0];
    ok(d1 && d1.agreed_at && d1.agreed_name === 'صاحب الفحص' && !d1.paid_claim_at, 'الموافقة انسجلت بالاسم', JSON.stringify(d1));
    await b.shot('tests/out/firstpay/k-2.png');
    await b.ev(`document.getElementById('sent').click()`);
    ok(await b.waitFor(`/وصلنا خبر التحويل/.test(document.getElementById('payBox').textContent)`, 15000), '«حوّلت» يقول وصلنا خبرك');
    ok(!!sql(`select paid_claim_at from client_docs where business_id = '${id}'`)[0].paid_claim_at, '«حوّلت» انسجل');
    await b.go(`${BASE}agree.html?k=${k}`, 500); await b.waitFor(`window.__firstpay`, 20000); await sleep(300);
    ok(await b.ev(`document.getElementById('ok').checked && document.getElementById('ok').disabled && /وافق صاحب الفحص/.test(document.body.textContent) && /وصلنا خبر التحويل/.test(document.body.textContent)`), 'لو رجع للرابط: يشوف موافقته وإنه بلّغ بالتحويل');
    await b.shot('tests/out/firstpay/k-3.png');
    sql(`insert into sub_payments (business_id, kind, amount, paid_on) values ('${id}', 'setup', 1750, current_date)`);
    await b.go(`${BASE}agree.html?k=${k}`, 500); await b.waitFor(`window.__firstpay`, 20000); await sleep(300);
    ok(await b.ev(`/استلمنا الدفعة الأولى/.test(document.body.textContent) && !/SA44/.test(document.body.textContent)`), 'بعد ما تسجلين الدفعة: «استلمنا الدفعة الأولى» بدل بيانات التحويل');
    grab(b, 'k');
  } finally { await b.close(); }

  // ── دليل التشغيل: الخطوة الأولى ──
  sql(`delete from sub_payments where business_id = '${id}'`);
  const g = await launch({ width: 1360, height: 1000 });
  try {
    await g.go(`${BASE}admin.html#k=${adminTok}`, 500); await g.waitFor(`window.__admin`, 25000);
    await g.go(`${BASE}admin.html?t=1#onboard/${id}`, 500); await g.waitFor(`document.querySelectorAll('.ost').length >= 10`, 25000); await sleep(600);
    const first = await g.ev(`document.querySelector('.ost').textContent`);
    ok(/الدفعة الأولى/.test(first) && /قال إنه حوّل/.test(first) && /سجّل الدفعة الأولى/.test(first) && !/الاتفاقية والدفعة/.test(first), 'الدليل: «الدفعة الأولى» وفيها «قال إنه حوّل»', first.slice(0, 160));
    const msg = await g.ev(`decodeURIComponent((document.querySelector('.ost a[href^="https://wa.me/"]') || {}).href || '')`);
    ok(/رابط الدفعة الأولى/.test(msg) && msg.includes(`agree.html?k=${k}`), 'رسالة «أرسل له» عن الدفعة الأولى ورابطها', msg.slice(0, 160));
    await g.ev(`document.querySelector('.ost').scrollIntoView({ block: 'start' })`); await sleep(300);
    await g.shot('tests/out/firstpay/guide.png');
    await g.go(`${BASE}admin.html?t=2#home`, 500); await g.waitFor(`document.getElementById('cfIban')`, 25000); await sleep(400);
    ok(await g.ev(`document.getElementById('cfIban').value === 'SA4420000001234567891234' && /جاهزة/.test(document.getElementById('payCard').textContent)`), 'الرئيسية: بطاقة «بيانات التحويل» فيها البيانات');
    await g.ev(`document.getElementById('payCard').scrollIntoView({ block: 'center' })`); await sleep(300);
    await g.shot('tests/out/firstpay/home-card.png');
    grab(g, 'admin');
  } finally { await g.close(); }

  // ── الرابط العام ──
  const bad = await client('paid-new', { phone: PHONE });
  ok(!bad.ok && bad.error === 'not_agreed', '«حوّلت» بدون موافقة يترفض', JSON.stringify(bad));
  const c = await launch({ width: 390, height: 844, scale: 2, mobile: true });
  try {
    await c.go(`${BASE}agree.html`, 500); await c.ev(`localStorage.removeItem('ihj_firstpay')`); await c.go(`${BASE}agree.html?p=bot_pay`, 500); await c.waitFor(`window.__firstpay`, 20000); await sleep(300);
    ok(await c.ev(`document.querySelector('input[name=plan][value=bot_pay]').checked && /2,750/.test(document.querySelector('.amount').textContent)`), 'العام: الباقة من الرابط ومبلغها');
    await c.ev(`(() => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')); }; set('bn', 'نشاط فحص الدفعة'); set('n', 'فحص الدفعة'); set('p', '${PHONE}'); const x = document.getElementById('ok'); x.checked = true; x.dispatchEvent(new Event('change')); })()`);
    await c.ev(`document.getElementById('go').click()`);
    ok(await c.waitFor(`document.getElementById('payBox') && /SA44/.test(document.getElementById('payBox').textContent)`, 15000), 'العام: بعد الموافقة تطلع بيانات التحويل');
    const lead = sql(`select agreed_at, package, business_name from signup_requests where phone = '${PHONE_INTL}'`)[0];
    ok(lead && lead.agreed_at && lead.package === 'bot_pay' && lead.business_name === 'نشاط فحص الدفعة', 'العام: طلب الاشتراك انسجل بموافقته وباقته', JSON.stringify(lead));
    await c.ev(`document.getElementById('sent').click()`);
    ok(await c.waitFor(`/وصلنا خبر التحويل/.test(document.body.textContent)`, 15000) && !!sql(`select paid_claim_at from signup_requests where phone = '${PHONE_INTL}'`)[0].paid_claim_at, 'العام: «حوّلت» انسجل على طلب الاشتراك');
    await c.go(`${BASE}agree.html`, 500); await c.waitFor(`window.__firstpay`, 20000); await sleep(300);
    ok(await c.ev(`/وصلنا خبر التحويل/.test(document.body.textContent) && document.getElementById('ok').disabled`), 'العام: لو رجع للرابط يلقى حالته');
    grab(c, 'public');
  } finally { await c.close(); }

  // ── بدون بيانات تحويل ──
  setPay(null);
  const e = await launch({ width: 390, height: 844, scale: 2, mobile: true });
  try {
    sql(`delete from client_docs where business_id = '${id}'`);
    await e.go(`${BASE}agree.html?k=${k}`, 500); await e.waitFor(`window.__firstpay`, 20000); await sleep(300);
    await e.ev(`(() => { const x = document.getElementById('ok'); x.checked = true; x.dispatchEvent(new Event('change')); document.getElementById('go').click(); })()`);
    ok(await e.waitFor(`document.getElementById('payBox') && /توصلك بالواتساب/.test(document.getElementById('payBox').textContent)`, 15000), 'بدون بيانات تحويل: يقول إنها توصله بالواتساب');
    grab(e, 'nopay');
  } finally { await e.close(); }
} finally {
  if (before) setPay(before.value); else setPay(null);
  sql(`delete from businesses where slug like 'fp-test%'`);
  sql(`delete from signup_requests where phone = '${PHONE_INTL}'`);
  const back = sql(`select value from ihj_config where key = 'pay'`)[0];
  ok(JSON.stringify(back ? back.value : null) === JSON.stringify(before ? before.value : null) && !sql(`select 1 from businesses where slug like 'fp-test%'`).length, 'بيانات التحويل رجعت مثل ما كانت، والمنشأة والطلب انحذفوا');
}
if (errs.length) { console.log('أخطاء الصفحات:\n' + errs.slice(0, 10).join('\n')); fail += errs.length; }
console.log(`\n${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
