// فحوصات احجزلي الآلية من الطرف إلى الطرف (على الخادم الحقيقي، المنشأة التجريبية «محلك» و«منشأة اختبار»)
// ما يرسل أي واتساب حقيقي: المحاكي يسجّل فقط، وفحص الويبهوك الحقيقي بوضع dry_run بدون اتصال بميتا
// usage: node tests/e2e.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import { sessionFor, rest, api } from './link-check.mjs';
import { testLinks } from './links.mjs';
import { sql } from '../tools/sql.mjs';

const P = JSON.parse(fs.readFileSync(new URL('../.secrets/project.json', import.meta.url)));
const FN = `${P.url}/functions/v1`;
const CRON_KEY = fs.readFileSync(new URL('../.secrets/cron-key.txt', import.meta.url), 'utf8').trim();
const results = [];
let current = '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function ok(cond, msg) { if (!cond) throw new Error(msg); }
async function t(name, fn) {
  current = name;
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`✓ ${name}`); }
  catch (e) { results.push({ name, ok: false, err: e.message }); console.log(`✗ ${name}\n    ${e.message}`); }
}
const q1 = (s) => sql(s)[0] || null;
const BIZ = Object.fromEntries(sql(`select slug, id, sim_key, client_key from businesses where is_demo`).map((r) => [r.slug, r]));
const M = BIZ.mahalak, TB = BIZ['test-b'];
const rid = () => crypto.randomBytes(5).toString('hex');

