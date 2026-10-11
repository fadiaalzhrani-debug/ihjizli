// الدفع قبل تأكيد الحجز: فاتورة برابط دفع (ميسر بحساب المنشأة، أو تجريبي للمنشآت التجريبية وتجارب المحاكي) بدون PDF وقت الحجز
// الـPDF ينسوى بعد الدفع (markInvoicePaid)، عشان مسار البوت يبقى خفيف وسريع
// وشراء البكجات من الواتساب: نفس الفاتورة بس على رصيد العميل بدل الطلب
import { db, FN_BASE, SITE_URL } from "./util.ts";
import { moyasarCreateInvoice } from "./pay.ts";
import { loadSecrets } from "./wa.ts";
import type { Line } from "./extras.ts";

export const payGo = (token: string) => `${FN_BASE}/pay/go/${token}`;

const r2 = (x: number) => Math.round(x * 100) / 100;

// مين يستلم الدفع: ميسر بحساب المنشأة، أو تجريبي (المنشأة التجريبية، أو تجربة المحاكي في منشأة عندها الدفع)
async function providerFor(business: any, settings: any, isTest: boolean): Promise<{ provider: "demo" | "moyasar"; sk: string } | null> {
  const allowPay = business.plan === "bot_pay" || business.is_demo;
  if (!allowPay) return null;
  let provider = settings.pay_provider;
  if (provider === "demo" && !business.is_demo) provider = "none";
  if (isTest) provider = "demo";
  if (provider !== "demo" && provider !== "moyasar") return null;
  if (provider === "moyasar") {
    const sk = (await loadSecrets(business.id))?.moyasar_sk || "";
    return sk ? { provider, sk } : null;
  }
  return { provider, sk: "" };
}

// البنود بالمبلغ الشامل؛ لو فيه ضريبة ننزلها من كل بند والفرق يطلع في الضريبة (عشان الإجمالي يطابق اللي انطلب بالضبط)
function priced(items: Line[], total: number, vp: number) {
  const its = items.map((it) => ({ name: it.name.slice(0, 60), qty: it.qty, price: vp > 0 ? r2(it.price / (1 + vp / 100)) : r2(it.price) }));
  const subtotal = r2(its.reduce((a, it) => a + it.qty * it.price, 0));
  return { items: its, subtotal, vat: r2(total - subtotal) };
}

async function issue(business: any, settings: any, p: { order?: any; cpk?: any; items: Line[]; total: number; isTest: boolean; description: string; meta: Record<string, string>; expiresAt?: string }) {
  const pv = await providerFor(business, settings, p.isTest);
  if (!pv) return null;
  const vp = Number(settings.vat_percent || 0);
  const total = r2(p.total);
  const { items, subtotal, vat } = priced(p.items, total, vp);
  const { data: no, error: ne } = await db().rpc("ihj_next_number", { p_business: business.id, p_kind: "invoice", p_start: 1 });
  if (ne) throw new Error(ne.message);
  const { data: inv, error } = await db().from("invoices").insert({
    business_id: business.id, order_id: p.order?.id || null, customer_package_id: p.cpk?.id || null, number: no, items,
    subtotal, vat_percent: vp, vat, total, pay_provider: pv.provider,
  }).select("*").single();
  if (error) throw new Error(error.message);
  let payUrl = `${SITE_URL}pay.html?t=${inv.pay_token}`;
  if (pv.provider === "moyasar") {
    const m = await moyasarCreateInvoice(pv.sk, {
      amount: total, description: p.description,
      callback_url: `${FN_BASE}/pay/moyasar/${inv.pay_token}`, success_url: `${FN_BASE}/pay/return/${inv.pay_token}`, back_url: `${SITE_URL}pay.html?t=${inv.pay_token}`,
      metadata: { invoice_id: inv.id, business_id: business.id, ...p.meta },
      expired_at: p.expiresAt,
    });
    await db().from("invoices").update({ pay_ref: m.id, pay_url: m.url }).eq("id", inv.id);
    inv.pay_ref = m.id; payUrl = m.url;
  } else {
    await db().from("invoices").update({ pay_url: payUrl }).eq("id", inv.id);
  }
  inv.pay_url = payUrl;
  return { invoice: inv, link: payGo(inv.pay_token) };
}

// items: بنود الطلب (الخدمة × العدد والإضافات)؛ لو ما فيه بنود (عربون بدون سعر) يطلع بند واحد بالاسم
export async function createPrepay(business: any, settings: any, order: any, amount: number, label: string, items?: Line[]): Promise<{ invoice: any; link: string } | null> {
  if (!(amount >= 1)) return null;
  const its = items && items.length && Math.abs(items.reduce((a, it) => a + it.qty * it.price, 0) - amount) < 0.01 ? items : [{ name: label, qty: 1, price: amount }];
  return issue(business, settings, {
    order, items: its, total: amount, isTest: !!order.is_test,
    description: `${business.name} · حجز ${order.number}`, meta: { order_number: String(order.number), prepay: "1" },
    expiresAt: order.hold_until ? new Date(new Date(order.hold_until).getTime() + 120_000).toISOString() : undefined,
  });
}

// شراء بكج: فاتورة على رصيد العميل (customer_packages) بدون طلب
export async function createPkgInvoice(business: any, settings: any, cpk: any): Promise<{ invoice: any; link: string } | null> {
  const amount = Number(cpk.price || 0);
  if (!(amount >= 1)) return null;
  return issue(business, settings, {
    cpk, items: [{ name: cpk.name, qty: 1, price: amount }], total: amount, isTest: !!cpk.is_test,
    description: `${business.name} · ${cpk.name}`, meta: { package: String(cpk.id) },
  });
}
