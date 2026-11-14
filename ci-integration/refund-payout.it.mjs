// refunds:payout — the three-person refund workflow, real API + real Postgres
// (local branch local/refund-payout-permission). Isolated schema it_payout
// seeded by refund-payout-seed.js. Never production.
//   PSQL=<psql> IT_API=http://localhost:4177/api/v1 node refund-payout.it.mjs <ids.json>
// People (custom roles, this schema only): CASHIER (desk + refunds:payout, NO
// payments:manage), MANAGER (reviewer: refunds:approve, deductions, ID review),
// OWNER (refunds:approve + payments:manage). Two non-staff identities: a PROBE
// holding ONLY refunds:payout (route matrix) and a SUPER_ADMIN (no bypass).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const API = (process.env.IT_API || 'http://localhost:4177/api/v1').replace(/\/$/, '');
if (!/^http:\/\/localhost:/.test(API)) throw new Error('refusing: IT_API must be localhost');
const SCHEMA = process.env.IT_SCHEMA || 'it_payout';
const ids = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const A = ids.a, B = ids.b, T = A.tenantId, G = A.gown, S = A.sessions, P = A.admins;
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/18/bin/psql.exe';
const sql = (q) => execFileSync(PSQL, ['-U', 'naro_admin', '-h', process.env.PGHOST || 'localhost', '-d', 'naro_fashion', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
  '-c', `SET search_path TO ${SCHEMA}`, '-c', q], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\r/g, '').trim();
