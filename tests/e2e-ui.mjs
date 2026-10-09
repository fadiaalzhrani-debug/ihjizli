// فحص الواجهة الكامل (معيار التسليم): من لوحتي أنشئ منشأة جديدة بالنموذج، ثم حجز كامل في المحاكي
// يوصل لوحتها بصوت الفلوس، ثم فاتورة ورابط دفع، ثم دفع تجريبي و«وصلنا دفعك». مع لقطات وقياس الوقت.
// usage: node tests/e2e-ui.mjs [base] [--keep]
import fs from 'node:fs';
import { launch, sleep } from '../tools/cdp.mjs';
import { sessionFor, rest, api } from './link-check.mjs';

const BASE = (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:5610/');
const KEEP = process.argv.includes('--keep');
const OUT = 'tests/out/ui';
fs.mkdirSync(OUT, { recursive: true });
const adminTok = fs.readFileSync(new URL('../.secrets/admin-link.txt', import.meta.url), 'utf8').trim().split('#k=')[1];
const steps = [];
const t0 = Date.now();
const mark = (name) => { steps.push({ name, sec: Math.round((Date.now() - t0) / 100) / 10 }); console.log(`✓ ${name} (${steps.at(-1).sec}s)`); };
const must = async (b, expr, ms, what) => { if (!(await b.waitFor(expr, ms))) { await b.shot(`${OUT}/fail.png`); throw new Error('timeout: ' + what); } };

const A = await launch({ width: 1360, height: 900 });
const B = await launch({ width: 390, height: 844, scale: 2, mobile: true });
let bizId = null, simUrl = '';
try {
  // ── 1) منشأة جديدة من لوحتي ──
  await A.go(`${BASE}admin.html#k=${adminTok}`, 300);
  await must(A, `document.querySelector('.kpis')`, 25000, 'admin home');
  await A.ev(`__admin.go('new')`);
  await must(A, `document.getElementById('nf')`, 5000, 'new form');
  await A.ev(`(() => {
    const f = document.getElementById('nf'), set = (n, v) => { const el = f.querySelector('[name="'+n+'"]'); el.value = v; el.dispatchEvent(new Event('input', {bubbles:true})); };
    set('name', 'صالون تجربة الواجهة'); set('name_en', 'UI Test Salon'); set('activity', 'صالون أو تجميل'); set('wa_number', '0550000000'); set('owner_name', 'صاحب المحل'); set('owner_phone', '0550000001');
    f.querySelector('[name=plan][value=bot_pay]').checked = true; f.querySelector('[name=is_demo]').checked = true;
    const sv = document.querySelector('#svcs input[data-k=name]'); sv.value = 'قص وتصفيف'; sv.dispatchEvent(new Event('input'));
    const pr = document.querySelector('#svcs input[data-k=price]'); pr.value = '80'; pr.dispatchEvent(new Event('input'));
    const khobar = [...f.querySelectorAll('input[name=city]')].find(x => x.value === 'الخبر'); khobar.checked = true; khobar.dispatchEvent(new Event('change'));
    document.getElementById('addStf').click();
  })()`);
  await sleep(300);
  await A.ev(`(() => { const n = document.querySelector('#stf input[data-k=name]'); n.value = 'فهد'; n.dispatchEvent(new Event('input')); const p = document.querySelector('#stf input[data-k=phone]'); p.value = '0550000002'; p.dispatchEvent(new Event('input')); })()`);
  await A.shot(`${OUT}/1-new-form.png`);
  await A.ev(`document.getElementById('nGo').click()`);
  await must(A, `document.querySelector('#nRes .result')`, 30000, 'create result');
  mark('انشأت المنشأة من نموذج لوحتي');
  await A.shot(`${OUT}/2-created.png`);
  simUrl = await A.ev(`[...document.querySelectorAll('#nRes a')].find(a => a.textContent.includes('افتح المحاكي')).href`);
  bizId = await A.ev(`[...document.querySelectorAll('#nRes a')].find(a => a.textContent.includes('لوحة المنشأة')).href.split('b=')[1]`);

  // ── 2) لوحة المنشأة مفتوحة تنتظر ──
  await A.go(`${BASE}biz.html?b=${bizId}`, 300);
  await must(A, `document.getElementById('oList') && window.__live === 'SUBSCRIBED'`, 30000, 'biz dashboard live');
  await A.ev(`window.__ihjCash = 0`);
  mark('لوحة المنشأة مفتوحة ومتصلة مباشر');

  // ── 3) حجز كامل في المحاكي (ضغط الأزرار مثل العميل) ──
  await B.go(simUrl, 1200);
  await must(B, `document.getElementById('inp')`, 15000, 'sim');
  await B.ev(`(() => { const i = document.getElementById('inp'); i.value = 'السلام عليكم'; document.querySelector('.send').click(); })()`);
  await must(B, `[...document.querySelectorAll('.btns button')].some(b => b.textContent.includes('احجز من هنا'))`, 20000, 'welcome');
  await sleep(700);
  await B.ev(`[...document.querySelectorAll('.btns button')].find(b => b.textContent.includes('احجز من هنا')).click()`);
  await must(B, `document.querySelector('[data-loc]')`, 20000, 'location request');
  await sleep(700);
  await B.ev(`document.querySelector('[data-loc]').click()`);
  await sleep(1800);
  await B.shot(`${OUT}/3-sim-location.png`);
  await B.ev(`document.getElementById('sendLoc').click()`);
  await must(B, `document.querySelectorAll('[data-list]').length >= 1`, 20000, 'days');
  await sleep(800);
  await B.ev(`[...document.querySelectorAll('[data-list]')].pop().click()`); await sleep(500);
  await B.ev(`document.querySelectorAll('#sheetB .opt')[1].click()`);
  await must(B, `document.querySelectorAll('[data-list]').length >= 2`, 20000, 'times');
  await sleep(800);
  await B.ev(`[...document.querySelectorAll('[data-list]')].pop().click()`); await sleep(500);
  await B.shot(`${OUT}/4-sim-times.png`);
  await B.ev(`document.querySelectorAll('#sheetB .opt')[2].click()`);
  await must(B, `[...document.querySelectorAll('.bub')].some(x => x.textContent.includes('رقم الطلب'))`, 20000, 'confirmation');
  await sleep(1200);
  await B.shot(`${OUT}/5-sim-confirmed.png`);
  mark('حجز كامل في المحاكي برقم طلب');

  // ── 4) الطلب يوصل اللوحة بالصوت ──
  await must(A, `window.__ihjCash >= 1 && document.querySelectorAll('[data-oid]').length >= 1`, 20000, 'cash sound + order card');
  const cash = await A.ev(`window.__ihjCash`);
  await sleep(600);
  await A.shot(`${OUT}/6-biz-new-order.png`);
  mark(`الطلب وصل لوحة المنشأة بصوت الفلوس (${cash})`);

  // ── 5) الفاتورة ورابط الدفع (من لوحة المنشأة) ──
  await A.ev(`document.querySelector('[data-oid]').click()`);
  await must(A, `document.querySelector('[data-act=invoice]')`, 15000, 'order drawer');
  await A.ev(`document.querySelector('[data-act=invoice]').click()`);
  await must(A, `document.getElementById('invGo')`, 5000, 'invoice form');
  await sleep(300);
  await A.shot(`${OUT}/7-invoice-form.png`);
  await A.ev(`document.getElementById('invGo').click()`);
  await must(B, `document.querySelector('.doc') && [...document.querySelectorAll('a.inbtn')].some(a => a.textContent.includes('ادفع'))`, 30000, 'invoice in sim');
  await sleep(1200);
  await B.shot(`${OUT}/8-sim-invoice.png`);
  mark('الفاتورة PDF ورابط الدفع وصلوا العميل');

  // ── 6) الدفع (تجريبي) و«وصلنا دفعك» ──
  const payHref = await B.ev(`[...document.querySelectorAll('a.inbtn')].find(a => a.textContent.includes('ادفع')).href`);
  const C = await launch({ width: 390, height: 844, scale: 2, mobile: true });
  try {
    // زر الدفع يمر على /pay/go ثم صفحة الدفع في الموقع؛ نفتح نفس الصفحة من النسخة المحلية
    const tok = payHref.split('/pay/go/')[1];
    await C.go(`${BASE}pay.html?t=${tok}`, 1500);
    await must(C, `document.getElementById('payBtn')`, 20000, 'pay page');
    await C.shot(`${OUT}/9-pay-page.png`);
    await C.ev(`document.getElementById('payBtn').click()`);
    await must(C, `document.body.innerText.includes('تم الدفع')`, 20000, 'paid page');
    await sleep(600);
    await C.shot(`${OUT}/10-paid.png`);
  } finally { await C.close(); }
  await must(B, `[...document.querySelectorAll('.bub')].some(x => x.textContent.includes('وصلنا دفعك'))`, 20000, 'paid message in sim');
  await sleep(1000);
  await B.shot(`${OUT}/11-sim-paid.png`);
  mark('الدفع وصل و«وصلنا دفعك» وانقفل الطلب');
  await A.ev(`IHJ.closeAll(); __biz.S.filter='done'; __biz.render()`);
  await sleep(1500);
  await A.shot(`${OUT}/12-biz-done.png`);

  const errs = [...A.log, ...B.log].filter((l) => l.type === 'error' || l.type === 'exception');
  fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ ok: true, total_sec: Math.round((Date.now() - t0) / 1000), steps, console_errors: errs }, null, 1));
  console.log(`\nكامل المسار في ${Math.round((Date.now() - t0) / 1000)} ثانية · أخطاء الكونسول: ${errs.length}`);
  if (errs.length) console.log(errs.map((e) => e.text).join('\n'));
} catch (e) {
  console.error('✗', e.message);
  fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ ok: false, error: e.message, steps }, null, 1));
  process.exitCode = 1;
} finally {
  await A.close(); await B.close();
  if (bizId && !KEEP) {
    const a = await sessionFor(adminTok);
    for (const l of (await api(a.jwt, 'admin/link/list', { business_id: bizId })).links || []) await api(a.jwt, 'admin/link/revoke', { link_id: l.id });
    await rest(a.jwt, `businesses?id=eq.${bizId}`, { method: 'DELETE' });
    console.log('تنظيف: انحذفت منشأة الفحص');
  }
}
