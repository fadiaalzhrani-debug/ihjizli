// يحوّل صفحة PDF الأولى لصورة PNG (pdf.js داخل Edge المخفي) عشان نفحص شكل الفاتورة
// usage: node tools/pdf2png.mjs in.pdf out.png [scale]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { launch } from './cdp.mjs';

const [inp, out, sc, clipArg] = process.argv.slice(2);
const b64 = fs.readFileSync(inp).toString('base64');
const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#888">
<canvas id="c"></canvas>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
(async()=>{const raw=atob('${b64}');const u=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)u[i]=raw.charCodeAt(i);
const pdf=await pdfjsLib.getDocument({data:u}).promise;const p=await pdf.getPage(1);const v=p.getViewport({scale:${Number(sc) || 1.5}});
const c=document.getElementById('c');c.width=v.width;c.height=v.height;await p.render({canvasContext:c.getContext('2d'),viewport:v}).promise;
document.title='done:'+v.width+'x'+v.height;})().catch(e=>document.title='err:'+e.message);
</script>`;
const tmp = path.join(os.tmpdir(), `ihj_pdf_${Date.now()}.html`);
fs.writeFileSync(tmp, html);
const b = await launch({ width: 900, height: 1270 });
try {
  await b.go('file:///' + tmp.replace(/\\/g, '/'), 300);
  await b.waitFor(`document.title.startsWith('done')||document.title.startsWith('err')`, 20000);
  const t = await b.ev('document.title');
  if (!t.startsWith('done')) throw new Error(t);
  const [w, h] = t.slice(5).split('x').map(Number);
  await b.cmd('Emulation.setDeviceMetricsOverride', { width: Math.ceil(w), height: Math.ceil(h), deviceScaleFactor: 1, mobile: false });
  if (clipArg) { const [x, y, w, h] = clipArg.split(',').map(Number); const r = await b.cmd('Page.captureScreenshot', { format: 'png', clip: { x, y, width: w, height: h, scale: 1 } }); fs.writeFileSync(out, Buffer.from(r.data, 'base64')); }
  else await b.shot(out);
  console.log('png', out, t);
} finally { await b.close(); fs.unlinkSync(tmp); }
