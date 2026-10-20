// قلب احجزلي: محادثة الحجز لكل المنشآت (نفس المنطق للواتساب الحقيقي وللمحاكي)
// المسار: ترحيب «احجز من هنا» ← (الخدمة لو أكثر من وحدة) ← المكان ← اليوم ← الوقت ← تأكيد برقم طلب
//   المكان حسب المنشأة أو الخدمة: عند العميل (اللوكيشن) · في المحل (اختيار الفرع) · أونلاين (بدون مكان)
//   الدفع: بعد الخدمة (فاتورة) · قبل الحجز (رابط دفع والموعد محجوز لين المهلة) · في المحل
// ويرد على أي رسالة: الأسئلة والأجوبة الخاصة بالمنشأة، الأسعار، الخدمات، الموقع، الأوقات، الدفع، طلباتي،
// والباقي يتحوّل للمنشأة مع إيقاف البوت عن العميل
import { db, norm, hasArabic, hasLatin, money } from "./util.ts";
import { textsFor, type Lang, type TextBag } from "./texts.ts";
import { addDays, dayLabel, hm, local, shortDay, timeLabel, todayYmd, weekdayName } from "./dates.ts";
import { locationFromText, mapsLink, nearestCity, type Pt } from "./maps.ts";
import { type Out, type Row, sendToCustomer } from "./wa.ts";
import { orderEvent } from "./events.ts";
import { mapsOf, type Mode, modeOf, placeLine, tailFor } from "./place.ts";
import { createPkgInvoice, createPrepay } from "./prepay.ts";
import { addonsOf, countShort, countText, orderLines, orderSummary, qtyOf, unitsOf } from "./extras.ts";

export type Inbound = {
  type: "text" | "reply" | "location" | "other";
  text?: string; id?: string; title?: string;
  lat?: number; lng?: number; name?: string; address?: string;
  kindLabel?: string;
};

export type Ctx = { business: any; settings: any; customer: any; services: any[]; cities: any[]; hours: any[]; channel: any };

// ───────── فهم النص الحر ─────────
const KW: [string, string[]][] = [
  ["lang_en", ["english", "انجليزي", "انقليزي", "انجلش"]],
  ["lang_ar", ["عربي", "arabic"]],
  ["complaint", ["شكوي", "اشتكي", "مشكله", "زعلان", "سيء", "سيي", "متاخر", "تاخر", "تاخير", "ما جا", "ماجا", "ما وصل", "ماوصل", "ما حضر", "خربان", "خرب", "complain", "complaint", "problem", "late", "terrible"]],
  ["human", ["موظف", "خدمه العملاء", "اكلم", "كلموني", "اتصلوا", "اتصل علي", "شخص حقيقي", "agent", "human", "someone", "call me", "representative"]],
  ["orders", ["طلباتي", "طلبي", "حجوزاتي", "حجزي", "مواعيدي", "موعدي", "my order", "my orders", "my booking", "my appointment"]],
  ["resched", ["تغيير الموعد", "غير الموعد", "اغير الموعد", "ابي اغير", "تاجيل", "اقدم الموعد", "reschedule", "change time", "change the time", "another time"]],
  ["cancel", ["الغاء", "الغي", "كنسل", "cancel"]],
  ["balance", ["رصيدي", "رصيد", "كم باقي لي", "كم بقي لي", "my balance", "balance"]],
  ["packages", ["بكج", "بكجات", "باقه", "باقات", "package", "packages", "bundle"]],
  ["location", ["وين موقعكم", "موقعكم", "وين مكانكم", "مكانكم", "وين المحل", "وين الفرع", "فروعكم", "العنوان", "عنوانكم", "اللوكيشن", "لوكيشن", "location", "address", "where are you"]],
  ["payment", ["طرق الدفع", "طريقه الدفع", "كيف ادفع", "كيف الدفع", "الدفع", "تقبلون", "مدي", "ابل باي", "كاش", "شبكه", "تحويل بنكي", "payment", "pay by", "cash", "card"]],
  ["book", ["احجز", "حجز", "موعد", "ابي فني", "ابغي فني", "اطلب", "طلب جديد", "book", "appointment", "booking", "reserve", "schedule"]],
  ["services", ["خدماتكم", "الخدمات", "وش تقدمون", "وش عندكم", "ايش عندكم", "services", "what do you offer"]],
  ["price", ["سعر", "بكم", "كم يكلف", "تكلفه", "تكلف", "الاسعار", "اسعار", "price", "prices", "cost", "how much"]],
  ["hours", ["متي تفتحون", "متي تسكرون", "الدوام", "اوقات العمل", "ساعات العمل", "تفتحون", "مفتوحين", "hours", "opening", "open today"]],
  ["areas", ["تغطون", "مناطق", "المناطق", "نطاق", "وين تخدمون", "area", "areas", "cover", "coverage"]],
  ["thanks", ["شكرا", "مشكور", "يعطيك العافيه", "الله يعطيك", "تسلم", "thanks", "thank you", "thx"]],
  ["menu", ["القائمه", "قائمه", "البدايه", "رجوع", "menu", "start", "main menu"]],
  ["greeting", ["السلام", "سلام", "هلا", "مرحبا", "اهلين", "اهلا", "صباح", "مساء", "hi", "hello", "hey", "salam", "good morning", "good evening"]],
];

const hit = (n: string, w: string) => {
  const latin = /^[a-z ]+$/.test(w);
  return latin ? n.includes(` ${w} `) || n.includes(` ${w}?`) || n.includes(` ${w}!`) : n.includes(w);
};

export function intentOf(text: string): string {
  const n = ` ${norm(text)} `;
  for (const [k, words] of KW) for (const w of words) if (hit(n, w)) return k;
  return "";
}

// الأسئلة والأجوبة الخاصة بالمنشأة: [{q: "كلمات, مفصولة, بفاصلة", a: "الجواب"}]؛ الأطول تطابقًا يكسب
export function faqMatch(faq: any, text: string): { a: string } | null {
  if (!Array.isArray(faq) || !faq.length) return null;
  const n = ` ${norm(text)} `;
  let best: { a: string; len: number } | null = null;
  for (const e of faq) {
    const a = String(e?.a || "").trim();
    if (!a) continue;
    for (const raw of String(e?.q || "").split(/[,،\n]+/)) {
      const w = norm(raw);
      if (w.length < 2) continue;
      if (hit(n, w) && (!best || w.length > best.len)) best = { a, len: w.length };
    }
  }
  return best ? { a: best.a } : null;
}

// شجرة الردود (settings.menu.tree): خيارات الترحيب، وكل خيار يا إجراء (احجز، الأسعار، خدمة معيّنة…)
// يا رسالة جديدة فوقها خياراتها (go: "msg")، وهكذا لأي عمق. المالك يكتبها من لوحته فننظفها هنا
export type TNode = { id: string; t: string; t_en: string; go: string; text: string; text_en: string; opts: TNode[] };
const TGO = /^(msg|book|orders|prices|location|hours|services|pay|contact|lang|packages|balance|home|back|svc:[0-9a-f-]{36}|faq:\d{1,2})$/;
export function cleanTree(raw: unknown): TNode[] {
  let n = 0;
  const walk = (arr: unknown, depth: number): TNode[] => {
    if (!Array.isArray(arr) || depth > 8) return [];
    const out: TNode[] = [];
    for (const x of arr.slice(0, 10)) {
      if (!x || typeof x !== "object" || ++n > 200) break;
      const o = x as any, id = String(o.id || ""), go = String(o.go || ""), t = String(o.t || "").trim().slice(0, 20);
      if (!/^[a-z0-9]{3,16}$/i.test(id) || !TGO.test(go) || !t || out.some((y) => y.id === id)) continue;
      const msg = go === "msg";
      out.push({ id, t, t_en: String(o.t_en || "").trim().slice(0, 20), go,
        text: msg ? String(o.text || "").trim().slice(0, 1000) : "", text_en: msg ? String(o.text_en || "").trim().slice(0, 1000) : "",
        opts: msg ? walk(o.opts, depth + 1) : [] });
    }
    return out;
  };
  return walk(raw, 0);
}

