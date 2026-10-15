// فحص الربط المباشر (زر «اربط واتسابك») بدون تطبيق ميتا حقيقي، وصفحة الخصوصية وطلباتها.
// ما يرسل أي واتساب: أحداث ويبهوك موقّعة بسر مؤقت على «منشأة اختبار» (غير مربوطة) وكل شي يرجع مثل ما كان.
// لو سر تطبيق ميتا الحقيقي محفوظ، يتخطى فحوص التوقيع (ما نقرا السر).
import fs from 'node:fs';
import crypto from 'node:crypto';
import { launch, sleep } from '../tools/cdp.mjs';
import { sessionFor, api } from './link-check.mjs';
import { sql } from '../tools/sql.mjs';
const P = JSON.parse(fs.readFileSync(new URL('../.secrets/project.json', import.meta.url)));
const FN = `${P.url}/functions/v1`;
const OUT = process.argv[2] || '';
const adminTok = fs.readFileSync(new URL('../.secrets/admin-link.txt', import.meta.url), 'utf8').trim().split('#k=')[1];
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('✓ ' + name); } else { fail++; console.log('✗ ' + name + (extra ? ' · ' + extra : '')); } };
const client = (path, body) => fetch(`${FN}/api/client/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => ({})) }));
const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";

const a = await sessionFor(adminTok);
const k = sql(`select client_key from businesses where slug = 'soclean'`)[0].client_key;
const tb = sql(`select b.id, c.waba_id, c.status, c.last_error, c.templates::text tpl from businesses b join channels c on c.business_id = b.id where b.slug = 'test-b'`)[0];
const hadSecret = sql(`select count(*)::int n from ihj_secrets where key = 'meta_app_secret'`)[0].n > 0;
const TMP = crypto.randomBytes(16).toString('hex'), WABA = '990' + String(Date.now()).slice(-9);
const errs = [];
try {
  // 1) إعدادات التطبيق من لوحتي
  const info = await api(a.jwt, 'admin/meta-app', {});
  ok(/^[0-9a-f]{32}$/.test(info.verify_token || '') && /\/wa\/hook$/.test(info.webhook_url) && info.fields.includes('account_update') && /privacy\.html$/.test(info.privacy_url), 'لوحتي: رابط الويبهوك ورمز التحقق والحقول وروابط الخصوصية', JSON.stringify(info).slice(0, 160));
  ok(hadSecret || info.ready === false, 'بدون تطبيق: «ينتظر تطبيق ميتا»');
  const e1 = (await api(a.jwt, 'admin/meta-app', { app_id: 'abc' })).error || '';
  ok(/app_id/.test(e1), 'App ID غلط ينرفض', e1);
  const e2 = (await api(a.jwt, 'admin/meta-app', { app_id: '1234567890123', app_secret: TMP })).error || '';
  ok(/app_rejected/.test(e2), 'سر وهمي: ميتا ترفضه وما ينحفظ', e2);
  ok(sql(`select count(*)::int n from ihj_config where key = 'meta_es' and value->>'app_id' = '1234567890123'`)[0].n === 0, 'ما انحفظ شي من المحاولة الغلط');

  // 2) صفحة الربط للمحل برابط منشأته
  const es = await client('wa-es', { k });
  ok(es.status === 200 && es.j.business?.name && (hadSecret || (es.j.ready === false && es.j.app_id === '')), 'wa-es: اسم المنشأة والحالة', JSON.stringify(es.j).slice(0, 140));
  const bad = await client('wa-es', { k: '0'.repeat(24) });
  ok(bad.status === 404, 'رابط منشأة غلط = 404');
  if (!hadSecret) { const c = await client('wa-connect', { k, code: 'x'.repeat(40) }); ok(c.status === 409 && c.j.error === 'no_meta', 'wa-connect بدون تطبيق = no_meta', JSON.stringify(c)); }

  // 3) الويبهوك المشترك: التحقق، والتوقيع، وأحداث الحساب والقوالب
  if (!hadSecret) {
    sql(`insert into ihj_secrets (key, value) values ('meta_app_secret', ${q(TMP)})`);
    sql(`update channels set waba_id = '${WABA}' where business_id = '${tb.id}'`);
    const chal = 'c' + Date.now();
    const g = await fetch(`${FN}/wa/hook?hub.mode=subscribe&hub.verify_token=${info.verify_token}&hub.challenge=${chal}`);
    ok(g.status === 200 && (await g.text()) === chal, 'تحقق ميتا من الويبهوك (GET) يرجّع التحدي');
    const g2 = await fetch(`${FN}/wa/hook?hub.mode=subscribe&hub.verify_token=wrong-token-123456&hub.challenge=x`);
    ok(g2.status === 403, 'رمز تحقق غلط = 403');
    const send = (obj, secret = TMP) => { const raw = JSON.stringify(obj); const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex'); return fetch(`${FN}/wa/hook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body: raw }); };
    const tpl = { object: 'whatsapp_business_account', entry: [{ id: WABA, time: 1, changes: [{ field: 'message_template_status_update', value: { event: 'APPROVED', message_template_id: 1, message_template_name: 'ihj_reminder', message_template_language: 'ar' } }] }] };
    const r1 = await send(tpl);
    ok(r1.status === 200, 'حدث موقّع ينقبل', String(r1.status));
    const r0 = await send(tpl, 'f'.repeat(32));
    ok(r0.status === 401, 'توقيع غلط = 401', String(r0.status));
    const r00 = await fetch(`${FN}/wa/hook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    ok(r00.status === 401, 'بدون توقيع = 401', String(r00.status));
    await sleep(2500);
    const t1 = JSON.parse(sql(`select templates::text t from channels where business_id = '${tb.id}'`)[0].t || '[]');
    ok(t1.some((t) => t.name === 'ihj_reminder' && t.language === 'ar' && t.status === 'APPROVED'), 'اعتماد قالب يتحدث لحاله من الويبهوك', JSON.stringify(t1).slice(0, 120));
    await send({ object: 'whatsapp_business_account', entry: [{ id: WABA, time: 2, changes: [{ field: 'account_update', value: { event: 'DISABLED_UPDATE', ban_info: { waba_ban_state: ['SCHEDULE_FOR_DISABLE'] } } }] }] });
    await sleep(2500);
    const c0 = sql(`select status, last_error from channels where business_id = '${tb.id}'`)[0];
    ok(c0.status === tb.status && /إنذار/.test(c0.last_error), 'إنذار الإيقاف ما يوقف الربط', JSON.stringify(c0));
    await send({ object: 'whatsapp_business_account', entry: [{ id: WABA, time: 2, changes: [{ field: 'account_update', value: { event: 'PARTNER_APP_UNINSTALLED', waba_info: { waba_id: WABA } } }] }] });
    await sleep(2500);
    const c1 = sql(`select status, last_error from channels where business_id = '${tb.id}'`)[0];
    ok(c1.status === 'error' && /PARTNER_APP_UNINSTALLED/.test(c1.last_error), 'فصل التطبيق من جهة المحل يبان خطأ', JSON.stringify(c1));
    const r3 = await send({ object: 'whatsapp_business_account', entry: [{ id: '1' + WABA, time: 3, changes: [{ field: 'history', value: { history: [] } }] }] });
    ok(r3.status === 200, 'حدث history لحساب غير معروف ينستلم بهدوء');
  } else console.log('(سر التطبيق الحقيقي محفوظ، تخطيت فحوص التوقيع)');

  // 4) طلبات الخصوصية
  const ph = '0599000071';
  const d1 = await client('data-request', { name: 'فحص الخصوصية', phone: ph, kind: 'delete', business: 'نشاط فحص', note: 'فحص آلي' });
  const row = sql(`select id, kind, phone from data_requests where name = 'فحص الخصوصية'`)[0];
  ok(d1.j.ok && row && row.kind === 'delete' && row.phone === '966599000071', 'طلب حذف بيانات ينحفظ للمدير', JSON.stringify(d1.j));
  await client('data-request', { name: 'فحص الخصوصية', phone: ph, kind: 'delete' });
  ok(sql("select count(*)::int n from data_requests where name = 'فحص الخصوصية'")[0].n === 1, 'نفس الطلب مرتين ينحفظ مرة وحدة');
  const d2 = await client('data-request', { name: 'فحص الخصوصية', phone: '12', kind: 'delete' });
  ok(d2.j.error === 'phone', 'جوال غلط ينرفض');
  await client('data-request', { name: 'فحص فخ', phone: ph, website: 'spam' });
  ok(sql(`select count(*)::int n from data_requests where name = 'فحص فخ'`)[0].n === 0, 'الفخ (honeypot) ما ينحفظ');
  const anon = await fetch(`${P.url}/rest/v1/data_requests?select=id`, { headers: { apikey: P.anon, authorization: 'Bearer ' + P.anon } }).then((r) => r.json()).catch(() => null);
  ok(!Array.isArray(anon) || anon.length === 0, 'طلبات الخصوصية ما تنقرا بالمفتاح العام');

  // 5) الصفحات
  for (const [w, h, tag, m] of [[1280, 860, 'desk', false], [390, 844, 'mob', true]]) {
    const b = await launch({ width: w, height: h, scale: 1, mobile: m });
    try {
      await b.go(`http://localhost:5610/connect.html?k=${k}`, 900); await b.waitFor(`!document.querySelector('#box .load')`, 15000);
      const c = await b.ev(`({ t: document.getElementById('box').innerText, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })`);
      ok(/اربط واتساب نشاطك|مربوط/.test(c.t) && c.sw <= c.cw, `${tag}: صفحة الربط تفتح بدون تمدد`, c.t.slice(0, 80));
      if (OUT) await b.shot(`${OUT}/${tag}-connect.png`);
      await b.go('http://localhost:5610/privacy.html', 900); await sleep(500);
      const p = await b.ev(`({ h: document.querySelector('h1').textContent, en: !!document.getElementById('en'), del: !!document.getElementById('delete'), form: !!document.getElementById('dr'), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })`);
      ok(p.h === 'سياسة الخصوصية' && p.en && p.del && p.form && p.sw <= p.cw, `${tag}: صفحة الخصوصية (عربي + English + حذف البيانات)`);
      if (OUT) await b.shot(`${OUT}/${tag}-privacy.png`);
      await b.go(`http://localhost:5610/admin.html#k=${adminTok}`, 500); await b.waitFor('window.__admin', 25000);
      await b.waitFor(`!!document.querySelector('#metaCard #mtForm')`, 20000);
      const ad = await b.ev(`({ badge: document.querySelector('#metaCard .badge').textContent, cps: document.querySelectorAll('#metaCard [data-cp]').length, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })`);
      ok(ad.cps >= 6 && ad.sw <= ad.cw, `${tag}: لوحتي فيها بطاقة الربط المباشر`, JSON.stringify(ad));
      if (OUT) { await b.ev(`document.querySelector('#metaCard details').open = true; document.getElementById('metaCard').scrollIntoView({ block: 'start' })`); await sleep(400); await b.shot(`${OUT}/${tag}-admin-meta.png`); }
      for (const l of b.log) if (l.type === 'error' || l.type === 'exception') errs.push(`${tag}: ${l.text}`);
    } finally { await b.close(); }
  }
  const real = errs.filter((e) => !/favicon|ERR_BLOCKED|fonts\.g/.test(e));
  ok(!real.length, 'بدون أخطاء في الصفحات', real.slice(0, 3).join(' | '));
} finally {
  if (!hadSecret) sql(`delete from ihj_secrets where key = 'meta_app_secret' and value = ${q(TMP)}`);
  sql(`update channels set waba_id = ${q(tb.waba_id)}, status = ${q(tb.status)}, last_error = ${q(tb.last_error)}, templates = ${q(tb.tpl)}::jsonb where business_id = '${tb.id}'`);
  sql(`delete from data_requests where name in ('فحص الخصوصية', 'فحص فخ')`);
}
console.log(`\n${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
