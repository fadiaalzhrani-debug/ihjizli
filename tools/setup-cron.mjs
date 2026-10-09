// يولّد مفتاح cron سري ويحطه في أسرار الدوال (IHJ_CRON_KEY) وفي Vault (ihj_cron_key) عشان pg_cron يستدعي الدالة
// usage: node tools/setup-cron.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { sql } from './sql.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const f = path.join(ROOT, '.secrets', 'cron-key.txt');
let key = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : '';
if (!key) { key = crypto.randomBytes(24).toString('hex'); fs.writeFileSync(f, key); }
const env = path.join(ROOT, '.secrets', 'fn.env');
const lines = fs.existsSync(env) ? fs.readFileSync(env, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('IHJ_CRON_KEY=')) : [];
lines.push(`IHJ_CRON_KEY=${key}`);
fs.writeFileSync(env, lines.join('\n') + '\n');
execSync(`supabase secrets set --env-file "${env}"`, { cwd: ROOT, stdio: 'inherit' });
sql(`do $$ begin
  if exists (select 1 from vault.secrets where name = 'ihj_cron_key') then
    perform vault.update_secret((select id from vault.secrets where name = 'ihj_cron_key'), '${key}');
  else perform vault.create_secret('${key}', 'ihj_cron_key'); end if; end $$;`);
console.log('cron key set (functions + vault)');