const STATES_WITH_LIST = new Set(["svc", "branch", "day", "time", "orders", "order", "cancel_confirm", "qty", "pkgq", "addon", "pkgs", "pkg"]);
const UUID = /^[0-9a-f-]{36}$/i;
const YES = /^(نعم|ايه|ايوه|اي|اكيد|تمام|طيب|اوكي|yes|yeah|ok|okay|sure)$/;
const NO = /^(لا|لاء|لا شكرا|لا شكرًا|بدون|ما ابي|مابي|no|nope|no thanks)$/;
const DONE = /^(تم|خلاص|كمل|كمّل|بس|يكفي|لا|بدون|لا شكرا|ما ابي|مابي|done|no|nothing|continue)$/;

class Bot {
  b: any; s: any; c: any; ctx: Ctx;
  lang: Lang; T: TextBag; tz: string;
  outs: Out[] = [];
  state: string; data: any; misses: number;
  first: boolean; stale: boolean;
  constructor(ctx: Ctx, first: boolean) {
    this.ctx = ctx; this.b = ctx.business; this.s = ctx.settings; this.c = ctx.customer;
    this.lang = this.c.lang === "en" ? "en" : "ar";
    this.T = textsFor(this.lang, this.s.texts, this.s.tone);
    this.tz = this.b.timezone || "Asia/Riyadh";
    this.state = this.c.state || "idle";
    this.data = this.c.state_data || {};
    this.misses = this.c.misses || 0;
    this.first = first;
    this.stale = !this.c.last_outbound_at || Date.now() - new Date(this.c.last_outbound_at).getTime() > 12 * 3600_000;
  }

  say(o: Out) { this.outs.push(o); }
  set(state: string, data?: any) { this.state = state; if (data !== undefined) this.data = data; }
  svcName(s: any) { return (this.lang === "en" && s.name_en) ? s.name_en : s.name; }
  cityName(c: any) { return (this.lang === "en" && c.name_en) ? c.name_en : c.name; }
  bizName() { return (this.lang === "en" && this.b.name_en) ? this.b.name_en : this.b.name; }
  svc(id?: string | null) { return this.ctx.services.find((s: any) => s.id === (id ?? this.data.svc)) || null; }
  mode(): Mode { return modeOf(this.s, this.svc()); }
  // القائمة الذكية: أزرار الترحيب الأولى (وترتيبها) واللي يظهر بعد كل رد معلوماتي، من settings.menu أو تخصيص جلسة المحاكي
  // كل عنصر: book, orders, prices, location, hours, services, pay, contact, lang, أو faq:<رقم السؤال>
  menuCfg(): { main: string[]; after: string[] } {
    const m = (this.s.menu && typeof this.s.menu === "object") ? this.s.menu : {};
    const ok = (x: unknown) => typeof x === "string" && /^(book|orders|prices|location|hours|services|pay|contact|lang|packages|balance|faq:\d{1,2})$/.test(x);
    const main = Array.isArray(m.main) ? m.main.filter(ok).slice(0, 9) : [];
    const after = Array.isArray(m.after) ? m.after.filter(ok).slice(0, 3) : [];
    return { main: main.length ? main : ["book", "orders"], after: after.length ? after : ["book", "orders"] };
  }
  menuItem(k: string): Row | null {
    if (k === "book") return { id: "m:book", title: this.T("btn_book") };
    if (k === "orders") return { id: "m:orders", title: this.T("btn_orders") };
    if (k === "prices") return { id: "m:prices", title: this.T("btn_prices") };
    if (k === "location") return { id: "m:location", title: this.T("btn_location") };
    if (k === "hours") return { id: "m:hours", title: this.T("btn_hours") };
    if (k === "services") return { id: "m:services", title: this.T("btn_services") };
    if (k === "pay") return { id: "m:pay", title: this.T("btn_payinfo") };
    if (k === "contact") return { id: "m:contact", title: this.T("btn_contact") };
    if (k === "lang") return { id: this.lang === "en" ? "m:lang:ar" : "m:lang:en", title: this.T("btn_lang") };
    if (k === "packages") return { id: "m:packages", title: this.T("btn_packages") };
    if (k === "balance") return { id: "m:balance", title: this.T("btn_balance") };
    const f = /^faq:(\d+)$/.exec(k);
    if (f) { const e = (Array.isArray(this.s.faq) ? this.s.faq : [])[+f[1]]; const title = String(e?.chip || String(e?.q || "").split(/[,،]/)[0] || "").trim(); if (e?.a && title) return { id: "m:faq:" + f[1], title: title.slice(0, 20) }; }
    return null;
  }
  menuRows(keys: string[]): Row[] { const out: Row[] = []; for (const k of keys) { const r = this.menuItem(k); if (r && !out.some((x) => x.id === r.id)) out.push(r); } return out; }
  menuButtons() { return this.menuRows(this.menuCfg().after).slice(0, 3); }
  _tree: TNode[] | null = null;
  tree(): TNode[] { return this._tree ??= cleanTree(this.s.menu?.tree); }
  treeFind(id: string): { node: TNode; parent: TNode | null } | null {
    const walk = (arr: TNode[], parent: TNode | null): { node: TNode; parent: TNode | null } | null => {
      for (const x of arr) { if (x.id === id) return { node: x, parent }; const r = walk(x.opts, x); if (r) return r; }
      return null;
    };
    return walk(this.tree(), null);
  }
  // خيارات رسالة: backTo = الرسالة اللي قبلها (لزر «رجوع»)، وnull = الترحيب
  treeRows(opts: TNode[], backTo: string | null): Row[] {
    const out: Row[] = [];
    for (const o of opts) {
      const title = (this.lang === "en" ? (o.t_en || (o.go !== "msg" ? this.menuItem(o.go)?.title : "") || o.t) : o.t).slice(0, 20);
      let id = "";
      if (o.go === "msg") id = "t:" + o.id;
      else if (o.go === "home") id = "m:home";
      else if (o.go === "back") id = backTo ? "t:" + backTo : "m:home";
      else if (o.go.startsWith("svc:")) id = this.ctx.services.some((x: any) => x.id === o.go.slice(4)) ? "m:" + o.go : "";
      else id = this.menuItem(o.go)?.id || "";
      if (id && title && !out.some((r) => r.id === id)) out.push({ id, title });
    }
    return out;
  }
  // يرسل رسالة بخياراتها: 3 وأقل أزرار، وأكثر قائمة. ويحفظ الخيارات عشان لو كتب الرقم أو اسم الخيار
  treeSay(text: string, all: Row[], button = this.T("btn_more")) {
    const rows = all.slice(0, 10);
    this.data.rows = rows.map((r) => r.id); this.data.rowt = rows.map((r) => norm(r.title));
    if (rows.length <= 3) this.say({ t: "buttons", text, buttons: rows });
    else this.say({ t: "list", text, button, sections: [{ rows }] });
  }
  treeNode(id: string) {
    const f = this.treeFind(id);
    if (!f || f.node.go !== "msg") return this.welcome();
    const n = f.node, text = (this.lang === "en" && n.text_en) || n.text || n.t;
    this.set("idle", {});
    const rows = this.treeRows(n.opts, f.parent?.id ?? null);
    if (!rows.length) return this.reply(text);
    this.treeSay(text, rows);
  }
  over(k: string): string { const v = this.s.texts?.[this.lang]?.[k]; return (typeof v === "string" && v.trim()) ? v : ""; }
  // رد معلوماتي + «وش بعده» حسب التخصيص
  reply(text: string) { this.say({ t: "buttons", text, buttons: this.menuButtons() }); }
  list(text: string, button: string, rows: Row[], extra: Partial<Out> = {}) {
    this.data.rows = rows.map((r) => r.id);
    this.say({ t: "list", text, button, sections: [{ rows }], ...(extra as any) });
  }

  async flush() {
    const st = { state: this.state, state_data: this.data, misses: this.misses };
    await db().from("customers").update(st).eq("id", this.c.id);
    if (this.outs.length) await sendToCustomer(this.b, this.ctx.channel, this.c, this.outs, { purpose: "reply", by: "bot" });
  }

