// روابط الفحص (مالك محلك، موظفيه، مالك منشأة الاختبار) تنشأ مرة وحدة وتنحفظ في .secrets/test-links.json
import fs from 'node:fs';
import { sessionFor, api } from './link-check.mjs';
import { sql } from '../tools/sql.mjs';

const F = new URL('../.secrets/test-links.json', import.meta.url);
export async function testLinks() {
  let L = fs.existsSync(F) ? JSON.parse(fs.readFileSync(F, 'utf8')) : {};
  const need = ['owner_mahalak', 'staff_ahmed', 'staff_khalid', 'owner_testb'].filter((k) => !L[k]);
  if (need.length) {
    const adminTok = fs.readFileSync(new URL('../.secrets/admin-link.txt', import.meta.url), 'utf8').trim().split('#k=')[1];
    const a = await sessionFor(adminTok);
    const biz = Object.fromEntries(sql(`select slug, id from businesses where slug in ('mahalak','test-b')`).map((r) => [r.slug, r.id]));
    const staff = Object.fromEntries(sql(`select name, id from staff where business_id = '${biz.mahalak}'`).map((r) => [r.name, r.id]));
    const mk = async (body) => { const r = await api(a.jwt, 'admin/link/create', body); if (!r.ok) throw new Error(JSON.stringify(r)); return r.url; };
    if (!L.owner_mahalak) L.owner_mahalak = await mk({ kind: 'owner', business_id: biz.mahalak, label: 'فحص محلك' });
    if (!L.staff_ahmed) L.staff_ahmed = await mk({ kind: 'staff', business_id: biz.mahalak, staff_id: staff['أحمد'], label: 'أحمد' });
    if (!L.staff_khalid) L.staff_khalid = await mk({ kind: 'staff', business_id: biz.mahalak, staff_id: staff['خالد'], label: 'خالد' });
    if (!L.owner_testb) L.owner_testb = await mk({ kind: 'owner', business_id: biz['test-b'], label: 'فحص منشأة الاختبار' });
    fs.writeFileSync(F, JSON.stringify(L, null, 1));
  }
  const tok = (k) => L[k].split('#k=')[1];
  return { ...L, tok };
}
if (process.argv[1].endsWith('links.mjs')) { const L = await testLinks(); console.log(Object.keys(L).filter((k) => k !== 'tok').join(', ')); }
