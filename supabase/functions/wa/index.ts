// دالة واتساب العامة لكل المنشآت:
//   GET/POST /wa/hook/<مفتاح المنشأة>   ويبهوك المزوّد (Cloud API) لكل رقم، والمنشأة تنعرف من المفتاح أو من phone_number_id
//   GET/POST /wa/hook                    ويبهوك مشترك (تطبيق ميتا واحد للمنصة) والمنشأة تنعرف من رقمها
//   POST /wa/sim  ·  GET /wa/sim  ·  POST /wa/sim/reset  ·  GET /wa/sim/info   محاكي الواتساب (بدون إرسال حقيقي)
import { background, clip, clipLines, CORS, db, errMsg, hmacHex, ipOf, json, limiter, readJson, routeParts, sameSecret } from "../_shared/util.ts";
import { handleMessage, type Inbound, loadCtx } from "../_shared/bot.ts";
import { loadSecrets, markRead } from "../_shared/wa.ts";

const SHARED_APP_SECRET = Deno.env.get("WA_APP_SECRET") || "";
const SHARED_VERIFY = Deno.env.get("WA_VERIFY_TOKEN") || "";
const simLimit = limiter(240, 600_000);
const badHook = limiter(30, 3600_000);

const KIND_AR: Record<string, string> = { image: "[صورة]", audio: "[رسالة صوتية]", video: "[فيديو]", document: "[ملف]", sticker: "[ملصق]", contacts: "[جهة اتصال]" };

export function parseInbound(m: any): Inbound | null {
  switch (m?.type) {
    case "text": return { type: "text", text: String(m.text?.body || "").slice(0, 2000) };
    case "interactive": {
      const r = m.interactive?.button_reply || m.interactive?.list_reply;
      if (r) return { type: "reply", id: String(r.id || ""), title: String(r.title || "") };
      if (m.interactive?.nfm_reply) return { type: "other", kindLabel: "[نموذج]" };
      return null;
    }
    case "button": return { type: "reply", id: String(m.button?.payload || ""), title: String(m.button?.text || "") };
    case "location": return { type: "location", lat: Number(m.location?.latitude), lng: Number(m.location?.longitude), name: m.location?.name || "", address: m.location?.address || "" };
    case "image": case "video": case "document":
      if (m[m.type]?.caption) return { type: "text", text: String(m[m.type].caption).slice(0, 2000) };
      return { type: "other", kindLabel: KIND_AR[m.type] };
    case "audio": case "sticker": case "contacts": return { type: "other", kindLabel: KIND_AR[m.type] };
    default: return null; // reaction / system / unsupported: بدون رد
  }
}

const previewIn = (m: any, p: Inbound | null) =>
  p?.type === "text" ? p.text! : p?.type === "reply" ? `[${p.title}]` : p?.type === "location" ? `📍 ${p.lat},${p.lng}` : (p?.kindLabel || `[${m?.type}]`);

// ───────── ويبهوك المزوّد ─────────
const hookCache = new Map<string, { at: number; v: any }>();
async function businessByHookKey(key: string) {
  const c = hookCache.get(key);
  if (c && Date.now() - c.at < 60_000) return c.v;
  const { data } = await db().from("business_secrets").select("business_id, wa_app_secret, wa_verify_token").eq("wa_hook_key", key).maybeSingle();
  hookCache.set(key, { at: Date.now(), v: data });
  return data;
}

async function businessByPhoneId(phoneId: string) {
  const { data } = await db().from("channels").select("business_id").eq("phone_number_id", phoneId).maybeSingle();
  return data?.business_id || null;
}

async function processMessage(businessId: string, value: any, m: any) {
  const p = parseInbound(m);
  const ts = Number(m.timestamp || 0);
  if (ts && Date.now() / 1000 - ts > 900) return; // أقدم من 15 دقيقة (إعادة إرسال قديمة)
  const from = String(m.from || "");
  if (!/^\d{6,16}$/.test(from)) return;
  const name = clip(value?.contacts?.find((c: any) => c.wa_id === from)?.profile?.name || "", 60);
  const ctx = await loadCtx(businessId, from, false, name);
  const { error } = await db().from("wa_log").insert({ business_id: businessId, customer_id: ctx.customer.id, direction: "in", channel: "wa", kind: String(m.type || ""),
    body: m, preview: previewIn(m, p).slice(0, 500), wa_msg_id: String(m.id || "") || null, status: "received", by_who: "customer" });
  if (error) { if (/duplicate|unique/i.test(error.message)) return; throw new Error(error.message); }
  if (!p) return;
  if (ctx.channel?.status === "connected" && !ctx.channel?.dry_run) background(loadSecrets(businessId).then((s) => markRead(ctx.channel, s, m.id)));
  await handleMessage(ctx, p);
}

