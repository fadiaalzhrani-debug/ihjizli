// فحص دفع الاشتراكات بالبطاقة بدون مفاتيح ميسر (ما ينرسل شي ولا تنخصم فلوس):
// الرابط العام بدون بطاقة، المستحق، no_card، رابط غلط، الأسرار مقفولة، والتسجيل الذري مرة وحدة
import fs from 'node:fs';
import { sql } from '../tools/sql.mjs';
const P = JSON.parse(fs.readFileSync(new URL('../.secrets/project.json', import.meta.url), 'utf8'));
const URL0 = 'https://kvreqxdgjeietzsfamei.supabase.co';
const FN = URL0 + '/functions/v1';
const anon = P.anon_key || P.anon || P.ANON_KEY;
let ok = 0, bad = 0;
const t = (name, cond, extra = '') => { if (cond) { ok++; console.log('✓', name); } else { bad++; console.log('✗', name, extra); } };
const post = async (path, body) => { const r = await fetch(`${FN}/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json().catch(() => ({})) }; };

const keys = sql(`select (select count(*) from ihj_secrets)::int n`)[0];
const hasKey = keys.n > 0;
console.log('مفاتيح ميسر محفوظة:', hasKey ? 'إيه' : 'لا');

const terms = await post('client/terms', {});
t('الرابط العام ما يقول فيه بطاقة', terms.status === 200 && !('card' in terms.j) && terms.j.fees, JSON.stringify(terms.j).slice(0, 120));
const spn = await post('client/sub-pay-new', { phone: '0500000000' });
t('sub-pay-new انشال', !spn.j.url, JSON.stringify(spn));

const k = sql(`select client_key from businesses where slug='soclean'`)[0].client_key;
const info = await post('client/info', { k });
const d = info.j.due || {};
t('info يرجّع المستحق', d.kind === 'monthly' && typeof d.due === 'number', JSON.stringify(d));
t('info بدون مفتاح حقيقي: بدون بطاقة', hasKey || info.j.card === false, String(info.j.card));
const sp = await post('client/sub-pay', { k });
t('sub-pay بدون مفتاح = no_card', hasKey || (sp.status === 409 && sp.j.error === 'no_card'), JSON.stringify(sp));

const r1 = await fetch(`${FN}/pay/sub/${'0'.repeat(32)}`, { redirect: 'manual' });
t('رابط غلط يروح لصفحة الشكر', r1.status === 302 && /thanks\.html\?e=1/.test(r1.headers.get('location') || ''), r1.headers.get('location'));

if (anon) {
  const s1 = await fetch(`${URL0}/rest/v1/ihj_secrets?select=*`, { headers: { apikey: anon, authorization: 'Bearer ' + anon } });
  const b1 = await s1.json().catch(() => null);
  t('الأسرار ما تنقرا بالمفتاح العام', !Array.isArray(b1) || b1.length === 0, JSON.stringify(b1).slice(0, 80));
  const s2 = await fetch(`${URL0}/rest/v1/sub_invoices?select=id`, { headers: { apikey: anon, authorization: 'Bearer ' + anon } });
  const b2 = await s2.json().catch(() => null);
  t('روابط الدفع ما تنقرا بالمفتاح العام', !Array.isArray(b2) || b2.length === 0);
  const s3 = await fetch(`${URL0}/rest/v1/rpc/ihj_sub_settle`, { method: 'POST', headers: { apikey: anon, authorization: 'Bearer ' + anon, 'content-type': 'application/json' }, body: JSON.stringify({ p_id: '00000000-0000-0000-0000-000000000000', p_method: 'x', p_ref: 'x' }) });
  t('اعتماد الدفعة مقفول على العامة', s3.status >= 400, String(s3.status));
} else console.log('(ما لقيت المفتاح العام، تخطيت فحوص الصلاحيات)');

// التسجيل الذري على منشأة اختبار: صف حقيقي وصف تجربة، بدون ميسر، وكله يرجع مثل ما كان
const biz = sql(`select id from businesses where slug='test-b'`)[0].id;
const before = sql(`select next_renewal::text nr, started_on::text so from subscriptions where business_id='${biz}'`)[0] || {};
const rows = sql(`insert into sub_invoices (business_id, kind, amount, description, test) values
  ('${biz}','monthly',99,'فحص',true), ('${biz}','monthly',99,'فحص',false), ('${biz}','monthly',99,'فحص',false) returning id, test`);
const tid = rows.find((r) => r.test).id, [rid, rid2] = rows.filter((r) => !r.test).map((r) => r.id);
try {
  const a = sql(`select ihj_sub_settle('${tid}','بطاقة','ref1') r`)[0].r;
  t('التجربة تنعلّم بدون دفعة', a.ok && a.test && sql(`select count(*)::int n from sub_payments where sub_invoice_id='${tid}'`)[0].n === 0, JSON.stringify(a));
  const b = sql(`select ihj_sub_settle('${rid}','مدى','ref2') r`)[0].r;
  const c = sql(`select ihj_sub_settle('${rid}','مدى','ref2') r`)[0].r;
  t('الحقيقي ينسجل مرة وحدة', b.ok && !b.already && c.already && sql(`select count(*)::int n from sub_payments where sub_invoice_id='${rid}'`)[0].n === 1, JSON.stringify([b, c]));
  t('الدفعة تلغي الرابط المفتوح الثاني', sql(`select status from sub_invoices where id='${rid2}'`)[0].status === 'void');
  const after = sql(`select next_renewal::text nr from subscriptions where business_id='${biz}'`)[0] || {};
  t('الشهري قبل التشغيل ما يغيّر التجديد', !before.so ? after.nr === before.nr : true, JSON.stringify([before, after]));
} finally {
  sql(`delete from sub_payments where sub_invoice_id in ('${tid}','${rid}','${rid2}'); delete from sub_invoices where id in ('${tid}','${rid}','${rid2}');
       update subscriptions set next_renewal=${before.nr ? `'${before.nr}'` : 'null'} where business_id='${biz}'`);
}
console.log(`\n${ok} نجح · ${bad} فشل`);
process.exit(bad ? 1 : 0);
