// غلاف الفاتورة في دوال Supabase: يحمّل الخطوط والشعار ويبني الـPDF من pdf-core.js
import { PDFDocument, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import qrcode from "npm:qrcode-generator@1.4.4";
import { buildInvoicePdf, zatcaTlv } from "./pdf-core.js";
import { SUPABASE_URL } from "./util.ts";

const FONT_BASE = `${SUPABASE_URL}/storage/v1/object/public/public/fonts`;
let fonts: { regular: Uint8Array; bold: Uint8Array } | null = null;

async function getFonts() {
  if (fonts) return fonts;
  const [r, b] = await Promise.all([
    fetch(`${FONT_BASE}/IBMPlexSansArabic-Regular.ttf`).then((x) => { if (!x.ok) throw new Error("font"); return x.arrayBuffer(); }),
    fetch(`${FONT_BASE}/IBMPlexSansArabic-Bold.ttf`).then((x) => { if (!x.ok) throw new Error("font"); return x.arrayBuffer(); }),
  ]);
  fonts = { regular: new Uint8Array(r), bold: new Uint8Array(b) };
  return fonts;
}

async function getLogo(url: string): Promise<{ bytes: Uint8Array; type: "png" | "jpg" } | null> {
  if (!url) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const u = new Uint8Array(await r.arrayBuffer());
    if (u.length > 3_000_000) return null;
    if (u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4e && u[3] === 0x47) return { bytes: u, type: "png" };
    if (u[0] === 0xff && u[1] === 0xd8) return { bytes: u, type: "jpg" };
  } catch { /* */ }
  return null;
}

export type InvoicePdfInput = {
  biz: { name: string; color: string; cr: string; vat: string; address: string; phone: string; logo_url: string };
  invoice: { number: number; date: string; time: string; iso: string; items: { name: string; qty: number; price: number }[]; subtotal: number; vat_percent: number; vat: number; total: number; paid: boolean; paid_method: string };
  order: { number: number; day: string; time: string; city: string; service: string; staff: string };
  customer: { name: string; phone: string };
  pay_url: string | null;
};

export async function invoicePdf(d: InvoicePdfInput): Promise<Uint8Array> {
  const [f, logo] = await Promise.all([getFonts(), getLogo(d.biz.logo_url)]);
  const zatca = d.biz.vat ? zatcaTlv(d.biz.name, d.biz.vat, d.invoice.iso, Number(d.invoice.total).toFixed(2), Number(d.invoice.vat).toFixed(2)) : null;
  return await buildInvoicePdf({ PDFDocument, rgb, fontkit, qrcode }, {
    biz: { ...d.biz, logo: logo?.bytes || null, logoType: logo?.type || null },
    invoice: d.invoice, order: d.order, customer: d.customer, pay_url: d.pay_url, zatca, fonts: f,
  });
}
