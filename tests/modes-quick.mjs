// تجربة سريعة للمجالات: صالون (في المحل + دفع قبل)، عيادة (فرعين + رسمي)، استشارة (أونلاين + دفع قبل)، مطعم، وتخصيص المحاكي
import { sql } from '../tools/sql.mjs';
const FN = 'https://kvreqxdgjeietzsfamei.supabase.co/functions/v1';
const B = Object.fromEntries(sql(`select slug, sim_key from businesses where is_demo`).map((r) => [r.slug, r.sim_key]));
const rows = (m) => (m?.body?.sections || []).flatMap((s) => s.rows || []);
function cust(slug) {
  const from = 'sim-mq' + Math.random().toString(36).slice(2, 10);
  const post = async (path, body) => { const r = await fetch(`${FN}/wa/sim${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ b: slug, k: B[slug], from, ...body }) }); return r.json(); };
  const send = async (msg, show = true) => { const j = await post('', { msg }); if (!j.ok) throw new Error(JSON.stringify(j)); const o = j.messages.filter((m) => m.direction === 'out'); if (show) for (const m of o) console.log('   ←', m.kind, '|', m.preview.replace(/\n/g, ' ⏎ ').slice(0, 150)); return o; };
  return { from, post, send };
}
async function book(c, opts = {}) {
  let o = await c.send({ type: 'reply', id: 'm:book' });
  let last = o.at(-1);
  if (rows(last)[0]?.id.startsWith('svc:')) { o = await c.send({ type: 'reply', id: rows(last)[0].id }); last = o.at(-1); }
  if (rows(last)[0]?.id.startsWith('br:')) { o = await c.send({ type: 'reply', id: rows(last)[opts.branch || 0].id }); last = o.at(-1); }
  if (last.kind === 'location_request') { o = await c.send({ type: 'location', lat: opts.lat || 26.285, lng: opts.lng || 50.21 }); last = o.at(-1); }
  const d = rows(last)[1]; o = await c.send({ type: 'reply', id: d.id }); last = o.at(-1);
  const s = rows(last).filter((r) => r.id.startsWith('slot:'))[2]; o = await c.send({ type: 'reply', id: s.id }); return o.at(-1);
}
console.log('■ صالونك: في المحل + دفع قبل');
let c = cust('salon'); await c.send({ type: 'text', text: 'السلام عليكم' }, false);
let last = await book(c);
const link = last.body?.url; console.log('   pay link:', link);
const tok = link.split('/pay/go/')[1];
console.log('   pay:', JSON.stringify(await (await fetch(`${FN}/pay/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: tok, method: 'mada' }) })).json()));
const after = await (await fetch(`${FN}/wa/sim?${new URLSearchParams({ b: 'salon', k: B.salon, from: c.from, after: 0 })}`)).json();
console.log('   ←', after.messages.filter((m) => m.direction === 'out').at(-1).preview.replace(/\n/g, ' ⏎ '));
console.log('■ عيادتك: فرعين + رسمي + أسئلة');
c = cust('clinic'); await c.send({ type: 'text', text: 'السلام عليكم' });
await c.send({ type: 'text', text: 'تقبلون التأمين؟' });
await c.send({ type: 'text', text: 'وين موقعكم؟' });
await c.send({ type: 'text', text: 'كيف الدفع؟' });
await book(c, { branch: 1 });
console.log('■ استشارتك: أونلاين + دفع قبل');
c = cust('consult'); await c.send({ type: 'text', text: 'هلا' }, false);
await book(c);
console.log('■ مطعمك: حجز طاولة');
c = cust('resto'); await c.send({ type: 'text', text: 'هلا' }, false);
await c.send({ type: 'text', text: 'وين المنيو؟' });
await book(c);
console.log('■ محلك مخصص: اسم «مغسلة النور»، أونلاين، دفع قبل، مختصر');
c = cust('mahalak');
console.log('   cfg:', JSON.stringify(await c.post('/config', { cfg: { name: 'مغسلة النور', place: 'online', pay: 'before', tone: 'short' } })));
await c.send({ type: 'text', text: 'السلام عليكم' });
await book(c);