// ───── أدوات المحاكي ─────
function simCustomer(biz) {
  const from = 'sim-e2e' + rid();
  const send = async (msg) => {
    const r = await fetch(`${FN}/wa/sim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ b: biz.slug, k: biz.sim_key, from, name: 'فحص آلي', msg }) });
    const j = await r.json();
    if (!j.ok) throw new Error('sim ' + JSON.stringify(j));
    return { outs: j.messages.filter((m) => m.direction === 'out'), paused: j.paused };
  };
  const poll = async (after = 0) => (await (await fetch(`${FN}/wa/sim?${new URLSearchParams({ b: biz.slug, k: biz.sim_key, from, after })}`)).json()).messages || [];
  return { from, send, poll, text: (t) => send({ type: 'text', text: t }), reply: (id, title = '') => send({ type: 'reply', id, title }), loc: (lat, lng) => send({ type: 'location', lat, lng }) };
}
const last = (outs) => outs[outs.length - 1];
const rowsOf = (m) => (m?.body?.sections || []).flatMap((s) => s.rows || []);
const slotRows = (m) => rowsOf(m).filter((r) => r.id.startsWith('slot:'));
const customerId = (biz, from) => q1(`select id from customers where business_id='${biz.id}' and wa_id='${from}'`)?.id;

async function bookVia(c, lat = 26.2850, lng = 50.2100, dayIdx = 1, slotIdx = 0) {
  let r = await c.reply('m:book', 'احجز من هنا');
  if (last(r.outs)?.kind === 'list' && rowsOf(last(r.outs))[0]?.id.startsWith('svc:')) r = await c.reply(rowsOf(last(r.outs))[0].id);
  ok(last(r.outs)?.kind === 'location_request', 'expected location_request, got ' + last(r.outs)?.kind);
  r = await c.loc(lat, lng);
  const days = rowsOf(last(r.outs));
  ok(days.length > 0 && days[0].id.startsWith('day:'), 'expected day list');
  const d = days[Math.min(dayIdx, days.length - 1)];
  r = await c.reply(d.id, d.title);
  const times = slotRows(last(r.outs));
  ok(times.length > 0, 'expected time list');
  const s = times[Math.min(slotIdx, times.length - 1)];
  r = await c.reply(s.id, s.title);
  const conf = last(r.outs);
  ok(conf && /رقم الطلب: (\d+)|Order number: #(\d+)/.test(conf.preview), 'no confirmation: ' + conf?.preview);
  const no = Number((conf.preview.match(/(?:رقم الطلب: |#)(\d+)/) || [])[1]);
  return { no, slot: s.id.slice(5), conf };
}

// ═════════════════════════════ الفحوصات ═════════════════════════════
const L = await testLinks();
const adminTok = fs.readFileSync(new URL('../.secrets/admin-link.txt', import.meta.url), 'utf8').trim().split('#k=')[1];
let A, OM, OT, SA, SK;

await t('روابط الدخول تتحول لجلسات (مدير، مالك، موظفين)', async () => {
  A = await sessionFor(adminTok); OM = await sessionFor(L.tok('owner_mahalak')); OT = await sessionFor(L.tok('owner_testb'));
  SA = await sessionFor(L.tok('staff_ahmed')); SK = await sessionFor(L.tok('staff_khalid'));
  ok(A.kind === 'admin' && OM.kind === 'owner' && SA.kind === 'staff', 'kinds');
});
await t('تصفير تجارب المنشأتين التجريبيتين', async () => {
  for (const b of [M, TB]) { const r = await api(A.jwt, 'admin/demo/reset', { business_id: b.id }); ok(r.ok, JSON.stringify(r)); }
  sql(`update settings set export_kind='none', export_url='', notify_owner=false where business_id in ('${M.id}','${TB.id}')`);
});
await t('الزائر بدون جلسة ما يقرأ أي جدول', async () => {
  for (const tb of ['orders', 'businesses', 'customers', 'signup_requests', 'business_secrets', 'wa_log']) {
    const r = await fetch(`${P.url}/rest/v1/${tb}?select=*&limit=1`, { headers: { apikey: P.anon } });
    const body = await r.text();
    ok(r.status === 401 || r.status === 403 || body === '[]', `${tb} exposed: ${r.status} ${body.slice(0, 80)}`);
  }
});
await t('رابط غلط ما يفتح شي', async () => {
  const r = await fetch(`${FN}/api/link`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'x'.repeat(32) }) });
  ok(r.status === 401, 'status ' + r.status);
});

// ── البوت عبر المحاكي ──
let c1, order1;
await t('الترحيب بثلاثة أزرار من أول رسالة', async () => {
  c1 = simCustomer(M);
  const r = await c1.text('السلام عليكم');
  const w = last(r.outs);
  ok(w.kind === 'buttons' && w.body.buttons.length === 3, 'welcome ' + w.kind);
  ok(w.body.buttons[0].id === 'm:book' && /محلك/.test(w.preview), 'welcome content');
});
await t('موقع خارج النطاق يوصله رد واضح', async () => {
  let r = await c1.reply('m:book');
  ok(last(r.outs).kind === 'location_request', 'location_request');
  r = await c1.loc(24.7136, 46.6753);
  ok(/خارج نطاق/.test(last(r.outs).preview), 'out of area: ' + last(r.outs).preview);
});
await t('رابط قوقل ماب ينقرأ ويطلع الأيام المتاحة', async () => {
  const r = await c1.text('https://maps.google.com/?q=26.2885,50.2050');
  const m = last(r.outs);
  ok(m.kind === 'list' && rowsOf(m)[0].id.startsWith('day:'), 'days list: ' + m.preview);
});
await t('اختيار اليوم والوقت يأكد الطلب برقم وينسند لموظف المدينة', async () => {
  const days = rowsOf(last((await c1.poll()).filter((m) => m.direction === 'out')));
  let r = await c1.reply(days[1].id, days[1].title);
  const times = slotRows(last(r.outs));
  r = await c1.reply(times[0].id, times[0].title);
  const conf = last(r.outs);
  ok(/رقم الطلب: \d+/.test(conf.preview), 'confirmation');
  order1 = q1(`select o.*, s.name staff_name, c.name city_name from orders o left join staff s on s.id=o.staff_id left join cities c on c.id=o.city_id where o.customer_id='${customerId(M, c1.from)}' order by created_at desc limit 1`);
  ok(order1 && order1.status === 'confirmed' && order1.city_name === 'الخبر' && ['أحمد', 'خالد'].includes(order1.staff_name), 'order row ' + JSON.stringify(order1));
  ok(order1.channel === 'sim' && order1.is_test === true, 'sim flags');
});
await t('المالك يشوف الطلب، والموظف المسند فقط يشوفه', async () => {
  const o = await rest(OM.jwt, `orders?select=id&id=eq.${order1.id}`);
  ok(o.json?.length === 1, 'owner sees');
  const mine = order1.staff_name === 'أحمد' ? SA : SK, other = order1.staff_name === 'أحمد' ? SK : SA;
  ok((await rest(mine.jwt, `orders?select=id&id=eq.${order1.id}`)).json?.length === 1, 'assigned staff sees');
  ok((await rest(other.jwt, `orders?select=id&id=eq.${order1.id}`)).json?.length === 0, 'other staff blind');
});
await t('منشأة ثانية ما تشوف طلبات «محلك» ولا عملاءها', async () => {
  ok((await rest(OT.jwt, `orders?select=id&business_id=eq.${M.id}`)).json?.length === 0, 'orders isolated');
  ok((await rest(OT.jwt, `customers?select=id&business_id=eq.${M.id}`)).json?.length === 0, 'customers isolated');
  ok((await rest(OT.jwt, `businesses?select=id`)).json?.length === 1, 'sees only own business');
});
await t('المالك ما يقدر يغيّر باقته، والموظف ما يغيّر حالة الطلب مباشرة', async () => {
  await rest(OT.jwt, `businesses?id=eq.${TB.id}`, { method: 'PATCH', body: JSON.stringify({ plan: 'bot_pay' }) });
  ok(q1(`select plan from businesses where id='${TB.id}'`).plan === 'bot', 'plan changed by owner!');
  const mine = order1.staff_name === 'أحمد' ? SA : SK;
  await rest(mine.jwt, `orders?id=eq.${order1.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'done' }) });
  ok(q1(`select status from orders where id='${order1.id}'`).status === 'confirmed', 'staff changed status!');
  const sec = await rest(OM.jwt, `business_secrets?select=*`);
  ok(sec.status >= 400 || (Array.isArray(sec.json) && sec.json.length === 0), 'secrets readable!');
});
await t('طلباتي ← تغيير الموعد يغيّره فعلًا', async () => {
  let r = await c1.text('طلباتي');
  ok(last(r.outs).kind === 'buttons' && last(r.outs).body.buttons[0].id === `rs:${order1.id}`, 'order actions');
  r = await c1.reply(`rs:${order1.id}`, 'تغيير الموعد');
  const days = rowsOf(last(r.outs)); ok(days.length, 'days');
  r = await c1.reply(days[days.length - 1].id, days[days.length - 1].title);
  const times = slotRows(last(r.outs));
  r = await c1.reply(times[times.length - 1].id, times[times.length - 1].title);
  ok(/تم تغيير موعد طلبك/.test(last(r.outs).preview), 'rescheduled msg');
  const after = q1(`select slot_start from orders where id='${order1.id}'`);
  ok(new Date(after.slot_start).getTime() !== new Date(order1.slot_start).getTime(), 'slot unchanged');
  order1.slot_start = after.slot_start;
});
let c2, order2no;
await t('حجز ثاني ثم إلغاؤه من طلباتي', async () => {
  c2 = simCustomer(M);
  await c2.text('هلا');
  const b = await bookVia(c2, 26.4300, 50.1000, 2, 1); // الدمام
  order2no = b.no;
  const o = q1(`select o.id, s.name staff from orders o left join staff s on s.id=o.staff_id where o.business_id='${M.id}' and o.number=${b.no}`);
  ok(o.staff === 'خالد', 'dammam must go to khalid, got ' + o.staff);
  let r = await c2.text('ابي الغي الطلب');
  ok(/متأكد تبي تلغي طلب/.test(last(r.outs).preview), 'confirm cancel: ' + last(r.outs).preview);
  r = await c2.reply(`cy:${o.id}`, 'نعم، ألغِ الطلب');
  ok(/تم إلغاء طلبك/.test(last(r.outs).preview), 'cancelled msg');
  ok(q1(`select status from orders where id='${o.id}'`).status === 'cancelled', 'db cancelled');
});
await t('الشكوى تتحول للمحل ويوقف البوت عن العميل، والمالك يرد ويرجّعه', async () => {
  const c = simCustomer(M);
  await c.text('السلام عليكم');
  let r = await c.text('عندي شكوى الفني تأخر علي');
  ok(/نعتذر لك/.test(last(r.outs).preview) && r.paused === true, 'handoff complaint');
  const cid = customerId(M, c.from);
  ok(q1(`select count(*)::int n from handoffs where customer_id='${cid}' and resolved_at is null and reason='complaint'`).n === 1, 'handoff row');
  r = await c.text('وينكم؟');
  ok(r.outs.length === 0, 'bot must stay silent while paused');
  const rep = await api(OM.jwt, 'customer/reply', { customer_id: cid, text: 'هلا، نعتذر منك، الفني بيوصلك خلال ربع ساعة' });
  ok(rep.ok, 'owner reply ' + JSON.stringify(rep));
  const msgs = await c.poll();
  ok(msgs.some((m) => m.direction === 'out' && m.by_who === 'owner'), 'owner message visible to customer');
  ok((await api(OM.jwt, 'customer/resume', { customer_id: cid })).ok, 'resume');
  r = await c.text('السلام عليكم');
  ok(last(r.outs)?.kind === 'buttons', 'bot back');
});
await t('رسالة ما يفهمها البوت تتحول للمحل', async () => {
  const c = simCustomer(M);
  await c.text('السلام عليكم');
  const r = await c.text('وش رايك بالجو اليوم؟');
  ok(/وصلت رسالتك لفريق/.test(last(r.outs).preview) && r.paused, 'unknown handoff');
});
await t('العميل الإنجليزي يوصله كل شي بالإنجليزي', async () => {
  const c = simCustomer(M);
  let r = await c.text('Hi');
  ok(/Welcome to Mahalak/.test(last(r.outs).preview), 'english welcome: ' + last(r.outs).preview);
  const b = await bookVia(c, 26.2850, 50.2100, 3, 2);
  ok(/Order number: #\d+/.test(b.conf.preview) && /Price is set after the visit/.test(b.conf.preview), 'english confirmation');
});
await t('أسعار ثابتة وخدمات متعددة وسعة ثابتة (منشأة اختبار)', async () => {
  const c = simCustomer(TB);
  let r = await c.text('كم السعر؟');
  ok(/غسيل: 50 ريال/.test(last(r.outs).preview) && /تلميع: 120 ريال/.test(last(r.outs).preview), 'prices');
  r = await c.reply('m:book');
  const svc = rowsOf(last(r.outs));
  ok(svc.length === 2 && svc[0].id.startsWith('svc:'), 'service list');
  r = await c.reply(svc[0].id, svc[0].title);
  ok(last(r.outs).kind === 'location_request', 'location after service');
  r = await c.loc(24.70, 46.68);
  const day = rowsOf(last(r.outs))[1];
  r = await c.reply(day.id, day.title);
  const slot = rowsOf(last(r.outs))[0];
  r = await c.reply(slot.id, slot.title);
  ok(/💰 50 ريال/.test(last(r.outs).preview), 'fixed price in confirmation: ' + last(r.outs).preview);
  // السعة 2: عميلان ثانيان على نفس الوقت، والثالث ما يشوفه
  const c2b = simCustomer(TB);
  await c2b.reply('m:book'); await c2b.reply(svc[0].id); await c2b.loc(24.70, 46.68);
  r = await c2b.reply(day.id, day.title);
  ok(rowsOf(last(r.outs)).some((x) => x.id === slot.id), 'slot still free for 2nd');
  r = await c2b.reply(slot.id, slot.title);
  ok(/رقم الطلب/.test(last(r.outs).preview), '2nd booking ok');
  const c3 = simCustomer(TB);
  await c3.reply('m:book'); await c3.reply(svc[0].id); await c3.loc(24.70, 46.68);
  r = await c3.reply(day.id, day.title);
  ok(!rowsOf(last(r.outs)).some((x) => x.id === slot.id), 'full slot must disappear');
});

// ── الموظف والفاتورة والدفع ──
let inv1;
await t('الموظف: في الطريق ثم وصلت، والعميل يوصله التنبيه', async () => {
  const mine = order1.staff_name === 'أحمد' ? SA : SK;
  ok((await api(mine.jwt, 'order/on_the_way', { order_id: order1.id })).ok, 'on_the_way');
  ok((await api(mine.jwt, 'order/arrived', { order_id: order1.id })).ok, 'arrived');
  const msgs = (await c1.poll()).filter((m) => m.direction === 'out');
  ok(msgs.some((m) => /في الطريق لك/.test(m.preview)) && msgs.some((m) => /لموقعك/.test(m.preview)), 'customer notified');
  const other = order1.staff_name === 'أحمد' ? SK : SA;
  const no = await api(other.jwt, 'order/on_the_way', { order_id: order1.id });
  ok(!no.ok && no.error === 'forbidden', 'other staff blocked');
});
await t('الفاتورة PDF ورابط الدفع يوصلون العميل', async () => {
  const mine = order1.staff_name === 'أحمد' ? SA : SK;
  inv1 = await api(mine.jwt, 'order/invoice', { order_id: order1.id, items: [{ name: 'زيارة فني وفحص', qty: 1, price: 100 }, { name: 'قطعة غيار', qty: 2, price: 42.5 }] });
  ok(inv1.ok && inv1.invoice.total == 185 && inv1.pay_link, 'invoice ' + JSON.stringify(inv1).slice(0, 200));
  const pdf = await fetch(inv1.pdf_url);
  const buf = Buffer.from(await pdf.arrayBuffer());
  ok(pdf.status === 200 && buf.slice(0, 5).toString() === '%PDF-' && buf.length > 8000, 'pdf');
  const msgs = (await c1.poll()).filter((m) => m.direction === 'out');
  ok(msgs.some((m) => m.kind === 'document') && msgs.some((m) => m.kind === 'cta' && m.body.url === inv1.pay_link), 'document + pay button');
  const go = await fetch(inv1.pay_link, { redirect: 'manual' });
  ok(go.status === 302 && /pay\.html\?t=/.test(go.headers.get('location')), 'pay/go redirect');
});
await t('الدفع التجريبي يوصل «وصلنا دفعك» وينقفل الطلب', async () => {
  const tok = inv1.invoice.pay_token;
  const r = await (await fetch(`${FN}/pay/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: tok, method: 'applepay' }) })).json();
  ok(r.ok && !r.already, 'pay ' + JSON.stringify(r));
  const again = await (await fetch(`${FN}/pay/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: tok, method: 'applepay' }) })).json();
  ok(again.ok && again.already, 'idempotent');
  const o = q1(`select status, paid_at from orders where id='${order1.id}'`);
  ok(o.status === 'done' && o.paid_at, 'order closed');
  ok(q1(`select count(*)::int n from payments where invoice_id='${inv1.invoice.id}'`).n === 1, 'one payment row');
  const msgs = (await c1.poll()).filter((m) => m.direction === 'out');
  ok(msgs.some((m) => /وصلنا دفعك/.test(m.preview)), 'paid message');
  const info = await (await fetch(`${FN}/pay/info`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: tok }) })).json();
  ok(info.invoice.status === 'paid' && info.invoice.paid_method === 'أبل باي', 'paid info');
});
await t('الدفع اليدوي (نقدًا) من المالك يقفل الطلب', async () => {
  const c = simCustomer(TB);
  await c.text('السلام عليكم');
  const b = await bookVia(c, 24.71, 46.67, 2, 3);
  const o = q1(`select id from orders where business_id='${TB.id}' and number=${b.no}`);
  const inv = await api(OT.jwt, 'order/invoice', { order_id: o.id, items: [{ name: 'غسيل', qty: 1, price: 50 }] });
  ok(inv.ok, 'invoice');
  const cash = await api(OT.jwt, 'order/cash', { order_id: o.id, method: 'cash' });
  ok(cash.ok, 'cash ' + JSON.stringify(cash));
  ok(q1(`select status from orders where id='${o.id}'`).status === 'done', 'done');
  ok(q1(`select paid_method from invoices where order_id='${o.id}' and status='paid'`)?.paid_method === 'نقدًا', 'method');
});
await t('المالك يلغي طلب ويغيّر موعد طلب، والعميل يوصله', async () => {
  const c = simCustomer(M);
  await c.text('السلام عليكم');
  const b1 = await bookVia(c, 26.2850, 50.2100, 4, 0);
  const o = q1(`select id, city_id, service_id from orders where business_id='${M.id}' and number=${b1.no}`);
  const slots = await api(OM.jwt, 'slots', { business_id: M.id, city_id: o.city_id, service_id: o.service_id, days: 7, exclude: o.id });
  ok(slots.ok && slots.slots.length > 2, 'slots');
  const rs = await api(OM.jwt, 'order/reschedule', { order_id: o.id, start: slots.slots[2].slot_start });
  ok(rs.ok, 'reschedule ' + JSON.stringify(rs));
  const cx = await api(OM.jwt, 'order/cancel', { order_id: o.id, reason: 'ظرف طارئ' });
  ok(cx.ok, 'cancel');
  const msgs = (await c.poll()).filter((m) => m.direction === 'out');
  ok(msgs.some((m) => /تم تغيير موعد طلبك/.test(m.preview)) && msgs.some((m) => /تم إلغاء طلبك/.test(m.preview) && /ظرف طارئ/.test(m.preview)), 'customer informed');
});

