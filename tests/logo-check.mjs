// شعار «محلك» (دائرة خضراء بحرف م) ← رفعه من لوحة المنشأة ← فاتورة فيها الشعار ← صورة للفحص
import fs from 'node:fs';
import { launch } from '../tools/cdp.mjs';
import { sessionFor, api } from './link-check.mjs';
import { testLinks } from './links.mjs';
import { sql } from '../tools/sql.mjs';
const b = await launch({ width: 400, height: 400 });
await b.go('about:blank', 100);
const dataUrl = await b.ev(`(async () => { await document.fonts.load('700 280px Tajawal').catch(()=>{}); const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
  x.fillStyle = '#0B7A55'; x.beginPath(); x.arc(256, 256, 256, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#fff'; x.font = '700 300px "Segoe UI", Tahoma, Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('م', 256, 250);
  return c.toDataURL('image/png'); })()`);
await b.close();
const L = await testLinks();
const own = await sessionFor(L.tok('owner_mahalak'));
const M = sql(`select id from businesses where slug='mahalak'`)[0];
const up = await api(own.jwt, 'biz/logo', { business_id: M.id, data_url: dataUrl });
console.log('logo', up.ok, up.logo_url || up.error);
const o = sql(`select id from orders where business_id='${M.id}' and status in ('confirmed','on_the_way','arrived') order by slot_start limit 1`)[0];
if (o) {
  const inv = await api(own.jwt, 'order/invoice', { order_id: o.id, items: [{ name: 'زيارة فني وفحص', qty: 1, price: 100 }] });
  console.log('invoice', inv.ok, inv.invoice?.number);
  const r = await fetch(inv.pdf_url); fs.writeFileSync('tests/out/invoice-logo.pdf', Buffer.from(await r.arrayBuffer()));
  console.log('pdf saved');
}
