// لقطات جوال لمسار المشترك في المحاكي: يشتري بكج (دفع تجريبي) ← الترحيب يذكّره برصيده ← «احجز من رصيدي» ← تأكيد بدون دفع
// usage: node tests/shot-balance.mjs <outDir> [slug] [base]
// تجربة المحاكي تنمسح بالنهاية (عملاء المحاكي بس)
import fs from 'node:fs';
import { launch, sleep } from '../tools/cdp.mjs';
import { sql } from '../tools/sql.mjs';

const OUT = process.argv[2] || 'tests/out';
const SLUG = process.argv[3] || 'soclean';
const BASE = process.argv[4] || 'https://fadiaalzhrani-debug.github.io/ihjizli/';
const P = JSON.parse(fs.readFileSync(new URL('../.secrets/project.json', import.meta.url)));
fs.mkdirSync(OUT, { recursive: true });
const biz = sql(`select id, slug, sim_key from businesses where slug = '${SLUG}'`)[0];
const svc = sql(`select id from services where business_id = '${biz.id}' and active order by sort limit 1`)[0].id;
const pk = sql(`select id from packages where business_id = '${biz.id}' and active order by sort limit 1 offset 1`)[0].id;
const b = await launch({ width: 390, height: 844, scale: 2, mobile: true });
const has = (t) => `[...document.querySelectorAll('.bub')].some((x) => x.textContent.includes(${JSON.stringify(t)})) && !document.getElementById('typing')`;
const open = async (i) => { await b.ev(`[...document.querySelectorAll('[data-list]')].pop().click()`); await sleep(700); if (i != null) { await b.ev(`document.querySelectorAll('#sheetB .opt')[${i}].click()`); } };
try {
  await b.go(`${BASE}sim.html?b=${biz.slug}&k=${biz.sim_key}`, 2000);
  await b.ev(`window.__sim.reset()`);
  await b.waitFor(has('كيف نقدر نخدمك'), 20000); await sleep(1200);
  // يشتري البكج الثاني ويدفع (تجريبي)
  await b.ev(`window.__sim.sendMsg({type:'reply', id:'pkb:${pk}', title:'اشترِ الحين'})`);
  await b.waitFor(`document.querySelector('a[href*="/pay/go/"]')`, 20000); await sleep(800);
  const t = /\/pay\/go\/([0-9a-f]{32})/.exec(await b.ev(`[...document.querySelectorAll('a[href*="/pay/go/"]')].pop().href`))[1];
  const pd = await (await fetch(`${P.url}/functions/v1/pay/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t, method: 'mada' }) })).json();
  if (!pd.ok) throw new Error('pay ' + JSON.stringify(pd));
  await b.waitFor(has('صار عندك'), 20000); await sleep(1200);
  await b.shot(`${OUT}/b1-paid.png`);
  // يرجع بعدين يكلّم البوت
  await b.ev(`window.__sim.sendMsg({type:'text', text:'السلام عليكم'})`);
  await b.waitFor(has('في رصيدك'), 20000); await sleep(1200);
  await b.shot(`${OUT}/b2-welcome.png`);
  await b.ev(`window.__sim.sendMsg({type:'reply', id:'m:bookbal', title:'احجز من رصيدي'})`);
  await b.waitFor(has('وش الخدمة'), 20000); await sleep(900);
  await b.ev(`window.__sim.sendMsg({type:'reply', id:'svc:${svc}', title:'غسيل داخلي وخارجي'})`);
  await b.waitFor(has('كم سيارة'), 20000); await sleep(900);
  await open(null); await sleep(500);
  await b.shot(`${OUT}/b3-qty.png`);
  await b.ev(`document.querySelectorAll('#sheetB .opt')[0].click()`);
  await b.waitFor(has('تبي تضيف'), 20000); await sleep(900);
  await b.ev(`window.__sim.sendMsg({type:'reply', id:'ad:done', title:'بدون إضافات'})`);
  await b.waitFor(`document.querySelector('[data-loc]') && !document.getElementById('typing')`, 20000); await sleep(600);
  await b.ev(`window.__sim.sendMsg({type:'location', lat:27.0123, lng:49.6052, name:'الجبيل الصناعية'})`);
  await b.waitFor(has('تفاصيل الموقع'), 20000); await sleep(600);
  await b.ev(`window.__sim.sendMsg({type:'text', text:'فيلا 14'})`);
  await b.waitFor(has('رقم لوحة'), 20000); await sleep(600);
  await b.ev(`window.__sim.sendMsg({type:'text', text:'أ ب ج 1234'})`);
  await b.waitFor(has('اختر اليوم'), 20000); await sleep(900);
  await open(1);
  await b.waitFor(has('اختر الوقت'), 20000); await sleep(900);
  await open(2);
  await b.waitFor(has('تم تأكيد طلبك'), 20000); await sleep(1500);
  await b.shot(`${OUT}/b4-confirmed.png`);
  console.log('errors', b.log.filter((x) => x.type === 'error' || x.type === 'exception').length);
} finally {
  await b.close();
  sql(`delete from customers where business_id = '${biz.id}' and is_sim`);
  console.log('sim trial cleared', sql(`select count(*) n from orders where business_id = '${biz.id}'`)[0].n, 'orders left');
}
