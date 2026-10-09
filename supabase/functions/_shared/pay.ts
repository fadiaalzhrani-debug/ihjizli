// الدفع: ميسر بحساب المنشأة نفسها (فاتورة ميسر برابط دفع: مدى، أبل باي، بطاقة)، ووضع تجريبي للمنشآت التجريبية بدون فلوس
const MOYASAR = "https://api.moyasar.com/v1";

const auth = (sk: string) => ({ authorization: "Basic " + btoa(sk + ":"), "content-type": "application/json" });

export async function moyasarCreateInvoice(sk: string, p: { amount: number; description: string; callback_url: string; success_url: string; back_url: string; metadata: Record<string, string> }) {
  const body = { amount: Math.round(p.amount * 100), currency: "SAR", description: p.description.slice(0, 250), callback_url: p.callback_url, success_url: p.success_url, back_url: p.back_url, metadata: p.metadata };
  const r = await fetch(`${MOYASAR}/invoices`, { method: "POST", headers: auth(sk), body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.id || !j?.url) throw new Error(`moyasar_${r.status}: ${j?.message || j?.type || ""}`.slice(0, 200));
  return { id: String(j.id), url: String(j.url), status: String(j.status || "") };
}

export async function moyasarGetInvoice(sk: string, id: string) {
  const r = await fetch(`${MOYASAR}/invoices/${encodeURIComponent(id)}`, { headers: auth(sk), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`moyasar_${r.status}`);
  return j;
}

// فحص صحة المفتاح بدون أي عملية دفع (قراءة قائمة الفواتير فقط)
export async function moyasarCheckKey(sk: string): Promise<boolean> {
  const r = await fetch(`${MOYASAR}/invoices?page=1`, { headers: auth(sk), signal: AbortSignal.timeout(15000) });
  await r.body?.cancel().catch(() => {});
  return r.ok;
}

export function methodLabel(payment: any): string {
  const s = payment?.source || {};
  if (s.type === "applepay") return "أبل باي";
  if (s.type === "stcpay") return "STC Pay";
  const c = String(s.company || "").toLowerCase();
  if (c === "mada") return "مدى";
  if (c === "visa") return "فيزا";
  if (c === "master" || c === "mastercard") return "ماستركارد";
  if (c === "amex") return "أمريكان إكسبريس";
  return "بطاقة";
}

export const mask = (k: string) => (k ? `${k.slice(0, 8)}••••${k.slice(-4)}` : "");
