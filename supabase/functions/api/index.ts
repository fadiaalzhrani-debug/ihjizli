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
import { exportTest, orderEvent } from "../_shared/events.ts";
import { dayLabel, local, timeLabel } from "../_shared/dates.ts";
import { mask, moyasarCheckKey } from "../_shared/pay.ts";
import { locationFromText } from "../_shared/maps.ts";
import { channelTest, templatesSync } from "../_shared/channel.ts";

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
    case "book": {
      // حجز يدوي (عميل اتصل): العميل بجواله، والموعد لازم يكون فاضي فعلًا، والطلب ينسند لموظف مثل حجز الواتساب
      const phone = saudi(body.phone) || intl(body.phone);
      need(phone, "phone", 400);
      need(!isNaN(Date.parse(body.start)), "start", 400);
      const name = clip(body.name, 60);
      let { data: cust } = await db().from("customers").select("*").eq("business_id", bizId).eq("wa_id", phone).maybeSingle();
      if (!cust) {
        const ins = await db().from("customers").insert({ business_id: bizId, wa_id: phone, name, is_sim: false }).select("*").single();
        if (ins.error) throw new Error(ins.error.message);
        cust = ins.data;
      } else if (name && !cust.name) {
        await db().from("customers").update({ name }).eq("id", cust.id); cust.name = name;
      }
      const { data: o, error } = await db().rpc("ihj_book", { p_business: bizId, p_customer: cust.id, p_city: body.city_id || null, p_service: body.service_id || null,
        p_start: new Date(body.start).toISOString(), p_lat: null, p_lng: null, p_maps_url: "", p_address: clip(body.address, 200), p_channel: "dashboard", p_notes: clipLines(body.notes, 500) });
      if (error) throw new AppError(/slot_taken/.test(error.message) ? "slot_taken" : "book", 409);
      const order = o as any;
      await orderEvent(bizId, "order.created", { order_id: order.id, is_test: false, manual: true });
      let send = null;
      if (body.notify !== false) {
        const tz = b.timezone || "Asia/Riyadh", lang = cust.lang === "en" ? "en" : "ar";
        const day = dayLabel(local(order.slot_start, tz).ymd, lang, tz, false), time = timeLabel(order.slot_start, lang, tz);
        const text = lang === "en" ? `Your appointment is booked ✅\nOrder #${order.number}\n📅 ${day}\n⏰ ${time}` : `تم حجز موعدك ✅\nرقم الطلب: ${order.number}\n📅 ${day}\n⏰ ${time}`;
        const { data: chRow } = await db().from("channels").select("*").eq("business_id", bizId).maybeSingle();
        send = await sendToCustomer(b, chRow, cust, [{ t: "text", text }], { purpose: "update", by: "owner", template: { name: "ihj_update", params: [String(order.number), b.name, lang === "en" ? `Booked for ${day} ${time}` : `تم حجز موعدك ${day} ${time}`] } });
      }
      return { order, send };
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
        settings: {
          ...(body.settings && typeof body.settings === "object" ? body.settings : {}),
          ...(PLACES.includes(body.place_mode) ? { place_mode: body.place_mode } : {}),
          ...(TIMINGS.includes(body.pay_timing) ? { pay_timing: body.pay_timing } : {}),
          ...(["friendly", "formal", "short"].includes(body.tone) ? { tone: body.tone } : {}),
          ...(Number.isFinite(+body.prepay_amount) && +body.prepay_amount > 0 ? { prepay_amount: Math.min(100000, +body.prepay_amount) } : {}),
        },
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
      if (provider === "none") { await db().from("channels").update({ status: "not_connected", last_error: "" }).eq("business_id", bizId); return { channel: { ...patch, status: "not_connected", last_error: "" } }; }
      return { channel: await channelTest(bizId) };
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
      const { error } = await db().from("customers").delete().eq("business_id", b.id).eq("is_sim", true);
      if (error) throw new Error(error.message);
      await db().from("hook_sink").delete().eq("business_id", b.id);
      return {};
    }
    case "sim-url": { const b = await bizRow(uuid(body.business_id, "business_id")); return { url: simUrl(b) }; }
  }
  throw new AppError("not_found", 404);
}

