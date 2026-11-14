// Round 25F: integrated R1 refund accounting (#37 merged under the
// cancellation workflow #36) under CONCURRENCY — real API + real Postgres.
// Every payment arrives through the REAL signed ClickPesa webhook path
// (PaymentSettlementService: CAS status write, rental roll-up, late-payment
// hook under payment:rental -> refund:rental). Races are run with Promise.all;
// where a race needs a window, a separate psql session holds a row lock
// (< 4 s, below Prisma's 5 s interactive-transaction timeout).
// Covers what cancellation-e / r1-refund-accounting / refunds do NOT: parallel
// callbacks for different / same payments, parallel late payments on a
// cancelled booking, concurrent surplus claims, fail -> re-request -> pay
// chains, parallel payouts of one approved request, and a ledger invariant.
// Isolated schema only (seeded by pos-rental-seed.js). Never production.
//   PSQL=<psql> [PGPORT=..] IT_API=.. IT_SCHEMA=it_r1i node r1-integration.it.mjs <worktree> <pos-ids.json>
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
if (!/^it_[a-z0-9_]+$/.test(SCHEMA)) throw new Error('refusing: isolated it_* schema only');
const T = ids.tenantId, G = ids.gown;
const PSQL_ARGS = ['-U', 'naro_admin', '-h', HOST, '-d', 'naro_fashion', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
const ENV = { ...process.env, PGPASSWORD: 'Admin123' };
const sql = (...q) => execFileSync(PSQL, [...PSQL_ARGS, '-c', `SET search_path TO ${SCHEMA}`, ...q.flatMap((c) => ['-c', c])], { env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\r/g, '').trim();
const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (email, password) => { const r = await call('POST', '/auth/login', { body: { email, password } }); assert(r.data?.accessToken, `login ${email} ${r.status}`); return r.data.accessToken; };

// A SECOND payer (same "IT Finance" role as the seeded finance admin), so two
// different people can try to pay the same approved request at once.
const F2 = { id: uid(), email: `it-r1i-finance2-${randomBytes(3).toString('hex')}@example.test`, password: 'ItTest12345' };
sql(`INSERT INTO "AdminUser" (id, "tenantId", email, "passwordHash", "firstName", "lastName", role, "isActive", "updatedAt") VALUES ('${F2.id}', '${T}', '${F2.email}', '${bcrypt.hashSync(F2.password, 10)}', 'POS', 'finance2', 'STAFF', true, now())`,
    `INSERT INTO "AdminUserRole" ("adminUserId", "roleId") SELECT '${F2.id}', id FROM "Role" WHERE "tenantId" = '${T}' AND name = 'IT Finance'`);
const tok = {};
for (const k of ['cashier', 'cashier2', 'reviewer', 'approver', 'finance']) tok[k] = await login(ids.admins[k].email, ids.admins[k].password);
tok.finance2 = await login(F2.email, F2.password);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// ClickPesa for this shop (test credentials) + its signed webhook.
const SLUG = sql(`SELECT slug FROM "Tenant" WHERE id = '${T}'`);
const SECRET = 'it-r1i-checksum-' + randomBytes(6).toString('hex');
sql(`DELETE FROM "PaymentMethod" WHERE "tenantId" = '${T}' AND code = 'CLICKPESA_MIXX'`,
    `INSERT INTO "PaymentMethod" (id, "tenantId", name, code, "isActive", "integrationParams", "updatedAt") VALUES ('${uid()}', '${T}', 'Mixx by Yas (test)', 'CLICKPESA_MIXX', true, '{"clientId":"it","apiKey":"it","checksumSecret":"${SECRET}"}', now())`);
const canon = (v) => (v === null || typeof v !== 'object') ? v : Array.isArray(v) ? v.map(canon)
  : Object.fromEntries(Object.keys(v).filter((k) => k !== 'checksum' && k !== 'checksumMethod').sort().map((k) => [k, canon(v[k])]));
async function webhook(ref, amount, eventId = 'evt-' + ref + '-' + randomBytes(3).toString('hex')) {
  const payload = { event: 'PAYMENT RECEIVED', data: { id: eventId, orderReference: ref, status: 'SUCCESS', collectedAmount: amount } };
  payload.checksum = createHmac('sha256', SECRET).update(JSON.stringify(canon(payload)), 'utf8').digest('hex');
  return call('POST', `/payments/webhook/clickpesa/${SLUG}`, { raw: JSON.stringify(payload), tenant: null });
}
function gatewayPayment(rentalId, amount) {   // what PaymentsService.initiate writes (PENDING, no component = unallocated)
  const ref = 'ITRI' + randomBytes(6).toString('hex').toUpperCase();
  sql(`INSERT INTO "Payment" (id, "tenantId", "rentalOrderId", amount, method, status, "providerCode", "transactionRef", "createdAt", "updatedAt") VALUES ('${uid()}', '${T}', '${rentalId}', ${amount}, 'MOBILE_MONEY', 'PENDING', 'CLICKPESA_MIXX', '${ref}', (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))`);
  return ref;
}
const BASE = 30 + Number(sql(`SELECT COALESCE(max("returnDate")::date - current_date, 0) FROM "RentalOrder" WHERE "tenantId" = '${T}'`));
let seq = 0, slot = 0;
const touched = [];
/** A walk-in booking for the gown (fee 400,000, deposit 200,000, down payment 100,000), ID verified in person. */
async function booking(pay = []) {
  const start = 10 * slot++;
  const c = (await call('POST', '/pos-rentals/customers', { token: tok.cashier, body: { firstName: 'R1I', lastName: `C${++seq}`, phone: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } })).data;
  const b = await call('POST', '/pos-rentals', { token: tok.cashier, body: { customerId: c.id, productId: G.id, variantId: G.M, startDate: day(BASE + start), returnDate: day(BASE + start + 2), pickupDate: day(BASE + start), termsAccepted: true } });
  assert(b.status === 201, `book ${b.status} ${JSON.stringify(b.data).slice(0, 160)}`);
  const idr = await call('POST', `/pos-rentals/${b.data.id}/id-in-person`, { token: tok.reviewer, body: { idType: 'NATIONAL_ID', idNumber: `1996${String(seq).padStart(4, '0')}-12345` } });
  assert(idr.status < 300, `id ${idr.status}`);
  for (const [component, amount] of pay) {
    const p = await call('POST', `/pos-rentals/${b.data.id}/payments`, { token: tok.cashier, body: { component, sessionId: ids.sessions.cashier, tenders: [{ method: 'CASH', amount }] } });
    assert(p.status === 201, `pay ${component} ${p.status}`);
  }
  touched.push(b.data.id);
  return b.data.id;
}
const cancel = (id, token = tok.cashier) => call('PATCH', `/rentals/${id}/status`, { token, body: { status: 'CANCELLED', cancellationReason: 'CUSTOMER_REQUEST', cancellationNote: 'r1-integration test' } });
const statusOf = (id) => sql(`SELECT status FROM "RentalOrder" WHERE id = '${id}'`);
const state = (id) => sql(`SELECT status || '|' || COALESCE("holdState", '-') FROM "RentalOrder" WHERE id = '${id}'`);
const received = (id) => Number(sql(`SELECT COALESCE(sum(amount), 0)::int FROM "Payment" WHERE "rentalOrderId" = '${id}' AND status = 'COMPLETED'`));
const refundedSum = (id) => Number(sql(`SELECT COALESCE(sum(amount), 0)::int FROM "Payment" WHERE "rentalOrderId" = '${id}' AND status = 'REFUNDED'`));
const asked = (id, extra = '') => Number(sql(`SELECT COALESCE(sum(amount + "retainedAmount"), 0)::int FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${id}' AND status NOT IN ('REJECTED', 'FAILED') ${extra}`));
const reqs = (id, extra = '') => sql(`SELECT coalesce(string_agg(kind || ':' || COALESCE(component, 'NONE') || ':' || amount::int || ':' || status, ',' ORDER BY kind, component NULLS LAST, amount), '') FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${id}' ${extra}`);
const ledger = async (id) => (await call('GET', `/rental-money/rentals/${id}/ledger`, { token: tok.finance })).data;
const request = (id, body, token = tok.cashier) => call('POST', `/rental-money/rentals/${id}/refund-requests`, { token, body });
const approve = (rid) => call('PATCH', `/rental-money/refund-requests/${rid}/approve`, { token: tok.approver });
const mref = () => 'MPRI' + randomBytes(5).toString('hex').toUpperCase();
const payOut = (rid, token = tok.finance, reference = mref()) => call('PATCH', `/rental-money/refund-requests/${rid}/pay`, { token, body: { method: 'MOBILE_MONEY', reference } });
const failOut = (rid) => call('PATCH', `/rental-money/refund-requests/${rid}/fail`, { token: tok.finance, body: { reason: 'mobile-money payout bounced (test)' } });
const reRaise = (id, token = tok.cashier2) => call('POST', `/rental-money/rentals/${id}/cancellation-refunds`, { token });
const statuses = (rs) => rs.map((r) => r.status).sort();
/** Hold a row lock on the booking from a separate session for `ms` (< 4 s). */
function holdBookingRow(id, ms = 3000) {
  const p = spawn(PSQL, [...PSQL_ARGS, '-c', `SET search_path TO ${SCHEMA}`, '-c', 'BEGIN', '-c', `SELECT 1 FROM "RentalOrder" WHERE id = '${id}' FOR UPDATE`, '-c', `SELECT pg_sleep(${ms / 1000})`, '-c', 'COMMIT'], { env: ENV });
  return new Promise((r) => p.on('exit', r));
}

console.log(`real API ${API} · isolated schema ${SCHEMA} · R1 integrated refund accounting under concurrency, real ClickPesa webhook path`);

console.log('\n1. two DIFFERENT payments for the same booking confirmed concurrently');
await check('4 bookings × 2 different payments (down payment 100,000 + balance and deposit 500,000), all 8 signed callbacks at once → each credited once; every booking FULLY_PAID; ledger fee 400,000 + deposit 200,000, nothing overpaid', async () => {
  const bs = [];
  for (let i = 0; i < 4; i++) { const id = await booking(); bs.push({ id, a: gatewayPayment(id, 100000), b: gatewayPayment(id, 500000) }); }
  const rs = await Promise.all(bs.flatMap((x) => [webhook(x.a, 100000), webhook(x.b, 500000)]));
  eq([...new Set(statuses(rs))], [201], 'all callbacks accepted');
  for (const x of bs) {
    eq([received(x.id), sql(`SELECT count(*) FROM "Payment" WHERE "rentalOrderId" = '${x.id}' AND status = 'COMPLETED'`)], [600000, '2'], `credited once ${x.id}`);
    eq(statusOf(x.id), 'FULLY_PAID', `roll-up ${x.id}`);
    const l = await ledger(x.id);
    eq([l.collected.RENTAL_FEE, l.collected.DEPOSIT, l.overpaid, l.totalHeld], [400000, 200000, 0, 600000], `ledger ${x.id}`);
  }
});
await check('forced window: the down-payment callback has computed its roll-up and is waiting to write it when the balance callback arrives (booking row held 3 s by another session) → both credited once AND the booking ends FULLY_PAID (the later, complete roll-up is not lost)', async () => {
  const id = await booking();
  const a = gatewayPayment(id, 100000), b = gatewayPayment(id, 300000);
  const held = holdBookingRow(id, 3000);
  await sleep(600);
  const wa = webhook(a, 100000);                 // reads ID_VERIFIED + 100,000 → DOWN_PAYMENT_PAID, blocks on the write
  await sleep(1200);
  const wb = webhook(b, 300000);                 // reads ID_VERIFIED + 400,000 → FULLY_PAID, blocks behind A
  const [ra, rb] = await Promise.all([wa, wb, held]);
  eq([ra.status, rb.status], [201, 201], 'both accepted');
  eq(received(id), 400000, 'credited once each');
  const l = await ledger(id);
  eq([l.collected.RENTAL_FEE, l.feeFullyPaid], [400000, true], 'ledger: fee fully paid');
  eq(statusOf(id), 'FULLY_PAID', 'roll-up status after both callbacks');
});

console.log('\n2. the SAME payment confirmed concurrently by N callbacks');
await check('one payment, 8 parallel callbacks with 6 different event ids (+2 exact duplicates) → exactly one COMPLETED transition, 100,000 credited once, DOWN_PAYMENT_PAID; one webhook event row per distinct id', async () => {
  const id = await booking();
  const ref = gatewayPayment(id, 100000);
  const evs = Array.from({ length: 6 }, (_, i) => `evt-${ref}-n${i}`);
  const rs = await Promise.all([...evs, evs[0], evs[1]].map((e) => webhook(ref, 100000, e)));
  eq([...new Set(statuses(rs))], [201], `all acked ${statuses(rs)}`);
  assert(rs.filter((r) => r.data?.duplicate).length === 2, `2 duplicates acked: ${rs.filter((r) => r.data?.duplicate).length}`);
  eq([received(id), sql(`SELECT count(*) FROM "Payment" WHERE "rentalOrderId" = '${id}'`)], [100000, '1'], 'one payment, one credit');
  eq(sql(`SELECT count(*) FROM "WebhookEvent" WHERE "orderReference" = '${ref}'`), '6', 'event rows');
  eq(statusOf(id), 'DOWN_PAYMENT_PAID', 'roll-up');
  eq((await ledger(id)).collected.RENTAL_FEE, 100000, 'ledger not doubled');
});
await check('the same payment confirmed by parallel callbacks AFTER the booking was cancelled → credited once, ONE late refund request of exactly that amount', async () => {
  const id = await booking();
  const ref = gatewayPayment(id, 70000);
  eq((await cancel(id)).status, 200, 'cancelled');
  const rs = await Promise.all(Array.from({ length: 5 }, (_, i) => webhook(ref, 70000, `evt-${ref}-c${i}`)));
  eq([...new Set(statuses(rs))], [201], 'acked');
  eq(received(id), 70000, 'credited once');
  eq(reqs(id), 'CANCELLATION:RENTAL_FEE:70000:REQUESTED', 'one late request');
  eq(state(id), 'CANCELLED|REFUND_DUE', 'flag');
});

console.log('\n3. late payments on a CANCELLED booking delivered concurrently');
await check('2 different late payments (30,000 + 50,000), each delivered twice with new event ids and once more as an exact duplicate, all at once → 80,000 credited once; the SYSTEM:LATE_PAYMENT requests total exactly 80,000 with no overlap; REFUND_DUE set', async () => {
  const id = await booking();
  const a = gatewayPayment(id, 30000), b = gatewayPayment(id, 50000);
  eq((await cancel(id)).status, 200, 'cancelled');
  eq(reqs(id), '', 'nothing requested at cancellation');
  assert(state(id) !== 'CANCELLED|REFUND_DUE', `nothing held at cancellation: ${state(id)}`);
  const rs = await Promise.all([
    webhook(a, 30000, `evt-${a}-1`), webhook(a, 30000, `evt-${a}-2`), webhook(a, 30000, `evt-${a}-1`),
    webhook(b, 50000, `evt-${b}-1`), webhook(b, 50000, `evt-${b}-2`), webhook(b, 50000, `evt-${b}-1`),
  ]);
  eq([...new Set(statuses(rs))], [201], 'acked');
  eq(received(id), 80000, 'received');
  const rows = lines(sql(`SELECT amount::int || ':' || "requestedById" || ':' || status FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${id}' ORDER BY amount`));
  assert(rows.every((r) => r.endsWith(':SYSTEM:LATE_PAYMENT:REQUESTED')), `all system late requests: ${rows}`);
  const amounts = rows.map((r) => Number(r.split(':')[0]));
  assert(JSON.stringify(amounts) === '[30000,50000]' || JSON.stringify(amounts) === '[80000]', `one request per payment (or one for both, when one settlement saw both): ${amounts}`);
  eq(asked(id), 80000, 'requested exactly once');
  eq(sql(`SELECT status || '|' || COALESCE("holdState", '-') || '|' || COALESCE("holdExpiresAt"::text, 'null') FROM "RentalOrder" WHERE id = '${id}'`), 'CANCELLED|REFUND_DUE|null', 'flag');
  return `requests ${amounts.join(' + ')}`;
});
await check('a late payment confirming while two staff re-raise the cancellation refunds at the same moment → the late money is requested exactly once (no duplicate from the re-raise path, which only takes refund:rental)', async () => {
  const id = await booking([['RENTAL_FEE', 100000]]);
  const ref = gatewayPayment(id, 40000);
  eq((await cancel(id)).status, 200, 'cancelled');
  eq(asked(id), 100000, 'cancellation requested the cash');
  const rs = await Promise.all([webhook(ref, 40000, `evt-${ref}-1`), reRaise(id, tok.cashier), reRaise(id, tok.cashier2), webhook(ref, 40000, `evt-${ref}-2`)]);
  eq([rs[0].status, rs[3].status], [201, 201], 'callbacks acked');
  eq([rs[1].status, rs[2].status], [201, 201], 're-raises answered');
  eq([received(id), asked(id)], [140000, 140000], `requested once (${reqs(id)})`);
  eq(state(id), 'CANCELLED|REFUND_DUE', 'flag');
});

console.log('\n4. concurrent claims on the same surplus');
async function overpaid(cash = 100000, mobile = 600000) {   // fee 400,000 + deposit 200,000 due; the rest is surplus
  const id = await booking([['RENTAL_FEE', cash]]);
  eq((await webhook(gatewayPayment(id, mobile), mobile)).status, 201, 'mobile money');
  eq((await ledger(id)).overpaid, cash + mobile - 600000, 'surplus');
  return id;
}
const opBody = (amount, why) => ({ kind: 'OVERPAYMENT', component: 'RENTAL_FEE', amount, reason: `customer overpaid; refund of the surplus (${why})` });
await check('two staff request the WHOLE 100,000 surplus at the same moment → exactly one accepted (201), the other refused (400); the surplus is claimed once', async () => {
  const id = await overpaid();
  const rs = await Promise.all([request(id, opBody(100000, 'cashier'), tok.cashier), request(id, opBody(100000, 'cashier2'), tok.cashier2)]);
  eq(statuses(rs), [201, 400], `statuses ${JSON.stringify(rs.map((r) => r.data?.message ?? r.status)).slice(0, 200)}`);
  eq(asked(id), 100000, 'claimed once');
});
await check('three requests of 60,000 against a 100,000 surplus at once → exactly one accepted; the remaining 40,000 is still claimable, 1 more is not', async () => {
  const id = await overpaid();
  const rs = await Promise.all([1, 2, 3].map((i) => request(id, opBody(60000, `#${i}`), i === 2 ? tok.cashier2 : tok.cashier)));
  eq(statuses(rs), [201, 400, 400], 'one accepted');
  eq((await request(id, opBody(40000, 'rest'))).status, 201, 'rest claimable');
  eq((await request(id, opBody(1, 'one too many'))).status, 400, 'nothing beyond the surplus');
  eq(asked(id), 100000, 'total claimed = surplus');
});
await check('a surplus refund request racing the cancellation of the same booking → the surplus is claimed exactly once in total (by the request or by the cancellation, never both); everything received is requested', async () => {
  const id = await overpaid();
  const [c, r] = await Promise.all([cancel(id), request(id, opBody(100000, 'during cancellation'), tok.cashier2)]);
  eq(c.status, 200, 'cancelled');
  assert([201, 400].includes(r.status), `request ${r.status}`);
  eq(asked(id, `AND (kind = 'OVERPAYMENT' OR component IS NULL)`), 100000, `surplus claims (${reqs(id)})`);
  eq([asked(id), received(id)], [700000, 700000], 'everything requested once');
  return r.status === 201 ? 'the staff request won' : 'the cancellation won';
});

console.log('\n5. partially completed refunds, then the cancellation');
let P, feeReq;
await check('surplus 200,000: A 50,000 PAID; B 50,000 paid → FAILED (row REVERSED, no REFUNDED row) → re-requested as B2 → PAID with exactly one REFUNDED row; C 60,000 APPROVED-unpaid → cancelling requests the full fee + deposit + only the 40,000 of surplus not already requested', async () => {
  P = await overpaid(100000, 700000);
  const one = async (amount, why) => { const r = await request(P, opBody(amount, why)); eq(r.status, 201, `request ${why}`); eq((await approve(r.data.id)).status, 200, `approve ${why}`); return r.data.id; };
  const A = await one(50000, 'A');
  eq((await payOut(A)).status, 200, 'A paid');
  const B = await one(50000, 'B');
  eq((await payOut(B)).status, 200, 'B paid');
  eq((await failOut(B)).status, 200, 'B failed');
  eq(sql(`SELECT string_agg(status, ',') FROM "Payment" WHERE "refundRequestId" = '${B}'`), 'REVERSED', 'B leaves no REFUNDED row');
  eq((await ledger(P)).overpaid, 150000, 'B money owed again');
  const B2 = await one(50000, 'B2 retry of B');
  eq((await payOut(B2)).status, 200, 'B2 paid');
  eq(sql(`SELECT count(*) FROM "Payment" WHERE "refundRequestId" = '${B2}' AND status = 'REFUNDED'`), '1', 'retry wrote exactly one REFUNDED row');
  const C = await one(60000, 'C');
  eq((await cancel(P)).status, 200, 'cancelled');
  eq(reqs(P, `AND kind = 'CANCELLATION'`), 'CANCELLATION:DEPOSIT:200000:REQUESTED,CANCELLATION:RENTAL_FEE:400000:REQUESTED,CANCELLATION:NONE:40000:REQUESTED', 'cancellation requests');
  eq([asked(P), received(P)], [800000, 800000], 'nothing requested twice, nothing left out');
  eq((await payOut(C)).status, 200, 'C paid after the cancellation');
  eq((await reRaise(P)).data?.created?.length, 0, 're-raise creates nothing');
  eq([refundedSum(P), (await ledger(P)).overpaid], [160000, 40000], 'refunded A + B2 + C; 40,000 surplus still held (requested)');
  feeReq = sql(`SELECT id FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${P}' AND kind = 'CANCELLATION' AND component = 'RENTAL_FEE'`);
});
await check('the cancellation fee refund paid → FAILED → three re-raises at the same moment → exactly ONE new 400,000 request; it pays with exactly one REFUNDED row; the failed one keeps none', async () => {
  eq((await approve(feeReq)).status, 200, 'approve');
  eq((await payOut(feeReq)).status, 200, 'paid');
  eq((await failOut(feeReq)).status, 200, 'failed');
  eq(state(P), 'CANCELLED|REFUND_DUE', 'liability');
  const rs = await Promise.all([reRaise(P, tok.cashier), reRaise(P, tok.cashier2), reRaise(P, tok.cashier)]);
  eq(statuses(rs), [201, 201, 201], 'answered');
  eq(rs.map((r) => r.data?.created?.length ?? -1).sort(), [0, 0, 1], 'one re-raise created it');
  const fresh = sql(`SELECT id FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${P}' AND kind = 'CANCELLATION' AND component = 'RENTAL_FEE' AND status = 'REQUESTED'`);
  eq(sql(`SELECT amount::int FROM "RentalRefundRequest" WHERE id = '${fresh}'`), '400000', 'full fee re-requested');
  eq((await approve(fresh)).status, 200, 'approve');
  eq((await payOut(fresh)).status, 200, 'paid');
  eq(sql(`SELECT count(*) FROM "Payment" WHERE "refundRequestId" = '${fresh}' AND status = 'REFUNDED'`), '1', 'one REFUNDED row');
  eq(sql(`SELECT count(*) FROM "Payment" WHERE "refundRequestId" = '${feeReq}' AND status = 'REFUNDED'`), '0', 'failed request: none');
  eq([asked(P), received(P)], [800000, 800000], 'still exactly the money received');
});

console.log('\n6. two parallel payouts of the same APPROVED request');
await check('deposit refund 200,000 APPROVED; finance (rental-money route), finance2 (generic /refund-requests route) and a finance double-click with the SAME reference all pay at once → exactly one 200, the rest 409; exactly one REFUNDED row', async () => {
  const dep = sql(`SELECT id FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${P}' AND kind = 'CANCELLATION' AND component = 'DEPOSIT'`);
  eq((await approve(dep)).status, 200, 'approve');
  const same = mref();
  const rs = await Promise.all([
    payOut(dep, tok.finance, same),
    call('PATCH', `/refund-requests/${dep}/pay`, { token: tok.finance2, body: { method: 'MOBILE_MONEY', reference: mref() } }),
    payOut(dep, tok.finance, same),
    payOut(dep, tok.finance2),
  ]);
  eq(statuses(rs), [200, 409, 409, 409], `statuses ${rs.map((r) => r.status)}`);
  eq(sql(`SELECT count(*) FROM "Payment" WHERE "refundRequestId" = '${dep}' AND status = 'REFUNDED'`), '1', 'one payout row');
  eq(sql(`SELECT status FROM "RentalRefundRequest" WHERE id = '${dep}'`), 'PAID', 'request PAID');
  const winner = rs.findIndex((r) => r.status === 200);
  const payer = sql(`SELECT "paidById" FROM "RentalRefundRequest" WHERE id = '${dep}'`);
  eq(payer, [1, 3].includes(winner) ? F2.id : ids.admins.finance.id, 'paidBy = the payer whose call succeeded');
  return `winner: call #${winner + 1}`;
});
await check('a payout racing a rejection of the same APPROVED request → exactly one wins; paid ⇔ exactly one REFUNDED row, rejected ⇔ none', async () => {
  const sur = sql(`SELECT id FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${P}' AND kind = 'CANCELLATION' AND component IS NULL`);
  eq((await approve(sur)).status, 200, 'approve');
  const [p, j] = await Promise.all([payOut(sur, tok.finance2), call('PATCH', `/rental-money/refund-requests/${sur}/reject`, { token: tok.approver, body: { reason: 'race test' } })]);
  eq(statuses([p, j]), [200, 409], `pay ${p.status} / reject ${j.status}`);
  const st = sql(`SELECT status FROM "RentalRefundRequest" WHERE id = '${sur}'`);
  const rows = sql(`SELECT count(*) FROM "Payment" WHERE "refundRequestId" = '${sur}' AND status = 'REFUNDED'`);
  eq([st, rows], p.status === 200 ? ['PAID', '1'] : ['REJECTED', '0'], 'consistent');
  if (st === 'REJECTED') { eq((await reRaise(P)).data?.created?.length, 1, 'rejected surplus re-requested'); }
  return p.status === 200 ? 'payout won' : 'rejection won';
});
await check('everything paid back → the cancelled booking is REFUND_SETTLED, nothing held', async () => {
  const open = lines(sql(`SELECT id || ':' || status FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${P}' AND status IN ('REQUESTED', 'APPROVED')`));
  for (const x of open) { const [rid, st] = x.split(':'); if (st === 'REQUESTED') eq((await approve(rid)).status, 200, 'approve'); eq((await payOut(rid)).status, 200, 'pay'); }
  const l = await ledger(P);
  eq([l.totalHeld, state(P)], [0, 'CANCELLED|REFUND_SETTLED'], 'settled');
});

console.log('\n7. ledger invariant over every booking this suite touched');
await check('per booking: Σ COMPLETED − Σ REFUNDED = ledger held; Σ open+paid requests ≤ received (= received when cancelled); every REFUNDED row ↔ exactly one PAID request of the same amount; holdState REFUND_DUE ⇔ cancelled and money held', async () => {
  const list = touched.map((x) => `'${x}'`).join(',');
  for (const id of touched) {
    const l = await ledger(id);
    eq(Math.round(l.totalHeld * 100), (received(id) - refundedSum(id)) * 100, `held ${id}`);
  }
  eq(sql(`SELECT count(*) FROM (SELECT o.id, o.status,
        (SELECT COALESCE(sum(amount), 0) FROM "Payment" p WHERE p."rentalOrderId" = o.id AND p.status = 'COMPLETED') AS rec,
        (SELECT COALESCE(sum(amount + "retainedAmount"), 0) FROM "RentalRefundRequest" r WHERE r."rentalOrderId" = o.id AND r.status NOT IN ('REJECTED', 'FAILED')) AS req
      FROM "RentalOrder" o WHERE o.id IN (${list})) x WHERE x.req > x.rec OR (x.status = 'CANCELLED' AND x.req <> x.rec)`), '0', 'requests vs money received');
  eq(sql(`SELECT count(*) FROM "Payment" p WHERE p."rentalOrderId" IN (${list}) AND p.status = 'REFUNDED' AND NOT EXISTS (SELECT 1 FROM "RentalRefundRequest" r WHERE r.id = p."refundRequestId" AND r.status = 'PAID' AND r.amount = p.amount)`), '0', 'REFUNDED rows without a PAID request');
  eq(sql(`SELECT count(*) FROM "RentalRefundRequest" r WHERE r."rentalOrderId" IN (${list}) AND r.status = 'PAID' AND r.amount > 0 AND (SELECT count(*) FROM "Payment" p WHERE p."refundRequestId" = r.id AND p.status = 'REFUNDED') <> 1`), '0', 'PAID requests without exactly one REFUNDED row');
  eq(sql(`SELECT count(*) FROM "RentalRefundRequest" r WHERE r."rentalOrderId" IN (${list}) AND r.status <> 'PAID' AND EXISTS (SELECT 1 FROM "Payment" p WHERE p."refundRequestId" = r.id AND p.status = 'REFUNDED')`), '0', 'REFUNDED rows on unpaid / failed requests');
  const bad = sql(`SELECT coalesce(string_agg(o.id || ' ' || o.status || '/' || COALESCE(o."holdState", '-'), '; '), '') FROM "RentalOrder" o WHERE o.id IN (${list}) AND
      ((o.status = 'CANCELLED' AND (SELECT COALESCE(sum(amount) FILTER (WHERE status = 'COMPLETED'), 0) - COALESCE(sum(amount) FILTER (WHERE status = 'REFUNDED'), 0) FROM "Payment" p WHERE p."rentalOrderId" = o.id) > 0)
        <> (COALESCE(o."holdState", '') = 'REFUND_DUE'))`);
  eq(bad, '', 'REFUND_DUE iff a cancelled booking holds money');
  return `${touched.length} bookings reconciled`;
});

const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
