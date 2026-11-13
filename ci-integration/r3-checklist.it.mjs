// Real API + real Postgres acceptance test for R3, the mandatory rental
// checklist (owner requirements E1–E15, G). Local API (:4130) on the isolated
// schema it_pos seeded by pos-rental-seed.js (R3 build: checker role + bouquet).
// Never production.
//   node r3-checklist.it.mjs <pos-ids.json>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const API = (process.env.IT_API || 'http://localhost:4130/api/v1').replace(/\/$/, '');
if (!/^http:\/\/localhost:/.test(API)) throw new Error('refusing: localhost only');
const ids = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const T = ids.tenantId;
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe';
const psql = (q) => execFileSync(PSQL, ['-U', 'naro_admin', '-h', 'localhost', '-d', 'naro_fashion', '-qAt', '-v', 'ON_ERROR_STOP=1',
  '-c', `SET search_path TO it_pos; ${q}`], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sql = (q) => psql(q);
const sqlError = (q) => { try { psql(q); return null; } catch (e) { return String(e.stderr || e.message); } };
const ip = (s) => { const h = createHash('sha256').update(String(s)).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
async function call(method, p, { token, body } = {}) {
  const r = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': T, 'X-Forwarded-For': ip(token || body?.email || randomBytes(4).toString('hex')), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
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
const login = async (w) => { const r = await call('POST', '/auth/login', { body: { email: w.email, password: w.password } }); assert(r.data?.accessToken, `login ${w.email} ${r.status}`); return r.data.accessToken; };
const tok = {};
for (const k of ['super', 'cashier', 'cashier2', 'reviewer', 'checker', 'staff', 'finance', 'approver']) tok[k] = await login(ids.admins[k]);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const statusOf = (id) => sql(`SELECT status FROM "RentalOrder" WHERE id = '${id}'`);
const G = ids.gown, B = ids.bouquet, S = ids.sessions;

// ---- helpers: a confirmed, fully paid booking ready for hand-over except the checklist
let customerSeq = 0;
async function readyBooking(productId, variantId, start, { fee, deposit }) {
  const c = (await call('POST', '/pos-rentals/customers', { token: tok.cashier, body: { firstName: 'R3', lastName: `C${++customerSeq}`, phone: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } })).data;
  await call('POST', `/pos-rentals/customers/${c.id}/address`, { token: tok.cashier, body: { street: 'Mwenge 12', city: 'Dar es Salaam', region: 'Dar es Salaam' } });
  const b = await call('POST', '/pos-rentals', { token: tok.cashier, body: { customerId: c.id, productId, variantId, startDate: day(start), returnDate: day(start + 2), pickupDate: day(start), termsAccepted: true } });
  assert(b.status === 201, `book ${b.status} ${JSON.stringify(b.data).slice(0, 160)}`);
  const id = b.data.id;
  const v = await call('POST', `/pos-rentals/${id}/id-in-person`, { token: tok.reviewer, body: { idType: 'NATIONAL_ID', idNumber: `1990${String(customerSeq).padStart(4, '0')}-12345` } });
  assert(v.status === 201, `id ${v.status}`);
  for (const [component, amount] of [['RENTAL_FEE', fee], ['DEPOSIT', deposit]]) {
    if (!amount) continue;
    const p = await call('POST', `/pos-rentals/${id}/payments`, { token: tok.cashier, body: { component, sessionId: S.cashier, tenders: [{ method: 'CASH', amount }] } });
    assert(p.status === 201, `pay ${component} ${p.status} ${JSON.stringify(p.data).slice(0, 120)}`);
  }
  return id;
}
const state = async (id, token = tok.cashier) => (await call('GET', `/rental-checklist/rentals/${id}`, { token })).data;
const itemId = (st, label) => st.items.find((i) => i.label === label)?.id;
const record = (id, stage, entries, token = tok.cashier) => call('POST', `/rental-checklist/rentals/${id}/records`, { token, body: { stage, entries } });
const handover = (id, token = tok.cashier) => call('POST', `/pos-rentals/${id}/handover`, { token, body: {} });
const allHandover = (st, except = []) => st.items.filter((i) => i.stage === 'BOTH' && !except.includes(i.label))
  .map((i) => ({ snapshotItemId: i.id, quantity: i.quantity, ...(i.requiresCondition ? { condition: 'GOOD' } : {}) }));

console.log(`real API ${API} · isolated schema it_pos · R3 mandatory checklist`);

// ---------------------------------------------------------------------------
console.log('\n1. templates (product, category) — gowns, bouquets and other products');
let gownTpl, bouquetTpl;
await check('a cashier cannot create templates (403); the template editor creates a PRODUCT list (gown) and a CATEGORY list (bouquets)', async () => {
  eq((await call('POST', '/rental-checklists/templates', { token: tok.cashier, body: { name: 'x', items: [] } })).status, 403, 'cashier');
  const g = await call('POST', '/rental-checklists/templates', { token: tok.checker, body: {
    name: 'Ivory gown set', productId: G.id, items: [
      { label: 'Gown', itemType: 'DISPATCH', quantity: 1, instructions: 'Check hem, zip, beading' },
      { label: 'Veil', itemType: 'DISPATCH', quantity: 1 },
      { label: 'Padded hangers', itemType: 'DISPATCH', quantity: 2, requiresCondition: false },
      { label: 'Garment bag', itemType: 'DISPATCH', isMandatory: false, requiresCondition: false },
      { label: 'Stains / odour check', itemType: 'RETURN' },
    ] } });
  gownTpl = g.data;
  const b = await call('POST', '/rental-checklists/templates', { token: tok.checker, body: {
    name: 'Bouquets', categoryId: B.categoryId, items: [{ label: 'Bouquet', itemType: 'DISPATCH' }, { label: 'Satin ribbons', itemType: 'DISPATCH', quantity: 2 }] } });
  bouquetTpl = b.data;
  eq([g.status, g.data?.productId, g.data?.version, b.status, b.data?.categoryId], [201, G.id, 1, 201, B.categoryId], 'created');
  eq((await call('POST', '/rental-checklists/templates', { token: tok.checker, body: { name: 'bad', productId: G.id, categoryId: B.categoryId, items: [] } })).status, 400, 'product AND category refused');
});

// ---------------------------------------------------------------------------
console.log('\n2. snapshot fixed at confirmation; template edits do not change it');
const b1 = await readyBooking(G.id, G.M, 20, { fee: 400000, deposit: 200000 });
let st1;
await check('confirmation froze the booking\'s checklist automatically from the PRODUCT template (version 1); the row records when (frozenById null = automatic)', async () => {
  st1 = await state(b1);
  eq([statusOf(b1), st1.snapshot?.source, st1.snapshot?.templateVersion, st1.items.map((i) => i.label)],
    ['FULLY_PAID', 'PRODUCT', 1, ['Gown', 'Veil', 'Padded hangers', 'Garment bag', 'Stains / odour check']], 'snapshot');
  eq(st1.handover.unresolved, ['Gown', 'Veil', 'Padded hangers'], 'mandatory unresolved');
});
await check('editing the template afterwards (renamed + a new item, version 2) does NOT change this booking', async () => {
  const u = await call('PUT', `/rental-checklists/templates/${gownTpl.id}`, { token: tok.checker, body: { items: [
    { label: 'Gown (renamed)', itemType: 'DISPATCH' }, { label: 'Veil', itemType: 'DISPATCH' }, { label: 'Tiara', itemType: 'DISPATCH' },
    { label: 'Padded hangers', itemType: 'DISPATCH', quantity: 2, requiresCondition: false }, { label: 'Stains / odour check', itemType: 'RETURN' } ] } });
  eq([u.status, u.data?.version], [200, 2], 'template v2');
  const again = await state(b1);
  eq([again.items.map((i) => i.label), again.snapshot.templateVersion, again.snapshot.currentTemplateVersion], [st1.items.map((i) => i.label), 1, 2], 'unchanged');
});

// ---------------------------------------------------------------------------
console.log('\n3. hand-over gate');
await check('nothing checked → 422 CHECKLIST_INCOMPLETE listing every mandatory item; status unchanged; audited', async () => {
  const r = await handover(b1);
  eq([r.status, r.data?.code, r.data?.missing, statusOf(b1)], [422, 'CHECKLIST_INCOMPLETE', ['CHECKLIST:Gown', 'CHECKLIST:Veil', 'CHECKLIST:Padded hangers'], 'FULLY_PAID'], 'blocked');
  assert(Number(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action = 'RELEASE_BLOCKED' AND "entityId" = '${b1}'`)) >= 1, 'audited');
});
await check('ONE mandatory item unchecked (veil) blocks; the optional garment bag never does', async () => {
  const r = await record(b1, 'HANDOVER', allHandover(st1, ['Veil', 'Garment bag']));
  eq(r.status, 201, 'recorded');
  const h = await handover(b1);
  eq([h.status, h.data?.missing], [422, ['CHECKLIST:Veil']], 'veil');
});
await check('a short quantity counts as unchecked (1 of 2 hangers)', async () => {
  const st = await state(b1);
  const hangers = st.items.find((i) => i.label === 'Padded hangers');
  const r = await record(b1, 'HANDOVER', [{ snapshotItemId: hangers.id, quantity: 1, supersedesId: hangers.handover.id }]);
  eq(r.status, 201, 'corrected down');
  eq((await handover(b1)).data?.missing, ['CHECKLIST:Veil', 'CHECKLIST:Padded hangers'], 'both');
  const st2 = await state(b1);
  eq((await record(b1, 'HANDOVER', [{ snapshotItemId: hangers.id, quantity: 2, supersedesId: st2.items.find((i) => i.label === 'Padded hangers').handover.id }])).status, 201, 'corrected back');
});
await check('two employees recording the same item at once: exactly one succeeds, the other gets 409 CHECKLIST_CHANGED (no overwrite)', async () => {
  const veil = itemId(st1, 'Veil');
  const [a, b] = await Promise.all([
    record(b1, 'HANDOVER', [{ snapshotItemId: veil, quantity: 1, condition: 'GOOD', note: 'clerk A' }], tok.cashier),
    record(b1, 'HANDOVER', [{ snapshotItemId: veil, quantity: 1, condition: 'MINOR_WEAR', note: 'clerk B' }], tok.cashier2),
  ]);
  eq([a.status, b.status].sort(), [201, 409], 'one wins');
  eq((a.status === 409 ? a : b).data?.code, 'CHECKLIST_CHANGED', 'loser code');
  eq(sql(`SELECT count(*) FROM "RentalChecklistRecord" WHERE "rentalOrderId" = '${b1}' AND "snapshotItemId" = '${veil}'`), '1', 'one row');
});
await check('a correction naming an outdated record is refused (409); the original row is never rewritten', async () => {
  const st = await state(b1);
  const gown = st.items.find((i) => i.label === 'Gown');
  const before = sql(`SELECT condition || '|' || "recordedById" FROM "RentalChecklistRecord" WHERE id = '${gown.handover.id}'`);
  eq((await record(b1, 'HANDOVER', [{ snapshotItemId: gown.id, quantity: 1, condition: 'MINOR_WEAR', supersedesId: gown.handover.id }], tok.cashier2)).status, 201, 'first correction');
  const stale = await record(b1, 'HANDOVER', [{ snapshotItemId: gown.id, quantity: 1, condition: 'DAMAGED', supersedesId: gown.handover.id }], tok.cashier);
  eq([stale.status, stale.data?.code], [409, 'CHECKLIST_CHANGED'], 'stale');
  eq(sql(`SELECT condition || '|' || "recordedById" FROM "RentalChecklistRecord" WHERE id = '${gown.handover.id}'`), before, 'original intact');
});
await check('complete checklist → POS hand-over succeeds (ACTIVE); the evidence is then frozen (409 CHECKLIST_STAGE_CLOSED)', async () => {
  const h = await handover(b1);
  eq([h.status, statusOf(b1)], [201, 'ACTIVE'], 'handed over');
  const st = await state(b1);
  eq((await record(b1, 'HANDOVER', [{ snapshotItemId: itemId(st, 'Gown'), quantity: 1, condition: 'GOOD', supersedesId: st.items[0].handover.id }])).data?.code, 'CHECKLIST_STAGE_CLOSED', 'frozen');
});

// ---------------------------------------------------------------------------
console.log('\n4. exceptions: independently approved, single use, this booking only');
const b2 = await readyBooking(G.id, G.S, 40, { fee: 400000, deposit: 200000 });
const b3 = await readyBooking(G.id, G.S, 60, { fee: 400000, deposit: 200000 });
let ex;
await check('veil missing: a cashier requests an exception; the requester / a cashier without the permission cannot approve (403)', async () => {
  const st = await state(b2);
  await record(b2, 'HANDOVER', allHandover(st, ['Veil']));
  const r = await call('POST', `/rental-checklist/rentals/${b2}/exceptions`, { token: tok.cashier, body: { kind: 'MISSING', snapshotItemIds: [itemId(st, 'Veil')], reason: 'Veil at the cleaners; customer agreed to collect it tomorrow' } });
  ex = r.data;
  eq([r.status, ex?.status], [201, 'REQUESTED'], 'requested');
  eq((await call('PATCH', `/rental-checklist/exceptions/${ex.id}/approve`, { token: tok.cashier, body: {} })).status, 403, 'requester (no permission)');
  eq((await call('PATCH', `/rental-checklist/exceptions/${ex.id}/approve`, { token: tok.cashier2, body: {} })).status, 403, 'another cashier');
  eq((await handover(b2)).data?.missing, ['CHECKLIST:Veil'], 'REQUESTED covers nothing');
});
await check('the reviewer approves; the reviewer then cannot hand the item over themselves (403 EXCEPTION_DECIDER_HANDING_OVER)', async () => {
  const ok = await call('PATCH', `/rental-checklist/exceptions/${ex.id}/approve`, { token: tok.checker, body: { note: 'agreed' } });
  eq([ok.status, ok.data?.status, ok.data?.decidedById], [200, 'APPROVED', ids.admins.checker.id], 'approved');
  const self = await handover(b2, tok.checker);
  eq([self.status, self.data?.code, statusOf(b2)], [403, 'EXCEPTION_DECIDER_HANDING_OVER', 'FULLY_PAID'], 'decider');
});
await check('the approved exception permits ONLY this hand-over: another booking with the same missing veil stays blocked', async () => {
  const st = await state(b3);
  await record(b3, 'HANDOVER', allHandover(st, ['Veil']));
  eq((await handover(b3)).data?.missing, ['CHECKLIST:Veil'], 'b3 still blocked');
  const h = await handover(b2);
  eq([h.status, statusOf(b2)], [201, 'ACTIVE'], 'b2 handed over');
  eq(sql(`SELECT status || ':' || ("usedById" = '${ids.admins.cashier.id}')::text FROM "RentalChecklistException" WHERE id = '${ex.id}'`), 'USED:true', 'single use, recorded');
});
await check('(25C E) SUPER_ADMIN gets no shortcut: blocked by the checklist, can\'t approve its own exception (403), may hand over only once another person approved; can\'t review its own inspection (403)', async () => {
  const bs = await readyBooking(G.id, G.M, 100, { fee: 400000, deposit: 200000 });
  const st = await state(bs, tok.super);
  eq((await handover(bs, tok.super)).data?.code, 'CHECKLIST_INCOMPLETE', 'super blocked');
  await record(bs, 'HANDOVER', allHandover(st, ['Veil']), tok.super);
  const ex = (await call('POST', `/rental-checklist/rentals/${bs}/exceptions`, { token: tok.super, body: { kind: 'MISSING', snapshotItemIds: [itemId(st, 'Veil')], reason: 'veil being repaired, customer agreed' } })).data;
  const self = await call('PATCH', `/rental-checklist/exceptions/${ex.id}/approve`, { token: tok.super, body: {} });
  eq([self.status, self.data?.code], [403, 'SELF_APPROVAL'], 'own exception');
  eq((await handover(bs, tok.super)).data?.code, 'CHECKLIST_INCOMPLETE', 'still blocked');
  eq((await call('PATCH', `/rental-checklist/exceptions/${ex.id}/approve`, { token: tok.checker, body: {} })).status, 200, 'approved by another person');
  eq((await handover(bs, tok.super)).status, 201, 'handed over by super (not the decider)');
  await call('POST', `/pos-rentals/${bs}/return`, { token: tok.super, body: { condition: 'DAMAGED' } });
  const st2 = await state(bs, tok.super);
  const r = await record(bs, 'RETURN', [{ snapshotItemId: st2.items[0].id, quantity: 1, condition: 'DAMAGED', note: 'stain' }] /* the template was renamed in section 2: 'Gown (renamed)' */, tok.super);
  const d = r.data.discrepancies.find((x) => x.status === 'OPEN');
  const own = await call('PATCH', `/rental-checklist/discrepancies/${d.id}/resolve`, { token: tok.super, body: { resolution: 'RESOLVED_NO_CHARGE', note: 'my own inspection' } });
  eq([own.status, own.data?.code], [403, 'SELF_REVIEW'], 'own inspection');
});

// ---------------------------------------------------------------------------
console.log('\n5. return inspection against the original snapshot; discrepancies; closure and deposit gates');
await call('POST', `/pos-rentals/${b1}/return`, { token: tok.cashier, body: { condition: 'MINOR_DAMAGE', notes: 'see checklist' } });
await check('the return inspector sees exactly what was handed over (item, quantity, condition, who, when)', async () => {
  const st = await state(b1, tok.cashier2);
  eq(statusOf(b1), 'RETURNED', 'returned');
  const out = st.items.filter((i) => i.stage === 'BOTH').map((i) => [i.label, i.handover?.quantity ?? null, i.handover?.condition ?? null]);
  eq(out, [['Gown', 1, 'MINOR_WEAR'], ['Veil', 1, out[1][2]], ['Padded hangers', 2, null], ['Garment bag', null, null]], 'handed over');
  assert(st.items.filter((i) => i.handover).every((i) => i.handover.recordedById && i.handover.recordedAt && st.people[i.handover.recordedById]), 'who + when');
  eq(st.items.map((i) => i.label), ['Gown', 'Veil', 'Padded hangers', 'Garment bag', 'Stains / odour check'], 'original snapshot (template is v2 now)');
});
await check('closing or settling the deposit before the inspection → 409 INSPECTION_INCOMPLETE', async () => {
  eq((await call('PATCH', `/rentals/${b1}/status`, { token: tok.super, body: { status: 'CLOSED' } })).data?.code, 'INSPECTION_INCOMPLETE', 'close');
  const d = await call('POST', `/rental-money/rentals/${b1}/refund-requests`, { token: tok.cashier, body: { kind: 'DEPOSIT_RETURN', component: 'DEPOSIT', amount: 200000, reason: 'full deposit back' } });
  eq([d.status, d.data?.code], [409, 'INSPECTION_INCOMPLETE'], 'deposit');
});
let disc;
await check('a damaged gown and a missing hanger are recorded individually as OPEN discrepancies', async () => {
  const st = await state(b1, tok.cashier2);
  const by = (l) => st.items.find((i) => i.label === l).id;
  const r = await record(b1, 'RETURN', [
    { snapshotItemId: by('Gown'), quantity: 1, condition: 'DAMAGED', note: 'Torn lace at the hem' },
    { snapshotItemId: by('Veil'), quantity: 1, condition: 'GOOD' },
    { snapshotItemId: by('Padded hangers'), quantity: 1, note: 'one hanger not returned' },
    { snapshotItemId: by('Garment bag'), quantity: 1 },
    { snapshotItemId: by('Stains / odour check'), quantity: 1, condition: 'GOOD' },
  ], tok.cashier2);
  eq(r.status, 201, 'recorded');
  disc = r.data.discrepancies;
  eq(disc.map((d) => [d.kind, d.quantity, d.status]).sort(), [['DAMAGED', 1, 'OPEN'], ['MISSING', 1, 'OPEN']], 'discrepancies');
  eq(r.data.inspection.complete, true, 'every item inspected');
});
await check('a return cannot close with an open discrepancy; the deposit cannot be settled while one is open', async () => {
  eq((await call('PATCH', `/rentals/${b1}/status`, { token: tok.super, body: { status: 'INSPECTION' } })).status, 200, 'to INSPECTION');
  eq((await call('PATCH', `/rentals/${b1}/status`, { token: tok.super, body: { status: 'CLOSED' } })).data?.code, 'DISCREPANCY_OPEN', 'close');
  eq((await call('POST', `/rental-money/rentals/${b1}/refund-requests`, { token: tok.cashier, body: { kind: 'DEPOSIT_RETURN', component: 'DEPOSIT', amount: 200000, reason: 'full deposit back' } })).data?.code, 'DISCREPANCY_OPEN', 'deposit');
  eq(statusOf(b1), 'INSPECTION', 'status');
});
await check('the inspector cannot review their own discrepancy (403 SELF_REVIEW); a reviewer decides each one — no automatic penalty', async () => {
  const dmg = disc.find((d) => d.kind === 'DAMAGED'), miss = disc.find((d) => d.kind === 'MISSING');
  eq((await call('PATCH', `/rental-checklist/discrepancies/${dmg.id}/resolve`, { token: tok.cashier2, body: { resolution: 'RESOLVED_DEDUCTED', note: 'repair' } })).status, 403, 'cashier2 lacks the permission');
  const checkerRecorded = sql(`SELECT count(*) FROM "RentalChecklistRecord" WHERE "rentalOrderId" = '${b1}' AND stage = 'RETURN' AND "recordedById" = '${ids.admins.checker.id}'`);
  eq(checkerRecorded, '0', 'checker did not inspect');
  eq((await call('PATCH', `/rental-checklist/discrepancies/${dmg.id}/resolve`, { token: tok.checker, body: { resolution: 'RESOLVED_DEDUCTED', note: 'Lace repair quote TZS 50,000' } })).status, 200, 'damage → deducted');
  eq((await call('PATCH', `/rental-checklist/discrepancies/${miss.id}/resolve`, { token: tok.checker, body: { resolution: 'RESOLVED_WAIVED', note: 'hanger is shop stock' } })).status, 200, 'hanger waived');
  eq(sql(`SELECT count(*) FROM "Payment" WHERE "rentalOrderId" = '${b1}' AND status = 'REFUNDED'`), '0', 'no money moved by a decision');
});
await check('now: deposit settled with 50,000 kept (backed by the deducted discrepancy); rental closes', async () => {
  const d = await call('POST', `/rental-money/rentals/${b1}/refund-requests`, { token: tok.cashier, body: { kind: 'DEPOSIT_RETURN', component: 'DEPOSIT', amount: 150000, retainedAmount: 50000, reason: 'Lace repair' } });
  eq([d.status, d.data?.status], [201, 'REQUESTED'], 'deposit request');
  const c = await call('PATCH', `/rentals/${b1}/status`, { token: tok.super, body: { status: 'CLOSED' } });
  eq([c.status, statusOf(b1)], [200, 'CLOSED'], 'closed');
});
await check('(25C B) the veil omitted under the approved exception: the original requirement stays on record, nothing is expected back, the inspection is complete WITHOUT it and opens no discrepancy', async () => {
  await call('POST', `/pos-rentals/${b2}/return`, { token: tok.cashier, body: { condition: 'GOOD' } });
  const st = await state(b2, tok.cashier2);
  const veil = st.items.find((i) => i.label === 'Veil');
  eq([veil.quantity, veil.isMandatory, veil.issuedQuantity, veil.expectedReturn, veil.exception?.kind, veil.handover], [1, true, 0, 0, 'MISSING', null], 'veil');
  eq(st.inspection.notInspected.includes('Veil'), false, 'not owed');
  // Return exactly what went out (everything except the veil).
  const r = await record(b2, 'RETURN', st.items.filter((i) => i.label !== 'Veil').map((i) => ({ snapshotItemId: i.id, quantity: i.expectedReturn, ...(i.requiresCondition ? { condition: 'GOOD' } : {}) })), tok.cashier2);
  eq([r.status, r.data.inspection.complete, r.data.discrepancies.length], [201, true, 0], 'complete, nothing open');
  eq(sql(`SELECT count(*) FROM "RentalChecklistSnapshotItem" i JOIN "RentalChecklistSnapshot" s ON s.id = i."snapshotId" WHERE s."rentalOrderId" = '${b2}' AND i.label = 'Veil' AND i."isMandatory"`), '1', 'requirement still recorded');
});
await check('keeping deposit money without a "deducted" discrepancy is refused (409 RETENTION_WITHOUT_DISCREPANCY)', async () => {
  const r = await call('POST', `/rental-money/rentals/${b2}/refund-requests`, { token: tok.cashier, body: { kind: 'DEPOSIT_RETURN', component: 'DEPOSIT', amount: 150000, retainedAmount: 50000, reason: 'keep some' } });
  eq([r.status, r.data?.code], [409, 'RETENTION_WITHOUT_DISCREPANCY'], 'refused');
});

// ---------------------------------------------------------------------------
console.log('\n6. the same rules on every route (Admin status route, legacy v1 routes, direct database writes)');
await check('Admin status route: ACTIVE and ITEM_DISPATCHED on an incomplete checklist → 422 CHECKLIST_INCOMPLETE (even SUPER_ADMIN)', async () => {
  for (const s of ['ACTIVE', 'ITEM_DISPATCHED']) {
    const r = await call('PATCH', `/rentals/${b3}/status`, { token: tok.super, body: { status: s } });
    eq([s, r.status, r.data?.code], [s, 422, 'CHECKLIST_INCOMPLETE'], s);
  }
  eq(statusOf(b3), 'FULLY_PAID', 'unchanged');
});
await check('legacy v1 checklist routes are retired (410): assign / check / uncheck', async () => {
  const a = await call('POST', '/rental-checklists/assign', { token: tok.super, body: { rentalOrderId: b3, templateId: gownTpl.id } });
  const c = await call('PATCH', '/rental-checklists/entries/x/check', { token: tok.super, body: {} });
  const u = await call('PATCH', '/rental-checklists/entries/x/uncheck', { token: tok.super, body: {} });
  eq([a.status, c.status, u.status, a.data?.code], [410, 410, 410, 'CHECKLIST_V1_RETIRED'], 'gone');
});
await check('a direct database write cannot hand over, close or settle a deposit (trigger R3_CHECKLIST_GATE), not even with another booking\'s declaration', async () => {
  const e1 = sqlError(`UPDATE "RentalOrder" SET status = 'ACTIVE' WHERE id = '${b3}'`);
  const e2 = sqlError(`SELECT set_config('naro.r3_handover', '${b1}', true); UPDATE "RentalOrder" SET status = 'ACTIVE' WHERE id = '${b3}'`);
  const e3 = sqlError(`UPDATE "RentalOrder" SET status = 'CLOSED' WHERE id = '${b2}'`);
  const e4 = sqlError(`INSERT INTO "RentalRefundRequest" (id, "tenantId", "rentalOrderId", subject, kind, component, amount, "retainedAmount", reason, status, "requestedById", "createdAt", "updatedAt") VALUES ('it-bypass', '${T}', '${b2}', 'RENTAL', 'DEPOSIT_RETURN', 'DEPOSIT', 200000, 0, 'bypass', 'REQUESTED', '${ids.admins.cashier.id}', now(), now())`);
  assert([e1, e2, e3, e4].every((e) => /R3_CHECKLIST_GATE/.test(e || '')), JSON.stringify([e1, e2, e3, e4].map((e) => (e || 'ALLOWED').split('\n')[0])));
  eq([statusOf(b3), statusOf(b2)], ['FULLY_PAID', 'RETURNED'], 'unchanged');
});

// ---------------------------------------------------------------------------
console.log('\n7. bouquets / other products, legacy bookings, backfill, safety switch');
await check('a bouquet gets its checklist from its CATEGORY template and follows the same gate', async () => {
  const bq = await readyBooking(B.id, B.variantId, 25, { fee: 100000, deposit: 50000 });
  const st = await state(bq);
  eq([st.snapshot?.source, st.items.map((i) => [i.label, i.quantity])], ['CATEGORY', [['Bouquet', 1], ['Satin ribbons', 2]]], 'snapshot');
  eq((await handover(bq)).data?.missing, ['CHECKLIST:Bouquet', 'CHECKLIST:Satin ribbons'], 'blocked');
  await record(bq, 'HANDOVER', allHandover(st));
  eq((await handover(bq)).status, 201, 'handed over');
});
let legacy;
await check('a booking confirmed WITHOUT a checklist (legacy) is blocked; backfill dry-run lists it and writes nothing', async () => {
  // A booking confirmed BEFORE R3 (no snapshot): booked + ID approved through the API, then paid and
  // confirmed directly in the database, as pre-R3 data would be (checklist evidence can't be deleted any more).
  const c = (await call('POST', '/pos-rentals/customers', { token: tok.cashier, body: { firstName: 'R3', lastName: 'Legacy', phone: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } })).data;
  await call('POST', `/pos-rentals/customers/${c.id}/address`, { token: tok.cashier, body: { street: 'Mwenge 12', city: 'Dar es Salaam', region: 'Dar es Salaam' } });
  legacy = (await call('POST', '/pos-rentals', { token: tok.cashier, body: { customerId: c.id, productId: G.id, variantId: G.M, startDate: day(80), returnDate: day(82), pickupDate: day(80), termsAccepted: true } })).data.id;
  await call('POST', `/pos-rentals/${legacy}/id-in-person`, { token: tok.reviewer, body: { idType: 'NATIONAL_ID', idNumber: '19890101-99999' } });
  sql(`INSERT INTO "Payment" (id, "tenantId", "rentalOrderId", amount, method, status, component, "createdAt", "updatedAt") VALUES
    ('legacy-fee-${legacy}', '${T}', '${legacy}', 400000, 'CASH', 'COMPLETED', 'RENTAL_FEE', now(), now()),
    ('legacy-dep-${legacy}', '${T}', '${legacy}', 200000, 'CASH', 'COMPLETED', 'DEPOSIT', now(), now());
    UPDATE "RentalOrder" SET status = 'FULLY_PAID' WHERE id = '${legacy}'`);
  eq(sql(`SELECT count(*) FROM "RentalChecklistSnapshot" WHERE "rentalOrderId" = '${legacy}'`), '0', 'no snapshot (pre-R3)');
  eq((await handover(legacy)).data?.missing, ['CHECKLIST_SNAPSHOT'], 'blocked');
  eq((await call('POST', '/rental-checklist/backfill', { token: tok.cashier })).status, 403, 'cashier');
  const dry = await call('POST', '/rental-checklist/backfill', { token: tok.checker });
  eq([dry.status, dry.data?.dryRun, dry.data?.bookings?.some((x) => x.id === legacy)], [201, true, true], 'dry run');
  eq(sql(`SELECT count(*) FROM "RentalChecklistSnapshot" WHERE "rentalOrderId" = '${legacy}'`), '0', 'nothing written');
});
await check('backfill (explicit dryRun=false) freezes it as LEGACY_DESK from today\'s template (v2), audited; a desk snapshot twice → 409', async () => {
  const run = await call('POST', '/rental-checklist/backfill?dryRun=false', { token: tok.checker });
  eq([run.status, run.data?.frozen >= 1], [201, true], 'run');
  const st = await state(legacy);
  eq([st.snapshot?.source, st.snapshot?.templateVersion, st.items.map((i) => i.label)], ['LEGACY_DESK', 2, ['Gown (renamed)', 'Veil', 'Tiara', 'Padded hangers', 'Stains / odour check']], 'frozen');
  eq((await call('POST', `/rental-checklist/rentals/${legacy}/snapshot`, { token: tok.cashier })).data?.code, 'SNAPSHOT_EXISTS', 'twice');
  eq(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action = 'CHECKLIST_BACKFILL'`), '1', 'audited');
});
await check('the R1 safety switch was turned ON at boot and can no longer be turned off (422 SAFEGUARD_LOCKED_ON); hand-overs allowed in this build', async () => {
  const g = await call('GET', '/rental-handover-safeguard', { token: tok.super });
  eq([g.data?.checklistRequired, g.data?.buildHasChecklist, g.data?.handoversAllowed], [true, true, true], 'status');
  const off = await call('PUT', '/rental-handover-safeguard', { token: tok.super, body: { checklistRequired: false, reason: 'try to switch it off' } });
  eq([off.status, off.data?.code], [422, 'SAFEGUARD_LOCKED_ON'], 'locked');
});
await check('every checklist decision is audited', async () => {
  const rows = sql(`SELECT string_agg(DISTINCT action, ',' ORDER BY action) FROM "AdminActivityLog" WHERE action LIKE 'CHECKLIST_%' OR action LIKE 'DISCREPANCY_%' OR action = 'RELEASE_BLOCKED' OR action = 'CLOSE_BLOCKED'`);
  for (const a of ['CHECKLIST_RECORDED', 'CHECKLIST_EXCEPTION_REQUESTED', 'CHECKLIST_EXCEPTION_APPROVED', 'CHECKLIST_TEMPLATE_CREATED', 'CHECKLIST_TEMPLATE_UPDATED', 'DISCREPANCY_OPENED', 'DISCREPANCY_RESOLVED', 'RELEASE_BLOCKED', 'CLOSE_BLOCKED', 'CHECKLIST_BACKFILL']) {
    assert(rows.split(',').includes(a), `missing ${a} in ${rows}`);
  }
});

const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
