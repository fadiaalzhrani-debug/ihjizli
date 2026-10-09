// أدوات مشتركة لدوال احجزلي
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
export const FN_BASE = `${SUPABASE_URL}/functions/v1`;
export const SITE_URL = (Deno.env.get("IHJ_SITE_URL") || "https://fadiaalzhrani-debug.github.io/ihjizli/").replace(/\/?$/, "/");

let _db: SupabaseClient | null = null;
export function db(): SupabaseClient {
  if (!_db) _db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  return _db;
}

export const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-ihj-key, x-cron-key",
  "access-control-allow-methods": "POST, GET, OPTIONS",
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

export function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export async function readJson(req: Request): Promise<any> {
  try { return await req.json(); } catch { return null; }
}

// المسار بعد اسم الدالة: /functions/v1/wa/hook/x  ←  ["hook","x"]
export function routeParts(req: Request, fn: string): string[] {
  const p = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = p.indexOf(fn);
  return i >= 0 ? p.slice(i + 1) : p;
}

export const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
export const clipLines = (v: unknown, n: number) => String(v ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim().slice(0, n);

export const digits = (v: unknown) =>
  String(v ?? "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/\D+/g, "");

// جوال سعودي بأي صيغة ← 9665xxxxxxxx (أو "" لو غير صحيح)
export function saudi(v: unknown): string {
  let d = digits(v);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("966")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  return /^5\d{8}$/.test(d) ? "966" + d : "";
}

// رقم دولي عام (لأرقام واتساب): أرقام فقط 8 إلى 15
export function intl(v: unknown): string {
  const s = saudi(v);
  if (s) return s;
  let d = digits(v);
  if (d.startsWith("00")) d = d.slice(2);
  return /^\d{8,15}$/.test(d) ? d : "";
}

export function token(bytes = 24): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function sameSecret(a: string, b: string): boolean {
  if (!a || !b || b.length < 12) return false;
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i % x.length] ?? 0) ^ (y[i % y.length] ?? 0);
  return diff === 0;
}

export async function hmacHex(secret: string, data: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  return [...sig].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// محدد معدل بسيط داخل النسخة الشغّالة
export function limiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const now = Date.now(), arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    arr.push(now); hits.set(key, arr);
    if (hits.size > 5000) hits.clear();
    return arr.length > max;
  };
}

export const ipOf = (req: Request) => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "x";

// تطبيع النص العربي للمطابقة: بدون تشكيل، الألف والياء والتاء المربوطة موحّدة، أرقام لاتينية
export function norm(s: string): string {
  return String(s || "").toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[إأآٱا]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[^\p{L}\p{N}\s:\/\.\-_,@?=&!+#]/gu, " ")
    .replace(/\s+/g, " ").trim();
}

export const hasArabic = (s: string) => /[\u0600-\u06FF]/.test(s || "");
export const hasLatin = (s: string) => /[A-Za-z]/.test(s || "");

export function money(n: number | string | null | undefined): string {
  const v = Number(n || 0);
  return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function errMsg(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as any).message);
  return String(e);
}

// تشغيل مهمة بعد الرد (لو متاح) حتى ما يتأخر الرد على ميتا أو الصفحة
export function background(p: Promise<unknown>) {
  const er = (globalThis as any).EdgeRuntime;
  const safe = p.catch((e) => console.error("bg", errMsg(e)));
  if (er && typeof er.waitUntil === "function") er.waitUntil(safe);
}
