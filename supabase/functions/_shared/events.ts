// ما يصير بعد أحداث الطلب: تصدير (Webhook أو جوجل شيت) وتنبيه المالك على الواتساب، عبر طابور jobs مع إعادة المحاولة
import { db, errMsg, hmacHex, background, intl } from "./util.ts";
import { sendToNumber, sendToOwner } from "./wa.ts";
import { dayLabel, local, timeLabel } from "./dates.ts";
import { textsFor } from "./texts.ts";

export type OrderEventKind = "order.created" | "order.assigned" | "order.rescheduled" | "order.cancelled" | "order.on_the_way" | "order.arrived" | "order.invoiced" | "order.paid" | "order.done" | "handoff";

export async function orderEvent(businessId: string, kind: OrderEventKind, payload: Record<string, unknown>) {
  const { data: s } = await db().from("settings").select("export_kind, export_url, notify_owner, notify_staff").eq("business_id", businessId).maybeSingle();
  const { data: b } = await db().from("businesses").select("owner_phone, is_demo").eq("id", businessId).maybeSingle();
  const jobs: any[] = [];
  if (s && s.export_kind !== "none" && s.export_url) jobs.push({ business_id: businessId, kind: "export", payload: { event: kind, ...payload } });
  if (s?.notify_owner && b?.owner_phone && (kind === "order.created" || kind === "handoff") && !payload.is_test) {
    jobs.push({ business_id: businessId, kind: kind === "handoff" ? "notify_handoff" : "notify_owner", payload });
  }
  if (s?.notify_staff && (kind === "order.created" || kind === "order.assigned") && payload.order_id && !payload.is_test) {
    jobs.push({ business_id: businessId, kind: "notify_staff", payload });
  }
  if (!jobs.length) return;
  await db().from("jobs").insert(jobs);
  background(runJobs(10, businessId));
}

