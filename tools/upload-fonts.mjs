// يرفع خطوط الفاتورة (IBM Plex Sans Arabic، رخصة OFL من مستودع خطوط قوقل) لمخزن public/fonts
import fs from 'node:fs';
const P = JSON.parse(fs.readFileSync(new URL('../.secrets/project.json', import.meta.url)));
for (const f of ['IBMPlexSansArabic-Regular.ttf', 'IBMPlexSansArabic-Bold.ttf']) {
  const bytes = fs.readFileSync(new URL(`../assets/fonts/${f}`, import.meta.url));
  const r = await fetch(`${P.url}/storage/v1/object/public/fonts/${f}`, { method: 'POST', headers: { authorization: `Bearer ${P.service}`, apikey: P.service, 'content-type': 'font/ttf', 'x-upsert': 'true' }, body: bytes });
  console.log(f, r.status, (await r.text()).slice(0, 120));
}
