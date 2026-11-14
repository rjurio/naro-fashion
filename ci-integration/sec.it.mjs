// Real API + real Postgres security probe for (1) draft CMS pages on the public
// list and (2) PATCH /payments/:id tenant scoping. Local API on the isolated
// schema it_sec only. Never production. Every check states the SAFE behaviour,
// so on the unfixed code the failing checks are the vulnerability.
//   node sec.it.mjs <ids.json>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const API = (process.env.IT_API || 'http://localhost:4140/api/v1').replace(/\/$/, '');
if (!/^http:\/\/localhost:/.test(API)) throw new Error('refusing: IT_API must be localhost');
const ids = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const sql = (q) => execFileSync(process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe', ['-U', 'naro_admin', '-h', 'localhost', '-d', 'naro_fashion', '-qAt', '-v', 'ON_ERROR_STOP=1',
  '-c', `SET search_path TO it_sec; ${q}`], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8' }).trim();
const xff = (s) => { const h = createHash('sha256').update(String(s)).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
async function call(method, p, { token, tenant, body } = {}) {
  const r = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff(token || tenant || p), ...(tenant ? { 'X-Tenant-Id': tenant } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, data, text };
}
const results = [];
async function check(name, fn) {
  try { const n = await fn(); results.push('PASS'); console.log(`  ✔ ${name}${n ? `  — ${n}` : ''}`); }
  catch (e) { results.push('FAIL'); console.log(`  ✖ ${name}\n      ${String(e?.message || e).split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
async function login(email, tenant, customer = false) {
  const r = await call('POST', '/auth/login', { tenant: customer ? tenant : undefined, body: { email, password: ids.password, ...(customer ? { audience: 'customer' } : {}) } });
  const t = r.data?.accessToken;
  if (!t) throw new Error(`login ${email}: ${r.status} ${r.text.slice(0, 120)}`);
  return t;
}
const A = ids.a, B = ids.b;
const tok = {
  superA: await login(A.superEmail), staffA: await login(A.staffEmail), custA: await login(A.customerEmail, A.tenantId, true),
};

console.log(`real API ${API} · isolated schema it_sec`);
console.log('\n1. CMS pages');
await check('anonymous public list: published pages only (no draft, no deleted)', async () => {
  const r = await call('GET', '/cms/pages', { tenant: A.tenantId });
  assert(r.status === 200 && Array.isArray(r.data), `${r.status}`);
  assert(!r.text.includes('SECRET DRAFT') && !r.text.includes('draft-only text'), 'draft page leaked to an anonymous visitor');
  assert(!r.text.includes('Deleted a'), 'deleted page leaked');
  assert(r.data.some((p) => p.slug === 'faq'), 'published page missing (footer links would break)');
  return r.data.map((p) => p.slug).join(',');
});
await check('anonymous public list carries display fields only (no page body)', async () => {
  const r = await call('GET', '/cms/pages', { tenant: A.tenantId });
  assert(r.data.every((p) => !('content' in p) && !('contentSwahili' in p)), 'content returned in the public list');
  assert(r.data.every((p) => p.isPublished === true), 'isPublished missing (storefront footer filters on it)');
});
await check('anonymous draft by slug → 404 (unchanged)', async () => {
  const r = await call('GET', '/cms/pages/upcoming-sale', { tenant: A.tenantId });
  assert(r.status === 404 && !r.text.includes('SECRET'), `${r.status}`);
});
await check('a signed-in customer also gets published pages only', async () => {
  const r = await call('GET', '/cms/pages', { token: tok.custA });
  assert(r.status === 200 && !r.text.includes('SECRET DRAFT'), `${r.status} draft leaked to a customer`);
});
await check('shop A admin: admin list includes A\'s draft, never shop B pages', async () => {
  const r = await call('GET', '/cms/pages/admin', { token: tok.superA });
  assert(r.status === 200, `${r.status}`);
  assert(r.text.includes('SECRET DRAFT a') && r.text.includes('draft-only text a'), 'draft missing for the editor');
  assert(!r.text.includes(' b<') && !r.text.includes('SECRET DRAFT b') && !r.text.includes('Published b'), 'other shop leaked');
  assert(!r.text.includes('Deleted a'), 'deleted page in the editor list');
});
await check('admin list refuses anonymous (401) and customers (403)', async () => {
  const anon = await call('GET', '/cms/pages/admin', { tenant: A.tenantId });
  const cust = await call('GET', '/cms/pages/admin', { token: tok.custA });
  assert(anon.status === 401 && cust.status === 403, `anon ${anon.status}, customer ${cust.status}`);
  assert(!anon.text.includes('SECRET') && !cust.text.includes('SECRET'), 'body leaked');
});
await check('shop A admin token + X-Tenant-Id of shop B on the public list → 403 (no cross-shop read)', async () => {
  const r = await call('GET', '/cms/pages', { token: tok.superA, tenant: B.tenantId });
  assert(r.status === 403 && !r.text.includes('SECRET DRAFT b'), `${r.status}`);
});

console.log('\n2. PATCH /payments/:id');
const statusOf = (id) => sql(`SELECT status FROM "Payment" WHERE id='${id}'`);
await check('shop A admin (payments:manage) cannot change shop B\'s payment: 404, row unchanged', async () => {
  const before = sql(`SELECT md5(t::text) FROM "Payment" t WHERE id='${B.paymentId}'`);
  const r = await call('PATCH', `/payments/${B.paymentId}`, { token: tok.superA, body: { status: 'COMPLETED' } });
  assert(r.status === 404, `${r.status} ${r.text.slice(0, 100)}`);
  assert(sql(`SELECT md5(t::text) FROM "Payment" t WHERE id='${B.paymentId}'`) === before, 'shop B payment changed');
});
await check('the cross-shop 404 says the same as an unknown id (no existence leak)', async () => {
  const x = await call('PATCH', `/payments/${B.paymentId}`, { token: tok.superA, body: { status: 'COMPLETED' } });
  const y = await call('PATCH', '/payments/cmnotarealpaymentid0000000', { token: tok.superA, body: { status: 'COMPLETED' } });
  assert(x.status === y.status && x.data?.message === y.data?.message, `${x.status}/${x.data?.message} vs ${y.status}/${y.data?.message}`);
  assert(!x.text.includes('IT-SEC-b') && !x.text.includes('50000'), 'shop B payment data in the error');
});
await check('STAFF without payments:manage → 403; a customer → 403; nothing changed', async () => {
  const s = await call('PATCH', `/payments/${A.paymentId}`, { token: tok.staffA, body: { status: 'COMPLETED' } });
  const c = await call('PATCH', `/payments/${A.paymentId}`, { token: tok.custA, body: { status: 'COMPLETED' } });
  assert(s.status === 403 && c.status === 403, `staff ${s.status}, customer ${c.status}`);
  assert(statusOf(A.paymentId) === 'PENDING', 'changed');
});
await check('legitimate: shop A admin changes shop A\'s own payment (PENDING → COMPLETED)', async () => {
  const r = await call('PATCH', `/payments/${A.paymentId}`, { token: tok.superA, body: { status: 'COMPLETED' } });
  assert(r.status === 200 && r.data?.status === 'COMPLETED', `${r.status} ${r.text.slice(0, 100)}`);
  assert(statusOf(A.paymentId) === 'COMPLETED', 'db');
});

const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
