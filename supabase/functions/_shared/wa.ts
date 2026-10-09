// الإرسال لواتساب (Cloud API عبر مزوّد الربط لكل رقم) أو للمحاكي، مع السجل ونافذة 24 ساعة والقوالب
import { db, errMsg, FN_BASE } from "./util.ts";

export type Btn = { id: string; title: string };
export type Row = { id: string; title: string; desc?: string };
export type Out =
  | { t: "text"; text: string }
  | { t: "buttons"; text: string; buttons: Btn[]; header?: string; footer?: string }
  | { t: "list"; text: string; button: string; sections: { title?: string; rows: Row[] }[]; header?: string; footer?: string }
  | { t: "location_request"; text: string }
  | { t: "cta"; text: string; label: string; url: string; header?: string; footer?: string }
  | { t: "document"; url: string; filename: string; caption?: string; path?: string };

export type Purpose = "reply" | "reminder" | "on_the_way" | "arrived" | "invoice" | "paid" | "update" | "owner_reply";

export type TplCall = { name: string; params: string[]; button?: string };

const DEFAULT_BASE: Record<string, string> = {
  meta: "https://graph.facebook.com/v23.0",
  dualhook: "https://api.dualhook.com/v25.0",
  d360: "https://waba-v2.360dialog.io",
};

const cut = (s: string, n: number) => { const a = [...String(s || "")]; return a.length <= n ? a.join("") : a.slice(0, n - 1).join("") + "…"; };

export function preview(o: Out): string {
  switch (o.t) {
    case "text": return o.text;
    case "buttons": return `${o.text}\n[${o.buttons.map((b) => b.title).join("] [")}]`;
    case "list": return `${o.text}\n[${o.button}]`;
    case "location_request": return `${o.text}\n[📍]`;
    case "cta": return `${o.text}\n[${o.label}]`;
    case "document": return `📄 ${o.filename}${o.caption ? "\n" + o.caption : ""}`;
  }
}

// تحويل الرسالة لصيغة Cloud API مع حدود الطول الرسمية
export function toCloud(o: Out, to: string): Record<string, unknown> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  const hdr = (h?: string) => (h ? { header: { type: "text", text: cut(h, 60) } } : {});
  const ftr = (f?: string) => (f ? { footer: { text: cut(f, 60) } } : {});
  switch (o.t) {
    case "text":
      return { ...base, type: "text", text: { body: cut(o.text, 4096), preview_url: true } };
    case "buttons":
      return { ...base, type: "interactive", interactive: { type: "button", ...hdr(o.header), body: { text: cut(o.text, 1024) }, ...ftr(o.footer),
        action: { buttons: o.buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id.slice(0, 256), title: cut(b.title, 20) } })) } } };
    case "list": {
      let left = 10;
      const sections = o.sections.map((s) => {
        const rows = s.rows.slice(0, Math.max(0, left)); left -= rows.length;
        return { ...(s.title ? { title: cut(s.title, 24) } : {}), rows: rows.map((r) => ({ id: r.id.slice(0, 200), title: cut(r.title, 24), ...(r.desc ? { description: cut(r.desc, 72) } : {}) })) };
      }).filter((s) => s.rows.length);
      return { ...base, type: "interactive", interactive: { type: "list", ...hdr(o.header), body: { text: cut(o.text, 4096) }, ...ftr(o.footer), action: { button: cut(o.button, 20), sections } } };
    }
    case "location_request":
      return { ...base, type: "interactive", interactive: { type: "location_request_message", body: { text: cut(o.text, 1024) }, action: { name: "send_location" } } };
    case "cta":
      return { ...base, type: "interactive", interactive: { type: "cta_url", ...hdr(o.header), body: { text: cut(o.text, 1024) }, ...ftr(o.footer), action: { name: "cta_url", parameters: { display_text: cut(o.label, 20), url: o.url } } } };
    case "document":
      return { ...base, type: "document", document: { link: o.url, filename: o.filename, ...(o.caption ? { caption: cut(o.caption, 1024) } : {}) } };
  }
}

