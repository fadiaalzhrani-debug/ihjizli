// أوامر الطلب من لوحة المنشأة ولوحة الموظف: في الطريق، وصلت، الفاتورة، الدفع، الإلغاء، تغيير الموعد
// كل أمر يحدّث الطلب ويرسل للعميل رسالته (أو قالب لو انتهت نافذة الـ24 ساعة) ويطلق التصدير
import { db, FN_BASE, money, SITE_URL } from "./util.ts";
import { textsFor } from "./texts.ts";
import { dayLabel, local, timeLabel } from "./dates.ts";
import { loadSecrets, type Out, sendToCustomer } from "./wa.ts";
import { orderEvent } from "./events.ts";
import { invoicePdf } from "./pdf.ts";
import { methodLabel, moyasarCreateInvoice, moyasarGetInvoice } from "./pay.ts";
import { modeOf, placeLine, tailFor } from "./place.ts";

export class AppError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

export type Full = { o: any; b: any; s: any; ch: any };

export async function orderFull(orderId: string): Promise<Full> {
  if (!/^[0-9a-f-]{36}$/i.test(orderId || "")) throw new AppError("order_id");
  const { data: o } = await db().from("orders").select("*, customer:customers(*), staff:staff(*), city:cities(*), service:services(*)").eq("id", orderId).maybeSingle();
  if (!o) throw new AppError("not_found", 404);
  const [{ data: b }, { data: s }, { data: ch }] = await Promise.all([
    db().from("businesses").select("*").eq("id", o.business_id).single(),
    db().from("settings").select("*").eq("business_id", o.business_id).single(),
    db().from("channels").select("*").eq("business_id", o.business_id).maybeSingle(),
  ]);
  // تجربة المحاكي المخصصة (الاسم والأسلوب والمكان والدفع) تمشي على رسائل الموظف كمان
  const cfg = o.customer?.is_sim ? o.customer?.sim_config : null;
  if (cfg && typeof cfg === "object") {
    if (cfg.name) { b.name = cfg.name; b.name_en = cfg.name; }
    if (["visit", "shop", "online"].includes(cfg.place)) { s.place_mode = cfg.place; if (o.service) o.service.place_mode = null; }
    if (["after", "before", "none"].includes(cfg.pay)) s.pay_timing = cfg.pay;
    if (["friendly", "formal", "short"].includes(cfg.tone)) s.tone = cfg.tone;
  }
  return { o, b, s, ch: ch || {} };
}

const T = (f: Full) => textsFor(f.o.customer?.lang === "en" ? "en" : "ar", f.s.texts, f.s.tone);
const modeF = (f: Full) => modeOf(f.s, f.o.service);
const tz = (f: Full) => f.b.timezone || "Asia/Riyadh";
const when = (f: Full, iso: string) => {
  const lang = f.o.customer?.lang === "en" ? "en" : "ar";
  return { day: dayLabel(local(iso, tz(f)).ymd, lang, tz(f), false), time: timeLabel(iso, lang, tz(f)) };
};
const bizName = (f: Full) => (f.o.customer?.lang === "en" && f.b.name_en) ? f.b.name_en : f.b.name;

async function event(f: Full, kind: string, by: string, data: Record<string, unknown> = {}) {
  await db().from("order_events").insert({ business_id: f.b.id, order_id: f.o.id, kind, data, by_who: by });
}

async function setOrder(f: Full, patch: Record<string, unknown>, allowed: string[]) {
  const { data, error } = await db().from("orders").update(patch).eq("id", f.o.id).in("status", allowed).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new AppError("bad_status", 409);
  Object.assign(f.o, data);
}

export async function actOnTheWay(f: Full, by: string) {
  await setOrder(f, { status: "on_the_way", on_the_way_at: new Date().toISOString() }, ["confirmed", "on_the_way"]);
  await event(f, "on_the_way", by);
  const staff = f.o.staff?.name || bizName(f);
  const r = await sendToCustomer(f.b, f.ch, f.o.customer, [{ t: "text", text: T(f)("on_the_way", { staff, no: f.o.number }) }],
    { purpose: "on_the_way", by, template: { name: "ihj_on_the_way", params: [staff, f.b.name, String(f.o.number)] } });
  await orderEvent(f.b.id, "order.on_the_way", { order_id: f.o.id, is_test: f.o.is_test });
  return r;
}

