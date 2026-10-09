// دالة اللوحات: الدخول بالروابط الخاصة، وأوامر المالك والموظف والمدير
//   POST /api/link {token}                      رابط خاص ← رمز جلسة (بدون كلمة مرور)
//   POST /api/me                                 من أنا ووش منشآتي
//   POST /api/order/<on_the_way|arrived|invoice|cash|done|cancel|reschedule|assign|pdf>
//   POST /api/slots · /api/customer/<reply|resume|pause> · /api/biz/<logo|payment-keys|payment-status|export-test|staff-link|link-revoke|report>
//   POST /api/admin/<business/create|channel/save|channel/test|channel/info|templates/sync|templates/create|link/create|link/revoke|demo/reset>
//   POST /api/hook-sink/<business_id>            مستقبل تجربة التصدير (للمنشآت التجريبية فقط)
import { clip, clipLines, CORS, db, errMsg, FN_BASE, intl, ipOf, json, limiter, readJson, routeParts, saudi, SITE_URL, SUPABASE_URL } from "../_shared/util.ts";
import { createLink, exchangeLink, isMember, isOwner, revokeLink, rolesFromReq, type Roles, staffIdOf } from "../_shared/auth.ts";
import { actArrived, actAssign, actCancelByBiz, actCash, actDone, actInvoice, actOnTheWay, actReschedByBiz, AppError, type Full, orderFull, signedPdf } from "../_shared/actions.ts";
import { loadSecrets, providerFetch, sendToCustomer, TEMPLATES, templateCreatePayload } from "../_shared/wa.ts";
import { exportTest } from "../_shared/events.ts";
import { mask, moyasarCheckKey } from "../_shared/pay.ts";

const badLink = limiter(30, 3600_000);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const need = (cond: unknown, code = "forbidden", status = 403) => { if (!cond) throw new AppError(code, status); };
const uuid = (v: unknown, code = "id") => { const s = String(v || ""); need(UUID.test(s), code, 400); return s; };

// الموظف يتحكم بطلباته فقط، والمالك والمدير بكل طلبات المنشأة
async function orderFor(r: Roles, orderId: string, ownerOnly = false): Promise<Full> {
  const f = await orderFull(uuid(orderId, "order_id"));
  if (isOwner(r, f.b.id)) return f;
  need(!ownerOnly);
  const sid = staffIdOf(r, f.b.id);
  need(sid && f.o.staff_id === sid);
  return f;
}

const who = (r: Roles, f: Full) => r.admin ? "admin" : isOwner(r, f.b.id) ? "owner" : `staff:${f.o.staff?.name || ""}`;

async function bizRow(id: string) {
  const { data } = await db().from("businesses").select("*").eq("id", id).maybeSingle();
  need(data, "not_found", 404);
  return data;
}

const linkUrl = (page: string, tok: string) => `${SITE_URL}${page}#k=${tok}`;
const simUrl = (b: any) => `${SITE_URL}sim.html?b=${b.slug}&k=${b.sim_key}`;

// ───────── المالك والموظف ─────────
async function orderAction(r: Roles, action: string, body: any) {
  const ownerOnly = ["cancel", "reschedule", "assign"].includes(action);
  const f = await orderFor(r, body.order_id, ownerOnly);
  const by = who(r, f);
  switch (action) {
    case "on_the_way": return { send: await actOnTheWay(f, by) };
    case "arrived": return { send: await actArrived(f, by) };
    case "invoice": return await actInvoice(f, body.items, by);
    case "cash": return await actCash(f, String(body.method || "cash"), by);
    case "done": return { send: await actDone(f, by) };
    case "cancel": return { send: await actCancelByBiz(f, clip(body.reason, 200), by, body.notify !== false) };
    case "reschedule": { need(!isNaN(Date.parse(body.start)), "start", 400); return { send: await actReschedByBiz(f, new Date(body.start).toISOString(), by) }; }
    case "assign": { await actAssign(f, body.staff_id ? uuid(body.staff_id, "staff") : null, by); return {}; }
    case "pdf": {
      const { data: inv } = await db().from("invoices").select("*").eq("order_id", f.o.id).neq("status", "void").order("created_at", { ascending: false }).limit(1).maybeSingle();
      need(inv?.pdf_path, "no_invoice", 404);
      return { url: await signedPdf(inv.pdf_path, 3600), invoice: { number: inv.number, total: inv.total, status: inv.status } };
    }
  }
  throw new AppError("not_found", 404);
}

