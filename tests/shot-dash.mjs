// لقطات اللوحات: المنشأة (كمبيوتر وجوال)، الموظف (جوال)، لوحتي (كمبيوتر)
// usage: node tests/shot-dash.mjs [outDir] [which]
import fs from 'node:fs';
import { launch, sleep } from '../tools/cdp.mjs';
import { testLinks } from './links.mjs';

const OUT = process.argv[2] || 'tests/out';
const WHICH = process.argv[3] || 'all';
const BASE = 'http://localhost:5610/';
const L = await testLinks();
const adminTok = fs.readFileSync(new URL('../.secrets/admin-link.txt', import.meta.url), 'utf8').trim().split('#k=')[1];
const errs = [];
const grab = (b, tag) => { for (const l of b.log) if (l.type === 'error' || l.type === 'exception') errs.push(`${tag}: ${l.text}`); };

if (WHICH === 'all' || WHICH === 'biz') {
  const b = await launch({ width: 1360, height: 900 });
  try {
    await b.go(`${BASE}biz.html#k=${L.tok('owner_mahalak')}`, 500);
    await b.waitFor(`document.getElementById('oList')`, 20000);
    await sleep(1500);
    await b.ev(`document.querySelector('[data-f="all"]').click()`); await sleep(400);
    await b.shot(`${OUT}/biz-desk-orders.png`);
    await b.ev(`document.querySelector('[data-oid]').click()`);
    await b.waitFor(`document.querySelector('#od .card')`, 15000); await sleep(800);
    await b.shot(`${OUT}/biz-desk-order.png`);
    await b.ev(`IHJ.closeAll(); __biz.go('settings')`); await sleep(2500);
    await b.shot(`${OUT}/biz-desk-settings.png`);
    await b.ev(`__biz.go('report')`); await sleep(2500);
    await b.shot(`${OUT}/biz-desk-report.png`);
    await b.ev(`__biz.go('staff')`); await sleep(2000);
    await b.shot(`${OUT}/biz-desk-staff.png`);
    await b.ev(`__biz.go('hours')`); await sleep(1200);
    await b.shot(`${OUT}/biz-desk-hours.png`);
    grab(b, 'biz-desk');
  } finally { await b.close(); }
  const m = await launch({ width: 390, height: 844, scale: 2, mobile: true });
  try {
    await m.go(`${BASE}biz.html#k=${L.tok('owner_mahalak')}`, 500);
    await m.waitFor(`document.getElementById('oList')`, 20000); await sleep(1500);
    await m.ev(`document.querySelector('[data-f="all"]').click()`); await sleep(400);
    await m.shot(`${OUT}/biz-mob-orders.png`);
    grab(m, 'biz-mob');
  } finally { await m.close(); }
}
if (WHICH === 'all' || WHICH === 'staff') {
  const m = await launch({ width: 390, height: 844, scale: 2, mobile: true });
  try {
    await m.go(`${BASE}staff.html#k=${L.tok('staff_ahmed')}`, 500);
    await m.waitFor(`document.getElementById('list')`, 20000); await sleep(1500);
    await m.ev(`(document.querySelector('[data-t="next"]')||document.querySelector('[data-t]')).click()`); await sleep(500);
    await m.shot(`${OUT}/staff-mob.png`);
    grab(m, 'staff');
  } finally { await m.close(); }
}
if (WHICH === 'all' || WHICH === 'admin') {
  const b = await launch({ width: 1360, height: 900 });
  try {
    await b.go(`${BASE}admin.html#k=${adminTok}`, 500);
    await b.waitFor(`document.querySelector('.kpis')`, 20000); await sleep(1500);
    await b.shot(`${OUT}/admin-home.png`);
    await b.ev(`__admin.go('biz')`); await sleep(800);
    await b.shot(`${OUT}/admin-biz.png`);
    await b.ev(`__admin.openBiz(__admin.S.biz.find(x=>x.slug==='mahalak').id,'steps')`); await sleep(1500);
    await b.shot(`${OUT}/admin-biz-steps.png`);
    await b.ev(`IHJ.closeAll(); __admin.go('new')`); await sleep(800);
    await b.shot(`${OUT}/admin-new.png`);
    await b.ev(`__admin.go('onboard')`); await sleep(800);
    await b.shot(`${OUT}/admin-onboard.png`);
    grab(b, 'admin');
  } finally { await b.close(); }
}
console.log('dash shots done', errs.length ? '\nERRORS:\n' + errs.join('\n') : '(no console errors)');
