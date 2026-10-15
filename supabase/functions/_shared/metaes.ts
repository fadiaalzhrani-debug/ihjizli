// الربط المباشر بواتساب عبر تطبيق ميتا حق المناوب (Tech Provider + Embedded Signup):
// إعدادات التطبيق (معرّفه ومعرّف الإعداد) في ihj_config «meta_es»، وسرّه ورمز تحقق الويبهوك في ihj_secrets.
// صاحب المحل يضغط «اربط واتسابك» في connect.html، ونستلم رمز يعيش 30 ثانية نبدّله بمفتاح المحل،
// نتأكد منه، نشترك في رسائل حسابه، نسجّل الرقم لو جديد، ونحفظ الربط بوضع الفحص لين تشغّله فادية.
import { db, errMsg, FN_BASE, SITE_URL } from "./util.ts";
import { AppError } from "./actions.ts";
import { channelTest, templatesSync } from "./channel.ts";

const need = (cond: unknown, code: string, status = 400) => { if (!cond) throw new AppError(code, status); };
export const GRAPH = "v25.0";
export const ES_FIELDS = ["messages", "smb_message_echoes", "account_update", "message_template_status_update", "history", "smb_app_state_sync"];
export const FEATURE_TYPES = ["", "whatsapp_business_app_onboarding"];

// secret: سر التطبيق اللي انلصق في لوحتي (لتبديل الرمز). hookSecret: لتوقيع الويبهوك المشترك (لوحتي، وإلا متغير البيئة القديم)
export type MetaApp = { app_id: string; config_id: string; feature_type: string; graph: string; secret: string; hookSecret: string; verify: string; ready: boolean };

let cache: { at: number; v: MetaApp } | null = null;
export async function metaApp(fresh = false): Promise<MetaApp> {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache.v;
  const [{ data: cfg }, { data: secs }] = await Promise.all([
    db().from("ihj_config").select("value").eq("key", "meta_es").maybeSingle(),
    db().from("ihj_secrets").select("key, value").in("key", ["meta_app_secret", "meta_verify_token"]),
  ]);
  const c = (cfg?.value || {}) as any, s = Object.fromEntries((secs || []).map((x: any) => [x.key, String(x.value || "")]));
  const v: MetaApp = {
    app_id: String(c.app_id || ""), config_id: String(c.config_id || ""), feature_type: FEATURE_TYPES.includes(c.feature_type) ? c.feature_type : "", graph: /^v\d{2}\.0$/.test(c.graph || "") ? c.graph : GRAPH,
    secret: s.meta_app_secret || "", hookSecret: s.meta_app_secret || Deno.env.get("WA_APP_SECRET") || "", verify: s.meta_verify_token || Deno.env.get("WA_VERIFY_TOKEN") || "", ready: false,
  };
  v.ready = !!(v.app_id && v.config_id && v.secret);
  cache = { at: Date.now(), v };
  return v;
}
export const dropMetaCache = () => { cache = null; };

// رمز تحقق الويبهوك: ينولد مرة وحدة وتنسخه فادية لإعدادات التطبيق عند ميتا
export async function ensureVerifyToken(): Promise<string> {
  const { data } = await db().from("ihj_secrets").select("value").eq("key", "meta_verify_token").maybeSingle();
  if (data?.value) return String(data.value);
  const t = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await db().from("ihj_secrets").upsert({ key: "meta_verify_token", value: t, updated_at: new Date().toISOString() });
  dropMetaCache();
  return t;
}

export async function graph(path: string, token = "", init: RequestInit = {}, version = GRAPH): Promise<{ ok: boolean; status: number; json: any }> {
  const headers: Record<string, string> = { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
  try {
    const r = await fetch(`https://graph.facebook.com/${version}${path}`, { ...init, headers: { ...headers, ...(init.headers as any || {}) }, signal: AbortSignal.timeout(15000) });
    return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
  } catch (e) { return { ok: false, status: 0, json: { error: { message: errMsg(e) } } }; }
}
const gErr = (r: { status: number; json: any }) => `${r.status} ${r.json?.error?.code ?? ""} ${r.json?.error?.error_user_msg || r.json?.error?.message || ""}`.trim().slice(0, 240);

// سر التطبيق صحيح؟ (مفتاح التطبيق = المعرّف|السر)
export async function metaCheckApp(appId: string, secret: string): Promise<boolean> {
  const r = await graph(`/${appId}?${new URLSearchParams({ fields: "id", access_token: `${appId}|${secret}` })}`);
  return r.ok && String(r.json?.id || "") === appId;
}

export async function metaAppInfo() {
  const app = await metaApp(true), verify = await ensureVerifyToken();
  const mask = app.secret ? "••••" + app.secret.slice(-4) : "";
  return {
    app_id: app.app_id, config_id: app.config_id, feature_type: app.feature_type, graph: app.graph, has_secret: !!app.secret, secret_mask: mask, ready: app.ready,
    webhook_url: `${FN_BASE}/wa/hook`, verify_token: verify, fields: ES_FIELDS, domain: SITE_URL, privacy_url: `${SITE_URL}privacy.html`, deletion_url: `${SITE_URL}privacy.html#delete`, icon_url: `${SITE_URL}img/app-icon.png`,
  };
}

const ID = /^\d{5,25}$/;
const pin6 = () => String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));