async function customerAction(r: Roles, action: string, body: any) {
  const { data: c } = await db().from("customers").select("*").eq("id", uuid(body.customer_id, "customer_id")).maybeSingle();
  need(c, "not_found", 404);
  need(isOwner(r, c.business_id));
  if (action === "resume") {
    await db().from("customers").update({ bot_paused: false, paused_at: null, paused_reason: "", state: "idle", state_data: {}, misses: 0 }).eq("id", c.id);
    await db().from("handoffs").update({ resolved_at: new Date().toISOString(), resolved_by: r.admin ? "admin" : "owner" }).eq("customer_id", c.id).is("resolved_at", null);
    return {};
  }
  if (action === "pause") {
    await db().from("customers").update({ bot_paused: true, paused_at: new Date().toISOString(), paused_reason: "owner" }).eq("id", c.id);
    return {};
  }
  if (action === "reply") {
    const text = clipLines(body.text, 1500);
    need(text, "text", 400);
    const [{ data: b }, { data: ch }] = await Promise.all([
      db().from("businesses").select("*").eq("id", c.business_id).single(),
      db().from("channels").select("*").eq("business_id", c.business_id).maybeSingle(),
    ]);
    if (!c.bot_paused) await db().from("customers").update({ bot_paused: true, paused_at: new Date().toISOString(), paused_reason: "owner" }).eq("id", c.id);
    const res = await sendToCustomer(b, ch || {}, c, [{ t: "text", text }], { purpose: "owner_reply", by: "owner" });
    if (!res.ok) throw new AppError(res.error === "window_closed" ? "window_closed" : "send_failed", 409);
    return { send: res };
  }
  throw new AppError("not_found", 404);
}

