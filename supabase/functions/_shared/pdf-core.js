// فاتورة PDF عربية (A4) بشعار المنشأة: نص من اليمين لليسار مع تشكيل الحروف عبر fontkit، وQR للدفع، وQR الفاتورة الضريبية لو المنشأة مسجلة بالضريبة
// ملف JS عادي يشتغل في دوال Supabase (Deno) وفي Node للفحص؛ المكتبات تنمرّر له في deps
// deps = { PDFDocument, rgb, fontkit, qrcode }

const AR = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

function hex(c, rgb) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(c || "")) || [0, "0B7A55"];
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// كلمات النص: العربية كلمة كلمة (fontkit يشكّلها ويعكسها)، وغير العربية تتجمع كتلة وحدة من اليسار لليمين
function runs(text) {
  const out = [];
  for (const w of String(text ?? "").split(/\s+/).filter(Boolean)) {
    const r = AR.test(w);
    const last = out[out.length - 1];
    if (last && !last.rtl && !r) last.text += " " + w;
    else out.push({ rtl: r, text: w });
  }
  return out;
}

export function textWidth(text, font, size) {
  const rs = runs(text), sp = font.widthOfTextAtSize(" ", size);
  return rs.reduce((a, r) => a + font.widthOfTextAtSize(r.text, size), 0) + sp * Math.max(0, rs.length - 1);
}

// يرسم سطرًا بترتيب عربي: x هو الطرف الأيمن (align=right) أو الأيسر (left) أو الوسط (center)
export function drawRtl(page, text, o) {
  const { size, font, color } = o;
  const total = textWidth(text, font, size);
  let right = o.align === "left" ? o.x + total : o.align === "center" ? o.x + total / 2 : o.x;
  const sp = font.widthOfTextAtSize(" ", size);
  for (const r of runs(text)) {
    const w = font.widthOfTextAtSize(r.text, size);
    page.drawText(r.text, { x: right - w, y: o.y, size, font, color });
    right -= w + sp;
  }
  return total;
}

// يقص النص لعرض محدد
function fit(text, font, size, maxW) {
  let t = String(text ?? "");
  if (textWidth(t, font, size) <= maxW) return t;
  while (t.length > 1 && textWidth(t + "…", font, size) > maxW) t = t.slice(0, -1);
  return t + "…";
}

function drawQr(page, deps, data, x, y, size, color) {
  const qr = deps.qrcode(0, "M");
  qr.addData(data);
  qr.make();
  const n = qr.getModuleCount(), cell = size / n;
  page.drawRectangle({ x: x - 4, y: y - 4, width: size + 8, height: size + 8, color: deps.rgb(1, 1, 1) });
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (qr.isDark(r, c)) page.drawRectangle({ x: x + c * cell, y: y + (n - 1 - r) * cell, width: cell + 0.05, height: cell + 0.05, color });
  }
}

// رمز الفاتورة الضريبية المبسطة (المرحلة الأولى): TLV بالاسم والرقم الضريبي والوقت والإجمالي والضريبة
export function zatcaTlv(seller, vatNo, iso, total, vat) {
  const enc = new TextEncoder();
  const parts = [[1, seller], [2, vatNo], [3, iso], [4, total], [5, vat]];
  const bytes = [];
  for (const [t, v] of parts) { const b = enc.encode(String(v)); bytes.push(t, b.length, ...b); }
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s);
}

const n2 = (v) => Number(v || 0).toFixed(2);

