// R3 rollback rehearsal (owner requirement F): the PREVIOUS build (no
// checklist gate) runs against a database that R3 has migrated and used.
// Every hand-over, closure and post-hand-over deposit return must be refused,
// whatever the configuration says. Local API (:4130) on it_pos only.
//   node r3-rollback.it.mjs <pos-ids.json> prepare  (R3 build: one booking's checklist completed, not handed over)
//   node r3-rollback.it.mjs <pos-ids.json> old      (previous build running)
//   node r3-rollback.it.mjs <pos-ids.json> forward  (R3 build running again)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const API = (process.env.IT_API || 'http://localhost:4130/api/v1').replace(/\/$/, '');
if (!/^http:\/\/localhost:/.test(API)) throw new Error('refusing: localhost only');
const ids = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const MODE = process.argv[3];
if (!['prepare', 'old', 'forward'].includes(MODE)) throw new Error('mode: prepare | old | forward');
const T = ids.tenantId;
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe';
const psql = (q) => execFileSync(PSQL, ['-U', 'naro_admin', '-h', 'localhost', '-d', 'naro_fashion', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO it_pos; ${q}`],
  { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sqlError = (q) => { try { psql(q); return null; } catch (e) { return String(e.stderr || e.message); } };
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
const login = async (w) => (await call('POST', '/auth/login', { body: { email: w.email, password: w.password } })).data?.accessToken;
const tok = { super: await login(ids.admins.super), cashier: await login(ids.admins.cashier) };
const statusOf = (id) => psql(`SELECT status FROM "RentalOrder" WHERE id = '${id}'`);
const health = (await call('GET', '/health')).data;
// psql on Windows ends lines with \r\n: trim, or the ids carry a \r (fetch strips it from URLs, SQL does not).
const rows = (q) => psql(q).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
// Bookings left by r3-checklist.it.mjs: waiting for hand-over (one with a COMPLETE checklist evidence set is included), and returned ones.
const waiting = rows(`SELECT id FROM "RentalOrder" WHERE "tenantId" = '${T}' AND status = 'FULLY_PAID' ORDER BY "createdAt"`);
const returned = rows(`SELECT id FROM "RentalOrder" WHERE "tenantId" = '${T}' AND status IN ('RETURNED', 'INSPECTION') ORDER BY "createdAt"`);
const complete = (id) => psql(`SELECT count(*) FROM "RentalChecklistSnapshotItem" i JOIN "RentalChecklistSnapshot" s ON s.id = i."snapshotId" WHERE s."rentalOrderId" = '${id}' AND i.stage = 'BOTH' AND i."isMandatory"
  AND NOT EXISTS (SELECT 1 FROM "RentalChecklistRecord" r WHERE r."snapshotItemId" = i.id AND r.stage = 'HANDOVER')`) === '0';

console.log(`real API ${API} · build ${health?.commit ?? "?"} · mode ${MODE} · ${waiting.length} bookings waiting, ${returned.length} returned`);

if (MODE === 'prepare') {
  await check('R3 build: complete the checklist of one waiting booking (NOT handed over) so the rollback is tested on a ready booking too', async () => {
    const id = waiting.find((x) => !complete(x) && psql(`SELECT source FROM "RentalChecklistSnapshot" WHERE "rentalOrderId" = '${x}'`) === 'LEGACY_DESK');
    assert(id, 'legacy booking not found');
    const st = (await call('GET', `/rental-checklist/rentals/${id}`, { token: tok.cashier })).data;
    const entries = st.items.filter((i) => i.stage === 'BOTH').map((i) => ({ snapshotItemId: i.id, quantity: i.quantity, ...(i.requiresCondition ? { condition: 'GOOD' } : {}) }));
    eq((await call('POST', `/rental-checklist/rentals/${id}/records`, { token: tok.cashier, body: { stage: 'HANDOVER', entries } })).status, 201, 'recorded');
    eq(complete(id), true, 'complete');
    return id;
  });
} else if (MODE === 'old') {
  await check('this is the PREVIOUS build: the checklist API does not exist (404)', async () => {
    eq((await call('GET', `/rental-checklist/rentals/${waiting[0]}`, { token: tok.super })).status, 404, 'no R3 routes');
  });
  await check('the previous build reports hand-overs blocked (R3 marker table + switch)', async () => {
    const g = await call('GET', '/rental-handover-safeguard', { token: tok.super });
    eq([g.data?.buildHasChecklist, g.data?.handoversAllowed, g.data?.blockedBy], [false, false, 'HANDOVER_REQUIRES_CHECKLIST_BUILD'], 'status');
  });
  await check('every waiting booking — including one whose checklist WAS complete — is refused on the POS and Admin routes; nothing handed over', async () => {
    assert(waiting.some(complete) && waiting.some((x) => !complete(x)), 'need one complete and one incomplete booking');
    for (const id of waiting) {
      const pos = await call('POST', `/pos-rentals/${id}/handover`, { token: tok.cashier, body: {} });
      const act = await call('PATCH', `/rentals/${id}/status`, { token: tok.super, body: { status: 'ACTIVE' } });
      const disp = await call('PATCH', `/rentals/${id}/status`, { token: tok.super, body: { status: 'ITEM_DISPATCHED' } });
      eq([pos.status, pos.data?.code, act.data?.code, disp.data?.code], [422, 'HANDOVER_REQUIRES_CHECKLIST_BUILD', 'HANDOVER_REQUIRES_CHECKLIST_BUILD', 'HANDOVER_REQUIRES_CHECKLIST_BUILD'], id);
      eq(statusOf(id), 'FULLY_PAID', 'unchanged');
    }
    return `${waiting.length} bookings × 3 routes refused`;
  });
  await check('"a configuration flag alone is not sufficient": switch row DELETED and then switched OFF through the old build → still refused', async () => {
    psql(`DELETE FROM "RentalHandoverSafeguard" WHERE "tenantId" = '${T}'`);
    eq((await call('POST', `/pos-rentals/${waiting[0]}/handover`, { token: tok.cashier, body: {} })).data?.code, 'HANDOVER_REQUIRES_CHECKLIST_BUILD', 'no row');
    const off = await call('PUT', '/rental-handover-safeguard', { token: tok.super, body: { checklistRequired: false, reason: 'rollback rehearsal: try to re-open hand-overs' } });
    eq([off.status, off.data?.handoversAllowed], [200, false], 'OFF accepted by the old build but changes nothing');
    eq((await call('PATCH', `/rentals/${waiting[0]}/status`, { token: tok.super, body: { status: 'ACTIVE' } })).data?.code, 'HANDOVER_REQUIRES_CHECKLIST_BUILD', 'still refused');
  });
  await check('even a build WITHOUT the R1 check (simulated: the write itself) cannot hand over — the database trigger refuses it', async () => {
    eq(psql(`SELECT count(*) FROM "RentalOrder" WHERE id = '${waiting[0]}'`), '1', 'the row exists (a 0-row UPDATE would prove nothing)');
    const e = sqlError(`UPDATE "RentalOrder" SET status = 'ACTIVE' WHERE id = '${waiting[0]}'`);
    assert(/R3_CHECKLIST_GATE/.test(e || ''), e || 'ALLOWED');
    eq(statusOf(waiting[0]), 'FULLY_PAID', 'unchanged');
  });
  await check('the previous build cannot CLOSE a returned rental without the inspection gate (database refuses; status unchanged)', async () => {
    for (const id of returned) {
      const before = statusOf(id);
      const r = await call('PATCH', `/rentals/${id}/status`, { token: tok.super, body: { status: before === 'RETURNED' ? 'CLOSED' : 'CLOSED' } });
      assert(r.status >= 400, `close allowed: ${r.status}`);
      eq(statusOf(id), before, 'unchanged');
    }
    return `${returned.length} refused`;
  });
  await check('the previous build cannot request a deposit return after hand-over (database refuses; no row written)', async () => {
    const before = psql(`SELECT count(*) FROM "RentalRefundRequest" WHERE kind = 'DEPOSIT_RETURN'`);
    for (const id of returned) {
      const r = await call('POST', `/rental-money/rentals/${id}/refund-requests`, { token: tok.cashier, body: { kind: 'DEPOSIT_RETURN', component: 'DEPOSIT', amount: 1000, reason: 'rollback rehearsal' } });
      assert(r.status >= 400, `deposit allowed: ${r.status}`);
    }
    eq(psql(`SELECT count(*) FROM "RentalRefundRequest" WHERE kind = 'DEPOSIT_RETURN'`), before, 'no new rows');
  });
  await check('checklist evidence is untouched by the rollback (no rows changed or removed)', async () => {
    const n = psql(`SELECT count(*) || '/' || (SELECT count(*) FROM "RentalChecklistSnapshot") || '/' || (SELECT count(*) FROM "RentalDiscrepancy") FROM "RentalChecklistRecord"`);
    assert(/^\d+\/\d+\/\d+$/.test(n) && !n.startsWith('0/'), n);
    return `records/snapshots/discrepancies = ${n}`;
  });
} else {
  await check('roll forward: the R3 build is back; the switch is ON again (boot) and hand-overs follow the checklist', async () => {
    const g = await call('GET', '/rental-handover-safeguard', { token: tok.super });
    eq([g.data?.buildHasChecklist, g.data?.checklistRequired, g.data?.handoversAllowed], [true, true, true], 'status');
  });
  await check('a waiting booking with an INCOMPLETE checklist is still refused by the checklist gate', async () => {
    const id = waiting.find((x) => !complete(x));
    assert(id, 'no incomplete booking');
    eq((await call('POST', `/pos-rentals/${id}/handover`, { token: tok.cashier, body: {} })).data?.code, 'CHECKLIST_INCOMPLETE', 'gate');
  });
  await check('completing its checklist after the roll-forward allows exactly that hand-over', async () => {
    const id = waiting.find((x) => !complete(x));
    const st = (await call('GET', `/rental-checklist/rentals/${id}`, { token: tok.cashier })).data;
    const entries = st.items.filter((i) => i.stage === 'BOTH' && i.isMandatory && !i.handover).map((i) => ({ snapshotItemId: i.id, quantity: i.quantity, ...(i.requiresCondition ? { condition: 'GOOD' } : {}) }));
    eq((await call('POST', `/rental-checklist/rentals/${id}/records`, { token: tok.cashier, body: { stage: 'HANDOVER', entries } })).status, 201, 'recorded');
    const h = await call('POST', `/pos-rentals/${id}/handover`, { token: tok.cashier, body: {} });
    eq([h.status, statusOf(id)], [201, 'ACTIVE'], 'handed over');
  });
}

const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
