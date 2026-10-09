-- احجزلي · المهام الدورية: رجوع البوت تلقائيًا، وجدولة دالة cron كل دقيقة (المفتاح السري في Vault باسم ihj_cron_key)
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.ihj_auto_resume()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with x as (
    update public.customers c
       set bot_paused = false, paused_at = null, paused_reason = '', state = 'idle', state_data = '{}'::jsonb, misses = 0
      from public.settings s
     where s.business_id = c.business_id and c.bot_paused and s.resume_hours > 0
       and c.paused_at < now() - make_interval(hours => s.resume_hours)
    returning c.id
  )
  update public.handoffs h set resolved_at = now(), resolved_by = 'auto'
   where h.customer_id in (select id from x) and h.resolved_at is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.ihj_auto_resume() from public, anon, authenticated;

-- الجدولة (تعتمد على السر ihj_cron_key في Vault، ينضاف من tools/setup-cron.mjs)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'ihj-cron') then perform cron.unschedule('ihj-cron'); end if;
  perform cron.schedule('ihj-cron', '* * * * *', $job$
    select net.http_post(
      url := 'https://kvreqxdgjeietzsfamei.supabase.co/functions/v1/cron',
      headers := jsonb_build_object('content-type', 'application/json',
        'x-cron-key', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'ihj_cron_key' limit 1), '')),
      body := '{}'::jsonb,
      timeout_milliseconds := 25000)
  $job$);
end $$;

commit;
