// لقطات «الخدمات والمدن» في لوحة منشأة (كمدير): خيارات الخدمة، أسئلة قبل الحجز، البكجات ورصيد العملاء، ونافذة خيارات خدمة
// usage: node tests/shot-catalog.mjs <outDir> [slug] [base]
import fs from 'node:fs';
import { launch, sleep } from '../tools/cdp.mjs';
import { sql } from '../tools/sql.mjs';

const OUT = process.argv[2] || 'tests/out';
const SLUG = process.argv[3] || 'soclean';
const BASE = process.argv[4] || 'http://localhost:5610/';
fs.mkdirSync(OUT, { recursive: true });
const adminTok = fs.readFileSync(new URL('../.secrets/admin-link.txt', import.meta.url), 'utf8').trim().split('#k=')[1];
const biz = sql(`select id from businesses where slug = '${SLUG}'`)[0];
const errs = [];
for (const [w, h, tag, mob] of [[1360, 900, 'desk', false], [390, 844, 'mob', true]]) {
  const b = await launch({ width: w, height: h, scale: mob ? 2 : 1, mobile: mob });
  try {
    await b.go(`${BASE}admin.html#k=${adminTok}`, 500);
    await b.waitFor(`document.querySelector('[data-tab]')`, 25000); await sleep(800);
    await b.go(`${BASE}biz.html?b=${biz.id}#catalog`, 500);
    await b.waitFor(`document.getElementById('view')`, 25000); await sleep(1200);
    await b.ev(`__biz.go('catalog')`);
    await b.waitFor(`document.querySelector('#pkBody .tbl') || document.querySelector('#pkBody p')`, 20000); await sleep(900);
    await b.shot(`${OUT}/cat-${tag}-1.png`);
    await b.ev(`document.getElementById('askList').scrollIntoView({block:'start'})`); await sleep(500);
    await b.shot(`${OUT}/cat-${tag}-2-ask.png`);
    await b.ev(`document.getElementById('pkCard').scrollIntoView({block:'start'})`); await sleep(500);
    await b.shot(`${OUT}/cat-${tag}-3-packages.png`);
    await b.ev(`window.scrollTo(0,0); document.querySelector('[data-sv] [data-opt]').click()`); await sleep(900);
    await b.shot(`${OUT}/cat-${tag}-4-options.png`);
    for (const l of b.log) if (l.type === 'error' || l.type === 'exception') errs.push(`${tag}: ${l.text}`);
  } finally { await b.close(); }
}
console.log('errors', errs.length, errs.slice(0, 5));
