// Real API + real Postgres: R4 shift reconciliation (round 25D F; round 25E:
// cashier vs manager view, completeness, overpayment payouts, shop isolation).
// One cashier shift with a cash sale, a card sale, rental fee (cash + mobile
// money), deposits, a late fee, a layaway deposit + instalment, a rental
// deposit refunded in cash out of the drawer, a non-cash rental payment with no
// shift tag, cash recorded with no drawer, and a counted close. Every figure is
// asserted, and the drawer is re-derived from the Payment table in SQL.
// Isolated schema (default it_r4) seeded by the it_r4 copy of pos-rental-seed.js
// (+ a purchase product, cashier with payments:manage + reports:view). Never production.
//   IT_API=http://localhost:4170/api/v1 IT_SCHEMA=it_r4 [PSQL=...] node shift-reconciliation.it.mjs <ids.json>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const API = (process.env.IT_API || 'http://localhost:4170/api/v1').replace(/\/$/, '');
const SCHEMA = process.env.IT_SCHEMA || 'it_r4';
if (!/^it_[a-z0-9_]+$/.test(SCHEMA) || !/^http:\/\/localhost:/.test(API)) throw new Error('refusing: local API + it_* schema only');
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe';
const ids = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const T = ids.tenantId;
const sql = (q) =>
  execFileSync(PSQL, ['-U', process.env.PGUSER || 'naro_admin', '-h', process.env.PGHOST || 'localhost', '-d', process.env.PGDATABASE || 'naro_fashion', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO ${SCHEMA}; ${q}`], {
    env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD || 'Admin123' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim().split(/\r?\n/).map((x) => x.trim()).filter(Boolean).join('\n');
const results = [];
async function check(name, fn) {
  try { const n = await fn(); results.push('PASS'); console.log(`  ✔ ${name}${n ? `  — ${n}` : ''}`); }
  catch (e) { results.push('FAIL'); console.log(`  ✖ ${name}\n      ${String(e?.message || e).split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
const ip = (s) => { const h = createHash('sha256').update(String(s)).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
const call = async (method, p, { token, body, tenant = T } = {}) => {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenant, 'X-Forwarded-For': ip(token || body?.email || randomBytes(4).toString('hex')), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const ok = (r, m) => { assert(r.status >= 200 && r.status < 300, `${m}: HTTP ${r.status} ${JSON.stringify(r.data)?.slice(0, 300)}`); return r.data; };
const login = async (w) => { const r = await call('POST', '/auth/login', { body: { email: w.email, password: w.password } }); assert(r.data?.accessToken, `login ${w.email}`); return r.data.accessToken; };
const tok = {};
for (const k of ['cashier', 'cashier2', 'approver', 'staff', 'counter', 'finance']) tok[k] = await login(ids.admins[k]);
const SID = ids.sessions.cashier;
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const customer = async (tag) => ok(await call('POST', '/pos-rentals/customers', { token: tok.cashier, body: { firstName: 'Shift', lastName: tag, phone: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } }), 'customer');
const book = async (productId, variantId, start, c) =>
  ok(await call('POST', '/pos-rentals', { token: tok.cashier, body: { customerId: c.id, productId, variantId, startDate: day(start), returnDate: day(start + 2), pickupDate: day(start), termsAccepted: true } }), 'booking');
const rentalPay = async (id, component, tender, withSession = true, who = 'cashier', session = SID) =>
  ok(await call('POST', `/pos-rentals/${id}/payments`, { token: tok[who], body: { component, ...(withSession ? { sessionId: session } : {}), tenders: [tender] } }), `pay ${component} ${tender.method}`);
const clutch = (qty) => ({ productId: ids.clutch.id, variantId: ids.clutch.variantId, quantity: qty, unitPrice: 30000 });

console.log(`real API ${API} · isolated schema ${SCHEMA} · R4 shift reconciliation`);
let A, C, layaway, recon;
await check('one shift: cash sale (tendered 50k for 30k), card sale 60k, rental fee 100k cash + 50k M-Pesa, deposit 200k cash, late fee 20k cash, layaway 10k + 5k cash, bouquet deposit 50k cash', async () => {
  const s1 = ok(await call('POST', '/pos/sales', { token: tok.cashier, body: { items: [clutch(1)], payments: [{ method: 'CASH', amount: 50000 }], sessionId: SID } }), 'cash sale');
  const s2 = ok(await call('POST', '/pos/sales', { token: tok.cashier, body: { items: [clutch(2)], payments: [{ method: 'CARD', amount: 60000, transactionRef: 'RRN-R4-000111', approvalCode: 'AB12CD' }], sessionId: SID } }), 'card sale');
  assert(s1 && s2, 'sales');
  const cA = await customer('A');
  A = await book(ids.gown.id, ids.gown.M, 20, cA);
  await rentalPay(A.id, 'RENTAL_FEE', { method: 'CASH', amount: 100000 });
  await rentalPay(A.id, 'DEPOSIT', { method: 'CASH', amount: 200000 });
  await rentalPay(A.id, 'RENTAL_FEE', { method: 'MPESA', amount: 50000, transactionRef: 'MPR4000222' });
  // Test shortcut: a late fee assessed (no status change, so no R3 gate involved).
  sql(`UPDATE "RentalOrder" SET "lateFee" = 20000 WHERE id = '${A.id}'`);
  await rentalPay(A.id, 'LATE_FEE', { method: 'CASH', amount: 20000 });
  // A non-cash rental payment with no shift given: NOT tagged (reported as not attributed).
  await rentalPay(A.id, 'RENTAL_FEE', { method: 'MPESA', amount: 30000, transactionRef: 'MPR4000333' }, false);
  layaway = ok(await call('POST', '/pos/layaways', { token: tok.cashier, body: { customerId: cA.id, items: [{ ...clutch(1), productName: 'IT Clutch', variantName: 'One size' }], depositAmount: 10000, depositMethod: 'CASH', dueDate: day(30) } }), 'layaway');
  ok(await call('POST', `/pos/layaways/${layaway.id}/payment`, { token: tok.cashier, body: { amount: 5000, method: 'CASH' } }), 'instalment');
  const cC = await customer('C');
  C = await book(ids.bouquet.id, ids.bouquet.variantId, 20, cC);
  await rentalPay(C.id, 'DEPOSIT', { method: 'CASH', amount: 50000 });
});

await check('the bouquet booking is cancelled (cashier2), the deposit refund approved (approver) and paid in CASH out of the cashier\'s drawer', async () => {
  ok(await call('PATCH', `/rentals/${C.id}/status`, { token: tok.cashier2, body: { status: 'CANCELLED', cancellationReason: 'CUSTOMER_REQUEST' } }), 'cancel');
  const req = sql(`SELECT id FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${C.id}' AND status = 'REQUESTED'`);
  assert(req && !req.includes('\n'), `one request (${req})`);
  ok(await call('PATCH', `/rental-money/refund-requests/${req}/approve`, { token: tok.approver }), 'approve');
  ok(await call('PATCH', `/rental-money/refund-requests/${req}/pay`, { token: tok.cashier, body: { method: 'CASH', sessionId: SID } }), 'pay');
  eq(sql(`SELECT "gatewayResponse"->>'posSessionId' FROM "Payment" WHERE "refundRequestId" = '${req}'`), SID, 'payout tagged with the drawer');
});

await check('cash recorded with no drawer (simulated manual entry) during the shift; then the shift closes counted at 460,000', async () => {
  sql(`INSERT INTO "Payment" (id, "tenantId", amount, method, status, "gatewayResponse", "createdAt", "updatedAt") VALUES ('it-r4-untagged-cash', '${T}', 7000, 'CASH', 'COMPLETED', '{"kind":"MANUAL_TEST"}', now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC')`);
  const closed = ok(await call('POST', '/pos/sessions/close', { token: tok.cashier, body: { closingCash: 460000, notes: 'IT close' } }), 'close');
  eq([Number(closed.expectedCash), Number(closed.cashDifference)], [465000, -5000], 'close stores expected + difference');
});

await check('reconciliation: drawer — opening 100k + cash in 415k − cash out 50k = expected 465k; counted 460k; difference −5k; matches the figure saved at close', async () => {
  recon = ok(await call('GET', `/pos/sessions/${SID}/reconciliation`, { token: tok.cashier }), 'reconciliation');
  const d = recon.drawer;
  eq([d.openingCash, d.cashIn, d.cashOut, d.expectedCash, d.countedCash, d.difference, d.expectedCashAtClose], [100000, 415000, 50000, 465000, 460000, -5000, 465000], 'drawer');
  eq(recon.checks, { everyTaggedRowAccounted: true, receiptsAddUp: true, payoutsAddUp: true, expectedMatchesClose: true }, 'checks');
  eq(recon.view, 'MANAGER', 'the cashier here holds reports:view');
});

await check('round 25E completeness: the shift is NOT complete — the 7k untagged cash and the 30k untagged M-Pesa are listed, totalled and warned about (never zero, never dropped)', async () => {
  eq(recon.complete, false, 'complete');
  const codes = recon.warnings.filter((w) => w.severity === 'WARN').map((w) => w.code).sort();
  eq(codes, ['UNATTRIBUTED_CASH', 'UNATTRIBUTED_NONCASH_THIS_CASHIER'], 'warnings');
  eq([recon.notAttributed.totals.cash, recon.notAttributed.totals.nonCash.net], [{ net: 7000, rows: 1 }, 30000], 'totals');
  const rows = [...recon.notAttributed.cashWithoutShift.rows, ...recon.notAttributed.nonCashByThisCashier.rows];
  assert(rows.every((x) => x.reason && x.reason.length > 10), 'every row has a reason');
  return recon.warnings.map((w) => w.code).join(', ');
});

await check('the drawer re-derived independently from the Payment table (SQL) gives the same cash in / out', async () => {
  const [inn, out] = sql(`SELECT COALESCE(sum(amount) FILTER (WHERE status = 'COMPLETED'), 0)::int || ' ' || COALESCE(sum(amount) FILTER (WHERE status = 'REFUNDED'), 0)::int FROM "Payment" WHERE "tenantId" = '${T}' AND method = 'CASH' AND "gatewayResponse"->>'posSessionId' = '${SID}'`).split(' ').map(Number);
  eq([inn, out], [recon.drawer.cashIn, recon.drawer.cashOut], 'SQL vs API');
});

await check('receipts by category, cash / non-cash: POS sales 30k + 60k card; rental fee 100k + 50k M-Pesa; deposits 250k; late fee 20k; layaway 15k', async () => {
  const r = recon.receipts;
  const pick = (k) => [r[k].cash, r[k].nonCash, r[k].count, r[k].nature];
  eq(pick('POS_SALE'), [30000, 60000, 2, 'INCOME'], 'POS sales');
  eq(pick('RENTAL_FEE'), [100000, 50000, 2, 'INCOME'], 'rental fee');
  eq(pick('DEPOSIT'), [250000, 0, 2, 'LIABILITY'], 'deposits');
  eq(pick('LATE_FEE'), [20000, 0, 1, 'INCOME'], 'late fee');
  eq(pick('LAYAWAY'), [15000, 0, 2, 'LIABILITY'], 'layaway');
  eq([r.OTHER.count, r.EXCHANGE_TOPUP.count, r.RENTAL_UNALLOCATED.count], [0, 0, 0], 'nothing else');
  eq(recon.byMethod, { CASH: { in: 415000, out: 50000, net: 365000 }, CARD: { in: 60000, out: 0, net: 60000 }, MPESA: { in: 50000, out: 0, net: 50000 } }, 'by method');
});

await check('refunds paid out by subject: rental deposit 50k cash (a liability returned, not an expense)', async () => {
  eq([recon.payouts.RENTAL.cash, recon.payouts.RENTAL.count, recon.payouts.POS_SALE.count, recon.payouts.ORDER.count, recon.payouts.LAYAWAY.count], [50000, 1, 0, 0, 0], 'payouts');
  eq(recon.rentalPayoutsByComponent.DEPOSIT.total, 50000, 'deposit returned');
});

await check('books: income 260k (sales 90k + fees 150k + late 20k), deposits 250k in / 50k out and layaway 15k are customer money, not income', async () => {
  const b = recon.books;
  eq([b.incomeReceived, b.incomeRefunded, b.netIncome, b.depositsReceived, b.depositsReturned, b.layawayPrepaymentsReceived, b.unclassified], [260000, 0, 260000, 250000, 50000, 15000, 0], 'books');
});

await check('not attributed: the 7k cash with no drawer, and the 30k M-Pesa the cashier took without a shift — shown, not in the expected cash', async () => {
  const n = recon.notAttributed;
  eq([n.cashWithoutShift.net, n.cashWithoutShift.rows.map((x) => x.id)], [7000, ['it-r4-untagged-cash']], 'cash without shift');
  eq(n.nonCashByThisCashier.rows.map((x) => [x.method, x.amount, x.category]), [['MPESA', 30000, 'RENTAL_FEE']], 'non-cash by cashier');
});

await check('rentals cross-checked against the rental ledger now; shop liabilities now (deposit held 200k, layaway 15k, no unpaid refunds)', async () => {
  const fee = Number(sql(`SELECT "totalRentalPrice" FROM "RentalOrder" WHERE id = '${A.id}'`));
  const a = recon.rentals.find((x) => x.rentalOrderId === A.id);
  const c = recon.rentals.find((x) => x.rentalOrderId === C.id);
  eq(a.thisShift, { feeReceived: 150000, depositReceived: 200000, lateFeeReceived: 20000, depositReturned: 0 }, 'A this shift');
  eq([a.ledgerNow.depositHeld, a.ledgerNow.feeOutstanding, a.ledgerNow.lateFeeOutstanding], [200000, Math.max(0, fee - 180000), 0], 'A ledger (fee includes the untagged 30k)');
  eq([c.thisShift.depositReceived, c.thisShift.depositReturned, c.ledgerNow.depositHeld, c.status], [50000, 50000, 0, 'CANCELLED'], 'C');
  const L = recon.liabilitiesNow;
  eq([L.depositsHeld, L.layawayPrepaymentsHeld, L.refundRequestsApprovedUnpaid.count, L.cancelledRentalsRefundDue.count], [{ amount: 200000, rentals: 1 }, { amount: 15000, layaways: 1 }, 0, 0], 'liabilities');
  return `fee ${fee}`;
});

await check('a cash row tagged to the shift AFTER it closed shows as a mismatch against the expected cash saved at close', async () => {
  sql(`INSERT INTO "Payment" (id, "tenantId", amount, method, status, "gatewayResponse", "createdAt", "updatedAt") VALUES ('it-r4-late-tagged', '${T}', 1000, 'CASH', 'COMPLETED', '{"posSessionId":"${SID}","kind":"LATE_SYNC_TEST"}', now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC')`);
  const r = ok(await call('GET', `/pos/sessions/${SID}/reconciliation`, { token: tok.cashier }), 'reconciliation');
  eq([r.drawer.expectedCash, r.drawer.expectedCashAtClose, r.drawer.difference, r.checks.expectedMatchesClose, r.receipts.OTHER.cash], [466000, 465000, -6000, false, 1000], 'mismatch');
});

await check('access: staff without reports:view → 403; an unknown shift → 404', async () => {
  eq((await call('GET', `/pos/sessions/${SID}/reconciliation`, { token: tok.staff })).status, 403, 'staff');
  eq((await call('GET', `/pos/sessions/nope-not-a-shift/reconciliation`, { token: tok.cashier })).status, 404, 'unknown');
});

// ---------------------------------------------------------------- round 25E
// A till cashier WITHOUT reports:view ("counter") runs their own shift; an
// overpayment is refunded in cash from finance's drawer; a second shop's
// manager must not see shop A's shifts.
const CSID = ids.sessions.counter, FSID = ids.sessions.finance;
let B, cRecon;
await check('counter shift: cash sale 30k; bouquet booking fee + deposit 50k in cash; 10k M-Pesa on booking A without a shift; a 20k online payment makes booking B overpaid', async () => {
  ok(await call('POST', '/pos/sales', { token: tok.counter, body: { items: [clutch(1)], payments: [{ method: 'CASH', amount: 30000 }], sessionId: CSID } }), 'counter cash sale');
  const cB = ok(await call('POST', '/pos-rentals/customers', { token: tok.counter, body: { firstName: 'Shift', lastName: 'B', phone: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } }), 'customer B');
  B = ok(await call('POST', '/pos-rentals', { token: tok.counter, body: { customerId: cB.id, productId: ids.bouquet.id, variantId: ids.bouquet.variantId, startDate: day(45), returnDate: day(47), pickupDate: day(45), termsAccepted: true } }), 'booking B');
  const fee = Number(sql(`SELECT "totalRentalPrice" FROM "RentalOrder" WHERE id = '${B.id}'`));
  await rentalPay(B.id, 'RENTAL_FEE', { method: 'CASH', amount: fee }, true, 'counter', CSID);
  await rentalPay(B.id, 'DEPOSIT', { method: 'CASH', amount: 50000 }, true, 'counter', CSID);
  await rentalPay(A.id, 'RENTAL_FEE', { method: 'MPESA', amount: 10000, transactionRef: 'MPR4000444' }, false, 'counter');
  // Test shortcut: an online (gateway) payment with no component lands on B: 20k more than fee + deposit.
  sql(`INSERT INTO "Payment" (id, "tenantId", "rentalOrderId", amount, method, status, "providerCode", "gatewayResponse", "createdAt", "updatedAt") VALUES ('it-r4-online-surplus', '${T}', '${B.id}', 20000, 'MOBILE_MONEY', 'COMPLETED', 'CLICKPESA_MIXX', '{"kind":"ONLINE_TEST"}', now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC')`);
  const l = ok(await call('GET', `/rental-money/rentals/${B.id}/ledger`, { token: tok.finance }), 'ledger B');
  eq(l.overpaid, 20000, 'overpaid');
  return `bouquet fee ${fee}`;
});

await check('overpayment refund: requested by the counter cashier, approved by the approver, paid in CASH by finance from finance\'s own drawer', async () => {
  const q = ok(await call('POST', `/rental-money/rentals/${B.id}/refund-requests`, { token: tok.counter, body: { kind: 'OVERPAYMENT', component: 'RENTAL_FEE', amount: 20000, reason: 'customer paid 20,000 more than the fee and deposit' } }), 'request');
  ok(await call('PATCH', `/rental-money/refund-requests/${q.id}/approve`, { token: tok.approver }), 'approve');
  ok(await call('PATCH', `/rental-money/refund-requests/${q.id}/pay`, { token: tok.finance, body: { method: 'CASH', sessionId: FSID } }), 'pay');
  eq(sql(`SELECT COALESCE(component, 'NULL') || '|' || ("gatewayResponse"->>'posSessionId') FROM "Payment" WHERE "refundRequestId" = '${q.id}'`), `NULL|${FSID}`, 'payout row: no component, finance drawer');
});

await check('CASHIER view (own shift, no reports:view): drawer + own rows; shop liabilities and other staff / online rows omitted but COUNTED; incomplete', async () => {
  cRecon = ok(await call('GET', `/pos/sessions/${CSID}/reconciliation`, { token: tok.counter }), 'counter reconciliation');
  const fee = Number(sql(`SELECT "totalRentalPrice" FROM "RentalOrder" WHERE id = '${B.id}'`));
  eq([cRecon.view, cRecon.liabilitiesNow, cRecon.omitted.includes('liabilitiesNow')], ['CASHIER', null, true], 'view');
  eq([cRecon.drawer.openingCash, cRecon.drawer.cashIn, cRecon.drawer.cashOut], [100000, 30000 + fee + 50000, 0], 'drawer');
  eq([cRecon.receipts.POS_SALE.cash, cRecon.receipts.RENTAL_FEE.cash, cRecon.receipts.DEPOSIT.cash, cRecon.receipts.DEPOSIT.nature], [30000, fee, 50000, 'LIABILITY'], 'receipts');
  eq(cRecon.notAttributed.nonCashByThisCashier.rows.map((x) => [x.method, x.amount]), [['MPESA', 10000]], 'own untagged M-Pesa');
  const shownIds = Object.values(cRecon.notAttributed).flatMap((g) => (g && Array.isArray(g.rows) ? g.rows.map((x) => x.id) : []));
  assert(!shownIds.includes('it-r4-online-surplus'), 'online row hidden from the cashier');
  assert(cRecon.notAttributed.totals.hiddenRows >= 1 && /hidden in the cashier view/.test(cRecon.notAttributed.hiddenNote || ''), `hidden rows counted (${cRecon.notAttributed.totals.hiddenRows})`);
  eq(cRecon.complete, false, 'incomplete (untagged M-Pesa)');
  return `hidden ${cRecon.notAttributed.totals.hiddenRows}`;
});

await check('access by role: the counter cashier on ANOTHER cashier\'s shift → 403 RECONCILIATION_NOT_PERMITTED; staff → 403; a manager opens the counter\'s shift in the MANAGER view with every row', async () => {
  const r = await call('GET', `/pos/sessions/${SID}/reconciliation`, { token: tok.counter });
  eq([r.status, r.data?.code], [403, 'RECONCILIATION_NOT_PERMITTED'], 'counter on cashier shift');
  eq((await call('GET', `/pos/sessions/${CSID}/reconciliation`, { token: tok.staff })).status, 403, 'staff');
  const m = ok(await call('GET', `/pos/sessions/${CSID}/reconciliation`, { token: tok.cashier }), 'manager on counter shift');
  eq([m.view, m.liabilitiesNow != null, m.notAttributed.totals.hiddenRows], ['MANAGER', true, 0], 'manager view');
  eq(m.notAttributed.onlineInWindow.rows.map((x) => [x.id, x.amount]), [['it-r4-online-surplus', 20000]], 'online row listed for the manager');
  eq(m.drawer.expectedCash, cRecon.drawer.expectedCash, 'same drawer maths in both views');
});

await check('finance shift: the overpayment payout is labelled OVERPAID (surplus), not rental fee; not counted as income refunded', async () => {
  const f = ok(await call('GET', `/pos/sessions/${FSID}/reconciliation`, { token: tok.finance }), 'finance reconciliation');
  eq([f.rentalPayoutsByComponent.OVERPAID?.cash, f.rentalPayoutsByComponent.RENTAL_FEE, f.books.overpaymentsReturned, f.books.incomeRefunded], [20000, undefined, 20000, 0], 'labels');
  eq([f.drawer.cashOut, f.drawer.expectedCash], [20000, 80000], 'drawer: 100k float − 20k paid out');
});

await check('shop isolation: shop B\'s manager → 404 on shop A\'s shifts (and can open their own)', async () => {
  const lb = await call('POST', '/auth/login', { body: { email: ids.otherShop.manager.email, password: ids.otherShop.manager.password }, tenant: ids.otherShop.tenantId });
  const tB = lb.data?.accessToken; assert(tB, `login shop B ${lb.status}`);
  eq((await call('GET', `/pos/sessions/${SID}/reconciliation`, { token: tB, tenant: ids.otherShop.tenantId })).status, 404, 'A cashier shift');
  eq((await call('GET', `/pos/sessions/${CSID}/reconciliation`, { token: tB, tenant: ids.otherShop.tenantId })).status, 404, 'A counter shift');
  const own = ok(await call('GET', `/pos/sessions/${ids.otherShop.session}/reconciliation`, { token: tB, tenant: ids.otherShop.tenantId }), 'own shop');
  eq([own.view, own.drawer.openingCash, own.receipts.POS_SALE.count], ['MANAGER', 5000, 0], 'own shift, nothing from shop A');
  const leaked = JSON.stringify(own).match(/it-r4-online-surplus|it-r4-untagged-cash/);
  assert(!leaked, 'no shop A rows in shop B');
});

const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
