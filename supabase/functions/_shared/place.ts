// مكان الخدمة (عند العميل، في المحل، أونلاين) وسطوره في رسائل التأكيد، مشتركة بين البوت وأوامر اللوحات
import type { TextBag } from "./texts.ts";

export type Mode = "visit" | "shop" | "online";

export function modeOf(settings: any, service: any): Mode {
  const m = service?.place_mode || settings?.place_mode || "visit";
  return (m === "shop" || m === "online") ? m : "visit";
}

export const mapsOf = (c: any) => (c && Number.isFinite(+c.lat) && Number.isFinite(+c.lng)) ? `https://maps.google.com/?q=${(+c.lat).toFixed(6)},${(+c.lng).toFixed(6)}` : "";

// سطر المكان تحت الموعد في التأكيد والتذكير
export function placeLine(T: TextBag, settings: any, mode: Mode, city: any, lang: string): string {
  const name = city ? ((lang === "en" && city.name_en) ? city.name_en : city.name) : "";
  if (mode === "online") return T("place_online", { online: settings?.online_note || T("online_default") });
  if (mode === "shop") return city ? T("place_shop", { branch: name, maps: mapsOf(city) ? "\n" + mapsOf(city) : "" }) : "";
  return city ? T("city_line", { city: name }) : "";
}

// السطر الأخير بعد التأكيد: نص المنشأة لو عدّلته، وإلا الافتراضي حسب المكان
export function tailFor(T: TextBag, settings: any, mode: Mode, lang: string): string {
  const over = settings?.texts?.[lang]?.confirmed_tail;
  if (typeof over === "string" && over.trim()) return T("confirmed_tail");
  return T(mode === "shop" ? "tail_shop" : mode === "online" ? "tail_online" : "confirmed_tail");
}
