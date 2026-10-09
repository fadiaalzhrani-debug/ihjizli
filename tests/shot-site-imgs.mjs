// صور قسم «كذا يشوفها العميل» في الموقع العام، من المحاكي الجديد نفسه (محلك، وضع داكن، 780×1688)
// الناتج: docs/img/loc.png و confirmed.png و invoice.png
import { launch, sleep } from '../tools/cdp.mjs';
import { sql } from '../tools/sql.mjs';
import { sessionFor, api } from './link-check.mjs';
import { testLinks } from './links.mjs';

const BASE = process.argv[2] || 'http://localhost:5610/';
const biz = sql(`select id, slug, sim_key from businesses where slug='mahalak'`)[0];
const L = await testLinks();
const b = await launch({ width: 390, height: 844, scale: 2, mobile: true, dark: true });
const hideChrome = `document.querySelectorAll('.e2e,.daychip').forEach(e=>e.remove())`;
try {
  await b.go(`${BASE}sim.html?b=${biz.slug}&k=${biz.sim_key}`, 1500);
  await b.ev(`window.__sim.reset()`); await sleep(800);
  await b.ev(`window.__sim.sendMsg({type:'text',text:'السلام عليكم'})`);
  await b.waitFor(`document.querySelectorAll('.btns button').length>=3 && !document.getElementById('typing')`, 20000); await sleep(800);
  await b.ev(`[...document.querySelectorAll('.btns button')].find(x=>x.textContent.includes('احجز من هنا')).click()`);
  await b.waitFor(`document.querySelector('[data-loc]')`, 20000); await sleep(1200);
  await b.ev(hideChrome);
  await b.shot('docs/img/loc.png');
  await b.ev(`document.querySelector('[data-loc]').click()`); await sleep(1500);
  await b.ev(`document.getElementById('sendLoc').click()`);
  await b.waitFor(`document.querySelectorAll('[data-list]').length>=1`, 20000); await sleep(800);
  await b.ev(`[...document.querySelectorAll('[data-list]')].pop().click()`); await sleep(400);
  await b.ev(`document.querySelectorAll('#sheetB .opt')[1].click()`);
  await b.waitFor(`document.querySelectorAll('[data-list]').length>=2`, 20000); await sleep(800);
  await b.ev(`[...document.querySelectorAll('[data-list]')].pop().click()`); await sleep(400);
  await b.ev(`[...document.querySelectorAll('#sheetB .opt')].find(o=>o.textContent.includes('4:00'))?.click() || document.querySelectorAll('#sheetB .opt')[5].click()`);
  await b.waitFor(`[...document.querySelectorAll('.bub')].some(x=>x.textContent.includes('رقم الطلب'))`, 20000); await sleep(1500);
  await b.ev(hideChrome);
  await b.shot('docs/img/confirmed.png');
  // الفاتورة من لوحة المنشأة (المالك) عشان تطلع في المحاكي
  const from = await b.ev(`window.__sim.from`);
  const o = sql(`select o.id from orders o join customers c on c.id=o.customer_id where c.wa_id='${from}' order by o.created_at desc limit 1`)[0];
  const own = await sessionFor(L.tok('owner_mahalak'));
  await api(own.jwt, 'order/on_the_way', { order_id: o.id });
  await api(own.jwt, 'order/arrived', { order_id: o.id });
  const inv = await api(own.jwt, 'order/invoice', { order_id: o.id, items: [{ name: 'زيارة فني وفحص', qty: 1, price: 100 }, { name: 'تغيير خلاط مغسلة', qty: 1, price: 85 }] });
  if (!inv.ok) throw new Error(JSON.stringify(inv));
  await b.waitFor(`document.querySelector('.doc') && [...document.querySelectorAll('a.inbtn')].some(a=>a.textContent.includes('ادفع'))`, 30000); await sleep(1500);
  await b.ev(hideChrome);
  await b.shot('docs/img/invoice.png');
  console.log('site images updated');
} finally { await b.close(); }
