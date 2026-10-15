// دفع اشتراكات المحلات بالبطاقة (ميسر حساب المناوب نفسه، مفاتيحه في ihj_secrets):
// رابط فاتورة ميسر لمنشأة (من لوحتي، أو زر في صفحة الدفعة الأولى برابط المنشأة)، صلاحيته 3 أيام.
// الاعتماد بعد ما نتأكد من ميسر نفسه أن الفاتورة مدفوعة وبنفس المبلغ، والتسجيل ذرّي في ihj_sub_settle (مرة وحدة).
// مفاتيح التجربة: الرابط يشتغل لفادية تجرّب، والدفعة تنعلّم «تجربة» وما تنسجل في الاشتراكات.
import { db, FN_BASE, SITE_URL } from "./util.ts";
import { methodLabel, moyasarCreateInvoice, moyasarGetInvoice } from "./pay.ts";

const DAY = 86400_000, LIFE = 3 * DAY;
export const KIND_AR: Record<string, string> = { setup: "التأسيس", monthly: "الاشتراك الشهري", app: "التطبيق", other: "دفعة" };
export const subGoLink = (token: string) => `${FN_BASE}/pay/sub/${token}`;

export async function platformKey(): Promise<{ sk: string; test: boolean }> {
  const { data } = await db().from("ihj_secrets").select("value").eq("key", "moyasar_sk").maybeSingle();
  const sk = String(data?.value || "");
  return { sk, test: sk.startsWith("sk_test_") };
}
// زر البطاقة يطلع للمحلات بس لما المفتاح حقيقي (أو للمنشآت التجريبية)
export async function cardReadyFor(isDemo: boolean): Promise<boolean> {
  const k = await platformKey();
  return !!k.sk && (!k.test || isDemo);
}

// المستحق على منشأة الحين: نص التأسيس (التأسيس + التطبيق)، أو أول شهر لو ما فيه تأسيس
export async function subDue(bizId: string): Promise<{ kind: string; due: number; already: boolean; setup_paid: number }> {
  const [{ data: sub }, { data: pays }] = await Promise.all([
    db().from("subscriptions").select("setup_fee, monthly_fee, app_setup_fee, app_monthly_fee").eq("business_id", bizId).maybeSingle(),
    db().from("sub_payments").select("kind, amount").eq("business_id", bizId),
  ]);
  const setup = Number(sub?.setup_fee || 0) + Number(sub?.app_setup_fee || 0), monthly = Number(sub?.monthly_fee || 0) + Number(sub?.app_monthly_fee || 0);
  const setupPaid = (pays || []).filter((p: any) => p.kind === "setup" || p.kind === "app").reduce((a: number, p: any) => a + Number(p.amount || 0), 0);
  if (setup > 0) {
    const half = Math.round(setup / 2), due = Math.max(0, half - setupPaid);
    return { kind: "setup", due, already: due < 1, setup_paid: setupPaid };
  }
  const monthPaid = (pays || []).some((p: any) => p.kind === "monthly");
  return { kind: "monthly", due: monthPaid ? 0 : monthly, already: monthPaid || monthly < 1, setup_paid: setupPaid };
}

export async function createSubInvoice(p: { business_id: string; kind: string; amount: number; name: string }) {
  const key = await platformKey();
  if (!key.sk) throw Object.assign(new Error("no_card"), { code: "no_card" });
  const amount = Math.round(Number(p.amount) * 100) / 100;
  if (!(amount >= 1)) throw Object.assign(new Error("amount"), { code: "amount" });
  const kind = KIND_AR[p.kind] ? p.kind : "other";
  // رابط مفتوح لنفس المنشأة والنوع والمبلغ ونفس الوضع (تجربة/حقيقي) ولسا صالح: نرجّعه
  const { data: old } = await db().from("sub_invoices").select("*").eq("business_id", p.business_id).eq("status", "issued").eq("kind", kind).eq("amount", amount).eq("test", key.test)
    .gte("created_at", new Date(Date.now() - LIFE + 6 * 3600_000).toISOString()).order("created_at", { ascending: false }).limit(1);
  if (old && old[0]?.pay_url) return old[0];
  const description = `المناوب · ${KIND_AR[kind]} · ${String(p.name || "").slice(0, 60)}`;
  const { data: row, error } = await db().from("sub_invoices").insert({ business_id: p.business_id, kind, amount, description, test: key.test }).select("*").single();
  if (error) throw new Error(error.message);
  try {
    const m = await moyasarCreateInvoice(key.sk, {
      amount, description,
      callback_url: `${FN_BASE}/pay/subhook/${row.token}`, success_url: `${FN_BASE}/pay/subreturn/${row.token}`, back_url: `${SITE_URL}thanks.html?back=1&t=${row.token}`,
      metadata: { sub_invoice_id: row.id, kind }, expired_at: new Date(Date.now() + LIFE).toISOString(),
    });
    const { data: done } = await db().from("sub_invoices").update({ moyasar_id: m.id, pay_url: m.url }).eq("id", row.id).select("*").single();
    return done;
  } catch (e) {
    await db().from("sub_invoices").update({ status: "void" }).eq("id", row.id);
    throw e;
  }
}

// يتأكد من ميسر نفسه (بمفتاح نفس الوضع)، ويعتمد مرة وحدة. يقبل رابط ملغي انْدفع (عشان ما تضيع فلوس)
export async function settleSubInvoice(row: any): Promise<boolean> {
  if (!row || !row.moyasar_id) return false;
  if (row.status === "paid") return true;
  const key = await platformKey();
  if (!key.sk || key.test !== !!row.test) return false;
  const m = await moyasarGetInvoice(key.sk, row.moyasar_id);
  const paid = String(m?.status || "") === "paid" && Number(m?.amount) === Math.round(Number(row.amount) * 100) && String(m?.currency || "SAR").toUpperCase() === "SAR";
  if (!paid) return false;
  const pay = (m.payments || []).find((x: any) => x.status === "paid") || {};
  const { data, error } = await db().rpc("ihj_sub_settle", { p_id: row.id, p_method: methodLabel(pay), p_ref: String(pay.id || m.id) });
  if (error) throw new Error(error.message);
  return !!(data as any)?.ok;
}

export async function subByToken(t: string) {
  if (!/^[0-9a-f]{32}$/.test(t)) return null;
  const { data } = await db().from("sub_invoices").select("*").eq("token", t).maybeSingle();
  return data;
}
export const subExpired = (row: any) => Date.now() - new Date(row.created_at).getTime() > LIFE;

// احتياط كل 5 دقايق: الروابط المفتوحة والملغية حديثًا (الأقدم فحصًا أول)، واللي انتهت مدته وما انْدفع ينلغي
export async function pollSubInvoices(limit = 20) {
  const since = new Date(Date.now() - LIFE - DAY).toISOString();
  const { data: rows } = await db().from("sub_invoices").select("*").in("status", ["issued", "void"]).neq("moyasar_id", "").gte("created_at", since)
    .order("checked_at", { ascending: true, nullsFirst: true }).limit(limit);
  let n = 0;
  for (const r of rows || []) {
    try {
      if (await settleSubInvoice(r)) n++;
      else if (r.status === "issued" && subExpired(r)) await db().from("sub_invoices").update({ status: "void" }).eq("id", r.id).eq("status", "issued");
    } catch (e) { console.error("subpoll", r.id, e); }
    await db().from("sub_invoices").update({ checked_at: new Date().toISOString() }).eq("id", r.id);
  }
  return n;
}
