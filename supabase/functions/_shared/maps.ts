// قراءة الموقع من رسالة واتساب أو رابط قوقل ماب، وتحديد المدينة الأقرب ضمن نطاقها
export type Pt = { lat: number; lng: number };

const valid = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

export function coordsFromText(s: string): Pt | null {
  const t = decodeSafe(String(s || ""));
  const pats: RegExp[] = [
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /@(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /[?&](?:q|query|ll|sll|destination|daddr|center|cbll)=(?:loc:)?(-?\d{1,3}\.\d+)\s*(?:,|%2C)\s*\+?(-?\d{1,3}\.\d+)/i,
    /\/maps\/(?:place|search|dir)\/[^@]*?(-?\d{1,3}\.\d+),\s*\+?(-?\d{1,3}\.\d+)/,
    /geo:(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/i,
    /^\s*(-?\d{1,2}\.\d{3,})\s*[,،\s]\s*(-?\d{1,3}\.\d{3,})\s*$/,
  ];
  for (const re of pats) {
    const m = t.match(re);
    if (m) { const lat = +m[1], lng = +m[2]; if (valid(lat, lng)) return { lat, lng }; }
  }
  return null;
}

function decodeSafe(s: string): string {
  let out = s;
  for (let i = 0; i < 2; i++) { try { const d = decodeURIComponent(out); if (d === out) break; out = d; } catch { break; } }
  return out;
}

export function firstUrl(s: string): string {
  const m = String(s || "").match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/[).,،]+$/, "") : "";
}

const SHORT = /^(maps\.app\.goo\.gl|goo\.gl|g\.co|maps\.google\.[a-z.]+|www\.google\.[a-z.]+|google\.[a-z.]+|maps\.apple\.com|share\.google)$/i;

// يقرأ الإحداثيات من النص مباشرة، أو يتبع الرابط المختصر (لين 4 تحويلات) ويقرأها من العنوان النهائي
export async function locationFromText(text: string): Promise<(Pt & { url: string }) | null> {
  const direct = coordsFromText(text);
  const url = firstUrl(text);
  if (direct) return { ...direct, url };
  if (!url) return null;
  let host = "";
  try { host = new URL(url).hostname; } catch { return null; }
  if (!SHORT.test(host)) return null;
  let cur = url;
  for (let i = 0; i < 4; i++) {
    let r: Response;
    try { r = await fetch(cur, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (WhatsApp location resolver)" }, signal: AbortSignal.timeout(5000) }); }
    catch { return null; }
    const loc = r.headers.get("location");
    try { await r.body?.cancel(); } catch { /* */ }
    if (!loc) break;
    cur = new URL(loc, cur).toString();
    const c = coordsFromText(cur);
    if (c) return { ...c, url };
  }
  // أحيانًا الصفحة النهائية فيها الإحداثيات داخل المحتوى
  try {
    const r = await fetch(cur, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(5000) });
    const body = (await r.text()).slice(0, 200_000);
    const m = body.match(/center=(-?\d{1,3}\.\d+)%2C(-?\d{1,3}\.\d+)/) || body.match(/\[null,null,(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)\]/);
    if (m && valid(+m[1], +m[2])) return { lat: +m[1], lng: +m[2], url };
  } catch { /* */ }
  return null;
}

export function km(a: Pt, b: Pt): number {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function nearestCity<T extends { lat: number; lng: number; radius_km: number | string }>(cities: T[], p: Pt): T | null {
  let best: T | null = null, bestD = Infinity;
  for (const c of cities) {
    const d = km(p, { lat: +c.lat, lng: +c.lng });
    if (d <= Number(c.radius_km) && d < bestD) { best = c; bestD = d; }
  }
  return best;
}

export const mapsLink = (p: Pt) => `https://maps.google.com/?q=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
