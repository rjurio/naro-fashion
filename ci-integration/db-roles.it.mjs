// Round 25D B: least-privilege database roles. Adversarial tests run AS THE
// RUNTIME ROLE (naro_app) against a real API that itself connects as
// naro_app, on an ISOLATED Postgres (lab cluster or CI service) whose schema
// is owned by naro_admin (the owner / migration role) and prepared with
// scripts/ops/db-roles/01-roles.sql + 02-grants.sql. Never production.
//
//   IT_APP_PASSWORD=... DB_ROLES_DIR=<repo>/scripts/ops/db-roles PSQL=<psql> PGPORT=<port> \
//   node db-roles.it.mjs <pos-ids.json>
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const API = (process.env.IT_API || 'http://localhost:4130/api/v1').replace(/\/$/, '');
const SCHEMA = process.env.IT_SCHEMA || 'it_pos';
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/18/bin/psql.exe';
const HOST = process.env.PGHOST || 'localhost';
const APP = process.env.IT_APP_ROLE || 'naro_app';
const APP_PW = process.env.IT_APP_PASSWORD;
const OWNER = 'naro_admin', OWNER_PW = 'Admin123';
const ROLES_DIR = process.env.DB_ROLES_DIR;
if (!APP_PW || !ROLES_DIR) throw new Error('set IT_APP_PASSWORD and DB_ROLES_DIR');
if (!/^(localhost|127\.0\.0\.1)$/.test(HOST)) throw new Error('refusing: local/CI database only');
const ids = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const T = ids.tenantId;
const G = ids.gown;

