// لقطات «شجرة الردود» في لوحة المنشأة (كمبيوتر وجوال) بدون حفظ: الشجرة الأولى، الجاهزة من الخدمات، والدخول لرسالة فرعية
// usage: node tests/shot-tree.mjs [outDir]
import { launch, sleep } from '../tools/cdp.mjs';
import { testLinks } from './links.mjs';
const OUT = process.argv[2] || 'tests/out';
const BASE = 'http://localhost:5610/';
const L = await testLinks();
const errs = [];
for (const [tag, o] of [['desk', { width: 1360, height: 1000 }], ['mob', { width: 390, height: 844, scale: 2, mobile: true }]]) {
  const b = await launch(o);
  try {
    await b.go(`${BASE}biz.html#k=${L.tok('owner_mahalak')}`, 500);
    await b.waitFor(`window.__biz && document.getElementById('oList')`, 20000); await sleep(1200);
    await b.ev(`window.confirm = () => true; __biz.go('texts')`);
    await b.waitFor(`document.querySelector('#mTree .mt')`, 15000); await sleep(600);
    await b.ev(`document.querySelector('#mTree').scrollIntoView()`); await sleep(300);
    await b.shot(`${OUT}/tree-${tag}-1.png`);
    await b.ev(`document.querySelector('#mtStarter').click()`); await sleep(400);
    await b.ev(`document.querySelector('#mTree').scrollIntoView()`); await sleep(300);
    await b.shot(`${OUT}/tree-${tag}-2.png`);
    // ندخل «خدماتنا» من الجوال ثم أول خدمة
    await b.ev(`[...document.querySelectorAll('#mtPhone [data-tap]')].find((x) => /خدماتنا/.test(x.textContent)).click()`); await sleep(300);
    await b.ev(`document.querySelector('#mtPhone [data-tap]').click()`); await sleep(300);
    await b.ev(`document.querySelector('#mTree').scrollIntoView()`); await sleep(300);
    await b.shot(`${OUT}/tree-${tag}-3.png`);
    if (tag === 'mob') { await b.ev(`document.querySelector('#mtPhone').scrollIntoView()`); await sleep(300); await b.shot(`${OUT}/tree-${tag}-4.png`); }
    const ov = await b.ev(`document.documentElement.scrollWidth - innerWidth`);
    if (ov > 0) errs.push(`${tag}: overflow ${ov}px`);
    for (const l of b.log) if (l.type === 'error' || l.type === 'exception') errs.push(`${tag}: ${l.text}`);
  } finally { await b.close(); }
}
console.log(errs.length ? errs.join('\n') : 'no errors');