export async function actArrived(f: Full, by: string) {
  await setOrder(f, { status: "arrived", arrived_at: new Date().toISOString() }, ["confirmed", "on_the_way", "arrived"]);
  await event(f, "arrived", by);
  // رسالة «وصل الموظف» للزيارات فقط (في المحل أو أونلاين العميل حاضر أصلًا)
  let r = null;
  if (modeF(f) === "visit") {
    const staff = f.o.staff?.name || bizName(f);
    r = await sendToCustomer(f.b, f.ch, f.o.customer, [{ t: "text", text: T(f)("arrived", { staff, no: f.o.number }) }],
      { purpose: "arrived", by, template: { name: "ihj_arrived", params: [staff, f.b.name, String(f.o.number)] } });
  }
  await orderEvent(f.b.id, "order.arrived", { order_id: f.o.id, is_test: f.o.is_test });
  return r;
}

export function cleanItems(items: any): { name: string; qty: number; price: number }[] {
  if (!Array.isArray(items) || !items.length || items.length > 30) throw new AppError("items");
  return items.map((it: any) => {
    const name = String(it?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    const qty = Math.round(Number(it?.qty ?? 1));
    const price = Math.round(Number(it?.price) * 100) / 100;
    if (!name || !Number.isFinite(qty) || qty < 1 || qty > 999 || !Number.isFinite(price) || price < 0 || price > 1_000_000) throw new AppError("items");
    return { name, qty, price };
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;
export const payGoLink = (token: string) => `${FN_BASE}/pay/go/${token}`;

async function renderAndStore(f: Full, inv: any, payLink: string | null) {
  const iso = inv.paid_at || inv.created_at || new Date().toISOString();
  const lt = local(inv.created_at || new Date().toISOString(), tz(f));
  const bytes = await invoicePdf({
    biz: { name: f.b.name, color: f.b.brand_color, cr: f.b.cr_number, vat: f.b.vat_number, address: f.b.address, phone: f.b.wa_number ? "0" + String(f.b.wa_number).replace(/^966/, "") : "", logo_url: f.b.logo_url },
    invoice: { number: inv.number, date: lt.ymd, time: timeLabel(inv.created_at || new Date().toISOString(), "ar", tz(f)), iso: new Date(iso).toISOString(), items: inv.items, subtotal: +inv.subtotal, vat_percent: +inv.vat_percent, vat: +inv.vat, total: +inv.total, paid: inv.status === "paid", paid_method: inv.paid_method || "" },
    order: { number: f.o.number, day: dayLabel(local(f.o.slot_start, tz(f)).ymd, "ar", tz(f), false), time: timeLabel(f.o.slot_start, "ar", tz(f)), city: f.o.city?.name || "", service: f.o.service?.name || "", staff: f.o.staff?.name || "" },
    customer: { name: f.o.customer?.name || "", phone: f.o.customer?.is_sim ? "" : (f.o.customer?.wa_id ? "0" + String(f.o.customer.wa_id).replace(/^966/, "") : "") },
    pay_url: inv.status === "paid" ? null : payLink,
  });
  const path = `${f.b.id}/${inv.id}.pdf`;
  const { error } = await db().storage.from("invoices").upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (error) throw new Error("upload: " + error.message);
  await db().from("invoices").update({ pdf_path: path }).eq("id", inv.id);
  return path;
}

export async function signedPdf(path: string, seconds = 7 * 86400): Promise<string> {
  const { data, error } = await db().storage.from("invoices").createSignedUrl(path, seconds);
  if (error || !data?.signedUrl) throw new Error("sign: " + (error?.message || ""));
  return data.signedUrl;
}

export async function actInvoice(f: Full, rawItems: any, by: string) {
  if (!["confirmed", "on_the_way", "arrived", "invoiced"].includes(f.o.status)) throw new AppError("bad_status", 409);
  const items = cleanItems(rawItems);
  const subtotal = round2(items.reduce((a, it) => a + it.qty * it.price, 0));
  const vp = Number(f.s.vat_percent || 0);
  const vat = round2(subtotal * vp / 100);
  const total = round2(subtotal + vat);
  // فاتورة سابقة غير مدفوعة لنفس الطلب تنلغي
  await db().from("invoices").update({ status: "void" }).eq("order_id", f.o.id).eq("status", "issued");
  const { data: no, error: ne } = await db().rpc("ihj_next_number", { p_business: f.b.id, p_kind: "invoice", p_start: 1 });
  if (ne) throw new Error(ne.message);
  const allowPay = f.b.plan === "bot_pay" || f.b.is_demo;
  let provider = allowPay ? f.s.pay_provider : "none";
  if (provider === "demo" && !f.b.is_demo) provider = "none";
  if (f.o.is_test && provider === "moyasar") provider = "demo";
  const { data: inv, error } = await db().from("invoices").insert({ business_id: f.b.id, order_id: f.o.id, number: no, items, subtotal, vat_percent: vp, vat, total, pay_provider: provider }).select("*").single();
  if (error) throw new Error(error.message);
  let payLink: string | null = null;
  if (provider === "moyasar" && total >= 1) {
    const sec = await loadSecrets(f.b.id);
    if (sec?.moyasar_sk) {
      const m = await moyasarCreateInvoice(sec.moyasar_sk, {
        amount: total, description: `${f.b.name} · طلب ${f.o.number} · فاتورة ${no}`,
        callback_url: `${FN_BASE}/pay/moyasar/${inv.pay_token}`, success_url: `${FN_BASE}/pay/return/${inv.pay_token}`, back_url: `${SITE_URL}pay.html?t=${inv.pay_token}`,
        metadata: { invoice_id: inv.id, business_id: f.b.id, order_number: String(f.o.number) },
      });
      await db().from("invoices").update({ pay_ref: m.id, pay_url: m.url }).eq("id", inv.id);
      inv.pay_ref = m.id; inv.pay_url = m.url;
      payLink = payGoLink(inv.pay_token);
    } else {
      await db().from("invoices").update({ pay_provider: "none" }).eq("id", inv.id);
      inv.pay_provider = "none";
    }
  } else if (provider === "demo" && total > 0) {
    const url = `${SITE_URL}pay.html?t=${inv.pay_token}`;
    await db().from("invoices").update({ pay_url: url }).eq("id", inv.id);
    inv.pay_url = url;
    payLink = payGoLink(inv.pay_token);
  } else if (provider !== "none") {
    await db().from("invoices").update({ pay_provider: "none" }).eq("id", inv.id);
    inv.pay_provider = "none";
  }
  const path = await renderAndStore(f, inv, payLink);
  const pdfUrl = await signedPdf(path);
  await db().from("orders").update({ status: "invoiced", invoiced_at: new Date().toISOString(), price: total }).eq("id", f.o.id);
  f.o.status = "invoiced";
  await event(f, "invoiced", by, { invoice: no, total });
  const t = T(f);
  const outs: Out[] = [{ t: "document", url: pdfUrl, filename: `invoice-${f.o.number}.pdf`, caption: t("invoice", { no: f.o.number, total: money(total) }), path }];
  if (payLink) outs.push({ t: "cta", text: t("invoice_pay"), label: t("btn_pay"), url: payLink });
  const r = await sendToCustomer(f.b, f.ch, f.o.customer, outs, { purpose: "invoice", by, template: { name: "ihj_invoice", params: [String(f.o.number), f.b.name, money(total)], button: inv.pay_token } });
  await orderEvent(f.b.id, "order.invoiced", { order_id: f.o.id, is_test: f.o.is_test });
  return { invoice: { ...inv, pdf_path: path }, pdf_url: pdfUrl, pay_link: payLink, send: r };
}

// تأكيد الدفع (من ميسر بعد التحقق، أو التجريبي، أو يدوي من الموظف): مرة وحدة فقط لكل فاتورة
export async function markInvoicePaid(invoiceId: string, p: { provider: string; ref: string; amount: number; method: string; raw?: unknown; by: string }) {
  const now = new Date().toISOString();
  let { data: inv } = await db().from("invoices").update({ status: "paid", paid_at: now, paid_method: p.method }).eq("id", invoiceId).eq("status", "issued").select("*").maybeSingle();
  let late = false;
  if (!inv) {
    // دفع وصل بعد انتهاء مهلة الحجز (الفاتورة انلغت معه): نقبله ونحاول نرجّع الموعد
    const { data: v } = await db().from("invoices").select("*, order:orders(status, cancel_reason)").eq("id", invoiceId).maybeSingle();
    if (v?.status === "void" && v.order?.status === "cancelled" && v.order?.cancel_reason === "unpaid") {
      const { data: v2 } = await db().from("invoices").update({ status: "paid", paid_at: now, paid_method: p.method }).eq("id", invoiceId).eq("status", "void").select("*").maybeSingle();
      inv = v2; late = !!v2;
    }
    if (!inv) return { ok: true, already: true };
  }
  await db().from("payments").insert({ business_id: inv.business_id, invoice_id: inv.id, provider: p.provider, provider_ref: p.ref || inv.id, amount: p.amount, status: "paid", method: p.method, raw: p.raw ?? {} });
  const f = await orderFull(inv.order_id);
  if (late) {
    const { data: back } = await db().rpc("ihj_reinstate", { p_order: f.o.id });
    if (!back) {
      // الموعد راح لغيره: يتحوّل للمنشأة تتابع مع العميل
      await db().from("customers").update({ bot_paused: true, paused_at: now, paused_reason: "order" }).eq("id", f.o.customer.id);
      await db().from("handoffs").insert({ business_id: f.b.id, customer_id: f.o.customer.id, reason: "order", last_text: `دفع ${money(p.amount)} ريال لطلب رقم ${f.o.number} بعد انتهاء المهلة، والموعد صار محجوز` });
      await event(f, "paid", p.by, { invoice: inv.number, amount: p.amount, method: p.method, provider: p.provider, late: true });
      await sendToCustomer(f.b, f.ch, f.o.customer, [{ t: "text", text: T(f)("handoff", { biz: bizName(f) }) }], { purpose: "update", by: "system" });
      return { ok: true, late: true };
    }
    f.o.status = "pending_payment";
  }
  if (f.o.status === "pending_payment") {
    // دفع مقدم: يتأكد الحجز وينطلق تنبيه المنشأة والموظف
    await db().from("orders").update({ status: "confirmed", paid_at: now, prepaid: true, hold_until: null }).eq("id", f.o.id).eq("status", "pending_payment");
    f.o.status = "confirmed";
    await event(f, "paid", p.by, { invoice: inv.number, amount: p.amount, method: p.method, provider: p.provider, prepay: true });
    try { await renderAndStore(f, inv, null); } catch (e) { console.error("prepaid pdf", e); }
    const mode = modeF(f), lang = f.o.customer?.lang === "en" ? "en" : "ar";
    const w = when(f, f.o.slot_start);
    const text = T(f)("prepaid_confirmed", { no: f.o.number, day: w.day, time: w.time, city_line: placeLine(T(f), f.s, mode, f.o.city, lang), tail: tailFor(T(f), f.s, mode, lang) });
    const r = await sendToCustomer(f.b, f.ch, f.o.customer, [{ t: "buttons", text, buttons: [{ id: "m:orders", title: T(f)("btn_orders") }, { id: "m:new", title: T(f)("btn_new_order") }] }],
      { purpose: "paid", by: "system", template: { name: "ihj_paid", params: [String(f.o.number), f.b.name] } });
    await orderEvent(f.b.id, "order.created", { order_id: f.o.id, is_test: f.o.is_test });
    await orderEvent(f.b.id, "order.paid", { order_id: f.o.id, is_test: f.o.is_test });
    return { ok: true, send: r, prepaid: true };
  }
  await db().from("orders").update({ paid_at: now, status: "done", done_at: now }).eq("id", f.o.id).neq("status", "cancelled");
  await event(f, "paid", p.by, { invoice: inv.number, amount: p.amount, method: p.method, provider: p.provider });
  try { await renderAndStore(f, inv, null); } catch (e) { console.error("paid pdf", e); }
  const r = await sendToCustomer(f.b, f.ch, f.o.customer, [{ t: "text", text: T(f)("paid", { no: f.o.number }) }],
    { purpose: "paid", by: "system", template: { name: "ihj_paid", params: [String(f.o.number), f.b.name] } });
  await orderEvent(f.b.id, "order.paid", { order_id: f.o.id, is_test: f.o.is_test });
  return { ok: true, send: r };
}

// تحقق من ميسر نفسه قبل اعتماد الدفع (ما نثق بمحتوى الإشعار)
export async function verifyMoyasar(inv: any): Promise<{ paid: boolean; amount: number; method: string; ref: string; raw: any }> {
  const sec = await loadSecrets(inv.business_id);
  if (!sec?.moyasar_sk || !inv.pay_ref) return { paid: false, amount: 0, method: "", ref: "", raw: null };
  const m = await moyasarGetInvoice(sec.moyasar_sk, inv.pay_ref);
  const paidPay = (m?.payments || []).find((x: any) => x.status === "paid") || null;
  const amount = Number(m?.amount || 0) / 100;
  const ok = m?.status === "paid" && Math.abs(amount - Number(inv.total)) < 0.01;
  return { paid: ok, amount, method: methodLabel(paidPay), ref: String(paidPay?.id || m?.id || ""), raw: { id: m?.id, status: m?.status, amount: m?.amount, payment: paidPay?.id } };
}

export async function actCash(f: Full, method: string, by: string) {
  const { data: inv } = await db().from("invoices").select("*").eq("order_id", f.o.id).eq("status", "issued").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!inv) throw new AppError("no_invoice", 409);
  const label = method === "transfer" ? "تحويل" : method === "card" ? "شبكة" : "نقدًا";
  return await markInvoicePaid(inv.id, { provider: "manual", ref: `manual-${inv.id}`, amount: Number(inv.total), method: label, by });
}

export async function actDone(f: Full, by: string) {
  const now = new Date().toISOString();
  await setOrder(f, { status: "done", done_at: now }, ["confirmed", "on_the_way", "arrived"]);
  await event(f, "done", by);
  const r = await sendToCustomer(f.b, f.ch, f.o.customer, [{ t: "text", text: T(f)("done", { no: f.o.number }) }],
    { purpose: "update", by, template: { name: "ihj_update", params: [String(f.o.number), f.b.name, "تم إكمال الطلب"] } });
  await orderEvent(f.b.id, "order.done", { order_id: f.o.id, is_test: f.o.is_test });
  return r;
}

export async function actCancelByBiz(f: Full, reason: string, by: string, notify = true) {
  const { error } = await db().rpc("ihj_cancel", { p_order: f.o.id, p_by: by, p_reason: reason.slice(0, 200) });
  if (error) throw new AppError(/locked/.test(error.message) ? "bad_status" : "cancel", 409);
  await db().from("invoices").update({ status: "void" }).eq("order_id", f.o.id).eq("status", "issued");
  let r = null;
  if (notify) {
    r = await sendToCustomer(f.b, f.ch, f.o.customer, [{ t: "buttons", text: T(f)("cancelled_by_biz", { no: f.o.number, reason: reason ? `\n${reason}` : "" }), buttons: [{ id: "m:book", title: T(f)("btn_book") }] }],
      { purpose: "update", by, template: { name: "ihj_update", params: [String(f.o.number), f.b.name, `تم إلغاء الطلب${reason ? "، " + reason : ""}`] } });
  }
  await orderEvent(f.b.id, "order.cancelled", { order_id: f.o.id, is_test: f.o.is_test });
  return r;
}

export async function actReschedByBiz(f: Full, startIso: string, by: string) {
  const { data: o, error } = await db().rpc("ihj_reschedule", { p_order: f.o.id, p_start: startIso, p_by: by });
  if (error) throw new AppError(/slot_taken/.test(error.message) ? "slot_taken" : /locked/.test(error.message) ? "bad_status" : "reschedule", 409);
  const w = when(f, (o as any).slot_start);
  const r = await sendToCustomer(f.b, f.ch, f.o.customer, [{ t: "text", text: T(f)("rescheduled_by_biz", { no: f.o.number, day: w.day, time: w.time }) }],
    { purpose: "update", by, template: { name: "ihj_update", params: [String(f.o.number), f.b.name, `الموعد الجديد ${w.day} ${w.time}`] } });
  await orderEvent(f.b.id, "order.rescheduled", { order_id: f.o.id, is_test: f.o.is_test });
  return r;
}

export async function actAssign(f: Full, staffId: string | null, by: string) {
  if (staffId) {
    const { data: st } = await db().from("staff").select("id").eq("id", staffId).eq("business_id", f.b.id).maybeSingle();
    if (!st) throw new AppError("staff");
  }
  await db().from("orders").update({ staff_id: staffId }).eq("id", f.o.id);
  await event(f, "assigned", by, { staff_id: staffId });
  if (staffId) await orderEvent(f.b.id, "order.assigned", { order_id: f.o.id, is_test: f.o.is_test });
}

// التذكير قبل الموعد (يشتغل من cron كل دقيقة)
export async function sendReminders(limit = 50) {
  const { data: rows, error } = await db().rpc("ihj_due_reminders", { p_limit: limit });
  if (error) { console.error("reminders", error.message); return 0; }
  let n = 0;
  for (const row of rows || []) {
    try {
      const f = await orderFull(row.id);
      const lead = Number(f.s.reminder_minutes || 0) * 60_000;
      if (new Date(f.o.created_at).getTime() > new Date(f.o.slot_start).getTime() - lead) continue; // انحجز داخل وقت التذكير: ما نزعجه
      const w = when(f, f.o.slot_start);
      const t = T(f);
      await sendToCustomer(f.b, f.ch, f.o.customer, [{ t: "buttons", text: t("reminder", { no: f.o.number, day: w.day, time: w.time }), buttons: [
        { id: `rs:${f.o.id}`, title: t("btn_change_time") }, { id: `cx:${f.o.id}`, title: t("btn_cancel_order") }] }],
        { purpose: "reminder", by: "system", template: { name: "ihj_reminder", params: [f.b.name, String(f.o.number), w.day, w.time] } });
      await event(f, "reminder", "system");
      n++;
    } catch (e) { console.error("reminder", row.id, e); }
  }
  return n;
}

// حجوزات انتهت مهلة دفعها: ينفك الموعد وتنلغى فاتورتها ويوصل العميل خبر (يشتغل من cron)
export async function expireHolds(limit = 50) {
  const { data: rows, error } = await db().rpc("ihj_expire_holds", { p_limit: limit });
  if (error) { console.error("expire", error.message); return 0; }
  for (const o of rows || []) {
    try {
      await db().from("invoices").update({ status: "void" }).eq("order_id", o.id).eq("status", "issued");
      const f = await orderFull(o.id);
      await event(f, "expired", "system");
      const w = when(f, f.o.slot_start);
      await sendToCustomer(f.b, f.ch, f.o.customer, [{ t: "buttons", text: T(f)("hold_expired", { day: w.day, time: w.time }), buttons: [{ id: "m:book", title: T(f)("btn_book") }] }],
        { purpose: "update", by: "system", template: { name: "ihj_update", params: [String(f.o.number), f.b.name, "انتهت مهلة الدفع وانفك الحجز"] } });
    } catch (e) { console.error("expire", o.id, e); }
  }
  return (rows || []).length;
}

// متابعة فواتير ميسر المعلقة (احتياط لو ما وصل إشعار الدفع)
export async function pollMoyasar(limit = 20) {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data: rows } = await db().from("invoices").select("*").eq("status", "issued").eq("pay_provider", "moyasar").neq("pay_ref", "").gte("created_at", since).order("created_at", { ascending: false }).limit(limit);
  const late = new Date(Date.now() - 2 * 86400_000).toISOString();
  const { data: voids } = await db().from("invoices").select("*, order:orders!inner(status, cancel_reason)").eq("status", "void").eq("pay_provider", "moyasar").neq("pay_ref", "")
    .eq("order.status", "cancelled").eq("order.cancel_reason", "unpaid").gte("created_at", late).order("created_at", { ascending: false }).limit(10);
  let n = 0;
  for (const inv of [...(rows || []), ...(voids || [])]) {
    try {
      const v = await verifyMoyasar(inv);
      if (v.paid) { await markInvoicePaid(inv.id, { provider: "moyasar", ref: v.ref, amount: v.amount, method: v.method, raw: v.raw, by: "moyasar" }); n++; }
    } catch (e) { console.error("poll", inv.id, e); }
  }
  return n;
}