async function bizAction(r: Roles, action: string, body: any) {
  const bizId = uuid(body.business_id, "business_id");
  need(isOwner(r, bizId));
  const b = await bizRow(bizId);
  switch (action) {
    case "logo": {
      const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data_url || ""));
      need(m, "image", 400);
      const bytes = Uint8Array.from(atob(m![2]), (ch) => ch.charCodeAt(0));
      need(bytes.length <= 700_000, "too_big", 400);
      const path = `logos/${bizId}/${Date.now()}.${m![1] === "png" ? "png" : "jpg"}`;
      const { error } = await db().storage.from("public").upload(path, bytes, { contentType: `image/${m![1]}`, upsert: true });
      if (error) throw new Error(error.message);
      const url = `${SUPABASE_URL}/storage/v1/object/public/public/${path}`;
      await db().from("businesses").update({ logo_url: url }).eq("id", bizId);
      return { logo_url: url };
    }
    case "payment-keys": {
      need(b.plan === "bot_pay" || b.is_demo, "plan", 409);
      const sk = String(body.sk || "").trim(), pk = String(body.pk || "").trim();
      if (!sk && !pk && body.clear) {
        await db().from("business_secrets").update({ moyasar_sk: "", moyasar_pk: "" }).eq("business_id", bizId);
        await db().from("settings").update({ pay_provider: b.is_demo ? "demo" : "none" }).eq("business_id", bizId);
        return { moyasar: "" };
      }
      need(/^sk_(live|test)_[A-Za-z0-9]{10,}$/.test(sk), "sk", 400);
      need(!pk || /^pk_(live|test)_[A-Za-z0-9]{10,}$/.test(pk), "pk", 400);
      need(await moyasarCheckKey(sk), "sk_rejected", 400);
      await db().from("business_secrets").update({ moyasar_sk: sk, moyasar_pk: pk }).eq("business_id", bizId);
      await db().from("settings").update({ pay_provider: "moyasar" }).eq("business_id", bizId);
      return { moyasar: mask(sk), test_mode: sk.startsWith("sk_test_") };
    }
    case "payment-status": {
      const sec = await loadSecrets(bizId);
      const { data: s } = await db().from("settings").select("pay_provider").eq("business_id", bizId).single();
      return { provider: s?.pay_provider, moyasar: mask(sec?.moyasar_sk || ""), test_mode: String(sec?.moyasar_sk || "").startsWith("sk_test_") };
    }
    case "export-test": return await exportTest(bizId);
    case "export-info": {
      const { data: sec } = await db().from("business_secrets").select("export_secret").eq("business_id", bizId).single();
      return { secret: sec?.export_secret || "" };
    }
    case "staff-link": {
      const sid = uuid(body.staff_id, "staff_id");
      const { data: st } = await db().from("staff").select("id, name").eq("id", sid).eq("business_id", bizId).maybeSingle();
      need(st, "staff", 404);
      const l = await createLink("staff", bizId, sid, st.name);
      return { id: l.id, url: linkUrl(l.page, l.token) };
    }
    case "link-revoke": {
      const { data: l } = await db().from("access_links").select("id, business_id, kind").eq("id", uuid(body.link_id, "link_id")).maybeSingle();
      need(l && l.business_id === bizId && (l.kind === "staff" || r.admin));
      await revokeLink(l.id);
      return {};
    }
    case "report": {
      const month = /^\d{4}-\d{2}$/.test(String(body.month || "")) ? `${body.month}-01` : new Date().toISOString().slice(0, 8) + "01";
      const { data, error } = await db().rpc("ihj_report", { p_business: bizId, p_month: month });
      if (error) throw new Error(error.message);
      return { report: data };
    }
    case "slots": {
      const { data, error } = await db().rpc("ihj_free_slots", { p_business: bizId, p_city: body.city_id || null, p_service: body.service_id || null,
        p_from: /^\d{4}-\d{2}-\d{2}$/.test(String(body.from || "")) ? body.from : new Date().toISOString().slice(0, 10), p_days: Math.min(14, Math.max(1, Number(body.days) || 7)), p_exclude: body.exclude || null });
      if (error) throw new Error(error.message);
      return { slots: data || [] };
    }
  }
  throw new AppError("not_found", 404);
}

// ───────── المدير ─────────
const DEFAULT_BASE: Record<string, string> = { meta: "https://graph.facebook.com/v23.0", dualhook: "https://api.dualhook.com/v25.0", d360: "https://waba-v2.360dialog.io" };

async function channelTest(bizId: string) {
  const { data: ch } = await db().from("channels").select("*").eq("business_id", bizId).single();
  const sec = await loadSecrets(bizId);
  const patch: any = { last_check_at: new Date().toISOString() };
  if (ch.provider === "none" || !sec?.wa_token) {
    Object.assign(patch, { status: "not_connected", last_error: ch.provider === "none" ? "" : "no_token" });
  } else if (ch.provider === "d360") {
    const r = await providerFetch(ch, sec, "/v1/configs/webhook", { method: "GET" });
    Object.assign(patch, r.ok ? { status: "connected", last_error: "" } : { status: "error", last_error: `${r.status} ${JSON.stringify(r.json).slice(0, 200)}` });
  } else {
    if (!ch.phone_number_id) Object.assign(patch, { status: "error", last_error: "no_phone_number_id" });
    else {
      const r = await providerFetch(ch, sec, `/${ch.phone_number_id}?fields=display_phone_number,verified_name,name_status,quality_rating,code_verification_status`, { method: "GET" });
      if (r.ok) Object.assign(patch, { status: "connected", last_error: "", display_phone: r.json.display_phone_number || "", verified_name: r.json.verified_name || "", name_status: r.json.name_status || "", quality: r.json.quality_rating || "" });
      else Object.assign(patch, { status: "error", last_error: `${r.status} ${r.json?.error?.message || ""}`.slice(0, 300) });
    }
  }
  await db().from("channels").update(patch).eq("business_id", bizId);
  return { ...ch, ...patch };
}

