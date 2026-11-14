// Real API + real Postgres acceptance test for the walk-in POS rental MVP
// (M1 ledger, M2 units, M3 POS rentals). Targets ONLY a local API (default
// http://localhost:4130) on the isolated schema it_pos. Never production.
//   node pos-rental.it.mjs <ids.json>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const API = (process.env.IT_API || 'http://localhost:4130/api/v1').replace(/\/$/, '');
if (!/^http:\/\/localhost:/.test(API)) throw new Error('refusing: IT_API must be localhost');
const ids = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe';
const T = ids.tenantId;
const sql = (q) => execFileSync(PSQL, ['-U', 'naro_admin', '-h', 'localhost', '-d', 'naro_fashion', '-qAt', '-v', 'ON_ERROR_STOP=1',
  '-c', `SET search_path TO ${process.env.IT_SCHEMA || 'it_pos'}; ${q}`], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8' }).trim();
const clientIp = (seed) => { const h = createHash('sha256').update(String(seed)).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
async function call(method, p, { token, body, key } = {}) {
  const r = await fetch(API + p, {
    method,
    headers: {
      'Content-Type': 'application/json', 'X-Tenant-Id': T, 'X-Forwarded-For': clientIp(token || body?.email || randomBytes(4).toString('hex')),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}),
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
async function login(who) {
  const r = await call('POST', '/auth/login', { body: { email: who.email, password: who.password } });
  const tok = r.data?.accessToken || r.data?.access_token || r.data?.tokens?.accessToken;
  if (!tok) throw new Error(`login ${who.email}: ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  return tok;
}
const tok = {};
for (const k of Object.keys(ids.admins)) tok[k] = await login(ids.admins[k]);
const S = ids.sessions;
// R3 build (IT_R3=1): every hand-over needs the mandatory checklist. This
// suite is about money / units / IDs, so it gives the shop a one-item default
// checklist and records it before each hand-over / deposit settlement. The R3
// rules themselves are tested in r3-checklist.it.mjs.
const R3 = process.env.IT_R3 === '1';
// Round 25C F build: cancelling raises the full refund REQUEST itself (requested by the person who cancelled).
const CX = process.env.IT_CANCELLATION === '1';
if (R3) {
  const t = await call('POST', '/rental-checklists/templates', { token: tok.super, body: { name: 'Shop default', isDefault: true, items: [{ label: 'Item', itemType: 'DISPATCH' }] } });
  if (t.status !== 201) throw new Error(`R3 default template ${t.status}`);
  // Round 25F D builds (IT_TEMPLATE_APPROVAL=1, default off): used only after a DIFFERENT
  // person (the seeded independent approver, not the SUPER_ADMIN who prepared it) approves it.
  if (process.env.IT_TEMPLATE_APPROVAL === '1') {
    const d = t.data;
    if (d?.approvalStatus === undefined || !tok.tplApprover) throw new Error(`template approval set-up: ${JSON.stringify(d).slice(0, 120)}`);
    const a = await call('POST', `/rental-checklists/templates/${d.id}/approve`, { token: tok.tplApprover, body: {
      version: d.version, hash: d.contentHash, scope: { productId: d.productId ?? null, categoryId: d.categoryId ?? null },
      confirmedItems: d.items.map((i) => ({ itemId: i.id, quantity: i.quantity })) } });
    if (a.status !== 201) throw new Error(`approve template ${a.status} ${JSON.stringify(a.data).slice(0, 160)}`);
  }
}
async function r3Record(id, stage, condition = 'GOOD', note) {
  if (!R3) return null;
  const st = (await call('GET', `/rental-checklist/rentals/${id}`, { token: tok.super })).data;
  const entries = st.items.filter((i) => stage === 'RETURN' || i.stage === 'BOTH').map((i) => ({ snapshotItemId: i.id, quantity: i.quantity, condition, ...(note ? { note } : {}) }));
  const r = await call('POST', `/rental-checklist/rentals/${id}/records`, { token: tok.cashier, body: { stage, entries } });
  if (r.status !== 201) throw new Error(`R3 record ${stage} ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  return r.data;
}
const statusOf = (id) => sql(`SELECT status FROM "RentalOrder" WHERE id = '${id}'`);
const book = (customerId, variant, start, extra = {}) => call('POST', '/pos-rentals', {
  token: tok.cashier,
  body: { customerId, productId: ids.gown.id, variantId: ids.gown[variant], startDate: day(start), returnDate: day(start + 2), pickupDate: day(start), termsAccepted: true, ...extra },
});
const payCash = (rid, component, amount, token = tok.cashier, session = S.cashier) =>
  call('POST', `/pos-rentals/${rid}/payments`, { token, body: { component, sessionId: session, tenders: [{ method: 'CASH', amount }] } });

console.log(`real API ${API} · isolated schema it_pos`);

// ---------------------------------------------------------------------------
console.log('\n1. walk-in customer');
const newCustomer = (tag, extra = {}) => call('POST', '/pos-rentals/customers', {
  token: tok.cashier, body: { firstName: 'Walk', lastName: tag, phone: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, ...extra },
});
const c1 = (await newCustomer('One')).data;
await check('register a walk-in customer with NO email and no address (name + phone only)', async () => {
  assert(c1?.id, 'created'); eq(c1.email, null, 'email');
});
await check('the same phone twice → 409 CUSTOMER_EXISTS with the existing id (select instead)', async () => {
  const r = await call('POST', '/pos-rentals/customers', { token: tok.cashier, body: { firstName: 'X', lastName: 'Y', phone: c1.phone } });
  eq([r.status, r.data?.code, r.data?.customerId], [409, 'CUSTOMER_EXISTS', c1.id], 'dup');
});
await check('STAFF without rentals:create cannot register customers or book (403)', async () => {
  const a = await call('POST', '/pos-rentals/customers', { token: tok.staff, body: { firstName: 'A', lastName: 'B', phone: '+255700000001' } });
  const b = await call('POST', '/pos-rentals', { token: tok.staff, body: { customerId: c1.id, productId: ids.gown.id, variantId: ids.gown.M, startDate: day(20), returnDate: day(22), pickupDate: day(20), termsAccepted: true } });
  eq([a.status, b.status], [403, 403], 'codes');
});

// ---------------------------------------------------------------------------
console.log('\n2. physical units (2 × size M, 1 × size S)');
const unit = (code, variantIds) => call('POST', '/rental-units', { token: tok.super, body: { productId: ids.gown.id, code, variantIds } });
const [uM1, uM2, uS1] = [(await unit('GOWN-M-01', [ids.gown.M])).data, (await unit('GOWN-M-02', [ids.gown.M])).data, (await unit('GOWN-S-01', [ids.gown.S])).data];
await check('units registered (tag unique: a second GOWN-M-01 → 409); cashier can\'t manage units (403)', async () => {
  assert(uM1?.id && uM2?.id && uS1?.id, 'units');
  eq((await unit('GOWN-M-01', [])).status, 409, 'dup tag');
  eq((await call('POST', '/rental-units', { token: tok.cashier, body: { productId: ids.gown.id, code: 'X-1' } })).status, 403, 'cashier');
});
// R2 (feat/unit-tracking-activation): registering gowns changes nothing until
// an independently approved physical count activates per-gown tracking.
if (process.env.IT_UNIT_TRACKING === '1') {
  console.log('\n2b. per-gown tracking: verified count + independent approval');
  const P = ids.gown.id;
  const track = () => call('GET', `/rental-units/products/${P}/tracking`, { token: tok.super });
  const reqCount = (n, token = tok.super) => call('POST', `/rental-units/products/${P}/tracking/requests`, { token, body: { countedQuantity: n, note: 'counted in the shop' } });
  const decide = (id, verb, token, body = {}) => call('PATCH', `/rental-units/tracking/requests/${id}/${verb}`, { token, body });
  const productActive = () => sql(`SELECT ("rentalUnitTrackingActivatedAt" IS NOT NULL)::text FROM "Product" WHERE id = '${P}'`);
  let legacyBooking;
  await check('3 gowns registered but NOT activated: legacy rule — quote not unit-managed; a booking takes no gown', async () => {
    const t = await track();
    eq([t.status, t.data.mode, t.data.serviceableCount, t.data.registered.every((u) => !u.verified)], [200, 'LEGACY', 3, true], 'status');
    const q = await call('POST', '/pos-rentals/quote', { token: tok.cashier, body: { productId: P, variantId: ids.gown.M, startDate: day(200), returnDate: day(202), pickupDate: day(200) } });
    eq([q.data.available, q.data.unitManaged], [true, false], 'quote');
    const cL = (await newCustomer('Legacy')).data;
    legacyBooking = (await book(cL.id, 'M', 200)).data;
    eq(sql(`SELECT COALESCE("rentalUnitId", 'none') FROM "RentalOrder" WHERE id = '${legacyBooking.id}'`), 'none', 'no gown allocated before activation');
  });
  await check('a count that does not match the registered gowns is refused (409 COUNT_MISMATCH, audited); a cashier cannot submit counts (403)', async () => {
    const r = await reqCount(2);
    eq([r.status, r.data?.code, r.data?.counted, r.data?.registered], [409, 'COUNT_MISMATCH', 2, 3], 'mismatch');
    eq(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action = 'UNIT_TRACKING_COUNT_MISMATCH' AND "entityId" = '${P}'`), '1', 'audited');
    eq((await reqCount(3, tok.cashier)).status, 403, 'cashier');
    eq(productActive(), 'false', 'still legacy');
  });
  let req1;
  await check('a matching count is only a REQUEST (nothing activated); a second open request is refused', async () => {
    const r = await reqCount(3);
    req1 = r.data;
    eq([r.status, r.data?.status, r.data?.countedQuantity, productActive()], [201, 'REQUESTED', 3, 'false'], 'requested');
    eq((await reqCount(3)).data?.code, 'TRACKING_REQUEST_OPEN', 'one at a time');
  });
  await check('the person who counted cannot approve (403 SELF_APPROVAL, audited); a cashier cannot approve (403)', async () => {
    const self = await decide(req1.id, 'approve', tok.super);
    eq([self.status, self.data?.code], [403, 'SELF_APPROVAL'], 'self');
    eq(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action = 'UNIT_TRACKING_APPROVAL_DENIED' AND "entityId" = '${P}'`), '1', 'audited');
    eq((await decide(req1.id, 'approve', tok.cashier)).status, 403, 'cashier');
    eq(productActive(), 'false', 'still legacy');
  });
  await check('gowns changed after the count (a 4th tag registered): approval refused as STALE, nothing activated', async () => {
    const extra = (await unit('GOWN-M-03', [ids.gown.M])).data;
    const r = await decide(req1.id, 'approve', tok.approver);
    eq([r.status, r.data?.code, r.data?.reason], [409, 'TRACKING_REQUEST_STALE', 'GOWNS_CHANGED'], 'stale');
    eq([sql(`SELECT status FROM "RentalUnitTrackingChange" WHERE id = '${req1.id}'`), productActive()], ['STALE', 'false'], 'db');
    eq((await call('PATCH', `/rental-units/${extra.id}`, { token: tok.super, body: { status: 'RETIRED', note: 'registered by mistake' } })).status, 200, 'retire the extra tag');
  });
  await check('independent approval of a fresh count: product activated, the 3 gowns verified, the open legacy booking placed on a gown; audited', async () => {
    const r2 = (await reqCount(3)).data;
    const ok = await decide(r2.id, 'approve', tok.approver, { note: 'recounted with the inventory manager' });
    eq([ok.status, ok.data?.status, productActive()], [200, 'APPLIED', 'true'], 'applied');
    eq(sql(`SELECT count(*) FROM "RentalUnit" WHERE "productId" = '${P}' AND "trackingVerifiedAt" IS NOT NULL`), '3', 'verified gowns');
    const g = sql(`SELECT u.code FROM "RentalOrder" r JOIN "RentalUnit" u ON u.id = r."rentalUnitId" WHERE r.id = '${legacyBooking.id}'`);
    assert(/^GOWN-M-0[12]$/.test(g), `legacy booking placed on ${g}`);
    eq(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action = 'UNIT_TRACKING_ACTIVATED' AND "entityId" = '${P}'`), '1', 'audited');
    eq((await track()).data.mode, 'UNITS', 'mode');
  });
  await check('rollback: deactivation (reviewer, audited) returns to the legacy rule and un-verifies the gowns; re-activation needs a new approved count', async () => {
    const d = await call('POST', `/rental-units/products/${P}/tracking/deactivate`, { token: tok.approver, body: { reason: 'rehearse rollback' } });
    eq([d.status, d.data?.action, productActive()], [201, 'DEACTIVATE', 'false'], 'deactivated');
    eq(sql(`SELECT count(*) FROM "RentalUnit" WHERE "productId" = '${P}' AND "trackingVerifiedAt" IS NOT NULL`), '0', 'unverified');
    eq(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action = 'UNIT_TRACKING_DEACTIVATED' AND "entityId" = '${P}'`), '1', 'audited');
    const r3 = (await reqCount(3)).data;
    eq((await decide(r3.id, 'approve', tok.approver)).status, 200, 're-activated');
    eq(productActive(), 'true', 'active again');
  });
  await check('a resized counted gown drops out of the verified set (needs a recount); capacity never grows without approval', async () => {
    const before = sql(`SELECT count(*) FROM "RentalUnit" WHERE "productId" = '${P}' AND "trackingVerifiedAt" IS NOT NULL`);
    const r = await call('PATCH', `/rental-units/${uS1.id}`, { token: tok.super, body: { variantIds: [ids.gown.S, ids.gown.M] } });
    eq(r.status, 200, 'resize');
    eq([before, sql(`SELECT ("trackingVerifiedAt" IS NULL)::text FROM "RentalUnit" WHERE id = '${uS1.id}'`)], ['3', 'true'], 'unverified');
    eq((await call('PATCH', `/rental-units/${uS1.id}`, { token: tok.super, body: { variantIds: [ids.gown.S] } })).status, 200, 'size back');
    const r4 = (await reqCount(3)).data;
    eq((await decide(r4.id, 'approve', tok.approver)).status, 200, 'recount approved');
  });
}
await check('quote: available, unit-managed, fee 400,000 / down payment 100,000 / deposit 200,000 / late fee 40,000 a day', async () => {
  const q = await call('POST', '/pos-rentals/quote', { token: tok.cashier, body: { productId: ids.gown.id, variantId: ids.gown.M, startDate: day(20), returnDate: day(22), pickupDate: day(20) } });
  eq([q.status, q.data.available, q.data.unitManaged, q.data.rentalFee, q.data.downPayment, q.data.deposit, q.data.lateFeePerDay, q.data.balanceAfterDownPayment, q.data.dueBeforeHandover],
    [201, true, true, 400000, 100000, 200000, 40000, 300000, 600000], 'quote');
});

// ---------------------------------------------------------------------------
console.log('\n3. booking (before ID approval) and the double-booking race');
await check('the customer must accept the terms (400 without)', async () => {
  eq((await book(c1.id, 'M', 20, { termsAccepted: false })).status, 400, 'no terms');
});
const b1 = (await book(c1.id, 'M', 20)).data;
await check('booking accepted BEFORE any ID: PENDING_ID_VERIFICATION, channel POS, unit allocated, staff + terms recorded', async () => {
  eq([b1.status, b1.channel, !!b1.rentalUnitId, b1.createdByAdminId, !!b1.termsAcceptedAt], ['PENDING_ID_VERIFICATION', 'POS', true, ids.admins.cashier.id, true], 'booking');
});
const racers = [];
for (let i = 0; i < 3; i++) racers.push((await newCustomer(`Race${i}`)).data);
const race = await Promise.all(racers.map((c) => book(c.id, 'M', 30)));
await check('race — 3 simultaneous bookings for size M on the same dates, 2 M units: exactly 2 succeed, on DIFFERENT units', async () => {
  const ok = race.filter((r) => r.status === 201);
  eq([ok.length, race.filter((r) => r.status === 409).length], [2, 1], 'outcomes');
  assert(ok[0].data.rentalUnitId !== ok[1].data.rentalUnitId, 'same unit twice');
});
await check('size S still bookable on those dates (its own unit); a second S is refused', async () => {
  const s1 = await book(racers[2].id, 'S', 30);
  const s2 = await book(c1.id, 'S', 30);
  eq([s1.status, s1.data?.rentalUnitId, s2.status], [201, uS1.id, 409], 'S');
});

// ---------------------------------------------------------------------------
console.log('\n4. ID in person (2FA reviewer) and payments by component');
await check('cashier (no id-verification:review) and a reviewer WITHOUT 2FA cannot record the ID (403)', async () => {
  const a = await call('POST', `/pos-rentals/${b1.id}/id-in-person`, { token: tok.cashier, body: { idType: 'NATIONAL_ID', idNumber: '19900101-12345' } });
  const b = await call('POST', `/pos-rentals/${b1.id}/id-in-person`, { token: tok.reviewerNo2fa, body: { idType: 'NATIONAL_ID', idNumber: '19900101-12345' } });
  eq([a.status, b.status, b.data?.code], [403, 403, 'TWO_FA_REQUIRED'], 'codes');
});
await check('a deposit paid BEFORE the ID and before the fee never confirms the booking', async () => {
  const d = await payCash(b1.id, 'DEPOSIT', 200000);
  eq([d.status, statusOf(b1.id), d.data.ledger.collected.DEPOSIT, d.data.ledger.collected.RENTAL_FEE], [201, 'PENDING_ID_VERIFICATION', 200000, 0], 'deposit');
});
await check('reviewer with 2FA records the ID in person → approved (number only, no image), booking ID_VERIFIED', async () => {
  const r = await call('POST', `/pos-rentals/${b1.id}/id-in-person`, { token: tok.reviewer, body: { idType: 'NATIONAL_ID', idNumber: '19900101-12345' } });
  eq([r.status, r.data.idApproved, statusOf(b1.id)], [201, true, 'ID_VERIFIED'], 'approved');
  eq(sql(`SELECT "frontImageUrl" LIKE 'in-person://%' FROM "CustomerIDDocument" WHERE "userId" = '${c1.id}'`), 't', 'marker');
});
await check('cash needs the cashier\'s OWN open shift (400 without / with someone else\'s)', async () => {
  const a = await call('POST', `/pos-rentals/${b1.id}/payments`, { token: tok.cashier, body: { component: 'RENTAL_FEE', tenders: [{ method: 'CASH', amount: 1000 }] } });
  const b = await payCash(b1.id, 'RENTAL_FEE', 1000, tok.cashier, S.cashier2);
  eq([a.status, b.status], [400, 400], 'codes');
});
await check('down payment 100,000 cash → DOWN_PAYMENT_PAID (confirmed)', async () => {
  const r = await payCash(b1.id, 'RENTAL_FEE', 100000);
  eq([r.status, statusOf(b1.id)], [201, 'DOWN_PAYMENT_PAID'], 'confirmed');
});
await check('card without terminal evidence → 400 PAYMENT_NOT_VERIFIED; with reference + approval code → recorded as manually confirmed', async () => {
  const bad = await call('POST', `/pos-rentals/${b1.id}/payments`, { token: tok.cashier, body: { component: 'RENTAL_FEE', tenders: [{ method: 'CARD', amount: 300000 }] } });
  eq([bad.status, bad.data?.code], [400, 'PAYMENT_NOT_VERIFIED'], 'unverified');
  const ok = await call('POST', `/pos-rentals/${b1.id}/payments`, { token: tok.cashier, body: { component: 'RENTAL_FEE', tenders: [{ method: 'CARD', amount: 300000, transactionRef: 'RRN-778899', approvalCode: 'A1B2C3' }] } });
  eq([ok.status, statusOf(b1.id), ok.data.ledger.feeFullyPaid], [201, 'FULLY_PAID', true], 'card');
});
await check('never collects more than is due; a reused reference → 409', async () => {
  const over = await payCash(b1.id, 'RENTAL_FEE', 1);
  const dup = await call('POST', `/pos-rentals/${b1.id}/payments`, { token: tok.cashier, body: { component: 'LATE_FEE', tenders: [{ method: 'CARD', amount: 1, transactionRef: 'RRN-778899', approvalCode: 'A1B2C3' }] } });
  eq([over.status, dup.status], [400, 409], 'codes');
});
await check('deposit recorded separately from the fee (ledger + payment rows carry the component)', async () => {
  eq(sql(`SELECT string_agg(component || ':' || amount::int, ',' ORDER BY "createdAt") FROM "Payment" WHERE "rentalOrderId" = '${b1.id}' AND status = 'COMPLETED'`),
    'DEPOSIT:200000,RENTAL_FEE:100000,RENTAL_FEE:300000', 'rows');
});

// ---------------------------------------------------------------------------
console.log('\n5. handover gate');
await check('no address on file → 422 HANDOVER_BLOCKED [ADDRESS]; nothing changed', async () => {
  const r = await call('POST', `/pos-rentals/${b1.id}/handover`, { token: tok.cashier, body: { unitCode: 'GOWN-M-01' } });
  eq([r.status, r.data?.code, r.data?.missing], [422, 'HANDOVER_BLOCKED', ['ADDRESS']], 'blocked');
  eq(statusOf(b1.id), 'FULLY_PAID', 'unchanged');
});
await call('POST', `/pos-rentals/customers/${c1.id}/address`, { token: tok.cashier, body: { street: 'Mwenge 12', city: 'Dar es Salaam', region: 'Dar es Salaam' } });
const allocatedCode = sql(`SELECT u.code FROM "RentalOrder" r JOIN "RentalUnit" u ON u.id = r."rentalUnitId" WHERE r.id = '${b1.id}'`);
await check('the wrong unit tag → 400 UNIT_MISMATCH; STAFF → 403', async () => {
  const wrong = await call('POST', `/pos-rentals/${b1.id}/handover`, { token: tok.cashier, body: { unitCode: allocatedCode === 'GOWN-M-01' ? 'GOWN-M-02' : 'GOWN-M-01' } });
  const staff = await call('POST', `/pos-rentals/${b1.id}/handover`, { token: tok.staff, body: { unitCode: allocatedCode } });
  eq([wrong.status, wrong.data?.code, staff.status], [400, 'UNIT_MISMATCH', 403], 'codes');
});
// R1 rollback safety switch (feat/unified-refunds): with R3's checklist
// requirement on, a build without the checklist refuses EVERY hand-over route.
if (process.env.IT_SAFEGUARD === '1' && !R3) { // R1/R2 builds only: R3 has its own (r3-checklist.it.mjs)
  await check('safety switch ON (as after an R3 rollback): POS hand-over AND the generic status route are refused, fail closed, audited', async () => {
    eq((await call('PUT', '/rental-handover-safeguard', { token: tok.cashier, body: { checklistRequired: true, reason: 'cashier tries to change it' } })).status, 403, 'cashier');
    const on = await call('PUT', '/rental-handover-safeguard', { token: tok.super, body: { checklistRequired: true, reason: 'rehearse an R3 rollback' } });
    eq([on.status, on.data?.handoversAllowed], [200, false], 'on');
    const pos = await call('POST', `/pos-rentals/${b1.id}/handover`, { token: tok.cashier, body: { unitCode: allocatedCode } });
    const disp = await call('PATCH', `/rentals/${b1.id}/status`, { token: tok.super, body: { status: 'ITEM_DISPATCHED' } });
    const act = await call('PATCH', `/rentals/${b1.id}/status`, { token: tok.super, body: { status: 'ACTIVE' } });
    eq([pos.status, pos.data?.code, disp.status, disp.data?.code, act.status, act.data?.code],
      [422, 'HANDOVER_REQUIRES_CHECKLIST_BUILD', 422, 'HANDOVER_REQUIRES_CHECKLIST_BUILD', 422, 'HANDOVER_REQUIRES_CHECKLIST_BUILD'], 'every route');
    eq(statusOf(b1.id), 'FULLY_PAID', 'nothing handed over');
    assert(Number(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action = 'RELEASE_BLOCKED' AND "entityId" = '${b1.id}' AND details::text LIKE '%CHECKLIST_BUILD%'`)) >= 3, 'refusals audited');
  });
  await check('break-glass: the owner switches it OFF with a reason (audited) → hand-overs follow the normal gate again', async () => {
    const off = await call('PUT', '/rental-handover-safeguard', { token: tok.super, body: { checklistRequired: false, reason: 'rehearsal over: R3 not shipped yet' } });
    eq([off.status, off.data?.handoversAllowed], [200, true], 'off');
    eq(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action = 'HANDOVER_SAFEGUARD_CHANGED'`), '2', 'audited');
  });
  await check('INVARIANT: once R3 exists (its table, simulated) a build without the checklist refuses every route EVEN with the switch OFF / missing; no break-glass', async () => {
    sql(`CREATE TABLE "RentalChecklistSnapshot" (id text PRIMARY KEY)`); // what R3's expand-only migration creates
    try {
      sql(`DELETE FROM "RentalHandoverSafeguard"`); // "missing configuration"
      const st = await call('GET', '/rental-handover-safeguard', { token: tok.super });
      eq([st.data?.handoversAllowed, st.data?.blockedBy], [false, 'HANDOVER_REQUIRES_CHECKLIST_BUILD'], 'status');
      const pos = await call('POST', `/pos-rentals/${b1.id}/handover`, { token: tok.cashier, body: { unitCode: allocatedCode } });
      const legacy = await call('PATCH', `/rentals/${b1.id}/status`, { token: tok.super, body: { status: 'ITEM_DISPATCHED' } });
      eq([pos.data?.code, legacy.data?.code], ['HANDOVER_REQUIRES_CHECKLIST_BUILD', 'HANDOVER_REQUIRES_CHECKLIST_BUILD'], 'routes');
      const off = await call('PUT', '/rental-handover-safeguard', { token: tok.super, body: { checklistRequired: false, reason: 'try to switch off after R3' } });
      eq(off.data?.handoversAllowed, false, 'switching OFF does not unblock once R3 exists');
      eq(statusOf(b1.id), 'FULLY_PAID', 'nothing handed over');
    } finally {
      sql(`DROP TABLE IF EXISTS "RentalChecklistSnapshot"`); // back to a pre-R3 database for the rest of the suite
    }
  });
}
await r3Record(b1.id, 'HANDOVER');
await check('everything settled + the right tag → ACTIVE, handover time + staff recorded', async () => {
  const r = await call('POST', `/pos-rentals/${b1.id}/handover`, { token: tok.cashier, body: { unitCode: allocatedCode } });
  eq([r.status, statusOf(b1.id)], [201, 'ACTIVE'], 'handed over');
  eq(sql(`SELECT ("handedOverAt" IS NOT NULL)::text || ':' || "handedOverByAdminId" FROM "RentalOrder" WHERE id = '${b1.id}'`), `true:${ids.admins.cashier.id}`, 'recorded');
});
await check('the generic status route is gated too: a booking without the deposit can\'t be set ACTIVE (422 HANDOVER_BLOCKED)', async () => {
  const r2 = race.find((r) => r.status === 201).data;
  await call('POST', `/pos-rentals/${r2.id}/id-in-person`, { token: tok.reviewer, body: { idType: 'NATIONAL_ID', idNumber: '19911111-22222' } });
  await payCash(r2.id, 'RENTAL_FEE', 400000);
  const r = await call('PATCH', `/rentals/${r2.id}/status`, { token: tok.super, body: { status: 'ACTIVE' } });
  eq([r.status, r.data?.code, (r.data?.missing ?? []).includes('DEPOSIT')], [422, 'HANDOVER_BLOCKED', true], 'gated');
});

// ---------------------------------------------------------------------------
console.log('\n6. return (late), late fee, deposit settlement with four-eyes refund');
sql(`UPDATE "RentalOrder" SET "returnDate" = (now() AT TIME ZONE 'UTC') - interval '2 days 2 hours' WHERE id = '${b1.id}'`);
await check('return 2 days late, minor damage: RETURNED, late fee 2 × 40,000 assessed, condition + unit to maintenance recorded', async () => {
  const r = await call('POST', `/pos-rentals/${b1.id}/return`, { token: tok.cashier, body: { condition: 'MINOR_DAMAGE', notes: 'Hem stain', unitStatus: 'MAINTENANCE' } });
  eq([r.status, statusOf(b1.id), Number(r.data.lateFee), r.data.ledger.outstanding.LATE_FEE], [201, 'RETURNED', 80000, 80000], 'returned');
  eq(sql(`SELECT status FROM "RentalUnit" WHERE code = '${allocatedCode}'`), 'MAINTENANCE', 'unit');
});
await check('late fee paid as its own component', async () => {
  const r = await payCash(b1.id, 'LATE_FEE', 80000);
  eq([r.status, r.data.ledger.lateFeePaid], [201, true], 'late fee');
});
if (R3) {
  // R3: the inspection records the stain; a reviewer (not the inspector) resolves it as deducted.
  // Round 25F: the checklist reviewer decides the deduction, so the SUPER_ADMIN who later approves
  // the deposit refund is independent of it (refund separation of duties, G3).
  const ins = await r3Record(b1.id, 'RETURN', 'DAMAGED', 'Hem stain');
  const d = ins.discrepancies.find((x) => x.kind === 'DAMAGED');
  const res = await call('PATCH', `/rental-checklist/discrepancies/${d.id}/resolve`, { token: tok.checker ?? tok.super, body: { resolution: 'RESOLVED_DEDUCTED', note: 'cleaning + repair' } });
  if (res.status !== 200) throw new Error(`R3 resolve ${res.status}`);
}
let depReq;
await check('deposit return requested with 50,000 retained for damage (reason), capped at the deposit held', async () => {
  const over = await call('POST', `/rental-money/rentals/${b1.id}/refund-requests`, { token: tok.cashier, body: { kind: 'DEPOSIT_RETURN', component: 'DEPOSIT', amount: 160000, retainedAmount: 50000, reason: 'x' } });
  const r = await call('POST', `/rental-money/rentals/${b1.id}/refund-requests`, { token: tok.cashier, body: { kind: 'DEPOSIT_RETURN', component: 'DEPOSIT', amount: 150000, retainedAmount: 50000, reason: 'Hem stain: cleaning + repair' } });
  depReq = r.data;
  eq([over.status, r.status, r.data?.status], [400, 201, 'REQUESTED'], 'request');
});
await check('four-eyes: the requester can\'t approve (403 SELF_APPROVAL); cashier lacks refunds:approve anyway; approver approves', async () => {
  const self = await call('PATCH', `/rental-money/refund-requests/${depReq.id}/approve`, { token: tok.super }); // super didn't request → allowed? (requester is cashier)
  eq(self.status, 200, 'a different SUPER_ADMIN may approve');
  const again = await call('PATCH', `/rental-money/refund-requests/${depReq.id}/approve`, { token: tok.approver });
  eq(again.status, 409, 'already approved → 409');
});
await check('payout by finance (mobile money, reference): a NEW REFUNDED row linked to the deposit collection; deposit held 0, retained 50,000', async () => {
  const noRef = await call('PATCH', `/rental-money/refund-requests/${depReq.id}/pay`, { token: tok.finance, body: { method: 'MOBILE_MONEY' } });
  const r = await call('PATCH', `/rental-money/refund-requests/${depReq.id}/pay`, { token: tok.finance, body: { method: 'MOBILE_MONEY', reference: 'MPESA-RF-001' } });
  eq([noRef.status, r.status, r.data?.status], [400, 200, 'PAID'], 'paid');
  eq(sql(`SELECT p.component || ':' || p.amount::int || ':' || (src.component) FROM "Payment" p JOIN "Payment" src ON src.id = p."refundOfPaymentId" WHERE p."refundRequestId" = '${depReq.id}'`), 'DEPOSIT:150000:DEPOSIT', 'linked row');
  const l = await call('GET', `/rental-money/rentals/${b1.id}/ledger`, { token: tok.finance });
  eq([l.data.held.DEPOSIT, l.data.retained.DEPOSIT, l.data.refunded.DEPOSIT], [0, 50000, 150000], 'ledger');
});

// ---------------------------------------------------------------------------
console.log('\n7. cancellation refund: request, self-approval refused, cash payout from the shift, failure restores the liability');
const c2 = (await newCustomer('Cancel')).data;
const b2 = (await book(c2.id, 'M', 50)).data;
await call('POST', `/pos-rentals/${b2.id}/id-in-person`, { token: tok.reviewer, body: { idType: 'NATIONAL_ID', idNumber: '19920202-33333' } });
await payCash(b2.id, 'RENTAL_FEE', 100000);
await check('staff cancel a booking holding money → CANCELLED + REFUND_DUE (dates freed, money NOT refunded)', async () => {
  const r = await call('PATCH', `/rentals/${b2.id}/status`, { token: tok.cashier, body: { status: 'CANCELLED' } });
  eq([r.status, sql(`SELECT "holdState" FROM "RentalOrder" WHERE id = '${b2.id}'`)], [200, 'REFUND_DUE'], 'cancel');
  eq(sql(`SELECT count(*) FROM "Payment" WHERE "rentalOrderId" = '${b2.id}' AND status = 'REFUNDED'`), '0', 'nothing refunded');
});
let cReq;
await check('request by the approver themself, then approving it themself → 403 SELF_APPROVAL (audited)', async () => {
  // the approver has no rentals:refund-request; the cashier requests, and a cashier can never approve
  const r = await call('POST', `/rental-money/rentals/${b2.id}/refund-requests`, { token: tok.cashier, body: { kind: 'CANCELLATION', component: 'RENTAL_FEE', amount: 100000, reason: 'Customer cancelled 30 days ahead' } });
  if (CX) {
    // The cancellation already requested the full 100,000 (by the cashier who cancelled): a manual one finds nothing left.
    eq(r.status, 400, 'already requested by the cancellation');
    cReq = { id: sql(`SELECT id FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${b2.id}' AND kind = 'CANCELLATION' AND "requestedById" = '${ids.admins.cashier.id}' AND amount = 100000`) };
    assert(cReq.id, 'automatic request');
  } else cReq = r.data;
  const cashierApproves = await call('PATCH', `/rental-money/refund-requests/${cReq.id}/approve`, { token: tok.cashier });
  eq([CX ? 201 : r.status, cashierApproves.status], [201, 403], 'codes');
  // a SUPER_ADMIN who requested can't approve their own request
  const sReq = await call('POST', `/rental-money/rentals/${b2.id}/refund-requests`, { token: tok.super, body: { kind: 'CANCELLATION', component: 'RENTAL_FEE', amount: 1, reason: 'x' } });
  eq(sReq.status, 400, 'over the cap: the first request already claims the 100,000 held');
});
await check('approve (approver) → cash payout needs finance\'s open shift → PAID → REFUND_SETTLED', async () => {
  eq((await call('PATCH', `/rental-money/refund-requests/${cReq.id}/approve`, { token: tok.approver })).status, 200, 'approve');
  const noShift = await call('PATCH', `/rental-money/refund-requests/${cReq.id}/pay`, { token: tok.finance, body: { method: 'CASH' } });
  const ok = await call('PATCH', `/rental-money/refund-requests/${cReq.id}/pay`, { token: tok.finance, body: { method: 'CASH', sessionId: S.finance } });
  eq([noShift.status, ok.status, sql(`SELECT "holdState" FROM "RentalOrder" WHERE id = '${b2.id}'`)], [400, 200, 'REFUND_SETTLED'], 'paid');
  eq(sql(`SELECT ("gatewayResponse"->>'posSessionId') FROM "Payment" WHERE "refundRequestId" = '${cReq.id}'`), S.finance, 'drawer tag');
});
await check('payout failed → request FAILED, refund row REVERSED, booking back to REFUND_DUE (liability restored)', async () => {
  const r = await call('PATCH', `/rental-money/refund-requests/${cReq.id}/fail`, { token: tok.finance, body: { reason: 'Customer never collected the cash' } });
  eq([r.status, r.data?.status], [200, 'FAILED'], 'failed');
  eq([sql(`SELECT status FROM "Payment" WHERE "refundRequestId" = '${cReq.id}'`), sql(`SELECT "holdState" FROM "RentalOrder" WHERE id = '${b2.id}'`)], ['REVERSED', 'REFUND_DUE'], 'restored');
});
await check('after the failure the money is refundable again; a requester can never approve their OWN request (403 SELF_APPROVAL, audited)', async () => {
  const r = await call('POST', `/rental-money/rentals/${b2.id}/refund-requests`, { token: tok.super, body: { kind: 'CANCELLATION', component: 'RENTAL_FEE', amount: 100000, reason: 'Retry the refund by bank transfer' } });
  const self = await call('PATCH', `/rental-money/refund-requests/${r.data?.id}/approve`, { token: tok.super });
  eq([r.status, self.status, self.data?.code], [201, 403, 'SELF_APPROVAL'], 'four-eyes');
  eq(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action = 'REFUND_APPROVAL_DENIED' AND "entityId" = '${r.data?.id}'`), '1', 'audited');
});

// ---------------------------------------------------------------------------
console.log('\n8. receipts, agreement, report, resume, 0 % item, audit');
await check('agreement: ref, terms version, amounts, ID approved flag — never the ID number', async () => {
  const a = await call('GET', `/pos-rentals/${b1.id}/agreement`, { token: tok.cashier });
  eq([a.status, a.data.rentalNumber, a.data.agreementVersion, a.data.customer.nationalIdApproved, a.data.amounts.refundableDeposit], [200, b1.rentalNumber, 'NARO-RENTAL-AGREEMENT-2026-11', true, 200000], 'agreement');
  assert(!JSON.stringify(a.data).includes('19900101'), 'ID number leaked');
});
await check('receipt for the card payment (component, reference, manually confirmed)', async () => {
  const pid = sql(`SELECT id FROM "Payment" WHERE "rentalOrderId" = '${b1.id}' AND method = 'CARD'`);
  const r = await call('GET', `/pos-rentals/${b1.id}/receipts/${pid}`, { token: tok.cashier });
  eq([r.status, r.data.component, r.data.reference, r.data.manuallyConfirmed], [200, 'RENTAL_FEE', 'RRN-778899', true], 'receipt');
});
await check('rental ledger report: fee + late fee income, retained damage, deposits held, outstanding refunds', async () => {
  const period = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 7);
  const r = await call('GET', `/reports/rentals/ledger?period=${period}`, { token: tok.finance });
  eq(r.status, 200, 'report');
  eq([r.data.retainedDepositIncome, r.data.collected.LATE_FEE, r.data.refunded.DEPOSIT], [50000, 80000, 150000], 'figures');
  assert(r.data.liabilitiesNow.heldOnCancelledBookings >= 100000, 'cancelled-booking liability');
});
await check('resume after an interruption: look the booking up by its reference', async () => {
  const r = await call('GET', `/pos-rentals/lookup/${b1.rentalNumber.toLowerCase()}`, { token: tok.cashier });
  eq([r.status, r.data.id], [200, b1.id], 'lookup');
});
await check('idempotent retry of a booking (same Idempotency-Key) → one booking, replayed response', async () => {
  const c3 = (await newCustomer('Retry')).data;
  const key = `it-${randomBytes(8).toString('hex')}`;
  const body = { customerId: c3.id, productId: ids.gown.id, variantId: ids.gown.S, startDate: day(70), returnDate: day(72), pickupDate: day(70), termsAccepted: true };
  const a = await call('POST', '/pos-rentals', { token: tok.cashier, body, key });
  const b = await call('POST', '/pos-rentals', { token: tok.cashier, body, key });
  eq([a.status, b.status, a.data.id === b.data.id, sql(`SELECT count(*) FROM "RentalOrder" WHERE "userId" = '${c3.id}'`)], [201, 201, true, '1'], 'once');
});
await check('0 % item: confirmed by staff, never by "0 paid"; no payment deadline', async () => {
  const c4 = (await newCustomer('Zero')).data;
  const r = await call('POST', '/pos-rentals', { token: tok.cashier, body: { customerId: c4.id, productId: ids.zero.id, variantId: ids.zero.variantId, startDate: day(80), returnDate: day(82), pickupDate: day(80), termsAccepted: true } });
  await call('POST', `/pos-rentals/${r.data.id}/id-in-person`, { token: tok.reviewer, body: { idType: 'NATIONAL_ID', idNumber: '19930303-44444' } });
  eq([statusOf(r.data.id), sql(`SELECT "holdState" FROM "RentalOrder" WHERE id = '${r.data.id}'`)], ['ID_VERIFIED', 'NO_DOWN_PAYMENT'], 'zero');
});
await check('every money and handover step is audited', async () => {
  const acts = sql(`SELECT string_agg(DISTINCT action, ',' ORDER BY action) FROM "AdminActivityLog" WHERE action IN ('RENTAL_CREATED','RENTAL_PAYMENT_RECORDED','PAYMENT_MANUALLY_CONFIRMED','RENTAL_RELEASED','RELEASE_BLOCKED','RENTAL_RETURN_RECORDED','REFUND_REQUESTED','REFUND_APPROVED','REFUND_PAID','REFUND_FAILED','ID_VERIFIED_IN_PERSON','UNIT_CREATED','POS_CUSTOMER_CREATED')`);
  eq(acts.split(',').length, 13, `actions: ${acts}`);
});

// ---------------------------------------------------------------------------
// Runs only against a build with the refund controls (fix/rental-refund-controls).
if (process.env.IT_REFUND_CONTROLS === '1') {
  console.log('\n9. refund controls: no entry point bypasses request → independent approval → payout');
  const ledgerOf = async (id) => JSON.stringify((await call('GET', `/rental-money/rentals/${id}/ledger`, { token: tok.super })).data);
  await check('a by-hand status edit can never refund an ONLINE rental payment: 409 USE_REFUND_WORKFLOW, row + ledger unchanged', async () => {
    const pid = `it-online-${randomBytes(6).toString('hex')}`;
    sql(`INSERT INTO "Payment" (id, "tenantId", "rentalOrderId", amount, method, status, component, "transactionRef", "gatewayResponse", "createdAt", "updatedAt")
         VALUES ('${pid}', '${T}', '${b1.id}', 1000, 'MPESA', 'COMPLETED', 'LATE_FEE', 'IT-ONL-${pid.slice(-6)}', '{"provider":"clickpesa"}', now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC')`);
    const before = await ledgerOf(b1.id);
    const r = await call('PATCH', `/payments/${pid}`, { token: tok.super, body: { status: 'REFUNDED' } });
    eq([r.status, r.data?.code], [409, 'USE_REFUND_WORKFLOW'], 'refused');
    eq(sql(`SELECT status FROM "Payment" WHERE id = '${pid}'`), 'COMPLETED', 'row');
    eq(await ledgerOf(b1.id), before, 'ledger');
  });
  await check('the POS "reverse payment" refuses a rental payment (even a manually confirmed card): 409, unchanged', async () => {
    const pid = sql(`SELECT id FROM "Payment" WHERE "rentalOrderId" = '${b1.id}' AND method = 'CARD'`);
    const before = await ledgerOf(b1.id);
    const r = await call('POST', `/pos/payments/${pid}/reverse`, { token: tok.super, body: { reason: 'terminal report does not show it' } });
    eq([r.status, r.data?.code, sql(`SELECT status FROM "Payment" WHERE id = '${pid}'`)], [409, 'USE_REFUND_WORKFLOW', 'COMPLETED'], 'refused');
    eq(await ledgerOf(b1.id), before, 'ledger');
  });
  let rq;
  await check('approval does not move money: an APPROVED request leaves "held" unchanged (Refund Due ≠ refunded)', async () => {
    rq = sql(`SELECT id FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${b2.id}' AND status = 'REQUESTED' AND "requestedById" = '${ids.admins.super.id}' ORDER BY "createdAt" DESC LIMIT 1`);
    assert(rq, 'the retry request from section 7');
    const before = JSON.parse(await ledgerOf(b2.id));
    eq((await call('PATCH', `/rental-money/refund-requests/${rq}/approve`, { token: tok.approver })).status, 200, 'approve');
    const after = JSON.parse(await ledgerOf(b2.id));
    eq([after.held, after.refunded], [before.held, before.refunded], 'held / refunded unchanged by approval');
  });
  await check('the requester can never pay out their own request (even holding payments:manage): 403 PAYOUT_BY_REQUESTER, audited, no payout row', async () => {
    const r = await call('PATCH', `/rental-money/refund-requests/${rq}/pay`, { token: tok.super, body: { method: 'BANK_TRANSFER', reference: 'BANK-IT-0001' } });
    eq([r.status, r.data?.code], [403, 'PAYOUT_BY_REQUESTER'], 'refused');
    eq(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action = 'REFUND_PAYOUT_DENIED' AND "entityId" = '${rq}'`), '1', 'audited');
    eq(sql(`SELECT count(*) FROM "Payment" WHERE "refundRequestId" = '${rq}'`), '0', 'no payout');
  });
  await check('a different authorised person pays it out once; a second payout of the same request is refused', async () => {
    const ok = await call('PATCH', `/rental-money/refund-requests/${rq}/pay`, { token: tok.finance, body: { method: 'BANK_TRANSFER', reference: 'BANK-IT-0002' } });
    const again = await call('PATCH', `/rental-money/refund-requests/${rq}/pay`, { token: tok.finance, body: { method: 'BANK_TRANSFER', reference: 'BANK-IT-0003' } });
    eq([ok.status, again.status], [200, 409], 'once');
    eq(sql(`SELECT count(*)||'|'||min(status) FROM "Payment" WHERE "refundRequestId" = '${rq}'`), '1|REFUNDED', 'one linked payout row');
    eq(sql(`SELECT "requestedById" <> "paidById" FROM "RentalRefundRequest" WHERE id = '${rq}'`), 't', 'payer ≠ requester');
  });
  // IT_NO_UNIFIED=1: a build before R1b (#30) has no unified /refund-requests list.
  if (process.env.IT_NO_UNIFIED !== '1') await check('rental deposit returns are part of the unified list (/refund-requests, subject RENTAL) with their real status', async () => {
    const list = await call('GET', '/refund-requests?subject=RENTAL', { token: tok.super });
    eq(list.status, 200, 'list');
    const dep = list.data.find((r) => r.id === depReq.id);
    eq([dep?.kind, dep?.status, Number(dep?.retainedAmount)], ['DEPOSIT_RETURN', 'PAID', 50000], 'deposit return');
    assert(list.data.every((r) => r.subject === 'RENTAL'), 'subject filter');
  });
  await check('fresh database: the system MANAGER role holds none of the rental / refund controls', async () => {
    const codes = sql(`SELECT COALESCE(string_agg(p.code, ',' ORDER BY p.code), '') FROM "Role" r JOIN "RolePermission" rp ON rp."roleId" = r.id JOIN "Permission" p ON p.id = rp."permissionId"
      WHERE r.name = 'MANAGER' AND r."isSystem" AND r."tenantId" IS NULL AND p.code IN ('rentals:create','rentals:record-payment','rentals:release','rentals:refund-request','rentals:manage-inventory','refunds:approve','id-verification:review','payments:confirm-manual','payments:reverse','payments:manage','rentals:approve-unit-tracking')`);
    eq(codes, '', 'MANAGER grants');
    assert(sql(`SELECT count(*) FROM "Role" WHERE name = 'MANAGER' AND "isSystem" AND "tenantId" IS NULL`) === '1', 'MANAGER seeded');
  });
}

const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
