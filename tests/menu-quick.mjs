// فحص القائمة الذكية في المحاكي: ترحيب بثلاث أزرار مخصصة، ترحيب بقائمة (أكثر من 3)، «وش بعده» بعد رد معلوماتي،
// سؤال خاص كزر، ردود مخصصة للأسعار والموقع، والرقم المكتوب يختار من قائمة الترحيب
import { sql } from '../tools/sql.mjs';
const FN = 'https://kvreqxdgjeietzsfamei.supabase.co/functions/v1';
const K = sql(`select sim_key from businesses where slug = 'mahalak'`)[0].sim_key;
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('✓ ' + name); } else { fail++; console.log('✗ ' + name + (extra ? ' · ' + extra : '')); } };
function cust() {
  const from = 'sim-mn' + Math.random().toString(36).slice(2, 10);
  const post = async (path, body) => { const r = await fetch(`${FN}/wa/sim${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ b: 'mahalak', k: K, from, ...body }) }); return r.json(); };
  const send = async (msg) => { const j = await post('', { msg }); if (!j.ok) throw new Error(JSON.stringify(j)); return j.messages.filter((m) => m.direction === 'out'); };
  return { from, post, send };
}
const btns = (m) => (m?.body?.buttons || []).map((b) => b.title);
const rows = (m) => (m?.body?.sections || []).flatMap((s) => s.rows || []).map((r) => r.title);

// 1) ثلاث أزرار مخصصة بالترتيب
let c = cust();
let r = await c.post('/config', { cfg: { menu: { main: ['prices', 'location', 'book'], after: ['book', 'hours'] } } });
ok(r.ok && r.cfg.menu && r.cfg.menu.main.join() === 'prices,location,book', 'التخصيص يحفظ القائمة', JSON.stringify(r).slice(0, 160));
let o = await c.send({ type: 'text', text: 'السلام عليكم' });
ok(o.at(-1).kind === 'buttons' && btns(o.at(-1)).join('|') === 'الأسعار|موقعنا|احجز من هنا', 'الترحيب بثلاث أزرار مخصصة بترتيبها', btns(o.at(-1)).join('|'));
o = await c.send({ type: 'reply', id: 'm:prices' });
ok(/السعر|أسعار/.test(o.at(-1).preview) && btns(o.at(-1)).join('|') === 'احجز من هنا|الدوام', 'بعد الأسعار يطلع «وش بعده» المخصص', btns(o.at(-1)).join('|'));
o = await c.send({ type: 'reply', id: 'm:hours' });
ok(/أوقات العمل/.test(o.at(-1).preview), 'زر الدوام يرد بأوقات العمل', o.at(-1).preview.slice(0, 60));

// 2) أكثر من ثلاثة = قائمة، والرقم المكتوب يختار منها، وسؤال خاص كزر، وردود مخصصة
c = cust();
r = await c.post('/config', { cfg: { name: 'مغسلة النور', menu: { main: ['book', 'prices', 'faq:0', 'location', 'pay'], after: ['book'] }, faq: [{ chip: 'تغسلون سجاد؟', a: 'إيه، نغسل السجاد والموكيت 🧼' }], answers: { prices: 'الغسيل الخارجي 30، والداخلي والخارجي 60 ريال', location_text: 'نجيك لين بيتك في كل الدمام 🚗' } } });
ok(r.ok && r.cfg.faq && r.cfg.faq.length === 1 && r.cfg.answers && r.cfg.answers.prices, 'التخصيص يحفظ الأسئلة والردود', JSON.stringify(r).slice(0, 200));
o = await c.send({ type: 'text', text: 'هلا' });
const w = o.at(-1);
ok(w.kind === 'list' && rows(w).length === 5 && rows(w)[2] === 'تغسلون سجاد؟', 'الترحيب بقائمة لما تكون الخيارات أكثر من 3، والسؤال الخاص فيها', rows(w).join('|'));
o = await c.send({ type: 'text', text: '3' });
ok(/السجاد/.test(o.at(-1).preview) && btns(o.at(-1)).join('|') === 'احجز من هنا', 'كتابة الرقم 3 تختار السؤال الخاص ويرد بجوابه', o.at(-1).preview.slice(0, 60));
o = await c.send({ type: 'text', text: 'كم السعر؟' });
ok(/الغسيل الخارجي 30/.test(o.at(-1).preview), 'سؤال السعر يرد بالرد المخصص', o.at(-1).preview.slice(0, 60));
o = await c.send({ type: 'reply', id: 'm:location' });
ok(/نجيك لين بيتك/.test(o.at(-1).preview), 'زر الموقع يرد بالرد المخصص', o.at(-1).preview.slice(0, 60));
o = await c.send({ type: 'reply', id: 'm:pay' });
ok(/الدفع|تدفع/.test(o.at(-1).preview), 'زر طريقة الدفع يرد', o.at(-1).preview.slice(0, 60));

// 3) الافتراضي بدون تخصيص: احجز، طلباتي، English
c = cust();
o = await c.send({ type: 'text', text: 'السلام عليكم' });
ok(btns(o.at(-1)).join('|') === 'احجز من هنا|طلباتي|English', 'الافتراضي ما تغيّر', btns(o.at(-1)).join('|'));

sql(`delete from customers where business_id = (select id from businesses where slug = 'mahalak') and wa_id like 'sim-mn%'`);
console.log(`\n${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