async function templatesSync(bizId: string) {
  const { data: ch } = await db().from("channels").select("*").eq("business_id", bizId).single();
  const sec = await loadSecrets(bizId);
  need(ch.provider !== "none" && sec?.wa_token, "not_connected", 409);
  let list: any[] = [];
  if (ch.provider === "d360") {
    const r = await providerFetch(ch, sec, "/v1/configs/templates", { method: "GET" });
    need(r.ok, "templates_fetch", 502);
    list = r.json?.waba_templates || r.json?.data || [];
  } else {
    need(ch.waba_id, "no_waba", 409);
    const r = await providerFetch(ch, sec, `/${ch.waba_id}/message_templates?fields=name,status,language,category&limit=200`, { method: "GET" });
    need(r.ok, "templates_fetch", 502);
    list = r.json?.data || [];
  }
  const mine = list.filter((t: any) => String(t.name || "").startsWith("ihj_")).map((t: any) => ({ name: t.name, language: t.language, status: String(t.status || "").toUpperCase(), category: t.category || "" }));
  await db().from("channels").update({ templates: mine, templates_checked_at: new Date().toISOString() }).eq("business_id", bizId);
  return mine;
}

async function adminAction(r: Roles, action: string, body: any) {
  need(r.admin);
  switch (action) {
    case "business/create": {
      const p: any = {
        name: clip(body.name, 80), name_en: clip(body.name_en, 80), slug: clip(body.slug, 40), activity: clip(body.activity, 60), city: clip(body.city, 60),
        wa_number: intl(body.wa_number), owner_name: clip(body.owner_name, 60), owner_phone: saudi(body.owner_phone) || intl(body.owner_phone),
        plan: body.plan === "bot_pay" ? "bot_pay" : "bot", wants_app: !!body.wants_app, is_demo: !!body.is_demo,
        cr_number: clip(body.cr_number, 20), vat_number: clip(body.vat_number, 20), address: clip(body.address, 120), brand_color: /^#[0-9A-Fa-f]{6}$/.test(body.brand_color || "") ? body.brand_color : "",
        lead_id: UUID.test(String(body.lead_id || "")) ? body.lead_id : "",
        cities: (Array.isArray(body.cities) ? body.cities : []).slice(0, 12).filter((c: any) => c && clip(c.name, 40) && Number.isFinite(+c.lat) && Number.isFinite(+c.lng))
          .map((c: any) => ({ name: clip(c.name, 40), name_en: clip(c.name_en, 40), lat: +c.lat, lng: +c.lng, radius_km: Math.min(300, Math.max(1, +c.radius_km || 25)) })),
        services: (Array.isArray(body.services) ? body.services : []).slice(0, 10).filter((s: any) => s && clip(s.name, 24))
          .map((s: any) => ({ name: clip(s.name, 24), name_en: clip(s.name_en, 24), price: s.price === "" || s.price == null ? null : Math.max(0, +s.price), duration_min: s.duration_min ? Math.max(10, Math.min(720, +s.duration_min)) : null })),
        staff: (Array.isArray(body.staff) ? body.staff : []).slice(0, 30).filter((s: any) => s && clip(s.name, 40))
          .map((s: any) => ({ name: clip(s.name, 40), phone: saudi(s.phone) || "", cities: Array.isArray(s.cities) ? s.cities.map((x: any) => clip(x, 40)) : [] })),
        hours: Array.isArray(body.hours) ? body.hours.filter((h: any) => h && h.weekday >= 0 && h.weekday <= 6 && /^\d{2}:\d{2}$/.test(h.open) && /^\d{2}:\d{2}$/.test(h.close)) : [],
        settings: body.settings && typeof body.settings === "object" ? body.settings : {},
      };
      need(p.name.length >= 2, "name", 400);
      if (!p.slug) p.slug = "biz";
      const { data: b, error } = await db().rpc("ihj_create_business", { p });
      if (error) throw new AppError("create: " + error.message, 400);
      const biz = b as any;
      const l = await createLink("owner", biz.id, null, p.owner_name || "المالك");
      return { business: biz, owner_url: linkUrl(l.page, l.token), sim_url: simUrl(biz) };
    }
    case "channel/save": {
      const bizId = uuid(body.business_id, "business_id");
      const provider = ["none", "meta", "dualhook", "d360"].includes(body.provider) ? body.provider : "none";
      const patch: any = { provider, phone_number_id: clip(body.phone_number_id, 40) || null, waba_id: clip(body.waba_id, 40), api_base: /^https:\/\/[a-z0-9.-]+(\/[\w.-]*)*$/i.test(String(body.api_base || "")) ? body.api_base : "", dry_run: !!body.dry_run };
      if (["unknown", "not_started", "pending", "verified", "rejected"].includes(body.meta_verification)) patch.meta_verification = body.meta_verification;
      const { error } = await db().from("channels").update(patch).eq("business_id", bizId);
      if (error) throw new AppError(/unique/i.test(error.message) ? "phone_id_used" : "save", 409);
      const sp: any = {};
      if (typeof body.token === "string" && body.token.trim()) sp.wa_token = body.token.trim();
      if (typeof body.app_secret === "string" && body.app_secret.trim()) sp.wa_app_secret = body.app_secret.trim();
      if (Object.keys(sp).length) await db().from("business_secrets").update(sp).eq("business_id", bizId);
      return { channel: provider === "none" ? patch : await channelTest(bizId) };
    }
    case "channel/test": return { channel: await channelTest(uuid(body.business_id, "business_id")) };
    case "channel/info": {
      const bizId = uuid(body.business_id, "business_id");
      const { data: sec } = await db().from("business_secrets").select("wa_hook_key, wa_verify_token, wa_token, wa_app_secret").eq("business_id", bizId).single();
      return { webhook_url: `${FN_BASE}/wa/hook/${sec.wa_hook_key}`, verify_token: sec.wa_verify_token, has_token: !!sec.wa_token, has_app_secret: !!sec.wa_app_secret, token_mask: mask(sec.wa_token) };
    }
    case "templates/sync": return { templates: await templatesSync(uuid(body.business_id, "business_id")) };
    case "templates/create": {
      const bizId = uuid(body.business_id, "business_id");
      const { data: ch } = await db().from("channels").select("*").eq("business_id", bizId).single();
      const sec = await loadSecrets(bizId);
      need(ch.provider !== "none" && sec?.wa_token, "not_connected", 409);
      need(ch.provider === "d360" || ch.waba_id, "no_waba", 409);
      let have: any[] = [];
      try { have = await templatesSync(bizId); } catch { /* */ }
      const results: any[] = [];
      for (const name of Object.keys(TEMPLATES)) {
        for (const lang of ["ar", "en"] as const) {
          if (have.some((t) => t.name === name && t.language === lang)) { results.push({ name, lang, skipped: true }); continue; }
          const payload = templateCreatePayload(name, lang);
          const res = ch.provider === "d360"
            ? await providerFetch(ch, sec, "/v1/configs/templates", { method: "POST", body: JSON.stringify(payload) })
            : await providerFetch(ch, sec, `/${ch.waba_id}/message_templates`, { method: "POST", body: JSON.stringify(payload) });
          results.push({ name, lang, ok: res.ok, status: res.json?.status || "", error: res.ok ? "" : (res.json?.error?.error_user_msg || res.json?.error?.message || String(res.status)).slice(0, 200) });
        }
      }
      let templates: any[] = [];
      try { templates = await templatesSync(bizId); } catch { /* */ }
      return { results, templates };
    }
    case "link/create": {
      const kind = ["admin", "owner", "staff"].includes(body.kind) ? body.kind : "";
      need(kind, "kind", 400);
      const bizId = kind === "admin" ? null : uuid(body.business_id, "business_id");
      const staffId = kind === "staff" ? uuid(body.staff_id, "staff_id") : null;
      if (staffId) { const { data: st } = await db().from("staff").select("id").eq("id", staffId).eq("business_id", bizId).maybeSingle(); need(st, "staff", 404); }
      const l = await createLink(kind, bizId, staffId, clip(body.label, 60));
      return { id: l.id, url: linkUrl(l.page, l.token) };
    }
    case "link/revoke": { await revokeLink(uuid(body.link_id, "link_id")); return {}; }
    case "link/list": {
      const q = db().from("access_links").select("id, token, kind, business_id, staff_id, label, created_at, last_used_at, revoked_at").order("created_at", { ascending: false }).limit(200);
      const { data } = body.business_id ? await q.eq("business_id", uuid(body.business_id)) : await q;
      return { links: (data || []).map((l: any) => ({ ...l, url: l.revoked_at ? "" : linkUrl(l.kind === "admin" ? "admin.html" : l.kind === "owner" ? "biz.html" : "staff.html", l.token), token: undefined })) };
    }
    case "demo/reset": {
      const b = await bizRow(uuid(body.business_id, "business_id"));
      need(b.is_demo, "not_demo", 409);
      const { error } = await db().from("customers").delete().eq("business_id", b.id).eq("is_sim", true);
      if (error) throw new Error(error.message);
      await db().from("hook_sink").delete().eq("business_id", b.id);
      return {};
    }
    case "sim-url": { const b = await bizRow(uuid(body.business_id, "business_id")); return { url: simUrl(b) }; }
  }
  throw new AppError("not_found", 404);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const parts = routeParts(req, "api");
  const path = parts.join("/");
  try {
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    if (path === "link") {
      const ip = ipOf(req);
      const body = await readJson(req) || {};
      const x = await exchangeLink(String(body.token || ""));
      if (!x) { if (badLink(ip)) return json({ ok: false, error: "busy" }, 429); return json({ ok: false, error: "invalid_link" }, 401); }
      return json({ ok: true, ...x });
    }
    if (parts[0] === "hook-sink") {
      const bizId = uuid(parts[1], "business_id");
      const { data: b } = await db().from("businesses").select("is_demo").eq("id", bizId).maybeSingle();
      need(b?.is_demo, "not_demo", 404);
      const raw = await req.text();
      let body: any = {};
      try { body = JSON.parse(raw); } catch { body = { raw: raw.slice(0, 2000) }; }
      await db().from("hook_sink").insert({ business_id: bizId, headers: { event: req.headers.get("x-ihj-event"), signature: req.headers.get("x-ihj-signature") }, body });
      return json({ ok: true });
    }
    const r = await rolesFromReq(req);
    if (!r) return json({ ok: false, error: "unauthorized" }, 401);
    const body = await readJson(req) || {};
    let out: any;
    if (path === "me") {
      const ids = r.members.map((m) => m.business_id);
      const { data: bs } = ids.length ? await db().from("businesses").select("id, name, slug, logo_url, brand_color, plan, status, is_demo").in("id", ids) : { data: [] };
      out = { admin: r.admin, members: r.members.map((m) => ({ ...m, business: (bs || []).find((b: any) => b.id === m.business_id) || null })) };
    } else if (parts[0] === "order") out = await orderAction(r, parts[1] || "", body);
    else if (parts[0] === "customer") out = await customerAction(r, parts[1] || "", body);
    else if (parts[0] === "biz") out = await bizAction(r, parts[1] || "", body);
    else if (parts[0] === "admin") out = await adminAction(r, parts.slice(1).join("/"), body);
    else if (path === "slots") out = await bizAction(r, "slots", body);
    else throw new AppError("not_found", 404);
    return json({ ok: true, ...out });
  } catch (e) {
    if (e instanceof AppError) return json({ ok: false, error: e.code }, e.status);
    console.error("api", path, errMsg(e));
    return json({ ok: false, error: "server", detail: errMsg(e).slice(0, 200) }, 500);
  }
});