// صيغة الطلب المرسلة للتصدير
export async function orderSnapshot(orderId: string) {
  const { data: o } = await db().from("orders")
    .select("*, customer:customers(name, wa_id, is_sim), city:cities(name), service:services(name), staff:staff(name, phone), business:businesses(id, name, slug, timezone)")
    .eq("id", orderId).maybeSingle();
  if (!o) return null;
  const tz = o.business?.timezone || "Asia/Riyadh";
  const { data: inv } = await db().from("invoices").select("number, total, vat, status, paid_at, paid_method").eq("order_id", orderId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return {
    business: { id: o.business?.id, name: o.business?.name, slug: o.business?.slug },
    order: {
      id: o.id, number: o.number, status: o.status,
      day: dayLabel(local(o.slot_start, tz).ymd, "ar", tz, false), time: timeLabel(o.slot_start, "ar", tz),
      slot_start: o.slot_start, slot_end: o.slot_end,
      customer_name: o.customer?.name || "", customer_phone: o.customer?.is_sim ? "" : (o.customer?.wa_id || ""),
      city: o.city?.name || "", service: o.service?.name || "", staff: o.staff?.name || "",
      price: o.price, maps_url: o.maps_url, address: o.address, notes: o.notes, channel: o.channel, is_test: o.is_test,
      created_at: o.created_at, cancelled_at: o.cancelled_at, paid_at: o.paid_at, done_at: o.done_at,
    },
    invoice: inv || null,
  };
}

async function doExport(job: any) {
  const { data: s } = await db().from("settings").select("export_kind, export_url").eq("business_id", job.business_id).maybeSingle();
  if (!s || s.export_kind === "none" || !s.export_url) return;
  const snap = job.payload?.order_id ? await orderSnapshot(job.payload.order_id) : null;
  const body = JSON.stringify({ event: job.payload?.event, sent_at: new Date().toISOString(), ...(snap || {}), extra: job.payload?.extra || null });
  const { data: sec } = await db().from("business_secrets").select("export_secret").eq("business_id", job.business_id).maybeSingle();
  const sig = await hmacHex(sec?.export_secret || "", new TextEncoder().encode(body));
  const r = await fetch(s.export_url, { method: "POST", headers: { "content-type": "application/json", "x-ihj-event": String(job.payload?.event || ""), "x-ihj-signature": `sha256=${sig}` }, body, signal: AbortSignal.timeout(15000) });
  await r.body?.cancel().catch(() => {});
  if (r.status >= 400) throw new Error(`export_http_${r.status}`);
}

async function doNotify(job: any) {
  const { data: b } = await db().from("businesses").select("*").eq("id", job.business_id).maybeSingle();
  const { data: ch } = await db().from("channels").select("*").eq("business_id", job.business_id).maybeSingle();
  if (!b) return;
  const T = textsFor("ar", null);
  const soft = (err?: string) => !err || err === "no_phone" || String(err).startsWith("template_not_approved");
  if (job.kind === "notify_staff") {
    const snap = await orderSnapshot(job.payload.order_id);
    const { data: o } = await db().from("orders").select("staff_id, status").eq("id", job.payload.order_id).maybeSingle();
    if (!snap || !o?.staff_id || o.status === "cancelled") return;
    const { data: st } = await db().from("staff").select("name, phone, active").eq("id", o.staff_id).maybeSingle();
    const to = intl(st?.phone);
    if (!to || !st?.active) return;
    const x = snap.order;
    const text = `طلب جديد لك رقم ${x.number} 🔔\n📅 ${x.day} ⏰ ${x.time}${x.city ? "\n📍 " + x.city : ""}`;
    const r = await sendToNumber(b, ch, to, { name: "ihj_staff_order", params: [b.name, String(x.number), `${x.day} ${x.time}`, x.city || b.city || ""] }, text);
    if (!r.ok && !soft(r.error)) throw new Error(r.error || "notify_staff");
    return;
  }
  if (job.kind === "notify_owner") {
    const snap = await orderSnapshot(job.payload.order_id);
    if (!snap) return;
    const o = snap.order;
    const text = T("owner_new_order", { no: o.number, customer: o.customer_name || o.customer_phone, day: o.day, time: o.time, city_line: o.city ? T("city_line", { city: o.city }) : "" });
    const r = await sendToOwner(b, ch, { name: "ihj_new_order", params: [b.name, String(o.number), o.customer_name || o.customer_phone || "عميل", `${o.day} ${o.time}`] }, text);
    if (!r.ok && !soft(r.error)) throw new Error(r.error || "notify");
  } else {
    const text = T("owner_handoff", { customer: job.payload.customer || "", text: job.payload.text || "" });
    const r = await sendToOwner(b, ch, { name: "ihj_handoff", params: [b.name, String(job.payload.customer || "عميل"), String(job.payload.text || "").slice(0, 200) || "رسالة"] }, text);
    if (!r.ok && !soft(r.error)) throw new Error(r.error || "notify");
  }
}

export async function runJobs(limit = 30, businessId: string | null = null): Promise<{ done: number; failed: number }> {
  const { data: jobs, error } = await db().rpc("ihj_claim_jobs", { p_limit: limit, p_business: businessId });
  if (error) { console.error("claim", error.message); return { done: 0, failed: 0 }; }
  let done = 0, failed = 0;
  for (const j of jobs || []) {
    try {
      if (j.kind === "export") await doExport(j);
      else if (j.kind === "notify_owner" || j.kind === "notify_handoff" || j.kind === "notify_staff") await doNotify(j);
      await db().from("jobs").update({ done_at: new Date().toISOString(), last_error: "" }).eq("id", j.id);
      done++;
    } catch (e) {
      failed++;
      await db().from("jobs").update({ last_error: errMsg(e).slice(0, 300) }).eq("id", j.id);
    }
  }
  return { done, failed };
}

// إرسال تجربة تصدير فورية (من زر «جرّب» في لوحة المنشأة)
export async function exportTest(businessId: string): Promise<{ ok: boolean; status: number; error?: string }> {
  const { data: s } = await db().from("settings").select("export_kind, export_url").eq("business_id", businessId).maybeSingle();
  if (!s?.export_url) return { ok: false, status: 0, error: "no_url" };
  const body = JSON.stringify({ event: "test", sent_at: new Date().toISOString(), business: { id: businessId },
    order: { number: 1000, status: "confirmed", day: "الأحد 1 يناير", time: "4:00 م", customer_name: "تجربة", customer_phone: "", city: "", service: "", staff: "", price: null } });
  const { data: sec } = await db().from("business_secrets").select("export_secret").eq("business_id", businessId).maybeSingle();
  const sig = await hmacHex(sec?.export_secret || "", new TextEncoder().encode(body));
  try {
    const r = await fetch(s.export_url, { method: "POST", headers: { "content-type": "application/json", "x-ihj-event": "test", "x-ihj-signature": `sha256=${sig}` }, body, signal: AbortSignal.timeout(15000) });
    await r.body?.cancel().catch(() => {});
    return { ok: r.status < 400, status: r.status };
  } catch (e) { return { ok: false, status: 0, error: errMsg(e) }; }
}