const sqlErr = (q) => { try { sql(q); return null; } catch (e) { return String(e.stderr || e.message); } };
const ip = (s) => { const h = createHash('sha256').update(String(s)).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
async function call(method, p, { token, body, tenant = T, headers = {} } = {}) {
  const r = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenant, 'X-Forwarded-For': ip(token || body?.email || randomBytes(4).toString('hex')), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data, headers: r.headers };
}
const results = [];
async function check(name, fn) {
  try { const n = await fn(); results.push('PASS'); console.log(`  ✔ ${name}${n ? `  — ${n}` : ''}`); }
  catch (e) { results.push('FAIL'); console.log(`  ✖ ${name}\n      ${String(e?.message || e).split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
const login = async (w) => { const r = await call('POST', '/auth/login', { body: { email: w.email, password: w.password } }); assert(r.data?.accessToken, `login ${w.email} ${r.status}`); return r.data.accessToken; };
const tok = {};
for (const k of Object.keys(P)) tok[k] = await login(P[k]);
tok.superB = await login(B.admins.super);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const reqRow = (id) => sql(`SELECT status || '|' || "requestedById" || '|' || COALESCE("approvedById", '-') || '|' || COALESCE("paidById", '-') FROM "RentalRefundRequest" WHERE id = '${id}'`);
const refundedRows = (id) => sql(`SELECT count(*) FROM "Payment" WHERE "refundRequestId" = '${id}' AND status = 'REFUNDED'`);
const ref = () => 'PO' + randomBytes(5).toString('hex').toUpperCase();
const rentalPay = (id, token, body, headers) => call('PATCH', `/rental-money/refund-requests/${id}/pay`, { token, body, headers });
const unifiedPay = (id, token, body, headers) => call('PATCH', `/refund-requests/${id}/pay`, { token, body, headers });

// ---- helpers
let seq = 0;
async function booking(variantId, start, { fee = 0, deposit = 0, address = false } = {}) {
  const c = (await call('POST', '/pos-rentals/customers', { token: tok.cashier, body: { firstName: 'Payout', lastName: `C${++seq}`, phone: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } })).data;
  if (address) await call('POST', `/pos-rentals/customers/${c.id}/address`, { token: tok.cashier, body: { street: 'Mwenge 12', city: 'Dar es Salaam', region: 'Dar es Salaam' } });
  const b = await call('POST', '/pos-rentals', { token: tok.cashier, body: { customerId: c.id, productId: G.id, variantId, startDate: day(start), returnDate: day(start + 2), pickupDate: day(start), termsAccepted: true } });
  assert(b.status === 201, `book ${b.status} ${JSON.stringify(b.data).slice(0, 160)}`);
  const id = b.data.id;
  const v = await call('POST', `/pos-rentals/${id}/id-in-person`, { token: tok.manager, body: { idType: 'NATIONAL_ID', idNumber: `1985${String(seq).padStart(4, '0')}-12345` } });
  assert(v.status === 201, `id ${v.status} ${JSON.stringify(v.data).slice(0, 120)}`);
  const [feeDue, depDue] = sql(`SELECT "totalRentalPrice"::int || '|' || "damageDeposit"::int FROM "RentalOrder" WHERE id = '${id}'`).split('|').map(Number);
  for (const [component, amount] of [['RENTAL_FEE', fee === 'full' ? feeDue : fee], ['DEPOSIT', deposit === 'full' ? depDue : deposit]]) {
    if (!amount) continue;
    const p = await call('POST', `/pos-rentals/${id}/payments`, { token: tok.cashier, body: { component, sessionId: S.cashier, tenders: [{ method: 'CASH', amount }] } });
    assert(p.status === 201, `pay ${component} ${p.status} ${JSON.stringify(p.data).slice(0, 120)}`);
  }
  return { id, feeDue, depDue };
}
async function cancelledWith100k(start, variant = G.S) {
  const b = await booking(variant, start, { fee: 100000 });
  const c = await call('PATCH', `/rentals/${b.id}/status`, { token: tok.cashier, body: { status: 'CANCELLED' } });
  assert(c.status === 200, `cancel ${c.status} ${JSON.stringify(c.data).slice(0, 120)}`);
  return b.id;
}
// What the cancellation job writes (#36: requester SYSTEM:LATE_PAYMENT / SYSTEM:HOLD_EXPIRY), test schema only.
function systemRequest(rentalId, who = 'SYSTEM:LATE_PAYMENT') {
  const id = `it-sys-${randomBytes(6).toString('hex')}`;
  sql(`INSERT INTO "RentalRefundRequest" (id, "tenantId", "rentalOrderId", subject, kind, component, amount, "retainedAmount", reason, status, "requestedById", "createdAt", "updatedAt")
       VALUES ('${id}', '${T}', '${rentalId}', 'RENTAL', 'CANCELLATION', 'RENTAL_FEE', 100000, 0, 'raised by the system (${who})', 'REQUESTED', '${who}', now(), now())`);
  return id;
}

console.log(`real API ${API} · isolated schema ${SCHEMA} · refunds:payout, three people`);

// ============================================================================ 0. route matrix
console.log('\n0. what refunds:payout allows (probe identity holding ONLY refunds:payout)');
const oneSys = systemRequest(await cancelledWith100k(10));
await check('reads the refund lists (unified + rental) and one request: 200', async () => {
  eq([(await call('GET', '/refund-requests', { token: tok.probe })).status, (await call('GET', '/rental-money/refund-requests', { token: tok.probe })).status,
    (await call('GET', `/refund-requests/${oneSys}`, { token: tok.probe })).status], [200, 200, 200], 'reads');
});
await check('cannot request, approve, reject, retry, reverse, PATCH/POST /payments, or touch payment methods / ledger: all 403, nothing written', async () => {
  const before = sql(`SELECT count(*) || '|' || (SELECT count(*) FROM "Payment") FROM "RentalRefundRequest"`);
  const pid = sql(`SELECT id FROM "Payment" WHERE "orderId" = '${A.orders[1]}' LIMIT 1`);
  const rid = sql(`SELECT "rentalOrderId" FROM "RentalRefundRequest" WHERE id = '${oneSys}'`);
  const tries = [
    ['PATCH', `/refund-requests/${oneSys}/approve`, {}],
    ['PATCH', `/refund-requests/${oneSys}/reject`, { reason: 'no' }],
    ['PATCH', `/rental-money/refund-requests/${oneSys}/approve`, {}],
    ['PATCH', `/rental-money/refund-requests/${oneSys}/reject`, { reason: 'no' }],
    ['POST', `/refund-requests/${oneSys}/retry`, { reason: 'again' }],
    ['POST', `/rental-money/rentals/${rid}/refund-requests`, { kind: 'CANCELLATION', component: 'RENTAL_FEE', amount: 1, reason: 'x' }],
    ['POST', `/orders/${A.orders[1]}/refunds`, { amount: 1000, reason: 'x' }],
    ['POST', '/payments', { orderId: A.orders[1], amount: 1000, method: 'MPESA' }],
    ['PATCH', `/payments/${pid}`, { status: 'COMPLETED' }],
    ['POST', `/pos/payments/${pid}/reverse`, { reason: 'x' }],
    ['GET', '/payment-methods/admin', null],
    ['POST', '/payment-methods', { name: 'x' }],
    ['PATCH', `/payment-methods/${pid}`, { name: 'x' }],
    ['GET', `/rental-money/rentals/${rid}/ledger`, null],
  ];
  const got = [];
  for (const [m, p, body] of tries) got.push(`${m} ${p.replace(/\/[a-z0-9-]{20,}/g, '/:id')} ${(await call(m, p, { token: tok.probe, body: body ?? undefined })).status}`);
  const bad = got.filter((g) => !g.endsWith(' 403'));
  assert(bad.length === 0, `not 403: ${bad.join('; ')}`);
  eq(sql(`SELECT count(*) || '|' || (SELECT count(*) FROM "Payment") FROM "RentalRefundRequest"`), before, 'nothing written');
  return `${tries.length} routes refused`;
});
await check('it CAN pay out an independently approved request it neither requested nor approved (mobile money + reference)', async () => {
  eq((await call('PATCH', `/rental-money/refund-requests/${oneSys}/approve`, { token: tok.manager })).status, 200, 'manager approves');
  const r = await rentalPay(oneSys, tok.probe, { method: 'MOBILE_MONEY', reference: ref() });
  eq([r.status, r.data?.status, refundedRows(oneSys)], [200, 'PAID', '1'], 'paid');
});
await check('another shop\'s approved request → 404 (pay and fail), untouched', async () => {
  eq([(await unifiedPay(B.approvedRequest, tok.probe, { method: 'MOBILE_MONEY', reference: ref() })).status,
    (await call('PATCH', `/refund-requests/${B.approvedRequest}/fail`, { token: tok.probe, body: { reason: 'x' } })).status,
    (await rentalPay(B.approvedRequest, tok.probe, { method: 'MOBILE_MONEY', reference: ref() })).status,
    (await unifiedPay(B.approvedRequest, tok.cashier, { method: 'MOBILE_MONEY', reference: ref() })).status], [404, 404, 404, 404], 'cross-tenant');
  eq(sql(`SELECT status FROM "RentalRefundRequest" WHERE id = '${B.approvedRequest}'`), 'APPROVED', 'B unchanged');
});

// ============================================================================ a. staff-requested rental refund
console.log('\n(a) staff-requested rental refund: cashier requests → manager approves → owner pays');
let qa;
await check('cashier cancels a paid booking and requests the refund; manager approves', async () => {
  const rid = await cancelledWith100k(20);
  const r = await call('POST', `/rental-money/rentals/${rid}/refund-requests`, { token: tok.cashier, body: { kind: 'CANCELLATION', component: 'RENTAL_FEE', amount: 100000, reason: 'customer cancelled' } });
  eq(r.status, 201, `request ${JSON.stringify(r.data).slice(0, 100)}`);
  qa = r.data.id;
  eq((await call('PATCH', `/rental-money/refund-requests/${qa}/approve`, { token: tok.cashier })).status, 403, 'cashier cannot approve (no refunds:approve)');
  eq((await call('PATCH', `/rental-money/refund-requests/${qa}/approve`, { token: tok.manager })).status, 200, 'manager approves');
});
await check('the cashier (requester) cannot pay it even with refunds:payout → 403 PAYOUT_BY_REQUESTER; the manager has no payout right → 403', async () => {
  const c = await rentalPay(qa, tok.cashier, { method: 'CASH', sessionId: S.cashier });
  eq([c.status, c.data?.code], [403, 'PAYOUT_BY_REQUESTER'], 'cashier');
  eq((await rentalPay(qa, tok.manager, { method: 'MOBILE_MONEY', reference: ref() })).status, 403, 'manager');
  eq(reqRow(qa).split('|')[0], 'APPROVED', 'unpaid');
});
await check('the owner pays it (payments:manage still pays out); three different people on the row', async () => {
  const r = await rentalPay(qa, tok.owner, { method: 'MOBILE_MONEY', reference: ref() });
  eq([r.status, r.data?.status], [200, 'PAID'], 'paid');
  eq(reqRow(qa), `PAID|${P.cashier.id}|${P.manager.id}|${P.owner.id}`, 'requester / approver / payer');
});

// ============================================================================ b. system-raised
console.log('\n(b) system-raised refund (SYSTEM:LATE_PAYMENT / SYSTEM:HOLD_EXPIRY): manager approves → cashier pays with refunds:payout');
let qb;
await check('manager approves a SYSTEM:LATE_PAYMENT request; manager cannot pay; cashier pays CASH from their OWN shift', async () => {
  qb = systemRequest(await cancelledWith100k(30), 'SYSTEM:LATE_PAYMENT');
  eq((await call('PATCH', `/rental-money/refund-requests/${qb}/approve`, { token: tok.manager })).status, 200, 'approved');
  eq((await rentalPay(qb, tok.manager, { method: 'CASH', sessionId: S.cashier })).status, 403, 'manager');
  const wrongShift = await rentalPay(qb, tok.cashier, { method: 'CASH', sessionId: S.owner });
  eq(wrongShift.status, 400, 'someone else\'s shift refused');
  const r = await rentalPay(qb, tok.cashier, { method: 'CASH', sessionId: S.cashier });
  eq([r.status, r.data?.status], [200, 'PAID'], 'paid');
  eq(sql(`SELECT "gatewayResponse"->>'posSessionId' FROM "Payment" WHERE "refundRequestId" = '${qb}'`), S.cashier, 'cash left the cashier\'s drawer');
});
await check('SYSTEM:HOLD_EXPIRY with a SUPER_ADMIN approver: no bypass — the SUPER_ADMIN cannot pay (403 PAYOUT_BY_APPROVER); the cashier can', async () => {
  const q = systemRequest(await cancelledWith100k(40), 'SYSTEM:HOLD_EXPIRY');
  eq((await call('PATCH', `/rental-money/refund-requests/${q}/approve`, { token: tok.super })).status, 200, 'super approves');
  const s = await rentalPay(q, tok.super, { method: 'MOBILE_MONEY', reference: ref() });
  eq([s.status, s.data?.code], [403, 'PAYOUT_BY_APPROVER'], 'super');
  eq((await rentalPay(q, tok.cashier, { method: 'MOBILE_MONEY', reference: ref() })).status, 200, 'cashier');
});
await check('concurrent double payout (cashier CASH + owner mobile money at once): exactly one wins (409 for the other), one payout row', async () => {
  const q = systemRequest(await cancelledWith100k(50), 'SYSTEM:LATE_PAYMENT');
  eq((await call('PATCH', `/rental-money/refund-requests/${q}/approve`, { token: tok.manager })).status, 200, 'approved');
  const [x, y] = await Promise.all([rentalPay(q, tok.cashier, { method: 'CASH', sessionId: S.cashier }), rentalPay(q, tok.owner, { method: 'MOBILE_MONEY', reference: ref() })]);
  eq([x.status, y.status].sort(), [200, 409], 'one winner');
  eq(refundedRows(q), '1', 'one payout row');
  return `winner: ${x.status === 200 ? 'cashier' : 'owner'}`;
});

// ============================================================================ c. deposit kept after a deduction
console.log('\n(c) deposit return KEEPING money after a manager deduction');
let tpl;
await check('setup: manager prepares the gown checklist (product template)', async () => {
  const t = await call('POST', '/rental-checklists/templates', { token: tok.manager, body: { name: 'Payout gown', productId: G.id, items: [
    { label: 'Gown', itemType: 'DISPATCH', quantity: 1 }, { label: 'Stains / odour check', itemType: 'RETURN' }] } });
  eq(t.status, 201, `template ${JSON.stringify(t.data).slice(0, 120)}`);
  tpl = t.data;
  return tpl.approvalStatus ? `template ${tpl.approvalStatus}` : 'template live';
});
const dep = await booking(G.M, 60, { fee: 'full', deposit: 'full', address: true });
let disc, q1, q2;
await check('cashier hands over (complete checklist), takes the return and records the gown DAMAGED → OPEN discrepancy', async () => {
  const st = (await call('GET', `/rental-checklist/rentals/${dep.id}`, { token: tok.cashier })).data;
  const gown = st.items.find((i) => i.label === 'Gown');
  eq((await call('POST', `/rental-checklist/rentals/${dep.id}/records`, { token: tok.cashier, body: { stage: 'HANDOVER', entries: [{ snapshotItemId: gown.id, quantity: 1, condition: 'GOOD' }] } })).status, 201, 'handover record');
  const h = await call('POST', `/pos-rentals/${dep.id}/handover`, { token: tok.cashier, body: {} });
  eq(h.status, 201, `handover ${JSON.stringify(h.data).slice(0, 160)}`);
  eq((await call('POST', `/pos-rentals/${dep.id}/return`, { token: tok.cashier, body: { condition: 'MINOR_DAMAGE', notes: 'see checklist' } })).status, 201, 'returned');
  const st2 = (await call('GET', `/rental-checklist/rentals/${dep.id}`, { token: tok.cashier })).data;
  const r = await call('POST', `/rental-checklist/rentals/${dep.id}/records`, { token: tok.cashier, body: { stage: 'RETURN', entries: st2.items.map((i) => ({ snapshotItemId: i.id, quantity: 1, condition: i.label === 'Gown' ? 'DAMAGED' : 'GOOD', note: i.label === 'Gown' ? 'torn lace' : undefined })) } });
  eq(r.status, 201, `return record ${JSON.stringify(r.data).slice(0, 160)}`);
  disc = r.data.discrepancies.find((d) => d.status === 'OPEN');
  assert(disc, 'open discrepancy');
});
await check('the cashier (who recorded the return) cannot decide it; the manager decides RESOLVED_DEDUCTED', async () => {
  eq((await call('PATCH', `/rental-checklist/discrepancies/${disc.id}/resolve`, { token: tok.cashier, body: { resolution: 'RESOLVED_DEDUCTED', note: 'x' } })).status, 403, 'cashier');
  eq((await call('PATCH', `/rental-checklist/discrepancies/${disc.id}/resolve`, { token: tok.manager, body: { resolution: 'RESOLVED_DEDUCTED', note: 'Lace repair TZS 50,000' } })).status, 200, 'manager deducts');
});
await check('WHY the decider must be the requester: if the CASHIER requests, nobody of the three may pay it (requester, approver, decider)', async () => {
  const r = await call('POST', `/rental-money/rentals/${dep.id}/refund-requests`, { token: tok.cashier, body: { kind: 'DEPOSIT_RETURN', component: 'DEPOSIT', amount: dep.depDue - 50000, retainedAmount: 50000, reason: 'lace repair' } });
  eq(r.status, 201, `cashier request ${JSON.stringify(r.data).slice(0, 120)}`);
  q1 = r.data.id;
  const m = await call('PATCH', `/rental-money/refund-requests/${q1}/approve`, { token: tok.manager });
  eq([m.status, m.data?.code], [403, 'DEDUCTION_DECIDER'], 'decider cannot approve');
  eq((await call('PATCH', `/rental-money/refund-requests/${q1}/approve`, { token: tok.owner })).status, 200, 'owner approves');
  const c = await rentalPay(q1, tok.cashier, { method: 'CASH', sessionId: S.cashier });
  const o = await rentalPay(q1, tok.owner, { method: 'CASH', sessionId: S.owner });
  const m2 = await rentalPay(q1, tok.manager, { method: 'MOBILE_MONEY', reference: ref() });
  eq([c.data?.code, o.data?.code, m2.status], ['PAYOUT_BY_REQUESTER', 'PAYOUT_BY_APPROVER', 403], 'cashier / owner / manager (no payout right)');
  // Even if the manager held a payout permission: the database refuses the decider as payer.
  const e = sqlErr(`UPDATE "RentalRefundRequest" SET status = 'PAID', "paidById" = '${P.manager.id}', "paidAt" = now() WHERE id = '${q1}'`);
  assert(/R3_REFUND_SEPARATION/.test(e || ''), `decider as payer: ${(e || 'ALLOWED').split('\n')[0]}`);
  eq(reqRow(q1).split('|')[0], 'APPROVED', 'still unpaid');
  const s = await rentalPay(q1, tok.super, { method: 'MOBILE_MONEY', reference: ref() }); // a 4th person (SUPER_ADMIN) could
  eq(s.status, 200, 'only a fourth person can pay this one');
  return 'paid by a 4th identity only to show it; the decider as payer is refused by API (DEDUCTION_DECIDER) and database';
});
const dep2 = await booking(G.M, 80, { fee: 'full', deposit: 'full', address: true });
await check('the workable path: manager decides AND requests → owner approves → cashier pays with refunds:payout (3 people)', async () => {
  const st = (await call('GET', `/rental-checklist/rentals/${dep2.id}`, { token: tok.cashier })).data;
  await call('POST', `/rental-checklist/rentals/${dep2.id}/records`, { token: tok.cashier, body: { stage: 'HANDOVER', entries: [{ snapshotItemId: st.items.find((i) => i.label === 'Gown').id, quantity: 1, condition: 'GOOD' }] } });
  eq((await call('POST', `/pos-rentals/${dep2.id}/handover`, { token: tok.cashier, body: {} })).status, 201, 'handover');
  eq((await call('POST', `/pos-rentals/${dep2.id}/return`, { token: tok.cashier, body: { condition: 'MINOR_DAMAGE', notes: 'stain' } })).status, 201, 'return');
  const st2 = (await call('GET', `/rental-checklist/rentals/${dep2.id}`, { token: tok.cashier })).data;
  const rr = await call('POST', `/rental-checklist/rentals/${dep2.id}/records`, { token: tok.cashier, body: { stage: 'RETURN', entries: st2.items.map((i) => ({ snapshotItemId: i.id, quantity: 1, condition: i.label === 'Gown' ? 'DAMAGED' : 'GOOD' })) } });
  const d = rr.data.discrepancies.find((x) => x.status === 'OPEN');
  eq((await call('PATCH', `/rental-checklist/discrepancies/${d.id}/resolve`, { token: tok.manager, body: { resolution: 'RESOLVED_DEDUCTED', note: 'stain removal 50,000' } })).status, 200, 'manager deducts');
  const r = await call('POST', `/rental-money/rentals/${dep2.id}/refund-requests`, { token: tok.manager, body: { kind: 'DEPOSIT_RETURN', component: 'DEPOSIT', amount: dep2.depDue - 50000, retainedAmount: 50000, reason: 'stain removal' } });
  eq(r.status, 201, `manager (decider) may request ${JSON.stringify(r.data).slice(0, 120)}`);
  q2 = r.data.id;
  eq((await call('PATCH', `/rental-money/refund-requests/${q2}/approve`, { token: tok.owner })).status, 200, 'owner approves');
  eq((await rentalPay(q2, tok.owner, { method: 'CASH', sessionId: S.owner })).data?.code, 'PAYOUT_BY_APPROVER', 'owner cannot pay');
  const p = await rentalPay(q2, tok.cashier, { method: 'CASH', sessionId: S.cashier });
  eq([p.status, p.data?.status], [200, 'PAID'], 'cashier pays');
  eq(reqRow(q2), `PAID|${P.manager.id}|${P.owner.id}|${P.cashier.id}`, 'decider+requester / approver / payer');
  eq(sql(`SELECT amount::int FROM "Payment" WHERE "refundRequestId" = '${q2}' AND status = 'REFUNDED'`), String(dep2.depDue - 50000), 'only the refundable part paid; 50,000 kept');
});

// ============================================================================ d. order + POS sale (R1b unified)
console.log('\n(d) online order refund + POS sale refund (unified /refund-requests): cashier requests → manager approves → owner pays');
await check('online order: cashier requests 20,000 → manager approves → cashier 403 PAYOUT_BY_REQUESTER → owner double-clicks: one 200, one 409, one payout row', async () => {
  const r = await call('POST', `/orders/${A.orders[0]}/refunds`, { token: tok.cashier, body: { amount: 20000, reason: 'damaged item returned' } });
  eq(r.status, 201, `request ${JSON.stringify(r.data).slice(0, 100)}`);
  const id = r.data.refundRequest.id;
  eq((await call('PATCH', `/refund-requests/${id}/approve`, { token: tok.manager, body: {} })).status, 200, 'approved');
  eq((await unifiedPay(id, tok.cashier, { method: 'MOBILE_MONEY', reference: ref() })).data?.code, 'PAYOUT_BY_REQUESTER', 'cashier');
  const rr = ref();
  const [x, y] = await Promise.all([unifiedPay(id, tok.owner, { method: 'MOBILE_MONEY', reference: rr }), unifiedPay(id, tok.owner, { method: 'MOBILE_MONEY', reference: rr })]);
  eq([x.status, y.status].sort(), [200, 409], 'one winner');
  eq([refundedRows(id), sql(`SELECT "paymentStatus" FROM "Order" WHERE id = '${A.orders[0]}'`)], ['1', 'PARTIALLY_REFUNDED'], 'once');
});
let failedId;
await check('a payout that bounced: owner paid, the CASHIER (refunds:payout) records the failure → payout REVERSED, money owed again', async () => {
  const r = await call('POST', `/orders/${A.orders[1]}/refunds`, { token: tok.cashier, body: { amount: 15000, reason: 'late delivery goodwill' } });
  const id = r.data.refundRequest.id;
  eq((await call('PATCH', `/refund-requests/${id}/approve`, { token: tok.manager, body: {} })).status, 200, 'manager approves');
  eq((await unifiedPay(id, tok.owner, { method: 'MOBILE_MONEY', reference: ref() })).status, 200, 'owner pays');
  eq((await call('PATCH', `/refund-requests/${id}/fail`, { token: tok.manager, body: { reason: 'x' } })).status, 403, 'manager has no payout right');
  const f = await call('PATCH', `/refund-requests/${id}/fail`, { token: tok.cashier, body: { reason: 'number not registered' } });
  eq([f.status, f.data?.status, sql(`SELECT status FROM "Payment" WHERE "refundRequestId" = '${id}'`), sql(`SELECT "paymentStatus" FROM "Order" WHERE id = '${A.orders[1]}'`)],
    [200, 'FAILED', 'REVERSED', 'REFUND_PENDING'], 'failure recorded');
  failedId = id;
});
await check('retry is a NEW request: the payout-only probe cannot retry (403); the cashier retries as a requester (orders:refund) → manager approves → cashier 403 → owner pays', async () => {
  eq((await call('POST', `/refund-requests/${failedId}/retry`, { token: tok.probe, body: { reason: 'again' } })).status, 403, 'probe');
  const t = await call('POST', `/refund-requests/${failedId}/retry`, { token: tok.cashier, body: { reason: 'pay by bank instead' } });
  eq([t.status, t.data?.status, t.data?.requestedById], [201, 'REQUESTED', P.cashier.id], 'retry');
  eq((await call('PATCH', `/refund-requests/${t.data.id}/approve`, { token: tok.manager, body: {} })).status, 200, 'manager approves');
  eq((await unifiedPay(t.data.id, tok.cashier, { method: 'BANK_TRANSFER', reference: ref(), verificationNote: 'customer asked for bank' })).data?.code, 'PAYOUT_BY_REQUESTER', 'cashier');
  eq((await unifiedPay(t.data.id, tok.owner, { method: 'BANK_TRANSFER', reference: ref(), verificationNote: 'customer asked for bank' })).status, 200, 'owner pays');
});
await check('POS sale: cashier sells + requests the refund → manager approves → owner pays CASH from the OWNER\'s shift; restocked', async () => {
  const s = await call('POST', '/pos/sales', { token: tok.cashier, body: { sessionId: S.cashier, items: [{ productId: A.scarf.id, variantId: A.scarf.variantId, quantity: 2, unitPrice: 10000 }], payments: [{ method: 'CASH', amount: 20000 }] } });
  const sale = s.data?.order ?? s.data;
  assert(s.status === 201 && sale?.id, `sale ${s.status} ${JSON.stringify(s.data).slice(0, 120)}`);
  const item = sql(`SELECT id FROM "OrderItem" WHERE "orderId" = '${sale.id}'`);
  const stock = () => Number(sql(`SELECT stock FROM "ProductVariant" WHERE id = '${A.scarf.variantId}'`));
  const r = await call('POST', `/pos/sales/${sale.id}/refund`, { token: tok.cashier, body: { items: [{ orderItemId: item, quantity: 1, condition: 'RESALEABLE' }], refundMethod: 'CASH', reason: 'wrong colour' } });
  eq(r.status, 201, `request ${JSON.stringify(r.data).slice(0, 100)}`);
  const id = r.data.refundRequest.id;
  eq((await call('PATCH', `/refund-requests/${id}/approve`, { token: tok.manager, body: {} })).status, 200, 'approved');
  eq((await unifiedPay(id, tok.cashier, { method: 'CASH' })).data?.code, 'PAYOUT_BY_REQUESTER', 'cashier');
  const before = stock();
  eq((await unifiedPay(id, tok.owner, { method: 'CASH' })).status, 200, 'owner pays');
  eq([stock() - before, sql(`SELECT "gatewayResponse"->>'posSessionId' FROM "Payment" WHERE "refundRequestId" = '${id}'`)], [1, S.owner], 'restocked, owner\'s drawer');
});

// ============================================================================ e. someone away
console.log('\n(e) someone away: what waits (nothing is bypassed)');
await check('owner away: system-raised refunds still flow (manager approves, cashier pays); a cashier-requested one waits APPROVED', async () => {
  const q = systemRequest(await cancelledWith100k(100), 'SYSTEM:HOLD_EXPIRY');
  eq((await call('PATCH', `/rental-money/refund-requests/${q}/approve`, { token: tok.manager })).status, 200, 'manager');
  eq((await rentalPay(q, tok.cashier, { method: 'MOBILE_MONEY', reference: ref() })).status, 200, 'cashier pays');
  const rid = await cancelledWith100k(110);
  const s = (await call('POST', `/rental-money/rentals/${rid}/refund-requests`, { token: tok.cashier, body: { kind: 'CANCELLATION', component: 'RENTAL_FEE', amount: 100000, reason: 'cancelled' } })).data.id;
  eq((await call('PATCH', `/rental-money/refund-requests/${s}/approve`, { token: tok.manager })).status, 200, 'manager');
  eq([(await rentalPay(s, tok.cashier, { method: 'MOBILE_MONEY', reference: ref() })).data?.code, (await rentalPay(s, tok.manager, { method: 'MOBILE_MONEY', reference: ref() })).status], ['PAYOUT_BY_REQUESTER', 403], 'present people');
  eq(reqRow(s).split('|')[0], 'APPROVED', 'waits for the owner');
});
await check('manager away: a cashier-requested refund waits REQUESTED. If the owner approves it instead, NOBODY of the three may pay it and an approved order refund cannot be rejected (409)', async () => {
  const r = await call('POST', `/orders/${A.orders[0]}/refunds`, { token: tok.cashier, body: { amount: 10000, reason: 'manager away test' } });
  const id = r.data.refundRequest.id;
  eq(reqRow(id).split('|')[0], 'REQUESTED', 'waits for an approver');
  eq((await call('PATCH', `/refund-requests/${id}/approve`, { token: tok.owner, body: {} })).status, 200, 'owner approves (allowed)');
  eq([(await unifiedPay(id, tok.cashier, { method: 'MOBILE_MONEY', reference: ref() })).data?.code, (await unifiedPay(id, tok.owner, { method: 'MOBILE_MONEY', reference: ref() })).data?.code,
    (await unifiedPay(id, tok.manager, { method: 'MOBILE_MONEY', reference: ref() })).status], ['PAYOUT_BY_REQUESTER', 'PAYOUT_BY_APPROVER', 403], 'no payer among the three');
  eq((await call('PATCH', `/refund-requests/${id}/reject`, { token: tok.owner, body: { reason: 'undo' } })).status, 409, 'cannot be un-approved');
  eq(reqRow(id).split('|')[0], 'APPROVED', 'stuck until a fourth payer exists');
  return 'operating rule: the owner never approves a cashier-requested refund; it waits for the manager';
});
await check('cashier away: the manager / owner can request and approve, but nobody present may pay (the owner approved; the manager has no payout right)', async () => {
  const q = systemRequest(await cancelledWith100k(120), 'SYSTEM:LATE_PAYMENT');
  eq((await call('PATCH', `/rental-money/refund-requests/${q}/approve`, { token: tok.owner })).status, 200, 'owner approves');
  eq([(await rentalPay(q, tok.owner, { method: 'MOBILE_MONEY', reference: ref() })).data?.code, (await rentalPay(q, tok.manager, { method: 'MOBILE_MONEY', reference: ref() })).status], ['PAYOUT_BY_APPROVER', 403], 'present people');
  eq(reqRow(q).split('|')[0], 'APPROVED', 'waits for the cashier (or: the manager approves next time, then the owner pays)');
});

// ============================================================================ f. payout hardening (owner's list items 1, 5, 7, 8, 9)
console.log('\n(f) payout hardening: independent approval, caps, references, idempotency, audit + reconciliation records');
const approveRental = async (id) => eq((await call('PATCH', `/rental-money/refund-requests/${id}/approve`, { token: tok.manager })).status, 200, `approve ${id}`);
const heldRefunded = (rentalId) => sql(`SELECT COALESCE(sum(amount),0)::int FROM "Payment" WHERE "rentalOrderId" = '${rentalId}' AND status = 'REFUNDED'`);
const auditRow = (id, action) => sql(`SELECT "adminUserId" || '|' || COALESCE(details->>'amount','') || '|' || COALESCE(details->>'method','') || '|' || COALESCE(details->>'reference','') || '|' || COALESCE(details->>'paymentId','') || '|' || COALESCE(details->>'posSessionId','')
  FROM "AdminActivityLog" WHERE "entityId" = '${id}' AND action = '${action}' ORDER BY "createdAt" DESC LIMIT 1`);
// What shift reconciliation (R4, pos/shift-reconciliation.ts) reads from a payout row: the shift tag and the payer.
const reconFields = (id) => sql(`SELECT status || '|' || method || '|' || COALESCE("gatewayResponse"->>'posSessionId','-') || '|' || COALESCE("gatewayResponse"->>'paidByAdminId','-') || '|' || COALESCE("transactionRef",'-') || '|' || amount::int
  FROM "Payment" WHERE "refundRequestId" = '${id}'`);

await check('1. a request written APPROVED with NO approver on record (direct SQL) can\'t be paid: API 409 NOT_INDEPENDENTLY_APPROVED; database refuses PAYING / PAID and a payout row', async () => {
  const rid = await cancelledWith100k(130);
  const id = `it-noappr-${randomBytes(5).toString('hex')}`;
  sql(`INSERT INTO "RentalRefundRequest" (id, "tenantId", "rentalOrderId", subject, kind, component, amount, "retainedAmount", reason, status, "requestedById", "createdAt", "updatedAt")
       VALUES ('${id}', '${T}', '${rid}', 'RENTAL', 'CANCELLATION', 'RENTAL_FEE', 100000, 0, 'no approver on record', 'APPROVED', 'SYSTEM:TEST', now(), now())`);
  const r = await rentalPay(id, tok.cashier, { method: 'MOBILE_MONEY', reference: ref() });
  eq([r.status, r.data?.code], [409, 'NOT_INDEPENDENTLY_APPROVED'], 'rental route');
  const u = await unifiedPay(id, tok.cashier, { method: 'MOBILE_MONEY', reference: ref() });
  eq([u.status, u.data?.code], [409, 'NOT_INDEPENDENTLY_APPROVED'], 'unified route');
  const e1 = sqlErr(`UPDATE "RentalRefundRequest" SET status = 'PAID', "paidById" = '${P.cashier.id}', "paidAt" = now() WHERE id = '${id}'`);
  const e2 = sqlErr(`UPDATE "RentalRefundRequest" SET status = 'PAYING' WHERE id = '${id}'`);
  const e3 = sqlErr(`INSERT INTO "Payment" (id, "tenantId", "rentalOrderId", amount, method, status, component, "refundRequestId", "updatedAt") VALUES ('it-p-${randomBytes(4).toString('hex')}', '${T}', '${rid}', 100000, 'CASH', 'REFUNDED', 'RENTAL_FEE', '${id}', now())`);
  for (const [e, w] of [[e1, 'PAID'], [e2, 'PAYING'], [e3, 'payout row']]) assert(/R3_REFUND_PAYOUT_GUARD/.test(e || ''), `${w}: ${(e || 'ALLOWED').split('\n')[0]}`);
  eq([reqRow(id).split('|')[0], refundedRows(id)], ['APPROVED', '0'], 'nothing paid');
});
await check('1. database: an unapproved (REQUESTED) request can\'t jump to PAID, and an approved one can\'t be re-pointed or re-attributed', async () => {
  const q = systemRequest(await cancelledWith100k(140), 'SYSTEM:LATE_PAYMENT');
  const e1 = sqlErr(`UPDATE "RentalRefundRequest" SET status = 'PAID', "approvedById" = '${P.manager.id}', "paidById" = '${P.cashier.id}', "paidAt" = now() WHERE id = '${q}'`);
  assert(/R3_REFUND_PAYOUT_GUARD/.test(e1 || ''), `REQUESTED → PAID: ${(e1 || 'ALLOWED').split('\n')[0]}`);
  await approveRental(q);
  const e2 = sqlErr(`UPDATE "RentalRefundRequest" SET "approvedById" = '${P.owner.id}' WHERE id = '${q}'`);
  const e3 = sqlErr(`UPDATE "RentalRefundRequest" SET "requestedById" = '${P.owner.id}' WHERE id = '${q}'`);
  for (const [e, w] of [[e2, 'approver'], [e3, 'requester']]) assert(/R3_REFUND_PAYOUT_GUARD/.test(e || ''), `${w}: ${(e || 'ALLOWED').split('\n')[0]}`);
});

await check('5. one booking, two approved requests paid at the same moment by two people: within what is held both pay (exactly the held total); over-claimed, NEITHER pays until one is rejected (409 PAYOUT_EXCEEDS_HELD)', async () => {
  const two = async (start, amount) => {
    const rid = await cancelledWith100k(start);
    const qs = [systemRequest(rid, 'SYSTEM:LATE_PAYMENT'), systemRequest(rid, 'SYSTEM:HOLD_EXPIRY')]; // written directly: the API's request cap would refuse an over-claim
    sql(`UPDATE "RentalRefundRequest" SET amount = ${amount} WHERE id IN ('${qs[0]}', '${qs[1]}')`); // still REQUESTED
    for (const q of qs) await approveRental(q);
    return { rid, qs };
  };
  const ok = await two(150, 50000);
  const [x, y] = await Promise.all([rentalPay(ok.qs[0], tok.cashier, { method: 'CASH', sessionId: S.cashier }), rentalPay(ok.qs[1], tok.owner, { method: 'MOBILE_MONEY', reference: ref() })]);
  eq([x.status, y.status, heldRefunded(ok.rid)], [200, 200, '100000'], '50,000 + 50,000 of 100,000 held');
  const over = await two(260, 60000);
  const [a, b] = await Promise.all([rentalPay(over.qs[0], tok.cashier, { method: 'CASH', sessionId: S.cashier }), rentalPay(over.qs[1], tok.owner, { method: 'MOBILE_MONEY', reference: ref() })]);
  eq([a.status, a.data?.code, b.status, b.data?.code], [409, 'PAYOUT_EXCEEDS_HELD', 409, 'PAYOUT_EXCEEDS_HELD'], 'over-claimed: nobody pays');
  eq(heldRefunded(over.rid), '0', 'nothing paid out');
  eq((await call('PATCH', `/rental-money/refund-requests/${over.qs[1]}/reject`, { token: tok.manager, body: { reason: 'duplicate claim' } })).status, 200, 'one rejected');
  eq((await rentalPay(over.qs[0], tok.cashier, { method: 'CASH', sessionId: S.cashier })).status, 200, 'then the other pays');
  eq(heldRefunded(over.rid), '60000', 'never more than held');
});
await check('5. database: a payout row above the approved amount, and raising an approved amount, are refused', async () => {
  const rid = await cancelledWith100k(160);
  const q = systemRequest(rid, 'SYSTEM:LATE_PAYMENT');
  sql(`UPDATE "RentalRefundRequest" SET amount = 40000 WHERE id = '${q}'`); // still REQUESTED: allowed
  await approveRental(q);
  const e1 = sqlErr(`INSERT INTO "Payment" (id, "tenantId", "rentalOrderId", amount, method, status, component, "refundRequestId", "updatedAt") VALUES ('it-p-${randomBytes(4).toString('hex')}', '${T}', '${rid}', 40000.01, 'CASH', 'REFUNDED', 'RENTAL_FEE', '${q}', now())`);
  const e2 = sqlErr(`UPDATE "RentalRefundRequest" SET amount = 100000 WHERE id = '${q}'`);
  for (const [e, w] of [[e1, 'payout > approved'], [e2, 'raise approved amount']]) assert(/R3_REFUND_PAYOUT_GUARD/.test(e || ''), `${w}: ${(e || 'ALLOWED').split('\n')[0]}`);
  const p = await rentalPay(q, tok.cashier, { method: 'MOBILE_MONEY', reference: ref() });
  eq([p.status, heldRefunded(rid)], [200, '40000'], 'the approved 40,000 only');
});
let extraOrder;
await check('5. unified route, online order: two approved requests together above what was collected, paid at once: exactly one payout row, never above the money collected', async () => {
  const userId = sql(`SELECT "userId" FROM "Order" WHERE id = '${A.orders[0]}'`);
  extraOrder = `it-po-ord-${randomBytes(4).toString('hex')}`;
  sql(`INSERT INTO "Order" (id, "tenantId", "orderNumber", "userId", subtotal, total, "paymentMethod", status, "paymentStatus", channel, "updatedAt")
       VALUES ('${extraOrder}', '${T}', 'IT-PO-ONL-X${randomBytes(2).toString('hex')}', '${userId}', 30000, 30000, 'MPESA', 'DELIVERED', 'PAID', 'ONLINE', now())`);
  sql(`INSERT INTO "Payment" (id, "tenantId", "orderId", amount, method, status, "transactionRef", "providerCode", "updatedAt") VALUES ('it-pc-${randomBytes(4).toString('hex')}', '${T}', '${extraOrder}', 30000, 'MPESA', 'COMPLETED', 'IT-PO-MPX-${randomBytes(3).toString('hex').toUpperCase()}', 'clickpesa', now())`);
  const r1 = await call('POST', `/orders/${extraOrder}/refunds`, { token: tok.cashier, body: { amount: 20000, reason: 'part 1' } });
  eq(r1.status, 201, 'request 1');
  eq((await call('POST', `/orders/${extraOrder}/refunds`, { token: tok.cashier, body: { amount: 20000, reason: 'part 2' } })).status, 400, 'the API caps the second request (open claims)');
  const id2 = `it-oreq-${randomBytes(5).toString('hex')}`;
  sql(`INSERT INTO "RentalRefundRequest" (id, "tenantId", subject, kind, "orderId", amount, "retainedAmount", reason, status, "requestedById", "createdAt", "updatedAt")
       VALUES ('${id2}', '${T}', 'ORDER', 'ORDER_REFUND', '${extraOrder}', 20000, 0, 'written directly past the request cap', 'REQUESTED', '${P.cashier.id}', now(), now())`);
  for (const id of [r1.data.refundRequest.id, id2]) eq((await call('PATCH', `/refund-requests/${id}/approve`, { token: tok.manager, body: {} })).status, 200, 'approved');
  const [x, y] = await Promise.all([unifiedPay(r1.data.refundRequest.id, tok.owner, { method: 'MOBILE_MONEY', reference: ref() }), unifiedPay(id2, tok.owner, { method: 'MOBILE_MONEY', reference: ref() })]);
  eq([x.status === 200, y.status === 200].filter(Boolean).length, 1, `exactly one paid (${x.status}/${y.status})`);
  eq(sql(`SELECT count(*) || '|' || COALESCE(sum(amount),0)::int FROM "Payment" WHERE "orderId" = '${extraOrder}' AND status = 'REFUNDED'`), '1|20000', 'one payout, ≤ collected');
  eq(sql(`SELECT string_agg(status, ',' ORDER BY status) FROM "RentalRefundRequest" WHERE "orderId" = '${extraOrder}'`), 'APPROVED,PAID', 'the other is back to APPROVED, never PAYING');
});

await check('7. references: malformed → 400 PAYOUT_REFERENCE_INVALID and non-cash without one → 400, on both routes; nothing written', async () => {
  const q = systemRequest(await cancelledWith100k(170), 'SYSTEM:LATE_PAYMENT');
  await approveRental(q);
  const a = await rentalPay(q, tok.cashier, { method: 'MOBILE_MONEY', reference: 'MP1' });
  const b = await unifiedPay(q, tok.cashier, { method: 'BANK_TRANSFER', reference: 'bad#ref!' });
  const c = await rentalPay(q, tok.cashier, { method: 'BANK_TRANSFER' });
  eq([a.status, a.data?.code, b.status, b.data?.code, c.status, c.data?.code], [400, 'PAYOUT_REFERENCE_INVALID', 400, 'PAYOUT_REFERENCE_INVALID', 400, 'PAYOUT_REFERENCE_REQUIRED'], 'refused');
  const u = await unifiedPay(sql(`SELECT id FROM "RentalRefundRequest" WHERE "orderId" = '${extraOrder}' AND status = 'APPROVED'`), tok.probe, { method: 'MOBILE_MONEY' });
  eq([u.status, u.data?.code], [400, 'PAYOUT_INVALID'], 'unified route: missing reference listed with the payout problems');
  eq([reqRow(q).split('|')[0], refundedRows(q)], ['APPROVED', '0'], 'nothing paid');
});
await check('7. a reference already used in the shop (another payout, the customer\'s own collection code, any case / spacing) → 409 DUPLICATE_PAYOUT_REFERENCE on both routes; nothing written. Another shop\'s reference is not a clash', async () => {
  const used = ref();
  const q1 = systemRequest(await cancelledWith100k(180), 'SYSTEM:LATE_PAYMENT');
  const q2 = systemRequest(await cancelledWith100k(190), 'SYSTEM:HOLD_EXPIRY');
  await approveRental(q1); await approveRental(q2);
  eq((await rentalPay(q1, tok.cashier, { method: 'MOBILE_MONEY', reference: used })).status, 200, 'first payout');
  const before = sql(`SELECT count(*) FROM "Payment"`);
  const dupR = await rentalPay(q2, tok.cashier, { method: 'MOBILE_MONEY', reference: ` ${used.toLowerCase().slice(0, 4)} ${used.toLowerCase().slice(4)} ` });
  const dupU = await unifiedPay(q2, tok.cashier, { method: 'MOBILE_MONEY', reference: used });
  const coll = await rentalPay(q2, tok.cashier, { method: 'MOBILE_MONEY', reference: 'it-po-mp-1' }); // the customer's own M-Pesa code on an order
  eq([dupR.status, dupR.data?.code, dupU.status, dupU.data?.code, coll.status, coll.data?.code],
    [409, 'DUPLICATE_PAYOUT_REFERENCE', 409, 'DUPLICATE_PAYOUT_REFERENCE', 409, 'DUPLICATE_PAYOUT_REFERENCE'], 'refused');
  const unifiedOrderReq = sql(`SELECT id FROM "RentalRefundRequest" WHERE "orderId" = '${extraOrder}' AND status = 'APPROVED'`);
  const dupO = await unifiedPay(unifiedOrderReq, tok.owner, { method: 'MOBILE_MONEY', reference: used });
  eq([dupO.status, dupO.data?.code], [409, 'DUPLICATE_PAYOUT_REFERENCE'], 'order payout with a rental payout\'s reference');
  eq([sql(`SELECT count(*) FROM "Payment"`), reqRow(q2).split('|')[0], sql(`SELECT status FROM "RentalRefundRequest" WHERE id = '${unifiedOrderReq}'`)], [before, 'APPROVED', 'APPROVED'], 'nothing written');
  const other = await rentalPay(q2, tok.cashier, { method: 'MOBILE_MONEY', reference: 'IT-PO-B-MP-1' }); // only used in shop B
  eq(other.status, 200, 'shop B\'s reference is free in shop A');
});
await check('7. cash: the payer\'s own OPEN shift only — a payer with no shift is refused on both routes (400), nothing written', async () => {
  const q = systemRequest(await cancelledWith100k(200), 'SYSTEM:LATE_PAYMENT');
  await approveRental(q);
  const a = await rentalPay(q, tok.probe, { method: 'CASH', sessionId: S.cashier });
  const b = await unifiedPay(q, tok.probe, { method: 'CASH' });
  eq([a.status, b.status, refundedRows(q)], [400, 400, '0'], 'refused');
});

await check('8. idempotency (rental route): same Idempotency-Key replays the stored 200 (Idempotency-Replayed: true); another key, no key or another reference → 409; ONE payout row', async () => {
  const q = systemRequest(await cancelledWith100k(210), 'SYSTEM:LATE_PAYMENT');
  await approveRental(q);
  const key = `it-po-${randomBytes(8).toString('hex')}`;
  const body = { method: 'MOBILE_MONEY', reference: ref() };
  const a = await rentalPay(q, tok.cashier, body, { 'Idempotency-Key': key });
  const b = await rentalPay(q, tok.cashier, body, { 'Idempotency-Key': key });
  eq([a.status, b.status, b.headers.get('idempotency-replayed')], [200, 200, 'true'], 'replay');
  const c = await rentalPay(q, tok.cashier, body, { 'Idempotency-Key': `it-po-${randomBytes(8).toString('hex')}` });
  const d = await rentalPay(q, tok.cashier, body);
  const e = await rentalPay(q, tok.cashier, { method: 'MOBILE_MONEY', reference: ref() });
  const f = await rentalPay(q, tok.owner, { method: 'CASH', sessionId: S.owner });
  eq([c.status, d.status, e.status, f.status], [409, 409, 409, 409], 'second payouts');
  eq(refundedRows(q), '1', 'one payout row');
});
await check('8. idempotency (unified route, online order): the same key twice at once, then no key twice at once — one payout row each time', async () => {
  const mk = async () => {
    const userId = sql(`SELECT "userId" FROM "Order" WHERE id = '${A.orders[0]}'`);
    const o = `it-po-ord-${randomBytes(4).toString('hex')}`;
    sql(`INSERT INTO "Order" (id, "tenantId", "orderNumber", "userId", subtotal, total, "paymentMethod", status, "paymentStatus", channel, "updatedAt")
         VALUES ('${o}', '${T}', 'IT-PO-ONL-I${randomBytes(2).toString('hex')}', '${userId}', 30000, 30000, 'MPESA', 'DELIVERED', 'PAID', 'ONLINE', now())`);
    sql(`INSERT INTO "Payment" (id, "tenantId", "orderId", amount, method, status, "transactionRef", "providerCode", "updatedAt") VALUES ('it-pc-${randomBytes(4).toString('hex')}', '${T}', '${o}', 30000, 'MPESA', 'COMPLETED', 'IT-PO-MPI-${randomBytes(3).toString('hex').toUpperCase()}', 'clickpesa', now())`);
    const r = await call('POST', `/orders/${o}/refunds`, { token: tok.cashier, body: { amount: 30000, reason: 'idempotency test' } });
    eq(r.status, 201, 'request');
    eq((await call('PATCH', `/refund-requests/${r.data.refundRequest.id}/approve`, { token: tok.manager, body: {} })).status, 200, 'approved');
    return r.data.refundRequest.id;
  };
  const q = await mk();
  const key = `it-po-${randomBytes(8).toString('hex')}`;
  const body = { method: 'MOBILE_MONEY', reference: ref() };
  const [a, b] = await Promise.all([unifiedPay(q, tok.owner, body, { 'Idempotency-Key': key }), unifiedPay(q, tok.owner, body, { 'Idempotency-Key': key })]);
  assert([a.status, b.status].includes(200), `one success (${a.status}/${b.status})`);
  assert([a.status, b.status].every((s) => s === 200 || s === 409), `replay or in-progress only (${a.status}/${b.status})`);
  const again = await unifiedPay(q, tok.owner, body, { 'Idempotency-Key': key });
  eq([again.status, again.headers.get('idempotency-replayed')], [200, 'true'], 'a later retry with the key replays');
  const other = await unifiedPay(q, tok.probe, { method: 'MOBILE_MONEY', reference: ref() }, { 'Idempotency-Key': `it-po-${randomBytes(8).toString('hex')}` });
  eq(other.status, 409, 'another key / another payer / another reference');
  const q2 = await mk();
  const [c, d] = await Promise.all([unifiedPay(q2, tok.owner, { method: 'MOBILE_MONEY', reference: ref() }), unifiedPay(q2, tok.owner, { method: 'MOBILE_MONEY', reference: ref() })]);
  eq([c.status, d.status].sort(), [200, 409], 'no keys: one winner');
  eq([refundedRows(q), refundedRows(q2)], ['1', '1'], 'one row each');
});
await check('9. records: a rental payout by the cashier (mobile money, shift open) — row linked + tagged with the cashier\'s shift + payer; audit REFUND_PAID by the cashier with amount / method / reference / payment / shift; fail audited with the payout it reverses', async () => {
  const q = systemRequest(await cancelledWith100k(240), 'SYSTEM:LATE_PAYMENT');
  await approveRental(q);
  const rr = ref();
  eq((await rentalPay(q, tok.cashier, { method: 'MOBILE_MONEY', reference: rr })).status, 200, 'paid');
  eq(reconFields(q), `REFUNDED|MOBILE_MONEY|${S.cashier}|${P.cashier.id}|${rr}|100000`, 'payout row (what R4 reads)');
  const pid = sql(`SELECT id FROM "Payment" WHERE "refundRequestId" = '${q}'`);
  eq(auditRow(q, 'REFUND_PAID'), `${P.cashier.id}|100000|MOBILE_MONEY|${rr}|${pid}|${S.cashier}`, 'REFUND_PAID audit');
  eq(sql(`SELECT (details->>'requestedById') || '|' || (details->>'approvedById') || '|' || (details->>'paidById') FROM "AdminActivityLog" WHERE "entityId" = '${q}' AND action = 'REFUND_PAID'`),
    `SYSTEM:LATE_PAYMENT|${P.manager.id}|${P.cashier.id}`, 'the three people on the audit row');
  eq((await call('PATCH', `/rental-money/refund-requests/${q}/fail`, { token: tok.owner, body: { reason: 'wallet closed' } })).status, 200, 'fail');
  eq(auditRow(q, 'REFUND_FAILED'), `${P.owner.id}|100000|MOBILE_MONEY|${rr}|${pid}|`, 'REFUND_FAILED audit');
  eq(reconFields(q).split('|')[0], 'REVERSED', 'payout reversed (R4: listed, never counted)');
});
await check('9. records: an order payout by the owner (mobile money) carries the owner\'s shift; the probe (no shift) leaves its payout untagged with the payer recorded (R4: "not attributed", never guessed)', async () => {
  const id = sql(`SELECT id FROM "RentalRefundRequest" WHERE "orderId" = '${extraOrder}' AND status = 'APPROVED'`);
  // (the APPROVED one left by the cap test is for 20,000 and nothing is held any more: cap 409, nothing written)
  const capped = await unifiedPay(id, tok.owner, { method: 'MOBILE_MONEY', reference: ref() });
  assert(capped.status >= 400, `nothing left to pay: ${capped.status}`);
  const paidOrderReq = sql(`SELECT id FROM "RentalRefundRequest" WHERE "orderId" = '${extraOrder}' AND status = 'PAID'`);
  const [st, , sess, payer] = reconFields(paidOrderReq).split('|');
  eq([st, sess, payer], ['REFUNDED', S.owner, P.owner.id], 'order payout: owner\'s shift + payer');
  eq(sql(`SELECT "adminUserId" || '|' || (details->>'paymentId' IS NOT NULL)::text FROM "AdminActivityLog" WHERE "entityId" = '${paidOrderReq}' AND action = 'REFUND_PAID'`), `${P.owner.id}|true`, 'audited');
  const [, , psess, ppayer] = reconFields(oneSys).split('|');
  eq([psess, ppayer], ['-', P.probe.id], 'probe payout: untagged, payer recorded');
});

const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
