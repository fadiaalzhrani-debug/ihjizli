// لقطات النسخة الرابعة: الصفحة الأولى الجديدة (خلفية 3D، لون نيلي)، معالج التخصيص في المحاكي، محاكي البيع التدريبي، صفحة «كيف نشتغل معك»
// usage: node tests/shot-v4.mjs [site|sim|deal|help|all]
import fs from 'node:fs';
import { launch, sleep } from '../tools/cdp.mjs';
const BASE = 'http://localhost:5610/';
const OUT = 'tests/out/v4';
const WHICH = process.argv[2] || 'all';
fs.mkdirSync(OUT, { recursive: true });
const adminTok = fs.readFileSync(new URL('../.secrets/admin-link.txt', import.meta.url), 'utf8').trim().split('#k=')[1];
const errs = [];
const grab = (b, tag) => { for (const l of b.log) if (l.type === 'error' || l.type === 'exception') errs.push(`${tag}: ${l.text}`); };

if (WHICH === 'all' || WHICH === 'site') {
  const d = await launch({ width: 1280, height: 860, gpu: true });
  try {
    await d.go(BASE + 'index.html', 3500);
    const gl = await d.ev(`!!document.querySelector('#bg3d canvas')`);
    console.log('3d canvas:', gl);
    await d.shot(`${OUT}/site-hero.png`);
    await d.ev(`document.getElementById('why').scrollIntoView()`); await sleep(600);
    await d.shot(`${OUT}/site-why.png`);
    await d.ev(`document.getElementById('any').scrollIntoView()`); await sleep(600);
    await d.shot(`${OUT}/site-any.png`);
    await d.ev(`document.getElementById('plans').scrollIntoView()`); await sleep(600);
    await d.shot(`${OUT}/site-plans.png`);
    console.log('page height', await d.ev(`document.documentElement.scrollHeight`));
    grab(d, 'site');
  } finally { await d.close(); }
  const m = await launch({ width: 390, height: 844, scale: 2, mobile: true, gpu: true });
  try {
    await m.go(BASE + 'index.html', 3500);
    await m.shot(`${OUT}/site-mob-hero.png`);
    await m.ev(`document.getElementById('why').scrollIntoView()`); await sleep(600);
    await m.shot(`${OUT}/site-mob-why.png`);
    grab(m, 'site-mob');
  } finally { await m.close(); }
}

if (WHICH === 'all' || WHICH === 'sim') {
  const m = await launch({ width: 390, height: 844, scale: 2, mobile: true });
  try {
    await m.go(BASE + 'sim.html?demo=1&open=salon', 2000);
    await m.waitFor(`document.querySelectorAll('.btns button').length >= 2 && !document.getElementById('typing')`, 20000); await sleep(800);
    await m.ev(`document.getElementById('gearBtn').click()`); await sleep(600);
    await m.shot(`${OUT}/sim-wiz-1.png`);
    await m.ev(`document.getElementById('wNext').click()`); await sleep(400);
    await m.shot(`${OUT}/sim-wiz-main.png`);
    // اختيار: الأسعار، سؤال خاص لاحقًا، احجز
    await m.ev(`[...document.querySelectorAll('[data-k]')].find(b => b.dataset.k === 'prices').click()`); await sleep(200);
    await m.ev(`[...document.querySelectorAll('[data-k]')].find(b => b.dataset.k === 'location').click()`); await sleep(200);
    await m.shot(`${OUT}/sim-wiz-main-picked.png`);
    for (let i = 0; i < 5; i++) { await m.ev(`document.getElementById('wNext').click()`); await sleep(350); }
    await m.shot(`${OUT}/sim-wiz-answers.png`);
    await m.ev(`document.getElementById('wNext').click()`); await sleep(350);
    await m.ev(`document.getElementById('wAddFaq').click()`); await sleep(300);
    await m.ev(`(() => { const i = document.querySelector('[data-fc="0"]'); i.value = 'تقصون للأطفال؟'; const a = document.querySelector('[data-fa="0"]'); a.value = 'إيه، بنفس أسعار القص 😊'; })()`);
    await m.shot(`${OUT}/sim-wiz-faq.png`);
    await m.ev(`document.getElementById('wNext').click()`); await sleep(400);
    await m.shot(`${OUT}/sim-wiz-done.png`);
    await m.ev(`document.getElementById('wNext').click()`);
    await m.waitFor(`document.querySelectorAll('.msg.in').length >= 1 && !document.getElementById('typing') && document.querySelectorAll('.btns button').length >= 2`, 25000); await sleep(1000);
    await m.shot(`${OUT}/sim-after-wiz.png`);
    grab(m, 'sim');
  } finally { await m.close(); }
}

if (WHICH === 'all' || WHICH === 'deal') {
  const b = await launch({ width: 1360, height: 900 });
  try {
    await b.go(`${BASE}admin.html#k=${adminTok}`, 500);
    await b.waitFor(`window.__admin`, 25000);
    await b.go(`${BASE}deal.html`, 500);
    await b.waitFor(`window.__deal`, 20000); await sleep(1500);
    await b.shot(`${OUT}/deal-start.png`);
    await b.ev(`__deal.pick(0)`); await sleep(1800);
    await b.ev(`__deal.pick(1)`); await sleep(1800);
    await b.shot(`${OUT}/deal-feedback.png`);
    await b.ev(`__deal.pick(0)`); await sleep(1600);
    await b.ev(`__deal.pick(0)`); await sleep(1600);
    await b.ev(`__deal.pick(0)`); await sleep(1600);
    await b.ev(`__deal.pick(0)`); await sleep(1600);
    await b.shot(`${OUT}/deal-ghali.png`);
    grab(b, 'deal');
  } finally { await b.close(); }
  const m = await launch({ width: 390, height: 844, scale: 2, mobile: true });
  try {
    await m.go(`${BASE}admin.html#k=${adminTok}`, 500);
    await m.waitFor(`window.__admin`, 25000);
    await m.go(`${BASE}deal.html`, 500);
    await m.waitFor(`window.__deal`, 20000); await sleep(1500);
    await m.ev(`document.querySelector('.phone2').scrollIntoView()`); await sleep(400);
    await m.shot(`${OUT}/deal-mob.png`);
    grab(m, 'deal-mob');
  } finally { await m.close(); }
}

if (WHICH === 'all' || WHICH === 'help') {
  const m = await launch({ width: 390, height: 844, scale: 2, mobile: true });
  try {
    await m.go(BASE + 'help.html#connect', 1200);
    await m.shot(`${OUT}/help-mob.png`);
    grab(m, 'help');
  } finally { await m.close(); }
  const d = await launch({ width: 1100, height: 900 });
  try {
    await d.go(BASE + 'help.html', 1200);
    await d.shot(`${OUT}/help-desk.png`);
    await d.go(BASE + 'agree.html', 2500);
    await d.shot(`${OUT}/agree-public.png`);
    grab(d, 'help-desk');
  } finally { await d.close(); }
}
console.log('v4 shots done', errs.length ? '\n' + errs.join('\n') : '(no console errors)');
