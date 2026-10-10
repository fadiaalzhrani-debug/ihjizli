// المهام الدورية (pg_cron يستدعيها كل دقيقة بمفتاح سري): التذكير قبل الموعد، طابور التصدير والتنبيهات،
// رجوع البوت تلقائيًا بعد مدة التحويل، ومتابعة فواتير ميسر المعلقة كل 5 دقايق
import { db, errMsg, json, sameSecret } from "../_shared/util.ts";
import { expireHolds, pollMoyasar, sendReminders } from "../_shared/actions.ts";
import { runJobs } from "../_shared/events.ts";
import { channelsHousekeeping } from "../_shared/channel.ts";

const KEY = Deno.env.get("IHJ_CRON_KEY") || "";

Deno.serve(async (req) => {
  if (!sameSecret(req.headers.get("x-cron-key") || "", KEY)) return json({ ok: false }, 401);
  const out: Record<string, unknown> = {};
  try { out.expired = await expireHolds(50); } catch (e) { out.expired_error = errMsg(e); }
  try { out.reminders = await sendReminders(60); } catch (e) { out.reminders_error = errMsg(e); }
  try { out.jobs = await runJobs(40); } catch (e) { out.jobs_error = errMsg(e); }
  try { const { data } = await db().rpc("ihj_auto_resume"); out.resumed = data ?? 0; } catch (e) { out.resume_error = errMsg(e); }
  // تجارب المحاكي في المنشآت التجريبية تنمسح بعد يومين (مرة كل ساعة)
  if (new Date().getUTCMinutes() === 7) {
    try { const { data } = await db().rpc("ihj_cleanup_demo", { p_hours: 48 }); out.demo_cleaned = data ?? 0; } catch (e) { out.cleanup_error = errMsg(e); }
  }
  // حالة القوالب تتحدث لحالها لين تنعتمد، والربط ينفحص كل 6 ساعات (عشان المفتاح المنتهي يبان في لوحتها)
  if (new Date().getUTCMinutes() % 15 === 3 || new Date().getUTCMinutes() === 41) {
    try { out.channels = await channelsHousekeeping(); } catch (e) { out.channels_error = errMsg(e); }
  }
  if (new Date().getUTCMinutes() % 5 === 0 || new URL(req.url).searchParams.has("poll")) {
    try { out.moyasar = await pollMoyasar(20); } catch (e) { out.moyasar_error = errMsg(e); }
  }
  return json({ ok: true, ...out });
});