// ── المهام الدورية ──
const cron = async (q = '') => (await (await fetch(`${FN}/cron${q}`, { method: 'POST', headers: { 'x-cron-key': CRON_KEY } })).json());
await t('مفتاح cron غلط مرفوض', async () => {
  const r = await fetch(`${FN}/cron`, { method: 'POST', headers: { 'x-cron-key': 'nope' } });
  ok(r.status === 401, 'status ' + r.status);
});
await t('التذكير قبل الموعد يوصل العميل مرة وحدة', async () => {
  const c = simCustomer(M);
  await c.text('السلام عليكم');
  const b = await bookVia(c, 26.2850, 50.2100, 5, 0);
  const o = q1(`select id from orders where business_id='${M.id}' and number=${b.no}`);
  sql(`update orders set created_at = now() - interval '1 day', slot_start = now() + interval '90 minutes', slot_end = now() + interval '150 minutes', reminded_at = null where id='${o.id}'`);
  const r = await cron();
  ok(r.ok, 'cron ' + JSON.stringify(r));
  let msgs = (await c.poll()).filter((m) => m.direction === 'out' && /تذكير بموعدك/.test(m.preview));
  ok(msgs.length === 1, 'reminder count ' + msgs.length);
  await cron();
  msgs = (await c.poll()).filter((m) => m.direction === 'out' && /تذكير بموعدك/.test(m.preview));
  ok(msgs.length === 1, 'no duplicate reminder');
  ok(q1(`select reminded_at is not null r from orders where id='${o.id}'`).r, 'reminded_at');
});
await t('التصدير (Webhook) يوصل نسخة موقّعة لكل طلب جديد', async () => {
  sql(`delete from hook_sink where business_id='${M.id}'; update settings set export_kind='webhook', export_url='${FN}/api/hook-sink/${M.id}' where business_id='${M.id}'`);
  try {
    const c = simCustomer(M);
    await c.text('السلام عليكم');
    const b = await bookVia(c, 26.2850, 50.2100, 6, 1);
    let row = null;
    for (let i = 0; i < 12 && !row; i++) { await sleep(1500); row = q1(`select * from hook_sink where business_id='${M.id}' order by id desc limit 1`); if (!row) await cron(); }
    ok(row, 'no webhook received');
    ok(row.body.event === 'order.created' && row.body.order.number === b.no, 'payload ' + JSON.stringify(row.body).slice(0, 160));
    const sec = q1(`select export_secret from business_secrets where business_id='${M.id}'`).export_secret;
    ok(/^sha256=[0-9a-f]{64}$/.test(row.headers.signature || ''), 'signature header');
    void sec;
    const test = await api(OM.jwt, 'biz/export-test', { business_id: M.id });
    ok(test.ok && test.status === 200, 'export test button ' + JSON.stringify(test));
  } finally { sql(`update settings set export_kind='none', export_url='' where business_id='${M.id}'`); }
});
await t('البوت يرجع تلقائيًا للعميل المحوّل بعد المدة', async () => {
  const c = simCustomer(M);
  await c.text('السلام عليكم');
  await c.text('ابي اكلم موظف');
  const cid = customerId(M, c.from);
  ok(q1(`select bot_paused from customers where id='${cid}'`).bot_paused, 'paused');
  sql(`update customers set paused_at = now() - interval '13 hours' where id='${cid}'`);
  const r = await cron();
  ok(r.resumed >= 1, 'resumed ' + JSON.stringify(r));
  ok(!q1(`select bot_paused from customers where id='${cid}'`).bot_paused, 'still paused');
});

