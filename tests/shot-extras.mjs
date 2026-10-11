// لقطات جوال لخيارات الطلب في محاكي منشأة (افتراضيًا سو كلين): كم سيارة، الإضافات، الأسئلة، رابط الدفع بالملخص، البكجات
// usage: node tests/shot-extras.mjs <outDir> [slug] [base]
// تجربة المحاكي تنمسح بالنهاية (عملاء المحاكي بس) عشان خطوة «تجربته باسمه» تبقى للعميل نفسه
import fs from 'node:fs';
import { launch, sleep } from '../tools/cdp.mjs';
import { sql } from '../tools/sql.mjs';

const OUT = process.argv[2] || 'tests/out';
const SLUG = process.argv[3] || 'soclean';
const BASE = process.argv[4] || 'https://fadiaalzhrani-debug.github.io/ihjizli/';
fs.mkdirSync(OUT, { recursive: true });
const biz = sql(`select id, slug, sim_key from businesses where slug = '${SLUG}'`)[0];
const url = `${BASE}sim.html?b=${biz.slug}&k=${biz.sim_key}`;
const outs = () => `document.querySelectorAll('.msg.in').length`;

const b = await launch({ width: 390, height: 844, scale: 2, mobile: true });
try {
  await b.go(url, 2000);
  await b.ev(`window.__sim.reset()`);
  await sleep(2500);
  // الحجز: الخدمة الأولى ← سيارتين ← واكس ← تم ← الموقع ← الأسئلة ← اليوم ← الوقت
  const step = async (js, waitMore = 1) => {
    const n = await b.ev(outs());
    await b.ev(js);
    await b.waitFor(`${outs()} >= ${n + waitMore} && !document.getElementById('typing')`, 20000);
    await sleep(900);
  };
  const svc = sql(`select id from services where business_id = '${biz.id}' and active order by sort limit 1`)[0].id;
  await step(`window.__sim.sendMsg({type:'reply', id:'m:book', title:'احجز من هنا'})`);
  await step(`window.__sim.sendMsg({type:'reply', id:'svc:${svc}', title:'غسيل داخلي وخارجي'})`);
  await b.ev(`[...document.querySelectorAll('[data-list]')].pop().click()`); await sleep(800);
  await b.shot(`${OUT}/x1-qty.png`);
  await b.ev(`document.querySelectorAll('#sheetB .opt')[1].click()`);
  await b.waitFor(`[...document.querySelectorAll('.bub')].some(x=>x.textContent.includes('تبي تضيف'))`, 20000); await sleep(900);
  await b.ev(`[...document.querySelectorAll('[data-list]')].pop().click()`); await sleep(800);
  await b.shot(`${OUT}/x2-addons.png`);
  await b.ev(`document.querySelectorAll('#sheetB .opt')[0].click()`);
  await b.waitFor(`[...document.querySelectorAll('.bub')].some(x=>x.textContent.includes('انضاف واكس'))`, 20000); await sleep(900);
  await step(`window.__sim.sendMsg({type:'reply', id:'ad:done', title:'تم، كمّل'})`);
  await step(`window.__sim.sendMsg({type:'location', lat:27.0123, lng:49.6052, name:'الجبيل الصناعية'})`);
  await step(`window.__sim.sendMsg({type:'text', text:'فيلا 14، المواقف قدام الباب'})`);
  await step(`window.__sim.sendMsg({type:'text', text:'أ ب ج 1234 و د هـ و 5678'})`);
  await b.shot(`${OUT}/x3-questions.png`);
  await b.ev(`[...document.querySelectorAll('[data-list]')].pop().click()`); await sleep(800);
  await b.ev(`document.querySelectorAll('#sheetB .opt')[1].click()`);
  await b.waitFor(`[...document.querySelectorAll('.bub')].some(x=>x.textContent.includes('اختر الوقت المناسب')) && !document.getElementById('typing')`, 20000); await sleep(1200);
  await b.ev(`[...document.querySelectorAll('[data-list]')].pop().click()`); await sleep(800);
  await b.shot(`${OUT}/x4a-times.png`);
  await b.ev(`document.querySelectorAll('#sheetB .opt')[2].click()`);
  await b.waitFor(`[...document.querySelectorAll('.bub')].some(x=>x.textContent.includes('الإجمالي')) && !document.getElementById('typing')`, 20000); await sleep(1500);
  await b.shot(`${OUT}/x4-summary.png`);
  // البكجات
  await step(`window.__sim.sendMsg({type:'reply', id:'m:packages', title:'البكجات'})`);
  await b.ev(`[...document.querySelectorAll('[data-list]')].pop().click()`); await sleep(800);
  await b.shot(`${OUT}/x5-packages.png`);
  await b.ev(`document.querySelectorAll('#sheetB .opt')[1].click()`);
  await b.waitFor(`[...document.querySelectorAll('.bub')].some(x=>x.textContent.includes('اشترِ الحين') || x.textContent.includes('9 غسلات'))`, 20000); await sleep(900);
  await step(`[...document.querySelectorAll('.btns button')].reverse().find((x) => x.textContent.includes('اشترِ')).click()`);
  await b.shot(`${OUT}/x6-buy.png`);
  const errs = (b.log || []).filter((x) => x.type === 'error' || x.type === 'exception');
  console.log('console errors', errs.length, errs.slice(0, 3));
} finally {
  await b.close();
  sql(`delete from customers where business_id = '${biz.id}' and is_sim`);
  console.log('sim trial cleared', sql(`select count(*) n from orders where business_id = '${biz.id}'`)[0].n, 'orders left');
}
console.log('shots in', OUT);
