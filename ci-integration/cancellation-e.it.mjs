// Round 25D E: cancellation workflow regression — real API + real Postgres.
// Payments arrive through the REAL gateway path: a correctly signed ClickPesa
// webhook (HMAC over the canonical JSON with the shop's checksum secret) is
// settled by PaymentSettlementService, which runs the real late-payment hook.
// Isolated schema only (seeded by pos-rental-seed.js). Never production.
//   PSQL=<psql> PGPORT=<port> node cancellation-e.it.mjs <worktree> <pos-ids.json>
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash, createHmac, randomBytes } from 'node:crypto';

const WT = process.argv[2];
const ids = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const API = (process.env.IT_API || 'http://localhost:4130/api/v1').replace(/\/$/, '');
const SCHEMA = process.env.IT_SCHEMA || 'it_pos';
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe';
const HOST = process.env.PGHOST || 'localhost';
if (!/^(localhost|127\.0\.0\.1)$/.test(HOST)) throw new Error('refusing: local/CI database only');
const T = ids.tenantId, G = ids.gown;
const PSQL_ARGS = ['-U', 'naro_admin', '-h', HOST, '-d', 'naro_fashion', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
const ENV = { ...process.env, PGPASSWORD: 'Admin123' };
const sql = (...q) => execFileSync(PSQL, [...PSQL_ARGS, '-c', `SET search_path TO ${SCHEMA}`, ...q.flatMap((c) => ['-c', c])], { env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const bcrypt = createRequire(`${WT}/apps/api/package.json`)('bcryptjs');
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
const login = async (email, password, tenant = T) => { const r = await call('POST', '/auth/login', { body: { email, password }, tenant }); assert(r.data?.accessToken, `login ${email} ${r.status}`); return r.data.accessToken; };
const tok = {};
for (const k of ['cashier', 'cashier2', 'reviewer', 'approver', 'finance']) tok[k] = await login(ids.admins[k].email, ids.admins[k].password);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// ClickPesa for this shop (test credentials) + its webhook.
const SLUG = sql(`SELECT slug FROM "Tenant" WHERE id = '${T}'`);
const SECRET = 'it-clickpesa-checksum-' + randomBytes(6).toString('hex');
sql(`DELETE FROM "PaymentMethod" WHERE "tenantId" = '${T}' AND code = 'CLICKPESA_MIXX'`,
    `INSERT INTO "PaymentMethod" (id, "tenantId", name, code, "isActive", "integrationParams", "updatedAt") VALUES ('${uid()}', '${T}', 'Mixx by Yas (test)', 'CLICKPESA_MIXX', true, '{"clientId":"it","apiKey":"it","checksumSecret":"${SECRET}"}', now())`);
const canon = (v) => (v === null || typeof v !== 'object') ? v : Array.isArray(v) ? v.map(canon)
  : Object.fromEntries(Object.keys(v).filter((k) => k !== 'checksum' && k !== 'checksumMethod').sort().map((k) => [k, canon(v[k])]));
async function webhook(ref, amount, eventId, { slug = SLUG, secret = SECRET } = {}) {
  const payload = { event: 'PAYMENT RECEIVED', data: { id: eventId, orderReference: ref, status: 'SUCCESS', collectedAmount: amount } };
  payload.checksum = createHmac('sha256', secret).update(JSON.stringify(canon(payload)), 'utf8').digest('hex');
  return call('POST', `/payments/webhook/clickpesa/${slug}`, { raw: JSON.stringify(payload), tenant: null });
}
function gatewayPayment(rentalId, amount) {   // what PaymentsService.initiate writes (PENDING, no component = unallocated)
  const ref = 'ITCP' + randomBytes(6).toString('hex').toUpperCase();
  sql(`INSERT INTO "Payment" (id, "tenantId", "rentalOrderId", amount, method, status, "providerCode", "transactionRef", "createdAt", "updatedAt") VALUES ('${uid()}', '${T}', '${rentalId}', ${amount}, 'MOBILE_MONEY', 'PENDING', 'CLICKPESA_MIXX', '${ref}', (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))`);
  return ref;
}
const BASE = 30 + Number(sql(`SELECT COALESCE(max("returnDate")::date - current_date, 0) FROM "RentalOrder" WHERE "tenantId" = '${T}'`));
let seq = 0;
async function booking(start, pay = [['RENTAL_FEE', 100000]]) {
  const c = (await call('POST', '/pos-rentals/customers', { token: tok.cashier, body: { firstName: 'CancelE', lastName: `C${++seq}`, phone: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } })).data;
  const b = await call('POST', '/pos-rentals', { token: tok.cashier, body: { customerId: c.id, productId: G.id, variantId: G.M, startDate: day(BASE + start), returnDate: day(BASE + start + 2), pickupDate: day(BASE + start), termsAccepted: true } });
  assert(b.status === 201, `book ${b.status} ${JSON.stringify(b.data).slice(0, 160)}`);
  await call('POST', `/pos-rentals/${b.data.id}/id-in-person`, { token: tok.reviewer, body: { idType: 'NATIONAL_ID', idNumber: `1994${String(seq).padStart(4, '0')}-12345` } });
  for (const [component, amount] of pay) {
    const p = await call('POST', `/pos-rentals/${b.data.id}/payments`, { token: tok.cashier, body: { component, sessionId: ids.sessions.cashier, tenders: [{ method: 'CASH', amount }] } });
    assert(p.status === 201, `pay ${component} ${p.status}`);
  }
  return b.data.id;
}
const cancel = (id, token = tok.cashier) => call('PATCH', `/rentals/${id}/status`, { token, body: { status: 'CANCELLED', cancellationReason: 'CUSTOMER_REQUEST', cancellationNote: 'round 25D E test' } });
const reqs = (id) => sql(`SELECT coalesce(string_agg(component || ':' || amount::int || ':' || status || ':' || CASE WHEN "requestedById" LIKE 'SYSTEM:%' THEN "requestedById" ELSE 'staff' END, ',' ORDER BY "createdAt", component), '') FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${id}' AND kind = 'CANCELLATION'`);
const requested = (id) => Number(sql(`SELECT COALESCE(sum(amount), 0)::int FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${id}' AND kind = 'CANCELLATION' AND status NOT IN ('REJECTED', 'FAILED')`));
const received = (id) => Number(sql(`SELECT COALESCE(sum(amount), 0)::int FROM "Payment" WHERE "rentalOrderId" = '${id}' AND status = 'COMPLETED'`));
const ledger = async (id) => (await call('GET', `/rental-money/rentals/${id}/ledger`, { token: tok.finance })).data;

console.log(`real API ${API} · isolated schema ${SCHEMA} · cancellation regression (round 25D E), real ClickPesa webhook path`);

console.log('\n1. repeated and late-arriving gateway callbacks');
const b1 = await booking(0);
await check('cancel with money received → a full refund request for it (staff requester)', async () => {
  eq((await cancel(b1)).status, 200, 'cancelled');
  eq(reqs(b1), 'RENTAL_FEE:100000:REQUESTED:staff', 'requests');
});
const ref1 = gatewayPayment(b1, 50000);
await check('a gateway payment confirmed AFTER the cancellation (real signed webhook) → settled once, refund requested automatically by SYSTEM:LATE_PAYMENT; booking flagged REFUND_DUE', async () => {
  const w = await webhook(ref1, 50000, 'evt-' + ref1);
  eq(w.status, 201, `webhook ${JSON.stringify(w.data)}`);
  eq(received(b1), 150000, 'received');
  eq(reqs(b1), 'RENTAL_FEE:100000:REQUESTED:staff,RENTAL_FEE:50000:REQUESTED:SYSTEM:LATE_PAYMENT', 'late request');
  eq(sql(`SELECT status || '|' || COALESCE("holdState", '') FROM "RentalOrder" WHERE id = '${b1}'`), 'CANCELLED|REFUND_DUE', 'flag');
});
await check('the SAME callback repeated (same event id) → acknowledged as a duplicate; a retry with a NEW event id → no second credit; still exactly one late request', async () => {
  const d = await webhook(ref1, 50000, 'evt-' + ref1);
  eq([d.status, d.data?.duplicate], [201, true], 'duplicate');
  const r = await webhook(ref1, 50000, 'evt-retry-' + ref1);
  eq(r.status, 201, 'retry accepted');
  eq([received(b1), sql(`SELECT count(*) FROM "Payment" WHERE "rentalOrderId" = '${b1}'`)], [150000, '2'], 'one payment, one credit');
  eq(requested(b1), 150000, 'requested once');
});
await check('a callback for an unknown reference, or with a wrong checksum → refused; nothing changes', async () => {
  eq((await webhook('ITCPNOSUCHREF', 50000, 'evt-x-' + randomBytes(4).toString('hex'))).status, 404, 'unknown ref');
  eq((await webhook(ref1, 50000, 'evt-bad', { secret: 'wrong-secret' })).status, 403, 'bad checksum');
  eq(requested(b1), 150000, 'unchanged');
});

console.log('\n2. cancellation concurrent with a payment confirmation');
await check('the payment confirms WHILE the cancellation transaction is between counting the money and committing → the new money still ends up in a refund request (none lost, none doubled)', async () => {
  const b2 = await booking(10);
  const ref2 = gatewayPayment(b2, 50000);
  // Hold the refund-request table so the cancellation transaction stops right
  // after it has counted the money and before it inserts its requests.
  const holder = spawn(PSQL, [...PSQL_ARGS, '-c', `SET search_path TO ${SCHEMA}`, '-c', 'BEGIN', '-c', 'LOCK TABLE "RentalRefundRequest" IN SHARE ROW EXCLUSIVE MODE', '-c', 'SELECT pg_sleep(3)', '-c', 'COMMIT'], { env: ENV });
  await new Promise((r) => setTimeout(r, 700));
  const c = cancel(b2);                                  // counts 100,000, then waits for the table
  await new Promise((r) => setTimeout(r, 900));
  const w = webhook(ref2, 50000, 'evt-' + ref2);        // the gateway confirms 50,000 meanwhile
  const [cr, wr] = await Promise.all([c, w, new Promise((r) => holder.on('exit', r))]);
  eq([cr.status, wr.status], [200, 201], 'both succeeded');
  eq(received(b2), 150000, 'received');
  eq(requested(b2), 150000, `requested (${reqs(b2)})`);
  return reqs(b2);
});
await check('two cancellations racing + two callbacks for the same payment → one CANCELLED booking, money requested exactly once', async () => {
  const b3 = await booking(20);
  const ref3 = gatewayPayment(b3, 50000);
  const rs = await Promise.all([cancel(b3), cancel(b3, tok.cashier2), webhook(ref3, 50000, 'evt-a-' + ref3), webhook(ref3, 50000, 'evt-b-' + ref3)]);
  eq(rs.slice(0, 2).map((r) => r.status).sort(), [200, 409], `cancels ${rs.map((r) => r.status)}`);
  eq(received(b3), 150000, 'received');
  eq(requested(b3), 150000, `requested (${reqs(b3)})`);
});

console.log('\n3. partially refunded bookings, approved and completed payouts');
const mobileRef = () => 'MPRF' + randomBytes(5).toString('hex').toUpperCase();
async function overpaid(start) {   // fee 100,000 cash at the till + 600,000 by M-Pesa: 100,000 more than the fee + deposit
  const id = await booking(start);
  const ref = gatewayPayment(id, 600000);
  eq((await webhook(ref, 600000, 'evt-' + ref)).status, 201, 'overpayment settled');
  eq((await ledger(id)).overpaid, 100000, 'overpaid');
  const o = await call('POST', `/rental-money/rentals/${id}/refund-requests`, { token: tok.cashier, body: { kind: 'OVERPAYMENT', component: 'RENTAL_FEE', amount: 100000, reason: 'customer paid 100,000 more than fee and deposit' } });
  eq(o.status, 201, `overpayment request ${JSON.stringify(o.data).slice(0, 160)}`);
  eq((await call('PATCH', `/rental-money/refund-requests/${o.data.id}/approve`, { token: tok.approver })).status, 200, 'approved');
  return { id, overpayment: o.data.id };
}
await check('partially refunded booking: an overpayment already refunded (approved + paid) → the cancellation requests the full fee and deposit, nothing for the refunded part', async () => {
  const { id, overpayment } = await overpaid(30);
  eq((await call('PATCH', `/rental-money/refund-requests/${overpayment}/pay`, { token: tok.finance, body: { method: 'MOBILE_MONEY', reference: mobileRef() } })).status, 200, 'overpayment paid');
  eq((await cancel(id)).status, 200, 'cancelled');
  eq(reqs(id), 'RENTAL_FEE:400000:REQUESTED:staff,DEPOSIT:200000:REQUESTED:staff', 'fee + deposit');
  const l = await ledger(id);
  eq([l.held.RENTAL_FEE, l.held.DEPOSIT, l.overpaid], [400000, 200000, 0], 'ledger');
});
await check('a refund APPROVED but not yet paid at cancellation (overpayment) → its money is not requested twice, nor taken off the fee; paying it later and re-raising creates nothing', async () => {
  const { id, overpayment } = await overpaid(40);
  eq((await cancel(id)).status, 200, 'cancelled');
  eq(reqs(id), 'RENTAL_FEE:400000:REQUESTED:staff,DEPOSIT:200000:REQUESTED:staff', 'fee + deposit, overpayment untouched');
  eq((await call('PATCH', `/rental-money/refund-requests/${overpayment}/pay`, { token: tok.finance, body: { method: 'MOBILE_MONEY', reference: mobileRef() } })).status, 200, 'paid later');
  const again = await call('POST', `/rental-money/rentals/${id}/cancellation-refunds`, { token: tok.cashier2 });
  eq([again.status, again.data?.created?.length], [201, 0], 're-raise creates nothing');
});
let b6;
await check('everything requested, approved and paid → re-raising creates nothing; a later late payment is the only new request', async () => {
  b6 = await booking(50);
  eq((await cancel(b6)).status, 200, 'cancelled');
  const fee = sql(`SELECT id FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${b6}' AND kind = 'CANCELLATION'`);
  eq((await call('PATCH', `/rental-money/refund-requests/${fee}/approve`, { token: tok.approver })).status, 200, 'approved');
  eq((await call('PATCH', `/rental-money/refund-requests/${fee}/pay`, { token: tok.finance, body: { method: 'CASH', sessionId: ids.sessions.finance } })).status, 200, 'paid');
  eq((await call('POST', `/rental-money/rentals/${b6}/cancellation-refunds`, { token: tok.cashier2 })).data?.created?.length, 0, 'nothing new');
  const ref6 = gatewayPayment(b6, 20000);
  eq((await webhook(ref6, 20000, 'evt-' + ref6)).status, 201, 'late payment');
  eq(reqs(b6), 'RENTAL_FEE:100000:PAID:staff,RENTAL_FEE:20000:REQUESTED:SYSTEM:LATE_PAYMENT', 'only the new money');
  eq((await ledger(b6)).held.RENTAL_FEE, 20000, 'held = the late money only');
});

console.log('\n4. independent approval of system-raised requests, payout, shop isolation');
await check('a SYSTEM:LATE_PAYMENT request: the cancelling cashier can\'t approve it (403); an approver approves; the approver can\'t pay it without payments:manage (403); finance pays', async () => {
  const late = sql(`SELECT id FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${b1}' AND "requestedById" = 'SYSTEM:LATE_PAYMENT'`);
  eq((await call('PATCH', `/rental-money/refund-requests/${late}/approve`, { token: tok.cashier })).status, 403, 'cashier');
  eq((await call('PATCH', `/rental-money/refund-requests/${late}/approve`, { token: tok.approver })).status, 200, 'approver');
  eq((await call('PATCH', `/rental-money/refund-requests/${late}/pay`, { token: tok.approver, body: { method: 'CASH', sessionId: ids.sessions.finance } })).status, 403, 'approver pays');
  eq((await call('PATCH', `/rental-money/refund-requests/${late}/pay`, { token: tok.finance, body: { method: 'MOBILE_MONEY', reference: mobileRef() } })).status, 200, 'finance pays');
});
const T2 = uid(), A2email = `${uid()}@example.test`, A2pw = 'OtherShop12345';
sql(`INSERT INTO "Tenant" (id, name, slug, status, "updatedAt") VALUES ('${T2}', 'Other shop E', '${T2}', 'ACTIVE', now())`,
    `INSERT INTO "TenantModule" (id, "tenantId", "moduleCode", "isEnabled") SELECT 'tm' || m || '${T2}', '${T2}', m, true FROM unnest(ARRAY['rentals', 'pos', 'id-verification']) m`,
    `INSERT INTO "AdminUser" (id, "tenantId", email, "passwordHash", "firstName", "lastName", role, "isActive", "updatedAt") VALUES ('${uid()}', '${T2}', '${A2email}', '${bcrypt.hashSync(A2pw, 10)}', 'Other', 'Shop', 'SUPER_ADMIN', true, now())`,
    `INSERT INTO "PaymentMethod" (id, "tenantId", name, code, "isActive", "integrationParams", "updatedAt") VALUES ('${uid()}', '${T2}', 'Mixx (other shop)', 'CLICKPESA_MIXX', true, '{"clientId":"it2","apiKey":"it2","checksumSecret":"other-secret"}', now())`);
await check('shop isolation: another shop\'s SUPER_ADMIN can\'t see, cancel, re-raise, approve or pay this shop\'s bookings / requests (404); its own webhook can\'t settle this shop\'s payment', async () => {
  const t2 = await login(A2email, A2pw, T2);
  const b7 = await booking(60);
  const req1 = sql(`SELECT id FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${b1}' AND component = 'RENTAL_FEE' AND "requestedById" NOT LIKE 'SYSTEM:%'`);
  const r = [
    (await call('GET', `/rental-money/rentals/${b1}/ledger`, { token: t2, tenant: T2 })).status,
    (await call('PATCH', `/rentals/${b7}/status`, { token: t2, tenant: T2, body: { status: 'CANCELLED', cancellationReason: 'SHOP' } })).status,
    (await call('POST', `/rental-money/rentals/${b1}/cancellation-refunds`, { token: t2, tenant: T2 })).status,
    (await call('PATCH', `/rental-money/refund-requests/${req1}/approve`, { token: t2, tenant: T2 })).status,
    (await call('PATCH', `/rental-money/refund-requests/${req1}/pay`, { token: t2, tenant: T2, body: { method: 'CASH' } })).status,
  ];
  eq(r, [404, 404, 404, 404, 404], 'all not found');
  eq(statusOf(b7), 'DOWN_PAYMENT_PAID', 'other shop could not cancel');
  const ref7 = gatewayPayment(b7, 30000);
  eq((await webhook(ref7, 30000, 'evt-' + ref7, { slug: T2, secret: 'other-secret' })).status, 404, 'cross-shop webhook');
  eq(sql(`SELECT status FROM "Payment" WHERE "transactionRef" = '${ref7}'`), 'PENDING', 'not settled');
});
function statusOf(id) { return sql(`SELECT status FROM "RentalOrder" WHERE id = '${id}'`); }

console.log('\n5. idempotency and audit integrity');
await check('every staff cancellation is audited exactly once (UPDATE_STATUS → CANCELLED, actor = the cashier); approvals and payouts are audited with their actor', async () => {
  for (const id of [b1, b6]) eq(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE "entityId" = '${id}' AND action = 'UPDATE_STATUS' AND details::text LIKE '%CANCELLED%'`), '1', `cancel audit ${id}`);
  const fee6 = sql(`SELECT id FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${b6}' AND "requestedById" NOT LIKE 'SYSTEM:%'`);
  const who = (id) => ({ [ids.admins.cashier.id]: 'cashier', [ids.admins.approver.id]: 'approver', [ids.admins.finance.id]: 'finance' }[id] ?? id);
  const trail = sql(`SELECT string_agg(action || '>' || "adminUserId", ',' ORDER BY "createdAt") FROM "AdminActivityLog" WHERE "entityId" = '${fee6}'`).split(',').map((x) => { const [a, u] = x.split('>'); return `${a}>${who(u)}`; });
  eq(trail, ['REFUND_REQUESTED>cashier', 'REFUND_APPROVED>approver', 'REFUND_PAID>finance'], 'request / decision / payout audit');
});
await check('every request records who asked (staff id or SYSTEM:*), why, and when; system requests name their source', async () => {
  eq(sql(`SELECT count(*) FROM "RentalRefundRequest" WHERE "tenantId" = '${T}' AND kind = 'CANCELLATION' AND ("requestedById" IS NULL OR length(reason) < 20 OR "createdAt" IS NULL)`), '0', 'complete rows');
  eq(sql(`SELECT count(*) FROM "RentalRefundRequest" WHERE "tenantId" = '${T}' AND "requestedById" LIKE 'SYSTEM:%' AND "requestedById" NOT IN ('SYSTEM:LATE_PAYMENT', 'SYSTEM:HOLD_EXPIRY')`), '0', 'known sources');
});
await check('ledger invariant over EVERY cancelled booking of the shop: the money received equals the refunds asked for (open or paid, any kind, incl. overpayments) — nothing left unrequested, nothing requested twice', async () => {
  const bad = sql(`WITH c AS (SELECT id FROM "RentalOrder" WHERE "tenantId" = '${T}' AND status = 'CANCELLED'),
    got AS (SELECT "rentalOrderId" id, sum(amount) AS rec FROM "Payment" WHERE status = 'COMPLETED' AND "rentalOrderId" IN (SELECT id FROM c) GROUP BY 1),
    asked AS (SELECT "rentalOrderId" id, sum(amount + "retainedAmount") AS req FROM "RentalRefundRequest" WHERE status NOT IN ('REJECTED', 'FAILED') AND "rentalOrderId" IN (SELECT id FROM c) GROUP BY 1)
    SELECT coalesce(string_agg(c.id || ' received ' || COALESCE(got.rec, 0) || ' asked ' || COALESCE(asked.req, 0), '; '), '') FROM c LEFT JOIN got USING (id) LEFT JOIN asked USING (id)
     WHERE COALESCE(got.rec, 0) <> COALESCE(asked.req, 0)`);
  eq(bad, '', 'mismatches');
  return `${sql(`SELECT count(*) FROM "RentalOrder" WHERE "tenantId" = '${T}' AND status = 'CANCELLED'`)} cancelled bookings checked`;
});

const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
