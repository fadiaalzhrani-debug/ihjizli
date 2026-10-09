// المهام الدورية (pg_cron يستدعيها كل دقيقة بمفتاح سري): التذكير قبل الموعد، طابور التصدير والتنبيهات،
// رجوع البوت تلقائيًا بعد مدة التحويل، ومتابعة فواتير ميسر المعلقة كل 5 دقايق
import { db, errMsg, json, sameSecret } from "../_shared/util.ts";
import { pollMoyasar, sendReminders } from "../_shared/actions.ts";
import { runJobs } from "../_shared/events.ts";

const KEY = Deno.env.get("IHJ_CRON_KEY") || "";

Deno.serve(async (req) => {
  if (!sameSecret(req.headers.get("x-cron-key") || "", KEY)) return json({ ok: false }, 401);
  const out: Record<string, unknown> = {};
  try { out.reminders = await sendReminders(60); } catch (e) { out.reminders_error = errMsg(e); }
  try { out.jobs = await runJobs(40); } catch (e) { out.jobs_error = errMsg(e); }
  try { const { data } = await db().rpc("ihj_auto_resume"); out.resumed = data ?? 0; } catch (e) { out.resume_error = errMsg(e); }
  if (new Date().getUTCMinutes() % 5 === 0 || new URL(req.url).searchParams.has("poll")) {
    try { out.moyasar = await pollMoyasar(20); } catch (e) { out.moyasar_error = errMsg(e); }
  }
  return json({ ok: true, ...out });
});
