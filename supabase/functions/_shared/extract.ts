// «عبّيها من صورة أو موقع»: صورة قائمة الأسعار أو PDF أو رابط موقعه أو نص يلصقه ← خدمات وأسعار وأوقات وفروع وأسئلة.
// القراءة بنموذج Claude (يحتاج سر ANTHROPIC_API_KEY في Supabase). كل قراءة تنسجل في ai_usage بعدد التوكنز،
// وفيه حد يومي للرابط العام عشان ما أحد يستهلك الرصيد.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { betaJSONSchemaOutputFormat } from "npm:@anthropic-ai/sdk@0.133.0/helpers/beta/json-schema";
import { db } from "./util.ts";
import { AppError } from "./actions.ts";
import { htmlToText, normalize, pickLinks, SCHEMA, SYSTEM, urlKind, type Extracted } from "./extract-core.ts";

export const AI_MODEL = Deno.env.get("IHJ_AI_MODEL") || "claude-opus-5-5";
export const aiReady = () => !!(Deno.env.get("ANTHROPIC_API_KEY") || "").trim();
// تقدير التكلفة بالدولار لكل مليون توكن (للوحة المدير بس)
const PRICE: Record<string, [number, number]> = { "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5] };
export const costUsd = (model: string, inp: number, out: number) => { const p = PRICE[model] || PRICE["claude-opus-5-5"]; return (inp * p[0] + out * p[1]) / 1e6; };

let _ai: Anthropic | null = null;
const ai = () => _ai ||= new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY"), timeout: 115_000, maxRetries: 1 });

export type ExtractInput = { images?: unknown; pdf?: unknown; url?: unknown; text?: unknown };
type Img = { media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string };
const IMG_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

function readImages(v: unknown): Img[] {
  const out: Img[] = [];
  for (const x of (Array.isArray(v) ? v : []).slice(0, 6)) {
    const s = typeof x === "string" ? x : String((x as any)?.data_url || "");
    const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(s);
    if (!m) throw new AppError("image", 400);
    if (!IMG_TYPES.includes(m[1]) || !B64.test(m[2])) throw new AppError("image", 400);
    if (m[2].length > 5_000_000) throw new AppError("too_big", 400);
    out.push({ media_type: m[1] as Img["media_type"], data: m[2] });
  }
  return out;
}
function readPdf(v: unknown): string {
  if (!v) return "";
  const m = /^data:application\/pdf;base64,(.+)$/.exec(String(v));
  if (!m || !B64.test(m[1])) throw new AppError("pdf", 400);
  if (m[1].length > 8_000_000) throw new AppError("too_big", 400);
  return m[1];
}

// ───────── قراءة رابط الموقع (مع صفحتين للأسعار أو الخدمات لو فيه) ─────────
type Page = { url: string; title: string; text: string };
type Fetched = { page?: Page; pdf?: string; image?: Img; html?: string };
async function fetchOne(start: string, ms: number): Promise<Fetched> {
  let url = start;
  for (let hop = 0; hop < 5; hop++) {
    const k = urlKind(url);
    if (k.kind === "bad" || !k.url) throw new AppError("bad_url", 400);
    if (k.kind === "social") throw new AppError("social", 422);
    if (k.kind === "maps") throw new AppError("maps", 422);
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
    let res: Response;
    try {
      res = await fetch(k.url, { redirect: "manual", signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; IhjizliReader/1.0)", "accept-language": "ar,en;q=0.8", accept: "text/html,application/xhtml+xml,application/pdf,image/*;q=0.8,*/*;q=0.5" } });
    } catch { clearTimeout(timer); throw new AppError("fetch", 422); }
    if (res.status >= 300 && res.status < 400) {
      clearTimeout(timer);
      const loc = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!loc) throw new AppError("fetch", 422);
      url = new URL(loc, k.url).toString();
      continue;
    }
    if (!res.ok || !res.body) { clearTimeout(timer); await res.body?.cancel().catch(() => {}); throw new AppError("fetch", 422); }
    // نقرأ لين 4 ميقا بس
    const chunks: Uint8Array[] = []; let size = 0;
    const reader = res.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length; if (size > 4_000_000) { await reader.cancel().catch(() => {}); break; }
        chunks.push(value);
      }
    } catch { /* انقطع: نكمل باللي وصل */ } finally { clearTimeout(timer); }
    const bytes = new Uint8Array(Math.min(size, 4_000_000)); let off = 0;
    for (const c of chunks) { if (off + c.length > bytes.length) break; bytes.set(c, off); off += c.length; }
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/pdf")) return { pdf: b64(bytes.subarray(0, off)) };
    const it = IMG_TYPES.find((t) => ct.startsWith(t));
    if (it) return { image: { media_type: it as Img["media_type"], data: b64(bytes.subarray(0, off)) } };
    let cs = /charset=([\w-]+)/.exec(ct)?.[1] || "";
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(off, 3000)));
    if (!cs) cs = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] || "utf-8";
    let html = "";
    try { html = new TextDecoder(cs.toLowerCase()).decode(bytes.subarray(0, off)); } catch { html = new TextDecoder("utf-8").decode(bytes.subarray(0, off)); }
    const t = htmlToText(html);
    return { page: { url: k.url, title: t.title, text: t.text }, html };
  }
  throw new AppError("fetch", 422);
}
function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ───────── الحدود والتسجيل ─────────
export type Scope = { kind: "public"; ip: string } | { kind: "biz"; business_id: string; ip: string };
async function checkLimits(sc: Scope) {
  const day = new Date(Date.now() - 86400_000).toISOString();
  if (sc.kind === "public") {
    const [{ count: mine }, { count: all }] = await Promise.all([
      db().from("ai_usage").select("id", { count: "exact", head: true }).eq("scope", "public").eq("ip", sc.ip).gte("at", day),
      db().from("ai_usage").select("id", { count: "exact", head: true }).eq("scope", "public").gte("at", day),
    ]);
    if ((mine || 0) >= 12 || (all || 0) >= 80) throw new AppError("busy", 429);
  } else {
    const { count } = await db().from("ai_usage").select("id", { count: "exact", head: true }).eq("business_id", sc.business_id).gte("at", day);
    if ((count || 0) >= 60) throw new AppError("busy", 429);
  }
}
async function log(sc: Scope, row: Record<string, unknown>) {
  await db().from("ai_usage").insert({ scope: sc.kind, business_id: sc.kind === "biz" ? sc.business_id : null, ip: sc.ip, ...row }).then(() => {}, () => {});
}