  // ───────── التوجيه ─────────
  async route(m: Inbound) {
    if (m.type === "reply" && m.id) return this.onId(m.id);
    const text = (m.text || "").trim();
    // سؤال قبل الحجز (رقم اللوحة، تفاصيل الموقع…): أي نص هو جوابه
    if (this.state === "ask") {
      if (m.type === "text" && text) {
        if (intentOf(text) === "menu" && [...text].length <= 12) return this.welcome();
        return this.onAnswer(text);
      }
      this.say({ t: "text", text: this.T("bad_answer") });
      return this.nextStep();
    }
    if (m.type === "location" && Number.isFinite(m.lat) && Number.isFinite(m.lng)) {
      return this.onLocation({ lat: m.lat!, lng: m.lng! }, "", [m.name, m.address].filter(Boolean).join("، "));
    }
    if (m.type === "text" && text) {
      if (this.state === "loc") {
        const p = await locationFromText(text);
        if (p) return this.onLocation(p, p.url, "");
      }
      // كتابة بدل الضغط: «واكس»، «لا»، «نعم»
      const t0 = norm(text);
      if (this.state === "addon") { const r = this.addonFromText(t0); if (r) return this.onAddon(r); }
      if (this.state === "pkgq") {
        if (YES.test(t0) || /رصيد|balance/.test(t0)) return this.onUsePkg(String(this.data.offer || "0"));
        if (NO.test(t0) || /عادي|ادفع|pay/.test(t0)) return this.onUsePkg("0");
      }
      if (this.state === "qty") { const n = this.qtyFromText(t0); if (n) return this.onQty(n); }
      // رقم من القائمة الأخيرة (لو كتب 2 بدل ما يضغط)
      const num = text.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).trim();
      if (/^\d{1,2}$/.test(num) && (STATES_WITH_LIST.has(this.state) || this.state === "idle") && Array.isArray(this.data.rows)) {
        const id = this.data.rows[+num - 1];
        if (id) return this.onId(id);
      }
      if (this.state === "idle" && Array.isArray(this.data.rowt) && Array.isArray(this.data.rows)) {
        const i = this.data.rowt.indexOf(t0);
        if (i >= 0 && this.data.rows[i]) return this.onId(this.data.rows[i]);
      }
      const it = intentOf(text);
      if (it === "lang_en") return this.setLang("en");
      if (it === "lang_ar") return this.setLang("ar");
      if (it === "complaint") return this.handoff("complaint", text);
      if (it === "human") return this.handoff("human", text);
      // أسئلة المنشأة الخاصة قبل الأسئلة العامة
      const fa = faqMatch(this.s.faq, text);
      if (fa) { this.reply(fa.a); return; }
      switch (it) {
        case "orders": return this.listOrders("");
        case "resched": return this.listOrders("resched");
        case "cancel": return this.listOrders("cancel");
        case "location": return this.locationInfo();
        case "payment": return this.paymentInfo();
        case "balance": return this.balanceInfo();
        case "packages": return this.packagesList();
        case "book": return this.startBooking();
        case "services": return this.servicesInfo();
        case "price": return this.prices();
        case "hours": return this.hoursInfo();
        case "areas": return this.locationInfo();
        case "thanks": this.say({ t: "text", text: this.T("thanks") }); return;
        case "menu": return this.welcome();
        case "greeting": return this.welcome();
      }
    }
    // ما فهمنا
    if (this.state === "loc") {
      this.misses++;
      if (this.misses >= 3) return this.handoff("location", text || m.kindLabel || "");
      this.say({ t: "location_request", text: this.T("bad_location") });
      return;
    }
    if (STATES_WITH_LIST.has(this.state)) {
      this.misses++;
      if (this.misses >= 3) return this.handoff("unknown", text || m.kindLabel || "");
      this.say({ t: "text", text: this.T("pick_from_list") });
      return this.repeatPrompt();
    }
    if (this.first || this.stale) return this.welcome();
    return this.handoff("unknown", text || m.kindLabel || "");
  }

  async onId(id: string) {
    const i = id.indexOf(":");
    const k = i < 0 ? id : id.slice(0, i), v = i < 0 ? "" : id.slice(i + 1);
    this.misses = 0;
    switch (k) {
      case "m":
        if (v === "book" || v === "new") return this.startBooking();
        if (v === "bookbal") return this.startBooking(true);
        if (v === "orders") return this.listOrders("");
        if (v === "lang:en") return this.setLang("en");
        if (v === "lang:ar") return this.setLang("ar");
        if (v === "contact") return this.handoff("human", this.lang === "en" ? "Contact us" : "تواصل معنا");
        if (v === "prices") return this.prices();
        if (v === "location") return this.locationInfo();
        if (v === "hours") return this.hoursInfo();
        if (v === "services") return this.servicesInfo();
        if (v === "pay") return this.paymentInfo();
        if (v === "packages") return this.packagesList();
        if (v === "balance") return this.balanceInfo();
        if (v.startsWith("faq:")) { const e = (Array.isArray(this.s.faq) ? this.s.faq : [])[+v.slice(4)]; if (e?.a) return this.reply(String(e.a)); }
        // من شجرة الردود: حجز خدمة معيّنة على طول
        if (v.startsWith("svc:")) { this.set("idle", {}); return this.onService(v.slice(4)); }
        return this.welcome();
      case "t": return this.treeNode(v);
      case "qty": return this.onQty(+v);
      case "pku": return this.onUsePkg(v);
      case "ad": return this.onAddon(v);
      case "pk": return this.packageInfo(v);
      case "pkb": return this.buyPackage(v);
      case "svc": return this.onService(v);
      case "svp": return this.askService(+v || 0);
      case "br": return this.onBranch(v);
      case "loc": return this.askLocation();
      case "day": return this.onDay(v);
      case "more": { const [ymd, page] = v.split(":"); return this.askTime(ymd, +page || 0); }
      case "slot": return this.onSlot(v);
      case "ord": return this.onOrder(v, "");
      case "rs": return this.startResched(v);
      case "cx": return this.askCancel(v);
      case "cy": return this.doCancel(v);
      case "cn": return this.keepOrder(v);
      case "back": return this.listOrders("");
    }
    return this.welcome();
  }

  // ───────── الترحيب واللغة ─────────
  async welcome() {
    this.set("idle", {});
    const cfg = this.menuCfg(), tree = this.tree();
    let rows = tree.length ? this.treeRows(tree, null) : this.menuRows(cfg.main);
    let text = this.T("welcome", { biz: this.bizName() });
    // مشترك في بكج: نذكّره برصيده، وزر الحجز يصير «احجز من رصيدي» (ينخصم بدون دفع)
    const bal = await this.balances();
    if (bal.length) {
      text += this.T("welcome_balance", { left: countShort(this.pkgUnits(), bal.reduce((a: number, x: any) => a + x.uses_left, 0), this.lang) });
      const bk = { id: "m:bookbal", title: this.T("btn_book_balance") };
      rows = rows.some((r) => r.id === "m:book") ? rows.map((r) => r.id === "m:book" ? bk : r) : [bk, ...rows];
    }
    if (tree.length && rows.length) return this.treeSay(text, rows);
    if (rows.length <= 3) {
      // الافتراضي: الحجز وطلباتي وزر اللغة (لو ما اختار المالك قائمته)
      const btns = (this.s.menu && Array.isArray(this.s.menu.main) && this.s.menu.main.length) ? rows : [...rows, { id: this.lang === "en" ? "m:lang:ar" : "m:lang:en", title: this.T("btn_lang") }];
      this.say({ t: "buttons", text, buttons: btns.slice(0, 3) });
      return;
    }
    this.data.rows = rows.map((r) => r.id);
    this.say({ t: "list", text, button: this.T("btn_more"), sections: [{ rows }] });
  }

  async setLang(l: Lang) {
    this.lang = l; this.T = textsFor(l, this.s.texts, this.s.tone); this.c.lang = l;
    await db().from("customers").update({ lang: l }).eq("id", this.c.id);
    return this.welcome();
  }

  // ───────── الحجز ─────────
  // fromBalance: ضغط «احجز من رصيدي»، فلو رصيده يغطي الخدمة ينخصم منه على طول بدون سؤال
  startBooking(fromBalance = false) {
    this.set("idle", fromBalance ? { prefer: true } : {});
    const svcs = this.ctx.services;
    if (svcs.length > 1) return this.askService();
    this.data.svc = svcs[0]?.id || null;
    return this.nextStep();
  }

  // خطوات الحجز بالترتيب: الخدمة ← العدد ← الرصيد ← الإضافات ← المكان ← أسئلة المنشأة ← اليوم والوقت
  async nextStep(): Promise<void> {
    const s = this.svc();
    if (!s && this.ctx.services.length > 1) return this.askService();
    const q = qtyOf(s);
    if (q && !this.data.qty) return this.askQty(s, q);
    if (this.data.pkg === undefined) {
      const p = s ? await this.usablePkg(s, this.data.qty || 1) : null;
      if (p && this.data.prefer) this.data.pkg = p.id;
      else if (p) return this.askUsePkg(p);
      else {
        this.data.pkg = null;
        // ضغط «احجز من رصيدي» بس رصيده ما يغطي هالخدمة أو العدد: نقول له قبل ما نكمل بالدفع
        if (this.data.prefer) this.say({ t: "text", text: this.T("pkg_not_cover") });
      }
    }
    if (addonsOf(s).length && !this.data.adDone) return this.askAddons();
    if (!this.data.placed) return this.place();
    const qs = this.questionsFor(s), ans = Array.isArray(this.data.ans) ? this.data.ans : [];
    if (ans.length < qs.length) return this.askQuestion(qs[ans.length]);
    return this.askDay();
  }

  // ── العدد (كم سيارة) ──
  async askQty(s: any, q: any) {
    this.set("qty");
    const rows: Row[] = [];
    // حاجز من رصيده: يبين كم ينخصم بدل السعر
    const bal = this.data.prefer ? (await this.balances()).filter((p: any) => !(p.service_ids || []).length || p.service_ids.includes(s.id)) : [];
    const left = bal.reduce((a: number, p: any) => Math.max(a, p.uses_left), 0);
    for (let n = 1; n <= q.max; n++) rows.push({ id: `qty:${n}`, title: countText(q, n, this.lang),
      desc: left >= n ? this.T("qty_from_balance", { n: countText(this.pkgUnits(), n, this.lang) })
        : s?.price != null ? this.T(s.price_from ? "price_from" : "price_fixed", { price: money(Number(s.price) * n) }) : "" });
    this.list(this.T("ask_qty", { one: q.one, en_many: q.en_many }), this.T("btn_qty"), rows);
  }
  // «سيارتين»، «ثلاث سيارات»، «وحدة» (الأرقام نفسها تمشي من القائمة)
  qtyFromText(t: string): number {
    const q = qtyOf(this.svc());
    if (!q) return 0;
    const words: [RegExp, number][] = [[/(^| )(وحده|واحد|وحدة|one)( |$)/, 1], [/(^| )(ثنتين|اثنين|ثنين|two)( |$)/, 2], [/(^| )(ثلاث|ثلاثه|three)( |$)/, 3], [/(^| )(اربع|اربعه|four)( |$)/, 4], [/(^| )(خمس|خمسه|five)( |$)/, 5]];
    for (const [re, n] of words) if (re.test(t) && n <= q.max) return n;
    if (q.two && t.includes(norm(q.two))) return 2;
    if (q.one && t === norm(q.one)) return 1;
    return 0;
  }
  onQty(n: number) {
    const q = qtyOf(this.svc());
    if (!q || !Number.isInteger(n) || n < 1 || n > q.max) return this.nextStep();
    this.data.qty = n;
    delete this.data.pkg;
    return this.nextStep();
  }

  // ── رصيد البكج: لو عنده رصيد يغطي الخدمة، يختار يستخدمه أو يدفع عادي ──
  async balances(): Promise<any[]> {
    const { data } = await db().from("customer_packages").select("id, name, uses_left, uses_total, service_ids")
      .eq("customer_id", this.c.id).eq("business_id", this.b.id).eq("status", "active").gt("uses_left", 0).order("created_at");
    return data || [];
  }
  async usablePkg(s: any, qty: number) {
    return (await this.balances()).find((p: any) => p.uses_left >= qty && (!(p.service_ids || []).length || p.service_ids.includes(s.id))) || null;
  }
  pkgUnits() { return unitsOf(this.s.pkg_unit); }
  askUsePkg(p: any) {
    this.set("pkgq");
    this.data.offer = p.id;
    this.data.rows = [`pku:${p.id}`, "pku:0"];
    this.say({ t: "buttons", text: this.T("ask_use_pkg", { name: p.name, left: countShort(this.pkgUnits(), p.uses_left, this.lang) }), buttons: [
      { id: `pku:${p.id}`, title: this.T("btn_use_pkg") }, { id: "pku:0", title: this.T("btn_pay_normal") },
    ] });
  }
  onUsePkg(v: string) {
    this.data.pkg = UUID.test(v) ? v : null;
    delete this.data.offer;
    return this.nextStep();
  }

  // ── الإضافات: يختار وحدة وحدة، واللي من نفس المجموعة (تكييس دعاستين أو 4) تختفي بعد ما يختار وحدة منها ──
  addonName(a: any) { return (this.lang === "en" && a.name_en) ? a.name_en : a.name; }
  pickedAddons() { const list = addonsOf(this.svc()); return (Array.isArray(this.data.ad) ? this.data.ad : []).map((i: number) => list[i]).filter(Boolean); }
  askAddons() {
    const list = addonsOf(this.svc());
    const picked: number[] = Array.isArray(this.data.ad) ? this.data.ad : [];
    const groups = new Set(picked.map((i) => list[i]?.group).filter(Boolean));
    const rows: Row[] = list.map((a, i) => ({ a, i })).filter(({ a, i }) => !picked.includes(i) && !(a.group && groups.has(a.group)))
      .map(({ a, i }) => ({ id: `ad:${i}`, title: this.addonName(a), desc: this.T("addon_desc", { price: money(a.price) }) }));
    if (!rows.length) {
      // اختار كل اللي يقدر عليه: نأكد آخر وحدة ونكمل على طول
      if (picked.length) this.say({ t: "text", text: this.T("addon_added", { name: this.addonName(list[picked[picked.length - 1]]) }) });
      this.data.adDone = true;
      return this.nextStep();
    }
    rows.push({ id: "ad:done", title: this.T(picked.length ? "addon_done" : "addon_none") });
    this.set("addon");
    const last = picked.length ? list[picked[picked.length - 1]] : null;
    this.list(last ? this.T("ask_addons_more", { name: this.addonName(last) }) : this.T("ask_addons"), this.T("btn_addons"), rows);
  }
  onAddon(v: string) {
    if (!this.svc()) return this.nextStep();
    if (v === "done") { this.data.adDone = true; return this.nextStep(); }
    const i = Number(v), list = addonsOf(this.svc());
    if (!Number.isInteger(i) || !list[i]) return this.askAddons();
    const picked: number[] = Array.isArray(this.data.ad) ? this.data.ad : [];
    const g = list[i].group;
    if (!picked.includes(i) && !(g && picked.some((j) => list[j]?.group === g))) picked.push(i);
    this.data.ad = picked;
    return this.askAddons();
  }
  addonFromText(t: string): string | null {
    if (DONE.test(t)) return "done";
    const list = addonsOf(this.svc());
    for (let i = 0; i < list.length; i++) {
      const n = norm(list[i].name), e = norm(list[i].name_en);
      if ((n && (t.includes(n) || (t.length >= 3 && n.includes(t)))) || (e && (t.includes(e) || (t.length >= 3 && e.includes(t))))) return String(i);
    }
    return null;
  }

  // ── أسئلة المنشأة قبل الحجز (رقم اللوحة، تفاصيل الموقع…) ──
  questionsFor(s: any) {
    const all = Array.isArray(this.s.ask) ? this.s.ask : [];
    return all.filter((q: any) => q && String(q.q || "").trim() && (!Array.isArray(q.svc) || !q.svc.length || (s && q.svc.includes(s.id)))).slice(0, 5);
  }
  askQuestion(q: any) {
    this.set("ask");
    const t = (this.lang === "en" && q.q_en) ? q.q_en : q.q;
    const h = (this.lang === "en" && q.hint_en) ? q.hint_en : (q.hint || "");
    this.say({ t: "text", text: h ? `${t}\n${h}` : t });
  }
  onAnswer(text: string) {
    const qs = this.questionsFor(this.svc()), ans = Array.isArray(this.data.ans) ? this.data.ans : [];
    const q = qs[ans.length];
    if (!q) return this.nextStep();
    const a = text.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!a) { this.say({ t: "text", text: this.T("bad_answer") }); return this.askQuestion(q); }
    // اسم قصير للسؤال في الملخص: «وش رقم لوحة السيارة؟» ← «رقم لوحة السيارة»
    const label = String(q.label || ((this.lang === "en" && q.q_en) ? q.q_en : q.q))
      .replace(/^\s*(وش|ايش|إيش|ما هو|ما هي|كم|what is|what's|your)\s+/i, "").replace(/[؟?]\s*$/, "").trim();
    ans.push({ q: label.slice(0, 60), a });
    this.data.ans = ans;
    return this.nextStep();
  }

  // بنود الطلب والإجمالي من اختيارات العميل
  draft() {
    const s = this.svc();
    const qty = this.data.qty || 1;
    const addons = this.pickedAddons().map((a: any) => ({ name: this.addonName(a), price: a.price }));
    const pkg = !!this.data.pkg;
    const { lines, total } = orderLines({ svcName: s ? this.svcName(s) : "", unit: s?.price != null ? Number(s.price) : null, qty, pkg, addons, fromBalance: this.T("from_balance") });
    const q = qtyOf(s);
    const extras: any = { addons, answers: Array.isArray(this.data.ans) ? this.data.ans : [] };
    if (q) extras.unit = { one: q.one, two: q.two, many: q.many, en_one: q.en_one, en_many: q.en_many };
    const fancy = qty > 1 || addons.length || extras.answers.length || pkg;
    return { qty, lines, total, extras, pkg: this.data.pkg || null, uses: pkg ? qty : 0, fancy };
  }

  // قائمة الواتساب 10 صفوف بالكثير: لو الخدمات أكثر، 9 بكل صفحة وصف أخير «خدمات أكثر»
  askService(page = 0) {
    this.set("svc");
    const all = this.ctx.services, per = all.length > 10 ? 9 : 10;
    const pages = Math.max(1, Math.ceil(all.length / per)), p = Math.min(Math.max(0, page | 0), pages - 1);
    const rows: Row[] = all.slice(p * per, p * per + per).map((s: any) => ({
      id: `svc:${s.id}`, title: this.svcName(s),
      desc: s.price != null ? this.priceText(s) : (modeOf(this.s, s) === "visit" ? this.T("price_after") : ""),
    }));
    if (pages > 1) rows.push({ id: `svp:${(p + 1) % pages}`, title: this.T(p + 1 < pages ? "more_services" : "first_services"), desc: `${p + 1}/${pages}` });
    this.list(this.T("ask_service"), this.T("btn_services"), rows);
  }
  priceText(s: any) { return this.T(s.price_from ? "price_from" : "price_fixed", { price: money(s.price) }); }

  onService(id: string) {
    const s = this.ctx.services.find((x: any) => x.id === id);
    if (!s) return this.askService();
    // خدمة جديدة: اختيارات الخدمة السابقة تنمسح (المكان يبقى لو أرسله)
    for (const k of ["qty", "pkg", "offer", "ad", "adDone", "ans"]) delete this.data[k];
    this.data.svc = s.id;
    return this.nextStep();
  }

  // المكان حسب الخدمة: عند العميل (اللوكيشن) · في المحل (الفرع) · أونلاين
  place() {
    const mode = this.mode();
    if (mode === "visit") {
      if (Number.isFinite(this.data.lat)) { this.data.placed = true; return this.nextStep(); }
      return this.askLocation();
    }
    if (mode === "shop") {
      const br = this.ctx.cities;
      if (br.length > 1) return this.askBranch();
      this.data.city = br[0]?.id || null;
    } else {
      this.data.city = null;
    }
    this.data.placed = true;
    return this.nextStep();
  }

  askBranch() {
    this.set("branch");
    const rows = this.ctx.cities.slice(0, 10).map((c: any) => ({ id: `br:${c.id}`, title: this.cityName(c), desc: c.address || "" }));
    this.list(this.T("ask_branch"), this.T("btn_branches"), rows);
  }

  onBranch(id: string) {
    const c = this.ctx.cities.find((x: any) => x.id === id);
    if (!c) return this.askBranch();
    this.data.city = c.id; this.data.placed = true;
    return this.nextStep();
  }

  askLocation() {
    this.set("loc");
    this.misses = 0;
    this.say({ t: "location_request", text: this.T("ask_location") });
  }

  async onLocation(p: Pt, url: string, address: string) {
    // موقع وصل وهو مو في خطوة الموقع: نعتبره بداية حجز
    if (this.state !== "loc") {
      const d = this.data || {}, keep: any = { svc: d.svc || null };
      for (const k of ["qty", "pkg", "ad", "adDone", "ans"]) if (d[k] !== undefined) keep[k] = d[k];
      this.data = keep;
    }
    let city: any = null;
    if (this.ctx.cities.length) {
      city = nearestCity(this.ctx.cities, p);
      if (!city) {
        this.set("loc");
        this.say({ t: "buttons", text: this.T("out_of_area", { cities: this.ctx.cities.map((c: any) => this.cityName(c)).join("، ") }), buttons: [
          { id: "loc:retry", title: this.T("btn_other_location") },
          { id: "m:contact", title: this.T("btn_contact") },
        ] });
        return;
      }
    }
    Object.assign(this.data, { lat: p.lat, lng: p.lng, maps: url || mapsLink(p), addr: address || "", city: city?.id || null });
    this.data.placed = true;
    if (!this.data.svc) {
      if (this.ctx.services.length > 1) return this.askService();
      this.data.svc = this.ctx.services[0]?.id || null;
    }
    return this.nextStep();
  }

  async slots(fromYmd: string, days: number) {
    const { data, error } = await db().rpc("ihj_free_slots", {
      p_business: this.b.id, p_city: this.data.city || null, p_service: this.data.svc || null,
      p_from: fromYmd, p_days: days, p_exclude: this.data.rs || null,
    });
    if (error) throw new Error("slots: " + error.message);
    return (data || []) as { slot_start: string; slot_end: string; free: number }[];
  }

  async askDay() {
    const from = todayYmd(this.tz);
    const slots = await this.slots(from, this.s.days_ahead || 7);
    const byDay = new Map<string, number>();
    for (const x of slots) { const d = local(x.slot_start, this.tz).ymd; byDay.set(d, (byDay.get(d) || 0) + 1); }
    if (!byDay.size) {
      this.set("idle", {});
      this.say({ t: "buttons", text: this.T("no_days"), buttons: [{ id: "m:contact", title: this.T("btn_contact") }] });
      return;
    }
    const tomorrow = addDays(from, 1);
    const rows: Row[] = [...byDay.entries()].slice(0, 10).map(([d, n]) => {
      const rel = d === from ? this.T("today") : d === tomorrow ? this.T("tomorrow") : "";
      const cnt = n === 1 ? this.T("day_desc_one") : n === 2 ? this.T("day_desc_two") : n <= 10 ? this.T("day_desc", { n }) : this.T("day_desc_many", { n });
      return { id: `day:${d}`, title: dayLabel(d, this.lang, this.tz, false), desc: rel ? `${rel} · ${cnt}` : cnt };
    });
    this.set("day");
    this.list(this.T("ask_day"), this.T("btn_days"), rows);
  }

  onDay(ymd: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return this.welcome();
    if (!this.data.rs && !this.data.placed) return this.startBooking();
    this.data.day = ymd;
    return this.askTime(ymd, 0);
  }

  async askTime(ymd: string, page: number) {
    const slots = await this.slots(ymd, 1);
    if (!slots.length) { this.say({ t: "text", text: this.T("slot_taken") }); return this.askDay(); }
    let rows: Row[];
    if (slots.length <= 10) rows = slots.map((x) => ({ id: `slot:${x.slot_start}`, title: timeLabel(x.slot_start, this.lang, this.tz) }));
    else {
      const per = 9, pages = Math.ceil(slots.length / per), pg = page % pages;
      rows = slots.slice(pg * per, pg * per + per).map((x) => ({ id: `slot:${x.slot_start}`, title: timeLabel(x.slot_start, this.lang, this.tz) }));
      rows.push({ id: `more:${ymd}:${pg + 1}`, title: this.T("more_times"), desc: `${pg + 1}/${pages}` });
    }
    this.data.day = ymd;
    this.set("time");
    this.list(this.T("ask_time", { day: dayLabel(ymd, this.lang, this.tz, false) }), this.T("btn_times"), rows);
  }

  // الدفع الإلكتروني متاح؟ (ميسر بحساب المنشأة، أو تجريبي، وتجارب المحاكي تدفع تجريبي)
  canPayOnline() {
    if (!(this.b.plan === "bot_pay" || this.b.is_demo)) return false;
    return ["demo", "moyasar"].includes(this.s.pay_provider) || !!this.c.is_sim;
  }

  // كم يدفع العميل قبل التأكيد (صفر = ما فيه دفع مقدم). total = إجمالي الطلب لو معروف (الخدمة × العدد + الإضافات، أو الإضافات بس لو من رصيده)
  prepayAmount(svc: any, total: number | null = null): number {
    if (this.s.pay_timing !== "before" || !this.canPayOnline()) return 0;
    if (total != null) return total >= 1 ? total : 0;
    const amt = svc?.price != null && Number(svc.price) > 0 ? Number(svc.price) : Number(this.s.prepay_amount || 0);
    return amt >= 1 ? amt : 0;
  }

  async onSlot(iso: string) {
    const t = new Date(iso);
    if (isNaN(t.getTime())) return this.welcome();
    if (this.data.rs) return this.doResched(t.toISOString());
    if (!this.data.placed) return this.startBooking();
    const svc = this.svc();
    const dr = this.draft();
    const amount = this.prepayAmount(svc, dr.total);
    const hold = Number(this.s.hold_minutes || 30);
    const { data: o, error } = await db().rpc("ihj_book", {
      p_business: this.b.id, p_customer: this.c.id, p_city: this.data.city || null, p_service: this.data.svc || null,
      p_start: t.toISOString(), p_lat: this.data.lat ?? null, p_lng: this.data.lng ?? null, p_maps_url: this.data.maps || "", p_address: this.data.addr || "",
      p_channel: this.c.is_sim ? "sim" : "wa", p_notes: "",
      p_status: amount > 0 ? "pending_payment" : "confirmed", p_hold_until: amount > 0 ? new Date(Date.now() + hold * 60_000).toISOString() : null,
    });
    if (error) {
      if (/slot_taken/.test(error.message)) { this.say({ t: "text", text: this.T("slot_taken") }); return this.askTime(this.data.day || local(t, this.tz).ymd, 0); }
      throw new Error("book: " + error.message);
    }
    let order = o as any;
    // العدد والإضافات والأجوبة والرصيد (الرصيد ينخصم هنا مرة وحدة، ولو خلص قبلها نرجع للدفع العادي)
    if (dr.fancy || dr.total != null) {
      const { data: o2, error: e2 } = await db().rpc("ihj_order_extras", { p_order: order.id, p_qty: dr.qty, p_extras: dr.extras, p_total: dr.total, p_pkg: dr.pkg, p_uses: dr.uses });
      if (e2) {
        if (/pkg_unavailable/.test(e2.message)) {
          await db().rpc("ihj_cancel", { p_order: order.id, p_by: "system", p_reason: "pkg" });
          this.data.pkg = null; delete this.data.offer;
          this.say({ t: "text", text: this.T("pkg_unavailable") });
          return this.nextStep();
        }
        throw new Error("extras: " + e2.message);
      }
      order = o2 as any;
    }
    const city = this.ctx.cities.find((c: any) => c.id === order.city_id);
    const mode = this.mode();
    const day = dayLabel(local(order.slot_start, this.tz).ymd, this.lang, this.tz, false), time = timeLabel(order.slot_start, this.lang, this.tz);
    let pkgLeft = "";
    if (order.pkg_id && order.pkg_uses > 0) {
      const { data: cp } = await db().from("customer_packages").select("uses_left").eq("id", order.pkg_id).maybeSingle();
      if (cp) pkgLeft = countShort(this.pkgUnits(), cp.uses_left, this.lang);
    }
    const summary = orderSummary(this.T, this.lang, order, svc ? this.svcName(svc) : "", pkgLeft);
    const city_line = placeLine(this.T, this.s, mode, city, this.lang);
    this.set("idle", {});
    if (order.status === "pending_payment") {
      const pre = await createPrepay(this.b, this.s, order, amount, svc ? `${this.svcName(svc)} · ${this.T("prepay_label")}` : this.T("prepay_label"), dr.lines.filter((l) => l.price > 0 || dr.pkg));
      if (pre) {
        this.say({ t: "cta", text: this.T("pay_to_confirm", { amount: money(amount), day, time, city_line: city_line + summary, hold }), label: this.T("btn_pay_confirm"), url: pre.link });
        return;
      }
      // ما فيه بوابة دفع شغالة: نأكد الحجز عادي
      await db().from("orders").update({ status: "confirmed", hold_until: null }).eq("id", order.id);
      order.status = "confirmed";
    }
    const price = order.price != null ? this.T(svc?.price_from ? "price_from" : "price_fixed", { price: money(order.price) }) : this.T("price_after");
    const price_line = summary || (order.price != null || mode === "visit" ? this.T("price_line", { price }) : "");
    this.say({ t: "buttons", text: this.T("confirmed", { no: order.number, day, time, city_line, price, price_line, tail: tailFor(this.T, this.s, mode, this.lang) }),
      buttons: [{ id: "m:orders", title: this.T("btn_orders") }, { id: "m:new", title: this.T("btn_new_order") }] });
    await orderEvent(this.b.id, "order.created", { order_id: order.id, is_test: order.is_test });
  }

  // ───────── طلباتي ─────────
  async myOrders() {
    const { data } = await db().from("orders").select("id, number, status, slot_start, city_id, service_id")
      .eq("customer_id", this.c.id).not("status", "in", "(done,cancelled)").order("slot_start").limit(10);
    return data || [];
  }

  statusLabel(s: string) { return this.T(`st_${s}`); }

  async listOrders(mode: string) {
    const rows = await this.myOrders();
    if (!rows.length) {
      this.set("idle", {});
      this.say({ t: "buttons", text: this.T("no_orders"), buttons: [{ id: "m:book", title: this.T("btn_book") }] });
      return;
    }
    if (rows.length === 1) return this.onOrder(rows[0].id, mode);
    this.set("orders", { mode });
    this.list(this.T("my_orders"), this.T("btn_orders"), rows.map((o: any) => ({
      id: `ord:${o.id}`, title: `${this.lang === "en" ? "#" : "رقم "}${o.number} · ${shortDay(local(o.slot_start, this.tz).ymd, this.lang)}`,
      desc: `${timeLabel(o.slot_start, this.lang, this.tz)} · ${this.statusLabel(o.status)}`,
    })));
  }

  async getOrder(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const { data } = await db().from("orders").select("*").eq("id", id).eq("customer_id", this.c.id).maybeSingle();
    return data;
  }

  orderInfo(o: any) {
    return this.T("order_info", { no: o.number, day: dayLabel(local(o.slot_start, this.tz).ymd, this.lang, this.tz, false), time: timeLabel(o.slot_start, this.lang, this.tz), status: this.statusLabel(o.status) });
  }

  async onOrder(id: string, mode: string) {
    const o = await this.getOrder(id);
    if (!o) return this.listOrders("");
    mode = mode || this.data?.mode || "";
    if (o.status === "pending_payment") {
      // حجز ينتظر الدفع: نعيد له رابط الدفع
      const { data: inv } = await db().from("invoices").select("pay_token, total").eq("order_id", o.id).eq("status", "issued").order("created_at", { ascending: false }).limit(1).maybeSingle();
      this.set("idle", {});
      if (inv && mode !== "cancel") {
        const { payGo } = await import("./prepay.ts");
        this.say({ t: "cta", text: `${this.orderInfo(o)}`, label: this.T("btn_pay_confirm"), url: payGo(inv.pay_token) });
        return;
      }
      return this.askCancel(o.id);
    }
    if (o.status !== "confirmed") {
      this.set("idle", {});
      this.say({ t: "buttons", text: `${this.orderInfo(o)}\n\n${this.T("order_locked", { no: o.number })}`, buttons: [{ id: "m:contact", title: this.T("btn_contact") }] });
      return;
    }
    if (mode === "cancel") return this.askCancel(o.id);
    if (mode === "resched") return this.startResched(o.id);
    this.set("order", { oid: o.id });
    this.data.rows = [`rs:${o.id}`, `cx:${o.id}`, "back:"];
    this.say({ t: "buttons", text: this.orderInfo(o), buttons: [
      { id: `rs:${o.id}`, title: this.T("btn_change_time") },
      { id: `cx:${o.id}`, title: this.T("btn_cancel_order") },
      { id: "back:", title: this.T("btn_back") },
    ] });
  }

  async startResched(id: string) {
    const o = await this.getOrder(id);
    if (!o) return this.listOrders("");
    if (o.status !== "confirmed") return this.onOrder(o.id, "");
    this.set("idle", { rs: o.id, city: o.city_id, svc: o.service_id });
    return this.askDay();
  }

  async doResched(iso: string) {
    const { data: o, error } = await db().rpc("ihj_reschedule", { p_order: this.data.rs, p_start: iso, p_by: "customer" });
    if (error) {
      if (/slot_taken/.test(error.message)) { this.say({ t: "text", text: this.T("slot_taken") }); return this.askTime(this.data.day || local(iso, this.tz).ymd, 0); }
      if (/locked|not_found/.test(error.message)) { this.set("idle", {}); return this.listOrders(""); }
      throw new Error("resched: " + error.message);
    }
    const order = o as any;
    this.set("idle", {});
    this.say({ t: "buttons", text: this.T("rescheduled", { no: order.number, day: dayLabel(local(order.slot_start, this.tz).ymd, this.lang, this.tz, false), time: timeLabel(order.slot_start, this.lang, this.tz) }),
      buttons: [{ id: "m:orders", title: this.T("btn_orders") }] });
    await orderEvent(this.b.id, "order.rescheduled", { order_id: order.id, is_test: order.is_test });
  }

  async askCancel(id: string) {
    const o = await this.getOrder(id);
    if (!o) return this.listOrders("");
    if (!["confirmed", "pending_payment"].includes(o.status)) return this.onOrder(o.id, "");
    this.set("cancel_confirm", { oid: o.id });
    this.data.rows = [`cy:${o.id}`, `cn:${o.id}`];
    this.say({ t: "buttons", text: this.T("confirm_cancel", { no: o.number }), buttons: [
      { id: `cy:${o.id}`, title: this.T("btn_yes_cancel") },
      { id: `cn:${o.id}`, title: this.T("btn_no") },
    ] });
  }

  async doCancel(id: string) {
    const o = await this.getOrder(id);
    if (!o) return this.listOrders("");
    const { data: x, error } = await db().rpc("ihj_cancel", { p_order: o.id, p_by: "customer", p_reason: "" });
    if (error) { return this.onOrder(o.id, ""); }
    await db().from("invoices").update({ status: "void" }).eq("order_id", o.id).eq("status", "issued");
    this.set("idle", {});
    this.say({ t: "buttons", text: this.T("cancelled", { no: o.number }), buttons: [{ id: "m:book", title: this.T("btn_book") }] });
    if (o.status !== "pending_payment") await orderEvent(this.b.id, "order.cancelled", { order_id: o.id, is_test: (x as any)?.is_test });
  }

  async keepOrder(id: string) {
    const o = await this.getOrder(id);
    this.set("idle", {});
    this.say({ t: "buttons", text: this.T("kept", { no: o?.number ?? "" }), buttons: [{ id: "m:orders", title: this.T("btn_orders") }] });
  }

  // ───────── أي سؤال: معلومات ─────────
  servicesLines(withPrice: boolean) {
    return this.ctx.services.map((s: any) => `• ${this.svcName(s)}${withPrice ? `: ${s.price != null ? this.priceText(s) : this.T("price_after")}` : (s.price != null ? ` · ${this.priceText(s)}` : "")}`).join("\n");
  }

  prices() {
    if (this.over("prices")) return this.reply(this.over("prices"));
    const svcs = this.ctx.services;
    const priced = svcs.filter((s: any) => s.price != null);
    // الإضافات بأسعارها تحت الخدمات (بدون تكرار لو أكثر من خدمة فيها نفس الإضافة)
    const ad = new Map<string, any>();
    for (const s of svcs) for (const a of addonsOf(s)) if (!ad.has(a.name)) ad.set(a.name, a);
    const extra = ad.size ? this.T("addons_line", { list: [...ad.values()].map((a) => `${this.addonName(a)} ${money(a.price)}`).join(" · ") }) : "";
    const text = priced.length ? this.T("prices", { list: this.servicesLines(true) }) + extra
      : (this.mode() === "visit" || !svcs.length) ? this.T("prices_after") : this.T("services_list", { list: this.servicesLines(false) });
    this.reply(text);
  }

  servicesInfo() {
    const text = this.ctx.services.length ? this.T("services_list", { list: this.servicesLines(false) }) : this.T("prices_after");
    this.reply(text);
  }

  hoursInfo() {
    if (this.over("hours_text")) return this.reply(this.over("hours_text"));
    const lines: string[] = [];
    for (let d = 0; d < 7; d++) {
      const hs = this.ctx.hours.filter((h: any) => h.weekday === d && !h.city_id);
      lines.push(`${weekdayName(d, this.lang)}: ${hs.length ? hs.map((h: any) => `${hm(h.open_time, this.lang)} ${this.lang === "en" ? "to" : "إلى"} ${hm(h.close_time, this.lang)}`).join("، ") : this.T("closed")}`);
    }
    this.reply(this.T("hours", { list: lines.join("\n") }));
  }

  locationInfo() {
    if (this.over("location_text")) return this.reply(this.over("location_text"));
    const mode = this.mode();
    const names = this.ctx.cities.map((c: any) => this.cityName(c));
    let text: string;
    if (mode === "online") text = this.T("loc_online");
    else if (mode === "shop") text = this.T("loc_shop", { list: this.ctx.cities.map((c: any) => `• ${this.cityName(c)}${mapsOf(c) ? "\n" + mapsOf(c) : ""}`).join("\n") || this.b.address || this.b.city || "" });
    else text = this.T("loc_visit", { cities: names.length ? names.join("، ") : this.b.city || "" });
    this.reply(text);
  }

  paymentInfo() {
    if (this.over("pay_text")) return this.reply(this.over("pay_text"));
    const pre = this.s.pay_timing === "before" && this.prepayAmount(this.svc() || this.ctx.services[0]) > 0;
    const online = this.canPayOnline();
    const key = pre ? "pay_before" : (this.s.pay_timing === "none" || !online) ? "pay_none" : "pay_after";
    this.reply(this.T(key));
  }

  // ───────── البكجات والرصيد ─────────
  pkgName(p: any) { return (this.lang === "en" && p.name_en) ? p.name_en : p.name; }
  pkgWas(p: any) { const c = Number(p.compare_price || 0); return c > Number(p.price) ? this.T("instead_of", { price: money(c) }) : ""; }
  async getPkg(id: string) {
    if (!UUID.test(id || "")) return null;
    const { data } = await db().from("packages").select("*").eq("id", id).eq("business_id", this.b.id).eq("active", true).maybeSingle();
    return data;
  }
  async packagesList() {
    const { data } = await db().from("packages").select("*").eq("business_id", this.b.id).eq("active", true).order("sort").order("created_at").limit(10);
    if (!data?.length) return this.prices();
    this.set("pkgs", {});
    const u = this.pkgUnits();
    this.list(this.T("pkg_list"), this.T("btn_packages"), data.map((p: any) => ({
      id: `pk:${p.id}`, title: this.pkgName(p),
      desc: this.T("pkg_desc", { uses: countShort(u, p.uses, this.lang), price: money(p.price), was: this.pkgWas(p) }),
    })));
  }
  async packageInfo(id: string) {
    const p = await this.getPkg(id);
    if (!p) return this.packagesList();
    this.set("pkg", { pk: p.id });
    this.data.rows = [`pkb:${p.id}`, "m:packages"];
    const note = String((this.lang === "en" ? "" : p.note) || "").trim();
    this.say({ t: "buttons", text: this.T("pkg_info", { name: this.pkgName(p), note: note ? "\n" + note : "", uses: countShort(this.pkgUnits(), p.uses, this.lang), price: money(p.price), was: this.pkgWas(p) }),
      buttons: [{ id: `pkb:${p.id}`, title: this.T("btn_buy") }, { id: "m:packages", title: this.T("btn_packages") }] });
  }
  // شراء بكج: رصيد معلّق + فاتورة برابط دفع؛ يتفعّل بعد الدفع (markInvoicePaid). بدون دفع إلكتروني: يتحوّل للمنشأة ترسل الرابط
  async buyPackage(id: string) {
    const p = await this.getPkg(id);
    if (!p) return this.packagesList();
    this.set("idle", {});
    const u = this.pkgUnits();
    if (this.canPayOnline() && Number(p.price) >= 1) {
      const { data: cp, error } = await db().from("customer_packages").insert({
        business_id: this.b.id, customer_id: this.c.id, package_id: p.id, name: p.name, uses_total: p.uses, uses_left: p.uses, price: p.price,
        service_ids: p.service_ids || [], status: "pending", source: this.c.is_sim ? "sim" : "wa", is_test: !!this.c.is_sim,
      }).select("*").single();
      if (error) throw new Error("pkg: " + error.message);
      const inv = await createPkgInvoice(this.b, this.s, cp);
      if (inv) {
        this.say({ t: "cta", text: this.T("pkg_pay", { name: this.pkgName(p), price: money(p.price), uses: countShort(u, p.uses, this.lang) }), label: this.T("btn_pay"), url: inv.link });
        return;
      }
      await db().from("customer_packages").update({ status: "void" }).eq("id", cp.id);
    }
    // ما فيه دفع إلكتروني: المنشأة تكمل معه (يوصلها تنبيه والبوت يوقف معه لين ترد)
    const note = `${this.lang === "en" ? "Wants to buy" : "يبي يشتري"} ${p.name} (${money(p.price)})`;
    const now = new Date().toISOString();
    await db().from("customers").update({ bot_paused: true, paused_at: now, paused_reason: "package" }).eq("id", this.c.id);
    await db().from("handoffs").insert({ business_id: this.b.id, customer_id: this.c.id, reason: "package", last_text: note });
    this.say({ t: "text", text: this.T("pkg_manual", { biz: this.bizName() }) });
    await orderEvent(this.b.id, "handoff", { customer: this.c.name || this.c.wa_id, text: note, is_test: this.c.is_sim });
  }
  async balanceInfo() {
    const data = await this.balances();
    this.set("idle", {});
    if (!data?.length) {
      this.say({ t: "buttons", text: this.T("balance_none"), buttons: [{ id: "m:packages", title: this.T("btn_packages") }, { id: "m:book", title: this.T("btn_book") }] });
      return;
    }
    const u = this.pkgUnits();
    const list = data.map((x: any) => this.T("balance_row", { name: x.name, left: countShort(u, x.uses_left, this.lang) })).join("\n");
    this.say({ t: "buttons", text: this.T("balance", { list }), buttons: [{ id: "m:bookbal", title: this.T("btn_book_balance") }, { id: "m:packages", title: this.T("btn_packages") }] });
  }

  repeatPrompt() {
    switch (this.state) {
      case "svc": return this.askService();
      case "branch": return this.askBranch();
      case "day": return this.askDay();
      case "time": return this.data.day ? this.askTime(this.data.day, 0) : this.askDay();
      case "orders": case "order": case "cancel_confirm": return this.listOrders(this.data?.mode || "");
      case "qty": case "pkgq": case "addon": return this.nextStep();
      case "pkgs": return this.packagesList();
      case "pkg": return this.data.pk ? this.packageInfo(this.data.pk) : this.packagesList();
    }
    return this.welcome();
  }

  // ───────── التحويل للمنشأة ─────────
  async handoff(reason: string, text: string) {
    const now = new Date().toISOString();
    await db().from("customers").update({ bot_paused: true, paused_at: now, paused_reason: reason }).eq("id", this.c.id);
    const { data: open } = await db().from("handoffs").select("id").eq("customer_id", this.c.id).is("resolved_at", null).limit(1).maybeSingle();
    if (open) await db().from("handoffs").update({ last_text: text.slice(0, 500), reason }).eq("id", open.id);
    else await db().from("handoffs").insert({ business_id: this.b.id, customer_id: this.c.id, reason, last_text: text.slice(0, 500) });
    this.set("idle", {});
    this.say({ t: "text", text: this.T(reason === "complaint" ? "handoff_complaint" : "handoff", { biz: this.bizName() }) });
    await orderEvent(this.b.id, "handoff", { customer: this.c.name || this.c.wa_id, text: text.slice(0, 200), is_test: this.c.is_sim });
  }
}