// إكمال الربط بعد نافذة ميتا. event: FINISH (رقم جديد على Cloud API) أو FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING (رقم تطبيق واتساب للأعمال)
export async function esConnect(biz: { id: string }, p: { code: string; waba_id?: string; phone_number_id?: string; business_id?: string; event?: string }) {
  const app = await metaApp(true);
  need(app.ready, "no_meta", 409);
  need(/^[\w-]{20,1024}$/.test(String(p.code || "")), "code", 400);
  const v = app.graph;

  // 1) الرمز ← مفتاح المحل
  const tk = await graph(`/oauth/access_token?${new URLSearchParams({ client_id: app.app_id, client_secret: app.secret, code: p.code })}`, "", {}, v);
  need(tk.ok && tk.json?.access_token, "code_rejected", 400);
  const token = String(tk.json.access_token);

  // 2) المفتاح لتطبيقنا، وصلاحياته تشمل حساب واتساب المحل
  const dbg = await graph(`/debug_token?${new URLSearchParams({ input_token: token, access_token: `${app.app_id}|${app.secret}` })}`, "", {}, v);
  const d = dbg.json?.data || {};
  need(dbg.ok && d.is_valid && String(d.app_id) === app.app_id, "token_invalid", 400);
  const scopes: any[] = Array.isArray(d.granular_scopes) ? d.granular_scopes : [];
  const allowed = scopes.filter((s) => s.scope === "whatsapp_business_management").flatMap((s) => (s.target_ids || []).map(String));
  let waba = ID.test(String(p.waba_id || "")) ? String(p.waba_id) : "";
  if (waba && allowed.length) need(allowed.includes(waba), "waba_mismatch", 400);
  if (!waba && allowed.length === 1) waba = allowed[0];
  need(waba, "no_waba", 400);

  // 3) رقم الواتساب: من النافذة، أو الوحيد في حسابه
  const nums = await graph(`/${waba}/phone_numbers?fields=id,display_phone_number,verified_name`, token, {}, v);
  need(nums.ok, "phones_fetch", 502);
  const list: any[] = nums.json?.data || [];
  let phone = ID.test(String(p.phone_number_id || "")) ? String(p.phone_number_id) : "";
  if (phone) need(list.some((n) => String(n.id) === phone), "phone_mismatch", 400);
  if (!phone && list.length === 1) phone = String(list[0].id);
  need(phone, list.length ? "pick_phone" : "no_phone", 400);

  // 4) الرقم ما يكون مربوط بمنشأة ثانية عندنا، والمنشأة المربوطة ما يتغيّر ربطها من الرابط (إلا إعادة ربط نفس الحساب)
  const { data: other } = await db().from("channels").select("business_id").eq("phone_number_id", phone).neq("business_id", biz.id).maybeSingle();
  need(!other, "phone_id_used", 409);
  const { data: prev } = await db().from("channels").select("provider, status, phone_number_id, waba_id, onboarded_via, dry_run").eq("business_id", biz.id).maybeSingle();
  const again = prev?.onboarded_via === "es" && prev?.waba_id === waba;
  need(!(prev && prev.provider !== "none" && prev.status === "connected" && !again), "already_connected", 409);

  // 5) نستقبل رسائل حسابه على ويبهوك المناوب المشترك
  const sub = await graph(`/${waba}/subscribed_apps`, token, { method: "POST" }, v);
  need(sub.ok, "subscribe_failed", 502);

  // 6) رقم تطبيق واتساب للأعمال (coex) أو مسجّل من قبل على Cloud API ما يتسجّل. الجديد يتسجّل برمز من 6 أرقام
  const info = await graph(`/${phone}?fields=is_on_biz_app,platform_type`, token, {}, v);
  const coex = p.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" || info.json?.is_on_biz_app === true;
  const onCloud = String(info.json?.platform_type || "").toUpperCase() === "CLOUD_API";
  let pin = "", regErr = "";
  if (!coex && !onCloud) {
    pin = pin6();
    const reg = await graph(`/${phone}/register`, token, { method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", pin }) }, v);
    if (!reg.ok) { regErr = gErr(reg); pin = ""; }
  }

  // 7) نحفظ. أول ربط بوضع الفحص (ما ينرسل شي للعملاء لين تطفيه فادية)، وإعادة ربط نفس الحساب تخلي الوضع مثل ما كان
  const now = new Date().toISOString();
  const exp = Number(d.expires_at || 0);
  const dry = again ? !!prev?.dry_run : true;
  const { error: e1 } = await db().from("business_secrets").update({ wa_token: token, wa_app_secret: "", ...(pin ? { wa_pin: pin } : {}) }).eq("business_id", biz.id);
  if (e1) throw new Error(e1.message);
  const { error: e2 } = await db().from("channels").update({
    provider: "meta", phone_number_id: phone, waba_id: waba, api_base: "", onboarded_via: "es", coex, portfolio_id: ID.test(String(p.business_id || "")) ? String(p.business_id) : "",
    token_expires_at: exp > 0 ? new Date(exp * 1000).toISOString() : null, connected_at: now, dry_run: dry, register_error: regErr,
    // القوالب تتبع حساب واتساب: حساب جديد = نبدأ من جديد
    ...(prev?.waba_id && prev.waba_id !== waba ? { templates: [], templates_checked_at: null } : {}),
  }).eq("business_id", biz.id);
  if (e2) throw new AppError(/unique/i.test(e2.message) ? "phone_id_used" : "save", 409);
  const ch = await channelTest(biz.id);
  if (ch.status === "connected") await templatesSync(biz.id).catch(() => null);
  return { status: ch.status, display_phone: ch.display_phone || "", verified_name: ch.verified_name || "", coex, dry_run: dry, register_error: regErr };
}

// إعادة تسجيل رقم انربط وفشل تسجيله عند ميتا (من لوحتي)
export async function registerPhone(bizId: string) {
  const { data: ch } = await db().from("channels").select("provider, phone_number_id, coex").eq("business_id", bizId).maybeSingle();
  need(ch && ch.provider === "meta" && ch.phone_number_id && !ch.coex, "not_es", 409);
  const { data: sec } = await db().from("business_secrets").select("wa_token, wa_pin").eq("business_id", bizId).maybeSingle();
  need(sec?.wa_token, "no_token", 409);
  const pin = sec!.wa_pin || pin6();
  const reg = await graph(`/${ch!.phone_number_id}/register`, sec!.wa_token, { method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", pin }) });
  const err = reg.ok ? "" : gErr(reg);
  await db().from("business_secrets").update({ wa_pin: reg.ok ? pin : sec!.wa_pin }).eq("business_id", bizId);
  await db().from("channels").update({ register_error: err }).eq("business_id", bizId);
  return { ok: reg.ok, register_error: err };
}

// مفاتيح الربط المباشر تنتهي بعد 60 يوم (قالب ميتا): نجددها قبل 15 يوم من انتهائها، مرة كل ساعة.
// لو فشل التجديد نكتب السبب في «ربط الرقم» ونعيد المحاولة الساعة الجاية، ولو انتهى فعلًا يحتاج يربط من جديد
export async function refreshEsTokens(limit = 10) {
  const app = await metaApp(true);
  if (!app.secret || !app.app_id) return 0;
  const soon = new Date(Date.now() + 15 * 86400_000).toISOString();
  const { data: rows } = await db().from("channels").select("business_id, token_expires_at").eq("onboarded_via", "es").not("token_expires_at", "is", null).lt("token_expires_at", soon).limit(limit);
  let n = 0;
  for (const ch of rows || []) {
    const { data: sec } = await db().from("business_secrets").select("wa_token").eq("business_id", ch.business_id).maybeSingle();
    if (!sec?.wa_token) continue;
    const r = await graph(`/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: app.app_id, client_secret: app.secret, set_token_expires_in_60_days: "true", fb_exchange_token: sec.wa_token })}`, "", {}, app.graph);
    if (r.ok && r.json?.access_token) {
      const exp = Number(r.json.expires_in || 0);
      await db().from("business_secrets").update({ wa_token: String(r.json.access_token) }).eq("business_id", ch.business_id);
      await db().from("channels").update({ token_expires_at: exp > 0 ? new Date(Date.now() + exp * 1000).toISOString() : null }).eq("business_id", ch.business_id);
      n++;
    } else {
      const expired = new Date(ch.token_expires_at).getTime() < Date.now();
      await db().from("channels").update(expired ? { status: "error", last_error: "انتهى مفتاح الربط، يحتاج يربط من جديد" } : { last_error: "تجديد مفتاح الربط فشل: " + gErr(r) }).eq("business_id", ch.business_id);
    }
  }
  return n;
}
