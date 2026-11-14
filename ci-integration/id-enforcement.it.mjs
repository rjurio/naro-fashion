// Real API + real Postgres integration test for the National ID rule
// and the revised 48 h hold rules (owner-approved 2026-11-12). Targets ONLY a local API (default
// http://localhost:4101) on the isolated schema it_id of the local dev
// database. Never production.
//   node id-enforcement.it.mjs <ids.json> <worktree>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

// With P0d (#6) the loopback rate-limit exemption is gone and limits are per
// client IP (trust proxy = 1 -> X-Forwarded-For). Each test identity is sent
// as its OWN simulated client so ~30 logins in a few seconds don't share one
// bucket. The app and its limits are unchanged; on code without P0d the
// header is simply ignored for throttling.
const clientIp = (seed) => { const h = createHash('sha256').update(String(seed)).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };

const API = (process.env.IT_API || 'http://localhost:4101/api/v1').replace(/\/$/, '');
if (!/^http:\/\/localhost:/.test(API)) throw new Error('refusing: IT_API must be localhost');
const ids = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const WT = process.argv[3];
const DB_URL = 'postgresql://naro_admin:Admin123@localhost:5432/naro_fashion?schema=it_id';
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe';
const T = ids.tenantA;

function sql(q) {
  return execFileSync(PSQL, ['-U', 'naro_admin', '-h', 'localhost', '-d', 'naro_fashion', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-c', `SET search_path TO it_id; ${q}`], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8' }).trim();
}
async function call(method, p, { tenant = T, token, body } = {}) {
  const r = await fetch(API + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': tenant,
      'X-Forwarded-For': clientIp(token || body?.email || randomBytes(8).toString('hex')),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
}
const results = [];
async function check(name, fn) {
  try { const note = await fn(); results.push(['PASS', name]); console.log(`  ✔ ${name}${note ? `  — ${note}` : ''}`); }
  catch (e) { results.push(['FAIL', name]); console.log(`  ✖ ${name}\n      ${String(e?.message || e).split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function login(who, { admin = false, tenant = T } = {}) {
  const body = admin ? { email: who.email, password: who.password } : { email: who.email, password: who.password, audience: 'customer' };
  const r = await call('POST', '/auth/login', { body, tenant });
  const tok = r.data?.accessToken || r.data?.access_token || r.data?.tokens?.accessToken;
  if (!tok) throw new Error(`login ${who.email}: ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  return tok;
}
// Items are reused on later, non-overlapping date windows (buffer 0 in the seed).
let slot = 0;
const N_ITEMS = Object.keys(ids.products).length;
function nextSlot() { const i = slot++; return { product: ids.products[`p${(i % N_ITEMS) + 1}`], start: 20 + 4 * Math.floor(i / N_ITEMS) }; }
async function book(token, opts = {}) {
  const s = nextSlot();
  const { tenant = T, product = s.product, start = s.start } = opts;
  return call('POST', '/rentals', {
    tenant, token,
    body: { productId: product.id, variantId: product.variantId, startDate: day(start), returnDate: day(start + 2), pickupDate: day(start) },
  });
}
const ref = () => `private://id-documents/${T}/${randomBytes(16).toString('hex')}.png`;
const submitId = (token) => call('POST', '/id-verification/submit', { token, body: { frontImageUrl: ref(), backImageUrl: ref(), idNumber: '19900101-12345-00001-1' } });
const docOf = (userId) => sql(`SELECT id FROM "CustomerIDDocument" WHERE "userId" = '${userId}' ORDER BY "createdAt" DESC LIMIT 1`);
const statusOf = (rid) => sql(`SELECT status FROM "RentalOrder" WHERE id = '${rid}'`);
const setStatus = (rid, st) => sql(`UPDATE "RentalOrder" SET status = '${st}' WHERE id = '${rid}'`);
const payments = (rid) => sql(`SELECT count(*) || ':' || COALESCE(sum(amount) FILTER (WHERE status = 'COMPLETED'), 0) FROM "Payment" WHERE "rentalOrderId" = '${rid}'`);
async function pay(adminTok, rid, amount, status = 'COMPLETED') {
  const c = await call('POST', '/payments', { token: adminTok, body: { rentalOrderId: rid, amount, method: 'CASH', transactionRef: `IT-${randomBytes(4).toString('hex')}` } });
  assert(c.status === 201, `payment create ${c.status} ${JSON.stringify(c.data).slice(0, 120)}`);
  if (status !== 'PENDING') {
    const u = await call('PATCH', `/payments/${c.data.id}`, { token: adminTok, body: { status } });
    assert(u.status === 200, `payment ${status} ${u.status}`);
  }
  return c.data.id;
}

console.log(`real API ${API} · isolated schema it_id`);
const superTok = await login(ids.admins.super, { admin: true });
const staffTok = await login(ids.admins.staff, { admin: true });
const reviewerTok = await login(ids.admins.reviewer, { admin: true });
const tok = {};
for (const k of Object.keys(ids.customers)) {
  tok[k] = await login(ids.customers[k], k === 'otherTenant' ? { tenant: ids.tenantB } : {});
}

// ---------------------------------------------------------------------------
console.log('\n1. booking before ID verification');
const r1 = await book(tok.c1);
const r2 = await book(tok.c1);
await check('a customer with no ID can send booking requests (201), stored PENDING_ID_VERIFICATION', async () => {
  eq([r1.status, r2.status], [201, 201], 'create');
  eq([r1.data.status, r2.data.status], ['PENDING_ID_VERIFICATION', 'PENDING_ID_VERIFICATION'], 'status');
});

// ---------------------------------------------------------------------------
console.log('\n2. confirmation / collection blocked without an approved ID (direct API, even SUPER_ADMIN)');
for (const to of ['ID_VERIFIED', 'DOWN_PAYMENT_PAID', 'FULLY_PAID', 'READY_FOR_PICKUP', 'ITEM_DISPATCHED', 'ACTIVE', 'RETURNED']) {
  await check(`PENDING_ID_VERIFICATION → ${to}: 422 ID_NOT_APPROVED, status unchanged`, async () => {
    const r = await call('PATCH', `/rentals/${r1.data.id}/status`, { token: superTok, body: { status: to } });
    eq([r.status, r.data?.code], [422, 'ID_NOT_APPROVED'], 'response');
    eq(statusOf(r1.data.id), 'PENDING_ID_VERIFICATION', 'db status');
  });
}
await check('offline-style replay with expectedStatus is refused the same way', async () => {
  const r = await call('PATCH', `/rentals/${r1.data.id}/status`, { token: superTok, body: { status: 'ACTIVE', expectedStatus: 'PENDING_ID_VERIFICATION' } });
  eq([r.status, r.data?.code], [422, 'ID_NOT_APPROVED'], 'response');
});
await check('"ready for pickup" flag refused without an approved ID', async () => {
  const r = await call('PATCH', `/rentals/${r1.data.id}/ready`, { token: superTok });
  eq([r.status, r.data?.code], [422, 'ID_NOT_APPROVED'], 'response');
  eq(sql(`SELECT "isReadyForPickup" FROM "RentalOrder" WHERE id = '${r1.data.id}'`), 'f', 'flag');
});
await check('a status set by hand (ID_VERIFIED without any document) does not unlock hand-over', async () => {
  const r = await book(tok.c6);
  setStatus(r.data.id, 'ID_VERIFIED');
  const u = await call('PATCH', `/rentals/${r.data.id}/status`, { token: superTok, body: { status: 'READY_FOR_PICKUP' } });
  eq([u.status, u.data?.code], [422, 'ID_NOT_APPROVED'], 'response');
  setStatus(r.data.id, 'PENDING_ID_VERIFICATION');
});
await check('denials are audited (UPDATE_STATUS_DENIED, reason ID_NOT_APPROVED)', async () => {
  const n = Number(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action = 'UPDATE_STATUS_DENIED' AND "entityId" = '${r1.data.id}' AND details->>'reason' = 'ID_NOT_APPROVED'`));
  assert(n >= 9, `audited denials ${n}`);
  return `${n} rows`;
});
await check('cancelling an unverified booking stays possible', async () => {
  const r = await book(tok.c3);
  const u = await call('PATCH', `/rentals/${r.data.id}/status`, { token: superTok, body: { status: 'CANCELLED' } });
  eq([u.status, statusOf(r.data.id)], [200, 'CANCELLED'], 'cancel');
});

// ---------------------------------------------------------------------------
console.log('\n3. permission enforcement (API level)');
await check('customer token cannot change a rental status (403)', async () => {
  const r = await call('PATCH', `/rentals/${r1.data.id}/status`, { token: tok.c1, body: { status: 'CANCELLED' } });
  eq(r.status, 403, 'status');
});
await check('STAFF (no rentals:update-status) cannot change status or mark ready (403)', async () => {
  const a = await call('PATCH', `/rentals/${r1.data.id}/status`, { token: staffTok, body: { status: 'CANCELLED' } });
  const b = await call('PATCH', `/rentals/${r1.data.id}/ready`, { token: staffTok });
  eq([a.status, b.status], [403, 403], 'status');
});
await check('STAFF (no id-verification:review) cannot see the ID queue, approve or reject (403)', async () => {
  const a = await call('GET', '/id-verification/pending', { token: staffTok });
  const b = await call('PATCH', '/id-verification/nonexistent/approve', { token: staffTok });
  const c = await call('PATCH', '/id-verification/nonexistent/reject', { token: staffTok, body: { reason: 'x' } });
  eq([a.status, b.status, c.status], [403, 403, 403], 'status');
});
await check('ID reviewer WITHOUT 2FA (owner rule): 403 TWO_FA_REQUIRED on the queue, approve and ID images', async () => {
  const a = await call('GET', '/id-verification/pending', { token: reviewerTok });
  const b = await call('PATCH', '/id-verification/nonexistent/approve', { token: reviewerTok });
  const c = await call('GET', `/upload/id-document/${encodeURIComponent(`${T}/${'b'.repeat(32)}.png`)}`, { token: reviewerTok });
  eq([a.status, a.data?.code, b.status, c.status], [403, 'TWO_FA_REQUIRED', 403, 403], 'status');
});
// The designated reviewer turns 2FA on (simulated in the isolated DB).
sql(`UPDATE "AdminUser" SET "is2FAEnabled" = true WHERE id = '${ids.admins.reviewer.id}'`);
await check('ID reviewer WITH 2FA (id-verification:review only) sees the queue but cannot change rental status', async () => {
  const a = await call('GET', '/id-verification/pending', { token: reviewerTok });
  const b = await call('PATCH', `/rentals/${r1.data.id}/status`, { token: reviewerTok, body: { status: 'CANCELLED' } });
  eq([a.status, b.status], [200, 403], 'status');
});
await check('a customer cannot approve their own ID (403)', async () => {
  const r = await call('PATCH', '/id-verification/nonexistent/approve', { token: tok.c1 });
  eq(r.status, 403, 'status');
});

// ---------------------------------------------------------------------------
console.log('\n4. ID approval reconciles waiting bookings (payments respected)');
// c1: r1 fully covered by a COMPLETED payment; r2 only a PENDING payment.
const dp1 = Number(r1.data.downPaymentAmount);
await pay(superTok, r1.data.id, dp1, 'COMPLETED');
await pay(superTok, r2.data.id, Number(r2.data.downPaymentAmount), 'PENDING');
await check('a payment received before the ID is recorded but does NOT confirm (still PENDING_ID_VERIFICATION)', async () => {
  eq(statusOf(r1.data.id), 'PENDING_ID_VERIFICATION', 'r1');
});
// c1 also has a booking that has already been handed over and one closed.
const handed = await book(tok.c1);
const closed = await book(tok.c1);
const cancelled = await book(tok.c1);
setStatus(handed.data.id, 'ACTIVE'); setStatus(closed.data.id, 'CLOSED'); setStatus(cancelled.data.id, 'CANCELLED');
const before = sql(`SELECT string_agg(id || ':' || status || ':' || "updatedAt"::text, ',' ORDER BY id) FROM "RentalOrder" WHERE id IN ('${handed.data.id}','${closed.data.id}','${cancelled.data.id}')`);
// other customers' waiting bookings must not move
const other = await book(tok.c2);
const otherTenant = await book(tok.otherTenant, { tenant: ids.tenantB, product: ids.otherTenantProduct });
const payCount = sql(`SELECT count(*) FROM "Payment"`);
await check('customer submits the ID document after booking', async () => {
  const s = await submitId(tok.c1);
  eq(s.status, 201, 'submit');
});
const doc1 = docOf(ids.customers.c1.id);
const appr = await call('PATCH', `/id-verification/${doc1}/approve`, { token: reviewerTok });
await check('approval: 200; waiting bookings → ID_VERIFIED; the one with a COMPLETED down payment → DOWN_PAYMENT_PAID', async () => {
  eq(appr.status, 200, `approve ${JSON.stringify(appr.data).slice(0, 160)}`);
  eq([statusOf(r1.data.id), statusOf(r2.data.id)], ['DOWN_PAYMENT_PAID', 'ID_VERIFIED'], 'statuses');
  eq([appr.data.reconciled.idVerified, appr.data.reconciled.confirmed], [2, 1], 'reconciled');
});
await check('a PENDING payment never counts as paid (r2 stays ID_VERIFIED)', async () => {
  eq(payments(r2.data.id), `1:0`, 'r2 payments');
});
await check('handed-over / closed / cancelled bookings are not touched (status AND updatedAt identical)', async () => {
  eq(sql(`SELECT string_agg(id || ':' || status || ':' || "updatedAt"::text, ',' ORDER BY id) FROM "RentalOrder" WHERE id IN ('${handed.data.id}','${closed.data.id}','${cancelled.data.id}')`), before, 'rows');
});
await check('other customers (same tenant) and other tenants are not touched', async () => {
  eq([statusOf(other.data.id), statusOf(otherTenant.data.id)], ['PENDING_ID_VERIFICATION', 'PENDING_ID_VERIFICATION'], 'statuses');
});
await check('no payment was created or changed by the approval', async () => {
  eq(sql(`SELECT count(*) FROM "Payment"`), payCount, 'payment rows');
  eq(payments(r1.data.id), `1:${dp1.toFixed(2)}`, 'r1');
});
await check('the approval and each moved booking are audited', async () => {
  eq(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action = 'APPROVE_ID' AND "entityId" = '${doc1}'`), '1', 'APPROVE_ID');
  eq(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action = 'UPDATE_STATUS' AND details->>'source' = 'ID_APPROVED' AND "entityId" IN ('${r1.data.id}','${r2.data.id}')`), '2', 'UPDATE_STATUS');
});
await check('repeated approval: refused, and nothing changes', async () => {
  const snap = sql(`SELECT string_agg(id || ':' || status || ':' || "updatedAt"::text, ',' ORDER BY id) FROM "RentalOrder" WHERE "userId" = '${ids.customers.c1.id}'`);
  const again = await call('PATCH', `/id-verification/${doc1}/approve`, { token: reviewerTok });
  assert([400, 409].includes(again.status), `second approve ${again.status}`);
  eq(sql(`SELECT string_agg(id || ':' || status || ':' || "updatedAt"::text, ',' ORDER BY id) FROM "RentalOrder" WHERE "userId" = '${ids.customers.c1.id}'`), snap, 'rentals');
  eq(sql(`SELECT count(*) FROM "Payment"`), payCount, 'payments');
  return `HTTP ${again.status}`;
});
await check('the ID is reused: a new booking by the same customer starts ID_VERIFIED', async () => {
  const r = await book(tok.c1);
  eq([r.status, r.data.status], [201, 'ID_VERIFIED'], 'create');
});
await check('with the ID approved, staff can move the booking on (ID_VERIFIED → READY_FOR_PICKUP)', async () => {
  const r = await call('PATCH', `/rentals/${r2.data.id}/status`, { token: superTok, body: { status: 'READY_FOR_PICKUP' } });
  eq([r.status, statusOf(r2.data.id)], [200, 'READY_FOR_PICKUP'], 'transition');
});

// ---------------------------------------------------------------------------
console.log('\n5. ID approval with insufficient payment');
await check('a COMPLETED payment below the down payment: approval → ID_VERIFIED, not confirmed', async () => {
  const r = await book(tok.c4);
  await pay(superTok, r.data.id, Number(r.data.downPaymentAmount) - 1, 'COMPLETED');
  await submitId(tok.c4);
  const a = await call('PATCH', `/id-verification/${docOf(ids.customers.c4.id)}/approve`, { token: reviewerTok });
  eq([a.status, statusOf(r.data.id), a.data.reconciled.confirmed], [200, 'ID_VERIFIED', 0], 'result');
  // the rest arrives later → the normal settlement confirms it (ID now approved)
  await pay(superTok, r.data.id, 1, 'COMPLETED');
  eq(statusOf(r.data.id), 'DOWN_PAYMENT_PAID', 'after top-up');
});

// ---------------------------------------------------------------------------
console.log('\n6. rejection, and an ID that is no longer approved');
await check('reject: bookings untouched, customer can submit again', async () => {
  const r = await book(tok.c5);
  await submitId(tok.c5);
  const j = await call('PATCH', `/id-verification/${docOf(ids.customers.c5.id)}/reject`, { token: reviewerTok, body: { reason: 'Photo unreadable' } });
  eq([j.status, statusOf(r.data.id)], [200, 'PENDING_ID_VERIFICATION'], 'reject');
  eq(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action = 'REJECT_ID'`) !== '0', true, 'audited');
  eq((await submitId(tok.c5)).status, 201, 'resubmit');
});
await check('reject needs a reason (400)', async () => {
  const j = await call('PATCH', `/id-verification/${docOf(ids.customers.c5.id)}/reject`, { token: reviewerTok, body: { reason: '' } });
  eq(j.status, 400, 'status');
});
await check('ID no longer APPROVED (invalidated): an ID_VERIFIED booking cannot be handed over, and a payment does not confirm it', async () => {
  const r = await book(tok.c4); // c4 is approved → starts ID_VERIFIED
  eq(r.data.status, 'ID_VERIFIED', 'start');
  sql(`UPDATE "CustomerIDDocument" SET "verificationStatus" = 'REJECTED' WHERE "userId" = '${ids.customers.c4.id}'`);
  const u = await call('PATCH', `/rentals/${r.data.id}/status`, { token: superTok, body: { status: 'READY_FOR_PICKUP' } });
  eq([u.status, u.data?.code], [422, 'ID_NOT_APPROVED'], 'transition');
  await pay(superTok, r.data.id, Number(r.data.downPaymentAmount), 'COMPLETED');
  eq(statusOf(r.data.id), 'ID_VERIFIED', 'not confirmed by settlement');
  const nb = await book(tok.c4);
  eq(nb.data.status, 'PENDING_ID_VERIFICATION', 'new booking after invalidation');
});

// ---------------------------------------------------------------------------
console.log('\n7. concurrency');
for (const k of ['race1', 'race2', 'race3', 'race4', 'race5']) {
  await check(`${k}: bookings racing the ID approval never end up stuck in PENDING_ID_VERIFICATION`, async () => {
    await submitId(tok[k]);
    const doc = docOf(ids.customers[k].id);
    const ops = [book(tok[k]), call('PATCH', `/id-verification/${doc}/approve`, { token: reviewerTok }), book(tok[k])];
    const [b1, a, b2] = await Promise.all(ops);
    eq([b1.status, a.status, b2.status], [201, 200, 201], 'responses');
    const stuck = sql(`SELECT count(*) FROM "RentalOrder" WHERE "userId" = '${ids.customers[k].id}' AND status = 'PENDING_ID_VERIFICATION'`);
    eq(stuck, '0', 'stuck bookings');
    return `booking statuses ${b1.data.status}/${b2.data.status}`;
  });
}
await check('two approvals of the same document at once: exactly one succeeds', async () => {
  await book(tok.dbl);
  await submitId(tok.dbl);
  const doc = docOf(ids.customers.dbl.id);
  const [x, y] = await Promise.all([
    call('PATCH', `/id-verification/${doc}/approve`, { token: reviewerTok }),
    call('PATCH', `/id-verification/${doc}/approve`, { token: superTok }),
  ]);
  const codes = [x.status, y.status].sort();
  assert(codes[0] === 200 && [400, 409].includes(codes[1]), `codes ${codes}`);
  eq(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action = 'APPROVE_ID' AND "entityId" = '${doc}'`), '1', 'one approval audited');
  return `HTTP ${codes.join(' + ')}`;
});

// ---------------------------------------------------------------------------
console.log('\n8. revised 48-hour hold rules (the real cron method + the real API on the real DB)');
{
  const require = createRequire(import.meta.url);
  process.env.DATABASE_URL = DB_URL;
  const { PrismaClient } = require(path.join(WT, 'packages', 'database', 'node_modules', '@prisma', 'client'));
  const { SchedulerService } = require(path.join(WT, 'apps', 'api', 'dist', 'scheduler', 'scheduler.service.js'));
  const prisma = new PrismaClient();
  // Notifications are CAPTURED here, never sent (no real customer emails in tests).
  const emails = [];
  const notif = { sendRentalHoldExpired: async (p) => { emails.push(p); return { sent: true }; } };
  const sched = new SchedulerService(prisma, notif, { get: () => undefined }, {}, {});
  const runCron = () => sched.handleExpiredRentalHolds(new Date());
  const managerTok = await login(ids.admins.manager, { admin: true });

  const hold = (rid) => sql(`SELECT status || '|' || COALESCE("holdState", '-') || '|' || CASE WHEN "holdExpiresAt" IS NULL THEN 'none' ELSE 'set' END FROM "RentalOrder" WHERE id = '${rid}'`);
  const hoursLeft = (rid) => Number(sql(`SELECT round((extract(epoch FROM ("holdExpiresAt" - (now() AT TIME ZONE 'UTC'))) / 3600.0)::numeric, 2) FROM "RentalOrder" WHERE id = '${rid}'`));
  const near = (h, want, m) => assert(Math.abs(h - want) < 0.1, `${m}: ${h} h left, want ~${want}`);
  const expireNow = (rid) => sql(`UPDATE "RentalOrder" SET "holdExpiresAt" = (now() AT TIME ZONE 'UTC') - interval '1 minute' WHERE id = '${rid}'`);
  const age = (rid, h) => sql(`UPDATE "RentalOrder" SET "createdAt" = (now() AT TIME ZONE 'UTC') - interval '${h} hours' WHERE id = '${rid}'`);
  const pickupPast = (rid) => sql(`UPDATE "RentalOrder" SET "pickupDate" = (now() AT TIME ZONE 'UTC') - interval '2 days' WHERE id = '${rid}'`);
  const autoNotes = (rid) => Number(sql(`SELECT (length(COALESCE(notes, '')) - length(replace(COALESCE(notes, ''), '[Auto-cancelled', ''))) / length('[Auto-cancelled') FROM "RentalOrder" WHERE id = '${rid}'`));
  const mailsFor = (rn) => emails.filter((e) => e.rentalNumber === rn);
  const approve = async (cust) => {
    const r = await call('PATCH', `/id-verification/${docOf(ids.customers[cust].id)}/approve`, { token: superTok });
    assert(r.status === 200, `approve ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
    return r.data;
  };
  const reject = async (cust) => {
    const r = await call('PATCH', `/id-verification/${docOf(ids.customers[cust].id)}/reject`, { token: superTok, body: { reason: 'Photo is blurred' } });
    assert(r.status === 200, `reject ${r.status}`);
    return r.data;
  };

  // 8a ---------------------------------------------------------------------
  const a = (await book(tok['h-noid'])).data;
  await check('no ID: 48 h from the booking (AWAITING_ID), explicit deadline stored', async () => {
    eq(hold(a.id), 'PENDING_ID_VERIFICATION|AWAITING_ID|set', 'hold');
    near(hoursLeft(a.id), 48, 'deadline');
  });
  await runCron();
  await check('…kept before the deadline', async () => eq(statusOf(a.id), 'PENDING_ID_VERIFICATION', 'status'));
  expireNow(a.id);
  await runCron();
  await check('…released after it, with the reason in the notes and a customer notification', async () => {
    eq(statusOf(a.id), 'CANCELLED', 'status');
    assert(/No National ID was submitted in time\. \(HOLD_DEADLINE/.test(sql(`SELECT notes FROM "RentalOrder" WHERE id = '${a.id}'`)), 'note');
    eq(mailsFor(a.rentalNumber).map((e) => e.message), ['No National ID was submitted in time.'], 'email');
  });
  await runCron();
  await check('idempotent: a second run cancels nothing and notifies nobody again', async () => {
    eq([autoNotes(a.id), mailsFor(a.rentalNumber).length], [1, 1], 'notes / emails');
  });

  // 8b ---------------------------------------------------------------------
  const b = (await book(tok['h-review'])).data;
  await submitId(tok['h-review']);
  await check('ID submitted: the deadline is PAUSED while staff review it', async () => {
    eq(hold(b.id), 'PENDING_ID_VERIFICATION|ID_UNDER_REVIEW|none', 'hold');
  });
  age(b.id, 100); // staff take 4 days to review
  await runCron();
  await check('…a booking 100 h old with its ID still under review is NOT cancelled (old rule: cancelled at 48 h)', async () => {
    eq(statusOf(b.id), 'PENDING_ID_VERIFICATION', 'status');
  });
  const bAppr = await approve('h-review');
  await check('ID approved: a FRESH 48 h down-payment window from the approval, not from the booking', async () => {
    eq(hold(b.id), 'ID_VERIFIED|AWAITING_DOWN_PAYMENT|set', 'hold');
    near(hoursLeft(b.id), 48, 'deadline');
    assert(bAppr.reconciled?.paymentDueBy, 'paymentDueBy reported');
    const d = JSON.parse(sql(`SELECT details FROM "AdminActivityLog" WHERE action = 'UPDATE_STATUS' AND "entityId" = '${b.id}' ORDER BY "createdAt" DESC LIMIT 1`));
    eq([d.source, d.holdState, !!d.holdExpiresAt], ['ID_APPROVED', 'AWAITING_DOWN_PAYMENT', true], 'audited with the deadline');
  });
  await runCron();
  await check('…kept inside the new window', async () => eq(statusOf(b.id), 'ID_VERIFIED', 'status'));
  expireNow(b.id);
  await runCron();
  await check('…released when the down payment is not received in time', async () => {
    eq(statusOf(b.id), 'CANCELLED', 'status');
    eq(mailsFor(b.rentalNumber).map((e) => e.message), ['The down payment was not received in time after the ID was approved.'], 'email');
  });

  // 8c ---------------------------------------------------------------------
  const c = (await book(tok['h-reject'])).data;
  await submitId(tok['h-reject']);
  await reject('h-reject');
  await check('ID rejected: status unchanged, an explicit 48 h window to send a new ID, audited', async () => {
    eq(hold(c.id), 'PENDING_ID_VERIFICATION|ID_REJECTED|set', 'hold');
    near(hoursLeft(c.id), 48, 'deadline');
    const d = JSON.parse(sql(`SELECT details FROM "AdminActivityLog" WHERE action = 'REJECT_ID' ORDER BY "createdAt" DESC LIMIT 1`));
    eq([d.bookingsGivenResubmissionWindow, d.holdState], [1, 'ID_REJECTED'], 'audit');
  });
  await submitId(tok['h-reject']);
  await check('resubmission pauses the clock again', async () => eq(hold(c.id), 'PENDING_ID_VERIFICATION|ID_UNDER_REVIEW|none', 'hold'));
  await reject('h-reject');
  expireNow(c.id);
  const late = await submitId(tok['h-reject']);
  await check('a resubmission AFTER the window has passed does not revive the booking', async () => {
    eq(late.status, 201, 'the ID itself is accepted');
    eq(hold(c.id), 'PENDING_ID_VERIFICATION|ID_REJECTED|set', 'hold');
  });
  await runCron();
  await check('…released with the resubmission message', async () => {
    eq(statusOf(c.id), 'CANCELLED', 'status');
    eq(mailsFor(c.rentalNumber).map((e) => e.message), ['A new National ID was not submitted in time after the previous one was not approved.'], 'email');
  });

  // 8d ---------------------------------------------------------------------
  await submitId(tok['h-zero']);
  await approve('h-zero');
  const z = (await book(tok['h-zero'], { product: ids.zero[0], start: 30 })).data;
  await check('0 % down payment (ID on file): ID_VERIFIED with NO payment deadline', async () => {
    eq(z.status, 'ID_VERIFIED', 'created');
    eq(hold(z.id), 'ID_VERIFIED|NO_DOWN_PAYMENT|none', 'hold');
  });
  age(z.id, 100);
  await runCron();
  await check('…never cancelled for not paying a down payment that does not exist, and never auto-confirmed', async () => {
    eq(statusOf(z.id), 'ID_VERIFIED', 'status');
  });
  pickupPast(z.id);
  await runCron();
  await check('…but released once its pickup day has passed unconfirmed', async () => {
    eq(statusOf(z.id), 'CANCELLED', 'status');
    eq(mailsFor(z.rentalNumber).map((e) => e.message), ['The pickup date passed before the booking was confirmed.'], 'email');
  });
  const z2 = (await book(tok['h-zero2'], { product: ids.zero[1], start: 30 })).data;
  await submitId(tok['h-zero2']);
  const z2Appr = await approve('h-zero2');
  await check('0 % booking approved later: ID_VERIFIED + NO_DOWN_PAYMENT, NOT confirmed automatically', async () => {
    eq(hold(z2.id), 'ID_VERIFIED|NO_DOWN_PAYMENT|none', 'hold');
    eq([z2Appr.reconciled.confirmed, z2Appr.reconciled.paymentDueBy], [0, null], 'reconciled');
  });

  // 8e ---------------------------------------------------------------------
  const p = (await book(tok['h-pickup'])).data;
  await submitId(tok['h-pickup']);
  pickupPast(p.id);
  const pAppr = await approve('h-pickup');
  await check('pickup date passed before the approval: the booking is NOT advanced (reported as expired)', async () => {
    eq(statusOf(p.id), 'PENDING_ID_VERIFICATION', 'status');
    eq([pAppr.reconciled.idVerified, pAppr.reconciled.expired], [0, 1], 'reconciled');
  });
  await runCron();
  await check('…and released by the expiry job with the pickup message', async () => {
    eq(statusOf(p.id), 'CANCELLED', 'status');
    eq(mailsFor(p.rentalNumber).length, 1, 'email');
  });

  // 8f ---------------------------------------------------------------------
  const mA = (await book(tok['h-multi'])).data;
  const mB = (await book(tok['h-multi'])).data;
  const mC = (await book(tok['h-multi'], { product: ids.zero[1], start: 40 })).data;
  await pay(superTok, mA.id, Number(mA.downPaymentAmount), 'COMPLETED');
  await submitId(tok['h-multi']);
  await check('several bookings under one account: all paused by one ID submission', async () => {
    eq([mA, mB, mC].map((r) => hold(r.id).split('|')[1]), ['ID_UNDER_REVIEW', 'ID_UNDER_REVIEW', 'ID_UNDER_REVIEW'], 'holds');
  });
  const mAppr = await approve('h-multi');
  await check('…one approval: paid one confirmed, unpaid one gets 48 h, 0 % one has no deadline', async () => {
    eq(statusOf(mA.id), 'DOWN_PAYMENT_PAID', 'paid booking');
    eq(hold(mB.id), 'ID_VERIFIED|AWAITING_DOWN_PAYMENT|set', 'unpaid booking');
    near(hoursLeft(mB.id), 48, 'unpaid deadline');
    eq(hold(mC.id), 'ID_VERIFIED|NO_DOWN_PAYMENT|none', '0 % booking');
    eq([mAppr.reconciled.idVerified, mAppr.reconciled.confirmed], [3, 1], 'reconciled');
  });
  await runCron();
  await check('…the confirmed booking is never touched by the expiry job', async () => eq(statusOf(mA.id), 'DOWN_PAYMENT_PAID', 'status'));

  // 8g ---------------------------------------------------------------------
  await submitId(tok['h-onfile']);
  await approve('h-onfile');
  const g = (await book(tok['h-onfile'])).data;
  await check('ID already on file: booked straight to ID_VERIFIED with a 48 h down-payment window', async () => {
    eq(hold(g.id), 'ID_VERIFIED|AWAITING_DOWN_PAYMENT|set', 'hold');
    near(hoursLeft(g.id), 48, 'deadline');
  });
  const gPay = await pay(superTok, g.id, Number(g.downPaymentAmount), 'PENDING');
  expireNow(g.id);
  // the payment was started BEFORE the deadline (round 2: only those protect)
  sql(`UPDATE "Payment" SET "createdAt" = (now() AT TIME ZONE 'UTC') - interval '5 minutes' WHERE id = '${gPay}'`);
  await runCron();
  await check('a payment started before the deadline and still in flight keeps the expired booking (within the 2 h grace)', async () => {
    eq(statusOf(g.id), 'ID_VERIFIED', 'status');
    eq(mailsFor(g.rentalNumber).length, 0, 'no email');
  });
  sql(`UPDATE "RentalOrder" SET "holdExpiresAt" = (now() AT TIME ZONE 'UTC') - interval '2 hours 1 minute' WHERE id = '${g.id}'`);
  sql(`UPDATE "Payment" SET "createdAt" = (now() AT TIME ZONE 'UTC') - interval '2 hours 5 minutes' WHERE id = '${gPay}'`);
  await runCron();
  await check('…but once the grace (deadline + 2 h) is over it no longer holds it', async () => eq(statusOf(g.id), 'CANCELLED', 'status'));

  await submitId(tok['h-pay']);
  await approve('h-pay');
  const hp = (await book(tok['h-pay'])).data;
  const hpPay = await pay(superTok, hp.id, Number(hp.downPaymentAmount), 'PENDING');
  expireNow(hp.id);
  const done = await call('PATCH', `/payments/${hpPay}`, { token: superTok, body: { status: 'COMPLETED' } });
  await runCron();
  await check('the in-flight payment completes after the deadline: confirmed, never cancelled', async () => {
    eq(done.status, 200, 'payment completed');
    eq(statusOf(hp.id), 'DOWN_PAYMENT_PAID', 'status');
    eq(autoNotes(hp.id), 0, 'no auto-cancel note');
  });

  // 8h ---------------------------------------------------------------------
  await submitId(tok['h-race']);
  await approve('h-race');
  const raceRows = [];
  for (let i = 0; i < 5; i++) {
    const r = (await book(tok['h-race'])).data;
    const pid = await pay(superTok, r.id, Number(r.downPaymentAmount), 'PENDING');
    sql(`UPDATE "Payment" SET "createdAt" = (now() AT TIME ZONE 'UTC') - interval '25 hours' WHERE id = '${pid}'`);
    expireNow(r.id);
    raceRows.push({ r, pid });
  }
  await Promise.all([
    runCron(),
    ...raceRows.map(({ pid }) => call('PATCH', `/payments/${pid}`, { token: superTok, body: { status: 'COMPLETED' } })),
  ]);
  await check('race — expiry job vs payment completion (5 bookings): every booking ends consistent', async () => {
    let paid = 0, cancelled = 0;
    for (const { r } of raceRows) {
      const st = statusOf(r.id);
      if (st === 'DOWN_PAYMENT_PAID') { paid++; eq(autoNotes(r.id), 0, `${r.rentalNumber} confirmed but carries a cancel note`); }
      else if (st === 'CANCELLED') { cancelled++; eq([autoNotes(r.id), mailsFor(r.rentalNumber).length], [1, 1], `${r.rentalNumber} cancel note/email`); }
      else throw new Error(`${r.rentalNumber} ended ${st}`);
    }
    return `${paid} confirmed, ${cancelled} cancelled (cancelled-then-paid = refund review, never re-opened)`;
  });

  // 8i ---------------------------------------------------------------------
  const rs = [];
  for (let i = 0; i < 3; i++) rs.push((await book(tok['h-resched'])).data);
  await submitId(tok['h-resched']);
  for (const r of rs) pickupPast(r.id);
  await Promise.all([
    runCron(),
    ...rs.map((r) => call('PATCH', `/rentals/${r.id}`, { token: superTok, body: { pickupDate: r.startDate.slice(0, 10), returnDate: r.returnDate.slice(0, 10) } })),
  ]);
  await check('race — expiry job vs rescheduling the pickup (3 bookings): consistent either way', async () => {
    const out = [];
    for (const r of rs) {
      const st = statusOf(r.id);
      const future = sql(`SELECT ("pickupDate" >= (now() AT TIME ZONE 'UTC') - interval '1 day')::text FROM "RentalOrder" WHERE id = '${r.id}'`) === 'true';
      if (st === 'PENDING_ID_VERIFICATION') { assert(future, 'kept but pickup still in the past'); eq(autoNotes(r.id), 0, 'kept with a cancel note'); out.push('rescheduled'); }
      else if (st === 'CANCELLED') { eq([autoNotes(r.id), mailsFor(r.rentalNumber).length], [1, 1], 'cancel note/email'); out.push('released'); }
      else throw new Error(`ended ${st}`);
    }
    return out.join(', ');
  });

  // 8j ---------------------------------------------------------------------
  const ar = (await book(tok['h-ar'])).data;
  await submitId(tok['h-ar']);
  const arDoc = docOf(ids.customers['h-ar'].id);
  const [x, y] = await Promise.all([
    call('PATCH', `/id-verification/${arDoc}/approve`, { token: superTok }),
    call('PATCH', `/id-verification/${arDoc}/reject`, { token: superTok, body: { reason: 'race' } }),
  ]);
  await check('race — approve vs reject of the same ID: exactly one wins, the booking matches the winner', async () => {
    const ok = [x, y].filter((r) => r.status === 200).length;
    eq(ok, 1, 'one 200');
    const docStatus = sql(`SELECT "verificationStatus" FROM "CustomerIDDocument" WHERE id = '${arDoc}'`);
    eq(hold(ar.id), docStatus === 'APPROVED' ? 'ID_VERIFIED|AWAITING_DOWN_PAYMENT|set' : 'PENDING_ID_VERIFICATION|ID_REJECTED|set', 'hold');
    return `${docStatus} won (HTTP ${x.status} / ${y.status})`;
  });

  // 8k ---------------------------------------------------------------------
  const l1 = (await book(tok['h-legacy1'])).data;
  const l2 = (await book(tok['h-legacy1'])).data;
  await submitId(tok['h-legacy2']);
  const l3 = (await book(tok['h-legacy2'])).data;
  // simulate bookings created BEFORE the deploy (no hold columns set)
  sql(`UPDATE "RentalOrder" SET "holdState" = NULL, "holdExpiresAt" = NULL WHERE id IN ('${l1.id}', '${l2.id}', '${l3.id}')`);
  age(l1.id, 10); age(l2.id, 50); age(l3.id, 100);
  await runCron();
  await check('legacy (pre-deploy) bookings are classified once: no ID, 10 h old → deadline = booked + 48 h, kept', async () => {
    eq(hold(l1.id), 'PENDING_ID_VERIFICATION|AWAITING_ID|set', 'hold');
    near(hoursLeft(l1.id), 38, 'deadline');
  });
  await check('…no ID, 50 h old → released in the same run (exactly what the old rule did)', async () => eq(statusOf(l2.id), 'CANCELLED', 'status'));
  await check('…ID waiting for staff, 100 h old → paused and kept (the old rule would have cancelled it)', async () => {
    eq(hold(l3.id), 'PENDING_ID_VERIFICATION|ID_UNDER_REVIEW|none', 'hold');
  });

  // 8l ---------------------------------------------------------------------
  const idKey = encodeURIComponent(`${T}/${'a'.repeat(32)}.png`);
  await check('MANAGER keeps rental status changes but cannot review IDs or open ID images (SUPER_ADMIN only)', async () => {
    const q = await call('GET', '/id-verification/pending', { token: managerTok });
    const img = await call('GET', `/upload/id-document/${idKey}`, { token: managerTok });
    const st = await call('PATCH', `/rentals/${mC.id}/status`, { token: managerTok, body: { status: 'CANCELLED' } });
    eq([q.status, img.status, st.status], [403, 403, 200], 'queue / image / status');
  });
  await check('STAFF cannot open ID images; SUPER_ADMIN passes authorisation (404 = no such file)', async () => {
    const s1 = await call('GET', `/upload/id-document/${idKey}`, { token: staffTok });
    const s2 = await call('GET', `/upload/id-document/${idKey}`, { token: superTok });
    const s3 = await call('GET', `/upload/id-document/${idKey}`, { token: tok['h-noid'] });
    const s4 = await call('GET', `/upload/id-document/${idKey}`, {});
    eq([s1.status, s2.status, s3.status, s4.status], [403, 404, 403, 401], 'staff / super / customer / anonymous');
  });
  await check('nobody can set the deadline through the API (unknown fields rejected)', async () => {
    const s1 = await call('PATCH', `/rentals/${mB.id}`, { token: superTok, body: { holdExpiresAt: '2030-01-01T00:00:00Z' } });
    const s2 = await call('POST', '/rentals', { token: tok['h-noid'], body: { productId: ids.products.p1.id, variantId: ids.products.p1.variantId, startDate: day(90), returnDate: day(92), pickupDate: day(90), holdState: 'NO_DOWN_PAYMENT' } });
    eq([s1.status, s2.status], [400, 400], 'admin update / customer booking');
    eq(hold(mB.id), 'ID_VERIFIED|AWAITING_DOWN_PAYMENT|set', 'unchanged');
  });

  // =========================================================================
  console.log('\n9. round 2: money never forfeited nor held indefinitely, bounded in-flight, no-show, reminders');
  const reminders = [];
  notif.sendRentalHoldReminder = async (p) => { reminders.push(p); return { sent: true }; };
  const remindersFor = (rn) => reminders.filter((e) => e.rentalNumber === rn);
  const setDeadline = (rid, sqlInterval) => sql(`UPDATE "RentalOrder" SET "holdExpiresAt" = (now() AT TIME ZONE 'UTC') + interval '${sqlInterval}' WHERE id = '${rid}'`);
  const field = (rid, col) => sql(`SELECT COALESCE("${col}"::text, '-') FROM "RentalOrder" WHERE id = '${rid}'`);
  const auditDetails = (action, rid) => JSON.parse(sql(`SELECT details FROM "AdminActivityLog" WHERE action = '${action}' AND "entityId" = '${rid}' ORDER BY "createdAt" DESC LIMIT 1`) || 'null');
  const otherCustomerBooks = (r) => call('POST', '/rentals', { token: tok['h-r2-other'], body: { productId: r.productId, variantId: r.variantId, startDate: r.startDate.slice(0, 10), returnDate: r.returnDate.slice(0, 10), pickupDate: r.pickupDate.slice(0, 10) } });
  await submitId(tok['h-r2-pay']); await approve('h-r2-pay');
  await submitId(tok['h-r2-other']); await approve('h-r2-other');

  // 9a: partial payment past the deadline → staff review, dates still held
  const pr = (await book(tok['h-r2-pay'])).data;
  await pay(superTok, pr.id, 10000, 'COMPLETED'); // < the 25,000 down payment
  expireNow(pr.id);
  await runCron();
  await check('partial payment, deadline passed: NOT cancelled — PAYMENT_REVIEW for 72 h, audited in notes, no customer email', async () => {
    eq(hold(pr.id), 'ID_VERIFIED|PAYMENT_REVIEW|set', 'hold');
    near(hoursLeft(pr.id), 72, 'review window');
    assert(/\[Payment review .*with 10000 TZS received; staff review until/.test(field(pr.id, 'notes')), 'note');
    eq(mailsFor(pr.rentalNumber).length, 0, 'no release email');
  });
  await check('…the item stays reserved meanwhile (another customer can\'t book those dates)', async () => {
    const o = await otherCustomerBooks(pr);
    eq(o.status, 409, 'overlap refused');
  });
  await check('MANAGER can extend it (rentals:update-status), back to waiting for the down payment; audited', async () => {
    const until = new Date(Date.now() + 2 * 86400e3).toISOString();
    const r = await call('PATCH', `/rentals/${pr.id}/hold/extend`, { token: managerTok, body: { until, note: 'Customer pays the rest on Friday' } });
    eq(r.status, 200, `extend ${JSON.stringify(r.data).slice(0, 120)}`);
    eq(hold(pr.id), 'ID_VERIFIED|AWAITING_DOWN_PAYMENT|set', 'hold');
    near(hoursLeft(pr.id), 48, 'new deadline');
    const d = auditDetails('HOLD_EXTENDED', pr.id);
    eq([d.from.holdState, d.to.holdState, d.note], ['PAYMENT_REVIEW', 'AWAITING_DOWN_PAYMENT', 'Customer pays the rest on Friday'], 'audit');
  });
  await check('extensions are bounded (> 7 days and after the pickup day refused; STAFF 403)', async () => {
    const a = await call('PATCH', `/rentals/${pr.id}/hold/extend`, { token: managerTok, body: { until: new Date(Date.now() + 8 * 86400e3).toISOString(), note: 'x' } });
    const b = await call('PATCH', `/rentals/${pr.id}/hold/extend`, { token: staffTok, body: { until: new Date(Date.now() + 86400e3).toISOString(), note: 'x' } });
    eq([a.status, b.status], [400, 403], 'codes');
  });
  await pay(superTok, pr.id, Number(pr.downPaymentAmount) - 10000, 'COMPLETED');
  await check('…the rest is paid: confirmed by the normal settlement', async () => eq(statusOf(pr.id), 'DOWN_PAYMENT_PAID', 'status'));

  // 9b: review window ends unresolved → released, money flagged, never forfeited
  const rr = (await book(tok['h-r2-pay'])).data;
  await pay(superTok, rr.id, 10000, 'COMPLETED');
  expireNow(rr.id);
  await runCron(); // → PAYMENT_REVIEW
  expireNow(rr.id); // staff did nothing for 72 h
  await runCron();
  await check('PAYMENT_REVIEW unresolved: released (CANCELLED) and the money flagged REFUND_DUE; customer told it is held for refund', async () => {
    eq(hold(rr.id), 'CANCELLED|REFUND_DUE|set', 'hold');
    assert(/10000 TZS received is due for refund \(REFUND_DUE\)/.test(field(rr.id, 'notes')), 'note');
    const m = mailsFor(rr.rentalNumber);
    eq([m.length, m[0]?.moneyHeld], [1, true], 'email');
    eq(payments(rr.id), '1:10000.00', 'the payment is untouched (no forfeiture, no deletion)');
  });
  await check('…the dates are free again (another customer can book them)', async () => {
    const o = await otherCustomerBooks(rr);
    eq(o.status, 201, `rebook ${JSON.stringify(o.data).slice(0, 100)}`);
  });
  await check('REFUND_DUE stays an outstanding liability: no API marks it refunded, no payment row is written or changed', async () => {
    const r = await call('PATCH', `/rentals/${rr.id}/refund-recorded`, { token: superTok, body: { amount: 10000, method: 'MOBILE_MONEY', note: 'x' } });
    eq(r.status, 404, 'no refund-recording route on PR #16 (refunds belong to the rental refund ledger after P0c)');
    await runCron();
    eq([field(rr.id, 'status'), field(rr.id, 'holdState')], ['CANCELLED', 'REFUND_DUE'], 'flag unchanged by later runs');
    eq(payments(rr.id), '1:10000.00', 'collection row untouched, no refund row invented');
    eq(sql(`SELECT count(*) FROM "Payment" WHERE "rentalOrderId" = '${rr.id}' AND status = 'REFUNDED'`), '0', 'nothing marked refunded');
  });

  // 9c: staff cancel a booking that holds money
  const sc = (await book(tok['h-r2-pay'])).data;
  await pay(superTok, sc.id, 10000, 'COMPLETED');
  await check('a staff cancellation of a booking holding money flags it REFUND_DUE (audited)', async () => {
    const r = await call('PATCH', `/rentals/${sc.id}/status`, { token: managerTok, body: { status: 'CANCELLED' } });
    eq(r.status, 200, 'cancel');
    eq(field(sc.id, 'holdState'), 'REFUND_DUE', 'state');
    eq(auditDetails('UPDATE_STATUS', sc.id).holdState, 'REFUND_DUE', 'audit');
  });

  // 9d: bounded in-flight protection — repeated attempts can't postpone it
  const ip = (await book(tok['h-r2-pay'])).data;
  sql(`UPDATE "RentalOrder" SET "holdExpiresAt" = (now() AT TIME ZONE 'UTC') - interval '30 minutes' WHERE id = '${ip.id}'`);
  const lateAttempt = await pay(superTok, ip.id, 10000, 'PENDING'); // started AFTER the deadline
  await runCron();
  await check('a payment started AFTER the deadline does not protect the booking (released)', async () => {
    eq(statusOf(ip.id), 'CANCELLED', 'status');
  });
  const ip2 = (await book(tok['h-r2-pay'])).data;
  const early = await pay(superTok, ip2.id, 10000, 'PENDING');
  sql(`UPDATE "Payment" SET "createdAt" = (now() AT TIME ZONE 'UTC') - interval '3 hours 5 minutes' WHERE id = '${early}'`);
  sql(`UPDATE "RentalOrder" SET "holdExpiresAt" = (now() AT TIME ZONE 'UTC') - interval '1 hour' WHERE id = '${ip2.id}'`);
  for (let i = 0; i < 3; i++) await pay(superTok, ip2.id, 10000, 'PENDING'); // new attempts after the deadline
  await runCron();
  await check('started before the deadline: protected within the 2 h grace, even with new attempts after it', async () => {
    eq(statusOf(ip2.id), 'ID_VERIFIED', 'status');
  });
  sql(`UPDATE "RentalOrder" SET "holdExpiresAt" = (now() AT TIME ZONE 'UTC') - interval '2 hours 1 minute' WHERE id = '${ip2.id}'`);
  await runCron();
  await check('…grace over (deadline + 2 h): released despite 4 attempts in flight', async () => {
    eq(statusOf(ip2.id), 'CANCELLED', 'status');
    eq(lateAttempt.length > 0, true, 'late attempt existed');
  });

  // 9e: explicit no-show rule for confirmed bookings
  const ns = (await book(tok['h-r2-pay'])).data;
  await pay(superTok, ns.id, Number(ns.downPaymentAmount), 'COMPLETED');
  pickupPast(ns.id);
  await runCron();
  await check('no-show: a CONFIRMED booking not collected by its pickup day → NO_SHOW_REVIEW, never cancelled', async () => {
    eq([statusOf(ns.id), field(ns.id, 'holdState')], ['DOWN_PAYMENT_PAID', 'NO_SHOW_REVIEW'], 'state');
    assert(/\[No-show review /.test(field(ns.id, 'notes')), 'note');
  });
  await check('…staff reschedule the pickup to a live day: the no-show flag clears', async () => {
    const r = await call('PATCH', `/rentals/${ns.id}`, { token: superTok, body: { pickupDate: ns.startDate.slice(0, 10) } });
    eq(r.status, 200, 'reschedule');
    eq(field(ns.id, 'holdState'), '-', 'cleared');
  });

  // 9f: reminders
  const rp = (await book(tok['h-r2-pay'])).data; // AWAITING_DOWN_PAYMENT
  setDeadline(rp.id, '20 hours');
  const rid1 = (await book(tok['h-r2-noid'])).data; // AWAITING_ID
  setDeadline(rid1.id, '20 hours');
  const rpaused = (await book(tok['h-r2-rev'])).data;
  await submitId(tok['h-r2-rev']); // ID under staff review → no deadline
  const rfar = (await book(tok['h-r2-noid'])).data; // deadline still ~48 h away
  await runCron();
  await check('reminder ~24 h before a payment deadline: once, deadline in EAT, amount due, no ID details', async () => {
    const m = remindersFor(rp.rentalNumber);
    eq(m.length, 1, 'one reminder');
    eq([m[0].action, m[0].amountDue], ['PAY_DOWN_PAYMENT', Number(rp.downPaymentAmount)], 'content');
    assert(/^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} EAT$/.test(m[0].deadline), `EAT format ${m[0].deadline}`);
    assert(!/19900101|private:|idNumber/.test(JSON.stringify(m[0])), 'no ID data');
  });
  await check('reminder to upload an ID before an ID deadline; none while the ID waits for staff; none when > 24 h away', async () => {
    eq(remindersFor(rid1.rentalNumber).map((e) => e.action), ['UPLOAD_ID'], 'upload-ID reminder');
    eq([remindersFor(rpaused.rentalNumber).length, remindersFor(rfar.rentalNumber).length], [0, 0], 'no reminders');
  });
  await runCron();
  await check('no duplicate on the next runs', async () => eq(remindersFor(rp.rentalNumber).length, 1, 'still one'));
  await call('PATCH', `/rentals/${rp.id}/hold/extend`, { token: superTok, body: { until: new Date(Date.now() + 22 * 3600e3).toISOString(), note: 'More time' } });
  await runCron();
  await check('a NEW deadline (staff extension) re-arms exactly one new reminder', async () => eq(remindersFor(rp.rentalNumber).length, 2, 'two in total'));
  const rc = (await book(tok['h-r2-pay'])).data;
  setDeadline(rc.id, '20 hours');
  await pay(superTok, rc.id, Number(rc.downPaymentAmount), 'COMPLETED'); // confirmed before the run
  const rcan = (await book(tok['h-r2-pay'])).data;
  setDeadline(rcan.id, '20 hours');
  await call('PATCH', `/rentals/${rcan.id}/status`, { token: superTok, body: { status: 'CANCELLED' } });
  await runCron();
  await check('no reminder for confirmed or cancelled bookings', async () => {
    eq([remindersFor(rc.rentalNumber).length, remindersFor(rcan.rentalNumber).length], [0, 0], 'none');
  });
  // race: reminder run vs payment completion vs ID upload
  const raceP = (await book(tok['h-r2-pay'])).data; setDeadline(raceP.id, '20 hours');
  const raceP2 = await pay(superTok, raceP.id, Number(raceP.downPaymentAmount), 'PENDING');
  const raceI = (await book(tok['h-r2-race'])).data; setDeadline(raceI.id, '20 hours');
  await Promise.all([
    runCron(),
    call('PATCH', `/payments/${raceP2}`, { token: superTok, body: { status: 'COMPLETED' } }),
    submitId(tok['h-r2-race']),
  ]);
  await check('race — reminders vs payment completion vs ID upload: at most one reminder, final state consistent', async () => {
    const a = remindersFor(raceP.rentalNumber).length, b = remindersFor(raceI.rentalNumber).length;
    assert(a <= 1 && b <= 1, `reminders ${a}/${b}`);
    eq([statusOf(raceP.id), field(raceI.id, 'holdState')], ['DOWN_PAYMENT_PAID', 'ID_UNDER_REVIEW'], 'final');
    return `payment race: ${a} reminder, ID race: ${b} reminder`;
  });
  await prisma.$disconnect();
}

const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
