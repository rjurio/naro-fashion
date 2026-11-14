// Real API + real Postgres: rental cancellation workflow (round 25C F) —
// full refund before collection, no forfeiture, separate cancellation and
// refund, idempotent, race-safe, PR #16 hold rules. Local API (:4130) on the
// isolated schema it_pos seeded by pos-rental-seed.js. Never production.
//   node cancellation.it.mjs <worktree> <pos-ids.json>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const WT = process.argv[2];
const ids = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const API = 'http://localhost:4130/api/v1';
const T = ids.tenantId;
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe';
const sql = (q) => execFileSync(PSQL, ['-U', 'naro_admin', '-h', 'localhost', '-d', 'naro_fashion', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO it_pos; ${q}`], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8' }).trim();
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
for (const k of ['super', 'cashier', 'cashier2', 'reviewer', 'approver', 'finance']) tok[k] = await login(ids.admins[k]);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const G = ids.gown, B = ids.bouquet;
const reqs = (id) => sql(`SELECT coalesce(string_agg(component || ':' || amount::int || ':' || status || ':' || "requestedById", ',' ORDER BY "createdAt", component), '') FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${id}' AND kind = 'CANCELLATION'`);
const cashierId = ids.admins.cashier.id;

let seq = 0;
async function booking(productId, variantId, start, { approveId = true, pay = [] } = {}) {
  const c = (await call('POST', '/pos-rentals/customers', { token: tok.cashier, body: { firstName: 'Cancel', lastName: `C${++seq}`, phone: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } })).data;
  const b = await call('POST', '/pos-rentals', { token: tok.cashier, body: { customerId: c.id, productId, variantId, startDate: day(start), returnDate: day(start + 2), pickupDate: day(start), termsAccepted: true } });
  assert(b.status === 201, `book ${b.status} ${JSON.stringify(b.data).slice(0, 120)}`);
  if (approveId) await call('POST', `/pos-rentals/${b.data.id}/id-in-person`, { token: tok.reviewer, body: { idType: 'NATIONAL_ID', idNumber: `1993${String(seq).padStart(4, '0')}-12345` } });
  for (const [component, amount] of pay) {
    const p = await call('POST', `/pos-rentals/${b.data.id}/payments`, { token: tok.cashier, body: { component, sessionId: ids.sessions.cashier, tenders: [{ method: 'CASH', amount }] } });
    assert(p.status === 201, `pay ${component} ${p.status}`);
  }
  return b.data.id;
}
const cancel = (id, body, token = tok.cashier) => call('PATCH', `/rentals/${id}/status`, { token, body: { status: 'CANCELLED', ...body } });

console.log(`real API ${API} · isolated schema it_pos · cancellation workflow`);

let b1;
await check('cancel before collection with a structured reason: booking CANCELLED with reason / note / who / when; REFUND_DUE flag kept; an invalid reason is refused (400)', async () => {
  b1 = await booking(G.id, G.M, 300, { pay: [['RENTAL_FEE', 100000], ['DEPOSIT', 200000]] });
  eq((await cancel(b1, { cancellationReason: 'BECAUSE' })).status, 400, 'invalid reason');
  const r = await cancel(b1, { cancellationReason: 'CUSTOMER_REQUEST', cancellationNote: 'Wedding postponed to next year' });
  eq(r.status, 200, 'cancelled');
  eq(sql(`SELECT status || '|' || "cancellationReason" || '|' || "cancellationNote" || '|' || "cancelledById" || '|' || ("cancelledAt" IS NOT NULL) || '|' || "holdState" FROM "RentalOrder" WHERE id = '${b1}'`),
    `CANCELLED|CUSTOMER_REQUEST|Wedding postponed to next year|${cashierId}|true|REFUND_DUE`, 'recorded');
});
await check('the cancellation raised FULL refund REQUESTS for everything received (fee 100,000 + deposit 200,000) — nothing kept, nothing paid yet', async () => {
  eq(reqs(b1), `RENTAL_FEE:100000:REQUESTED:${cashierId},DEPOSIT:200000:REQUESTED:${cashierId}`, 'requests');
  eq(sql(`SELECT count(*) FROM "Payment" WHERE "rentalOrderId" = '${b1}' AND status = 'REFUNDED'`), '0', 'no money moved');
  eq(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action = 'REFUND_REQUESTED' AND details->>'rentalOrderId' = '${b1}'`), '2', 'audited');
});
await check('idempotent: re-raising (POST /rental-money/rentals/:id/cancellation-refunds) creates nothing new', async () => {
  const r = await call('POST', `/rental-money/rentals/${b1}/cancellation-refunds`, { token: tok.cashier });
  eq([r.status, r.data?.created?.length], [201, 0], 're-raise');
});
await check('independent approval and payout: the cancelling cashier can\'t approve (403); an approver approves; finance pays the fee in cash; the deposit is still owed', async () => {
  const fee = sql(`SELECT id FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${b1}' AND component = 'RENTAL_FEE'`);
  eq((await call('PATCH', `/rental-money/refund-requests/${fee}/approve`, { token: tok.cashier })).status, 403, 'requester');
  eq((await call('PATCH', `/rental-money/refund-requests/${fee}/approve`, { token: tok.approver })).status, 200, 'approved');
  const p = await call('PATCH', `/rental-money/refund-requests/${fee}/pay`, { token: tok.finance, body: { method: 'CASH', sessionId: ids.sessions.finance } });
  eq([p.status, p.data?.status], [200, 'PAID'], 'paid');
  const l = (await call('GET', `/rental-money/rentals/${b1}/ledger`, { token: tok.finance })).data;
  eq([l.held.RENTAL_FEE, l.held.DEPOSIT], [0, 200000], 'held');
});
await check('a FAILED payout makes the money owed again; re-raising requests it once (no duplicate on a second re-raise)', async () => {
  const fee = sql(`SELECT id FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${b1}' AND component = 'RENTAL_FEE' AND status = 'PAID'`);
  eq((await call('PATCH', `/rental-money/refund-requests/${fee}/fail`, { token: tok.finance, body: { reason: 'cash envelope returned, customer travelling' } })).status, 200, 'failed');
  const a = await call('POST', `/rental-money/rentals/${b1}/cancellation-refunds`, { token: tok.cashier2 });
  const b = await call('POST', `/rental-money/rentals/${b1}/cancellation-refunds`, { token: tok.cashier2 });
  eq([a.data?.created?.map((x) => [x.component, x.amount]), b.data?.created?.length], [[['RENTAL_FEE', 100000]], 0], 're-raised once');
});

await check('race: two staff cancel the same booking at once → exactly one succeeds; the refund requests exist once', async () => {
  const id = await booking(B.id, B.variantId, 300, { pay: [['RENTAL_FEE', 25000], ['DEPOSIT', 50000]] });
  const [x, y] = await Promise.all([cancel(id, { cancellationReason: 'DUPLICATE' }, tok.cashier), cancel(id, { cancellationReason: 'DUPLICATE' }, tok.cashier2)]);
  eq([x.status, y.status].filter((s) => s === 200).length, 1, `one winner (${x.status}/${y.status})`);
  eq(sql(`SELECT count(*) || ':' || sum(amount)::int FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${id}' AND kind = 'CANCELLATION'`), '2:75000', 'no duplicate liability');
});

await check('pending and failed payments are not refunded; a payment that completes AFTER the cancellation is requested separately (late arrival)', async () => {
  const id = await booking(G.id, G.M, 320, { pay: [['RENTAL_FEE', 100000]] });
  sql(`INSERT INTO "Payment" (id, "tenantId", "rentalOrderId", amount, method, status, component, "createdAt", "updatedAt") VALUES
    ('pend-${id}', '${T}', '${id}', 50000, 'MPESA', 'PENDING', 'RENTAL_FEE', (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')),
    ('fail-${id}', '${T}', '${id}', 30000, 'MPESA', 'FAILED', 'RENTAL_FEE', (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))`);
  eq((await cancel(id, { cancellationReason: 'SHOP', cancellationNote: 'gown damaged in storage' })).status, 200, 'cancelled');
  eq(reqs(id), `RENTAL_FEE:100000:REQUESTED:${cashierId}`, 'only the received money');
  sql(`UPDATE "Payment" SET status = 'COMPLETED' WHERE id = 'pend-${id}'`); // the gateway confirms later
  const late = await call('POST', `/rental-money/rentals/${id}/cancellation-refunds`, { token: tok.cashier2 });
  eq(late.data?.created?.map((x) => [x.component, x.amount]), [['RENTAL_FEE', 50000]], 'late money requested');
});

console.log('\nPR #16 hold rules (the REAL hold-expiry job run once against this database)');
// timestamp(3) columns hold UTC: SQL shortcuts use (now() AT TIME ZONE 'UTC'), never bare now() (session time zone).
const runJob = () => JSON.parse(execFileSync('node', [`${process.cwd()}/run-hold-expiry.cjs`, WT], { env: { ...process.env, DATABASE_URL: process.env.IT_JOB_DATABASE_URL || 'postgresql://naro_admin:Admin123@localhost:5432/naro_fashion?schema=it_pos' }, encoding: 'utf8' }).trim().split('\n').pop());
let reviewNoId, unpaid, inflight;
await check('set-up: (a) money received but ID never approved, review window over; (b) no money, payment deadline passed; (c) same as (b) but a payment started before the deadline is in flight', async () => {
  reviewNoId = await booking(B.id, B.variantId, 340, { approveId: false, pay: [['DEPOSIT', 50000]] });
  sql(`UPDATE "RentalOrder" SET "holdState" = 'PAYMENT_REVIEW', "holdExpiresAt" = (now() AT TIME ZONE 'UTC') - interval '5 minutes' WHERE id = '${reviewNoId}'`);
  unpaid = await booking(B.id, B.variantId, 360);
  sql(`UPDATE "RentalOrder" SET "holdExpiresAt" = (now() AT TIME ZONE 'UTC') - interval '5 minutes' WHERE id = '${unpaid}'`);
  inflight = await booking(B.id, B.variantId, 380);
  sql(`UPDATE "RentalOrder" SET "holdExpiresAt" = (now() AT TIME ZONE 'UTC') - interval '5 minutes' WHERE id = '${inflight}';
       INSERT INTO "Payment" (id, "tenantId", "rentalOrderId", amount, method, status, component, "createdAt", "updatedAt") VALUES ('infl-${inflight}', '${T}', '${inflight}', 25000, 'MPESA', 'PENDING', 'RENTAL_FEE', (now() AT TIME ZONE 'UTC') - interval '10 minutes', (now() AT TIME ZONE 'UTC'))`);
  eq([sql(`SELECT status FROM "RentalOrder" WHERE id = '${reviewNoId}'`), sql(`SELECT status || ':' || "holdState" FROM "RentalOrder" WHERE id = '${unpaid}'`)], ['PENDING_ID_VERIFICATION', 'ID_VERIFIED:AWAITING_DOWN_PAYMENT'], 'states');
  const out = runJob();
  return `job processed ${out.processed}`;
});
await check('(a) released as ID_FAILED by the job; money becomes a full refund REQUEST from SYSTEM:HOLD_EXPIRY (never forfeited); the approver can approve it', async () => {
  eq(sql(`SELECT status || '|' || "cancellationReason" || '|' || coalesce("cancelledById", 'null') || '|' || "holdState" FROM "RentalOrder" WHERE id = '${reviewNoId}'`), 'CANCELLED|ID_FAILED|null|REFUND_DUE', 'released');
  eq(reqs(reviewNoId), 'DEPOSIT:50000:REQUESTED:SYSTEM:HOLD_EXPIRY', 'system request');
  const rq = sql(`SELECT id FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${reviewNoId}'`);
  eq((await call('PATCH', `/rental-money/refund-requests/${rq}/approve`, { token: tok.approver })).status, 200, 'approvable');
});
await check('(b) no money: cancelled as PAYMENT_EXPIRED, no refund request; (c) in-flight payment started before the deadline: left alone (PR #16 grace)', async () => {
  eq(sql(`SELECT status || '|' || "cancellationReason" FROM "RentalOrder" WHERE id = '${unpaid}'`), 'CANCELLED|PAYMENT_EXPIRED', 'expired');
  eq(reqs(unpaid), '', 'nothing to refund');
  eq(sql(`SELECT status || '|' || coalesce("cancellationReason", 'none') FROM "RentalOrder" WHERE id = '${inflight}'`), 'ID_VERIFIED|none', 'protected');
});
await check('running the job again changes nothing (idempotent): no new request, no status change', async () => {
  const before = sql(`SELECT count(*) FROM "RentalRefundRequest"`);
  runJob();
  eq(sql(`SELECT count(*) FROM "RentalRefundRequest"`), before, 'requests');
});

const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
