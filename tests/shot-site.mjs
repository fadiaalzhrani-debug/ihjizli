// لقطات الموقع العام (كمبيوتر وجوال) + فحص النموذج بدون إرسال
import { launch, sleep } from '../tools/cdp.mjs';
const BASE = process.argv[2] || 'http://localhost:5610/';
const d = await launch({ width: 1280, height: 860 });
try {
  await d.go(BASE + 'index.html', 2500);
  await d.shot('tests/out/site-desk-hero.png');
  await d.ev(`document.getElementById('shots').scrollIntoView()`); await sleep(1200);
  await d.shot('tests/out/site-desk-shots.png');
  await d.ev(`document.getElementById('signup').scrollIntoView()`); await sleep(800);
  await d.shot('tests/out/site-desk-signup.png');
  const links = await d.ev(`[...document.querySelectorAll('a')].map(a=>a.getAttribute('href')).filter(h=>/wa\.me|sim\.html/.test(h||''))`);
  console.log('links', JSON.stringify(links).slice(0, 300));
  console.log('errors', JSON.stringify(d.log.filter(l=>l.type==='error'||l.type==='exception')));
} finally { await d.close(); }
const m = await launch({ width: 390, height: 844, scale: 2, mobile: true });
try {
  await m.go(BASE + 'index.html', 2500);
  await m.shot('tests/out/site-mob-hero.png');
} finally { await m.close(); }
