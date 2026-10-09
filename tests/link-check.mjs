// يتأكد إن الرابط الخاص يعطي جلسة حقيقية وإن الحماية تفصل البيانات
import fs from 'node:fs';
const P = JSON.parse(fs.readFileSync(new URL('../.secrets/project.json', import.meta.url)));
const FN = `${P.url}/functions/v1`;
export async function sessionFor(token) {
  const x = await (await fetch(`${FN}/api/link`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })).json();
  if (!x.ok) throw new Error('link ' + JSON.stringify(x));
  const r = await fetch(`${P.url}/auth/v1/verify`, { method: 'POST', headers: { apikey: P.anon, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: x.token_hash }) });
  const s = await r.json();
  if (!s.access_token) throw new Error('verify ' + JSON.stringify(s).slice(0, 300));
  return { ...x, jwt: s.access_token, refresh: s.refresh_token };
}
export const rest = (jwt, path, init = {}) => fetch(`${P.url}/rest/v1/${path}`, { ...init, headers: { apikey: P.anon, authorization: `Bearer ${jwt}`, 'content-type': 'application/json', ...(init.headers || {}) } }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
export const api = (jwt, path, body = {}) => fetch(`${FN}/api/${path}`, { method: 'POST', headers: { authorization: `Bearer ${jwt}`, apikey: P.anon, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
if (process.argv[1].endsWith('link-check.mjs')) {
  const tok = fs.readFileSync(new URL('../.secrets/admin-link.txt', import.meta.url), 'utf8').trim().split('#k=')[1];
  const s = await sessionFor(tok);
  console.log('admin session ok', s.kind);
  const b = await rest(s.jwt, 'businesses?select=slug,name');
  console.log('businesses', b.status, b.json?.map((x) => x.slug));
  console.log('me', JSON.stringify(await api(s.jwt, 'me')).slice(0, 200));
  const anon = await fetch(`${P.url}/rest/v1/orders?select=id`, { headers: { apikey: P.anon } });
  console.log('anon orders', anon.status, (await anon.text()).slice(0, 120));
}
