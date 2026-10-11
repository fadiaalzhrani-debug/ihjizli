// خيارات الطلب (2026-10-11): الإضافات، العدد (كم سيارة)، أسئلة قبل الحجز، ورصيد البكجات
// دوال صافية بدون قاعدة بيانات، يستخدمها البوت ورسائل ما بعد الدفع والفاتورة
import { money } from "./util.ts";
import type { Lang, TextBag } from "./texts.ts";

export type Addon = { name: string; name_en: string; price: number; group: string };
export type Units = { one: string; two: string; many: string; en_one: string; en_many: string };
export type Qty = Units & { max: number };
export type Line = { name: string; qty: number; price: number };

const str = (x: unknown, n: number) => String(x ?? "").trim().slice(0, n);

export function addonsOf(svc: any): Addon[] {
  const raw = Array.isArray(svc?.addons) ? svc.addons : [];
  return raw.slice(0, 9).map((a: any) => ({ name: str(a?.name, 24), name_en: str(a?.name_en, 24), price: Math.max(0, Math.round(Number(a?.price || 0) * 100) / 100), group: str(a?.group, 20) }))
    .filter((a: Addon) => a.name);
}

// كلمات العدد: لو المنشأة ما حددت، «مرة/مرتين/مرات»
export function unitsOf(u: any, fallback?: Partial<Units>): Units {
  const f = { one: "مرة", two: "مرتين", many: "مرات", en_one: "time", en_many: "times", ...(fallback || {}) };
  const o = u && typeof u === "object" ? u : {};
  return { one: str(o.one, 20) || f.one, two: str(o.two, 20) || f.two, many: str(o.many, 20) || f.many, en_one: str(o.en_one, 20) || f.en_one, en_many: str(o.en_many, 20) || f.en_many };
}

// العدد: لو max أكثر من 1 البوت يسأل «كم سيارة؟»
export function qtyOf(svc: any): Qty | null {
  const q = svc?.qty && typeof svc.qty === "object" ? svc.qty : {};
  const max = Math.min(10, Math.floor(Number(q.max || 1)));
  if (!(max > 1)) return null;
  return { max, ...unitsOf(q, { one: "قطعة", two: "قطعتين", many: "قطع", en_one: "item", en_many: "items" }) };
}

// «سيارة وحدة»، «سيارتين»، «3 سيارات»، «11 سيارة» (وبالإنجليزي 1 car، 3 cars)
export function countText(u: Units, n: number, lang: Lang): string {
  if (lang === "en") return `${n} ${n === 1 ? u.en_one : u.en_many}`;
  if (n === 1) return `${u.one} ${u.one.endsWith("ة") ? "وحدة" : "واحد"}`;
  if (n === 2) return u.two;
  if (n >= 3 && n <= 10 && u.many) return `${n} ${u.many}`;
  return `${n} ${u.one}`;
}

// العدد بدون كلمة «وحدة» (للرصيد: «باقي 1 غسلة»)
export function countShort(u: Units, n: number, lang: Lang): string {
  if (lang === "en") return `${n} ${n === 1 ? u.en_one : u.en_many}`;
  if (n === 2) return u.two;
  if (n >= 3 && n <= 10 && u.many) return `${n} ${u.many}`;
  return `${n} ${u.one}`;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

// بنود الطلب: الخدمة × العدد (أو من رصيد البكج بصفر) + الإضافات المختارة
export function orderLines(o: { svcName: string; unit: number | null; qty: number; pkg: boolean; addons: { name: string; price: number }[]; fromBalance: string }):
  { lines: Line[]; total: number | null } {
  const lines: Line[] = [];
  if (o.pkg) lines.push({ name: `${o.svcName} · ${o.fromBalance}`.slice(0, 60), qty: o.qty, price: 0 });
  else if (o.unit != null) lines.push({ name: o.svcName.slice(0, 60), qty: o.qty, price: o.unit });
  for (const a of o.addons) lines.push({ name: a.name.slice(0, 60), qty: 1, price: a.price });
  const priced = o.pkg || o.unit != null;
  const total = priced ? r2(lines.reduce((s, l) => s + l.qty * l.price, 0)) : null;
  return { lines, total };
}

// سطور الملخص في رسالة التأكيد (من الطلب نفسه، عشان رسالة ما بعد الدفع تطلع نفس الشي)
// pkgLeft: كم باقي في رصيده بعد الخصم (يطلع جنب «من رصيد البكج»)
export function orderSummary(T: TextBag, lang: Lang, o: any, svcName: string, pkgLeft = ""): string {
  const ex = o?.extras && typeof o.extras === "object" ? o.extras : {};
  const out: string[] = [];
  const qty = Number(o?.qty || 1);
  const addons = Array.isArray(ex.addons) ? ex.addons : [];
  const answers = Array.isArray(ex.answers) ? ex.answers : [];
  const fancy = qty > 1 || addons.length || answers.length || Number(o?.pkg_uses || 0) > 0;
  if (!fancy) return "";
  if (svcName) out.push(`🧾 ${svcName}${qty > 1 ? ` · ${countText(unitsOf(ex.unit), qty, lang)}` : ""}`);
  if (Number(o?.pkg_uses || 0) > 0) out.push(`🎟️ ${T("from_balance")}${pkgLeft ? T("balance_left", { left: pkgLeft }) : ""}`);
  if (addons.length) out.push(`✨ ${addons.map((a: any) => a.name).join("، ")}`);
  for (const a of answers.slice(0, 5)) out.push(`📝 ${a.q}: ${a.a}`);
  if (o?.total != null) out.push(T("total_line", { total: money(Number(o.total)) }).trim());
  return out.length ? "\n" + out.join("\n") : "";
}