// ───────── القوالب المعتمدة (للرسائل خارج نافذة 24 ساعة) ─────────
type TplDef = { category: "UTILITY"; button?: { text: Record<string, string> }; body: Record<string, string>; example: Record<string, string[]> };
export const TEMPLATES: Record<string, TplDef> = {
  ihj_reminder: { category: "UTILITY",
    body: { ar: "تذكير بموعدك مع {{1}} ⏰\nطلب رقم {{2}}، الموعد {{3}} الساعة {{4}}.\nنشوفك على خير.", en: "A reminder of your appointment with {{1}} ⏰\nOrder {{2}}, on {{3}} at {{4}}.\nSee you soon." },
    example: { ar: ["محلك", "1001", "الأحد 12 أكتوبر", "4:00 م"], en: ["Mahalak", "1001", "Sun 12 Oct", "4:00 PM"] } },
  ihj_on_the_way: { category: "UTILITY",
    body: { ar: "مرحبا 👋 {{1}} من {{2}} في الطريق لك الحين 🚗\nطلب رقم {{3}}، نوصلك قريب.", en: "Hello 👋 {{1}} from {{2}} is on the way 🚗\nOrder {{3}}, arriving soon." },
    example: { ar: ["أحمد", "محلك", "1001"], en: ["Ahmed", "Mahalak", "1001"] } },
  ihj_arrived: { category: "UTILITY",
    body: { ar: "مرحبا 👋 وصل {{1}} من {{2}} لموقعك 📍\nطلب رقم {{3}}، شكرًا لك.", en: "Hello 👋 {{1}} from {{2}} has arrived 📍\nOrder {{3}}, thank you." },
    example: { ar: ["أحمد", "محلك", "1001"], en: ["Ahmed", "Mahalak", "1001"] } },
  ihj_invoice: { category: "UTILITY", button: { text: { ar: "عرض الفاتورة", en: "View invoice" } },
    body: { ar: "فاتورة طلبك رقم {{1}} من {{2}} 🧾\nالإجمالي {{3}} ريال، وتفاصيلها والدفع من الزر تحت.", en: "Invoice for order {{1}} from {{2}} 🧾\nTotal SAR {{3}}, details and payment are behind the button below." },
    example: { ar: ["1001", "محلك", "150"], en: ["1001", "Mahalak", "150"] } },
  ihj_paid: { category: "UTILITY",
    body: { ar: "وصلنا دفعك ✅\nشكرًا لك، طلب رقم {{1}} من {{2}} مكتمل.", en: "Payment received ✅\nThank you, order {{1}} from {{2}} is complete." },
    example: { ar: ["1001", "محلك"], en: ["1001", "Mahalak"] } },
  ihj_update: { category: "UTILITY",
    body: { ar: "تحديث على طلبك رقم {{1}} من {{2}}:\n{{3}}\nشكرًا لك.", en: "An update on your order {{1}} from {{2}}:\n{{3}}\nThank you." },
    example: { ar: ["1001", "محلك", "تم تغيير الموعد إلى الأحد 4:00 م"], en: ["1001", "Mahalak", "The time changed to Sun 4:00 PM"] } },
  ihj_new_order: { category: "UTILITY",
    body: { ar: "طلب جديد في {{1}} 🔔\nرقم {{2}}، العميل {{3}}، الموعد {{4}}.\nالتفاصيل في لوحتك.", en: "New order at {{1}} 🔔\nNo. {{2}}, customer {{3}}, time {{4}}.\nDetails are in your dashboard." },
    example: { ar: ["محلك", "1001", "سالم", "الأحد 4:00 م"], en: ["Mahalak", "1001", "Salem", "Sun 4:00 PM"] } },
  ihj_staff_order: { category: "UTILITY",
    body: { ar: "طلب جديد لك في {{1}} 🔔\nرقم {{2}}، الموعد {{3}}، {{4}}.\nالتفاصيل في لوحة الموظف.", en: "A new order for you at {{1}} 🔔\nNo. {{2}}, time {{3}}, {{4}}.\nDetails are in your staff page." },
    example: { ar: ["محلك", "1001", "الأحد 4:00 م", "الخبر"], en: ["Mahalak", "1001", "Sun 4:00 PM", "Khobar"] } },
  ihj_handoff: { category: "UTILITY",
    body: { ar: "عميل في {{1}} يحتاج رد 💬\n{{2}}: {{3}}\nرد عليه من لوحتك أو من الواتساب.", en: "A customer at {{1}} needs a reply 💬\n{{2}}: {{3}}\nReply from your dashboard or WhatsApp." },
    example: { ar: ["محلك", "سالم", "عندي سؤال عن السعر"], en: ["Mahalak", "Salem", "I have a question about the price"] } },
};

