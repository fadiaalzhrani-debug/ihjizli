// لقطات النسخة الخامسة: سير العمل (المسار كامل، ومحاكاة يوم بيوم، ومنشأة)، دليل التشغيل بالخطوات العشر، ولوحة المنشأة (الأزرار وحالة الربط)
import fs from 'node:fs';
import { launch, sleep } from '../tools/cdp.mjs';
const BASE = 'http://localhost:5610/';
const OUT = 'tests/out/v5';
fs.mkdirSync(OUT, { recursive: true });
const WHICH = process.argv[2] || 'all';
const adminTok = fs.readFileSync(new URL('../.secrets/admin-link.txt', import.meta.url), 'utf8').trim().split('#k=')[1];
const errs = [];
const grab = (b, tag) => { for (const l of b.log) if (l.type === 'error' || l.type === 'exception') errs.push(`${tag}: ${l.text}`); };
async function admin(o) { const b = await launch(o); await b.go(`${BASE}admin.html#k=${adminTok}`, 500); await b.waitFor(`window.__admin && document.getElementById('view').children.length > 0`, 25000); await sleep(600); return b; }

if (WHICH === 'all' || WHICH === 'flow') {
  const b = await admin({ width: 1360, height: 980 });
  try {
    await b.go(`${BASE}deal.html`, 500); await b.waitFor(`window.__flow`, 20000); await sleep(1000);
    await b.shot(`${OUT}/flow-top.png`);
    await b.ev(`__flow.setDay(3)`); await sleep(500);
    await b.ev(`document.querySelector('.sim').scrollIntoView({block:'start'})`); await sleep(400);
    await b.shot(`${OUT}/flow-day3.png`);
    await b.ev(`document.getElementById('st-connect').scrollIntoView({block:'start'})`); await sleep(400);
    await b.shot(`${OUT}/flow-step-connect.png`);
    await b.ev(`document.getElementById('programming').scrollIntoView({block:'start'})`); await sleep(400);
    await b.shot(`${OUT}/flow-programming.png`);
    const id = await b.ev(`(document.querySelector('#who option[value]:not([value=""])') || {}).value || ''`);
    if (id) { await b.ev(`__flow.pick('${id}')`); await sleep(800); await b.ev(`window.scrollTo(0,0)`); await sleep(300); await b.shot(`${OUT}/flow-biz.png`); }
    grab(b, 'flow');
  } finally { await b.close(); }
  const m = await admin({ width: 390, height: 844, scale: 2, mobile: true });
  try {
    await m.go(`${BASE}deal.html`, 500); await m.waitFor(`window.__flow`, 20000); await sleep(1000);
    await m.shot(`${OUT}/flow-mob.png`);
    await m.ev(`__flow.setDay(4); document.querySelector('.sim').scrollIntoView({block:'start'})`); await sleep(500);
    await m.shot(`${OUT}/flow-mob-day4.png`);
    grab(m, 'flow-mob');
  } finally { await m.close(); }
}
if (WHICH === 'all' || WHICH === 'guide') {
  const b = await admin({ width: 1360, height: 1000 });
  try {
    await b.ev(`__admin.go('onboard')`); await b.waitFor(`document.querySelectorAll('.ost').length >= 10`, 15000); await sleep(1200);
    await b.shot(`${OUT}/guide-top.png`);
    await b.ev(`document.querySelectorAll('.ost')[2].scrollIntoView({block:'start'})`); await sleep(400);
    await b.shot(`${OUT}/guide-build.png`);
    await b.ev(`document.querySelectorAll('.ost')[8].scrollIntoView({block:'start'})`); await sleep(400);
    await b.shot(`${OUT}/guide-live.png`);
    grab(b, 'guide');
  } finally { await b.close(); }
}
if (WHICH === 'all' || WHICH === 'biz') {
  const { sql } = await import('../tools/sql.mjs');
  const salon = sql(`select id from businesses where slug = 'salon'`)[0].id;
  const b = await admin({ width: 1360, height: 1000 });
  try {
    await b.go(`${BASE}biz.html?b=${salon}`, 500); await b.waitFor(`window.__biz && document.getElementById('oList')`, 25000); await sleep(1000);
    await b.shot(`${OUT}/biz-orders.png`);
    await b.ev(`__biz.go('texts')`); await sleep(1200);
    await b.shot(`${OUT}/biz-texts-menu.png`);
    grab(b, 'biz');
  } finally { await b.close(); }
}
console.log('v5 shots done', errs.length ? '\n' + errs.join('\n') : '(no console errors)');