async function processStatus(st: any) {
  const id = String(st?.id || "");
  if (!id) return;
  const err = st.errors?.[0] ? `${st.errors[0].code ?? ""} ${st.errors[0].title ?? st.errors[0].message ?? ""}`.trim() : "";
  const order: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 9 };
  const { data: row } = await db().from("wa_log").select("id, status").eq("wa_msg_id", id).eq("direction", "out").maybeSingle();
  if (!row) return;
  if ((order[st.status] || 0) <= (order[row.status] || 0) && st.status !== "failed") return;
  await db().from("wa_log").update({ status: String(st.status || ""), error: err.slice(0, 300) }).eq("id", row.id);
}

// صاحب المحل رد بنفسه من تطبيق واتساب بزنس (Coexistence): نوقف البوت عن هذا العميل عشان ما يتداخلون
async function processEcho(businessId: string, e: any) {
  const to = String(e?.to || "");
  if (!/^\d{6,16}$/.test(to)) return;
  const { data: c } = await db().from("customers").select("id, bot_paused").eq("business_id", businessId).eq("wa_id", to).maybeSingle();
  if (!c) return;
  const text = e?.text?.body || `[${e?.type || "رسالة"}]`;
  await db().from("wa_log").insert({ business_id: businessId, customer_id: c.id, direction: "out", channel: "wa", kind: "echo", body: e, preview: String(text).slice(0, 500), wa_msg_id: e?.id || null, status: "sent", by_who: "owner" });
  if (!c.bot_paused) await db().from("customers").update({ bot_paused: true, paused_at: new Date().toISOString(), paused_reason: "owner_replied", state: "idle", state_data: {} }).eq("id", c.id);
}

async function processPayload(fixedBusiness: string | null, body: any) {
  for (const entry of body?.entry || []) {
    for (const ch of entry?.changes || []) {
      const v = ch?.value || {};
      const phoneId = String(v?.metadata?.phone_number_id || "");
      let biz = fixedBusiness;
      if (!biz && phoneId) biz = await businessByPhoneId(phoneId);
      if (!biz) continue;
      if (fixedBusiness && phoneId) {
        const { data: chn } = await db().from("channels").select("phone_number_id").eq("business_id", fixedBusiness).maybeSingle();
        if (chn?.phone_number_id && chn.phone_number_id !== phoneId) { console.warn("phone mismatch", phoneId); continue; }
      }
      if (ch.field === "messages" || !ch.field) {
        for (const st of v.statuses || []) await processStatus(st).catch((e) => console.error("status", errMsg(e)));
        for (const m of v.messages || []) await processMessage(biz, v, m).catch((e) => console.error("msg", errMsg(e)));
      } else if (ch.field === "smb_message_echoes") {
        for (const e of v.message_echoes || []) await processEcho(biz, e).catch((x) => console.error("echo", errMsg(x)));
      }
    }
  }
}

async function hook(req: Request, key: string): Promise<Response> {
  const url = new URL(req.url);
  const ip = ipOf(req);
  let sec: any = null;
  if (key) {
    if (!/^[0-9a-f]{20,64}$/.test(key)) return json({ ok: false }, 404);
    sec = await businessByHookKey(key);
    if (!sec) { badHook(ip); return json({ ok: false }, 404); }
  }
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode"), tok = url.searchParams.get("hub.verify_token") || "", chal = url.searchParams.get("hub.challenge") || "";
    const want = sec ? sec.wa_verify_token : SHARED_VERIFY;
    if (mode === "subscribe" && sameSecret(tok, want)) return new Response(chal, { status: 200, headers: { "content-type": "text/plain" } });
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return json({ ok: false }, 405);
  const raw = new Uint8Array(await req.arrayBuffer());
  const appSecret = sec ? sec.wa_app_secret : SHARED_APP_SECRET;
  if (appSecret) {
    const sig = (req.headers.get("x-hub-signature-256") || "").replace(/^sha256=/, "");
    const want = await hmacHex(appSecret, raw);
    if (!sameSecret(sig, want)) return json({ ok: false, error: "signature" }, 401);
  } else if (!sec) {
    return json({ ok: false, error: "no_secret" }, 401); // الرابط المشترك لازم توقيع
  }
  let body: any = null;
  try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { return json({ ok: false }, 400); }
  const work = processPayload(sec ? sec.business_id : null, body);
  if ((globalThis as any).EdgeRuntime?.waitUntil) { background(work); return json({ ok: true }); }
  await work.catch((e) => console.error("hook", errMsg(e)));
  return json({ ok: true });
}