// ── واتساب الحقيقي (ويبهوك ميتا بوضع dry_run، بدون أي إرسال) ──
await t('ويبهوك واتساب: التحقق، التوقيع، رد البوت، الحالات، ورد المالك من جواله', async () => {
  const pnid = 'e2e' + rid();
  const appSecret = 'e2e-secret-' + rid();
  const tpl = ['ihj_reminder', 'ihj_on_the_way', 'ihj_arrived', 'ihj_invoice', 'ihj_paid', 'ihj_update', 'ihj_new_order', 'ihj_staff_order', 'ihj_handoff'].map((name) => ({ name, language: 'ar', status: 'APPROVED', category: 'UTILITY' }));
  sql(`update channels set provider='meta', phone_number_id='${pnid}', status='connected', dry_run=true, templates='${JSON.stringify(tpl)}'::jsonb where business_id='${TB.id}';
       update business_secrets set wa_token='dry', wa_app_secret='${appSecret}' where business_id='${TB.id}'`);
  const sec = q1(`select wa_hook_key, wa_verify_token from business_secrets where business_id='${TB.id}'`);
  const hook = `${FN}/wa/hook/${sec.wa_hook_key}`;
  try {
    const v = await fetch(`${hook}?hub.mode=subscribe&hub.verify_token=${sec.wa_verify_token}&hub.challenge=1234`);
    ok(v.status === 200 && (await v.text()) === '1234', 'verify challenge');
    const bad = await fetch(`${hook}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`);
    ok(bad.status === 403, 'bad verify token');
    const wa = '9665' + String(Math.floor(10000000 + Math.random() * 89999999));
    const wamid = 'wamid.E2E' + rid();
    const payload = { object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '966500000000', phone_number_id: pnid },
      contacts: [{ profile: { name: 'عميل فحص' }, wa_id: wa }], messages: [{ from: wa, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'السلام عليكم' } }] } }] }] };
    const raw = JSON.stringify(payload);
    const sig = crypto.createHmac('sha256', appSecret).update(raw).digest('hex');
    const nos = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=bad' }, body: raw });
    ok(nos.status === 401, 'bad signature must be rejected');
    const r = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + sig }, body: raw });
    ok(r.status === 200, 'hook status ' + r.status);
    let out = null;
    for (let i = 0; i < 10 && !out; i++) { await sleep(1000); out = q1(`select l.* from wa_log l join customers c on c.id=l.customer_id where c.business_id='${TB.id}' and c.wa_id='${wa}' and l.direction='out' order by l.id desc limit 1`); }
    ok(out && out.kind === 'buttons' && out.status === 'dry_run', 'bot reply (dry_run): ' + JSON.stringify(out).slice(0, 160));
    ok(q1(`select count(*)::int n from wa_log where wa_msg_id='${wamid}' and direction='in'`).n === 1, 'inbound logged once');
    await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + sig }, body: raw });
    await sleep(2500);
    ok(q1(`select count(*)::int n from wa_log where wa_msg_id='${wamid}' and direction='in'`).n === 1, 'duplicate webhook ignored');
    // حالة رسالة صادرة
    const outId = q1(`select id from wa_log where direction='out' and status='dry_run' and customer_id=(select id from customers where business_id='${TB.id}' and wa_id='${wa}') order by id desc limit 1`).id;
    sql(`update wa_log set wa_msg_id='wamid.OUT${outId}', status='sent' where id=${outId}`);
    const st = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: pnid }, statuses: [{ id: `wamid.OUT${outId}`, status: 'read', recipient_id: wa }] } }] }] });
    await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', appSecret).update(st).digest('hex') }, body: st });
    await sleep(2500);
    ok(q1(`select status from wa_log where id=${outId}`).status === 'read', 'status update');
    // المالك رد من تطبيق واتساب بزنس (Coexistence) ← البوت يوقف عن هذا العميل
    const echo = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'smb_message_echoes', value: { metadata: { phone_number_id: pnid }, message_echoes: [{ from: '966500000000', to: wa, id: 'wamid.ECHO' + rid(), type: 'text', text: { body: 'أهلين، أبشر' } }] } }] }] });
    await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', appSecret).update(echo).digest('hex') }, body: echo });
    await sleep(2500);
    ok(q1(`select bot_paused, paused_reason from customers where business_id='${TB.id}' and wa_id='${wa}'`).paused_reason === 'owner_replied', 'echo pauses bot');
  } finally {
    sql(`update channels set provider='none', phone_number_id=null, status='not_connected', dry_run=false, templates='[]'::jsonb where business_id='${TB.id}';
         update business_secrets set wa_token='', wa_app_secret='' where business_id='${TB.id}'`);
  }
});
await t('قوالب ميتا: بدون ربط الرقم يرجع خطأ واضح', async () => {
  const r = await api(A.jwt, 'admin/templates/create', { business_id: TB.id });
  ok(!r.ok && r.error === 'not_connected', JSON.stringify(r));
});
await t('ميسر: مفتاح غير صحيح يُرفض بدون أي عملية دفع', async () => {
  const r = await api(OM.jwt, 'biz/payment-keys', { business_id: M.id, sk: 'sk_test_' + 'x'.repeat(24), pk: '' });
  ok(!r.ok && r.error === 'sk_rejected', JSON.stringify(r));
  const r2 = await api(OT.jwt, 'biz/payment-keys', { business_id: M.id, sk: 'sk_test_' + 'x'.repeat(24) });
  ok(!r2.ok && r2.error === 'forbidden', 'other owner blocked');
});