// ───────── نقطة الدخول ─────────
export async function handleMessage(ctx: Ctx, m: Inbound): Promise<void> {
  const b = ctx.business, s = ctx.settings, c = ctx.customer;
  const first = !c.last_inbound_at;
  const patch: any = { last_inbound_at: new Date().toISOString() };
  if (first && m.type === "text" && m.text && hasLatin(m.text) && !hasArabic(m.text)) { patch.lang = "en"; c.lang = "en"; }
  await db().from("customers").update(patch).eq("id", c.id);
  c.last_inbound_at = patch.last_inbound_at;

  if (!b.bot_enabled || b.status === "paused" || b.status === "ended") return;

  if (c.bot_paused) {
    const hrs = Number(s.resume_hours || 0);
    const since = c.paused_at ? Date.now() - new Date(c.paused_at).getTime() : 0;
    if (hrs > 0 && since > hrs * 3600_000) {
      await db().from("customers").update({ bot_paused: false, paused_at: null, paused_reason: "", state: "idle", state_data: {} }).eq("id", c.id);
      await db().from("handoffs").update({ resolved_at: new Date().toISOString(), resolved_by: "auto" }).eq("customer_id", c.id).is("resolved_at", null);
      c.bot_paused = false; c.state = "idle"; c.state_data = {};
    } else {
      const t = m.text || m.title || m.kindLabel || (m.type === "location" ? "📍" : "");
      if (t) await db().from("handoffs").update({ last_text: t.slice(0, 500) }).eq("customer_id", c.id).is("resolved_at", null);
      return;
    }
  }

  const bot = new Bot(ctx, first);
  try { await bot.route(m); }
  catch (e) {
    console.error("bot", e);
    bot.outs = [];
    await bot.handoff("unknown", m.text || m.title || "");
  }
  await bot.flush();
}