export async function buildInvoicePdf(deps, d) {
  const { PDFDocument, rgb } = deps;
  const doc = await PDFDocument.create();
  doc.registerFontkit(deps.fontkit);
  const reg = await doc.embedFont(d.fonts.regular, { subset: true });
  const bold = await doc.embedFont(d.fonts.bold, { subset: true });
  doc.setTitle(`${d.biz.name} ${d.invoice.number}`);
  doc.setAuthor(d.biz.name);
  doc.setCreator("احجزلي");
  const W = 595.28, H = 841.89, M = 40, R = W - M;
  const page = doc.addPage([W, H]);
  const ink = rgb(0.09, 0.11, 0.1), muted = rgb(0.38, 0.42, 0.4), line = rgb(0.88, 0.9, 0.88), soft = rgb(0.96, 0.97, 0.96);
  const brand = hex(d.biz.color, rgb);
  const paidGreen = rgb(0.04, 0.48, 0.33);

  // شريط علوي بلون المنشأة
  page.drawRectangle({ x: 0, y: H - 10, width: W, height: 10, color: brand });

  // الشعار والاسم (يمين)
  let top = H - 46;
  let nameRight = R;
  if (d.biz.logo && d.biz.logoType) {
    try {
      const img = d.biz.logoType === "png" ? await doc.embedPng(d.biz.logo) : await doc.embedJpg(d.biz.logo);
      const box = 66, s = Math.min(box / img.width, box / img.height);
      const w = img.width * s, h = img.height * s;
      page.drawImage(img, { x: R - box + (box - w) / 2, y: top - box + (box - h) / 2 + 8, width: w, height: h });
      nameRight = R - box - 14;
    } catch (_) { /* شعار غير صالح: نكمل بدون */ }
  }
  drawRtl(page, fit(d.biz.name, bold, 19, 250), { x: nameRight, y: top - 6, size: 19, font: bold, color: ink });
  let ly = top - 26;
  const bizLines = [];
  if (d.biz.cr) bizLines.push(`السجل التجاري ${d.biz.cr}`);
  if (d.biz.vat) bizLines.push(`الرقم الضريبي ${d.biz.vat}`);
  if (d.biz.address) bizLines.push(d.biz.address);
  if (d.biz.phone) bizLines.push(`جوال ${d.biz.phone}`);
  for (const t of bizLines.slice(0, 4)) { drawRtl(page, fit(t, reg, 9.5, 250), { x: nameRight, y: ly, size: 9.5, font: reg, color: muted }); ly -= 14; }

  // عنوان الفاتورة وبياناتها (يسار)
  const title = d.biz.vat ? "فاتورة ضريبية مبسطة" : "فاتورة";
  drawRtl(page, title, { x: M, y: top - 6, size: 20, font: bold, color: brand, align: "left" });
  const meta = [["رقم الفاتورة", String(d.invoice.number)], ["التاريخ", d.invoice.date], ["الوقت", d.invoice.time], ["رقم الطلب", String(d.order.number)]];
  let my = top - 30;
  for (const [k, v] of meta) {
    drawRtl(page, k, { x: M + 200, y: my, size: 10, font: reg, color: muted });
    drawRtl(page, v, { x: M, y: my, size: 10.5, font: bold, color: ink, align: "left" });
    my -= 16;
  }

  let y = Math.min(ly, my) - 14;
  page.drawLine({ start: { x: M, y }, end: { x: R, y }, thickness: 1, color: line });

  // العميل والطلب
  y -= 24;
  const colW = (R - M - 16) / 2;
  const boxTop = y + 12, boxH = 96;
  page.drawRectangle({ x: R - colW, y: boxTop - boxH, width: colW, height: boxH, color: soft, borderColor: line, borderWidth: 1 });
  page.drawRectangle({ x: M, y: boxTop - boxH, width: colW, height: boxH, color: soft, borderColor: line, borderWidth: 1 });
  drawRtl(page, "العميل", { x: R - 12, y: y - 4, size: 10, font: bold, color: brand });
  drawRtl(page, "الطلب", { x: M + colW - 12, y: y - 4, size: 10, font: bold, color: brand });
  const cust = [d.customer.name, d.customer.phone ? `الجوال: ${d.customer.phone}` : ""].filter(Boolean);
  let cy = y - 22;
  for (const t of cust) { drawRtl(page, fit(t, reg, 10.5, colW - 24), { x: R - 12, y: cy, size: 10.5, font: reg, color: ink }); cy -= 16; }
  const ord = [d.order.service ? `الخدمة: ${d.order.service}` : "", `الموعد: ${d.order.day} ${d.order.time}`, d.order.city ? `المدينة: ${d.order.city}` : "", d.order.staff ? `الموظف: ${d.order.staff}` : ""].filter(Boolean);
  let oy = y - 22;
  for (const t of ord.slice(0, 4)) { drawRtl(page, fit(t, reg, 10, colW - 24), { x: M + colW - 12, y: oy, size: 10, font: reg, color: ink }); oy -= 15; }

  // جدول البنود
  y = boxTop - boxH - 26;
  const cols = [
    { k: "name", label: "البند", r: R, l: 300 },
    { k: "qty", label: "الكمية", r: 300, l: 236 },
    { k: "price", label: "السعر", r: 236, l: 148 },
    { k: "total", label: "المجموع", r: 148, l: M },
  ];
  const rowH = 24;
  page.drawRectangle({ x: M, y: y - 8, width: R - M, height: rowH, color: brand });
  for (const c of cols) drawRtl(page, c.label, { x: (c.r + c.l) / 2, y: y, size: 10.5, font: bold, color: rgb(1, 1, 1), align: "center" });
  y -= rowH;
  const items = (d.invoice.items || []).slice(0, 18);
  items.forEach((it, i) => {
    if (i % 2 === 1) page.drawRectangle({ x: M, y: y - 8, width: R - M, height: rowH, color: soft });
    drawRtl(page, fit(it.name, reg, 10.5, cols[0].r - cols[0].l - 16), { x: cols[0].r - 8, y, size: 10.5, font: reg, color: ink });
    drawRtl(page, String(it.qty), { x: (cols[1].r + cols[1].l) / 2, y, size: 10.5, font: reg, color: ink, align: "center" });
    drawRtl(page, n2(it.price), { x: (cols[2].r + cols[2].l) / 2, y, size: 10.5, font: reg, color: ink, align: "center" });
    drawRtl(page, n2(Number(it.qty) * Number(it.price)), { x: (cols[3].r + cols[3].l) / 2, y, size: 10.5, font: reg, color: ink, align: "center" });
    y -= rowH;
  });
  page.drawLine({ start: { x: M, y: y + 14 }, end: { x: R, y: y + 14 }, thickness: 1, color: line });

  // الإجماليات (يسار)
  y -= 8;
  const tl = [["المجموع قبل الضريبة", `${n2(d.invoice.subtotal)} ر.س`]];
  if (Number(d.invoice.vat_percent) > 0) tl.push([`ضريبة القيمة المضافة ${Number(d.invoice.vat_percent)}%`, `${n2(d.invoice.vat)} ر.س`]);
  for (const [k, v] of tl) {
    drawRtl(page, k, { x: 300, y, size: 10.5, font: reg, color: muted });
    drawRtl(page, v, { x: M + 8, y, size: 10.5, font: reg, color: ink, align: "left" });
    y -= 18;
  }
  y -= 14;
  page.drawRectangle({ x: M, y: y - 10, width: 300 - M + 8, height: 30, color: brand });
  drawRtl(page, "الإجمالي", { x: 300, y, size: 13, font: bold, color: rgb(1, 1, 1) });
  drawRtl(page, `${n2(d.invoice.total)} ر.س`, { x: M + 8, y, size: 13, font: bold, color: rgb(1, 1, 1), align: "left" });

  // حالة الدفع
  const stampY = y - 4;
  if (d.invoice.paid) {
    page.drawRectangle({ x: R - 150, y: stampY - 14, width: 150, height: 40, borderColor: paidGreen, borderWidth: 2, color: rgb(0.92, 0.97, 0.94) });
    drawRtl(page, "مدفوعة", { x: R - 75, y: stampY + 6, size: 15, font: bold, color: paidGreen, align: "center" });
    if (d.invoice.paid_method) drawRtl(page, d.invoice.paid_method, { x: R - 75, y: stampY - 8, size: 9, font: reg, color: paidGreen, align: "center" });
  }

  // رموز QR: الدفع (يسار) والضريبي (يمين)
  let qy = y - 130;
  if (!d.invoice.paid && d.pay_url) {
    drawQr(page, deps, d.pay_url, M + 4, qy, 92, ink);
    drawRtl(page, "امسح للدفع", { x: M + 50, y: qy - 18, size: 10, font: bold, color: brand, align: "center" });
  }
  if (d.zatca) {
    drawQr(page, deps, d.zatca, R - 96, qy, 92, ink);
  }

  // تذييل
  drawRtl(page, d.footer || "شكرًا لتعاملكم معنا", { x: W / 2, y: 46, size: 11, font: reg, color: muted, align: "center" });
  page.drawRectangle({ x: 0, y: 0, width: W, height: 6, color: brand });

  return await doc.save();
}
