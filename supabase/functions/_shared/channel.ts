// فحص ربط الرقم ومزامنة حالة القوالب، مشتركة بين لوحة المدير (api) والمهام الدورية (cron)
import { db } from "./util.ts";
import { loadSecrets, providerFetch } from "./wa.ts";
import { AppError } from "./actions.ts";

const need = (cond: unknown, code: string, status = 409) => { if (!cond) throw new AppError(code, status); };

// «مربوط» يعني المفتاح يقرأ بيانات الرقم عند المزوّد. استقبال الرسائل يتأكد من آخر رسالة حقيقية وصلت (إحصاءات المدير)
export async function channelTest(bizId: string) {
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

export async function templatesSync(bizId: string) {
  const { data: ch } = await db().from("channels").select("*").eq("business_id", bizId).single();
  const sec = await loadSecrets(bizId);
  need(ch.provider !== "none" && sec?.wa_token, "not_connected");
  let list: any[] = [];
  if (ch.provider === "d360") {
    const r = await providerFetch(ch, sec, "/v1/configs/templates", { method: "GET" });
    need(r.ok, "templates_fetch", 502);
    list = r.json?.waba_templates || r.json?.data || [];
  } else {
    need(ch.waba_id, "no_waba");
    const r = await providerFetch(ch, sec, `/${ch.waba_id}/message_templates?fields=name,status,language,category&limit=200`, { method: "GET" });
    need(r.ok, "templates_fetch", 502);
    list = r.json?.data || [];
  }
  const mine = list.filter((t: any) => String(t.name || "").startsWith("ihj_")).map((t: any) => ({ name: t.name, language: t.language, status: String(t.status || "").toUpperCase(), category: t.category || "" }));
  await db().from("channels").update({ templates: mine, templates_checked_at: new Date().toISOString() }).eq("business_id", bizId);
  return mine;
}

// المهام الدورية: تحديث حالة القوالب اللي لسا قيد المراجعة (كل 15 دقيقة)، وفحص الربط كل 6 ساعات
export async function channelsHousekeeping(): Promise<{ synced: number; checked: number }> {
  let synced = 0, checked = 0;
  const minute = new Date().getUTCMinutes();
  const { data: rows } = await db().from("channels").select("business_id, provider, status, templates, templates_checked_at, last_check_at").neq("provider", "none");
  for (const ch of rows || []) {
    try {
      const list = Array.isArray(ch.templates) ? ch.templates : [];
      const pending = list.some((t: any) => ["PENDING", "IN_APPEAL", "PENDING_DELETION"].includes(t.status));
      if (ch.status === "connected" && pending && minute % 15 === 3) { await templatesSync(ch.business_id); synced++; }
      const age = ch.last_check_at ? Date.now() - new Date(ch.last_check_at).getTime() : Infinity;
      if (minute === 41 && age > 6 * 3600_000) { await channelTest(ch.business_id); checked++; }
    } catch (e) { console.error("housekeeping", ch.business_id, e); }
  }
  return { synced, checked };
}
