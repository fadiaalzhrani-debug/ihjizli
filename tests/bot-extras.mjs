// فحص خيارات الطلب في البوت عبر المحاكي (ما يرسل أي واتساب): العدد، الإضافات (مع المجموعة)، أسئلة الحجز،
// الدفع وقت الحجز بالإجمالي، شراء بكج برابط دفع وتفعيل الرصيد، الحجز من الرصيد وخصمه، ورجوعه لو انلغى الطلب.
// على منشأة حقيقية مؤقتة (باقة الدفع بدون ميسر: تجارب المحاكي تدفع تجريبي) وتنحذف بالنهاية.
import fs from 'node:fs';
import { sessionFor, api } from './link-check.mjs';
import { sql } from '../tools/sql.mjs';
const P = JSON.parse(fs.readFileSync(new URL('../.secrets/project.json', import.meta.url)));
const FN = `${P.url}/functions/v1`;
const adminTok = fs.readFileSync(new URL('../.secrets/admin-link.txt', import.meta.url), 'utf8').trim().split('#k=')[1];
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('✓ ' + name); } else { fail++; console.log('✗ ' + name + (extra ? ' · ' + extra : '')); } };
const rows = (m) => (m?.body?.sections || []).flatMap((s) => s.rows || []);
const btns = (m) => (m?.body?.buttons || []);
const txt = (m) => m?.body?.text || '';
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
sql(`delete from businesses where slug like 'xtra-test%'`);
const a = await sessionFor(adminTok);
try {
  const r = await api(a.jwt, 'admin/business/create', { name: 'مغسلة فحص الخيارات', slug: 'xtra-test', plan: 'bot_pay', is_demo: false, place_mode: 'visit', pay_timing: 'before',
    services: [{ name: 'غسيل كامل', price: 40 }, { name: 'غسيل خارجي', price: 28 }],
    cities: [{ name: 'الجبيل', lat: 27.0174, lng: 49.6225, radius_km: 30 }] });
  ok(r.ok && r.business, 'منشأة مؤقتة بباقة الدفع', JSON.stringify(r).slice(0, 160));
  const id = r.business.id;
  const svc = Object.fromEntries(sql(`select id, name from services where business_id = '${id}'`).map((x) => [x.name, x.id]));
  const FULL = svc['غسيل كامل'];
  sql(`update services set addons = ${q(JSON.stringify([{ name: 'واكس', price: 7.99 }, { name: 'تكييس دعاستين', price: 4.25, group: 'mats' }, { name: 'تكييس 4 دعاسات', price: 8.5, group: 'mats' }]))}::jsonb,
    qty = ${q(JSON.stringify({ max: 5, one: 'سيارة', two: 'سيارتين', many: 'سيارات', en_one: 'car', en_many: 'cars' }))}::jsonb, duration_min = 85 where id = '${FULL}'`);
  sql(`update settings set ask = ${q(JSON.stringify([{ q: 'وش تفاصيل الموقع؟', hint: 'رقم البيت أو المواقف' }, { q: 'وش رقم لوحة السيارة؟', hint: 'مثال: أ ب ج 1234' }]))}::jsonb,
    pkg_unit = ${q(JSON.stringify({ one: 'غسلة', two: 'غسلتين', many: 'غسلات' }))}::jsonb, capacity_mode = 'fixed', capacity_per_slot = 3, lead_minutes = 0,
    menu = ${q(JSON.stringify({ main: ['book', 'packages', 'prices'] }))}::jsonb where business_id = '${id}'`);
  sql(`update hours set open_time = '00:00', close_time = '23:59' where business_id = '${id}'`);
  sql(`insert into packages (business_id, name, uses, price, compare_price, service_ids, note, sort) values
    ('${id}', 'البكج الأول', 4, 140, 160, array['${FULL}']::uuid[], 'بدون تاريخ انتهاء', 0), ('${id}', 'بكج خارجي', 3, 69, null, array['${svc['غسيل خارجي']}']::uuid[], '', 1)`);
  const b = sql(`select slug, sim_key from businesses where id = '${id}'`)[0];
  const from = 'sim-xt' + Math.random().toString(36).slice(2, 9);
  const send = async (msg) => { const j = await (await fetch(`${FN}/wa/sim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ b: b.slug, k: b.sim_key, from, msg }) })).json(); if (!j.ok) throw new Error(JSON.stringify(j)); return j.messages.filter((m) => m.direction === 'out'); };
  const tokenOf = (m) => (/\/pay\/go\/([0-9a-f]{32})/.exec(m?.body?.url || '') || [])[1];
  const payDemo = async (t) => (await (await fetch(`${FN}/pay/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t, method: 'mada' }) })).json());
  const cust = () => sql(`select id from customers where business_id = '${id}' and wa_id = ${q(from)}`)[0]?.id;
  const lastOut = () => sql(`select body from wa_log where customer_id = '${cust()}' and direction = 'out' order by id desc limit 1`)[0]?.body;

  let o = await send({ type: 'text', text: 'السلام عليكم' });
  ok(btns(o.at(-1)).map((x) => x.title).join('|') === 'احجز من هنا|البكجات|الأسعار', 'الترحيب: احجز، البكجات، الأسعار', JSON.stringify(btns(o.at(-1))));

  o = await send({ type: 'text', text: 'كم الأسعار؟' });
  ok(/الإضافات: واكس 7\.99 · تكييس دعاستين 4\.25 · تكييس 4 دعاسات 8\.50/.test(txt(o.at(-1))), 'رد الأسعار يذكر الإضافات بأسعارها', txt(o.at(-1)));

  // ── حجز: سيارتين + واكس + تكييس دعاستين ──
  o = await send({ type: 'reply', id: 'm:book' });
  o = await send({ type: 'reply', id: `svc:${FULL}` });
  let rs = rows(o.at(-1));
  ok(/كم سيارة/.test(txt(o.at(-1))) && rs.length === 5 && rs[0].title === 'سيارة وحدة' && rs[1].title === 'سيارتين' && rs[2].title === '3 سيارات' && rs[1].desc === '80 ريال', 'سؤال «كم سيارة؟» بالأسعار', JSON.stringify(rs.map((x) => [x.title, x.desc])));
  o = await send({ type: 'text', text: '2' });
  rs = rows(o.at(-1));
  ok(/تبي تضيف/.test(txt(o.at(-1))) && rs.map((x) => x.title).join('|') === 'واكس|تكييس دعاستين|تكييس 4 دعاسات|بدون إضافات' && rs[0].desc === '7.99 ريال', 'كتابة 2 تختار سيارتين، والإضافات بأسعارها', JSON.stringify(rs.map((x) => [x.title, x.desc])));
  o = await send({ type: 'text', text: 'واكس' });
  rs = rows(o.at(-1));
  ok(/انضاف واكس/.test(txt(o.at(-1))) && rs.map((x) => x.title).join('|') === 'تكييس دعاستين|تكييس 4 دعاسات|تم، كمّل', 'كتابة «واكس» تضيفه وتطلع الباقي', JSON.stringify(rs.map((x) => x.title)));
  o = await send({ type: 'reply', id: rs[0].id });
  ok(o.length === 2 && txt(o[0]) === 'انضاف تكييس دعاستين ✅' && o[1]?.kind === 'location_request', 'تكييس 4 يختفي (نفس المجموعة) وما بقى شي، فيأكد ويطلب الموقع على طول', JSON.stringify(o.map((m) => [m.kind, txt(m)])));
  o = await send({ type: 'location', lat: 27.03, lng: 49.6 });
  ok(/تفاصيل الموقع/.test(txt(o.at(-1))) && /رقم البيت/.test(txt(o.at(-1))), 'سؤال تفاصيل الموقع بعد اللوكيشن', txt(o.at(-1)));
  o = await send({ type: 'text', text: 'بيت 12، المواقف قدام الباب' });
  ok(/رقم لوحة/.test(txt(o.at(-1))), 'بعده رقم اللوحة', txt(o.at(-1)));
  o = await send({ type: 'text', text: 'أ ب ج 1234' });
  rs = rows(o.at(-1));
  ok(rs.length && rs[0].id.startsWith('day:'), 'بعد الأسئلة يطلع الأيام', JSON.stringify(rs.slice(0, 2)));
  o = await send({ type: 'reply', id: rs[0].id });
  rs = rows(o.at(-1));
  o = await send({ type: 'reply', id: rs[0].id });
  const cta = o.at(-1);
  ok(cta?.kind === 'cta' && /ادفع 92\.24 ريال/.test(txt(cta)) && /سيارتين/.test(txt(cta)) && /واكس، تكييس دعاستين/.test(txt(cta)) && /أ ب ج 1234/.test(txt(cta)), 'رابط الدفع بالإجمالي 92.24 والملخص', txt(cta));
  const ord = sql(`select id, qty, total, extras, status, is_test from orders where business_id = '${id}' order by created_at desc limit 1`)[0];
  ok(ord && ord.qty === 2 && Number(ord.total) === 92.24 && ord.extras.addons.length === 2 && ord.extras.answers.length === 2 && ord.extras.answers[0].q === 'تفاصيل الموقع' && ord.extras.answers[1].q === 'رقم لوحة السيارة' && ord.status === 'pending_payment' && ord.is_test, 'الطلب محفوظ بالعدد والإضافات والأجوبة', JSON.stringify(ord));
  const inv = sql(`select items, total, pay_provider from invoices where order_id = '${ord.id}'`)[0];
  ok(inv && inv.pay_provider === 'demo' && Number(inv.total) === 92.24 && inv.items.length === 3 && inv.items[0].qty === 2, 'الفاتورة بنودها: الخدمة × 2 والإضافتين (دفع تجريبي)', JSON.stringify(inv));
  const pd = await payDemo(tokenOf(cta));
  ok(pd.ok, 'الدفع التجريبي', JSON.stringify(pd));
  const after = lastOut();
  ok(/وصلنا دفعك وتأكد حجزك/.test(after?.text || '') && /الإجمالي: 92\.24/.test(after?.text || ''), 'رسالة التأكيد بعد الدفع فيها الملخص', after?.text);

  // ── البكجات: القائمة، التفاصيل، الشراء، التفعيل ──
  o = await send({ type: 'text', text: 'وش عندكم بكجات؟' });
  rs = rows(o.at(-1));
  ok(rs.length === 2 && rs[0].title === 'البكج الأول' && rs[0].desc === '4 غسلات · 140 ريال بدل 160', 'قائمة البكجات بالسعر والخصم', JSON.stringify(rs));
  o = await send({ type: 'reply', id: rs[0].id });
  ok(/البكج الأول/.test(txt(o.at(-1))) && /4 غسلات/.test(txt(o.at(-1))) && btns(o.at(-1))[0]?.title === 'اشترِ الحين', 'تفاصيل البكج وزر الشراء', txt(o.at(-1)));
  o = await send({ type: 'reply', id: btns(o.at(-1))[0].id });
  const pc = o.at(-1);
  ok(pc?.kind === 'cta' && /ادفع 140 ريال/.test(txt(pc)), 'رابط دفع البكج', txt(pc));
  ok(sql(`select status from customer_packages where customer_id = '${cust()}'`)[0]?.status === 'pending', 'الرصيد معلّق قبل الدفع');
  const pd2 = await payDemo(tokenOf(pc));
  ok(pd2.ok, 'دفع البكج التجريبي', JSON.stringify(pd2));
  const cp = sql(`select id, status, uses_left from customer_packages where customer_id = '${cust()}'`)[0];
  ok(cp?.status === 'active' && cp.uses_left === 4, 'الرصيد تفعّل: 4 غسلات', JSON.stringify(cp));
  const pm = lastOut();
  ok(/صار عندك 4 غسلات في رصيدك/.test(pm?.text || '') && (pm?.buttons || [])[0]?.title === 'احجز من رصيدي', 'رسالة تفعيل الرصيد بزر «احجز من رصيدي»', JSON.stringify(pm));
  o = await send({ type: 'text', text: 'رصيدي' });
  ok(/البكج الأول: باقي 4 غسلات/.test(txt(o.at(-1))), '«رصيدي» يعرض الباقي', txt(o.at(-1)));

  // ── حجز من الرصيد: سيارتين = غسلتين، بدون إضافات = بدون دفع ──
  o = await send({ type: 'reply', id: 'm:book' });
  o = await send({ type: 'reply', id: `svc:${FULL}` });
  o = await send({ type: 'text', text: 'سيارتين' });
  ok(/عندك رصيد في البكج الأول: باقي 4 غسلات/.test(txt(o.at(-1))) && btns(o.at(-1))[0]?.title === 'من رصيدي', 'كتابة «سيارتين» تختار العدد، ويعرض عليه يستخدم رصيده', txt(o.at(-1)));
  o = await send({ type: 'text', text: 'نعم' });
  o = await send({ type: 'reply', id: 'ad:done' });
  o = await send({ type: 'location', lat: 27.03, lng: 49.6 });
  o = await send({ type: 'text', text: 'شقة 3' });
  o = await send({ type: 'text', text: 'د هـ و 555' });
  rs = rows(o.at(-1));
  o = await send({ type: 'reply', id: rs[0].id });
  rs = rows(o.at(-1));
  o = await send({ type: 'reply', id: rs[1]?.id || rs[0].id });
  ok(/تم تأكيد طلبك/.test(txt(o.at(-1))) && /من رصيد البكج/.test(txt(o.at(-1))) && /الإجمالي: 0 ريال/.test(txt(o.at(-1))), 'الحجز من الرصيد يتأكد بدون دفع', txt(o.at(-1)));
  const o2 = sql(`select id, pkg_uses, total, status from orders where business_id = '${id}' order by created_at desc limit 1`)[0];
  ok(o2.pkg_uses === 2 && Number(o2.total) === 0 && sql(`select uses_left from customer_packages where id = '${cp.id}'`)[0].uses_left === 2, 'انخصم غسلتين (باقي 2)', JSON.stringify(o2));
  // إلغاء الطلب يرجّع الرصيد
  o = await send({ type: 'text', text: 'ابي الغي' });
  if (rows(o.at(-1)).some((x) => x.id === `ord:${o2.id}`)) o = await send({ type: 'reply', id: `ord:${o2.id}` });
  const cy = (btns(o.at(-1)).find((x) => x.id === `cy:${o2.id}`) || {}).id;
  if (cy) o = await send({ type: 'reply', id: cy });
  ok(sql(`select uses_left from customer_packages where id = '${cp.id}'`)[0].uses_left === 4 && sql(`select status from orders where id = '${o2.id}'`)[0].status === 'cancelled', 'إلغاء الطلب يرجّع الرصيد 4', txt(o.at(-1)));

  // ── بدون دفع إلكتروني (منشأة بدون باقة الدفع): شراء البكج يتحوّل للمنشأة ──
  sql(`update businesses set plan = 'bot' where id = '${id}'`);
  const from2 = from + 'b';
  const send2 = async (msg) => { const j = await (await fetch(`${FN}/wa/sim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ b: b.slug, k: b.sim_key, from: from2, msg }) })).json(); return j.messages.filter((m) => m.direction === 'out'); };
  await send2({ type: 'text', text: 'هلا' });
  o = await send2({ type: 'reply', id: `pkb:${sql(`select id from packages where business_id = '${id}' order by sort limit 1`)[0].id}` });
  ok(/بيرسلون لك رابط الدفع/.test(txt(o.at(-1))) && sql(`select reason from handoffs where business_id = '${id}' order by created_at desc limit 1`)[0]?.reason === 'package', 'بدون دفع إلكتروني: يتحوّل للمنشأة ترسل الرابط', txt(o.at(-1)));
} finally {
  sql(`delete from businesses where slug like 'xtra-test%'`);
  ok(!sql(`select 1 from businesses where slug like 'xtra-test%'`).length, 'المنشأة المؤقتة انحذفت');
}
console.log(`\n${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