// طلب إنشاء القالب عند ميتا
export function templateCreatePayload(name: string, lang: "ar" | "en") {
  const d = TEMPLATES[name];
  const components: any[] = [];
  components.push({ type: "BODY", text: d.body[lang], example: { body_text: [d.example[lang]] } });
  if (d.button) components.push({ type: "BUTTONS", buttons: [{ type: "URL", text: d.button.text[lang], url: `${FN_BASE}/pay/go/{{1}}`, example: [`${FN_BASE}/pay/go/example`] }] });
  return { name, language: lang, category: d.category, components };
}

function templateSendPayload(call: TplCall, lang: string, to: string) {
  const components: any[] = [];
  components.push({ type: "body", parameters: call.params.map((p) => ({ type: "text", text: cut(String(p ?? ""), 400).replace(/\n+/g, " ") })) });
  if (call.button) components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: call.button }] });
  return { messaging_product: "whatsapp", recipient_type: "individual", to, type: "template", template: { name: call.name, language: { code: lang }, components } };
}

const approved = (channel: any, name: string, lang: string) =>
  Array.isArray(channel?.templates) && channel.templates.some((t: any) => t.name === name && t.language === lang && String(t.status).toUpperCase() === "APPROVED");

// ───────── الاتصال بالمزوّد ─────────
export async function providerFetch(channel: any, secrets: any, path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; json: any }> {
  const base = (channel.api_base || DEFAULT_BASE[channel.provider] || "").replace(/\/$/, "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (channel.provider === "d360") headers["D360-API-KEY"] = secrets.wa_token; else headers.authorization = `Bearer ${secrets.wa_token}`;
  try {
    const r = await fetch(base + path, { ...init, headers: { ...headers, ...(init.headers as any || {}) }, signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, json: j };
  } catch (e) { return { ok: false, status: 0, json: { error: { message: errMsg(e) } } }; }
}

const messagesPath = (channel: any) => channel.provider === "d360" ? "/messages" : `/${channel.phone_number_id}/messages`;

async function postMessage(channel: any, secrets: any, payload: any): Promise<{ ok: boolean; id?: string; error?: string }> {
  const r = await providerFetch(channel, secrets, messagesPath(channel), { method: "POST", body: JSON.stringify(payload) });
  if (!r.ok) {
    const e = r.json?.error || r.json?.errors?.[0] || {};
    return { ok: false, error: `${r.status} ${e.code ?? ""} ${e.message ?? e.title ?? ""}`.trim().slice(0, 300) };
  }
  return { ok: true, id: r.json?.messages?.[0]?.id };
}

export async function markRead(channel: any, secrets: any, msgId: string) {
  if (!channel || channel.status !== "connected" || channel.dry_run || !msgId) return;
  await providerFetch(channel, secrets, messagesPath(channel), { method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: msgId, typing_indicator: { type: "text" } }) });
}

const secretsCache = new Map<string, { at: number; v: any }>();
export async function loadSecrets(businessId: string): Promise<any> {
  const c = secretsCache.get(businessId);
  if (c && Date.now() - c.at < 60_000) return c.v;
  const { data } = await db().from("business_secrets").select("*").eq("business_id", businessId).maybeSingle();
  secretsCache.set(businessId, { at: Date.now(), v: data || {} });
  return data || {};
}

export const windowOpen = (customer: any) =>
  !!customer?.last_inbound_at && Date.now() - new Date(customer.last_inbound_at).getTime() < 23.8 * 3600_000;

export type SendResult = { ok: boolean; ids: number[]; error?: string; mode: "sim" | "sent" | "template" | "logged" | "failed" };

