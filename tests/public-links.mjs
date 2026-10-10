// فحص الروابط العامة (بدون مفتاح منشأة): الاتفاقية والنموذج ينحفظون على طلب اشتراك بجوال العميل،
// ولما يتحوّل الطلب لمنشأة تنتقل الموافقة والبيانات لها تلقائيًا. جوال وهمي للفحص، وينحذف في النهاية.
import fs from 'node:fs';
import { sessionFor, api } from './link-check.mjs';
import { sql } from '../tools/sql.mjs';
const P = JSON.parse(fs.readFileSync(new URL('../.secrets/project.json', import.meta.url)));
const FN = `${P.url}/functions/v1`;
const PHONE = '0599000001';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('✓ ' + name); } else { fail++; console.log('✗ ' + name + (extra ? ' · ' + extra : '')); } };
const client = (path, body) => fetch(`${FN}/api/client/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
sql(`delete from businesses where slug like 'pl-test%'`);
sql(`delete from signup_requests where phone = '966599000001'`);
try {
  const t = await client('terms', {});
  ok(t.ok && t.fees.bot.setup_fee === 3500 && t.fees.bot_pay.monthly_fee === 600 && t.fees.app.setup_fee === 9000, 'أسعار الباقات للاتفاقية العامة', JSON.stringify(t).slice(0, 120));
  // الموافقة العامة بدون طلب سابق: ينشأ طلب اشتراك
  const a = await client('agree-new', { business_name: 'منشأة فحص الروابط', name: 'فحص آلي', phone: PHONE, package: 'bot_pay', wants_app: false, accept: true });
  ok(a.ok && a.agreed, 'الموافقة من الرابط العام تنحفظ', JSON.stringify(a).slice(0, 120));
  let lead = sql(`select id, status, package, agreed_name, agreed_at, business_name from signup_requests where phone = '966599000001'`);
  ok(lead.length === 1 && lead[0].status === 'agreed' && lead[0].package === 'bot_pay' && lead[0].agreed_name === 'فحص آلي', 'انشأ طلب اشتراك بحالة «اتفقنا» وبالباقة المختارة', JSON.stringify(lead));
  const bad = await client('agree-new', { business_name: 'x', name: 'ف', phone: '123', accept: true });
  ok(!bad.ok, 'بيانات ناقصة ترفض');
  const bot = await client('agree-new', { business_name: 'بوت', name: 'بوت بوت', phone: '0599000002', accept: true, website: 'spam' });
  ok(bot.ok && !sql(`select 1 from signup_requests where phone = '966599000002'`).length, 'فخ البوتات ما يحفظ شي');
  // النموذج العام بنفس الجوال: ينضاف لنفس الطلب
  const i = await client('intake-new', { data: { name: 'منشأة فحص الروابط', owner_name: 'فحص آلي', owner_phone: PHONE, activity: 'صالون', place_mode: 'shop', pay_timing: 'before',
    services: [{ name: 'قص', price: 50 }], cities: [{ name: 'فرع الفحص', maps: 'https://maps.google.com/?q=24.7,46.7' }], hours: [{ weekday: 0, open: '10:00', close: '22:00' }] } });
  ok(i.ok && i.saved, 'النموذج العام ينحفظ', JSON.stringify(i).slice(0, 160));
  lead = sql(`select id, intake_at, intake->'services' as services, activity from signup_requests where phone = '966599000001'`);
  ok(lead.length === 1 && lead[0].intake_at && lead[0].services.length === 1 && lead[0].activity === 'صالون', 'انحفظ على نفس الطلب (بدون تكرار) مع المجال', JSON.stringify(lead).slice(0, 200));
  // التحويل لمنشأة: الموافقة والبيانات تنتقل
  const adminTok = fs.readFileSync(new URL('../.secrets/admin-link.txt', import.meta.url), 'utf8').trim().split('#k=')[1];
  const s = await sessionFor(adminTok);
  const r = await api(s.jwt, 'admin/business/create', { name: 'منشأة فحص الروابط', slug: 'pl-test', plan: 'bot_pay', lead_id: lead[0].id, owner_phone: PHONE, is_demo: true, services: [{ name: 'زيارة', price: null }] });
  ok(r.ok && r.business, 'تحويل الطلب لمنشأة', JSON.stringify(r).slice(0, 120));
  const docs = sql(`select agreed_at, agreed_name, intake_at, intake->>'name' as nm from client_docs where business_id = '${r.business.id}'`);
  ok(docs.length === 1 && docs[0].agreed_at && docs[0].agreed_name === 'فحص آلي' && docs[0].intake_at && docs[0].nm === 'منشأة فحص الروابط', 'الموافقة والبيانات انتقلت للمنشأة تلقائيًا', JSON.stringify(docs));
  // بعد ما صار منشأة: الرابط العام بنفس الجوال يحدّث منشأته
  const i2 = await client('intake-new', { data: { name: 'منشأة فحص الروابط', owner_phone: PHONE, services: [{ name: 'قص', price: 55 }, { name: 'صبغة', price: 150 }] } });
  const d2 = sql(`select jsonb_array_length(intake->'services') n from client_docs where business_id = '${r.business.id}'`)[0];
  ok(i2.ok && d2.n === 2, 'إعادة الإرسال من الرابط العام بعد التحويل تحدّث بيانات المنشأة', JSON.stringify(d2));
  const apply = await fetch(`${P.url}/rest/v1/rpc/ihj_apply_intake`, { method: 'POST', headers: { apikey: P.anon, authorization: `Bearer ${s.jwt}`, 'content-type': 'application/json' }, body: JSON.stringify({ p_business: r.business.id }) }).then((x) => x.json());
  const sv = sql(`select name, price from services where business_id = '${r.business.id}' and active order by sort`);
  ok(apply && apply.ok === true && sv.length === 2 && Number(sv[1].price) === 150, '«طبّق بياناته» يشتغل على البيانات اللي جات من الرابط العام', JSON.stringify(sv));
} finally {
  sql(`delete from businesses where slug like 'pl-test%'`);
  sql(`delete from signup_requests where phone in ('966599000001','966599000002')`);
  ok(!sql(`select 1 from signup_requests where phone = '966599000001'`).length, 'تنظيف بيانات الفحص');
}
console.log(`\n${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
