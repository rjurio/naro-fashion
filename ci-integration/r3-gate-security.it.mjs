// R3 database-gate security (round 25C, C): can a caller with database access
// satisfy the gate without the checklist? Real API (:4130) + real Postgres,
// isolated schema it_pos seeded by pos-rental-seed.js (R3 build). Never production.
//   node r3-gate-security.it.mjs <pos-ids.json>
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const API = 'http://localhost:4130/api/v1';
const ids = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const T = ids.tenantId;
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe';
const PSQL_ARGS = ['-U', 'naro_admin', '-h', 'localhost', '-d', 'naro_fashion', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'];
const ENV = { ...process.env, PGPASSWORD: 'Admin123' };
const P = (...cmds) => execFileSync(PSQL, [...PSQL_ARGS, '-c', 'SET search_path TO it_pos', ...cmds.flatMap((c) => ['-c', c])], { env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sql = (q) => P(q);
const sqlError = (...cmds) => { try { P(...cmds); return null; } catch (e) { return String(e.stderr || e.message); } };
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
const refused = (e, what) => assert(/R3_CHECKLIST_GATE|R3_EVIDENCE_IMMUTABLE|R3_EVIDENCE_INVALID|R3_OVERRIDE_INVALID|R3_OVERRIDE_NOT_AUTHORISED|R3_LEDGER_GUARD|permission denied/.test(e || ''), `${what}: ${e ? e.split('\n')[0] : 'ALLOWED'}`);
const login = async (w) => { const r = await call('POST', '/auth/login', { body: { email: w.email, password: w.password } }); assert(r.data?.accessToken, `login ${w.email}`); return r.data.accessToken; };
const tok = {};
for (const k of ['super', 'cashier', 'reviewer', 'checker']) tok[k] = await login(ids.admins[k]);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const statusOf = (id) => sql(`SELECT status FROM "RentalOrder" WHERE id = '${id}'`);
const G = ids.gown;

await call('POST', '/rental-checklists/templates', { token: tok.checker, body: { name: 'Gown set', productId: G.id, items: [{ label: 'Gown', itemType: 'DISPATCH' }, { label: 'Veil', itemType: 'DISPATCH' }] } });
let seq = 0;
async function ready(start) {
  const c = (await call('POST', '/pos-rentals/customers', { token: tok.cashier, body: { firstName: 'Sec', lastName: `C${++seq}`, phone: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } })).data;
  await call('POST', `/pos-rentals/customers/${c.id}/address`, { token: tok.cashier, body: { street: 'Mwenge 12', city: 'Dar es Salaam', region: 'Dar es Salaam' } });
  const b = await call('POST', '/pos-rentals', { token: tok.cashier, body: { customerId: c.id, productId: G.id, variantId: G.M, startDate: day(start), returnDate: day(start + 2), pickupDate: day(start), termsAccepted: true } });
  assert(b.status === 201, `book ${b.status}`);
  await call('POST', `/pos-rentals/${b.data.id}/id-in-person`, { token: tok.reviewer, body: { idType: 'NATIONAL_ID', idNumber: `1992${String(seq).padStart(4, '0')}-12345` } });
  for (const [component, amount] of [['RENTAL_FEE', 400000], ['DEPOSIT', 200000]]) {
    await call('POST', `/pos-rentals/${b.data.id}/payments`, { token: tok.cashier, body: { component, sessionId: ids.sessions.cashier, tenders: [{ method: 'CASH', amount }] } });
  }
  assert(statusOf(b.data.id) === 'FULLY_PAID', 'confirmed');
  return b.data.id;
}
async function completeChecklist(id) {
  const st = (await call('GET', `/rental-checklist/rentals/${id}`, { token: tok.cashier })).data;
  const entries = st.items.filter((i) => i.stage === 'BOTH').map((i) => ({ snapshotItemId: i.id, quantity: i.quantity, condition: 'GOOD' }));
  eq((await call('POST', `/rental-checklist/rentals/${id}/records`, { token: tok.cashier, body: { stage: 'HANDOVER', entries } })).status, 201, 'recorded');
}
const declare = (step, id, actor = '') => `SELECT set_config('naro.r3_${step}', '${id}:' || txid_current()::text || ':${actor}', true)`;

// Start after the latest booking already in the schema, so the suite can be re-run.
const BASE = 30 + Number(sql(`SELECT COALESCE(max("returnDate")::date - current_date, 0) FROM "RentalOrder" WHERE "tenantId" = '${T}'`));
const incomplete = await ready(BASE);
const complete = await ready(BASE + 10);
await completeChecklist(complete);
const residual = await ready(BASE + 20);
await completeChecklist(residual);
console.log(`real API ${API} · isolated schema it_pos · R3 database gate security`);

console.log('\n1. the declaration alone authorises nothing');
await check('no declaration (manual SQL, legacy / rolled-back code) → refused', async () => {
  refused(sqlError(`UPDATE "RentalOrder" SET status = 'ACTIVE' WHERE id = '${complete}'`), 'plain update');
  eq(statusOf(complete), 'FULLY_PAID', 'unchanged');
});
await check('the OLD flag format (rental id only, as in the first R3 migration) → refused', async () => {
  refused(sqlError(`SELECT set_config('naro.r3_handover', '${complete}', true); UPDATE "RentalOrder" SET status = 'ACTIVE' WHERE id = '${complete}'`), 'old flag');
});
await check('a valid declaration for ANOTHER booking → refused', async () => {
  refused(sqlError(`${declare('handover', complete)}; UPDATE "RentalOrder" SET status = 'ACTIVE' WHERE id = '${incomplete}'`), 'other booking');
});
await check('an unauthorised session variable that looks perfect (this booking, this transaction) on an INCOMPLETE checklist → refused by the database\'s own fact check', async () => {
  const e = sqlError(`${declare('handover', incomplete, ids.admins.cashier.id)}; UPDATE "RentalOrder" SET status = 'ACTIVE' WHERE id = '${incomplete}'`);
  refused(e, 'forged flag'); assert(/unchecked: Gown, Veil/.test(e), e.split('\n')[0]);
  eq(statusOf(incomplete), 'FULLY_PAID', 'unchanged');
});

console.log('\n2. replay, connection-pool reuse, concurrent transactions');
await check('replay: a declaration set session-wide in one transaction is refused in the next (txid bound) — even on a COMPLETE checklist', async () => {
  // Two -c commands = two transactions on the SAME connection (as a pooled connection would be reused).
  const e = sqlError(`SELECT set_config('naro.r3_handover', '${complete}:' || txid_current()::text || ':', false)`, `UPDATE "RentalOrder" SET status = 'ACTIVE' WHERE id = '${complete}'`);
  refused(e, 'replayed'); assert(/not declared/.test(e), e.split('\n')[0]);
  eq(statusOf(complete), 'FULLY_PAID', 'unchanged');
});
await check('pool reuse: a transaction-local declaration is gone after COMMIT on the same connection', async () => {
  const e = sqlError('BEGIN', declare('handover', complete), 'COMMIT', `UPDATE "RentalOrder" SET status = 'ACTIVE' WHERE id = '${complete}'`);
  refused(e, 'after commit');
});
await check('concurrent transactions: a declaration held open by connection A does not help connection B', async () => {
  const a = spawn(PSQL, [...PSQL_ARGS, '-c', 'SET search_path TO it_pos', '-c', 'BEGIN', '-c', declare('handover', complete), '-c', 'SELECT pg_sleep(4)', '-c', 'ROLLBACK'], { env: ENV });
  const done = new Promise((r) => a.on('exit', r));
  await new Promise((r) => setTimeout(r, 1500));
  refused(sqlError(`UPDATE "RentalOrder" SET status = 'ACTIVE' WHERE id = '${complete}'`), 'connection B');
  await done;
  eq(statusOf(complete), 'FULLY_PAID', 'unchanged');
});

console.log('\n3. evidence cannot be altered to satisfy the gate');
await check('checklist records, snapshots and snapshot items: UPDATE / DELETE / TRUNCATE refused', async () => {
  const rec = sql(`SELECT id FROM "RentalChecklistRecord" WHERE "rentalOrderId" = '${complete}' LIMIT 1`);
  refused(sqlError(`UPDATE "RentalChecklistRecord" SET quantity = 9 WHERE id = '${rec}'`), 'update record');
  refused(sqlError(`DELETE FROM "RentalChecklistRecord" WHERE id = '${rec}'`), 'delete record');
  refused(sqlError(`UPDATE "RentalChecklistSnapshotItem" SET "isMandatory" = false WHERE "snapshotId" IN (SELECT id FROM "RentalChecklistSnapshot" WHERE "rentalOrderId" = '${incomplete}')`), 'weaken snapshot');
  refused(sqlError(`DELETE FROM "RentalChecklistSnapshot" WHERE "rentalOrderId" = '${incomplete}'`), 'delete snapshot');
  refused(sqlError('TRUNCATE "RentalChecklistRecord" CASCADE'), 'truncate');
});
await check('exceptions only move forward; an exception can\'t be re-pointed at other items or un-used', async () => {
  const st = (await call('GET', `/rental-checklist/rentals/${incomplete}`, { token: tok.cashier })).data;
  const ex = (await call('POST', `/rental-checklist/rentals/${incomplete}/exceptions`, { token: tok.cashier, body: { kind: 'MISSING', snapshotItemIds: [st.items[1].id], reason: 'veil at the cleaners until tomorrow' } })).data;
  refused(sqlError(`UPDATE "RentalChecklistException" SET status = 'APPROVED', "decidedById" = 'x' , "snapshotItemIds" = ARRAY['${st.items[0].id}','${st.items[1].id}'] WHERE id = '${ex.id}'`), 're-point');
  refused(sqlError(`UPDATE "RentalChecklistException" SET status = 'USED' WHERE id = '${ex.id}'`), 'skip approval');
  refused(sqlError(`DELETE FROM "RentalChecklistException" WHERE id = '${ex.id}'`), 'delete');
});

console.log('\n4. owner-authorised recovery (single use, expiring, recorded)');
const override = (id, step, reason = 'Owner-authorised recovery rehearsal, ticket OPS-1', mins = 15) =>
  `INSERT INTO "RentalGateOverride" (id, "tenantId", "rentalOrderId", step, reason, "authorizedBy", "expiresAt") VALUES ('ov-${randomBytes(4).toString('hex')}', '${T}', '${id}', '${step}', '${reason}', 'Owner (rehearsal)', (now() AT TIME ZONE 'UTC') + interval '${mins} minutes')`;
await check('invalid overrides are refused: short reason, expiry over 60 min, unknown step', async () => {
  refused(sqlError(override(incomplete, 'handover', 'too short')), 'short reason');
  refused(sqlError(override(incomplete, 'handover', 'Owner-authorised recovery rehearsal', 120)), 'long expiry');
  refused(sqlError(override(incomplete, 'everything')), 'step');
});
await check('a valid override lets EXACTLY ONE gated write through (incomplete booking), is stamped and can\'t be reused, edited or deleted', async () => {
  P(override(incomplete, 'handover'));
  P(`UPDATE "RentalOrder" SET status = 'ACTIVE' WHERE id = '${incomplete}'`);
  eq(statusOf(incomplete), 'ACTIVE', 'one write allowed');
  const row = sql(`SELECT id || '|' || ("usedAt" IS NOT NULL) || '|' || ("usedTxid" IS NOT NULL) || '|' || "dbUser" FROM "RentalGateOverride" WHERE "rentalOrderId" = '${incomplete}'`);
  const [ovId, used, txid, dbUser] = row.split('|');
  eq([used, txid, dbUser], ['true', 'true', 'naro_admin'], 'stamped');
  refused(sqlError(`UPDATE "RentalGateOverride" SET "usedAt" = NULL, "usedTxid" = NULL WHERE id = '${ovId}'`), 'reset');
  refused(sqlError(`UPDATE "RentalGateOverride" SET reason = 'changed afterwards to hide it' WHERE id = '${ovId}'`), 'edit');
  refused(sqlError(`DELETE FROM "RentalGateOverride" WHERE id = '${ovId}'`), 'delete');
  refused(sqlError(`UPDATE "RentalOrder" SET status = 'CLOSED' WHERE id = '${incomplete}'`), 'a handover override does not cover closing');
});
await check('a consumed override does nothing (an expiry can only be set within 60 minutes on insert); the override is visible in the app (reviewer yes, cashier 403)', async () => {
  const id = await ready(BASE + 30);
  P(`${override(id, 'handover')}`);
  P(`UPDATE "RentalGateOverride" SET "usedAt" = (now() AT TIME ZONE 'UTC'), "usedTxid" = 'manual' WHERE "rentalOrderId" = '${id}'`); // consumed outside a gate (allowed once): now unusable
  refused(sqlError(`UPDATE "RentalOrder" SET status = 'ACTIVE' WHERE id = '${id}'`), 'consumed');
  const list = await call('GET', '/rental-checklist/gate-overrides', { token: tok.super });
  eq([list.status, list.data.length >= 2], [200, true], 'listed');
  eq((await call('GET', '/rental-checklist/gate-overrides', { token: tok.cashier })).status, 403, 'cashier');
});

console.log('\n5. the application path still works and is fully checked');
await check('API hand-over of the complete booking succeeds (declaration + database fact check agree)', async () => {
  eq((await call('POST', `/pos-rentals/${complete}/handover`, { token: tok.cashier, body: {} })).status, 201, 'handed over');
});

console.log('\n6. the declared actor is verified; what remains with the owner role');
// The trusted-controls migration (20261117090000, local round 25D) verifies the
// declared actor; PR #32 as pushed (a47660b) does not — that build keeps the
// round 25C residual. The suite checks whichever this database has.
const TRUSTED = sql(`SELECT to_regprocedure('naro_r3_staff_problem(text,text,text)') IS NOT NULL`) === 't';
if (!TRUSTED) {
  await check('RESIDUAL (this build, before 20261117090000): a holder of the app DB credentials who forges a declaration on a COMPLETE checklist is allowed (the database checks the checklist, not payment / ID / permission)', async () => {
    P(`${declare('handover', residual, 'forged')}; UPDATE "RentalOrder" SET status = 'ACTIVE' WHERE id = '${residual}'`);
    eq(statusOf(residual), 'ACTIVE', 'allowed');
    return 'closed by 20261117090000_r3_trusted_controls (local)';
  });
} else {
await check('round 25D: a forged declaration naming an invented / unauthorised staff member on a COMPLETE, fully paid checklist → refused (the database verifies the actor)', async () => {
  // Before 20261117090000_r3_trusted_controls this was ALLOWED (the residual of round 25C).
  for (const actor of ['forged', '', ids.admins.reviewer.id]) {
    const e = sqlError(`${declare('handover', residual, actor)}; UPDATE "RentalOrder" SET status = 'ACTIVE' WHERE id = '${residual}'`);
    refused(e, `actor "${actor}"`);
    assert(/unknown|no staff member|lacks rentals:release/.test(e), e.split(String.fromCharCode(10))[0]);
  }
  eq(statusOf(residual), 'FULLY_PAID', 'unchanged');
});
await check('RESIDUAL (by design): a declaration naming a REAL staff member who holds rentals:release, on a booking whose checklist, ID, payment, address and gown are ALL satisfied, is allowed — it is the same hand-over the API would allow', async () => {
  P(`${declare('handover', residual, ids.admins.cashier.id)}; UPDATE "RentalOrder" SET status = 'ACTIVE' WHERE id = '${residual}'`);
  eq(statusOf(residual), 'ACTIVE', 'allowed');
  return 'the database cannot tell whether the request came through the API; db-roles.it.mjs covers the runtime role';
});
}
await check('RESIDUAL: the table owner (the app role today) can disable the trigger — shown inside a rolled-back transaction; session_replication_role is NOT available to it', async () => {
  P('BEGIN', 'ALTER TABLE "RentalOrder" DISABLE TRIGGER naro_r3_rental_gate', 'ROLLBACK');
  refused(sqlError('SET session_replication_role = replica'), 'replication role');
  eq(sql(`SELECT tgenabled FROM pg_trigger WHERE tgname = 'naro_r3_rental_gate' AND tgrelid = '"RentalOrder"'::regclass`), 'O', 'still enabled after rollback');
  return 'owner can ALTER/DROP triggers → app must not connect as owner';
});

const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
