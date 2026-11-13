// Round 25E E: R1 refund accounting (earliest R1 money-ledger release, base #28).
// Real API + real Postgres; payments arrive through the REAL signed ClickPesa
// webhook path (PaymentSettlementService). Isolated schema it_pos seeded by
// pos-rental-seed.js. Never production.
//   PSQL=<psql> [PGPORT=..] node r1-refund-accounting.it.mjs <pos-ids.json>
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash, createHmac, randomBytes } from 'node:crypto';

const ids = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const API = (process.env.IT_API || 'http://localhost:4130/api/v1').replace(/\/$/, '');
const SCHEMA = process.env.IT_SCHEMA || 'it_pos';
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe';
const HOST = process.env.PGHOST || 'localhost';
if (!/^(localhost|127\.0\.0\.1)$/.test(HOST)) throw new Error('refusing: local/CI database only');
const T = ids.tenantId, G = ids.gown;
const PSQL_ARGS = ['-U', 'naro_admin', '-h', HOST, '-d', 'naro_fashion', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
const ENV = { ...process.env, PGPASSWORD: 'Admin123' };
const sql = (...q) => execFileSync(PSQL, [...PSQL_ARGS, '-c', `SET search_path TO ${SCHEMA}`, ...q.flatMap((c) => ['-c', c])], { env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ip = (s) => { const h = createHash('sha256').update(String(s)).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
async function call(method, p, { token, body, tenant = T, raw } = {}) {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(tenant ? { 'X-Tenant-Id': tenant } : {}), 'X-Forwarded-For': ip(token || body?.email || randomBytes(4).toString('hex')), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
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
const uid = () => 'it' + randomBytes(10).toString('hex');
const login = async (w) => { const r = await call('POST', '/auth/login', { body: { email: w.email, password: w.password } }); assert(r.data?.accessToken, `login ${w.email} ${r.status}`); return r.data.accessToken; };
const tok = {};
for (const k of ['cashier', 'cashier2', 'reviewer', 'approver', 'finance']) tok[k] = await login(ids.admins[k]);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const SLUG = sql(`SELECT slug FROM "Tenant" WHERE id = '${T}'`);
const SECRET = 'it-r1-checksum-' + randomBytes(6).toString('hex');
sql(`DELETE FROM "PaymentMethod" WHERE "tenantId" = '${T}' AND code = 'CLICKPESA_MIXX'`,
    `INSERT INTO "PaymentMethod" (id, "tenantId", name, code, "isActive", "integrationParams", "updatedAt") VALUES ('${uid()}', '${T}', 'Mixx by Yas (test)', 'CLICKPESA_MIXX', true, '{"clientId":"it","apiKey":"it","checksumSecret":"${SECRET}"}', now())`);
const canon = (v) => (v === null || typeof v !== 'object') ? v : Array.isArray(v) ? v.map(canon)
  : Object.fromEntries(Object.keys(v).filter((k) => k !== 'checksum' && k !== 'checksumMethod').sort().map((k) => [k, canon(v[k])]));
async function webhook(ref, amount, eventId = 'evt-' + ref + '-' + randomBytes(3).toString('hex')) {
  const payload = { event: 'PAYMENT RECEIVED', data: { id: eventId, orderReference: ref, status: 'SUCCESS', collectedAmount: amount } };
  payload.checksum = createHmac('sha256', SECRET).update(JSON.stringify(canon(payload)), 'utf8').digest('hex');
  return call('POST', `/payments/webhook/clickpesa/${SLUG}`, { raw: JSON.stringify(payload), tenant: null });
}
function gatewayPayment(rentalId, amount) {
  const ref = 'ITR1' + randomBytes(6).toString('hex').toUpperCase();
  sql(`INSERT INTO "Payment" (id, "tenantId", "rentalOrderId", amount, method, status, "providerCode", "transactionRef", "createdAt", "updatedAt") VALUES ('${uid()}', '${T}', '${rentalId}', ${amount}, 'MOBILE_MONEY', 'PENDING', 'CLICKPESA_MIXX', '${ref}', (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))`);
  return ref;
}
const BASE = 30 + Number(sql(`SELECT COALESCE(max("returnDate")::date - current_date, 0) FROM "RentalOrder" WHERE "tenantId" = '${T}'`));
let seq = 0;
async function booking(start, pay = []) {
  const c = (await call('POST', '/pos-rentals/customers', { token: tok.cashier, body: { firstName: 'R1', lastName: `C${++seq}`, phone: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } })).data;
  const b = await call('POST', '/pos-rentals', { token: tok.cashier, body: { customerId: c.id, productId: G.id, variantId: G.M, startDate: day(BASE + start), returnDate: day(BASE + start + 2), pickupDate: day(BASE + start), termsAccepted: true } });
  assert(b.status === 201, `book ${b.status} ${JSON.stringify(b.data).slice(0, 160)}`);
  await call('POST', `/pos-rentals/${b.data.id}/id-in-person`, { token: tok.reviewer, body: { idType: 'NATIONAL_ID', idNumber: `1995${String(seq).padStart(4, '0')}-12345` } });
  for (const [component, amount] of pay) {
    const p = await call('POST', `/pos-rentals/${b.data.id}/payments`, { token: tok.cashier, body: { component, sessionId: ids.sessions.cashier, tenders: [{ method: 'CASH', amount }] } });
    assert(p.status === 201, `pay ${component} ${p.status}`);
  }
  return b.data.id;
}
const cancel = (id, token = tok.cashier) => call('PATCH', `/rentals/${id}/status`, { token, body: { status: 'CANCELLED' } });
const state = (id) => sql(`SELECT status || '|' || COALESCE("holdState", '-') FROM "RentalOrder" WHERE id = '${id}'`);
const ledger = async (id) => (await call('GET', `/rental-money/rentals/${id}/ledger`, { token: tok.finance })).data;
const request = (id, body) => call('POST', `/rental-money/rentals/${id}/refund-requests`, { token: tok.cashier, body });
const approve = (rid) => call('PATCH', `/rental-money/refund-requests/${rid}/approve`, { token: tok.approver });
const payOut = (rid) => call('PATCH', `/rental-money/refund-requests/${rid}/pay`, { token: tok.finance, body: { method: 'MOBILE_MONEY', reference: 'MPR1' + randomBytes(5).toString('hex').toUpperCase() } });
const touched = [];

console.log(`real API ${API} · isolated schema ${SCHEMA} · R1 refund accounting (round 25E E), real ClickPesa webhook path`);

console.log('\n1. a payment confirmed concurrently with the cancellation');
await check('the first payment confirms while the cancellation is between its money check and its write → the booking ends CANCELLED with a REFUND_DUE liability and the money held', async () => {
  const id = await booking(0); touched.push(id);
  const ref = gatewayPayment(id, 50000);
  eq(state(id).split('|')[0] === 'CANCELLED', false, 'open');
  // Hold the booking row: the cancellation stops at its write, AFTER its money check (nothing held yet).
  const holder = spawn(PSQL, [...PSQL_ARGS, '-c', `SET search_path TO ${SCHEMA}`, '-c', 'BEGIN', '-c', `SELECT 1 FROM "RentalOrder" WHERE id = '${id}' FOR UPDATE`, '-c', 'SELECT pg_sleep(3)', '-c', 'COMMIT'], { env: ENV });
  await new Promise((r) => setTimeout(r, 700));
  const c = cancel(id);
  await new Promise((r) => setTimeout(r, 900));
  const w = webhook(ref, 50000);                        // the gateway confirms meanwhile
  const [cr, wr] = await Promise.all([c, w, new Promise((r) => holder.on('exit', r))]);
  eq([cr.status, wr.status], [200, 201], 'both succeeded');
  eq(state(id), 'CANCELLED|REFUND_DUE', 'liability recorded');
  const l = await ledger(id);
  eq([l.totalHeld, l.collected.RENTAL_FEE], [50000, 50000], 'held');
});
await check('payment first, then cancellation (no race) → REFUND_DUE as before', async () => {
  const id = await booking(10); touched.push(id);
  eq((await webhook(gatewayPayment(id, 50000), 50000)).status, 201, 'paid');
  eq((await cancel(id)).status, 200, 'cancelled');
  eq(state(id), 'CANCELLED|REFUND_DUE', 'flag');
});
await check('cancellation first, then a late payment → REFUND_DUE; no money → no flag', async () => {
  const id = await booking(20); touched.push(id);
  const ref = gatewayPayment(id, 30000);
  eq((await cancel(id)).status, 200, 'cancelled');
  assert(!state(id).endsWith('REFUND_DUE'), `nothing held yet: ${state(id)}`);
  eq((await webhook(ref, 30000)).status, 201, 'late payment');
  eq(state(id), 'CANCELLED|REFUND_DUE', 'flag after the late payment');
  const none = await booking(30); touched.push(none);
  eq((await cancel(none)).status, 200, 'cancelled');
  assert(!state(none).endsWith('REFUND_DUE'), `no money, no flag: ${state(none)}`);
});

console.log('\n2. refunded overpayments do not reduce the rental-fee refund');
async function overpaid(start) {   // fee 100,000 at the till + 600,000 by M-Pesa = 100,000 more than fee + deposit
  const id = await booking(start, [['RENTAL_FEE', 100000]]); touched.push(id);
  eq((await webhook(gatewayPayment(id, 600000), 600000)).status, 201, 'mobile money');
  const l = await ledger(id);
  eq([l.collected.RENTAL_FEE, l.collected.DEPOSIT, l.overpaid], [400000, 200000, 100000], 'ledger');
  const o = await request(id, { kind: 'OVERPAYMENT', component: 'RENTAL_FEE', amount: 100000, reason: 'customer paid 100,000 more than fee and deposit' });
  eq(o.status, 201, `overpayment request ${JSON.stringify(o.data).slice(0, 140)}`);
  eq((await approve(o.data.id)).status, 200, 'approved');
  return { id, overpayment: o.data.id };
}
await check('overpayment refunded (approved + paid) → the surplus is 0, the fee and deposit stay fully held; after cancelling, the FULL fee and deposit can be requested, nothing more', async () => {
  const { id, overpayment } = await overpaid(40);
  eq((await payOut(overpayment)).status, 200, 'overpayment paid');
  let l = await ledger(id);
  eq([l.held.RENTAL_FEE, l.held.DEPOSIT, l.overpaid], [400000, 200000, 0], 'ledger after payout');
  eq((await cancel(id)).status, 200, 'cancelled');
  eq(state(id), 'CANCELLED|REFUND_DUE', 'liability');
  const fee = await request(id, { kind: 'CANCELLATION', component: 'RENTAL_FEE', amount: 400000, reason: 'full refund before collection (fee)' });
  const dep = await request(id, { kind: 'CANCELLATION', component: 'DEPOSIT', amount: 200000, reason: 'full refund before collection (deposit)' });
  eq([fee.status, dep.status], [201, 201], `full fee + deposit (${JSON.stringify(fee.data).slice(0, 120)})`);
  eq((await request(id, { kind: 'CANCELLATION', component: 'RENTAL_FEE', amount: 1, reason: 'one shilling too many' })).status, 400, 'no over-request');
  eq((await request(id, { kind: 'OVERPAYMENT', component: 'RENTAL_FEE', amount: 1, reason: 'the surplus was already paid back' })).status, 400, 'no second overpayment');
  for (const r of [fee.data.id, dep.data.id]) { eq((await approve(r)).status, 200, 'approve'); eq((await payOut(r)).status, 200, 'pay'); }
  l = await ledger(id);
  eq([l.totalHeld, l.refunded.RENTAL_FEE, l.refunded.DEPOSIT], [0, 400000, 200000], 'everything returned');
});
await check('overpayment APPROVED but unpaid → it does not reduce the fee room; a second overpayment request for the same surplus is refused', async () => {
  const { id, overpayment } = await overpaid(50);
  eq((await request(id, { kind: 'OVERPAYMENT', component: 'RENTAL_FEE', amount: 100000, reason: 'second claim on the same surplus' })).status, 400, 'double surplus claim');
  eq((await cancel(id)).status, 200, 'cancelled');
  eq((await request(id, { kind: 'CANCELLATION', component: 'RENTAL_FEE', amount: 400000, reason: 'full refund before collection (fee)' })).status, 201, 'full fee room');
  eq((await payOut(overpayment)).status, 200, 'overpayment paid later');
  eq((await ledger(id)).overpaid, 0, 'surplus returned');
});

console.log('\n3. reconciliation of payments, refunds, liabilities and audit');
await check('per booking: received − refunded = held (ledger); every REFUNDED row ↔ exactly one PAID request of the same amount; no request beyond the money; every decision audited', async () => {
  for (const id of touched) {
    const l = await ledger(id);
    const net = Number(sql(`SELECT (COALESCE(sum(amount) FILTER (WHERE status = 'COMPLETED'), 0) - COALESCE(sum(amount) FILTER (WHERE status = 'REFUNDED'), 0))::int FROM "Payment" WHERE "rentalOrderId" = '${id}'`));
    eq(Math.round(l.totalHeld), net, `held ${id}`);
  }
  const ids = touched.map((x) => `'${x}'`).join(',');
  eq(sql(`SELECT count(*) FROM "Payment" p WHERE p."rentalOrderId" IN (${ids}) AND p.status = 'REFUNDED' AND NOT EXISTS (SELECT 1 FROM "RentalRefundRequest" r WHERE r.id = p."refundRequestId" AND r.status = 'PAID' AND r.amount = p.amount)`), '0', 'orphan payouts');
  eq(sql(`SELECT count(*) FROM "RentalRefundRequest" r WHERE r."rentalOrderId" IN (${ids}) AND r.status = 'PAID' AND (SELECT count(*) FROM "Payment" p WHERE p."refundRequestId" = r.id AND p.status = 'REFUNDED') <> 1`), '0', 'paid without exactly one payout');
  eq(sql(`SELECT count(*) FROM (SELECT r."rentalOrderId", sum(r.amount + r."retainedAmount") AS asked FROM "RentalRefundRequest" r WHERE r."rentalOrderId" IN (${ids}) AND r.status NOT IN ('REJECTED', 'FAILED') GROUP BY 1) a
      WHERE a.asked > (SELECT COALESCE(sum(amount), 0) FROM "Payment" p WHERE p."rentalOrderId" = a."rentalOrderId" AND p.status = 'COMPLETED')`), '0', 'requests beyond the money received');
  eq(sql(`SELECT count(*) FROM "RentalRefundRequest" r WHERE r."rentalOrderId" IN (${ids}) AND r.status = 'PAID'
      AND (NOT EXISTS (SELECT 1 FROM "AdminActivityLog" a WHERE a."entityId" = r.id AND a.action = 'REFUND_APPROVED') OR NOT EXISTS (SELECT 1 FROM "AdminActivityLog" a WHERE a."entityId" = r.id AND a.action = 'REFUND_PAID'))`), '0', 'unaudited decisions');
  eq(sql(`SELECT count(*) FROM "RentalOrder" o WHERE o.id IN (${ids}) AND o.status = 'CANCELLED' AND COALESCE("holdState", '') NOT IN ('REFUND_DUE', 'REFUND_SETTLED')
      AND (SELECT COALESCE(sum(amount) FILTER (WHERE status = 'COMPLETED'), 0) - COALESCE(sum(amount) FILTER (WHERE status = 'REFUNDED'), 0) FROM "Payment" p WHERE p."rentalOrderId" = o.id) > 0`), '0', 'cancelled booking holding money without a liability');
  return `${touched.length} bookings reconciled`;
});

const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