// ───────── المحاكي ─────────
async function simBusiness(slug: string, key: string) {
  if (!/^[a-z0-9-]{2,42}$/.test(slug) || !key) return null;
  const { data } = await db().from("businesses").select("id, slug, name, name_en, logo_url, brand_color, sim_key, city, status, bot_enabled").eq("slug", slug).maybeSingle();
  if (!data || !sameSecret(key, data.sim_key)) return null;
  return data;
}

const SIM_FROM = /^sim-[a-z0-9]{6,24}$/;

async function simMessages(customerId: string, after: number) {
  const { data } = await db().from("wa_log").select("id, direction, kind, body, preview, created_at, by_who, status")
    .eq("customer_id", customerId).gt("id", after).order("id").limit(200);
  return data || [];
}

async function sim(req: Request, sub: string): Promise<Response> {
  const url = new URL(req.url);
  const ip = ipOf(req);
  if (simLimit(ip)) return json({ ok: false, error: "busy" }, 429);
  const q = req.method === "GET" ? Object.fromEntries(url.searchParams) : (await readJson(req) || {});
  const biz = await simBusiness(String(q.b || ""), String(q.k || ""));
  if (!biz) return json({ ok: false, error: "unauthorized" }, 401);

  if (sub === "info") {
    const [{ data: cities }, { data: st }, { data: svcs }] = await Promise.all([
      db().from("cities").select("name, lat, lng, radius_km").eq("business_id", biz.id).eq("active", true).order("sort"),
      db().from("settings").select("place_mode, pay_timing, tone, faq, menu").eq("business_id", biz.id).maybeSingle(),
      db().from("services").select("name, price").eq("business_id", biz.id).eq("active", true).order("sort"),
    ]);
    const faqQ = (Array.isArray(st?.faq) ? st.faq : []).map((e: any) => String(e?.chip || String(e?.q || "").split(/[,،]/)[0] || "").trim()).filter(Boolean).slice(0, 6);
    return json({ ok: true, business: { name: biz.name, name_en: biz.name_en, logo_url: biz.logo_url, brand_color: biz.brand_color, city: biz.city, bot_enabled: biz.bot_enabled, status: biz.status, activity: biz.activity },
      cities: cities || [], defaults: { place: st?.place_mode || "visit", pay: st?.pay_timing || "after", tone: st?.tone || "friendly", menu: st?.menu || {} }, faq: faqQ, services: svcs || [] });
  }
  const from = String(q.from || "");
  if (!SIM_FROM.test(from)) return json({ ok: false, error: "from" }, 400);

  if (sub === "config") {
    const c = q.cfg || {};
    const cfg: Record<string, unknown> = {};
    const name = clip(c.name, 40); if (name.length >= 2) cfg.name = name;
    if (["visit", "shop", "online"].includes(c.place)) cfg.place = c.place;
    if (["after", "before", "none"].includes(c.pay)) cfg.pay = c.pay;
    if (["friendly", "formal", "short"].includes(c.tone)) cfg.tone = c.tone;
    const welcome = clipLines(c.welcome, 300); if (welcome.length >= 2) cfg.welcome = welcome;
    const okKey = (x: unknown) => typeof x === "string" && /^(book|orders|prices|location|hours|services|pay|contact|lang|faq:\d{1,2})$/.test(x);
    if (c.menu && typeof c.menu === "object") {
      const main = Array.isArray(c.menu.main) ? c.menu.main.filter(okKey).slice(0, 9) : [], after = Array.isArray(c.menu.after) ? c.menu.after.filter(okKey).slice(0, 3) : [];
      if (main.length || after.length) (cfg as any).menu = { main, after };
    }
    if (Array.isArray(c.faq)) {
      const faq = c.faq.slice(0, 6).map((e: any) => ({ chip: clip(e?.chip, 20), q: clip(e?.q, 120) || clip(e?.chip, 20).replace(/[؟?]/g, ""), a: clipLines(e?.a, 500) })).filter((e: any) => e.chip && e.a);
      if (faq.length) (cfg as any).faq = faq;
    }
    if (c.answers && typeof c.answers === "object") {
      const answers: Record<string, string> = {};
      for (const k of ["prices", "location_text", "hours_text", "pay_text"]) { const v = clipLines(c.answers[k], 500); if (v) answers[k] = v; }
      if (Object.keys(answers).length) (cfg as any).answers = answers;
    }
    const ctx = await loadCtx(biz.id, from, true, "");
    await db().from("customers").update({ sim_config: cfg, state: "idle", state_data: {}, misses: 0, bot_paused: false, paused_at: null, paused_reason: "", last_inbound_at: null, last_outbound_at: null }).eq("id", ctx.customer.id);
    await db().from("handoffs").update({ resolved_at: new Date().toISOString(), resolved_by: "sim_config" }).eq("customer_id", ctx.customer.id).is("resolved_at", null);
    return json({ ok: true, cfg });
  }

  if (sub === "reset") {
    const { data: c } = await db().from("customers").select("id").eq("business_id", biz.id).eq("wa_id", from).maybeSingle();
    if (c) await db().from("customers").update({ state: "idle", state_data: {}, misses: 0, bot_paused: false, paused_at: null, paused_reason: "", last_inbound_at: null, last_outbound_at: null }).eq("id", c.id);
    if (c) await db().from("handoffs").update({ resolved_at: new Date().toISOString(), resolved_by: "sim_reset" }).eq("customer_id", c.id).is("resolved_at", null);
    return json({ ok: true });
  }

  if (req.method === "GET") {
    const { data: c } = await db().from("customers").select("id, bot_paused, lang, sim_config").eq("business_id", biz.id).eq("wa_id", from).maybeSingle();
    if (!c) return json({ ok: true, messages: [], paused: false, cfg: {} });
    return json({ ok: true, messages: await simMessages(c.id, Number(q.after || 0)), paused: c.bot_paused, lang: c.lang, cfg: c.sim_config || {} });
  }

  // رسالة من «العميل» في المحاكي
  const m = q.msg || {};
  let p: Inbound | null = null;
  if (m.type === "text") p = { type: "text", text: clip(m.text, 1000) };
  else if (m.type === "reply") p = { type: "reply", id: String(m.id || "").slice(0, 256), title: clip(m.title, 40) };
  else if (m.type === "location") p = { type: "location", lat: Number(m.lat), lng: Number(m.lng), name: clip(m.name, 60), address: clip(m.address, 120) };
  else if (m.type === "other") p = { type: "other", kindLabel: clip(m.label || "[صورة]", 30) };
  if (!p || (p.type === "text" && !p.text) || (p.type === "location" && (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)))) return json({ ok: false, error: "msg" }, 400);
  const ctx = await loadCtx(biz.id, from, true, clip(q.name || "", 40));
  const { data: inRow } = await db().from("wa_log").insert({ business_id: biz.id, customer_id: ctx.customer.id, direction: "in", channel: "sim", kind: p.type,
    body: p, preview: previewIn(null, p).slice(0, 500), status: "sim", by_who: "customer" }).select("id").single();
  await handleMessage(ctx, p);
  const { data: c2 } = await db().from("customers").select("bot_paused").eq("id", ctx.customer.id).maybeSingle();
  return json({ ok: true, in_id: inRow?.id || 0, messages: await simMessages(ctx.customer.id, (inRow?.id || 1) - 1), paused: !!c2?.bot_paused });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const parts = routeParts(req, "wa");
  try {
    if (parts[0] === "hook") return await hook(req, parts[1] || "");
    if (parts[0] === "sim") return await sim(req, parts[1] || "");
    if (parts[0] === "health") return json({ ok: true });
    return json({ ok: false, error: "not_found" }, 404);
  } catch (e) {
    console.error("wa", errMsg(e));
    return json({ ok: false, error: "server" }, 500);
  }
});
