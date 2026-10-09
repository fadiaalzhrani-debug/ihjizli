// تجربة سريعة لمسار الحجز عبر المحاكي
const FN = 'https://kvreqxdgjeietzsfamei.supabase.co/functions/v1';
const [b, k] = process.argv.slice(2);
const from = 'sim-' + Math.random().toString(36).slice(2, 12);
async function send(msg) {
  const r = await fetch(`${FN}/wa/sim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ b, k, from, name: 'تجربة', msg }) });
  const j = await r.json();
  if (!j.ok) throw new Error(JSON.stringify(j));
  const outs = j.messages.filter((m) => m.direction === 'out');
  for (const m of outs) console.log('  ←', m.kind, '|', m.preview.replace(/\n/g, ' ⏎ ').slice(0, 160));
  return outs;
}
console.log('→ السلام عليكم'); let o = await send({ type: 'text', text: 'السلام عليكم' });
console.log('→ [احجز من هنا]'); o = await send({ type: 'reply', id: 'm:book', title: 'احجز من هنا' });
console.log('→ 📍 الخبر'); o = await send({ type: 'location', lat: 26.2850, lng: 50.2100 });
const list = o.find((m) => m.kind === 'list');
const day = list.body.sections[0].rows[1] || list.body.sections[0].rows[0];
console.log('→ [' + day.title + ']'); o = await send({ type: 'reply', id: day.id, title: day.title });
const tl = o.find((m) => m.kind === 'list');
const slot = tl.body.sections[0].rows[2] || tl.body.sections[0].rows[0];
console.log('→ [' + slot.title + ']'); o = await send({ type: 'reply', id: slot.id, title: slot.title });
console.log('→ طلباتي'); o = await send({ type: 'text', text: 'طلباتي' });
