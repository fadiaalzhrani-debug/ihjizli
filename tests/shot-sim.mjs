// لقطات المحاكي: الترحيب، إرسال الموقع، اختيار اليوم، التأكيد (كمبيوتر وجوال)
// usage: node tests/shot-sim.mjs <outDir> [base]
import { launch, sleep } from '../tools/cdp.mjs';
import { sql } from '../tools/sql.mjs';

const OUT = process.argv[2] || 'tests/out';
const BASE = process.argv[3] || 'http://localhost:5610/';
const biz = sql(`select slug, sim_key from businesses where slug='mahalak'`)[0];
const url = `${BASE}sim.html?b=${biz.slug}&k=${biz.sim_key}`;

async function flow(b, tag) {
  await b.go(url, 1500);
  await b.ev(`window.__sim.reset()`);
  await sleep(800);
  await b.ev(`window.__sim.sendMsg({type:'text',text:'السلام عليكم'})`);
  await b.waitFor(`document.querySelectorAll('.msg.in').length>=1 && !document.getElementById('typing')`, 15000);
  await sleep(900);
  await b.shot(`${OUT}/sim-${tag}-1-welcome.png`);
  await b.ev(`document.querySelector('.btns button').click()`);
  await b.waitFor(`document.querySelector('[data-loc]')`, 15000);
  await sleep(900);
  await b.ev(`document.querySelector('[data-loc]').click()`);
  await sleep(2200);
  await b.shot(`${OUT}/sim-${tag}-2-location.png`);
  await b.ev(`document.getElementById('sendLoc').click()`);
  await b.waitFor(`document.querySelectorAll('[data-list]').length>=1`, 15000);
  await sleep(1000);
  await b.ev(`[...document.querySelectorAll('[data-list]')].pop().click()`);
  await sleep(700);
  await b.shot(`${OUT}/sim-${tag}-3-days.png`);
  await b.ev(`document.querySelectorAll('#sheetB .opt')[1].click()`);
  await b.waitFor(`document.querySelectorAll('[data-list]').length>=2`, 15000);
  await sleep(1000);
  await b.ev(`[...document.querySelectorAll('[data-list]')].pop().click()`);
  await sleep(700);
  await b.shot(`${OUT}/sim-${tag}-4-times.png`);
  await b.ev(`document.querySelectorAll('#sheetB .opt')[3].click()`);
  await b.waitFor(`[...document.querySelectorAll('.bub')].some(x=>x.textContent.includes('رقم الطلب'))`, 15000);
  await sleep(1200);
  await b.shot(`${OUT}/sim-${tag}-5-confirmed.png`);
}

const desk = await launch({ width: 1280, height: 900 });
try { await flow(desk, 'desk'); } finally { await desk.close(); }
const mob = await launch({ width: 390, height: 844, scale: 2, mobile: true });
try { await flow(mob, 'mob'); } finally { await mob.close(); }
console.log('sim shots done');