// يرسل رسائل لعميل: المحاكي يسجّل فقط، والرقم المربوط يرسل فعليًا (أو قالب خارج النافذة)
export async function sendToCustomer(business: any, channel: any, customer: any, outs: Out[],
  opts: { purpose: Purpose; by?: string; template?: TplCall } = { purpose: "reply" }): Promise<SendResult> {
  const by = opts.by || "bot";
  const ids: number[] = [];
  const rows: any[] = [];
  const isSim = !!customer.is_sim;
  if (isSim) {
    for (const o of outs) rows.push({ business_id: business.id, customer_id: customer.id, direction: "out", channel: "sim", kind: o.t, body: o, preview: preview(o).slice(0, 500), status: "sim", by_who: by });
    const { data, error } = await db().from("wa_log").insert(rows).select("id");
    if (error) return { ok: false, ids, error: error.message, mode: "failed" };
    await db().from("customers").update({ last_outbound_at: new Date().toISOString() }).eq("id", customer.id);
    return { ok: true, ids: (data || []).map((x: any) => x.id), mode: "sim" };
  }
  const connected = channel && channel.provider !== "none" && channel.status === "connected";
  const open = windowOpen(customer) || opts.purpose === "reply";
  const lang = customer.lang === "en" ? "en" : "ar";
  let mode: SendResult["mode"] = "sent";
  let lastErr = "";
  const secrets = connected ? await loadSecrets(business.id) : {};
  const queue: { payload: any; o: Out | null; kind: string; prev: string }[] = [];
  if (open) {
    for (const o of outs) queue.push({ payload: toCloud(o, customer.wa_id), o, kind: o.t, prev: preview(o) });
  } else if (opts.template && approved(channel, opts.template.name, lang)) {
    mode = "template";
    queue.push({ payload: templateSendPayload(opts.template, lang, customer.wa_id), o: null, kind: "template", prev: `[${opts.template.name}] ${opts.template.params.join(" | ")}` });
  } else {
    mode = "failed";
    lastErr = opts.template ? `template_not_approved:${opts.template.name}:${lang}` : "window_closed";
    for (const o of outs) queue.push({ payload: null, o, kind: o.t, prev: preview(o) });
  }
  for (const q of queue) {
    let status = "logged", error = "", wamid: string | null = null;
    if (mode === "failed") { status = "failed"; error = lastErr; }
    else if (!connected) { status = "not_connected"; mode = "logged"; }
    else if (channel.dry_run) { status = "dry_run"; }
    else {
      const r = await postMessage(channel, secrets, q.payload);
      if (r.ok) { status = "sent"; wamid = r.id || null; } else { status = "failed"; error = r.error || "send"; lastErr = error; mode = "failed"; }
    }
    const { data } = await db().from("wa_log").insert({ business_id: business.id, customer_id: customer.id, direction: "out", channel: "wa", kind: q.kind,
      body: q.o || q.payload, preview: q.prev.slice(0, 500), wa_msg_id: wamid, status, error, by_who: by }).select("id").single();
    if (data) ids.push(data.id);
  }
  await db().from("customers").update({ last_outbound_at: new Date().toISOString() }).eq("id", customer.id);
  return { ok: mode !== "failed", ids, error: lastErr || undefined, mode };
}

// تنبيه على رقم المالك أو الموظف (قالب، لأنهم عادة خارج نافذة الـ24 ساعة)
export async function sendToOwner(business: any, channel: any, tpl: TplCall, text: string): Promise<SendResult> {
  return await sendToNumber(business, channel, business.owner_phone, tpl, text);
}

export async function sendToNumber(business: any, channel: any, to: string, tpl: TplCall, text: string): Promise<SendResult> {
  const row: any = { business_id: business.id, customer_id: null, direction: "out", channel: "wa", kind: "template", body: { to, template: tpl, text }, preview: text.slice(0, 500), by_who: "system" };
  if (!to) return { ok: false, ids: [], error: "no_phone", mode: "failed" };
  const connected = channel && channel.provider !== "none" && channel.status === "connected";
  if (!connected) { row.status = "not_connected"; }
  else if (!approved(channel, tpl.name, "ar")) { row.status = "failed"; row.error = `template_not_approved:${tpl.name}:ar`; }
  else if (channel.dry_run) { row.status = "dry_run"; }
  else {
    const r = await postMessage(channel, await loadSecrets(business.id), templateSendPayload(tpl, "ar", to));
    row.status = r.ok ? "sent" : "failed"; row.error = r.error || ""; row.wa_msg_id = r.id || null;
  }
  const { data } = await db().from("wa_log").insert(row).select("id").single();
  return { ok: row.status !== "failed", ids: data ? [data.id] : [], error: row.error, mode: row.status === "sent" ? "template" : row.status === "failed" ? "failed" : "logged" };
}