// ───────── صفحات العميل (الاتفاقية ونموذج البيانات) بمفتاح المنشأة الخاص ─────────
const clientLimit = limiter(60, 3600_000);
async function bizByClientKey(k: string) {
  if (!/^[0-9a-f]{24}$/.test(String(k || ""))) return null;
  const { data } = await db().from("businesses").select("*").eq("client_key", k).maybeSingle();
  return data;
}
const PLACES = ["visit", "shop", "online"], TIMINGS = ["after", "before", "none"];
async function cleanIntake(d: any, logoDir: string): Promise<{ out?: any; bad?: string[] }> {
  const out: any = {
    name: clip(d.name, 80), name_en: clip(d.name_en, 80), activity: clip(d.activity, 60), wa_number: intl(d.wa_number), owner_name: clip(d.owner_name, 60), owner_phone: saudi(d.owner_phone) || intl(d.owner_phone),
    cr_number: clip(d.cr_number, 20), vat_number: clip(d.vat_number, 20), address: clip(d.address, 120),
    place_mode: PLACES.includes(d.place_mode) ? d.place_mode : "", pay_timing: TIMINGS.includes(d.pay_timing) ? d.pay_timing : "",
    has_moyasar: ["yes", "no", "later"].includes(d.has_moyasar) ? d.has_moyasar : "", notes: clipLines(d.notes, 1000),
    services: (Array.isArray(d.services) ? d.services : []).slice(0, 15).map((x: any) => ({
      name: clip(x?.name, 24),
      price: x?.price === "" || x?.price == null || !Number.isFinite(+x.price) ? null : Math.max(0, Math.min(100000, +x.price)),
      duration_min: x?.duration_min ? Math.max(10, Math.min(720, Math.round(+x.duration_min))) : null,
    })).filter((x: any) => x.name),
    hours: (Array.isArray(d.hours) ? d.hours : []).slice(0, 14)
      .filter((h: any) => h && /^[0-6]$/.test(String(h.weekday)) && /^\d{2}:\d{2}$/.test(h.open) && /^\d{2}:\d{2}$/.test(h.close))
      .map((h: any) => ({ weekday: +h.weekday, open: h.open, close: h.close })),
    staff: (Array.isArray(d.staff) ? d.staff : []).slice(0, 30)
      .map((x: any) => ({ name: clip(x?.name, 40), phone: saudi(x?.phone) || "", cities: Array.isArray(x?.cities) ? x.cities.slice(0, 12).map((c: any) => clip(c, 40)) : [] }))
      .filter((x: any) => x.name),
  };
  need(out.name.length >= 2, "name", 400);
  // المدن (مراكز جاهزة) والفروع (رابط قوقل ماب يتحوّل لإحداثيات)
  const cities: any[] = [], bad: string[] = [];
  for (const c of (Array.isArray(d.cities) ? d.cities : []).slice(0, 12)) {
    const name = clip(c?.name, 40);
    if (!name) continue;
    if (Number.isFinite(+c?.lat) && Number.isFinite(+c?.lng) && c?.lat !== "" && c?.lat !== null) { cities.push({ name, lat: +c.lat, lng: +c.lng, radius_km: Math.max(1, Math.min(300, +c.radius_km || 25)) }); continue; }
    const p = c?.maps ? await locationFromText(String(c.maps).slice(0, 500)) : null;
    if (p) cities.push({ name, lat: p.lat, lng: p.lng, radius_km: Math.max(1, Math.min(300, +c.radius_km || 15)), maps: String(c.maps).slice(0, 300) });
    else bad.push(name);
  }
  if (bad.length) return { bad };
  out.cities = cities;
  // الشعار
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(d.logo || ""));
  if (m) {
    const bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
    need(bytes.length <= 700_000, "too_big", 400);
    const path = "logos/" + logoDir + "/intake-" + Date.now() + "." + (m[1] === "png" ? "png" : "jpg");
    const { error } = await db().storage.from("public").upload(path, bytes, { contentType: "image/" + m[1], upsert: true });
    if (error) throw new Error(error.message);
    out.logo_url = SUPABASE_URL + "/storage/v1/object/public/public/" + path;
  } else if (typeof d.logo_url === "string" && d.logo_url.startsWith(SUPABASE_URL)) {
    out.logo_url = d.logo_url;
  }
  return { out };
}

