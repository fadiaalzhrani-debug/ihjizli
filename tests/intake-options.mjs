// فحص نموذج البيانات بالخيارات الكاملة (start.html): الإضافات لكل خدمة، الباقات، أسئلة قبل الحجز، كم طلب بنفس الوقت، لغة الموظف.
// منشأة مؤقتة تنحذف بالنهاية، وما ينرسل أي واتساب (المنشأة غير مربوطة).
import fs from 'node:fs';
import { launch, sleep } from '../tools/cdp.mjs';
import { sessionFor, api } from './link-check.mjs';
import { sql } from '../tools/sql.mjs';
const P = JSON.parse(fs.readFileSync(new URL('../.secrets/project.json', import.meta.url)));
const FN = `${P.url}/functions/v1`;
const OUT = process.argv[2] || '';
const adminTok = fs.readFileSync(new URL('../.secrets/admin-link.txt', import.meta.url), 'utf8').trim().split('#k=')[1];
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('✓ ' + name); } else { fail++; console.log('✗ ' + name + (extra ? ' · ' + extra : '')); } };
const client = (path, body) => fetch(`${FN}/api/client/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";

sql(`delete from businesses where slug like 'io-test%'`);
const a = await sessionFor(adminTok);
let bid = '';
try {
  const c = await api(a.jwt, 'admin/business/create', { name: 'فحص الخيارات', slug: 'io-test', plan: 'bot_pay', is_demo: false, owner_name: 'صاحب الفحص', services: [{ name: 'غسيل كامل', price: 40 }, { name: 'غسيل خارجي', price: 28 }] });
  bid = c.business?.id;
  ok(!!bid, 'منشأة مؤقتة', JSON.stringify(c).slice(0, 120));
  const s1 = sql(`select id from services where business_id = '${bid}' and name = 'غسيل كامل'`)[0].id;
  sql(`update services set addons = '[{"name":"واكس","name_en":"Wax","price":7.99,"group":""},{"name":"تكييس دعاستين","name_en":"2 mats","price":4.25,"group":"mats"}]'::jsonb where id = '${s1}';
       insert into packages (business_id, name, uses, price, note, service_ids, sort) values ('${bid}', 'باقة 4', 4, 140, 'بدون انتهاء', array['${s1}']::uuid[], 0), ('${bid}', 'باقة قديمة', 2, 60, '', '{}', 1);
       update settings set ask = '[{"q":"وش رقم اللوحة؟","hint":"أ ب ج 1234","q_en":"Plate number?","hint_en":"ABC 1234","svc":[]}]'::jsonb, capacity_mode = 'fixed', capacity_per_slot = 3 where business_id = '${bid}';
       insert into staff (business_id, name, phone, lang) values ('${bid}', 'رامي', '966500000071', 'ar');`);
  const k = sql(`select client_key from businesses where id = '${bid}'`)[0].client_key;

  // 1) النموذج يبدأ من الإعدادات الحالية
  const info = await client('info', { k });
  const cur = info.current || {};
  const sv = (cur.services || []).find((x) => x.name === 'غسيل كامل');
  ok(sv && sv.addons.length === 2 && sv.addons[1].group === 'mats', 'الإضافات الحالية توصل للنموذج');
  ok((cur.packages || []).length === 2 && cur.packages[0].svc_name === 'غسيل كامل' && cur.packages[1].svc_name === '', 'الباقات الحالية مع خدمتها', JSON.stringify(cur.packages));
  ok(cur.capacity === 3 && (cur.ask || []).length === 1 && cur.ask[0].q_en === 'Plate number?', 'السعة والأسئلة الحالية');
  ok((cur.staff || [])[0]?.lang === 'ar', 'لغة الموظف الحالية');

  // 2) الصفحة: الخطوات الجديدة معبّاة، وبدون تمدد على الجوال
  const b = await launch({ width: 390, height: 844, scale: 1, mobile: true });
  try {
    await b.go(`http://localhost:5610/start.html?k=${k}`, 900); await b.waitFor('window.__start', 20000);
    await b.ev(`__start.go(2)`); await sleep(400);
    const s2 = await b.ev(`({ svc: document.querySelectorAll('#svcs .svc').length, opts: document.querySelectorAll('#svcs .opts .line').length, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })`);
    ok(s2.svc === 2 && s2.opts === 2 && s2.sw <= s2.cw, 'خطوة الخدمات: الخيارات تحت كل خدمة', JSON.stringify(s2));
    if (OUT) await b.shot(`${OUT}/io-services.png`);
    await b.ev(`__start.go(3)`); await sleep(400);
    const s3 = await b.ev(`({ t: document.getElementById('ttl').textContent, pk: document.querySelectorAll('#pkgs .pkg').length, q: document.querySelectorAll('#asks .line2').length, sel: !!document.querySelector('#pkgs select'), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })`);
    ok(s3.t === 'الباقات والأسئلة' && s3.pk === 2 && s3.q === 1 && s3.sel && s3.sw <= s3.cw, 'خطوة الباقات والأسئلة معبّاة', JSON.stringify(s3));
    if (OUT) await b.shot(`${OUT}/io-extras.png`);
    await b.ev(`__start.go(4)`); await sleep(400);
    ok(await b.ev(`document.getElementById('cap').value === '3'`), 'خطوة الدوام فيها «كم طلب بنفس الوقت»');
    await b.ev(`__start.go(6)`); await sleep(400);
    ok(await b.ev(`!!document.querySelector('#staff select.lang')`), 'الموظف فيه لغة رسائله');
    await b.ev(`__start.go(7)`); await sleep(400);
    const sum = await b.ev(`document.querySelector('.sum').innerText`);
    ok(/الباقات/.test(sum) && /أسئلة قبل الحجز/.test(sum) && /بنفس الوقت/.test(sum), 'الملخص فيه الجديد');
    if (OUT) await b.shot(`${OUT}/io-summary.png`);
    const errs = b.log.filter((x) => x.type === 'error' || x.type === 'exception').map((x) => x.text).filter((t) => !/favicon|fonts\.g/.test(t));
    ok(!errs.length, 'بدون أخطاء في الصفحة', errs.slice(0, 2).join(' | '));
  } finally { await b.close(); }

  // 3) يرسل تعديلاته وفادية تطبّقها
  const old = cur.packages;
  const data = {
    name: 'فحص الخيارات', place_mode: 'visit', pay_timing: 'before', owner_phone: '0500000072',
    services: [{ name: 'غسيل كامل', price: 45, addons: [{ name: 'واكس', name_en: 'Wax', price: 9, group: '' }, { name: 'تكييس دعاستين', name_en: '2 mats', price: 4.25, group: 'mats' }, { name: 'معطر', price: 5 }] }, { name: 'غسيل خارجي', price: 28, addons: [] }],
    packages: [{ id: old[0].id, name: 'باقة 4 غسلات', uses: 4, price: 130, note: 'بدون انتهاء', svc_name: 'غسيل كامل' }, { name: 'باقة 10', uses: 10, price: 300, note: '', svc_name: '' }],
    ask: [{ q: 'وش رقم اللوحة؟', hint: 'أ ب ج 1234', q_en: 'Plate number?', hint_en: 'ABC 1234', svc: [] }, { q: 'لون السيارة؟', hint: '' }],
    capacity: 4, hours: [{ weekday: 0, open: '08:00', close: '20:00' }],
    staff: [{ name: 'رامي', phone: '0500000071', lang: 'en' }, { name: 'سامي', phone: '0500000073', lang: 'ar' }],
  };
  const r = await client('intake', { k, data });
  ok(r.saved === true, 'النموذج انحفظ', JSON.stringify(r));
  const ap = await fetch(`${P.url}/rest/v1/rpc/ihj_apply_intake`, { method: 'POST', headers: { apikey: P.anon, authorization: 'Bearer ' + a.jwt, 'content-type': 'application/json' }, body: JSON.stringify({ p_business: bid }) });
  ok(ap.ok, '«طبّق بياناته»', String(ap.status) + ' ' + (await ap.text()).slice(0, 120));
  const svc = sql(`select name, price, addons::text a from services where business_id = '${bid}' and active order by sort`);
  const ad = JSON.parse(svc[0].a);
  ok(+svc[0].price === 45 && ad.length === 3 && ad[0].price === 9 && ad[1].group === 'mats' && ad[2].name === 'معطر', 'الإضافات انطبقت (والمجموعة باقية)', svc[0].a);
  ok(JSON.parse(svc[1].a).length === 0, 'خدمة بدون إضافات تبقى بدون');
  const pk = sql(`select id, name, uses, price, active, service_ids::text s from packages where business_id = '${bid}' order by sort, name`);
  const p1 = pk.find((x) => x.id === old[0].id), p2 = pk.find((x) => x.name === 'باقة 10'), p3 = pk.find((x) => x.name === 'باقة قديمة');
  ok(p1 && p1.name === 'باقة 4 غسلات' && +p1.price === 130 && p1.active && /-/.test(p1.s), 'الباقة الموجودة تحدّثت بنفس المعرّف وخدمتها', JSON.stringify(p1));
  ok(p2 && p2.active && +p2.uses === 10 && p2.s === '{}', 'باقة جديدة لكل الخدمات', JSON.stringify(p2));
  ok(p3 && p3.active === false, 'الباقة المحذوفة توقف بيعها');
  const st2 = sql(`select capacity_mode, capacity_per_slot, ask::text a from settings where business_id = '${bid}'`)[0];
  const asks = JSON.parse(st2.a);
  ok(st2.capacity_mode === 'fixed' && +st2.capacity_per_slot === 4, 'السعة صارت 4');
  ok(asks.length === 2 && asks[0].q_en === 'Plate number?' && asks[1].q === 'لون السيارة؟', 'الأسئلة انطبقت والترجمة باقية');
  const stf = sql(`select name, lang from staff where business_id = '${bid}' and active order by name`);
  ok(stf.find((x) => x.name === 'رامي')?.lang === 'en' && stf.find((x) => x.name === 'سامي')?.lang === 'ar', 'لغة الموظفين انطبقت', JSON.stringify(stf));

  // 4) نموذج قديم بدون الحقول الجديدة ما يمسح شي
  await client('intake', { k, data: { name: 'فحص الخيارات', services: [{ name: 'غسيل كامل', price: 45 }, { name: 'غسيل خارجي', price: 28 }] } });
  await fetch(`${P.url}/rest/v1/rpc/ihj_apply_intake`, { method: 'POST', headers: { apikey: P.anon, authorization: 'Bearer ' + a.jwt, 'content-type': 'application/json' }, body: JSON.stringify({ p_business: bid }) });
  const after = sql(`select (select addons::text from services where business_id = '${bid}' and name = 'غسيل كامل') a, (select count(*) from packages where business_id = '${bid}' and active)::int p, (select jsonb_array_length(ask) from settings where business_id = '${bid}') q, (select capacity_per_slot from settings where business_id = '${bid}') c`)[0];
  ok(JSON.parse(after.a).length === 3 && after.p === 2 && after.q === 2 && +after.c === 4, 'نموذج بدون الخيارات ما يمسحها', JSON.stringify(after));
} finally {
  if (bid) sql(`delete from businesses where id = ${q(bid)}`);
  sql(`delete from businesses where slug like 'io-test%'`);
}
console.log(`\n${pass} نجح · ${fail} فشل`);
process.exit(fail ? 1 : 0);
