// لوحتي ← العملاء المحتملين: التحميل، الفلاتر، الحالة والملاحظة (ترجع مثل ما كانت)، الرسائل، ولقطات كمبيوتر وجوال
// usage: node tests/shot-pros.mjs [outDir]
import fs from 'node:fs';
import { launch, sleep } from '../tools/cdp.mjs';

const OUT = process.argv[2] || 'tests/out';
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:5610/';
const adminTok = fs.readFileSync(new URL('../.secrets/admin-link.txt', import.meta.url), 'utf8').trim().split('#k=')[1];
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) pass++; else fail++; console.log(`${c ? '✓' : '✗'} ${name}${extra ? ' · ' + extra : ''}`); };

for (const [w, h, tag, mobile] of [[1360, 900, 'desk', false], [390, 844, 'mob', true]]) {
  const b = await launch({ width: w, height: h, scale: mobile ? 2 : 1, mobile });
  try {
    await b.go(`${BASE}admin.html#k=${adminTok}`, 500); await b.waitFor(`window.__admin`, 25000);
    await b.ev(`__admin.go('pros')`);
    await b.waitFor(`document.querySelectorAll('[data-pro]').length > 0`, 30000); await sleep(800);
    const r = await b.ev(`({ n: __admin.S.pros.length, cards: document.querySelectorAll('[data-pro]').length, wa: document.querySelectorAll('[data-pro] a[href^="https://wa.me/966"]').length, sub: document.getElementById('tSub').textContent, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, more: document.getElementById('pMore').textContent })`);
    ok(r.n >= 1200, `${tag}: القائمة كاملة`, `${r.n} نشاط، ${r.cards} بطاقة، ${r.wa} زر واتساب`);
    ok(r.sw <= r.cw, `${tag}: بدون تمرير جانبي`, `${r.sw}/${r.cw}`);
    await b.shot(`${OUT}/pros-${tag}.png`);
    if (tag === 'desk') {
      // الرسالة في زر الواتساب فيها اسم النشاط ورابط التجربة
      const m = await b.ev(`(() => { const a = document.querySelector('[data-pro] a[href^="https://wa.me/966"]'); const id = a.closest('[data-pro]').dataset.pro; const l = __admin.S.pros.find((x) => x.id === id); const t = decodeURIComponent(a.href.split('?text=')[1]); return { has: t.includes(l.name), link: t.includes('sim.html'), raw: t.includes('{') }; })()`);
      ok(m.has && m.link && !m.raw, 'رسالة الواتساب مخصّصة باسم النشاط والرابط');
      // فلتر المجال + برقم جوال
      const f = await b.ev(`(async () => { const s = document.getElementById('pSeg'); s.value = s.options[1].value; s.dispatchEvent(new Event('change')); const w = document.getElementById('pWa'); w.checked = true; w.dispatchEvent(new Event('change')); await new Promise((r) => setTimeout(r, 300)); const seg = s.value; const cards = [...document.querySelectorAll('[data-pro]')].map((c) => __admin.S.pros.find((x) => x.id === c.dataset.pro)); return { n: cards.length, allSeg: cards.every((l) => l.seg_key === seg), allWa: [...document.querySelectorAll('[data-pro]')].every((c) => c.querySelector('a[href^="https://wa.me/"]')) }; })()`);
      ok(f.n > 0 && f.allSeg && f.allWa, 'فلتر المجال وبرقم جوال', `${f.n} بطاقة`);
      // بحث
      const q = await b.ev(`(async () => { const l = __admin.S.pros[5]; const i = document.getElementById('pQ'); document.getElementById('pSeg').value = ''; document.getElementById('pSeg').dispatchEvent(new Event('change')); document.getElementById('pWa').checked = false; document.getElementById('pWa').dispatchEvent(new Event('change')); i.value = l.name; i.dispatchEvent(new Event('input')); await new Promise((r) => setTimeout(r, 600)); const ids = [...document.querySelectorAll('[data-pro]')].map((c) => c.dataset.pro); i.value = ''; i.dispatchEvent(new Event('input')); await new Promise((r) => setTimeout(r, 600)); return ids.includes(l.id); })()`);
      ok(q, 'البحث بالاسم');
      // الحالة: «أرسلت» تنحفظ وتغيّر الزر للمتابعة، ثم ترجع «جديد»
      const id = await b.ev(`document.querySelector('[data-pro]').dataset.pro`);
      const before = await b.ev(`(() => { const l = __admin.S.pros.find((x) => x.id === '${id}'); return { status: l.status, note: l.note }; })()`);
      await b.ev(`document.querySelector('[data-pro="${id}"] [data-ps="sent"]').click()`); await sleep(1800);
      const after = await b.ev(`(async () => { const c = document.querySelector('[data-pro="${id}"]'); const { data } = await IHJ.sb.from('prospects').select('status').eq('id', '${id}').single(); return { db: data.status, btn: c.querySelector('a[href^="https://wa.me/"],[data-pa]').textContent, stat: document.querySelector('#pStats [data-s="sent"] .n').textContent }; })()`);
      ok(after.db === 'sent' && /المتابعة/.test(after.btn), 'الحالة تنحفظ والزر يصير للمتابعة', JSON.stringify(after));
      await b.shot(`${OUT}/pros-desk-sent.png`);
      await b.ev(`document.querySelector('[data-pro="${id}"] .pnote').value = 'فحص'; document.querySelector('[data-pro="${id}"] .pnote').dispatchEvent(new Event('change', { bubbles: true }))`); await sleep(1500);
      const note = await b.ev(`IHJ.sb.from('prospects').select('note').eq('id', '${id}').single().then((r) => r.data.note)`);
      ok(note === 'فحص', 'الملاحظة تنحفظ');
      // نرجّعها مثل ما كانت
      await b.ev(`IHJ.sb.from('prospects').update({ status: ${JSON.stringify(before.status)}, note: ${JSON.stringify(before.note)}, status_at: null }).eq('id', '${id}')`); await sleep(800);
      const back = await b.ev(`IHJ.sb.from('prospects').select('status,note').eq('id', '${id}').single().then((r) => r.data)`);
      ok(back.status === before.status && back.note === before.note, 'رجعت مثل ما كانت');
      // الرسائل
      await b.ev(`document.querySelector('#pView [data-v="msgs"]').click()`); await sleep(600);
      const ms = await b.ev(`({ n: document.querySelectorAll('[data-mk]').length, pre: document.querySelectorAll('[data-mk] pre').length })`);
      ok(ms.n >= 20 && ms.pre >= 40, 'الرسائل لكل مجال', `${ms.n} مجال`);
      await b.shot(`${OUT}/pros-desk-msgs.png`);
      await b.ev(`document.querySelector('[data-mk] [data-me]').click()`); await sleep(500);
      ok(await b.ev(`!!document.querySelector('#modal.on #emM') && document.querySelector('#emM').value.length > 50`), 'نافذة تعديل الرسالة');
      await b.shot(`${OUT}/pros-desk-edit.png`);
      await b.ev(`IHJ.closeAll(); document.querySelector('#pView [data-v="list"]').click()`);
    } else {
      const nav = await b.ev(`[...document.querySelectorAll('.bnav a')].map((a) => a.textContent.trim())`);
      ok(nav.includes('المحتملين'), 'زر في الشريط السفلي', nav.join('، '));
      await b.ev(`window.scrollTo(0, 600)`); await sleep(300);
      await b.shot(`${OUT}/pros-mob-2.png`);
    }
    const errs = b.log.filter((x) => x.type === 'error' || x.type === 'exception').map((x) => x.text);
    ok(!errs.length, `${tag}: بدون أخطاء`, errs.slice(0, 3).join(' | '));
  } finally { await b.close(); }
}
console.log(`\n${pass} نجح، ${fail} فشل`);
process.exit(fail ? 1 : 0);