export async function extractMaterial(input: ExtractInput, sc: Scope): Promise<{ data: Extracted; sources: string[] }> {
  if (!aiReady()) throw new AppError("ai_off", 503);
  const images = readImages(input.images), pdfs = [readPdf(input.pdf)].filter(Boolean);
  const text = String(input.text ?? "").replace(/\r/g, "").trim().slice(0, 20000);
  const rawUrl = String(input.url ?? "").trim().slice(0, 500);
  if (!images.length && !pdfs.length && !text && !rawUrl) throw new AppError("empty", 400);
  await checkLimits(sc);
  const t0 = Date.now(), kinds = [images.length ? "image" : "", pdfs.length ? "pdf" : "", rawUrl ? "url" : "", text ? "text" : ""].filter(Boolean).join(",");
  const pages: Page[] = [];
  try {
    if (rawUrl) {
      const first = await fetchOne(rawUrl, 12_000);
      if (first.pdf) pdfs.push(first.pdf);
      if (first.image) images.push(first.image);
      if (first.page) {
        pages.push(first.page);
        const more = await Promise.all(pickLinks(first.html || "", first.page.url, 2).map((u) => fetchOne(u, 8_000).catch(() => null)));
        for (const m of more) if (m?.page && m.page.text.length > 40) pages.push(m.page);
      }
      if (!images.length && !pdfs.length && !text && pages.every((p) => p.text.length < 80)) throw new AppError("empty_page", 422);
    }
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    for (const im of images) content.push({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } });
    for (const p of pdfs) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: p } });
    // نص الصفحات: نحدّه بـ 120 ألف حرف (الصفحات الطويلة أغلبها قوائم تنقل)، ونقول للنموذج لو انقص
    let budget = 120_000;
    for (const p of pages) {
      const body = p.text.length > budget ? p.text.slice(0, budget) + "\n[…the rest of this page was cut]" : p.text;
      budget -= Math.min(budget, p.text.length);
      content.push({ type: "text", text: `<page url="${p.url}">\n${p.title}\n${body}\n</page>` });
      if (budget <= 0) break;
    }
    if (text) content.push({ type: "text", text: `<owner_text>\n${text}\n</owner_text>` });
    content.push({ type: "text", text: "Extract this business's setup data from the material above." });
    const fallback = /^claude-(opus|fable|sonnet-5-5)/.test(AI_MODEL);
    const res = await ai().beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { effort: "medium", format: betaJSONSchemaOutputFormat(SCHEMA as any) },
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    const usage = { input_tokens: res.usage?.input_tokens || 0, output_tokens: res.usage?.output_tokens || 0, model: res.model || AI_MODEL };
    if (res.stop_reason === "refusal") { await log(sc, { kind: kinds, ok: false, ms: Date.now() - t0, ...usage, error: "refusal" }); throw new AppError("unreadable", 422); }
    if (res.stop_reason === "max_tokens" || !res.parsed_output) { await log(sc, { kind: kinds, ok: false, ms: Date.now() - t0, ...usage, error: String(res.stop_reason) }); throw new AppError("too_long", 422); }
    const data = normalize(res.parsed_output);
    await log(sc, { kind: kinds, ok: data.readable, ms: Date.now() - t0, ...usage, error: data.readable ? "" : "unreadable" });
    if (!data.readable) throw new AppError("unreadable", 422);
    return { data, sources: pages.map((p) => p.url) };
  } catch (e) {
    if (e instanceof AppError) {
      if (["fetch", "social", "maps", "empty_page", "bad_url"].includes(e.code)) await log(sc, { kind: kinds, ok: false, ms: Date.now() - t0, error: e.code });
      throw e;
    }
    let code = "ai", status = 502;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) code = "ai_key";
    else if (e instanceof Anthropic.RateLimitError) { code = "busy"; status = 429; }
    else if (e instanceof Anthropic.BadRequestError) { code = "ai_input"; status = 422; }
    else if (e instanceof Anthropic.APIConnectionTimeoutError) code = "ai_timeout";
    else if (e instanceof Anthropic.APIError && (e.status || 0) >= 500) code = "ai_busy";
    console.error("extract", code, e instanceof Error ? e.message.slice(0, 300) : String(e));
    await log(sc, { kind: kinds, ok: false, ms: Date.now() - t0, error: code });
    throw new AppError(code, status);
  }
}
