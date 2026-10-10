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
import { createPrepay } from "./prepay.ts";

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

const STATES_WITH_LIST = new Set(["svc", "branch", "day", "time", "orders", "order", "cancel_confirm"]);

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
  menuButtons() { return [{ id: "m:book", title: this.T("btn_book") }, { id: "m:orders", title: this.T("btn_orders") }]; }
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
    if (m.type === "location" && Number.isFinite(m.lat) && Number.isFinite(m.lng)) {
      return this.onLocation({ lat: m.lat!, lng: m.lng! }, "", [m.name, m.address].filter(Boolean).join("، "));
    }
    const text = (m.text || "").trim();
    if (m.type === "text" && text) {
      if (this.state === "loc") {
        const p = await locationFromText(text);
        if (p) return this.onLocation(p, p.url, "");
      }
      // رقم من القائمة الأخيرة (لو كتب 2 بدل ما يضغط)
      const num = text.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).trim();
      if (/^\d{1,2}$/.test(num) && STATES_WITH_LIST.has(this.state) && Array.isArray(this.data.rows)) {
        const id = this.data.rows[+num - 1];
        if (id) return this.onId(id);
      }
      const it = intentOf(text);
      if (it === "lang_en") return this.setLang("en");
      if (it === "lang_ar") return this.setLang("ar");
      if (it === "complaint") return this.handoff("complaint", text);
      if (it === "human") return this.handoff("human", text);
      // أسئلة المنشأة الخاصة قبل الأسئلة العامة
      const fa = faqMatch(this.s.faq, text);
      if (fa) { this.say({ t: "buttons", text: fa.a, buttons: this.menuButtons() }); return; }
      switch (it) {
        case "orders": return this.listOrders("");
        case "resched": return this.listOrders("resched");
        case "cancel": return this.listOrders("cancel");
        case "location": return this.locationInfo();
        case "payment": return this.paymentInfo();
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
        if (v === "orders") return this.listOrders("");
        if (v === "lang:en") return this.setLang("en");
        if (v === "lang:ar") return this.setLang("ar");
        if (v === "contact") return this.handoff("human", this.lang === "en" ? "Contact us" : "تواصل معنا");
        return this.welcome();
      case "svc": return this.onService(v);
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
  welcome() {
    this.set("idle", {});
    this.say({ t: "buttons", text: this.T("welcome", { biz: this.bizName() }), buttons: [
      ...this.menuButtons(),
      { id: this.lang === "en" ? "m:lang:ar" : "m:lang:en", title: this.T("btn_lang") },
    ] });
  }

  async setLang(l: Lang) {
    this.lang = l; this.T = textsFor(l, this.s.texts, this.s.tone); this.c.lang = l;
    await db().from("customers").update({ lang: l }).eq("id", this.c.id);
    return this.welcome();
  }

  // ───────── الحجز ─────────
  startBooking() {
    this.set("idle", {});
    const svcs = this.ctx.services;
    if (svcs.length > 1) return this.askService();
    this.data.svc = svcs[0]?.id || null;
    return this.afterService();
  }

  askService() {
    this.set("svc");
    const rows = this.ctx.services.slice(0, 10).map((s: any) => ({
      id: `svc:${s.id}`, title: this.svcName(s),
      desc: s.price != null ? this.T("price_fixed", { price: money(s.price) }) : (modeOf(this.s, s) === "visit" ? this.T("price_after") : ""),
    }));
    this.list(this.T("ask_service"), this.T("btn_services"), rows);
  }

  onService(id: string) {
    const s = this.ctx.services.find((x: any) => x.id === id);
    if (!s) return this.askService();
    this.data.svc = s.id;
    return this.afterService();
  }

  // بعد الخدمة: حسب مكانها
  afterService() {
    const mode = this.mode();
    if (mode === "visit") {
      if (Number.isFinite(this.data.lat)) { this.data.placed = true; return this.askDay(); }
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
    return this.askDay();
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
    return this.askDay();
  }

  askLocation() {
    this.set("loc");
    this.misses = 0;
    this.say({ t: "location_request", text: this.T("ask_location") });
  }

  async onLocation(p: Pt, url: string, address: string) {
    // موقع وصل وهو مو في خطوة الموقع: نعتبره بداية حجز
    if (this.state !== "loc") { this.data = { svc: this.data?.svc || null }; }
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
    if (!this.data.svc) {
      if (this.ctx.services.length > 1) return this.askService();
      this.data.svc = this.ctx.services[0]?.id || null;
    }
    this.data.placed = true;
    return this.askDay();
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

  // كم يدفع العميل قبل التأكيد (صفر = ما فيه دفع مقدم)
  prepayAmount(svc: any): number {
    if (this.s.pay_timing !== "before") return 0;
    if (!(this.b.plan === "bot_pay" || this.b.is_demo)) return 0;
    if (!["demo", "moyasar"].includes(this.s.pay_provider)) return 0;
    const amt = svc?.price != null && Number(svc.price) > 0 ? Number(svc.price) : Number(this.s.prepay_amount || 0);
    return amt >= 1 ? amt : 0;
  }

  async onSlot(iso: string) {
    const t = new Date(iso);
    if (isNaN(t.getTime())) return this.welcome();
    if (this.data.rs) return this.doResched(t.toISOString());
    if (!this.data.placed) return this.startBooking();
    const svc = this.svc();
    const amount = this.prepayAmount(svc);
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
    const order = o as any;
    const city = this.ctx.cities.find((c: any) => c.id === order.city_id);
    const mode = this.mode();
    const day = dayLabel(local(order.slot_start, this.tz).ymd, this.lang, this.tz, false), time = timeLabel(order.slot_start, this.lang, this.tz);
    const city_line = placeLine(this.T, this.s, mode, city, this.lang);
    this.set("idle", {});
    if (order.status === "pending_payment") {
      const pre = await createPrepay(this.b, this.s, order, amount, svc ? `${this.svcName(svc)} · ${this.T("prepay_label")}` : this.T("prepay_label"));
      if (pre) {
        this.say({ t: "cta", text: this.T("pay_to_confirm", { amount: money(amount), day, time, city_line, hold }), label: this.T("btn_pay_confirm"), url: pre.link });
        return;
      }
      // ما فيه بوابة دفع شغالة: نأكد الحجز عادي
      await db().from("orders").update({ status: "confirmed", hold_until: null }).eq("id", order.id);
      order.status = "confirmed";
    }
    const price = order.price != null ? this.T("price_fixed", { price: money(order.price) }) : this.T("price_after");
    const price_line = order.price != null || mode === "visit" ? this.T("price_line", { price }) : "";
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
    return this.ctx.services.map((s: any) => `• ${this.svcName(s)}${withPrice ? `: ${s.price != null ? this.T("price_fixed", { price: money(s.price) }) : this.T("price_after")}` : (s.price != null ? ` · ${this.T("price_fixed", { price: money(s.price) })}` : "")}`).join("\n");
  }

  prices() {
    const svcs = this.ctx.services;
    const priced = svcs.filter((s: any) => s.price != null);
    const text = priced.length ? this.T("prices", { list: this.servicesLines(true) })
      : (this.mode() === "visit" || !svcs.length) ? this.T("prices_after") : this.T("services_list", { list: this.servicesLines(false) });
    this.say({ t: "buttons", text, buttons: this.menuButtons() });
  }

  servicesInfo() {
    const text = this.ctx.services.length ? this.T("services_list", { list: this.servicesLines(false) }) : this.T("prices_after");
    this.say({ t: "buttons", text, buttons: this.menuButtons() });
  }

  hoursInfo() {
    const lines: string[] = [];
    for (let d = 0; d < 7; d++) {
      const hs = this.ctx.hours.filter((h: any) => h.weekday === d && !h.city_id);
      lines.push(`${weekdayName(d, this.lang)}: ${hs.length ? hs.map((h: any) => `${hm(h.open_time, this.lang)} ${this.lang === "en" ? "to" : "إلى"} ${hm(h.close_time, this.lang)}`).join("، ") : this.T("closed")}`);
    }
    this.say({ t: "buttons", text: this.T("hours", { list: lines.join("\n") }), buttons: this.menuButtons() });
  }

  locationInfo() {
    const mode = this.mode();
    const names = this.ctx.cities.map((c: any) => this.cityName(c));
    let text: string;
    if (mode === "online") text = this.T("loc_online");
    else if (mode === "shop") text = this.T("loc_shop", { list: this.ctx.cities.map((c: any) => `• ${this.cityName(c)}${mapsOf(c) ? "\n" + mapsOf(c) : ""}`).join("\n") || this.b.address || this.b.city || "" });
    else text = this.T("loc_visit", { cities: names.length ? names.join("، ") : this.b.city || "" });
    this.say({ t: "buttons", text, buttons: this.menuButtons() });
  }

  paymentInfo() {
    const pre = this.s.pay_timing === "before" && this.prepayAmount(this.svc() || this.ctx.services[0]) > 0;
    const online = ["demo", "moyasar"].includes(this.s.pay_provider) && (this.b.plan === "bot_pay" || this.b.is_demo);
    const key = pre ? "pay_before" : (this.s.pay_timing === "none" || !online) ? "pay_none" : "pay_after";
    this.say({ t: "buttons", text: this.T(key), buttons: this.menuButtons() });
  }

  repeatPrompt() {
    switch (this.state) {
      case "svc": return this.askService();
      case "branch": return this.askBranch();
      case "day": return this.askDay();
      case "time": return this.data.day ? this.askTime(this.data.day, 0) : this.askDay();
      case "orders": case "order": case "cancel_confirm": return this.listOrders(this.data?.mode || "");
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