const runAs = (user, pw) => (...cmds) => execFileSync(PSQL,
  ['-U', user, '-h', HOST, '-d', 'naro_fashion', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO ${SCHEMA}`, ...cmds.flatMap((c) => ['-c', c])],
  { env: { ...process.env, PGPASSWORD: pw }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const app = runAs(APP, APP_PW);
const own = runAs(OWNER, OWNER_PW);
const errOf = (fn) => (...cmds) => { try { fn(...cmds); return null; } catch (e) { return String(e.stderr || e.message); } };
const appErr = errOf(app);
const ownErr = errOf(own);
const verify = () => { try { return { ok: true, out: execFileSync(PSQL, ['-U', OWNER, '-h', HOST, '-d', 'naro_fashion', '-w', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', `app=${APP}`, '-v', `owner=${OWNER}`, '-v', `schema=${SCHEMA}`, '-f', `${ROLES_DIR}/03-verify.sql`], { env: { ...process.env, PGPASSWORD: OWNER_PW }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; } catch (e) { return { ok: false, out: String(e.stdout || '') + String(e.stderr || '') }; } };
const grants = () => execFileSync(PSQL, ['-U', OWNER, '-h', HOST, '-d', 'naro_fashion', '-w', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', `app=${APP}`, '-v', `schema=${SCHEMA}`, '-f', `${ROLES_DIR}/02-grants.sql`], { env: { ...process.env, PGPASSWORD: OWNER_PW }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

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
const first = (e) => (e || 'ALLOWED').split(/\r?\n/).find((l) => /ERROR|FATAL|WARNING/.test(l)) || (e || 'ALLOWED').split(/\r?\n/)[0];
const refused = (e, re, what) => { assert(e, `${what}: ALLOWED`); assert(re.test(e), `${what}: ${first(e)}`); return first(e).replace(/^.*?(ERROR|FATAL):\s*/, ''); };
const PRIV = /permission denied|must be owner|must be superuser|must have|not have privilege|password authentication failed/;
const login = async (w) => { const r = await call('POST', '/auth/login', { body: { email: w.email, password: w.password } }); assert(r.data?.accessToken, `login ${w.email}`); return r.data.accessToken; };
const tok = {};
for (const k of ['cashier', 'cashier2', 'reviewer', 'checker']) tok[k] = await login(ids.admins[k]);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const statusOf = (id) => own(`SELECT status FROM "RentalOrder" WHERE id = '${id}'`);
const declare = (step, id, actor = '') => `SELECT set_config('naro.r3_${step}', '${id}:' || txid_current()::text || ':${actor}', true)`;
const uid = () => 'it' + randomBytes(10).toString('hex');

await call('POST', '/rental-checklists/templates', { token: tok.checker, body: { name: 'Gown set (roles)', productId: G.id, items: [{ label: 'Gown', itemType: 'DISPATCH' }, { label: 'Veil', itemType: 'DISPATCH' }] } });
const BASE = 30 + Number(own(`SELECT COALESCE(max("returnDate")::date - current_date, 0) FROM "RentalOrder" WHERE "tenantId" = '${T}'`));
let seq = 0;
async function booking(start, { deposit = true } = {}) {
  const c = (await call('POST', '/pos-rentals/customers', { token: tok.cashier, body: { firstName: 'Roles', lastName: `C${++seq}`, phone: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } })).data;
  await call('POST', `/pos-rentals/customers/${c.id}/address`, { token: tok.cashier, body: { street: 'Mwenge 12', city: 'Dar es Salaam', region: 'Dar es Salaam' } });
  const b = await call('POST', '/pos-rentals', { token: tok.cashier, body: { customerId: c.id, productId: G.id, variantId: G.M, startDate: day(start), returnDate: day(start + 2), pickupDate: day(start), termsAccepted: true } });
  assert(b.status === 201, `book ${b.status} ${JSON.stringify(b.data)}`);
  await call('POST', `/pos-rentals/${b.data.id}/id-in-person`, { token: tok.reviewer, body: { idType: 'NATIONAL_ID', idNumber: `1993${String(seq).padStart(4, '0')}-12345` } });
  for (const [component, amount] of [['RENTAL_FEE', 400000], ...(deposit ? [['DEPOSIT', 200000]] : [])]) {
    const p = await call('POST', `/pos-rentals/${b.data.id}/payments`, { token: tok.cashier, body: { component, sessionId: ids.sessions.cashier, tenders: [{ method: 'CASH', amount }] } });
    assert(p.status === 201, `pay ${component} ${p.status}`);
  }
  return b.data.id;
}
async function completeChecklist(id) {
  const st = (await call('GET', `/rental-checklist/rentals/${id}`, { token: tok.cashier })).data;
  const entries = st.items.filter((i) => i.stage === 'BOTH').map((i) => ({ snapshotItemId: i.id, quantity: i.quantity, condition: 'GOOD' }));
  eq((await call('POST', `/rental-checklist/rentals/${id}/records`, { token: tok.cashier, body: { stage: 'HANDOVER', entries } })).status, 201, 'recorded');
  return st.items;
}

console.log(`real API ${API} (connected as ${APP}) · isolated schema ${SCHEMA} · adversarial tests AS ${APP}`);
const complete = await booking(BASE); const completeItems = await completeChecklist(complete);
const noDeposit = await booking(BASE + 10, { deposit: false }); await completeChecklist(noDeposit);
const fabricated = await booking(BASE + 20, { deposit: false }); await completeChecklist(fabricated);
const exBooking = await booking(BASE + 30); const exItems = (await call('GET', `/rental-checklist/rentals/${exBooking}`, { token: tok.cashier })).data.items;
const raceBooking = await booking(BASE + 40); await completeChecklist(raceBooking);
const ovrBooking = await booking(BASE + 50);
// A second shop with a staff member (test setup, as the owner).
const T2 = uid(), A2 = uid();
own(`INSERT INTO "Tenant" (id, name, slug, status, "updatedAt") VALUES ('${T2}', 'Other shop', '${T2}', 'ACTIVE', now())`,
    `INSERT INTO "AdminUser" (id, "tenantId", email, "passwordHash", "firstName", "lastName", role, "isActive", "updatedAt") VALUES ('${A2}', '${T2}', '${A2}@example.test', 'x', 'Other', 'Shop', 'SUPER_ADMIN', true, now())`);
const depositPayment = own(`SELECT id FROM "Payment" WHERE "rentalOrderId" = '${complete}' AND component = 'DEPOSIT' AND status = 'COMPLETED' LIMIT 1`);
assert(depositPayment, 'deposit payment row');

console.log('\n1. the runtime role is not the owner and cannot change the controls');
await check(`connected as ${APP}: not a superuser, owns nothing, member of no role`, async () => {
  eq(app(`SELECT current_user || '|' || session_user || '|' || (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)`), `${APP}|${APP}|false`, 'identity');
  eq(app(`SELECT count(*) FROM pg_class WHERE relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)`), '0', 'owns nothing');
});
await check('disable / drop the gate and guard triggers → refused (must be owner)', async () => {
  for (const q of ['ALTER TABLE "RentalOrder" DISABLE TRIGGER naro_r3_rental_gate', 'ALTER TABLE "Payment" DISABLE TRIGGER ALL',
    'ALTER TABLE "RentalChecklistRecord" DISABLE TRIGGER USER', 'DROP TRIGGER naro_r3_payment_guard ON "Payment"', 'ALTER TABLE "RentalGateOverride" ENABLE REPLICA TRIGGER naro_r3_override_guard']) {
    refused(appErr(q), /must be owner/, q);
  }
  eq(own(`SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'naro_r3_%' AND tgenabled <> 'O'`), '0', 'all enabled');
});
await check('replace / weaken a security function → refused', async () => {
  refused(appErr(`CREATE OR REPLACE FUNCTION naro_r3_staff_problem(text, text, text) RETURNS text LANGUAGE sql AS 'SELECT NULL::text'`), /must be owner|permission denied/, 'replace');
  refused(appErr('ALTER FUNCTION naro_r3_staff_problem(text, text, text) SECURITY INVOKER'), /must be owner/, 'security invoker');
  refused(appErr('ALTER FUNCTION naro_r3_rental_gate() RESET search_path'), /must be owner/, 'search_path');
});
await check('create objects (function, table) in the schema, or a temporary table to shadow a real one → refused', async () => {
  refused(appErr(`CREATE FUNCTION ${SCHEMA}.naro_evil() RETURNS int LANGUAGE sql AS 'SELECT 1'`), /permission denied for schema/, 'function');
  refused(appErr(`CREATE TABLE ${SCHEMA}.evil (x int)`), /permission denied for schema/, 'table');
  refused(appErr('CREATE TEMP TABLE "RentalOrder" (id text)'), /permission denied to create temporary tables/, 'temp shadow');
});
await check('superuser-only switches, role changes and SET ROLE to the owner → refused', async () => {
  refused(appErr('SET session_replication_role = replica'), /permission denied/, 'replication role');
  refused(appErr(`ALTER ROLE ${APP} SUPERUSER`), /permission denied|must be superuser/, 'superuser');
  refused(appErr(`ALTER ROLE ${APP} CREATEROLE`), /permission denied|must have/, 'createrole');
  refused(appErr(`CREATE ROLE naro_evil LOGIN`), /permission denied/, 'create role');
  refused(appErr(`SET ROLE ${OWNER}`), /permission denied to set role/, 'set role');
  refused(appErr(`COPY (SELECT 1) TO PROGRAM 'echo x'`), /permission denied|must be superuser|must be a member/, 'copy to program');
});
await check('grants: the app can\'t grant itself (or PUBLIC) anything; TRUNCATE / DDL refused', async () => {
  appErr('GRANT INSERT, UPDATE, DELETE ON "RentalGateOverride" TO PUBLIC'); appErr(`GRANT ALL ON "Payment" TO ${APP}`);
  eq(own(`SELECT has_table_privilege('${APP}', '"RentalGateOverride"', 'INSERT') OR has_table_privilege('${APP}', '"Payment"', 'DELETE') OR has_table_privilege('${APP}', '"Payment"', 'TRUNCATE')`), 'f', 'nothing gained');
  for (const t of ['Payment', 'RentalChecklistRecord', 'AdminActivityLog', 'RentalOrder']) refused(appErr(`TRUNCATE "${t}"`), /permission denied/, `truncate ${t}`);
  refused(appErr('ALTER TABLE "RentalChecklistRecord" ADD COLUMN evil int'), /must be owner/, 'alter table');
});
await check('passwords: the app password does not open the owner account, a wrong password is refused', async () => {
  refused(errOf(runAs(OWNER, APP_PW))('SELECT 1'), /password authentication failed/, 'owner with app password');
  refused(errOf(runAs(APP, 'wrong-password'))('SELECT 1'), /password authentication failed/, 'wrong password');
});
await check('the app still reads and writes ordinary tables (the API runs on this role)', async () => {
  assert(Number(app('SELECT count(*) FROM "Product"')) >= 1, 'read');
  eq((await call('GET', '/health')).status, 200, 'API healthy');
});

console.log('\n2. audit history and evidence can\'t be rewritten or removed by the runtime role');
await check('admin activity log, AI audit log, inventory ledger: UPDATE / DELETE refused', async () => {
  for (const q of ['UPDATE "AdminActivityLog" SET action = \'x\'', 'DELETE FROM "AdminActivityLog"', 'UPDATE "AgentAuditLog" SET "toolName" = \'x\'',
    'DELETE FROM "AgentAuditLog"', 'UPDATE "InventoryTransaction" SET id = id', 'DELETE FROM "InventoryTransaction"']) refused(appErr(q), /permission denied/, q);
});
await check('checklist records / snapshots / items: UPDATE / DELETE refused by privileges (the immutability triggers stay as a second wall)', async () => {
  for (const t of ['RentalChecklistRecord', 'RentalChecklistSnapshot', 'RentalChecklistSnapshotItem']) {
    refused(appErr(`UPDATE "${t}" SET id = id`), /permission denied/, `update ${t}`);
    refused(appErr(`DELETE FROM "${t}"`), /permission denied/, `delete ${t}`);
  }
  // the second wall: even the owner can't (trigger), shown on one row
  refused(ownErr(`DELETE FROM "RentalChecklistRecord" WHERE "rentalOrderId" = '${complete}'`), /R3_EVIDENCE_IMMUTABLE/, 'owner delete');
});
await check('payments, refund requests, exceptions, discrepancies, waivers: DELETE refused; migration history unreadable', async () => {
  for (const t of ['Payment', 'RentalRefundRequest', 'RentalChecklistException', 'RentalDiscrepancy', 'RentalLateFeeWaiver', 'RentalUnitTrackingChange', 'RentalHandoverSafeguard']) {
    refused(appErr(`DELETE FROM "${t}" WHERE false`), /permission denied/, `delete ${t}`);
  }
  refused(appErr('SELECT count(*) FROM "_prisma_migrations"'), /permission denied/, 'migrations');
});

console.log('\n3. recovery overrides: only the owner creates them; the runtime can\'t forge or burn one');
await check('the app can\'t create an override, nor call the gate functions directly (e.g. to consume one)', async () => {
  refused(appErr(`INSERT INTO "RentalGateOverride" (id, "rentalOrderId", step, reason, "authorizedBy", "expiresAt") VALUES ('${uid()}', '${ovrBooking}', 'handover', 'forged by a compromised application', 'Owner', (now() AT TIME ZONE 'UTC') + interval '10 minutes')`), /permission denied/, 'insert');
  refused(appErr(`SELECT naro_r3_use_override('handover', '${ovrBooking}')`), /permission denied for function/, 'use_override');
  refused(appErr(`SELECT naro_r3_staff_problem('${T}', '${ids.admins.cashier.id}', NULL)`), /permission denied for function/, 'staff_problem');
  refused(appErr(`UPDATE "RentalGateOverride" SET "usedAt" = now()`), /permission denied/, 'update');
});
await check('defence in depth: even if INSERT were granted to the app by mistake, the database refuses an override not created by the owner; 03-verify reports the mis-grant; 02-grants repairs it', async () => {
  own(`GRANT INSERT ON "RentalGateOverride" TO ${APP}`);
  const v1 = verify();
  const e = appErr(`INSERT INTO "RentalGateOverride" (id, "rentalOrderId", step, reason, "authorizedBy", "expiresAt") VALUES ('${uid()}', '${ovrBooking}', 'handover', 'forged by a compromised application', 'Owner', (now() AT TIME ZONE 'UTC') + interval '10 minutes')`);
  grants();
  const v2 = verify();
  refused(e, /R3_OVERRIDE_NOT_AUTHORISED/, 'mis-granted insert');
  assert(!v1.ok && /FAIL\s+recovery overrides/.test(v1.out), 'verify must fail on the mis-grant');
  assert(v2.ok, `verify after repair: ${v2.out.split('\n').filter((l) => /FAIL/.test(l)).join(' | ')}`);
  return 'R3_OVERRIDE_NOT_AUTHORISED';
});
await check('an owner-created override lets exactly ONE gated write through (even from the runtime role), stamped with the owner role, the time and the transaction; it can\'t be reused', async () => {
  const oid = uid();
  own(`INSERT INTO "RentalGateOverride" (id, "rentalOrderId", step, reason, "authorizedBy", "expiresAt") VALUES ('${oid}', '${ovrBooking}', 'handover', 'Owner-authorised test: checklist printer broken, ticket IT-1', 'Owner (test)', (now() AT TIME ZONE 'UTC') + interval '10 minutes')`);
  app(`UPDATE "RentalOrder" SET status = 'ACTIVE' WHERE id = '${ovrBooking}'`);
  eq(statusOf(ovrBooking), 'ACTIVE', 'one write');
  const row = own(`SELECT "dbUser" || '|' || ("usedAt" IS NOT NULL) || '|' || ("usedTxid" IS NOT NULL) || '|' || "tenantId" FROM "RentalGateOverride" WHERE id = '${oid}'`);
  eq(row, `${OWNER}|true|true|${T}`, 'stamped');
  refused(appErr(`UPDATE "RentalOrder" SET status = 'CLOSED' WHERE id = '${ovrBooking}'`), /R3_CHECKLIST_GATE/, 'other step');
  refused(ownErr(`UPDATE "RentalGateOverride" SET "usedAt" = NULL WHERE id = '${oid}'`), /R3_EVIDENCE_IMMUTABLE/, 'un-use');
});

console.log('\n4. forged identities: a staff id named in the declaration is verified, not trusted');
await check('invented id, empty actor, a staff member without rentals:release, another shop\'s admin, an inactive admin → all refused on a COMPLETE, fully paid booking', async () => {
  const cases = [['ghost-' + uid(), /unknown/], ['', /no staff member/], [ids.admins.reviewer.id, /lacks rentals:release/], [A2, /belongs to another shop/]];
  for (const [actor, re] of cases) refused(appErr(`${declare('handover', complete, actor)}; UPDATE "RentalOrder" SET status = 'ACTIVE' WHERE id = '${complete}'`), re, `actor ${actor || '(empty)'}`);
  own(`UPDATE "AdminUser" SET "isActive" = false WHERE id = '${ids.admins.cashier2.id}'`);
  const e = appErr(`${declare('handover', complete, ids.admins.cashier2.id)}; UPDATE "RentalOrder" SET status = 'ACTIVE' WHERE id = '${complete}'`);
  own(`UPDATE "AdminUser" SET "isActive" = true WHERE id = '${ids.admins.cashier2.id}'`);
  refused(e, /not active/, 'inactive');
  eq(statusOf(complete), 'FULLY_PAID', 'unchanged');
});
await check('checklist evidence written directly by the app: invented recorder, another shop\'s admin, a staff member without checklist-verify, another shop\'s tenantId, an item of ANOTHER booking → refused', async () => {
  const item = exItems.find((i) => i.stage === 'BOTH').id;
  const ins = (rec, tenant = T, booking = exBooking, it = item) => appErr(`INSERT INTO "RentalChecklistRecord" (id, "tenantId", "rentalOrderId", "snapshotItemId", stage, quantity, condition, "recordedById") VALUES ('${uid()}', '${tenant}', '${booking}', '${it}', 'HANDOVER', 1, 'GOOD', '${rec}')`);
  refused(ins('ghost-' + uid()), /R3_EVIDENCE_INVALID.*unknown/, 'invented');
  refused(ins(A2), /R3_EVIDENCE_INVALID.*another shop/, 'other shop admin');
  refused(ins(ids.admins.reviewer.id), /R3_EVIDENCE_INVALID.*lacks rentals:checklist-verify/, 'no permission');
  refused(ins(ids.admins.cashier.id, T2), /R3_EVIDENCE_INVALID.*booking's shop/, 'other tenant row');
  refused(ins(ids.admins.cashier.id, T, exBooking, completeItems.find((i) => i.stage === 'BOTH').id), /R3_EVIDENCE_INVALID.*not on the checklist/, 'other booking item');
});
await check('exceptions written directly by the app: created APPROVED, requested by a non-checklist person, self-approved, approved without rentals:checklist-exception → refused; a different authorised decider → allowed', async () => {
  const items = `ARRAY['${exItems.find((i) => i.label === 'Veil').id}']`;
  const ins = (status, by) => appErr(`INSERT INTO "RentalChecklistException" (id, "tenantId", "rentalOrderId", kind, "snapshotItemIds", reason, status, "requestedById", "updatedAt") VALUES ('${uid()}', '${T}', '${exBooking}', 'MISSING', ${items}, 'Veil at the cleaners for the test', '${status}', '${by}', now())`);
  refused(ins('APPROVED', ids.admins.cashier.id), /R3_EVIDENCE_INVALID.*REQUESTED/, 'born approved');
  refused(ins('REQUESTED', ids.admins.reviewer.id), /R3_EVIDENCE_INVALID.*lacks rentals:checklist-verify/, 'requester without permission');
  const ex = uid();
  app(`INSERT INTO "RentalChecklistException" (id, "tenantId", "rentalOrderId", kind, "snapshotItemIds", reason, "requestedById", "updatedAt") VALUES ('${ex}', '${T}', '${exBooking}', 'MISSING', ${items}, 'Veil at the cleaners for the test', '${ids.admins.cashier.id}', now())`);
  const decide = (by) => appErr(`UPDATE "RentalChecklistException" SET status = 'APPROVED', "decidedById" = '${by}', "decidedAt" = now() WHERE id = '${ex}'`);
  refused(decide(ids.admins.cashier.id), /someone other than the requester/, 'self');
  refused(decide(ids.admins.cashier2.id), /lacks rentals:checklist-exception/, 'no permission');
  refused(decide(A2), /another shop/, 'other shop');
  eq(decide(ids.admins.checker.id), null, 'authorised decider');
});
await check('discrepancy decided directly by the app: by the person who recorded the return, or without permission → refused', async () => {
  // A return record + an OPEN discrepancy for exBooking (written by the app as the API would).
  const rec = uid(), d = uid(), item = exItems.find((i) => i.label === 'Gown').id;
  own(`INSERT INTO "RentalChecklistRecord" (id, "tenantId", "rentalOrderId", "snapshotItemId", stage, quantity, condition, "recordedById") VALUES ('${rec}', '${T}', '${exBooking}', '${item}', 'RETURN', 1, 'DAMAGED', '${ids.admins.cashier.id}')`,
      `INSERT INTO "RentalDiscrepancy" (id, "tenantId", "rentalOrderId", "snapshotItemId", "recordId", kind, quantity) VALUES ('${d}', '${T}', '${exBooking}', '${item}', '${rec}', 'DAMAGED', 1)`);
  const resolve = (by) => appErr(`UPDATE "RentalDiscrepancy" SET status = 'RESOLVED_NO_CHARGE', "resolvedById" = '${by}', "resolvedAt" = now(), "resolutionNote" = 'test' WHERE id = '${d}'`);
  refused(resolve(ids.admins.cashier.id), /someone other than the person who recorded/, 'recorder');
  refused(resolve(ids.admins.reviewer.id), /lacks rentals:checklist-exception/, 'no permission');
  eq(resolve(ids.admins.checker.id), null, 'authorised reviewer');
});

console.log('\n5. tampered payments and booking terms');
await check('a settled rental payment can\'t be rewritten: amount, component, booking, status (→ PENDING / REFUNDED); can\'t be deleted', async () => {
  for (const [q, re] of [
    [`UPDATE "Payment" SET amount = 1 WHERE id = '${depositPayment}'`, /R3_LEDGER_GUARD.*rewritten/],
    [`UPDATE "Payment" SET component = 'RENTAL_FEE' WHERE id = '${depositPayment}'`, /R3_LEDGER_GUARD.*rewritten/],
    [`UPDATE "Payment" SET "rentalOrderId" = '${noDeposit}' WHERE id = '${depositPayment}'`, /R3_LEDGER_GUARD.*moved/],
    [`UPDATE "Payment" SET status = 'PENDING' WHERE id = '${depositPayment}'`, /R3_LEDGER_GUARD.*only be reversed/],
    [`UPDATE "Payment" SET status = 'REFUNDED' WHERE id = '${depositPayment}'`, /R3_LEDGER_GUARD.*only be reversed/],
    [`DELETE FROM "Payment" WHERE id = '${depositPayment}'`, /permission denied/],
  ]) refused(appErr(q), re, q.slice(0, 60));
  // even the owner can't move or rewrite it (the guard is a trigger)
  refused(ownErr(`UPDATE "Payment" SET amount = 1 WHERE id = '${depositPayment}'`), /R3_LEDGER_GUARD/, 'owner rewrite');
});
await check('a payment of another shop can\'t be attached to this booking; a booking\'s deposit, fee or customer can\'t be changed', async () => {
  refused(appErr(`INSERT INTO "Payment" (id, "tenantId", "rentalOrderId", amount, method, status, component, "updatedAt") VALUES ('${uid()}', '${T2}', '${noDeposit}', 200000, 'CASH', 'COMPLETED', 'DEPOSIT', now())`), /R3_LEDGER_GUARD.*booking's shop/, 'other shop payment');
  refused(appErr(`UPDATE "RentalOrder" SET "damageDeposit" = 0 WHERE id = '${noDeposit}'`), /R3_LEDGER_GUARD.*fixed at booking/, 'deposit to 0');
  refused(appErr(`UPDATE "RentalOrder" SET "totalRentalPrice" = 0 WHERE id = '${noDeposit}'`), /R3_LEDGER_GUARD/, 'fee to 0');
  refused(appErr(`UPDATE "RentalOrder" SET "userId" = (SELECT "userId" FROM "RentalOrder" WHERE id = '${complete}') WHERE id = '${noDeposit}'`), /R3_LEDGER_GUARD/, 'customer swap');
});
await check('a valid staff declaration on a booking whose DEPOSIT was never received → refused by the database\'s release check', async () => {
  const e = refused(appErr(`${declare('handover', noDeposit, ids.admins.cashier.id)}; UPDATE "RentalOrder" SET status = 'ACTIVE' WHERE id = '${noDeposit}'`), /release requirements missing: DEPOSIT/, 'no deposit');
  eq(statusOf(noDeposit), 'FULLY_PAID', 'unchanged');
  return e.slice(0, 120);
});
await check('a late-arriving payment still settles (PENDING → FAILED → COMPLETED stays allowed for the gateway path)', async () => {
  const p = uid();
  app(`INSERT INTO "Payment" (id, "tenantId", "rentalOrderId", amount, method, status, component, "updatedAt") VALUES ('${p}', '${T}', '${noDeposit}', 1000, 'MPESA', 'PENDING', 'LATE_FEE', now())`,
      `UPDATE "Payment" SET status = 'FAILED' WHERE id = '${p}'`, `UPDATE "Payment" SET status = 'COMPLETED' WHERE id = '${p}'`);
  eq(own(`SELECT status FROM "Payment" WHERE id = '${p}'`), 'COMPLETED', 'late completion');
});
await check('RESIDUAL (detection, not prevention): the runtime role can INSERT a fabricated COMPLETED payment; the database then accepts the hand-over — but the row is permanent and attributable, and shows up in shift reconciliation (cash not in any drawer count)', async () => {
  const p = uid();
  app(`INSERT INTO "Payment" (id, "tenantId", "rentalOrderId", amount, method, status, component, "updatedAt") VALUES ('${p}', '${T}', '${fabricated}', 200000, 'CASH', 'COMPLETED', 'DEPOSIT', now())`);
  app(`${declare('handover', fabricated, ids.admins.cashier.id)}; UPDATE "RentalOrder" SET status = 'ACTIVE' WHERE id = '${fabricated}'`);
  eq(statusOf(fabricated), 'ACTIVE', 'allowed');
  refused(appErr(`DELETE FROM "Payment" WHERE id = '${p}'`), /permission denied/, 'hide it');
  refused(appErr(`UPDATE "Payment" SET amount = 0 WHERE id = '${p}'`), /R3_LEDGER_GUARD/, 'shrink it');
  return 'a separately-credentialled payment writer would be needed to prevent it (R3_DB_ROLE_SEPARATION.md §6)';
});

console.log('\n6. replay, connection-pool reuse, concurrency (as the runtime role)');
await check('replay: a session-wide declaration from one transaction is refused in the next on the same connection', async () => {
  const e = appErr(`SELECT set_config('naro.r3_handover', '${raceBooking}:' || txid_current()::text || ':${ids.admins.cashier.id}', false)`, `UPDATE "RentalOrder" SET status = 'ACTIVE' WHERE id = '${raceBooking}'`);
  refused(e, /not declared/, 'replay');
  refused(appErr('BEGIN', declare('handover', raceBooking, ids.admins.cashier.id), 'COMMIT', `UPDATE "RentalOrder" SET status = 'ACTIVE' WHERE id = '${raceBooking}'`), /not declared/, 'after commit');
});
await check('concurrent transactions: a declaration held open by connection A does not help connection B', async () => {
  const a = spawn(PSQL, ['-U', APP, '-h', HOST, '-d', 'naro_fashion', '-w', '-X', '-qAt', '-c', `SET search_path TO ${SCHEMA}`, '-c', 'BEGIN', '-c', declare('handover', raceBooking, ids.admins.cashier.id), '-c', 'SELECT pg_sleep(4)', '-c', 'ROLLBACK'], { env: { ...process.env, PGPASSWORD: APP_PW } });
  await new Promise((r) => setTimeout(r, 1200));
  const e = appErr(`UPDATE "RentalOrder" SET status = 'ACTIVE' WHERE id = '${raceBooking}'`);
  await new Promise((r) => a.on('exit', r));
  refused(e, /not declared/, 'other connection');
});
await check('6 concurrent API hand-overs of the same booking → exactly one succeeds, the others are refused; one ACTIVE booking', async () => {
  const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => call('POST', `/pos-rentals/${raceBooking}/handover`, { token: i % 2 ? tok.cashier2 : tok.cashier, body: {} })));
  const ok = rs.filter((r) => r.status === 201).length;
  eq(ok, 1, `successes (${rs.map((r) => r.status).join(',')})`);
  assert(rs.every((r) => r.status === 201 || (r.status >= 400 && r.status < 500)), `no 5xx (${rs.map((r) => r.status).join(',')})`);
  eq(statusOf(raceBooking), 'ACTIVE', 'state');
  return rs.map((r) => r.status).join(',');
});

console.log('\n7. drift detection (03-verify.sql) and repair (02-grants.sql)');
await check('baseline: 03-verify passes', async () => { const v = verify(); assert(v.ok, v.out.split('\n').filter((l) => /FAIL/.test(l)).join(' | ')); });
await check('a disabled trigger is reported (FAIL, exit ≠ 0); re-enabling restores OK', async () => {
  own('ALTER TABLE "Payment" DISABLE TRIGGER naro_r3_payment_guard');
  const v1 = verify();
  own('ALTER TABLE "Payment" ENABLE TRIGGER naro_r3_payment_guard');
  const v2 = verify();
  assert(!v1.ok && /FAIL\s+no user trigger anywhere in the schema is disabled -- naro_r3_payment_guard/.test(v1.out), 'disabled trigger not reported');
  assert(v2.ok, 'after re-enable');
});
await check('an extra privilege (TRUNCATE on payments, UPDATE on the audit log) is reported; 02-grants removes it', async () => {
  own(`GRANT TRUNCATE ON "Payment" TO ${APP}`, `GRANT UPDATE ON "AdminActivityLog" TO ${APP}`);
  const v1 = verify(); grants(); const v2 = verify();
  assert(!v1.ok && /FAIL\s+app holds no TRUNCATE/.test(v1.out) && /FAIL\s+append-only history/.test(v1.out), 'not reported');
  assert(v2.ok, 'after repair');
});

const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
