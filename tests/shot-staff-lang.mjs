// لوحة المنشأة ← الموظفون: اختيار لغة رسائل كل موظف (عربي/English) ينحفظ ويرجع مثل ما كان
// usage: node tests/shot-staff-lang.mjs [outDir]
import { launch, sleep } from '../tools/cdp.mjs';
import { testLinks } from './links.mjs';
import { sql } from '../tools/sql.mjs';
const OUT = process.argv[2] || 'tests/out';
const L = await testLinks();
const b = await launch({ width: 1280, height: 900 });
let pass = 0, fail = 0; const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${n}${x ? ' · ' + x : ''}`); };
try {
  await b.go(`http://localhost:5610/biz.html#k=${L.tok('owner_mahalak')}`, 500);
  await b.waitFor(`window.__biz`, 25000); await b.ev(`__biz.go('staff')`); await sleep(2500);
  const n = await b.ev(`document.querySelectorAll('[data-st] [data-lang]').length`);
  ok(n >= 1, 'فيه اختيار لغة لكل موظف', String(n));
  const id = await b.ev(`document.querySelector('[data-st]').dataset.st`);
  await b.ev(`(() => { const s = document.querySelector('[data-st] [data-lang]'); s.value = 'en'; s.dispatchEvent(new Event('change')); })()`); await sleep(1500);
  ok(sql(`select lang from staff where id = '${id}'`)[0].lang === 'en', 'تنحفظ بالإنجليزي');
  ok(await b.ev(`!!document.querySelector('#addStaff select[name=lang]')`), 'فيه اختيار اللغة عند إضافة موظف');
  await b.shot(`${OUT}/biz-staff-lang.png`);
  const errs = b.log.filter((x) => x.type === 'error' || x.type === 'exception').map((x) => x.text);
  ok(!errs.length, 'بدون أخطاء', errs.slice(0, 2).join(' | '));
  sql(`update staff set lang = 'ar' where id = '${id}'`);
  ok(sql(`select lang from staff where id = '${id}'`)[0].lang === 'ar', 'رجعت عربي');
} finally { await b.close(); }
console.log(`\n${pass} نجح، ${fail} فشل`);
process.exit(fail ? 1 : 0);
