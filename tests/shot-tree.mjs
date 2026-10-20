// لقطات «شجرة الردود» في لوحة المنشأة (كمبيوتر وجوال) بدون حفظ: الشجرة الأولى، الجاهزة من الخدمات، رسالة فرعية، قائمة نوع الزر، الخريطة
// usage: node tests/shot-tree.mjs [outDir]
import { launch, sleep } from '../tools/cdp.mjs';
import { testLinks } from './links.mjs';
const OUT = process.argv[2] || 'tests/out';
const BASE = 'http://localhost:5610/';
const L = await testLinks();
const errs = [];
// يضغط زر في جوال المعاينة باسمه (ولو الخيارات قائمة يفتحها أول)
const tap = (re) => `(() => { const ch = document.querySelector('#mtChat'); const lb = ch.querySelector('#mtLbtn'); if (lb && !ch.querySelector('.ph-sheet')) lb.click(); const b = [...document.querySelectorAll('#mtChat [data-tap]')].find((x) => ${re}.test(x.textContent)); b.click(); return true; })()`;
for (const [tag, o] of [['desk', { width: 1440, height: 1000 }], ['mob', { width: 390, height: 844, scale: 2, mobile: true }]]) {
  const b = await launch(o);
  try {
    await b.go(`${BASE}biz.html#k=${L.tok('owner_mahalak')}`, 500);
    await b.waitFor(`window.__biz && document.getElementById('oList')`, 20000); await sleep(1200);
    await b.ev(`window.confirm = () => true; __biz.go('texts')`);
    await b.waitFor(`document.querySelector('#mTree .mt')`, 15000); await sleep(600);
    const top = () => b.ev(`(() => { const r = document.querySelector('#mTree').closest('.card').getBoundingClientRect(); scrollBy(0, r.top - 70); })()`);
    await top(); await sleep(300);
    await b.shot(`${OUT}/tree-${tag}-1.png`);
    await b.ev(`document.querySelector('#mtStarter').click()`); await sleep(400);
    await top(); await sleep(300);
    await b.shot(`${OUT}/tree-${tag}-2.png`);
    await b.ev(tap('/خدماتنا/')); await sleep(300);
    await b.ev(tap('/زيارة/')); await sleep(300);
    await top(); await sleep(300);
    await b.shot(`${OUT}/tree-${tag}-3.png`);
    await b.ev(`document.querySelector('[data-type="0"]').click()`); await sleep(300);
    await b.shot(`${OUT}/tree-${tag}-4.png`);
    await b.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); document.querySelector('.mt-veil') ? document.querySelector('.mt-veil').click() : document.querySelector('#mtText').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`); await sleep(200);
    await b.ev(`document.querySelector('#mtMap').scrollIntoView({ block: 'center' })`); await sleep(300);
    await b.shot(`${OUT}/tree-${tag}-5.png`);
    if (tag === 'mob') { await b.ev(`document.querySelector('.mt-phone').scrollIntoView({ block: 'start' }); scrollBy(0, -70)`); await sleep(300); await b.shot(`${OUT}/tree-${tag}-6.png`); }
    const ov = await b.ev(`document.documentElement.scrollWidth - innerWidth`);
    if (ov > 0) errs.push(`${tag}: overflow ${ov}px`);
    for (const l of b.log) if (l.type === 'error' || l.type === 'exception') errs.push(`${tag}: ${l.text}`);
  } finally { await b.close(); }
}
console.log(errs.length ? errs.join('\n') : 'no errors');
