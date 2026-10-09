// طلب اشتراك من الموقع العام (بدون تسجيل دخول) ← signup_requests، ولوحة المدير تشوفه لحظيًا
// POST /lead {business_name, activity, city, contact_name, phone, package, wants_app, orders_per_day, notes, website(فخ), source}
//   حدود: 8 طلبات بالساعة لكل IP، ونفس الجوال ما يتكرر خلال ساعة
import { clip, CORS, db, ipOf, json, limiter, readJson, saudi } from "../_shared/util.ts";

const limited = limiter(8, 3600_000);
const PACKAGES = new Set(["bot", "bot_pay"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method === "GET") return json({ ok: true });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const ip = ipOf(req);
  if (limited(ip)) return json({ ok: false, error: "busy" }, 429);
  const b = await readJson(req);
  if (!b) return json({ ok: false, error: "bad_json" }, 400);
  if (clip(b.website, 50)) return json({ ok: true }); // فخ البوتات: الحقل المخفي انعبّى
  const business_name = clip(b.business_name, 80), phone = saudi(b.phone);
  if (business_name.length < 2) return json({ ok: false, error: "name" }, 400);
  if (!phone) return json({ ok: false, error: "phone" }, 400);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { data: dup } = await db().from("signup_requests").select("id").eq("phone", phone).gte("created_at", since).limit(1);
  if (dup && dup.length) return json({ ok: true, dup: true });
  const row = {
    business_name, phone,
    activity: clip(b.activity, 60), city: clip(b.city, 60), contact_name: clip(b.contact_name, 60),
    package: PACKAGES.has(String(b.package)) ? String(b.package) : "bot",
    wants_app: b.wants_app === true || b.wants_app === "1" || b.wants_app === "on",
    orders_per_day: clip(b.orders_per_day, 30), notes: clip(b.notes, 600), source: clip(b.source, 30) || "site", ip,
  };
  const { data, error } = await db().from("signup_requests").insert(row).select("id").single();
  if (error) { console.error("lead", error.message); return json({ ok: false, error: "save" }, 500); }
  return json({ ok: true, id: data.id });
});
