// لقطات النسخة الثالثة: دليل التشغيل بروابطه، المنشأة الجديدة (طريقة الشغل)، محاكي البيع، صفحات العميل
// usage: node tests/shot-v3.mjs [which]
import fs from 'node:fs';
import { launch, sleep } from '../tools/cdp.mjs';

const BASE = 'http://localhost:5610/';
const OUT = 'tests/out/v3';
const WHICH = process.argv[2] || 'all';
fs.mkdirSync(OUT, { recursive: true });
const adminTok = fs.readFileSync(new URL('../.secrets/admin-link.txt', import.meta.url), 'utf8').trim().split('#k=')[1];
const errs = [];
const grab = (b, tag) => { for (const l of b.log) if (l.type === 'error' || l.type === 'exception') errs.push(`${tag}: ${l.text}`); };

async function adminPage(o) {
  const b = await launch(o);
  await b.go(`${BASE}admin.html#k=${adminTok}`, 500);
  await b.waitFor(`window.__admin && document.getElementById('view') && document.getElementById('view').children.length > 0`, 25000);
  await sleep(800);
  return b;
}

if (WHICH === 'all' || WHICH === 'guide') {
  const b = await adminPage({ width: 1360, height: 1000 });
  try {
    await b.ev(`__admin.go('onboard')`);
    await b.waitFor(`document.querySelectorAll('.ost').length >= 8`, 15000); await sleep(1500);
    await b.shot(`${OUT}/guide-desk.png`);
    await b.shot(`${OUT}/guide-desk-full.png`, true);
    // جوال في الذاكرة فقط (ما ينحفظ ولا ينضغط) عشان يبان زر «أرسل له»
    await b.ev(`(() => { const x = __admin.S.biz.find(y => y.id === __admin.S.obBiz); x.owner_phone = '966500000000'; __admin.go('onboard'); })()`); await sleep(800);
    await b.shot(`${OUT}/guide-desk-send.png`);
    await b.ev(`__admin.go('home')`); await sleep(800);
    await b.shot(`${OUT}/admin-home.png`);
    await b.ev(`__admin.go('new')`); await sleep(800);
    await b.ev(`document.querySelector('input[name=pay_timing][value=before]').click(); document.querySelector('input[name=place_mode][value=shop]').click();`); await sleep(400);
    await b.ev(`document.querySelectorAll('.form-sec')[2].scrollIntoView({block:'start'})`); await sleep(500);
    await b.shot(`${OUT}/admin-new-modes.png`);
    grab(b, 'admin-desk');
  } finally { await b.close(); }
  const m = await adminPage({ width: 390, height: 844, scale: 2, mobile: true });
  try {
    await m.ev(`__admin.go('onboard')`);
    await m.waitFor(`document.querySelectorAll('.ost').length >= 8`, 15000); await sleep(1500);
    await m.shot(`${OUT}/guide-mob.png`);
    await m.ev(`(() => { const x = __admin.S.biz.find(y => y.id === __admin.S.obBiz); x.owner_phone = '966500000000'; __admin.go('onboard'); })()`); await sleep(800);
    await m.ev(`document.querySelectorAll('.ost')[0].scrollIntoView({block:'start'})`); await sleep(500);
    await m.shot(`${OUT}/guide-mob-send.png`);
    await m.ev(`document.querySelectorAll('.ost')[3].scrollIntoView({block:'start'})`); await sleep(500);
    await m.shot(`${OUT}/guide-mob-2.png`);
    grab(m, 'admin-mob');
  } finally { await m.close(); }
}

if (WHICH === 'all' || WHICH === 'deal') {
  const b = await adminPage({ width: 1360, height: 900 });
  try {
    await b.go(`${BASE}deal.html`, 500);
    await b.waitFor(`window.__deal`, 20000); await sleep(800);
    await b.ev(`document.getElementById('all').click()`); await sleep(600);
    await b.ev(`document.querySelector('.cv').scrollTop = 0`); await sleep(300);
    await b.shot(`${OUT}/deal-desk.png`);
    await b.ev(`[...document.querySelectorAll('[data-obj]')][0].click()`); await sleep(400);
    await b.ev(`document.querySelector('.obj').scrollIntoView({block:'center'})`); await sleep(400);
    await b.shot(`${OUT}/deal-desk-obj.png`);
    grab(b, 'deal-desk');
  } finally { await b.close(); }
  const m = await adminPage({ width: 390, height: 844, scale: 2, mobile: true });
  try {
    await m.go(`${BASE}deal.html`, 500);
    await m.waitFor(`window.__deal`, 20000); await sleep(1000);
    await m.shot(`${OUT}/deal-mob.png`);
    grab(m, 'deal-mob');
  } finally { await m.close(); }
}

if (WHICH === 'all' || WHICH === 'biz') {
  const { sql } = await import('../tools/sql.mjs');
  const salon = sql(`select id from businesses where slug = 'salon'`)[0].id;
  const b = await adminPage({ width: 1360, height: 1000 });
  try {
    await b.go(`${BASE}biz.html?b=${salon}`, 500);
    await b.waitFor(`window.__biz && document.getElementById('oList')`, 25000); await sleep(1200);
    await b.ev(`__biz.go('settings')`); await sleep(2500);
    await b.shot(`${OUT}/biz-settings-modes.png`);
    await b.ev(`__biz.go('texts')`); await sleep(1200);
    await b.shot(`${OUT}/biz-texts-faq.png`);
    grab(b, 'biz-desk');
  } finally { await b.close(); }
  const m = await adminPage({ width: 390, height: 844, scale: 2, mobile: true });
  try {
    await m.go(`${BASE}biz.html?b=${salon}`, 500);
    await m.waitFor(`window.__biz && document.getElementById('oList')`, 25000); await sleep(1200);
    await m.ev(`__biz.go('settings')`); await sleep(2500);
    await m.shot(`${OUT}/biz-mob-settings.png`);
    await m.ev(`__biz.go('texts')`); await sleep(1200);
    await m.shot(`${OUT}/biz-mob-texts.png`);
    grab(m, 'biz-mob');
  } finally { await m.close(); }
}

if (WHICH === 'all' || WHICH === 'client') {
  const { sql } = await import('../tools/sql.mjs');
  const k = sql(`select client_key from businesses where slug = 'mahalak'`)[0].client_key;
  const m = await launch({ width: 390, height: 844, scale: 2, mobile: true });
  try {
    for (const [p, wait] of [['agree.html', `document.querySelector('.paper')`], ['start.html', `document.querySelector('form, .card')`], ['help.html', `document.querySelector('.sec')`]]) {
      await m.go(`${BASE}${p}?k=${k}`, 500);
      await m.waitFor(wait, 20000); await sleep(1200);
      await m.shot(`${OUT}/client-${p.replace('.html', '')}.png`);
    }
    grab(m, 'client');
  } finally { await m.close(); }
}
console.log('v3 shots done', errs.length ? '\n' + errs.join('\n') : '(no console errors)');
