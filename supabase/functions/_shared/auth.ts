// الجلسات والروابط الخاصة: كل رابط (مدير/مالك/موظف) له مستخدم Supabase خاص، والرابط يتحول لجلسة بدون كلمة مرور
import { ANON_KEY, db, token } from "./util.ts";

export type Roles = { uid: string; admin: boolean; members: { business_id: string; role: string; staff_id: string | null }[] };

export async function rolesFromReq(req: Request): Promise<Roles | null> {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt || jwt === ANON_KEY || jwt.split(".").length !== 3) return null;
  const { data, error } = await db().auth.getUser(jwt);
  if (error || !data?.user) return null;
  const uid = data.user.id;
  const [{ data: a }, { data: m }] = await Promise.all([
    db().from("platform_admins").select("user_id").eq("user_id", uid).maybeSingle(),
    db().from("members").select("business_id, role, staff_id").eq("user_id", uid),
  ]);
  return { uid, admin: !!a, members: m || [] };
}

export const isOwner = (r: Roles, biz: string) => r.admin || r.members.some((m) => m.business_id === biz && m.role === "owner");
export const staffIdOf = (r: Roles, biz: string) => r.members.find((m) => m.business_id === biz && m.role === "staff")?.staff_id || null;
export const isMember = (r: Roles, biz: string) => r.admin || r.members.some((m) => m.business_id === biz);

export const LINK_PAGES: Record<string, string> = { admin: "admin.html", owner: "biz.html", staff: "staff.html" };

export async function createLink(kind: "admin" | "owner" | "staff", businessId: string | null, staffId: string | null, label: string) {
  const tok = token(24);
  const email = `${kind}-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}@users.ihjizli.app`;
  const { data: u, error } = await db().auth.admin.createUser({ email, email_confirm: true, app_metadata: { ihj_kind: kind, business_id: businessId, staff_id: staffId } });
  if (error || !u?.user) throw new Error("create_user: " + (error?.message || "unknown"));
  const uid = u.user.id;
  if (kind === "admin") {
    const { error: e1 } = await db().from("platform_admins").insert({ user_id: uid, label });
    if (e1) throw new Error(e1.message);
  } else {
    const { error: e2 } = await db().from("members").insert({ user_id: uid, business_id: businessId, role: kind === "owner" ? "owner" : "staff", staff_id: staffId });
    if (e2) throw new Error(e2.message);
  }
  const { data: l, error: e3 } = await db().from("access_links").insert({ token: tok, kind, business_id: businessId, staff_id: staffId, user_id: uid, label }).select("id").single();
  if (e3) throw new Error(e3.message);
  return { id: l.id as string, token: tok, kind, page: LINK_PAGES[kind] };
}

// إلغاء رابط: تنشال صلاحياته فورًا (RLS تقرأ العضوية مع كل طلب) ويتقفل مستخدمه
export async function revokeLink(linkId: string) {
  const { data: l } = await db().from("access_links").select("*").eq("id", linkId).maybeSingle();
  if (!l) return false;
  await db().from("access_links").update({ revoked_at: new Date().toISOString() }).eq("id", linkId);
  await db().from("members").delete().eq("user_id", l.user_id);
  await db().from("platform_admins").delete().eq("user_id", l.user_id);
  await db().auth.admin.updateUserById(l.user_id, { ban_duration: "876000h" }).catch(() => {});
  return true;
}

// تحويل الرابط لجلسة: نطلع رمز دخول لمرة وحدة والصفحة تتحقق منه بـverifyOtp
export async function exchangeLink(tok: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(tok)) return null;
  const { data: l } = await db().from("access_links").select("*").eq("token", tok).is("revoked_at", null).maybeSingle();
  if (!l) return null;
  const { data: u } = await db().auth.admin.getUserById(l.user_id);
  if (!u?.user?.email) return null;
  const { data: g, error } = await db().auth.admin.generateLink({ type: "magiclink", email: u.user.email });
  if (error || !g?.properties?.hashed_token) throw new Error("link: " + (error?.message || "no_token"));
  await db().from("access_links").update({ last_used_at: new Date().toISOString() }).eq("id", l.id);
  return { kind: l.kind, business_id: l.business_id, staff_id: l.staff_id, email: u.user.email, token_hash: g.properties.hashed_token };
}
