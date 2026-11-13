// Round 25E D: separation of duties for refund payouts — real API + real
// Postgres (local branch local/separation-of-duties). Isolated schema it_pos
// seeded by pos-rental-seed.js. Never production.
//   PSQL=<psql> node sod.it.mjs <pos-ids.json>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const ids = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const API = (process.env.IT_API || 'http://localhost:4130/api/v1').replace(/\/$/, '');
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe';
const T = ids.tenantId, G = ids.gown;
const sql = (q) => execFileSync(PSQL, ['-U', 'naro_admin', '-h', 'localhost', '-d', 'naro_fashion', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', 'SET search_path TO it_pos', '-c', q], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sqlErr = (q) => { try { sql(q); return null; } catch (e) { return String(e.stderr || e.message); } };
const ip = (s) => { const h = createHash('sha256').update(String(s)).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
async function call(method, p, { token, body } = {}) {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': T, 'X-Forwarded-For': ip(token || body?.email || randomBytes(4).toString('hex')), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
}
const results = [];
async function check(name, fn) {
  try { const n = await fn(); results.push('PASS'); console.log(`  ✔ ${name}${n ? `  — ${n}` : ''}`); }
  catch (e) { results.push('FAIL'); console.log(`  ✖ ${name}\n      ${String(e?.message || e).split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
const login = async (w) => { const r = await call('POST', '/auth/login', { body: { email: w.email, password: w.password } }); assert(r.data?.accessToken, `login ${w.email}`); return r.data.accessToken; };
const tok = {};
for (const k of ['super', 'cashier', 'reviewer', 'approver', 'finance']) tok[k] = await login(ids.admins[k]);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const BASE = 30 + Number(sql(`SELECT COALESCE(max("returnDate")::date - current_date, 0) FROM "RentalOrder" WHERE "tenantId" = '${T}'`));
async function cancelledWithMoney() {
  const c = (await call('POST', '/pos-rentals/customers', { token: tok.cashier, body: { firstName: 'SoD', lastName: randomBytes(2).toString('hex'), phone: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } })).data;
  const b = (await call('POST', '/pos-rentals', { token: tok.cashier, body: { customerId: c.id, productId: G.id, variantId: G.M, startDate: day(BASE), returnDate: day(BASE + 2), pickupDate: day(BASE), termsAccepted: true } })).data;
  await call('POST', `/pos-rentals/${b.id}/id-in-person`, { token: tok.reviewer, body: { idType: 'NATIONAL_ID', idNumber: `1996${randomBytes(2).toString('hex')}-12345` } });
  eq((await call('POST', `/pos-rentals/${b.id}/payments`, { token: tok.cashier, body: { component: 'RENTAL_FEE', sessionId: ids.sessions.cashier, tenders: [{ method: 'CASH', amount: 100000 }] } })).status, 201, 'paid');
  if (process.env.IT_CANCELLATION === '1') {
    // cancellation workflow (#36): the cancellation raises the refund request itself
    eq((await call('PATCH', `/rentals/${b.id}/status`, { token: tok.cashier, body: { status: 'CANCELLED', cancellationReason: 'CUSTOMER_REQUEST', cancellationNote: 'SoD test' } })).status, 200, 'cancelled');
    return sql(`SELECT id FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${b.id}' AND kind = 'CANCELLATION'`);
  }
  // without it (#35): cancel, then the cashier requests the refund
  eq((await call('PATCH', `/rentals/${b.id}/status`, { token: tok.cashier, body: { status: 'CANCELLED' } })).status, 200, 'cancelled');
  const r = await call('POST', `/rental-money/rentals/${b.id}/refund-requests`, { token: tok.cashier, body: { kind: 'CANCELLATION', component: 'RENTAL_FEE', amount: 100000, reason: 'booking cancelled before collection' } });
  eq(r.status, 201, `request ${JSON.stringify(r.data).slice(0, 120)}`);
  return r.data.id;
}
const pay = (id, token) => call('PATCH', `/rental-money/refund-requests/${id}/pay`, { token, body: { method: 'MOBILE_MONEY', reference: 'SOD' + randomBytes(5).toString('hex').toUpperCase() } });

console.log(`real API ${API} · isolated schema it_pos · separation of duties (round 25E D)`);
const q1 = await cancelledWithMoney();
await check('G2: a SUPER_ADMIN who approved the refund cannot also pay it out (403 PAYOUT_BY_APPROVER, audited); nothing paid', async () => {
  eq((await call('PATCH', `/rental-money/refund-requests/${q1}/approve`, { token: tok.super })).status, 200, 'approved by super');
  const r = await pay(q1, tok.super);
  eq([r.status, r.data?.code], [403, 'PAYOUT_BY_APPROVER'], 'approver pays');
  eq(sql(`SELECT status FROM "RentalRefundRequest" WHERE id = '${q1}'`), 'APPROVED', 'still unpaid');
  eq(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE "entityId" = '${q1}' AND action = 'REFUND_PAYOUT_DENIED' AND details::text LIKE '%PAYOUT_BY_APPROVER%'`), '1', 'audited');
});
await check('the database refuses the same thing written directly: PAID by the approver, or by the requester (R3_REFUND_SEPARATION)', async () => {
  const e1 = sqlErr(`UPDATE "RentalRefundRequest" SET status = 'PAID', "paidById" = "approvedById", "paidAt" = now() WHERE id = '${q1}'`);
  const e2 = sqlErr(`UPDATE "RentalRefundRequest" SET status = 'PAID', "paidById" = "requestedById", "paidAt" = now() WHERE id = '${q1}'`);
  assert(/R3_REFUND_SEPARATION/.test(e1 || '') && /R3_REFUND_SEPARATION/.test(e2 || ''), `${(e1 || 'ALLOWED').split('\n')[0]} | ${(e2 || 'ALLOWED').split('\n')[0]}`);
});
await check('a third person (finance) pays it out', async () => {
  eq((await pay(q1, tok.finance)).status, 200, 'finance pays');
  eq(sql(`SELECT ("paidById" <> "approvedById" AND "paidById" <> "requestedById")::text FROM "RentalRefundRequest" WHERE id = '${q1}'`), 'true', 'three people');
});
const q2 = await cancelledWithMoney();
await check('the database refuses a self-approval written directly (approvedById = requestedById)', async () => {
  const e = sqlErr(`UPDATE "RentalRefundRequest" SET status = 'APPROVED', "approvedById" = "requestedById", "approvedAt" = now() WHERE id = '${q2}'`);
  assert(/R3_REFUND_SEPARATION/.test(e || ''), (e || 'ALLOWED').split('\n')[0]);
});

const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
