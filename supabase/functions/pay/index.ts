// الدفع والفاتورة للعميل:
//   GET  /pay/go/<رمز>        رابط زر «ادفع الحين»: يحوّل لصفحة ميسر (أو صفحة الفاتورة لو مدفوعة/تجريبية)
//   POST /pay/moyasar/<رمز>   إشعار ميسر بعد الدفع (نتحقق من ميسر نفسه قبل الاعتماد)
//   GET  /pay/return/<رمز>    رجوع العميل من ميسر بعد الدفع
//   POST /pay/info {t}        بيانات صفحة الفاتورة pay.html
//   POST /pay/demo {t,method} دفع تجريبي للمنشآت التجريبية فقط (بدون فلوس)
import { CORS, db, errMsg, ipOf, json, limiter, readJson, routeParts, SITE_URL } from "../_shared/util.ts";
import { markInvoicePaid, signedPdf, verifyMoyasar } from "../_shared/actions.ts";

const TOKEN = /^[0-9a-f]{32}$/;
const lim = limiter(120, 600_000);
const redirect = (url: string) => new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store" } });

async function invByToken(t: string) {
  if (!TOKEN.test(t)) return null;
  const { data } = await db().from("invoices").select("*").eq("pay_token", t).maybeSingle();
  return data;
}

const pageUrl = (t: string, extra = "") => `${SITE_URL}pay.html?t=${t}${extra}`;

async function settle(inv: any) {
  if (inv.pay_provider !== "moyasar") return inv.status === "paid";
  if (inv.status === "paid") return true;
  if (inv.status === "void") {
    // حجز انتهت مهلته وانلغى: لو العميل دفع في آخر لحظة نعتمده ونرجّع موعده لو فاضي
    const { data: o } = await db().from("orders").select("status, cancel_reason").eq("id", inv.order_id).maybeSingle();
    if (!(o?.status === "cancelled" && o?.cancel_reason === "unpaid")) return false;
  } else if (inv.status !== "issued") return false;
  const v = await verifyMoyasar(inv);
  if (v.paid) { await markInvoicePaid(inv.id, { provider: "moyasar", ref: v.ref, amount: v.amount, method: v.method, raw: v.raw, by: "moyasar" }); return true; }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const parts = routeParts(req, "pay");
  const ip = ipOf(req);
  if (lim(ip)) return json({ ok: false, error: "busy" }, 429);
  try {
    const [a, t = ""] = parts;
    if (a === "go" && req.method === "GET") {
      const inv = await invByToken(t);
      if (!inv) return redirect(`${SITE_URL}pay.html?e=1`);
      if (inv.status === "issued" && inv.pay_provider === "moyasar" && inv.pay_url) return redirect(inv.pay_url);
      return redirect(pageUrl(t));
    }
    if (a === "moyasar" && req.method === "POST") {
      const inv = await invByToken(t);
      if (!inv) return json({ ok: false }, 404);
      await settle(inv);
      return json({ ok: true });
    }
    if (a === "return" && req.method === "GET") {
      const inv = await invByToken(t);
      if (!inv) return redirect(`${SITE_URL}pay.html?e=1`);
      const paid = await settle(inv).catch(() => false);
      return redirect(pageUrl(t, paid ? "&paid=1" : ""));
    }
    if (a === "info" && req.method === "POST") {
      const b = await readJson(req) || {};
      const inv = await invByToken(String(b.t || ""));
      if (!inv) return json({ ok: false, error: "not_found" }, 404);
      if (inv.status === "issued" && inv.pay_provider === "moyasar") await settle(inv).catch(() => false);
      const { data: fresh } = await db().from("invoices").select("*").eq("id", inv.id).single();
      const [{ data: biz }, { data: o }] = await Promise.all([
        db().from("businesses").select("name, logo_url, brand_color, is_demo").eq("id", inv.business_id).single(),
        db().from("orders").select("number, status, cancel_reason").eq("id", inv.order_id).single(),
      ]);
      return json({ ok: true, invoice: {
        number: fresh.number, order: o?.number, items: fresh.items, subtotal: fresh.subtotal, vat_percent: fresh.vat_percent, vat: fresh.vat, total: fresh.total,
        status: fresh.status, order_cancelled: o?.status === "cancelled", expired: o?.status === "cancelled" && o?.cancel_reason === "unpaid", paid_at: fresh.paid_at, paid_method: fresh.paid_method, provider: fresh.pay_provider,
        pay_url: fresh.status === "issued" && fresh.pay_provider === "moyasar" ? fresh.pay_url : "",
        pdf_url: fresh.pdf_path ? await signedPdf(fresh.pdf_path, 3600) : "",
      }, business: biz });
    }
    if (a === "demo" && req.method === "POST") {
      const b = await readJson(req) || {};
      const inv = await invByToken(String(b.t || ""));
      if (!inv) return json({ ok: false, error: "not_found" }, 404);
      const { data: biz } = await db().from("businesses").select("is_demo").eq("id", inv.business_id).single();
      const { data: ord } = await db().from("orders").select("is_test").eq("id", inv.order_id).maybeSingle();
      if (inv.pay_provider !== "demo" || !(biz?.is_demo || ord?.is_test)) return json({ ok: false, error: "not_demo" }, 409);
      const label = b.method === "applepay" ? "أبل باي" : b.method === "card" ? "بطاقة" : "مدى";
      const r = await markInvoicePaid(inv.id, { provider: "demo", ref: `demo-${inv.id}`, amount: Number(inv.total), method: label, by: "demo" });
      return json({ ok: true, already: !!(r as any).already });
    }
    return json({ ok: false, error: "not_found" }, 404);
  } catch (e) {
    console.error("pay", errMsg(e));
    return json({ ok: false, error: "server" }, 500);
  }
});
