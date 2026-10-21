// لقطات «الردود» في لوحة المنشأة (كمبيوتر وجوال) بدون حفظ: أول رسالة، الجاهزة من الخدمات، رسالة فرعية، «وش يسوي الزر»، المعاينة كعميل بقائمة، كل الردود
// usage: node tests/shot-tree.mjs [outDir]
import { launch, sleep } from '../tools/cdp.mjs';
import { testLinks } from './links.mjs';
const OUT = process.argv[2] || 'tests/out';
const BASE = 'http://localhost:5610/';
const L = await testLinks();
const errs = [];
// يفتح رسالة زر باسمه (زر «افتح» جنب اسم الزر)
const open = (re) => `(() => { const b = [...document.querySelectorAll('.rt-btn')].find((x) => ${re}.test(x.querySelector('.rt-name').value)); b.querySelector('[data-open]').click(); return true; })()`;
for (const [tag, o] of [['desk', { width: 1440, height: 1000 }], ['mob', { width: 390, height: 844, scale: 2, mobile: true }]]) {
  const b = await launch(o);
  try {
    await b.go(`${BASE}biz.html#k=${L.tok('owner_mahalak')}`, 500);
    await b.waitFor(`window.__biz && document.getElementById('oList')`, 20000); await sleep(1200);
    await b.ev(`window.confirm = () => true; __biz.go('texts')`);
    await b.waitFor(`document.querySelector('#mTree .rt')`, 15000); await sleep(600);
    const top = () => b.ev(`(() => { const r = document.querySelector('#mTree').closest('.card').getBoundingClientRect(); scrollBy(0, r.top - 70); })()`);
    await top(); await sleep(300);
    await b.shot(`${OUT}/tree-${tag}-1.png`);
    await b.ev(`document.querySelector('#rtStarter').click()`); await sleep(400);
    await top(); await sleep(300);
    await b.shot(`${OUT}/tree-${tag}-2.png`);
    await b.ev(open('/خدماتنا/')); await sleep(300);
    await b.ev(open('/زيارة/')); await sleep(300);
    await top(); await sleep(300);
    await b.shot(`${OUT}/tree-${tag}-3.png`);
    await b.ev(`document.querySelector('[data-act="0"]').click()`); await sleep(350);
    await b.shot(`${OUT}/tree-${tag}-4.png`);
    await b.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); const v = document.querySelector('.rt-veil'); if (v) v.click(); else document.querySelector('#rtText').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`); await sleep(200);
    // المعاينة كعميل من أول رسالة (4 أزرار = قائمة «خيارات أكثر») ونفتح القائمة
    await b.ev(`document.querySelector('[data-p="-1"]').click()`); await sleep(200);
    await b.ev(`document.querySelector('[data-mode="preview"]').click()`); await sleep(300);
    await b.ev(`document.querySelector('[data-lbtn]').click()`); await sleep(300);
    await top(); await sleep(300);
    await b.shot(`${OUT}/tree-${tag}-5.png`);
    await b.ev(`[...document.querySelectorAll('#rtChat [data-tap]')].find((x) => /خدماتنا/.test(x.textContent)).click()`); await sleep(300);
    await b.ev(`document.querySelector('#rtChat [data-tap]').click()`); await sleep(300);
    await b.ev(`document.querySelector('#rtChat [data-tap]').click()`); await sleep(300);
    await top(); await sleep(300);
    await b.shot(`${OUT}/tree-${tag}-6.png`);
    await b.ev(`document.querySelector('[data-mode="edit"]').click()`); await sleep(200);
    await b.ev(`const d = document.querySelector('.rt-map'); d.open = true; d.scrollIntoView({ block: 'center' })`); await sleep(300);
    await b.shot(`${OUT}/tree-${tag}-7.png`);
    const ov = await b.ev(`document.documentElement.scrollWidth - innerWidth`);
    if (ov > 0) errs.push(`${tag}: overflow ${ov}px`);
    for (const l of b.log) if (l.type === 'error' || l.type === 'exception') errs.push(`${tag}: ${l.text}`);
  } finally { await b.close(); }
}
console.log(errs.length ? errs.join('\n') : 'no errors');
