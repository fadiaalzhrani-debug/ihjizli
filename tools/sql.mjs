// تشغيل SQL على قاعدة احجزلي (المشروع المربوط kvreqxdgjeietzsfamei) وطباعة الصفوف
// usage: node tools/sql.mjs "select ..."      أو      node tools/sql.mjs -f supabase/migrations/xxx.sql
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function sql(text) {
  const tmp = path.join(os.tmpdir(), `ihj_q_${process.pid}_${Date.now()}.sql`);
  fs.writeFileSync(tmp, text);
  let out = '';
  try {
    out = execSync(`supabase db query --linked -f "${tmp}"`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    const msg = String((e.stdout || '') + (e.stderr || '')).trim();
    throw new Error(msg.slice(0, 4000));
  } finally { fs.unlinkSync(tmp); }
  const i = out.indexOf('{');
  if (i < 0) return [];
  const j = JSON.parse(out.slice(i));
  return j.rows || [];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const text = a[0] === '-f' ? fs.readFileSync(a[1], 'utf8') : a.join(' ');
  try {
    const rows = sql(text);
    for (const r of rows) { const k = Object.keys(r); console.log(k.length === 1 ? String(r[k[0]]) : JSON.stringify(r)); }
    if (!rows.length) console.log('(ok, 0 rows)');
  } catch (e) { console.error(e.message); process.exit(1); }
}
