// فحص شجرة الردود في المحاكي (settings.menu.tree عبر تخصيص الجلسة، بدون ما يتغير شي في المنشأة):
// أول رسالة بخياراتها، رسالة فرعية بقائمة (أكثر من 3)، مستوى ثالث وزر «رجوع» و«القائمة»، الرقم واسم الخيار المكتوب،
// زر يحجز خدمة معيّنة، رسالة بدون خيارات = أزرار «تحت كل جواب»، الإنجليزي، والعقد الغلط تنشال
import { sql } from '../tools/sql.mjs';
const FN = 'https://kvreqxdgjeietzsfamei.supabase.co/functions/v1';
const K = sql(`select sim_key from businesses where slug = 'mahalak'`)[0].sim_key;
const SVC = sql(`select s.id from services s join businesses b on b.id = s.business_id where b.slug = 'mahalak' and s.active order by s.sort limit 1`)[0].id;
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('✓ ' + name); } else { fail++; console.log('✗ ' + name + (extra ? ' · ' + extra : '')); } };
function cust() {
  const from = 'sim-tr' + Math.random().toString(36).slice(2, 10);
  const post = async (path, body) => { const r = await fetch(`${FN}/wa/sim${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ b: 'mahalak', k: K, from, ...body }) }); return r.json(); };
  const send = async (msg) => { const j = await post('', { msg }); if (!j.ok) throw new Error(JSON.stringify(j)); return j.messages.filter((m) => m.direction === 'out'); };
  return { from, post, send };
}
const btns = (m) => (m?.body?.buttons || []).map((b) => b.title);
const bids = (m) => (m?.body?.buttons || []).map((b) => b.id);
const rows = (m) => (m?.body?.sections || []).flatMap((s) => s.rows || []);

const leaf = (id, t, text) => ({ id, t, go: 'msg', text, opts: [] });
const tree = [
  { id: 'rbook01', t: 'احجز من هنا', t_en: 'Book now', go: 'book' },
  { id: 'rsvcs01', t: 'خدماتنا', t_en: 'Our services', go: 'msg', text: 'اختر الخدمة 👇', text_en: 'Pick a service 👇', opts: [
    { id: 'sa00001', t: 'غسيل خارجي', t_en: 'Outside wash', go: 'msg', text: 'غسيل خارجي: 30 ريال', opts: [
      { id: 'sa0book', t: 'احجز هالخدمة', go: 'svc:' + SVC },
      { id: 'sa0more', t: 'تفاصيل أكثر', go: 'msg', text: 'ناخذ ساعة تقريبًا ونجيك لين بيتك', opts: [{ id: 'sa0back', t: 'رجوع', go: 'back' }, { id: 'sa0home', t: 'القائمة', go: 'home' }] },
      { id: 'sa0bck2', t: 'رجوع', go: 'back' },
    ] },
    leaf('sb00001', 'غسيل داخلي', 'غسيل داخلي: 50 ريال'),
    leaf('sc00001', 'تلميع', 'تلميع: 120 ريال'),
    leaf('sd00001', 'تعقيم', 'تعقيم: 40 ريال'),
  ] },
  { id: 'rcont01', t: 'كلّمنا', go: 'contact' },
  { id: 'x!', t: 'غلط', go: 'msg', text: 'x' },            // معرّف غلط: ينشال
  { id: 'rbad002', t: 'غلط', go: 'hack' },                   // إجراء مو معروف: ينشال
];

let c = cust();
let r = await c.post('/config', { cfg: { menu: { tree, after: ['book', 'hours'] } } });
ok(r.ok && r.cfg.menu && r.cfg.menu.tree.length === 3, 'التخصيص يحفظ الشجرة وينشّل العقد الغلط', JSON.stringify(r).slice(0, 200));
let o = await c.send({ type: 'text', text: 'السلام عليكم' });
ok(o.at(-1).kind === 'buttons' && btns(o.at(-1)).join('|') === 'احجز من هنا|خدماتنا|كلّمنا', 'أول رسالة بخيارات الشجرة بترتيبها', btns(o.at(-1)).join('|'));
o = await c.send({ type: 'reply', id: 't:rsvcs01' });
const lst = o.at(-1);
ok(lst.kind === 'list' && /اختر الخدمة/.test(lst.preview) && rows(lst).map((x) => x.title).join('|') === 'غسيل خارجي|غسيل داخلي|تلميع|تعقيم', 'الرسالة الثانية: 4 خيارات تطلع قائمة والرسالة فوقها', `${lst.kind} ${rows(lst).map((x) => x.title).join('|')}`);
o = await c.send({ type: 'text', text: '1' });
ok(/غسيل خارجي: 30/.test(o.at(-1).preview) && btns(o.at(-1)).join('|') === 'احجز هالخدمة|تفاصيل أكثر|رجوع', 'كتابة الرقم 1 تفتح الرسالة الثالثة بخياراتها', `${o.at(-1).preview.slice(0, 40)} · ${btns(o.at(-1)).join('|')}`);
o = await c.send({ type: 'text', text: 'تفاصيل أكثر' });
ok(/ساعة تقريبًا/.test(o.at(-1).preview) && btns(o.at(-1)).join('|') === 'رجوع|القائمة', 'كتابة اسم الخيار تفتح المستوى الرابع', `${o.at(-1).preview.slice(0, 40)} · ${btns(o.at(-1)).join('|')}`);
ok(bids(o.at(-1))[0] === 't:sa00001', '«رجوع» يودّي للرسالة اللي قبل', bids(o.at(-1)).join('|'));
o = await c.send({ type: 'reply', id: bids(o.at(-1))[0] });
ok(/غسيل خارجي: 30/.test(o.at(-1).preview), 'ضغط «رجوع» يرجع للرسالة الثالثة', o.at(-1).preview.slice(0, 40));
ok(bids(o.at(-1))[2] === 't:rsvcs01', '«رجوع» في الثالثة يودّي للثانية', bids(o.at(-1)).join('|'));
o = await c.send({ type: 'reply', id: bids(o.at(-1))[2] });
ok(o.at(-1).kind === 'list' && /اختر الخدمة/.test(o.at(-1).preview), '«رجوع» من الثالثة يرجع لقائمة الخدمات', o.at(-1).preview.slice(0, 40));
o = await c.send({ type: 'text', text: 'تعقيم' });
ok(/تعقيم: 40/.test(o.at(-1).preview) && btns(o.at(-1)).join('|') === 'احجز من هنا|الدوام', 'رسالة بدون خيارات تطلع تحتها أزرار «تحت كل جواب»', `${o.at(-1).preview.slice(0, 30)} · ${btns(o.at(-1)).join('|')}`);
o = await c.send({ type: 'reply', id: 'm:home' });
ok(btns(o.at(-1)).join('|') === 'احجز من هنا|خدماتنا|كلّمنا', '«القائمة» ترجع لأول رسالة', btns(o.at(-1)).join('|'));
o = await c.send({ type: 'reply', id: 't:rsvcs01' }); o = await c.send({ type: 'reply', id: 't:sa00001' });
o = await c.send({ type: 'reply', id: 'm:svc:' + SVC });
ok(o.at(-1).kind === 'location_request' || /موقع|اليوم/.test(o.at(-1).preview), 'زر «احجز هالخدمة» يبدأ حجز الخدمة على طول', `${o.at(-1).kind} ${o.at(-1).preview.slice(0, 40)}`);
o = await c.send({ type: 'reply', id: 't:notthere' });
ok(btns(o.at(-1)).join('|') === 'احجز من هنا|خدماتنا|كلّمنا', 'زر قديم انحذف من الشجرة يرجّع لأول رسالة', btns(o.at(-1)).join('|'));

// الإنجليزي: النص والأسماء الإنجليزية، واللي ما له إنجليزي يطلع بالافتراضي أو العربي
o = await c.send({ type: 'text', text: 'English' });
ok(btns(o.at(-1)).join('|') === 'Book now|Our services|Contact us', 'بالإنجليزي: الأسماء الإنجليزية، والإجراء بدونها يطلع بالإنجليزي الافتراضي', btns(o.at(-1)).join('|'));
o = await c.send({ type: 'reply', id: 't:rsvcs01' });
ok(/Pick a service/.test(o.at(-1).preview) && rows(o.at(-1))[0].title === 'Outside wash', 'بالإنجليزي: الرسالة الإنجليزية فوق الخيارات', o.at(-1).preview.slice(0, 40));

// بدون شجرة: الافتراضي ما تغيّر
c = cust();
o = await c.send({ type: 'text', text: 'هلا' });
ok(btns(o.at(-1)).join('|') === 'احجز من هنا|طلباتي|English', 'بدون شجرة الافتراضي ما تغيّر', btns(o.at(-1)).join('|'));

sql(`delete from customers where business_id = (select id from businesses where slug = 'mahalak') and wa_id like 'sim-tr%'`);
console.log(`\n${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