// الرابط العام: نلقى العميل بجواله (طلب اشتراك مفتوح، أو منشأته لو تحوّل)، وإلا ننشئ له طلب اشتراك جديد
async function leadByPhone(phone: string, seed: any, ip: string) {
  const since = new Date(Date.now() - 120 * 86400_000).toISOString();
  const { data: rows } = await db().from("signup_requests").select("*").eq("phone", phone).gte("created_at", since).neq("status", "lost").order("created_at", { ascending: false }).limit(1);
  if (rows && rows.length) return rows[0];
  const { data, error } = await db().from("signup_requests").insert({
    business_name: clip(seed.business_name, 80) || "بدون اسم", phone, contact_name: clip(seed.contact_name, 60), activity: clip(seed.activity, 60),
    package: seed.package === "bot_pay" ? "bot_pay" : "bot", wants_app: !!seed.wants_app, source: clip(seed.source, 30) || "link", ip,
  }).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}
async function bizForLead(lead: any) {
  if (!lead?.business_id) return null;
  const { data } = await db().from("businesses").select("id, plan, wants_app, name").eq("id", lead.business_id).maybeSingle();
  return data;
}
async function clientAction(req: Request, action: string) {
  const ip = ipOf(req);
  if (clientLimit(ip)) throw new AppError("busy", 429);
  const body = await readJson(req) || {};
  if (action === "terms") {
    const [one, two] = await Promise.all([db().rpc("ihj_plan_fees", { p_plan: "bot", p_app: true }), db().rpc("ihj_plan_fees", { p_plan: "bot_pay", p_app: false })]);
    const x = one.data as any, y = two.data as any;
    return { fees: { bot: { setup_fee: x.setup_fee, monthly_fee: x.monthly_fee }, bot_pay: { setup_fee: y.setup_fee, monthly_fee: y.monthly_fee }, app: { setup_fee: x.app_setup_fee, monthly_fee: x.app_monthly_fee } } };
  }
  if (action === "agree-new" || action === "intake-new") {
    if (clip(body.website, 50)) return { ok: true };
    if (action === "agree-new") {
      const bizName = clip(body.business_name, 80), name = clip(body.name, 60), phone = saudi(body.phone);
      need(bizName.length >= 2, "business", 400);
      need(name.length >= 3, "name", 400);
      need(phone, "phone", 400);
      need(body.accept === true, "accept", 400);
      const plan = body.package === "bot_pay" ? "bot_pay" : "bot", app = !!body.wants_app;
      const { data: fees } = await db().rpc("ihj_plan_fees", { p_plan: plan, p_app: app });
      const terms = { business: bizName, plan, wants_app: app, ...(fees as any || {}), version: "2026-10" };
      const lead = await leadByPhone(phone, { business_name: bizName, contact_name: name, package: plan, wants_app: app, source: "agree" }, ip);
      const now = new Date().toISOString();
      const biz = await bizForLead(lead);
      const patch: any = { agreed_at: now, agreed_name: name, agreed_terms: terms, updated_at: now, log: [...(lead.log || []), { t: now, what: "وافق على الاتفاقية من الرابط العام" }].slice(-60) };
      if (!biz) { patch.package = plan; patch.wants_app = app; if (["new", "contacted"].includes(lead.status)) patch.status = "agreed"; if (lead.business_name === "بدون اسم") patch.business_name = bizName; if (!lead.contact_name) patch.contact_name = name; }
      const { error } = await db().from("signup_requests").update(patch).eq("id", lead.id);
      if (error) throw new Error(error.message);
      if (biz) {
        const { error: e2 } = await db().from("client_docs").upsert({ business_id: biz.id, agreed_at: now, agreed_name: name, agreed_phone: phone, agreed_terms: terms, agreed_ip: ip, updated_at: now }, { onConflict: "business_id" });
        if (e2) throw new Error(e2.message);
      }
      return { agreed: true };
    }
    const d = body.data || {};
    const phone = saudi(d.owner_phone);
    need(phone, "phone", 400);
    need(clip(d.name, 80).length >= 2, "name", 400);
    const lead = await leadByPhone(phone, { business_name: d.name, contact_name: d.owner_name, activity: d.activity, source: "start" }, ip);
    const biz = await bizForLead(lead);
    const r = await cleanIntake(d, biz ? biz.id : "lead-" + lead.id);
    if (r.bad) return { saved: false, bad_locations: r.bad };
    const now = new Date().toISOString();
    if (biz) {
      const { error } = await db().from("client_docs").upsert({ business_id: biz.id, intake: r.out, intake_at: now, updated_at: now }, { onConflict: "business_id" });
      if (error) throw new Error(error.message);
    }
    const patch: any = { intake: r.out, intake_at: now, updated_at: now, log: [...(lead.log || []), { t: now, what: "عبّى نموذج البيانات من الرابط العام" }].slice(-60) };
    if (!biz) { if (lead.business_name === "بدون اسم" || !lead.business_name) patch.business_name = r.out.name; if (!lead.activity && r.out.activity) patch.activity = r.out.activity; if (!lead.contact_name && r.out.owner_name) patch.contact_name = r.out.owner_name; }
    const { error } = await db().from("signup_requests").update(patch).eq("id", lead.id);
    if (error) throw new Error(error.message);
    return { saved: true };
  }
  const b = await bizByClientKey(body.k);
  need(b, "invalid_link", 404);
  if (action === "info") {
    const [{ data: sub }, { data: docs }, { data: st }, { data: svcs }, { data: cities }, { data: hours }, { data: staff }] = await Promise.all([
      db().from("subscriptions").select("plan, setup_fee, monthly_fee, app_setup_fee, app_monthly_fee").eq("business_id", b.id).maybeSingle(),
      db().from("client_docs").select("agreed_at, agreed_name, intake, intake_at").eq("business_id", b.id).maybeSingle(),
      db().from("settings").select("place_mode, pay_timing").eq("business_id", b.id).maybeSingle(),
      db().from("services").select("name, price, duration_min").eq("business_id", b.id).eq("active", true).order("sort"),
      db().from("cities").select("id, name, lat, lng, radius_km").eq("business_id", b.id).eq("active", true).order("sort"),
      db().from("hours").select("weekday, open_time, close_time").eq("business_id", b.id).is("city_id", null).order("weekday"),
      db().from("staff").select("name, phone, city_ids").eq("business_id", b.id).eq("active", true),
    ]);
    const cityName = (id: string) => (cities || []).find((c: any) => c.id === id)?.name;
    return {
      business: { name: b.name, name_en: b.name_en, activity: b.activity, plan: b.plan, wants_app: b.wants_app, owner_name: b.owner_name, owner_phone: b.owner_phone, wa_number: b.wa_number,
        cr_number: b.cr_number, vat_number: b.vat_number, address: b.address, logo_url: b.logo_url, brand_color: b.brand_color },
      fees: sub || {}, agreed: docs?.agreed_at ? { at: docs.agreed_at, name: docs.agreed_name } : null, intake_at: docs?.intake_at || null, intake: docs?.intake || null,
      current: {
        place_mode: st?.place_mode, pay_timing: st?.pay_timing,
        services: svcs || [], cities: (cities || []).map((c: any) => ({ name: c.name, lat: c.lat, lng: c.lng, radius_km: c.radius_km })),
        hours: (hours || []).map((h: any) => ({ weekday: h.weekday, open: String(h.open_time).slice(0, 5), close: String(h.close_time).slice(0, 5) })),
        staff: (staff || []).map((x: any) => ({ name: x.name, phone: x.phone, cities: (x.city_ids || []).map(cityName).filter(Boolean) })),
      },
    };
  }
  if (action === "agree") {
    const name = clip(body.name, 60), phone = saudi(body.phone) || intl(body.phone);
    need(name.length >= 3, "name", 400);
    need(phone, "phone", 400);
    need(body.accept === true, "accept", 400);
    const { data: sub } = await db().from("subscriptions").select("plan, setup_fee, monthly_fee, app_setup_fee, app_monthly_fee").eq("business_id", b.id).maybeSingle();
    const terms = { business: b.name, plan: b.plan, wants_app: b.wants_app, ...(sub || {}), version: "2026-10" };
    const { error } = await db().from("client_docs").upsert({ business_id: b.id, agreed_at: new Date().toISOString(), agreed_name: name, agreed_phone: phone, agreed_terms: terms, agreed_ip: ip, updated_at: new Date().toISOString() }, { onConflict: "business_id" });
    if (error) throw new Error(error.message);
    return { agreed: true };
  }
  if (action === "intake") {
    const r = await cleanIntake(body.data || {}, b.id);
    if (r.bad) return { saved: false, bad_locations: r.bad };
    const { error } = await db().from("client_docs").upsert({ business_id: b.id, intake: r.out, intake_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "business_id" });
    if (error) throw new Error(error.message);
    return { saved: true };
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
    if (parts[0] === "client") return json({ ok: true, ...(await clientAction(req, parts[1] || "")) });
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
