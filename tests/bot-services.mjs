// فحص البوت مع قوائم أسعار طويلة (من صورة قائمة فيها خدمات كثيرة): قائمة الواتساب 10 صفوف بالكثير،
// فلو الخدمات أكثر تطلع 9 بكل صفحة وصف «خدمات أكثر»، والسعر «يبدأ من» يبان في القائمة والأسعار والتأكيد.
// على منشأة تجريبية مؤقتة عبر المحاكي (ما يرسل أي واتساب)، وتنحذف بالنهاية.
import fs from 'node:fs';
import { sessionFor, api } from './link-check.mjs';
import { sql } from '../tools/sql.mjs';
const P = JSON.parse(fs.readFileSync(new URL('../.secrets/project.json', import.meta.url)));
const FN = `${P.url}/functions/v1`;
const adminTok = fs.readFileSync(new URL('../.secrets/admin-link.txt', import.meta.url), 'utf8').trim().split('#k=')[1];
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('✓ ' + name); } else { fail++; console.log('✗ ' + name + (extra ? ' · ' + extra : '')); } };
const rows = (m) => (m?.body?.sections || []).flatMap((s) => s.rows || []);
sql(`delete from businesses where slug like 'svc-test%'`);
const a = await sessionFor(adminTok);
try {
  const services = Array.from({ length: 12 }, (_, i) => ({ name: `خدمة رقم ${i + 1}`, price: 20 + i * 5 }));
  const r = await api(a.jwt, 'admin/business/create', { name: 'منشأة فحص الخدمات', slug: 'svc-test', plan: 'bot', is_demo: true, place_mode: 'shop', pay_timing: 'after', services,
    cities: [{ name: 'الفرع', lat: 24.7136, lng: 46.6753, radius_km: 40 }] });
  ok(r.ok && r.business, 'منشأة تجريبية بـ 12 خدمة', JSON.stringify(r).slice(0, 120));
  const id = r.business.id;
  sql(`update services set price_from = true where business_id = '${id}' and name = 'خدمة رقم 11'`);
  sql(`update hours set open_time = '00:00', close_time = '23:59' where business_id = '${id}'`);
  const b = sql(`select slug, sim_key from businesses where id = '${id}'`)[0];
  const from = 'sim-svc' + Math.random().toString(36).slice(2, 9);
  const send = async (msg) => { const j = await (await fetch(`${FN}/wa/sim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ b: b.slug, k: b.sim_key, from, msg }) })).json(); if (!j.ok) throw new Error(JSON.stringify(j)); return j.messages.filter((m) => m.direction === 'out'); };
  await send({ type: 'text', text: 'السلام عليكم' });
  let o = await send({ type: 'reply', id: 'm:book' });
  let rs = rows(o.at(-1));
  ok(rs.length === 10 && rs.filter((x) => x.id.startsWith('svc:')).length === 9 && rs[9].id === 'svp:1' && rs[9].title === 'خدمات أكثر' && rs[9].desc === '1/2', 'الصفحة الأولى: 9 خدمات وصف «خدمات أكثر»', JSON.stringify(rs.map((x) => x.title)));
  o = await send({ type: 'reply', id: 'svp:1' });
  rs = rows(o.at(-1));
  const s11 = rs.find((x) => x.title === 'خدمة رقم 11');
  ok(rs.length === 4 && rs[3].id === 'svp:0' && rs[3].title === 'رجوع لأول الخدمات' && s11, 'الصفحة الثانية: الباقي وصف «رجوع لأول الخدمات»', JSON.stringify(rs.map((x) => x.title)));
  ok(s11 && s11.desc === 'يبدأ من 70 ريال', 'السعر «يبدأ من» في القائمة', s11 && s11.desc);
  o = await send({ type: 'text', text: '2' });
  ok(o.length && o.at(-1).body && /اليوم|يوم/.test(JSON.stringify(o.at(-1).body)), 'كتابة رقم من الصفحة الثانية تختار خدمتها وتكمل للأيام', JSON.stringify(o.at(-1)?.body).slice(0, 120));
  const p = await send({ type: 'text', text: 'كم الأسعار؟' });
  const txt = p.map((m) => m.body?.text || '').join('\n');
  ok(/خدمة رقم 11: يبدأ من 70 ريال/.test(txt) && /خدمة رقم 12: 75 ريال/.test(txt), 'رد الأسعار فيه «يبدأ من» وكل الخدمات', txt.slice(0, 160));
} finally {
  sql(`delete from businesses where slug like 'svc-test%'`);
  ok(!sql(`select 1 from businesses where slug like 'svc-test%'`).length, 'المنشأة المؤقتة انحذفت');
}
console.log(`\n${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
