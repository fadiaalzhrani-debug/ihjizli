// تواريخ وأوقات بتوقيت المنشأة (الافتراضي الرياض)
import type { Lang } from "./texts.ts";

const DAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type LocalParts = { y: number; m: number; d: number; hh: number; mm: number; dow: number; ymd: string };

export function local(t: Date | string, tz: string): LocalParts {
  const dt = typeof t === "string" ? new Date(t) : t;
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(dt)) p[x.type] = x.value;
  const y = +p.year, m = +p.month, d = +p.day;
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, hh: +p.hour % 24, mm: +p.minute, dow, ymd: `${p.year}-${p.month}-${p.day}` };
}

export function todayYmd(tz: string): string { return local(new Date(), tz).ymd; }

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

function ymdParts(ymd: string) { const [y, m, d] = ymd.split("-").map(Number); return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }; }

// «الأحد 12 أكتوبر» / «Sun 12 Oct»، ومع «اليوم/بكرة» لو قريب
export function dayLabel(ymd: string, lang: Lang, tz: string, relative = true, T?: (k: string) => string): string {
  const p = ymdParts(ymd);
  const base = lang === "en" ? `${DAYS_EN[p.dow]} ${p.d} ${MONTHS_EN[p.m - 1]}` : `${DAYS_AR[p.dow]} ${p.d} ${MONTHS_AR[p.m - 1]}`;
  if (!relative || !T) return base;
  const today = todayYmd(tz);
  if (ymd === today) return `${T("today")} · ${base}`;
  if (ymd === addDays(today, 1)) return `${T("tomorrow")} · ${base}`;
  return base;
}

export function shortDay(ymd: string, lang: Lang): string {
  const p = ymdParts(ymd);
  return lang === "en" ? `${DAYS_EN[p.dow]} ${p.d}/${p.m}` : `${DAYS_AR[p.dow]} ${p.d}/${p.m}`;
}

export function timeLabel(t: Date | string, lang: Lang, tz: string): string {
  const p = local(t, tz);
  const h12 = p.hh % 12 === 0 ? 12 : p.hh % 12;
  const mm = String(p.mm).padStart(2, "0");
  const am = p.hh < 12;
  return lang === "en" ? `${h12}:${mm} ${am ? "AM" : "PM"}` : `${h12}:${mm} ${am ? "ص" : "م"}`;
}

export function hm(time: string, lang: Lang): string {
  const [h, m] = time.split(":").map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const am = h < 12;
  return lang === "en" ? `${h12}:${String(m).padStart(2, "0")} ${am ? "AM" : "PM"}` : `${h12}:${String(m).padStart(2, "0")} ${am ? "ص" : "م"}`;
}

export const weekdayName = (i: number, lang: Lang) => (lang === "en" ? ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] : DAYS_AR)[i];

export function dateLabel(t: Date | string, lang: Lang, tz: string): string {
  return dayLabel(local(t, tz).ymd, lang, tz, false);
}
