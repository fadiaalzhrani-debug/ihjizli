// فحص إصلاحات التشغيل على منشأة حقيقية مؤقتة (مو تجريبية) تنحذف بالنهاية:
//  تجربة المحاكي ما تحجز الموعد ولا تنسند لموظف، والدفع المقدم فيها تجريبي حتى لو المنشأة على ميسر،
//  مسح تجارب المحاكي يشتغل لأي منشأة، توثيق ميتا ينحفظ من لوحة المدير، «بدون مزوّد» يرجّع الحالة غير مربوط،
//  وتطبيق البيانات ما يفعّل الدفع المقدم لباقة الحجز. ما يرسل أي واتساب (المنشأة بدون رقم مربوط).
import fs from 'node:fs';
import { sessionFor, api, rest } from './link-check.mjs';
import { sql } from '../tools/sql.mjs';
const P = JSON.parse(fs.readFileSync(new URL('../.secrets/project.json', import.meta.url)));
const FN = `${P.url}/functions/v1`;
const adminTok = fs.readFileSync(new URL('../.secrets/admin-link.txt', import.meta.url), 'utf8').trim().split('#k=')[1];
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('✓ ' + name); } else { fail++; console.log('✗ ' + name + (extra ? ' · ' + extra : '')); } };
const rows = (m) => (m?.body?.sections || []).flatMap((s) => s.rows || []);
sql(`delete from businesses where slug like 'ops-test%'`);
const a = await sessionFor(adminTok);
let bizId = '';
try {
  const r = await api(a.jwt, 'admin/business/create', { name: 'منشأة فحص التشغيل', slug: 'ops-test', plan: 'bot_pay', is_demo: false, place_mode: 'shop', pay_timing: 'before', prepay_amount: 50,
    services: [{ name: 'قص', price: null }], cities: [{ name: 'الرياض', lat: 24.7136, lng: 46.6753, radius_km: 40 }],
    staff: [{ name: 'موظف الفحص', phone: '', cities: ['الرياض'] }] });
  ok(r.ok && r.business && !r.business.is_demo, 'منشأة حقيقية مؤقتة', JSON.stringify(r).slice(0, 120));
  bizId = r.business.id;
  const b = sql(`select slug, sim_key from businesses where id = '${bizId}'`)[0];
  // ميسر بدون مفاتيح: لو التجربة حاولت تنشئ فاتورة ميسر بتفشل، والمفروض تصير تجريبية
  sql(`update settings set pay_provider = 'moyasar', capacity_mode = 'staff', days_ahead = 3 where business_id = '${bizId}'`);
  sql(`update hours set open_time = '00:00', close_time = '23:59' where business_id = '${bizId}'`);
  const from = 'sim-ops' + Math.random().toString(36).slice(2, 9);
  const send = async (msg) => { const j = await (await fetch(`${FN}/wa/sim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ b: b.slug, k: b.sim_key, from, msg }) })).json(); if (!j.ok) throw new Error(JSON.stringify(j)); return j.messages.filter((m) => m.direction === 'out'); };
  await send({ type: 'text', text: 'السلام عليكم' });
  let o = await send({ type: 'reply', id: 'm:book' });
  let last = o.at(-1);
  const day = rows(last).find((x) => x.id.startsWith('day:'));
  o = await send({ type: 'reply', id: day.id }); last = o.at(-1);
  const slot = rows(last).find((x) => x.id.startsWith('slot:'));
  const slotIso = slot.id.slice(5);
  o = await send({ type: 'reply', id: slot.id }); last = o.at(-1);
  const ord = sql(`select status, is_test, staff_id from orders where business_id = '${bizId}' order by created_at desc limit 1`)[0];
  ok(ord && ord.is_test && ord.status === 'pending_payment', 'تجربة المحاكي انحجزت كطلب تجريبي ينتظر الدفع', JSON.stringify(ord));
  ok(ord && !ord.staff_id, 'تجربة المحاكي ما انسندت للموظف (ما توصله)', JSON.stringify(ord));
  const inv = sql(`select pay_provider, pay_token from invoices where business_id = '${bizId}' order by created_at desc limit 1`)[0];
  ok(inv && inv.pay_provider === 'demo' && last.kind === 'cta', 'الدفع المقدم في التجربة تجريبي حتى والمنشأة على ميسر', JSON.stringify(inv) + ' ' + last.kind);
  const free = sql(`select count(*)::int n from public.ihj_free_slots('${bizId}', (select id from cities where business_id = '${bizId}' limit 1), null, ('${slotIso}'::timestamptz at time zone 'Asia/Riyadh')::date, 1) f where f.slot_start = '${slotIso}'::timestamptz`)[0].n;
  ok(free === 1, 'الموعد اللي انحجز في التجربة باقي فاضي للعملاء الحقيقيين', String(free));
  const pay = await (await fetch(`${FN}/pay/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: inv.pay_token, method: 'mada' }) })).json();
  const after = sql(`select status from orders where business_id = '${bizId}' order by created_at desc limit 1`)[0];
  ok(pay.ok && after.status === 'confirmed', 'الدفع التجريبي يأكد حجز التجربة في المنشأة الحقيقية', JSON.stringify(pay) + ' ' + after.status);
  // حجز يدوي (عميل اتصل): نفس الموعد اللي جرّبه المحاكي متاح، ينسند للموظف، والثاني على نفس الوقت يترفض
  const mb = await api(a.jwt, 'biz/book', { business_id: bizId, name: 'عميل اتصل', phone: '0599000009', service_id: sql(`select id from services where business_id = '${bizId}' limit 1`)[0].id, city_id: sql(`select id from cities where business_id = '${bizId}' limit 1`)[0].id, start: slotIso, notify: true });
  const mo = mb.ok ? sql(`select status, channel, is_test, staff_id from orders where id = '${mb.order.id}'`)[0] : null;
  ok(mb.ok && mo && mo.status === 'confirmed' && mo.channel === 'dashboard' && !mo.is_test && mo.staff_id, 'الحجز اليدوي على نفس الموعد ينجح وينسند للموظف', JSON.stringify(mb).slice(0, 160) + ' ' + JSON.stringify(mo));
  ok(mb.ok && mb.send && mb.send.mode === 'logged', 'التأكيد ينحفظ بدون إرسال لأن الرقم ما تربط (واللوحة تقول كذا)', JSON.stringify(mb.send));
  const mb2 = await api(a.jwt, 'biz/book', { business_id: bizId, name: 'عميل ثاني', phone: '0599000008', service_id: sql(`select id from services where business_id = '${bizId}' limit 1`)[0].id, city_id: sql(`select id from cities where business_id = '${bizId}' limit 1`)[0].id, start: slotIso, notify: false });
  ok(!mb2.ok && mb2.error === 'slot_taken', 'حجز ثاني على نفس الوقت والموظف الوحيد مشغول يترفض', JSON.stringify(mb2).slice(0, 120));
  // مسح تجارب المحاكي لمنشأة حقيقية
  const rs = await api(a.jwt, 'admin/demo/reset', { business_id: bizId });
  const left = sql(`select count(*)::int n from customers where business_id = '${bizId}' and is_sim`)[0].n;
  ok(rs.ok && left === 0, 'مسح تجارب المحاكي يشتغل لأي منشأة', JSON.stringify(rs) + ' left ' + left);
  // توثيق ميتا من لوحة المدير
  const up = await rest(a.jwt, `channels?business_id=eq.${bizId}&select=meta_verification`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ meta_verification: 'pending' }) });
  const mv = sql(`select meta_verification from channels where business_id = '${bizId}'`)[0].meta_verification;
  ok(up.status === 200 && mv === 'pending', 'توثيق ميتا ينحفظ من لوحة المدير', up.status + ' ' + mv);
  // «بدون مزوّد» يرجّع الحالة غير مربوط
  sql(`update channels set status = 'connected' where business_id = '${bizId}'`);
  const sv = await api(a.jwt, 'admin/channel/save', { business_id: bizId, provider: 'none' });
  const cs = sql(`select status from channels where business_id = '${bizId}'`)[0].status;
  ok(sv.ok && cs === 'not_connected', '«بدون مزوّد» يرجّع الحالة غير مربوط', cs);
  // تطبيق البيانات: الدفع المقدم ما يتفعّل لباقة الحجز
  sql(`update businesses set plan = 'bot' where id = '${bizId}'`);
  sql(`update settings set pay_timing = 'after' where business_id = '${bizId}'`);
  sql(`insert into client_docs (business_id, intake, intake_at) values ('${bizId}', '{"name":"منشأة فحص التشغيل","pay_timing":"before","place_mode":"shop"}'::jsonb, now()) on conflict (business_id) do update set intake = excluded.intake, intake_at = now()`);
  const ap = await fetch(`${P.url}/rest/v1/rpc/ihj_apply_intake`, { method: 'POST', headers: { apikey: P.anon, authorization: `Bearer ${a.jwt}`, 'content-type': 'application/json' }, body: JSON.stringify({ p_business: bizId }) }).then((x) => x.json());
  const pt = sql(`select pay_timing from settings where business_id = '${bizId}'`)[0].pay_timing;
  ok(ap && ap.ok && pt === 'after', 'تطبيق البيانات ما يفعّل الدفع المقدم لباقة الحجز بدون دفع', JSON.stringify(ap) + ' ' + pt);
  // تنبيهات المالك شغّالة افتراضيًا
  const no = sql(`select notify_owner from settings where business_id = '${bizId}'`)[0].notify_owner;
  ok(no === true, 'تنبيهات المالك شغّالة افتراضيًا للمنشأة الجديدة', String(no));
  // إحصاءات المدير فيها آخر رسالة حقيقية والفاشلة
  const stt = sql(`select count(*)::int n from information_schema.routines where routine_name = 'ihj_admin_stats'`)[0].n;
  const st = await fetch(`${P.url}/rest/v1/rpc/ihj_admin_stats`, { method: 'POST', headers: { apikey: P.anon, authorization: `Bearer ${a.jwt}`, 'content-type': 'application/json' }, body: '{}' }).then((x) => x.json());
  const mine = Array.isArray(st) ? st.find((x) => x.business_id === bizId) : null;
  ok(stt === 1 && mine && 'last_real_in' in mine && 'failed_week' in mine, 'إحصاءات المدير فيها آخر رسالة حقيقية والرسائل الفاشلة', JSON.stringify(mine || st).slice(0, 160));
} finally {
  sql(`delete from businesses where slug like 'ops-test%'`);
  ok(!sql(`select 1 from businesses where slug like 'ops-test%'`).length, 'منشأة الفحص انحذفت');
}
console.log(`\n${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
