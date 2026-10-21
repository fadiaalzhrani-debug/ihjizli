// يحفظ ردود جاهزة من لوحة «محلك» ويتأكد إن الرد الآلي (بدون تخصيص جلسة) يستخدمها، ثم يرجّع إعدادات «محلك» مثل ما كانت
// وبالطريق: Enter يضيف زر، الحذف فيه «تراجع»، الاقتراحات والإيموجي والتنسيق، الأزرار الجاهزة، السحب للترتيب، شريط «ناقص»، والمعاينة كعميل
import { launch, sleep } from '../tools/cdp.mjs';
import { testLinks } from './links.mjs';
import { sql } from '../tools/sql.mjs';
const FN = 'https://kvreqxdgjeietzsfamei.supabase.co/functions/v1';
const L = await testLinks();
const before = sql(`select st.menu, st.texts from settings st join businesses b on b.id = st.business_id where b.slug = 'mahalak'`)[0];
const K = sql(`select sim_key from businesses where slug = 'mahalak'`)[0].sim_key;
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('✓ ' + name); } else { fail++; console.log('✗ ' + name + (extra ? ' · ' + extra : '')); } };
const names = `[...document.querySelectorAll('.rt-name')].map((i) => i.value).join('|')`;
const b = await launch({ width: 1360, height: 1000 });
try {
  await b.go(`http://localhost:5610/biz.html#k=${L.tok('owner_mahalak')}`, 500);
  await b.waitFor(`window.__biz && document.getElementById('oList')`, 20000); await sleep(1000);
  await b.ev(`window.confirm = () => true; __biz.go('texts')`);
  await b.waitFor(`document.querySelector('#rtStarter')`, 15000);
  ok(await b.ev(`!!document.querySelector('[data-starter]')`), 'لما الردود افتراضية يطلع اقتراح «جهّزها» داخل الجوال');
  await b.ev(`document.querySelector('#rtStarter').click()`); await sleep(300);
  const n0 = await b.ev(`document.querySelectorAll('.rt-btn').length`);
  // Enter في آخر زر يضيف زر جديد (يفتح رسالة فيها «رجوع» تلقائيًا)
  await b.ev(`(() => { const ins = document.querySelectorAll('[data-name]'); const i = ins[ins.length - 1]; i.focus(); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`); await sleep(200);
  ok(await b.ev(`document.querySelectorAll('.rt-btn').length`) === n0 + 1, 'Enter في آخر زر يضيف زر جديد');
  ok(await b.ev(`document.activeElement && document.activeElement.classList.contains('rt-name')`), 'والتركيز يروح لاسم الزر الجديد');
  ok(await b.ev(`!!document.querySelector('#rtProb .rt-prob') && !!document.querySelector('.rt-node .dot')`), 'شريط «ناقص» جنب الحفظ ونقطة على الرسالة في الخريطة');
  await b.ev(`document.querySelector('#rtSave').click()`); await sleep(500);
  ok(await b.ev(`!!document.querySelector('.rt-btn.err')`), 'زر بدون اسم يوقف الحفظ ويتعلّم بالأحمر');
  // الحذف بدون سؤال، وفيه «تراجع»
  await b.ev(`(() => { [...document.querySelectorAll('[data-act]')].at(-1).click(); })()`); await sleep(250);
  ok(await b.ev(`!!document.querySelector('.rt-pop .rt-card.on[data-v="msg"]')`), 'نافذة «وش يسوي الزر» تطلع والمختار «يفتح رسالة»');
  await b.ev(`document.querySelector('.rt-pop [data-v="del"]').click()`); await sleep(250);
  ok(await b.ev(`document.querySelectorAll('.rt-btn').length`) === n0 && await b.ev(`!!document.querySelector('[data-undo]')`), 'الحذف ينفّذ على طول ويطلع «تراجع»');
  await b.ev(`document.querySelector('[data-undo]').click()`); await sleep(250);
  ok(await b.ev(`document.querySelectorAll('.rt-btn').length`) === n0 + 1, '«تراجع» يرجّع الزر');
  await b.ev(`(() => { [...document.querySelectorAll('[data-act]')].at(-1).click(); })()`); await sleep(250);
  await b.ev(`document.querySelector('.rt-pop [data-v="del"]').click()`); await sleep(250);
  ok(!await b.ev(`!!document.querySelector('#rtProb .rt-prob')`), 'بعد الحذف ما فيه ناقص');
  // زر جاهز بضغطة
  ok(await b.ev(`!!document.querySelector('[data-quick="prices"]') && !document.querySelector('[data-quick="book"]')`), 'الأزرار الجاهزة تعرض اللي مو موجود بس');
  await b.ev(`document.querySelector('[data-quick="prices"]').click()`); await sleep(250);
  ok(await b.ev(`[...document.querySelectorAll('.rt-btn')].at(-1).querySelector('.rt-name').value === 'الأسعار' && /الأسعار/.test([...document.querySelectorAll('.rt-btn')].at(-1).querySelector('.rt-act').textContent)`), 'زر «الأسعار» الجاهز ينضاف باسمه وإجراءه');
  // زرين بنفس الاسم يوقفون الحفظ
  await b.ev(`(() => { const i = [...document.querySelectorAll('[data-name]')].at(-1); i.value = 'احجز من هنا'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(150);
  ok(await b.ev(`!!document.querySelector('#rtProb .rt-prob')`), 'اسم مكرر يطلع في «ناقص»');
  await b.ev(`document.querySelector('#rtSave').click()`); await sleep(400);
  ok(await b.ev(`/بنفس الاسم/.test(document.body.innerText) && !!document.querySelector('.rt-btn.err')`), 'زرين بنفس الاسم يوقفون الحفظ');
  await b.ev(`(() => { const i = [...document.querySelectorAll('[data-name]')].at(-1); i.value = 'الأسعار'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(150);
  // السحب للترتيب: نسحب أول زر لتحت آخر زر
  const before1 = await b.ev(names);
  await b.ev(`(() => { const rows = [...document.querySelectorAll('.rt-btn')]; const g = rows[0].querySelector('[data-grip]'); const last = rows[rows.length - 1].getBoundingClientRect();
    g.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 10, clientY: rows[0].getBoundingClientRect().top + 10, pointerId: 1, button: 0 }));
    g.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 10, clientY: last.bottom - 4, pointerId: 1 }));
    g.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 10, clientY: last.bottom - 4, pointerId: 1 })); })()`); await sleep(250);
  const after1 = await b.ev(names);
  ok(after1 !== before1 && after1.split('|').at(-1) === before1.split('|')[0] && after1.split('|').length === before1.split('|').length, 'السحب من المقبض يرتّب الأزرار', before1 + ' → ' + after1);
  ok(await b.ev(`document.querySelector('.rt').classList.contains('dirty')`), 'الترتيب يعلّم «ما انحفظت»');
  // داخل رسالة فاضية: اقتراحات، وبعد الكتابة إيموجي وتنسيق
  await b.ev(`document.querySelector('#rtAdd').click()`); await sleep(200);
  await b.ev(`(() => { const i = [...document.querySelectorAll('[data-name]')].at(-1); i.value = 'عروضنا'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await b.ev(`[...document.querySelectorAll('[data-open]')].at(-1).click()`); await sleep(250);
  ok(await b.ev(`document.querySelectorAll('[data-sg]').length`) >= 3, 'رسالة فاضية تطلع فيها اقتراحات نصوص');
  await b.ev(`document.querySelector('[data-sg]').click()`); await sleep(200);
  ok(await b.ev(`document.querySelector('#rtText').value.length > 5 && document.querySelectorAll('[data-em]').length >= 5`), 'الاقتراح ينكتب وتظهر أزرار الإيموجي');
  await b.ev(`document.querySelector('[data-em]').click()`); await sleep(100);
  ok(await b.ev(`/👋/.test(document.querySelector('#rtText').value)`), 'الإيموجي ينضاف للنص');
  await b.ev(`(() => { const t = document.querySelector('#rtText'); t.focus(); t.setSelectionRange(0, 4); document.querySelector('[data-fm="*"]').click(); })()`); await sleep(100);
  ok(await b.ev(`/^\\*.{4}\\*/.test(document.querySelector('#rtText').value)`), 'زر الغامق يلفّ النص المحدد بنجمتين', await b.ev(`document.querySelector('#rtText').value.slice(0, 12)`));
  ok(await b.ev(`document.querySelectorAll('.rt-btn').length === 1 && /رجوع/.test(document.querySelector('.rt-name').value)`), 'الرسالة الجديدة فيها زر «رجوع» جاهز');
  // المعاينة كعميل: الغامق يطلع غامق، وأكثر من 3 أزرار قائمة
  await b.ev(`document.querySelector('[data-mode="preview"]').click()`); await sleep(250);
  ok(await b.ev(`!!document.querySelector('#rtChat b') && !document.querySelector('#rtText')`), 'المعاينة تعرض *الغامق* غامق وبدون خانات');
  await b.ev(`document.querySelector('[data-p="-1"]').click()`); await sleep(200);
  ok(await b.ev(`!!document.querySelector('[data-lbtn]')`), 'أكثر من 3 أزرار تطلع «خيارات أكثر» في المعاينة');
  await b.ev(`document.querySelector('[data-lbtn]').click()`); await sleep(200);
  await b.ev(`[...document.querySelectorAll('#rtChat [data-tap]')].find((x) => /عروضنا/.test(x.textContent)).click()`); await sleep(250);
  ok(await b.ev(`/👋/.test(document.querySelector('#rtChat').textContent) && document.querySelectorAll('#rtChat .bt').length === 1`), 'ضغط الزر في المعاينة يفتح رسالته بأزرارها');
  await b.ev(`document.querySelector('[data-mode="edit"]').click()`); await sleep(200);
  // Ctrl+S يحفظ
  await b.ev(`document.querySelector('#rtText').dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))`);
  await b.waitFor(`/انحفظت الردود/.test(document.body.innerText)`, 15000);
  const saved = sql(`select st.menu from settings st join businesses b on b.id = st.business_id where b.slug = 'mahalak'`)[0].menu;
  ok(Array.isArray(saved.tree) && saved.tree.length === n0 + 2 && saved.tree.some((x) => x.t === 'عروضنا' && x.go === 'msg' && x.opts.length === 1 && /^\*/.test(x.text)) && saved.tree.at(-2).t === 'احجز من هنا', 'Ctrl+S يحفظ الردود بالترتيب الجديد (المسحوب صار آخر الأزرار قبل الجديد)', JSON.stringify(saved.tree.map((x) => x.t)));
  ok(!await b.ev(`document.querySelector('.rt').classList.contains('dirty')`) && !await b.ev(`!!document.querySelector('[data-starter]')`), 'بعد الحفظ تروح علامة «ما انحفظت» واقتراح «جهّزها»');
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
