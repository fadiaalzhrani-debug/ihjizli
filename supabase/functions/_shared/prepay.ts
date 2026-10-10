// الدفع قبل تأكيد الحجز: فاتورة برابط دفع (ميسر بحساب المنشأة، أو تجريبي للمنشآت التجريبية) بدون PDF وقت الحجز
// الـPDF ينسوى بعد الدفع (markInvoicePaid)، عشان مسار البوت يبقى خفيف وسريع
import { db, FN_BASE, SITE_URL } from "./util.ts";
import { moyasarCreateInvoice } from "./pay.ts";
import { loadSecrets } from "./wa.ts";

export const payGo = (token: string) => `${FN_BASE}/pay/go/${token}`;

export async function createPrepay(business: any, settings: any, order: any, amount: number, label: string): Promise<{ invoice: any; link: string } | null> {
  if (!(amount >= 1)) return null;
  const allowPay = business.plan === "bot_pay" || business.is_demo;
  let provider = allowPay ? settings.pay_provider : "none";
  if (provider === "demo" && !business.is_demo) provider = "none";
  if (order.is_test && provider === "moyasar") provider = "demo";
  if (provider !== "demo" && provider !== "moyasar") return null;
  let sk = "";
  if (provider === "moyasar") { sk = (await loadSecrets(business.id))?.moyasar_sk || ""; if (!sk) return null; }
  const vp = Number(settings.vat_percent || 0);
  const total = Math.round(amount * 100) / 100;
  const subtotal = Math.round((total / (1 + vp / 100)) * 100) / 100;
  const vat = Math.round((total - subtotal) * 100) / 100;
  const { data: no, error: ne } = await db().rpc("ihj_next_number", { p_business: business.id, p_kind: "invoice", p_start: 1 });
  if (ne) throw new Error(ne.message);
  const { data: inv, error } = await db().from("invoices").insert({
    business_id: business.id, order_id: order.id, number: no, items: [{ name: label.slice(0, 60), qty: 1, price: subtotal }],
    subtotal, vat_percent: vp, vat, total, pay_provider: provider,
  }).select("*").single();
  if (error) throw new Error(error.message);
  let payUrl = `${SITE_URL}pay.html?t=${inv.pay_token}`;
  if (provider === "moyasar") {
    const m = await moyasarCreateInvoice(sk, {
      amount: total, description: `${business.name} · حجز ${order.number}`,
      callback_url: `${FN_BASE}/pay/moyasar/${inv.pay_token}`, success_url: `${FN_BASE}/pay/return/${inv.pay_token}`, back_url: `${SITE_URL}pay.html?t=${inv.pay_token}`,
      metadata: { invoice_id: inv.id, business_id: business.id, order_number: String(order.number), prepay: "1" },
      expired_at: order.hold_until ? new Date(new Date(order.hold_until).getTime() + 120_000).toISOString() : undefined,
    });
    await db().from("invoices").update({ pay_ref: m.id, pay_url: m.url }).eq("id", inv.id);
    inv.pay_ref = m.id; payUrl = m.url;
  } else {
    await db().from("invoices").update({ pay_url: payUrl }).eq("id", inv.id);
  }
  inv.pay_url = payUrl;
  return { invoice: inv, link: payGo(inv.pay_token) };
}
