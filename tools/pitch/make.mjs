// ملف الإقناع: صور 1080×1350 لكل صفحة (للواتساب) + PDF واحد
// node tools/pitch/make.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, sleep } from '../cdp.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] || path.join(here, '../../tests/out/pitch'));
fs.mkdirSync(out, { recursive: true });

const b = await launch({ width: 540, height: 675, scale: 2 });
try {
  await b.go(pathToFileURL(path.join(here, 'pitch.html')).href, 500);
  await b.ev('document.fonts.ready.then(() => true)');
  if (!(await b.waitFor('!!document.querySelector("#qr svg")'))) throw new Error('qr');
  await sleep(400);
  const rects = await b.ev('[...document.querySelectorAll(".pg")].map((e) => { const r = e.getBoundingClientRect(); return { y: r.top + scrollY, w: r.width, h: r.height }; })');
  const over = await b.ev('[...document.querySelectorAll(".pg")].map((p, i) => [...p.querySelectorAll("*")].some((e) => { const r = e.getBoundingClientRect(), q = p.getBoundingClientRect(); return r.width && (r.bottom > q.bottom + 0.5 || r.left < q.left - 0.5 || r.right > q.right + 0.5); }) ? i + 1 : 0).filter(Boolean)');
  if (over.length) console.log('تنبيه: عناصر طالعة برا الصفحة', over);
  for (const [i, r] of rects.entries()) {
    const shot = await b.cmd('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: r.y, width: r.w, height: r.h, scale: 1 }, captureBeyondViewport: true });
    fs.writeFileSync(path.join(out, `المناوب ${i + 1}.png`), Buffer.from(shot.data, 'base64'));
  }
  const pdf = await b.cmd('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
  fs.writeFileSync(path.join(out, 'المناوب.pdf'), Buffer.from(pdf.data, 'base64'));
  console.log('ok', rects.length, 'صفحات →', out);
} finally {
  await b.close();
}