// تخصيص تجربة المحاكي لكل جلسة (الاسم، المكان، الدفع، أسلوب الردود، الترحيب) بدون ما يتغير شي في المنشأة نفسها
export function applySimConfig(ctx: Ctx) {
  const cfg = ctx.customer?.is_sim ? ctx.customer.sim_config : null;
  if (!cfg || typeof cfg !== "object" || !Object.keys(cfg).length) return ctx;
  const b = { ...ctx.business }, s = { ...ctx.settings, texts: JSON.parse(JSON.stringify(ctx.settings.texts || {})) };
  if (cfg.name) { b.name = cfg.name; b.name_en = cfg.name; }
  if (["visit", "shop", "online"].includes(cfg.place)) s.place_mode = cfg.place;
  if (["after", "before", "none"].includes(cfg.pay)) s.pay_timing = cfg.pay;
  if (["friendly", "formal", "short"].includes(cfg.tone)) s.tone = cfg.tone;
  if (cfg.welcome) { s.texts.ar = { ...(s.texts.ar || {}), welcome: cfg.welcome }; s.texts.en = { ...(s.texts.en || {}), welcome: cfg.welcome }; }
  if (cfg.menu && typeof cfg.menu === "object") s.menu = cfg.menu;
  if (Array.isArray(cfg.faq)) s.faq = [...cfg.faq, ...(Array.isArray(s.faq) ? s.faq : [])];
  if (cfg.answers && typeof cfg.answers === "object") {
    // ردود المعلومات المخصصة للجلسة (الأسعار، الموقع، الدوام، الدفع) تحل محل الافتراضي
    const over: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg.answers)) if (typeof v === "string" && v.trim()) over[k] = v.trim();
    s.texts.ar = { ...(s.texts.ar || {}), ...over }; s.texts.en = { ...(s.texts.en || {}), ...over };
  }
  // لما المكان متخصص للجلسة، يمشي على كل الخدمات
  const services = cfg.place ? ctx.services.map((x: any) => ({ ...x, place_mode: null })) : ctx.services;
  return { ...ctx, business: b, settings: s, services };
}

// سياق المنشأة والعميل من استدعاء واحد
export async function loadCtx(businessId: string, waId: string, isSim: boolean, name: string): Promise<Ctx> {
  const { data, error } = await db().rpc("ihj_ctx", { p_business: businessId, p_wa_id: waId, p_is_sim: isSim, p_name: name || "" });
  if (error) throw new Error("ctx: " + error.message);
  const j = data as any;
  const ctx = { business: j.business, settings: j.settings, customer: j.customer, services: j.services || [], cities: j.cities || [], hours: j.hours || [], channel: j.channel || {} };
  return applySimConfig(ctx);
}
