// يحفظ ردود جاهزة من لوحة «محلك» ويتأكد إن الرد الآلي (بدون تخصيص جلسة) يستخدمها، ثم يرجّع إعدادات «محلك» مثل ما كانت
import { launch, sleep } from '../tools/cdp.mjs';
import { testLinks } from './links.mjs';
import { sql } from '../tools/sql.mjs';
const FN = 'https://kvreqxdgjeietzsfamei.supabase.co/functions/v1';
const L = await testLinks();
const before = sql(`select st.menu, st.texts from settings st join businesses b on b.id = st.business_id where b.slug = 'mahalak'`)[0];
const K = sql(`select sim_key from businesses where slug = 'mahalak'`)[0].sim_key;
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('✓ ' + name); } else { fail++; console.log('✗ ' + name + (extra ? ' · ' + extra : '')); } };
const b = await launch({ width: 1360, height: 1000 });
try {
  await b.go(`http://localhost:5610/biz.html#k=${L.tok('owner_mahalak')}`, 500);
  await b.waitFor(`window.__biz && document.getElementById('oList')`, 20000); await sleep(1000);
  await b.ev(`window.confirm = () => true; __biz.go('texts')`);
  await b.waitFor(`document.querySelector('#rtStarter')`, 15000);
  await b.ev(`document.querySelector('#rtStarter').click()`); await sleep(300);
  // زر بدون اسم يوقف الحفظ ويعلّمه (الزر الجديد يفتح رسالة فيها «رجوع» تلقائيًا)
  await b.ev(`document.querySelector('#rtAdd').click()`); await sleep(200);
  await b.ev(`document.querySelector('#rtSave').click()`); await sleep(500);
  ok(await b.ev(`!!document.querySelector('.rt-btn.err')`), 'زر بدون اسم يوقف الحفظ ويتعلّم بالأحمر');
  ok(await b.ev(`document.activeElement && document.activeElement.classList.contains('rt-name')`), 'والتركيز يروح لاسمه');
  await b.ev(`(() => { [...document.querySelectorAll('[data-act]')].at(-1).click(); })()`); await sleep(250);
  ok(await b.ev(`!!document.querySelector('.rt-pop .rt-card.on[data-v="msg"]')`), 'نافذة «وش يسوي الزر» تطلع والمختار «يفتح رسالة»');
  await b.ev(`document.querySelector('.rt-pop [data-v="del"]').click()`); await sleep(250);
  ok(await b.ev(`!document.querySelector('.rt-pop')`), 'الحذف يسكّر النافذة');
  await b.ev(`document.querySelector('#rtSave').click()`);
  await b.waitFor(`/انحفظت الردود/.test(document.body.innerText)`, 15000);
  const saved = sql(`select st.menu from settings st join businesses b on b.id = st.business_id where b.slug = 'mahalak'`)[0].menu;
  ok(Array.isArray(saved.tree) && saved.tree.length >= 3 && saved.tree.some((x) => x.go === 'msg' && x.opts.length), 'الردود انحفظت في الإعدادات', JSON.stringify(saved).slice(0, 160));
  ok(!await b.ev(`document.querySelector('.rt').classList.contains('dirty')`), 'علامة «ما انحفظت» تروح بعد الحفظ');
  const from = 'sim-ts' + Math.random().toString(36).slice(2, 10);
  const r = await (await fetch(`${FN}/wa/sim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ b: 'mahalak', k: K, from, msg: { type: 'text', text: 'هلا' } }) })).json();
  const last = r.messages.filter((m) => m.direction === 'out').at(-1);
  const titles = [...(last.body.buttons || []), ...((last.body.sections || []).flatMap((s) => s.rows))].map((x) => x.title);
  ok(titles.join('|') === saved.tree.map((x) => x.t).join('|'), 'الرد الآلي يرحّب بأزرار الردود المحفوظة', titles.join('|'));
  for (const l of b.log) if (l.type === 'error' || l.type === 'exception') { fail++; console.log('✗ ' + l.text); }
} finally {
  await b.close();
  sql(`update settings set menu = '${JSON.stringify(before.menu).replace(/'/g, "''")}'::jsonb, texts = '${JSON.stringify(before.texts).replace(/'/g, "''")}'::jsonb where business_id = (select id from businesses where slug = 'mahalak')`);
  sql(`delete from customers where business_id = (select id from businesses where slug = 'mahalak') and wa_id like 'sim-ts%'`);
  const back = sql(`select st.menu, st.texts from settings st join businesses b on b.id = st.business_id where b.slug = 'mahalak'`)[0];
  ok(JSON.stringify(back) === JSON.stringify(before), 'إعدادات «محلك» رجعت مثل ما كانت', JSON.stringify(back).slice(0, 120));
}
console.log(`\n${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
