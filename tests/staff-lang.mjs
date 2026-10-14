// رسالة الموظف بلغته: طلب تجريبي في «محلك» (غير مربوط بالواتساب، فما ينرسل شي لأحد، الرسالة تنسجل بس)
// موظف بالإنجليزي ← الرسالة والقالب بالإنجليزي، وبالعربي ← بالعربي. وكل شي يرجع مثل ما كان بالنهاية.
// usage: node tests/staff-lang.mjs
import { sql } from '../tools/sql.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BIZ = '48a038b2-bb65-4467-a220-f3ba668540b4';
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✓' : '✗'} ${n}${x ? ' · ' + x : ''}`); };
const [ch] = sql(`select provider, status from channels where business_id = '${BIZ}'`);
if (ch.provider !== 'none' || ch.status === 'connected') throw new Error('محلك مربوط بالواتساب، الفحص يوقف عشان ما يرسل لأحد');
const staff = sql(`select id, phone, lang from staff where business_id = '${BIZ}' order by created_at`);
const [svc] = sql(`select id from services where business_id = '${BIZ}' limit 1`);
const [city] = sql(`select id from cities where business_id = '${BIZ}' and name_en <> '' limit 1`);
const orders = [];
try {
  sql(`update staff set phone = '0500000001', lang = 'en' where id = '${staff[0].id}'; update staff set phone = '0500000002', lang = 'ar' where id = '${staff[1].id}';`);
  const [cu] = sql(`insert into customers (business_id, wa_id, name, is_sim) values ('${BIZ}', '966500000009', 'فحص اللغة', true) returning id`);
  for (const st of staff.slice(0, 2)) {
    const [o] = sql(`insert into orders (business_id, number, customer_id, service_id, city_id, staff_id, slot_start, slot_end, status, channel, is_test)
      values ('${BIZ}', (select coalesce(max(number), 1000) + 1 from orders where business_id = '${BIZ}'), '${cu.id}', '${svc.id}', '${city.id}', '${st.id}', now() + interval '1 day', now() + interval '1 day 1 hour', 'confirmed', 'dashboard', true) returning id, number`);
    orders.push(o);
    sql(`insert into jobs (business_id, kind, payload) values ('${BIZ}', 'notify_staff', '{"order_id":"${o.id}"}'::jsonb)`);
  }
  // الطابور يشتغل كل دقيقة (pg_cron)
  let logs = [];
  for (let i = 0; i < 24 && logs.length < 2; i++) { await sleep(5000); logs = sql(`select body, preview, status, error from wa_log where business_id = '${BIZ}' and created_at > now() - interval '5 minutes' and body->'template'->>'name' = 'ihj_staff_order' order by created_at`); }
  const en = logs.find((l) => l.body.to === '966500000001'), ar = logs.find((l) => l.body.to === '966500000002');
  ok(en && /^A new order for you, No\. \d+/.test(en.preview) && /Khobar|Dammam/.test(en.preview), 'الموظف بالإنجليزي: الرسالة بالإنجليزي', en && en.preview.replace(/\n/g, ' | '));
  ok(en && en.body.template.params[2] && /[AP]M/.test(en.body.template.params[2]), 'قالبه بالوقت الإنجليزي', en && JSON.stringify(en.body.template.params));
  ok(ar && /^طلب جديد لك رقم/.test(ar.preview), 'الموظف بالعربي: الرسالة بالعربي', ar && ar.preview.replace(/\n/g, ' | '));
  ok(logs.every((l) => l.status === 'not_connected'), 'ما انرسل شي (غير مربوط)', logs.map((l) => l.status).join(','));
} finally {
  sql(`delete from wa_log where business_id = '${BIZ}' and body->>'to' in ('966500000001','966500000002')`);
  if (orders.length) sql(`delete from jobs where business_id = '${BIZ}' and payload->>'order_id' in (${orders.map((o) => `'${o.id}'`).join(',')}); delete from orders where id in (${orders.map((o) => `'${o.id}'`).join(',')});`);
  sql(`delete from customers where business_id = '${BIZ}' and wa_id = '966500000009'`);
  for (const st of staff) sql(`update staff set phone = '${st.phone}', lang = '${st.lang}' where id = '${st.id}'`);
  const left = sql(`select (select count(*) from orders where business_id = '${BIZ}') o, (select count(*) from staff where business_id = '${BIZ}' and (phone <> '' or lang <> 'ar')) s`)[0];
  ok(+left.o === 0 && +left.s === 0, 'رجع كل شي مثل ما كان', JSON.stringify(left));
}
console.log(`\n${pass} نجح، ${fail} فشل`);
process.exit(fail ? 1 : 0);
