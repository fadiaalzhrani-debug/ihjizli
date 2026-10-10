// لقطات النسخة الثانية: الموقع العام (كمبيوتر وجوال) وقائمة مجالات المحاكي والتخصيص
import { launch, sleep } from '../tools/cdp.mjs';
const BASE = process.argv[2] || 'http://localhost:5610/';
const OUT = 'tests/out/v2';
const which = process.argv[3] || 'all';
const errs = [];
if (which === 'all' || which === 'site') {
  const d = await launch({ width: 1280, height: 860 });
  try {
    await d.go(BASE + 'index.html', 2500);
    await d.shot(`${OUT}/site-hero.png`);
    for (const id of ['any', 'fields', 'yours', 'plans', 'faq']) { await d.ev(`document.getElementById('${id}').scrollIntoView()`); await sleep(500); await d.shot(`${OUT}/site-${id}.png`); }
    const h = await d.ev(`document.documentElement.scrollHeight`); console.log('page height', h);
    errs.push(...d.log.filter((l) => l.type === 'error' || l.type === 'exception').map((l) => 'site: ' + l.text));
  } finally { await d.close(); }
  const m = await launch({ width: 390, height: 844, scale: 2, mobile: true });
  try {
    await m.go(BASE + 'index.html', 2500);
    await m.shot(`${OUT}/site-mob-hero.png`);
    await m.ev(`document.getElementById('fields').scrollIntoView()`); await sleep(500);
    await m.shot(`${OUT}/site-mob-fields.png`);
  } finally { await m.close(); }
}
if (which === 'all' || which === 'sim') {
  const m = await launch({ width: 390, height: 844, scale: 2, mobile: true });
  try {
    await m.go(BASE + 'sim.html?demo=1', 2000);
    await m.shot(`${OUT}/sim-home.png`);
    await m.ev(`document.querySelectorAll('.chatrow')[1].click()`);
    await m.waitFor(`document.querySelectorAll('.btns button').length >= 2 && !document.getElementById('typing')`, 20000); await sleep(1200);
    await m.shot(`${OUT}/sim-salon-welcome.png`);
    await m.ev(`[...document.querySelectorAll('#chips button')].find(b => b.textContent.includes('تستقبلون')||b.textContent.includes('كم السعر')).click()`);
    await m.waitFor(`document.querySelectorAll('.msg.in').length >= 2 && !document.getElementById('typing')`, 20000); await sleep(1200);
    await m.shot(`${OUT}/sim-salon-faq.png`);
    await m.ev(`document.getElementById('gearBtn').click()`); await sleep(700);
    await m.shot(`${OUT}/sim-cfg.png`);
    errs.push(...m.log.filter((l) => l.type === 'error' || l.type === 'exception').map((l) => 'sim: ' + l.text));
  } finally { await m.close(); }
  const d = await launch({ width: 1280, height: 900 });
  try {
    await d.go(BASE + 'sim.html?demo=1&open=clinic', 2500);
    await d.waitFor(`document.querySelectorAll('.btns button').length >= 2 && !document.getElementById('typing')`, 20000); await sleep(1200);
    await d.shot(`${OUT}/sim-desk-clinic.png`);
  } finally { await d.close(); }
}
console.log('v2 shots done', errs.length ? errs.join('\n') : '(no console errors)');
