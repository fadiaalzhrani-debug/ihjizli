// ينشئ رابط لوحة المدير الخاص (بدون كلمة مرور) ويحفظه في .secrets/admin-link.txt
// usage: node tools/admin-link.mjs [label]
import fs from 'node:fs';
import crypto from 'node:crypto';

const P = JSON.parse(fs.readFileSync(new URL('../.secrets/project.json', import.meta.url)));
const SITE = 'https://fadiaalzhrani-debug.github.io/ihjizli/';
const H = { apikey: P.service, authorization: `Bearer ${P.service}`, 'content-type': 'application/json' };
const label = process.argv[2] || 'فادية';

const email = `admin-${crypto.randomBytes(8).toString('hex')}@users.ihjizli.app`;
let r = await fetch(`${P.url}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, email_confirm: true, app_metadata: { ihj_kind: 'admin' } }) });
const u = await r.json();
if (!r.ok) throw new Error('user: ' + JSON.stringify(u));
r = await fetch(`${P.url}/rest/v1/platform_admins`, { method: 'POST', headers: H, body: JSON.stringify({ user_id: u.id, label }) });
if (!r.ok) throw new Error('admin: ' + await r.text());
const token = crypto.randomBytes(24).toString('base64url');
r = await fetch(`${P.url}/rest/v1/access_links`, { method: 'POST', headers: H, body: JSON.stringify({ token, kind: 'admin', user_id: u.id, label }) });
if (!r.ok) throw new Error('link: ' + await r.text());
const url = `${SITE}admin.html#k=${token}`;
fs.writeFileSync(new URL('../.secrets/admin-link.txt', import.meta.url), url + '\n');
console.log('admin link saved to .secrets/admin-link.txt');