// ── لكل المجالات: في المحل، أونلاين، الدفع قبل الحجز، الأسئلة الخاصة، أسلوب الردود، تخصيص المحاكي ──
const SAL = BIZ.salon, CLI = BIZ.clinic, CON = BIZ.consult, RES = BIZ.resto;
await t('تصفير تجارب المجالات', async () => {
  for (const b of [SAL, CLI, CON, RES]) { const r = await api(A.jwt, 'admin/demo/reset', { business_id: b.id }); ok(r.ok, b.slug); }
});
let salOrder, salTok;
await t('صالون (في المحل + دفع قبل): الموعد ينحجز برابط دفع، والدفع يأكده', async () => {
  const c = simCustomer(SAL);
  await c.text('السلام عليكم');
  let r = await c.reply('m:book');
  const svc = rowsOf(last(r.outs)); ok(svc.length === 3, 'services');
  r = await c.reply(svc[0].id, svc[0].title);
  ok(last(r.outs).kind === 'list' && rowsOf(last(r.outs))[0].id.startsWith('day:'), 'shop mode skips location (1 branch)');
  const d = rowsOf(last(r.outs))[1]; r = await c.reply(d.id, d.title);
  const sl = slotRows(last(r.outs))[0]; r = await c.reply(sl.id, sl.title);
  const cta = last(r.outs);
  ok(cta.kind === 'cta' && /ادفع 60 ريال لتأكيد حجزك/.test(cta.preview) && /فرع الخبر/.test(cta.preview), 'pay to confirm: ' + cta.preview);
  salTok = cta.body.url.split('/pay/go/')[1];
  salOrder = q1(`select * from orders where customer_id='${customerId(SAL, c.from)}' order by created_at desc limit 1`);
  ok(salOrder.status === 'pending_payment' && salOrder.hold_until, 'pending with hold');
  // الموعد محجوز: نفس الوقت يقل منه مكان (سعة 3)
  const pay = await (await fetch(`${FN}/pay/demo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: salTok, method: 'mada' }) })).json();
  ok(pay.ok, 'demo pay');
  const o = q1(`select status, prepaid, paid_at from orders where id='${salOrder.id}'`);
  ok(o.status === 'confirmed' && o.prepaid && o.paid_at, 'confirmed after pay: ' + JSON.stringify(o));
  const msgs = (await c.poll()).filter((m) => m.direction === 'out');
  ok(msgs.some((m) => /وصلنا دفعك وتأكد حجزك/.test(m.preview) && /رقم الطلب: \d+/.test(m.preview)), 'prepaid confirmation');
});
await t('مهلة الدفع: الحجز اللي ما انطفع ينفك ويوصل العميل خبر', async () => {
  const c = simCustomer(SAL);
  await c.text('هلا');
  let r = await c.reply('m:book');
  r = await c.reply(rowsOf(last(r.outs))[1].id);
  const d = rowsOf(last(r.outs))[2]; r = await c.reply(d.id, d.title);
  const sl = slotRows(last(r.outs))[1]; r = await c.reply(sl.id, sl.title);
  ok(last(r.outs).kind === 'cta', 'cta');
  const o = q1(`select id from orders where customer_id='${customerId(SAL, c.from)}' order by created_at desc limit 1`);
  sql(`update orders set hold_until = now() - interval '1 minute' where id='${o.id}'`);
  const cr = await cron();
  const x = q1(`select status, cancel_reason from orders where id='${o.id}'`);
  // المهمة المجدولة (كل دقيقة) ممكن تسبق الاستدعاء اليدوي وتلغيه قبله، والنتيجة نفسها
  ok(cr.expired >= 1 || (x.status === 'cancelled' && x.cancel_reason === 'unpaid'), 'expired ' + JSON.stringify(cr));
  ok(x.status === 'cancelled' && x.cancel_reason === 'unpaid', 'cancelled unpaid');
  ok(q1(`select count(*)::int n from invoices where order_id='${o.id}' and status='void'`).n === 1, 'invoice void');
  const msgs = (await c.poll()).filter((m) => m.direction === 'out');
  ok(msgs.some((m) => /انتهت مهلة الدفع/.test(m.preview)), 'expiry message');
});
await t('عيادة (فرعين + رسمي): يجاوب أي سؤال ويختار الفرع', async () => {
  const c = simCustomer(CLI);
  let r = await c.text('السلام عليكم');
  ok(/مرحبًا بكم في عيادتك/.test(last(r.outs).preview), 'formal welcome');
  r = await c.text('تقبلون التأمين؟');
  ok(/شركات التأمين/.test(last(r.outs).preview), 'faq insurance');
  r = await c.text('وين موقعكم؟');
  ok(/فرع الملقا/.test(last(r.outs).preview) && /maps\.google\.com/.test(last(r.outs).preview), 'branches with maps');
  r = await c.text('كيف الدفع؟');
  ok(/نقدًا أو بالبطاقة/.test(last(r.outs).preview), 'payment info');
  r = await c.text('متى تفتحون؟');
  ok(/الأحد/.test(last(r.outs).preview), 'hours');
  r = await c.text('كم السعر؟');
  ok(/كشف عام: 150 ريال/.test(last(r.outs).preview), 'prices');
  r = await c.reply('m:book');
  r = await c.reply(rowsOf(last(r.outs))[0].id);
  const br = rowsOf(last(r.outs));
  ok(br.length === 2 && br[0].id.startsWith('br:'), 'branch list');
  r = await c.reply(br[1].id, br[1].title);
  const d = rowsOf(last(r.outs))[0]; r = await c.reply(d.id, d.title);
  const sl = slotRows(last(r.outs))[0]; r = await c.reply(sl.id, sl.title);
  ok(/تم تأكيد طلبكم/.test(last(r.outs).preview) && /فرع الحمراء/.test(last(r.outs).preview), 'confirmed at branch');
});
await t('استشارة أونلاين: بدون مكان، ورابط الجلسة في التأكيد', async () => {
  const c = simCustomer(CON);
  await c.text('هلا');
  let r = await c.reply('m:book');
  r = await c.reply(rowsOf(last(r.outs))[0].id);
  ok(rowsOf(last(r.outs))[0].id.startsWith('day:'), 'online goes straight to days');
  const d = rowsOf(last(r.outs))[1]; r = await c.reply(d.id, d.title);
  const sl = slotRows(last(r.outs))[0]; r = await c.reply(sl.id, sl.title);
  ok(last(r.outs).kind === 'cta' && /قوقل ميت/.test(last(r.outs).preview), 'online prepay');
});
await t('مطعم: حجز طاولة بدون دفع وبدون سطر سعر', async () => {
  const c = simCustomer(RES);
  await c.text('هلا');
  let r = await c.text('وين المنيو؟');
  ok(/المنيو/.test(last(r.outs).preview), 'menu faq');
  r = await c.reply('m:book');
  r = await c.reply(rowsOf(last(r.outs))[1].id);
  const d = rowsOf(last(r.outs))[1]; r = await c.reply(d.id, d.title);
  const sl = slotRows(last(r.outs))[3]; r = await c.reply(sl.id, sl.title);
  const conf = last(r.outs).preview;
  ok(/تم تأكيد طلبك/.test(conf) && !/السعر يتحدد/.test(conf) && /فرع جدة/.test(conf), 'table confirmed: ' + conf);
});
await t('تخصيص المحاكي: اسم نشاطك وأسلوب الردود والمكان والدفع', async () => {
  const c = simCustomer(M);
  const cfg = await (await fetch(`${FN}/wa/sim/config`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ b: M.slug, k: M.sim_key, from: c.from, cfg: { name: 'مغسلة النور', place: 'online', pay: 'before', tone: 'short', welcome: 'يا هلا في مغسلة النور 🚗' } }) })).json();
  ok(cfg.ok && cfg.cfg.tone === 'short', 'config saved');
  let r = await c.text('السلام عليكم');
  ok(/يا هلا في مغسلة النور/.test(last(r.outs).preview), 'custom welcome');
  r = await c.reply('m:book');
  ok(rowsOf(last(r.outs))[0]?.id.startsWith('day:'), 'online override');
  const d = rowsOf(last(r.outs))[1]; r = await c.reply(d.id, d.title);
  const sl = slotRows(last(r.outs))[0]; r = await c.reply(sl.id, sl.title);
  ok(/ادفع 50 ريال لتأكيد حجزك/.test(last(r.outs).preview), 'prepay override with deposit');
  ok(q1(`select name from businesses where id='${M.id}'`).name === 'محلك', 'real business untouched');
});
await t('صفحات العميل: قبول الاتفاقية ونموذج البيانات وتطبيقه على المنشأة بضغطة', async () => {
  const k = TB.client_key;
  const info = await (await fetch(`${FN}/api/client/info`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k }) })).json();
  ok(info.ok && info.business.name === 'منشأة اختبار' && Number(info.fees.setup_fee) === 3500, 'client info');
  const bad = await (await fetch(`${FN}/api/client/agree`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k, name: 'ص', phone: '0500000000', accept: true }) })).json();
  ok(!bad.ok, 'name validated');
  const ag = await (await fetch(`${FN}/api/client/agree`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k, name: 'صاحب المنشأة', phone: '0500000000', accept: true }) })).json();
  ok(ag.ok && ag.agreed, 'agreed');
  const data = { name: 'منشأة اختبار', activity: 'اختبار', place_mode: 'visit', pay_timing: 'after', services: [{ name: 'غسيل', price: 55 }, { name: 'تلميع', price: 120 }, { name: 'تعقيم', price: 70 }],
    cities: [{ name: 'الرياض', lat: 24.7136, lng: 46.6753, radius_km: 40 }], hours: [0, 1, 2, 3, 4, 6].map((w) => ({ weekday: w, open: '09:00', close: '21:00' })), staff: [{ name: 'فني الفحص', phone: '0500000003', cities: ['الرياض'] }] };
  const it = await (await fetch(`${FN}/api/client/intake`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k, data }) })).json();
  ok(it.ok && it.saved, 'intake ' + JSON.stringify(it));
  const ap = await rest(A.jwt, 'rpc/ihj_apply_intake', { method: 'POST', body: JSON.stringify({ p_business: TB.id }) });
  ok(ap.status === 200, 'apply ' + JSON.stringify(ap.json));
  ok(Number(q1(`select price from services where business_id='${TB.id}' and name='غسيل'`).price) === 55, 'service price updated');
  ok(q1(`select count(*)::int n from services where business_id='${TB.id}' and active`).n === 3, 'services count');
  ok(q1(`select count(*)::int n from staff where business_id='${TB.id}' and name='فني الفحص'`).n === 1, 'staff added');
  const wrong = await (await fetch(`${FN}/api/client/info`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: '0'.repeat(24) }) })).json();
  ok(!wrong.ok, 'wrong key');
  // رجّع منشأة الاختبار مثل ما كانت
  sql(`update services set active = (name in ('غسيل','تلميع')), price = case name when 'غسيل' then 50 when 'تلميع' then 120 else price end where business_id='${TB.id}';
       delete from staff where business_id='${TB.id}' and name='فني الفحص'; delete from client_docs where business_id='${TB.id}';
       delete from hours where business_id='${TB.id}'; insert into hours (business_id, weekday, open_time, close_time) select '${TB.id}', d, case when d = 5 then time '16:00' else time '09:00' end, time '21:00' from generate_series(0,6) d;`);
});

// ── الموقع ولوحتي ──
let leadId, newBiz;
await t('نموذج الاشتراك في الموقع يحفظ الطلب في مشروع احجزلي', async () => {
  const phone = '05' + String(Math.floor(10000000 + Math.random() * 89999999));
  const r = await (await fetch(`${FN}/lead`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ business_name: 'فحص آلي للنموذج', phone, activity: 'مغسلة سيارات', city: 'الرياض', package: 'bot_pay', source: 'e2e' }) })).json();
  ok(r.ok && r.id, JSON.stringify(r));
  leadId = r.id;
  const hp = await (await fetch(`${FN}/lead`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ business_name: 'بوت', phone, website: 'x' }) })).json();
  ok(hp.ok && !hp.id, 'honeypot');
  const bad = await fetch(`${FN}/lead`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ business_name: 'x y', phone: '123' }) });
  ok(bad.status === 400, 'bad phone');
  ok((await rest(A.jwt, `signup_requests?select=id&id=eq.${leadId}`)).json?.length === 1, 'admin sees lead');
  ok((await rest(OM.jwt, `signup_requests?select=id`)).json?.length === 0, 'owner cannot see leads');
});
await t('تحويل طلب الاشتراك لمنشأة بضغطة، ومحاكيها يشتغل فورًا', async () => {
  const r = await api(A.jwt, 'admin/business/create', { name: 'فحص آلي للنموذج', name_en: 'E2E Wash', plan: 'bot_pay', lead_id: leadId, is_demo: true,
    services: [{ name: 'غسيل خارجي', price: 40 }], cities: [{ name: 'الرياض', lat: 24.7136, lng: 46.6753, radius_km: 40 }], staff: [{ name: 'فني فحص', cities: ['الرياض'] }] });
  ok(r.ok && r.owner_url && r.sim_url, JSON.stringify(r).slice(0, 200));
  newBiz = r.business;
  ok(q1(`select business_id, status from signup_requests where id='${leadId}'`).business_id === newBiz.id, 'lead linked');
  const fees = q1(`select setup_fee, monthly_fee from subscriptions where business_id='${newBiz.id}'`);
  ok(Number(fees.setup_fee) === 5500 && Number(fees.monthly_fee) === 600, 'plan fees');
  const c = simCustomer({ slug: newBiz.slug, sim_key: newBiz.sim_key });
  const w = await c.text('السلام عليكم');
  ok(/فحص آلي للنموذج/.test(last(w.outs).preview), 'new biz welcome');
  const b = await bookVia(c, 24.72, 46.68, 1, 0);
  ok(b.no === 1001, 'first order number 1001, got ' + b.no);
  const own = await sessionFor(r.owner_url.split('#k=')[1]);
  ok((await rest(own.jwt, `orders?select=number`)).json?.length === 1, 'new owner sees own order');
});
await t('التقرير الشهري يرجع الأرقام', async () => {
  const r = await api(OM.jwt, 'biz/report', { business_id: M.id, month: new Date().toISOString().slice(0, 7) });
  ok(r.ok && typeof r.report.orders === 'number' && Array.isArray(r.report.by_staff), JSON.stringify(r).slice(0, 200));
});
await t('تنظيف بيانات الفحص (الطلب والمنشأة المؤقتة)', async () => {
  if (newBiz) { for (const l of (await api(A.jwt, 'admin/link/list', { business_id: newBiz.id })).links || []) await api(A.jwt, 'admin/link/revoke', { link_id: l.id }); }
  if (newBiz) ok((await rest(A.jwt, `businesses?id=eq.${newBiz.id}`, { method: 'DELETE' })).status < 300, 'delete biz');
  if (leadId) ok((await rest(A.jwt, `signup_requests?id=eq.${leadId}`, { method: 'DELETE' })).status < 300, 'delete lead');
});

const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} نجحت`);
fs.mkdirSync('tests/out', { recursive: true });
fs.writeFileSync('tests/out/e2e-results.json', JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 1));
process.exit(pass === results.length ? 0 : 1);
