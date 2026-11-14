// R1 walk-in exposure (round 25I, owner-selected B+): real API + real Postgres,
// isolated schema. Never production.
//
// Proves on the R1 artifact (and on every build above it) that walk-in POS
// rentals cannot be created or served by ANY account, and that ONLINE rentals
// still work under R1's hand-over gate:
//   1. static: only a code change can set the release flag (no config, env,
//      SiteSetting or permission path in production);
//   2. actor matrix — STAFF, the real system MANAGER grant set, a custom role
//      holding EVERY walk-in code, SUPER_ADMIN, a platform admin, anonymous —
//      on all 14 /pos-rentals routes: refused, 0 rows written (the six
//      servicing routes are tried on a planted POS-channel booking);
//   3. replay: the same Idempotency-Key twice, and offline-shaped bodies;
//   4. ONLINE booking: signed ClickPesa webhook; look-up + staff payments on
//      the POS servicing routes; hand-over refused until EACH gate passes
//      (full fee + deposit, address, approved ID, rentals:release), then OK;
//   5. R1 refund request → independent approval → payout;
//   6. (optional, IT_PROD_DATABASE_URL) a SECOND API in NODE_ENV=production
//      WITH the test override set: still refused.
//
//   IT_MODE=gate|servicing|recut IT_API=.. IT_SCHEMA=.. PSQL=.. node r1-gate.it.mjs <worktree> <pos-ids.json>
//   [IT_R3=1] (R3 builds: default checklist + DISPATCH record before hand-over)
//   [IT_CANCELLATION=1] (cancellation builds: cancelling raises the refund request itself)
//   [IT_PROD_DATABASE_URL=… IT_PROD_PORT=4199] (production-mode probe)
// The API under test must run WITHOUT the test override (NARO_TEST_UNRELEASED_POS_RENTALS).
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import path from 'node:path';

const MODE = process.env.IT_MODE;
if (!['gate', 'servicing', 'recut'].includes(MODE)) throw new Error('IT_MODE=gate|servicing|recut');
const WT = process.argv[2];
const ids = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const API = (process.env.IT_API || '').replace(/\/$/, '');
if (!/^http:\/\/localhost:\d+\/api\/v1$/.test(API)) throw new Error('refusing: IT_API must be a localhost API');
const SCHEMA = process.env.IT_SCHEMA;
if (!/^it_r1[gcsb]$/.test(SCHEMA || '')) throw new Error('refusing: IT_SCHEMA must be it_r1g / it_r1c / it_r1s / it_r1b');
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/18/bin/psql.exe';
const PGH = process.env.PGHOST || 'localhost';
if (!['localhost', '127.0.0.1'].includes(PGH)) throw new Error('refusing: local / CI database only');
const R3 = process.env.IT_R3 === '1';
const CX = process.env.IT_CANCELLATION === '1';
const T = ids.tenantId, G = ids.gown;
const ENV = { ...process.env, PGPASSWORD: 'Admin123' };
const sql = (...q) => execFileSync(PSQL, ['-U', 'naro_admin', '-h', PGH, '-d', 'naro_fashion', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
  '-c', `SET search_path TO ${SCHEMA}`, ...q.flatMap((c) => ['-c', c])], { env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\r/g, '').trim();
const ip = (s) => { const h = createHash('sha256').update(String(s)).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
async function call(method, p, { token, body, tenant = T, raw, key, api = API } = {}) {
  const r = await fetch(api + p, { method, headers: { 'Content-Type': 'application/json', ...(tenant ? { 'X-Tenant-Id': tenant } : {}), 'X-Forwarded-For': ip(token || body?.email || randomBytes(4).toString('hex')), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
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
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const key = () => 'itr1g' + randomBytes(8).toString('hex');
const req = createRequire(path.join(WT, 'apps', 'api', 'package.json'));
const bcrypt = req('bcryptjs');
const loginAs = async (w, api = API) => { const r = await call('POST', '/auth/login', { body: { email: w.email, password: w.password }, api }); assert(r.data?.accessToken, `login ${w.email} ${r.status} ${JSON.stringify(r.data).slice(0, 100)}`); return r.data.accessToken; };
const tok = {};
for (const k of ['super', 'cashier', 'approver', 'finance', 'staff']) tok[k] = await loginAs(ids.admins[k]);
const SRC = path.join(WT, 'apps', 'api', 'src');
const read = (rel) => readFileSync(path.join(SRC, rel), 'utf8');
console.log(`real API ${API} · ${SCHEMA} · mode ${MODE}${R3 ? ' · R3' : ''}${CX ? ' · cancellation' : ''} · walk-in exposure (B+)`);

// ---------------------------------------------------------------- set-up: the actors
const perms = sql(`SELECT code FROM "Permission" WHERE "isActive" = true ORDER BY code`).split('\n').filter(Boolean);
const controllerSrc = MODE === 'recut' ? '' : read('rentals/pos-rentals.controller.ts');
const routeCodes = [...controllerSrc.matchAll(/@RequiresPermission\(([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
const WALKIN_CODES = [...new Set([...routeCodes, 'rentals:create', 'rentals:record-payment', 'rentals:release', 'rentals:refund-request',
  'rentals:manage-inventory', 'rentals:update-status', 'rentals:view', 'id-verification:review', 'payments:confirm-manual'])].filter((c) => perms.includes(c)).sort();
function makeRole(name, codes) {
  const id = uid();
  sql(`INSERT INTO "Role" (id, "tenantId", name, "isSystem", "updatedAt") VALUES ('${id}', '${T}', '${name}', false, now())`,
    `INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT '${id}', id FROM "Permission" WHERE code IN (${codes.map((c) => `'${c}'`).join(',')})`);
  return id;
}
function makeAdmin(tag, roleString, roleId) {
  const id = uid();
  const w = { id, email: `it-r1g-${tag}-${randomBytes(3).toString('hex')}@example.test`, password: 'ItR1Gate12345' };
  sql(`INSERT INTO "AdminUser" (id, "tenantId", email, "passwordHash", "firstName", "lastName", role, "isActive", "updatedAt") VALUES ('${id}', '${T}', '${w.email}', '${bcrypt.hashSync(w.password, 10)}', 'R1G', '${tag}', '${roleString}', true, now())`,
    `INSERT INTO "AdminUserRole" ("adminUserId", "roleId") VALUES ('${id}', '${roleId}')`);
  return w;
}
const managerRoleId = sql(`SELECT id FROM "Role" WHERE name = 'MANAGER' AND "isSystem" = true AND "tenantId" IS NULL`);
assert(managerRoleId, 'system MANAGER role (boot the API once)');
const who = {
  manager: makeAdmin('manager', 'MANAGER', managerRoleId),
  walkinAll: makeAdmin('walkin-all', 'STAFF', makeRole('IT every walk-in code', WALKIN_CODES)),
  noRelease: makeAdmin('no-release', 'STAFF', makeRole('IT cashier without release', ['rentals:view', 'rentals:record-payment', 'rentals:update-status',
    ...(perms.includes('rentals:checklist-verify') ? ['rentals:checklist-verify'] : [])])),
};
for (const k of Object.keys(who)) tok[k] = await loginAs(who[k]);
const PA = { email: `it-r1g-platform-${randomBytes(3).toString('hex')}@example.test`, password: 'ItPlatform12345' };
sql(`INSERT INTO "PlatformAdmin" (id, email, "passwordHash", "firstName", "lastName", "updatedAt") VALUES ('${uid()}', '${PA.email}', '${bcrypt.hashSync(PA.password, 10)}', 'IT', 'Platform', now())`);
{
  const r = await call('POST', '/auth/platform-login', { body: PA, tenant: null });
  assert(r.data?.accessToken, `platform login ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  tok.platform = r.data.accessToken;
}
// Tenant settings and env names someone might expect to switch walk-in rentals on.
const SETTING_KEYS = ['pos_rentals_released', 'posRentalsReleased', 'pos_rentals_enabled', 'walk_in_rentals_enabled', 'pos_rental_mode', 'NARO_TEST_UNRELEASED_POS_RENTALS'];
for (const k of SETTING_KEYS) sql(`INSERT INTO "SiteSetting" (id, "tenantId", key, value, type) VALUES ('${uid()}', '${T}', '${k}', 'true', 'boolean') ON CONFLICT DO NOTHING`);
if (R3) {
  const t = await call('POST', '/rental-checklists/templates', { token: tok.super, body: { name: 'Shop default (r1-gate)', isDefault: true, items: [{ label: 'Item', itemType: 'DISPATCH' }] } });
  assert(t.status === 201, `R3 default template ${t.status} ${JSON.stringify(t.data).slice(0, 120)}`);
}
async function r3Dispatch(id) {
  if (!R3) return;
  const st = (await call('GET', `/rental-checklist/rentals/${id}`, { token: tok.super })).data;
  const entries = st.items.filter((i) => i.stage === 'BOTH').map((i) => ({ snapshotItemId: i.id, quantity: i.quantity, condition: 'GOOD' }));
  const r = await call('POST', `/rental-checklist/rentals/${id}/records`, { token: tok.cashier, body: { stage: 'HANDOVER', entries } });
  assert(r.status === 201, `R3 HANDOVER record ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
}

// ---------------------------------------------------------------- online helpers
const SLUG = sql(`SELECT slug FROM "Tenant" WHERE id = '${T}'`);
const SECRET = 'it-r1g-checksum-' + randomBytes(6).toString('hex');
sql(`DELETE FROM "PaymentMethod" WHERE "tenantId" = '${T}' AND code = 'CLICKPESA_MIXX'`,
  `INSERT INTO "PaymentMethod" (id, "tenantId", name, code, "isActive", "integrationParams", "updatedAt") VALUES ('${uid()}', '${T}', 'Mixx by Yas (test)', 'CLICKPESA_MIXX', true, '{"clientId":"it","apiKey":"it","checksumSecret":"${SECRET}"}', now())`);
const canon = (v) => (v === null || typeof v !== 'object') ? v : Array.isArray(v) ? v.map(canon)
  : Object.fromEntries(Object.keys(v).filter((k) => k !== 'checksum' && k !== 'checksumMethod').sort().map((k) => [k, canon(v[k])]));
async function webhook(ref, amount) {
  const payload = { event: 'PAYMENT RECEIVED', data: { id: 'evt-' + ref, orderReference: ref, status: 'SUCCESS', collectedAmount: amount } };
  payload.checksum = createHmac('sha256', SECRET).update(JSON.stringify(canon(payload)), 'utf8').digest('hex');
  return call('POST', `/payments/webhook/clickpesa/${SLUG}`, { raw: JSON.stringify(payload), tenant: null });
}
function gatewayPayment(rentalId, amount) {
  const ref = 'ITR1G' + randomBytes(6).toString('hex').toUpperCase();
  sql(`INSERT INTO "Payment" (id, "tenantId", "rentalOrderId", amount, method, status, "providerCode", "transactionRef", "createdAt", "updatedAt") VALUES ('${uid()}', '${T}', '${rentalId}', ${amount}, 'MOBILE_MONEY', 'PENDING', 'CLICKPESA_MIXX', '${ref}', (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC'))`);
  return ref;
}
let seq = 0;
async function onlineCustomer() {
  const email = `it-r1g-cust-${++seq}-${randomBytes(3).toString('hex')}@example.test`;
  const r = await call('POST', '/auth/register', { body: { email, password: 'ItCustomer12345', firstName: 'Online', lastName: `C${seq}`, phone: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } });
  assert(r.status === 201, `register ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  const li = await call('POST', '/auth/login', { body: { email, password: 'ItCustomer12345', audience: 'customer' } });
  assert(li.data?.accessToken, `customer login ${li.status} ${JSON.stringify(li.data).slice(0, 120)}`);
  const userId = sql(`SELECT id FROM "User" WHERE email = '${email}'`);
  // Test shortcut: the address and an APPROVED National ID (the ID review itself is not under test here).
  sql(`INSERT INTO "Address" (id, "userId", "fullName", phone, street, city, region, "isDefault", "updatedAt") VALUES ('${uid()}', '${userId}', 'Online C${seq}', '+255700000000', 'Mtaa 1', 'Dar es Salaam', 'Dar es Salaam', true, now())`,
    `INSERT INTO "CustomerIDDocument" (id, "userId", "tenantId", "idType", "idNumber", "frontImageUrl", "verificationStatus", "verifiedAt", "updatedAt") VALUES ('${uid()}', '${userId}', '${T}', 'NATIONAL_ID', '1990${String(seq).padStart(4, '0')}-1', 'private://id-documents/${T}/it.jpg', 'APPROVED', now(), now())`);
  return { token: li.data.accessToken, userId };
}
const BASE = 30 + Number(sql(`SELECT COALESCE(max("returnDate")::date - current_date, 0) FROM "RentalOrder" WHERE "tenantId" = '${T}'`));
async function onlineBooking(start, c) {
  c = c ?? await onlineCustomer();
  const r = await call('POST', '/rentals', { token: c.token, body: { productId: G.id, variantId: G.M, startDate: day(BASE + start), returnDate: day(BASE + start + 2), pickupDate: day(BASE + start) } });
  assert(r.status === 201, `book ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  return { ...r.data, customer: c };
}
const state = (id) => sql(`SELECT status || '|' || COALESCE("holdState", '-') || '|' || channel FROM "RentalOrder" WHERE id = '${id}'`);
const statusOf = (id) => state(id).split('|')[0];
const ledger = async (id) => (await call('GET', `/rental-money/rentals/${id}/ledger`, { token: tok.finance })).data;

// ---------------------------------------------------------------- 1. static: only code can release
console.log('\n1. the release flag can only be changed in code (R5)');
if (MODE !== 'recut') {
  await check('pos-rental-release.ts: POS_RENTALS_RELEASED = false is a literal constant; the module reads no SiteSetting / ConfigService / database / permission', async () => {
    const src = read('rentals/pos-rental-release.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // code only, no comments
    eq([...src.matchAll(/^export const POS_RENTALS_RELEASED = (\w+);$/gm)].map((m) => m[1]), ['false'], 'flag');
    for (const bad of [/prisma/i, /SiteSetting/, /ConfigService/, /siteSetting/, /userHasPermission/, /RequiresPermission/, /\bimport .* from '\.\.\//]) {
      assert(!bad.test(src), `pos-rental-release.ts mentions ${bad}`);
    }
  });
  await check('posRentalsEnabled(): production returns false BEFORE the override is read; the override must be exactly "true"', async () => {
    const src = read('rentals/pos-rental-release.ts');
    const body = src.slice(src.indexOf('export function posRentalsEnabled'), src.indexOf('}', src.indexOf('export function posRentalsEnabled')) + 1);
    const lines = body.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('if') || l.startsWith('return'));
    eq(lines, ["if (POS_RENTALS_RELEASED) return true;", "if (env.NODE_ENV === 'production') return false;", 'return env[POS_RENTALS_TEST_OVERRIDE_ENV] === \'true\';'], 'body');
  });
  await check('no other code reads the override env, assigns the flag, or calls posRentalsEnabled / assertPosRentalsReleased with anything but process.env', async () => {
    const files = [];
    const walk = (d) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.ts$/.test(f) && !/\.spec\.ts$/.test(f)) files.push(p); } };
    walk(SRC);
    const bad = [];
    for (const f of files) {
      const rel = path.relative(SRC, f).replace(/\\/g, '/');
      const s = readFileSync(f, 'utf8');
      if (rel !== 'rentals/pos-rental-release.ts') {
        if (/NARO_TEST_UNRELEASED_POS_RENTALS|POS_RENTALS_TEST_OVERRIDE_ENV/.test(s)) bad.push(`${rel}: reads the override`);
        if (/POS_RENTALS_RELEASED\s*=/.test(s)) bad.push(`${rel}: assigns the flag`);
        for (const m of s.matchAll(/(posRentalsEnabled|assertPosRentalsReleased)\(([^)]*)\)/g)) if (m[2].trim() !== '') bad.push(`${rel}: ${m[0]}`);
      }
    }
    eq(bad, [], 'other code paths');
    return `${files.length} source files scanned`;
  });
}
await check('no MANAGER / STAFF default grant of a walk-in code (rentals:create, rentals:record-payment, rentals:release); the system MANAGER = every catalogue code except MANAGER_EXCLUDED', async () => {
  const n = sql(`SELECT count(*) FROM "RolePermission" rp JOIN "Permission" p ON p.id = rp."permissionId" JOIN "Role" r ON r.id = rp."roleId" WHERE p.code IN ('rentals:create','rentals:record-payment','rentals:release') AND r."isSystem" = true AND r.name <> 'SUPER_ADMIN'`);
  eq(n, '0', 'MANAGER / STAFF grants');
  const seeder = read('roles/system-roles.seeder.ts');
  const block = seeder.slice(seeder.indexOf('MANAGER_EXCLUDED = ['), seeder.indexOf('];', seeder.indexOf('MANAGER_EXCLUDED = [')));
  const excluded = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const want = perms.filter((c) => !excluded.includes(c));
  const got = sql(`SELECT p.code FROM "RolePermission" rp JOIN "Permission" p ON p.id = rp."permissionId" WHERE rp."roleId" = '${managerRoleId}' AND p."isActive" = true ORDER BY p.code`).split('\n').filter(Boolean);
  eq(got, want, 'MANAGER grant set');
  return `MANAGER holds ${got.length} of ${perms.length} codes; ${excluded.length} excluded; custom role holds ${WALKIN_CODES.length}: ${WALKIN_CODES.join(' ')}`;
});

// ---------------------------------------------------------------- 2. actor matrix
console.log('\n2. every actor, every /pos-rentals route: refused, nothing written');
const COUNTED = ['RentalOrder', 'User', 'Address', 'Payment', 'IdempotencyKey', 'CustomerIDDocument', 'RentalRefundRequest', 'RentalUnit', 'InventoryTransaction'];
const existing = new Set(sql(`SELECT table_name FROM information_schema.tables WHERE table_schema = '${SCHEMA}'`).split('\n'));
const counts = () => Object.fromEntries(COUNTED.filter((t) => existing.has(t)).map((t) => [t, Number(sql(`SELECT count(*) FROM "${t}"`))]));
// Audit rows other than the PermissionGuard's own PERMISSION_DENIED refusal note.
const auditOther = () => Number(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action <> 'PERMISSION_DENIED'`));
// A real customer and a planted POS-channel booking (cloned from an online one, far in
// the future) so creation would really book and servicing would really act if not refused.
const realCustomer = await onlineCustomer();
const seedBooking = await onlineBooking(300, realCustomer);
const PLANT = uid(), PLANT_NO = 'RNT-ITPOS' + randomBytes(3).toString('hex').toUpperCase();
sql(`CREATE TEMP TABLE _plant AS SELECT * FROM "RentalOrder" WHERE id = '${seedBooking.id}'`,
  `UPDATE _plant SET id = '${PLANT}', "rentalNumber" = '${PLANT_NO}', channel = 'POS', status = 'DOWN_PAYMENT_PAID', "holdState" = NULL, "holdExpiresAt" = NULL, "startDate" = "startDate" + interval '60 days', "returnDate" = "returnDate" + interval '60 days', "pickupDate" = "pickupDate" + interval '60 days'`,
  `INSERT INTO "RentalOrder" SELECT * FROM _plant`);
const plantPayment = uid();
sql(`INSERT INTO "Payment" (id, "tenantId", "rentalOrderId", amount, method, status, "createdAt", "updatedAt") VALUES ('${plantPayment}', '${T}', '${PLANT}', 1, 'CASH', 'PENDING', now(), now())`);
// Open shifts for every admin actor, so a servicing payment gets past the shift check
// and reaches the booking (the platform admin can't hold a shift: no AdminUser row).
const SESS = {};
for (const [k, id] of [['super', ids.admins.super.id], ['staff', ids.admins.staff.id], ['manager', who.manager.id], ['walkinAll', who.walkinAll.id]]) {
  SESS[k] = uid();
  sql(`INSERT INTO "PosSession" (id, "tenantId", "adminUserId", "openingCash", status) VALUES ('${SESS[k]}', '${T}', '${id}', 0, 'OPEN')`);
}
const bookBody = { customerId: realCustomer.userId, productId: G.id, variantId: G.M, startDate: day(BASE + 200), returnDate: day(BASE + 202), pickupDate: day(BASE + 200), termsAccepted: true };
// [method, path, body, servicing?] — the whole /pos-rentals surface (14 routes)
const ROUTES = [
  ['GET', '/pos-rentals/catalog?q=gown', null, false],
  ['POST', '/pos-rentals/quote', { productId: G.id, variantId: G.M, startDate: day(BASE + 200), returnDate: day(BASE + 202), pickupDate: day(BASE + 200) }, false],
  ['GET', '/pos-rentals/customers?q=Online', null, false],
  ['POST', '/pos-rentals/customers', { firstName: 'Walk', lastName: 'In', phone: '+255711000111' }, false],
  ['POST', `/pos-rentals/customers/${realCustomer.userId}/address`, { street: 'S', city: 'C', region: 'R' }, false],
  ['POST', '/pos-rentals', bookBody, false],
  ['GET', `/pos-rentals/lookup/${PLANT_NO}`, null, true],
  ['GET', `/pos-rentals/${PLANT}`, null, true],
  ['POST', `/pos-rentals/${PLANT}/id-in-person`, { idType: 'NATIONAL_ID', idNumber: '19950101-12345' }, false],
  ['POST', `/pos-rentals/${PLANT}/payments`, (k) => ({ component: 'RENTAL_FEE', sessionId: SESS[k] ?? ids.sessions.cashier, tenders: [{ method: 'CASH', amount: 1000 }] }), true],
  ['GET', `/pos-rentals/${PLANT}/agreement`, null, false],
  ['GET', `/pos-rentals/${PLANT}/receipts/${plantPayment}`, null, true],
  ['POST', `/pos-rentals/${PLANT}/handover`, { unitCode: 'X' }, true],
  ['POST', `/pos-rentals/${PLANT}/return`, { condition: 'GOOD' }, true],
];
const ACTORS = [
  ['STAFF (system role)', 'staff', false],
  ['MANAGER (real system grant set)', 'manager', false],
  ['custom role with EVERY walk-in code', 'walkinAll', true],
  ['SUPER_ADMIN', 'super', true],
  ['platform admin', 'platform', true],
  ['anonymous', null, false],
];
const NR = (r) => r.status === 404 && r.data?.code === 'POS_RENTALS_NOT_RELEASED';
function refusal(r, servicing, allowedThrough) {
  if (MODE === 'recut') return r.status === 404 && r.data?.code !== 'POS_RENTALS_NOT_RELEASED';
  if (MODE === 'gate' || !servicing) return NR(r);
  // servicing route on a non-ONLINE booking: callers who pass the normal guards get the
  // ONLINE-only refusal; the rest are stopped by JWT (401) or PermissionGuard (403).
  return allowedThrough ? NR(r) : (r.status === 401 || r.status === 403 || NR(r));
}
for (const [label, k, through] of ACTORS) {
  await check(`${label}: all ${ROUTES.length} routes refused${MODE === 'servicing' ? ' (8 create / walk-in routes → 404 POS_RENTALS_NOT_RELEASED first; the 6 servicing routes refuse the POS-channel booking)' : ''}; 0 rows written`, async () => {
    const before = counts(), aBefore = auditOther(), plantBefore = state(PLANT);
    const bad = [], seen = {};
    for (const [m, p, b, servicing] of ROUTES) {
      // servicing routes: a token-holder whose permission covers the route reaches the handler
      const r = await call(m, p, { token: k ? tok[k] : undefined, body: (typeof b === 'function' ? b(k) : b) ?? undefined, key: m === 'POST' ? key() : undefined });
      const tag = r.status + (r.data?.code ? ' ' + r.data.code : '');
      seen[tag] = (seen[tag] ?? 0) + 1;
      // the platform admin passes the permission guard but holds no shift: its cash payment stops at the shift check (400)
      const shiftOnly = k === 'platform' && p.endsWith('/payments') && r.status === 400;
      if (!refusal(r, servicing, through) && !shiftOnly) bad.push(`${m} ${p} → ${r.status} ${r.data?.code ?? ''} ${JSON.stringify(r.data?.message ?? '').slice(0, 60)}`);
    }
    eq(bad, [], 'not refused');
    eq(counts(), before, 'rows written');
    eq(auditOther(), aBefore, 'audit rows other than PERMISSION_DENIED');
    eq(state(PLANT), plantBefore, 'planted booking changed');
    return Object.entries(seen).map(([s, n]) => `${n}× ${s}`).join(', ');
  });
}

// ---------------------------------------------------------------- 3. replay
console.log('\n3. replays and offline-shaped requests');
await check('the same Idempotency-Key sent twice (SUPER_ADMIN and the every-code role): both refused, no IdempotencyKey row, no booking', async () => {
  const before = counts();
  for (const k of ['super', 'walkinAll']) {
    const ik = key();
    const a = await call('POST', '/pos-rentals', { token: tok[k], body: bookBody, key: ik });
    const b = await call('POST', '/pos-rentals', { token: tok[k], body: bookBody, key: ik });
    eq([a.status, a.data?.code, b.status, b.data?.code, b.data?.replayed ?? null], [404, 'POS_RENTALS_NOT_RELEASED', 404, 'POS_RENTALS_NOT_RELEASED', null], `${k} replay`);
  }
  eq(counts(), before, 'rows written');
});
await check('offline-shaped bodies (offline: true, clientCreatedAt, sessionId) on booking + servicing payment: refused, nothing written', async () => {
  const before = counts();
  const off = { offline: true, clientCreatedAt: new Date(Date.now() - 3600000).toISOString(), sessionId: ids.sessions.cashier };
  const ik = key();
  const rs = [
    await call('POST', '/pos-rentals', { token: tok.super, body: { ...bookBody, ...off }, key: ik }),
    await call('POST', '/pos-rentals', { token: tok.super, body: { ...bookBody, ...off }, key: ik }),
    await call('POST', `/pos-rentals/${PLANT}/payments`, { token: tok.super, body: { component: 'RENTAL_FEE', tenders: [{ method: 'CASH', amount: 1000 }], ...off }, key: ik }),
    await call('POST', `/pos-rentals/${PLANT}/payments`, { token: tok.walkinAll, body: { component: 'RENTAL_FEE', tenders: [{ method: 'CASH', amount: 1000 }], ...off }, key: key() }),
  ];
  const codes = rs.map((r) => `${r.status} ${r.data?.code ?? r.data?.message ?? ''}`);
  assert(rs.every((r) => r.status >= 400 && r.status < 500), `not refused: ${codes.join(' | ')}`);
  assert(rs.slice(0, 2).every(NR), `booking not refused by the release flag: ${codes.join(' | ')}`);
  eq(counts(), before, 'rows written');
  return codes.join(' | ');
});
await check('the storefront booking route cannot be told to make a POS booking (unknown field channel → 400)', async () => {
  const r = await call('POST', '/rentals', { token: realCustomer.token, body: { productId: G.id, variantId: G.M, startDate: day(BASE + 210), returnDate: day(BASE + 212), pickupDate: day(BASE + 210), channel: 'POS' } });
  eq(r.status, 400, `status ${JSON.stringify(r.data).slice(0, 120)}`);
});
await check(`GET /pos/capabilities: walk-in rentals not released (SUPER_ADMIN and platform admin) — even with ${SETTING_KEYS.length} "enable" SiteSettings set to true`, async () => {
  for (const k of ['super', 'platform']) {
    const r = await call('GET', '/pos/capabilities', { token: tok[k] });
    eq(r.status, 200, `${k} status`);
    if (MODE === 'recut') eq(r.data.posRentalsReleased, undefined, 'no flag in the re-cut');
    else eq([r.data.posRentalsReleased, r.data.posRentalServicing ?? null], [false, MODE === 'servicing' ? true : null], `${k} flags`);
  }
});

// ---------------------------------------------------------------- 4. online booking
console.log('\n4. ONLINE booking: webhook, POS servicing payments, the hand-over gates one by one');
let paid;
await check('online booking (storefront route) → 201, channel ONLINE, ID_VERIFIED with the approved ID', async () => {
  paid = await onlineBooking(0);
  const [st, , ch] = state(paid.id).split('|');
  eq([st, ch], ['ID_VERIFIED', 'ONLINE'], 'state');
  return `${paid.rentalNumber} ${state(paid.id)}`;
});
await check('down payment by the signed ClickPesa webhook → DOWN_PAYMENT_PAID, ledger rental fee 100,000', async () => {
  eq((await webhook(gatewayPayment(paid.id, 100000), 100000)).status, 201, 'webhook');
  eq(statusOf(paid.id), 'DOWN_PAYMENT_PAID', 'status');
  eq((await ledger(paid.id)).collected.RENTAL_FEE, 100000, 'ledger');
});
const handover = (k, id = paid.id) => call('POST', `/pos-rentals/${id}/handover`, { token: tok[k], body: {} });
const dispatch = (k, id = paid.id) => call('PATCH', `/rentals/${id}/status`, { token: tok[k], body: { status: 'ITEM_DISPATCHED' } });
const missing = (r) => `${r.status} ${r.data?.code ?? ''} [${(r.data?.missing ?? []).join(',')}]`;
await check('gate: fee + deposit not fully paid → POS hand-over AND status dispatch → 422 HANDOVER_BLOCKED [FULL_RENTAL_FEE, DEPOSIT]; nothing changed', async () => {
  if (MODE === 'servicing') {
    const h = await handover('cashier');
    eq(missing(h), '422 HANDOVER_BLOCKED [FULL_RENTAL_FEE,DEPOSIT]', 'pos hand-over');
  }
  const d = await dispatch('super');
  eq(missing(d), '422 HANDOVER_BLOCKED [FULL_RENTAL_FEE,DEPOSIT]', 'dispatch');
  eq(statusOf(paid.id), 'DOWN_PAYMENT_PAID', 'unchanged');
});
if (MODE === 'servicing') {
  let feePaymentId;
  await check('servicing: look-up by reference and detail work for the ONLINE booking (cashier, rentals:view)', async () => {
    const l = await call('GET', `/pos-rentals/lookup/${paid.rentalNumber}`, { token: tok.cashier });
    eq([l.status, l.data?.channel, l.data?.handoverReady], [200, 'ONLINE', false], 'lookup');
    const d = await call('GET', `/pos-rentals/${paid.id}`, { token: tok.cashier });
    eq([d.status, d.data?.ledger?.outstanding?.RENTAL_FEE, d.data?.ledger?.outstanding?.DEPOSIT], [200, 300000, 200000], 'detail');
  });
  await check('servicing: STAFF (no rentals:record-payment) cannot take a payment → 403, nothing written', async () => {
    const before = counts();
    const p = await call('POST', `/pos-rentals/${paid.id}/payments`, { token: tok.staff, body: { component: 'RENTAL_FEE', sessionId: ids.sessions.cashier, tenders: [{ method: 'CASH', amount: 1 }] } });
    eq(p.status, 403, 'staff');
    eq(counts(), before, 'rows');
  });
  await check('servicing: the cashier takes the rest of the fee in cash (same Idempotency-Key twice → ONE payment) → only the DEPOSIT missing', async () => {
    const ik = key();
    const body = { component: 'RENTAL_FEE', sessionId: ids.sessions.cashier, tenders: [{ method: 'CASH', amount: 300000 }] };
    const a = await call('POST', `/pos-rentals/${paid.id}/payments`, { token: tok.cashier, key: ik, body });
    const b = await call('POST', `/pos-rentals/${paid.id}/payments`, { token: tok.cashier, key: ik, body });
    eq([a.status, b.status], [201, 201], `pay ${JSON.stringify(a.data).slice(0, 140)}`);
    eq(sql(`SELECT count(*) FROM "Payment" WHERE "rentalOrderId" = '${paid.id}' AND status = 'COMPLETED' AND component = 'RENTAL_FEE' AND amount = 300000`), '1', 'one payment');
    feePaymentId = sql(`SELECT id FROM "Payment" WHERE "rentalOrderId" = '${paid.id}' AND component = 'RENTAL_FEE' AND amount = 300000`);
    eq(missing(await handover('cashier')), '422 HANDOVER_BLOCKED [DEPOSIT]', 'gate');
  });
  await check('servicing: the deposit in cash → fee + deposit fully received; receipt printable', async () => {
    const p = await call('POST', `/pos-rentals/${paid.id}/payments`, { token: tok.cashier, key: key(), body: { component: 'DEPOSIT', sessionId: ids.sessions.cashier, tenders: [{ method: 'CASH', amount: 200000 }] } });
    eq(p.status, 201, `deposit ${JSON.stringify(p.data).slice(0, 140)}`);
    const l = await ledger(paid.id);
    eq([l.collected.RENTAL_FEE, l.collected.DEPOSIT], [400000, 200000], 'ledger');
    const rc = await call('GET', `/pos-rentals/${paid.id}/receipts/${feePaymentId}`, { token: tok.cashier });
    eq(rc.status, 200, `receipt ${JSON.stringify(rc.data).slice(0, 100)}`);
  });
} else {
  await check('no POS servicing: the rest through the raw payments API (POST /payments + PATCH COMPLETED, payments:manage)', async () => {
    for (const [component, amount] of [['RENTAL_FEE', 300000], ['DEPOSIT', 200000]]) {
      const c = await call('POST', '/payments', { token: tok.super, body: { rentalOrderId: paid.id, amount, method: 'CASH', component } });
      eq(c.status, 201, `create ${JSON.stringify(c.data).slice(0, 120)}`);
      eq((await call('PATCH', `/payments/${c.data.id}`, { token: tok.super, body: { status: 'COMPLETED' } })).status, 200, 'complete');
    }
  });
}
await r3Dispatch(paid.id).catch((e) => { results.push('FAIL'); console.log(`  ✖ R3 checklist set-up: ${e.message}`); });
await check('gate: the customer has no address → 422 HANDOVER_BLOCKED [ADDRESS]; restored afterwards', async () => {
  const uidOf = paid.customer.userId;
  const saved = sql(`SELECT "fullName" || '|' || phone || '|' || street || '|' || city || '|' || region FROM "Address" WHERE "userId" = '${uidOf}'`).split('|');
  sql(`DELETE FROM "Address" WHERE "userId" = '${uidOf}'`);
  try {
    const st0 = statusOf(paid.id);
    eq(missing(MODE === 'servicing' ? await handover('cashier') : await dispatch('super')), '422 HANDOVER_BLOCKED [ADDRESS]', 'address gate');
    eq(statusOf(paid.id), st0, 'unchanged');
  } finally {
    sql(`INSERT INTO "Address" (id, "userId", "fullName", phone, street, city, region, "isDefault", "updatedAt") VALUES ('${uid()}', '${uidOf}', '${saved[0]}', '${saved[1]}', '${saved[2]}', '${saved[3]}', '${saved[4]}', true, now())`);
  }
});
await check('gate: the National ID is no longer approved → 422 ID_NOT_APPROVED (or HANDOVER_BLOCKED [APPROVED_ID]); restored afterwards', async () => {
  const uidOf = paid.customer.userId;
  sql(`UPDATE "CustomerIDDocument" SET "verificationStatus" = 'REJECTED' WHERE "userId" = '${uidOf}'`);
  try {
    const st0 = statusOf(paid.id);
    const r = MODE === 'servicing' ? await handover('cashier') : await dispatch('super');
    assert(r.status === 422 && (r.data?.code === 'ID_NOT_APPROVED' || (r.data?.code === 'HANDOVER_BLOCKED' && r.data.missing.includes('APPROVED_ID'))), `id gate ${missing(r)}`);
    eq(statusOf(paid.id), st0, 'unchanged');
    return missing(r);
  } finally {
    sql(`UPDATE "CustomerIDDocument" SET "verificationStatus" = 'APPROVED' WHERE "userId" = '${uidOf}'`);
  }
});
await check('gate: staff WITHOUT rentals:release (but with rentals:update-status + record-payment) → POS hand-over 403, status dispatch 403 RELEASE_NOT_PERMITTED', async () => {
  const st0 = statusOf(paid.id);
    if (MODE === 'servicing') eq((await handover('noRelease')).status, 403, 'pos hand-over');
  const d = await dispatch('noRelease');
  eq([d.status, d.data?.code], [403, 'RELEASE_NOT_PERMITTED'], 'dispatch');
  eq(statusOf(paid.id), st0, 'unchanged');
  return `status ${st0}`;
});
await check(`every gate passes → the hand-over succeeds (${MODE === 'servicing' ? 'POS servicing route, cashier with rentals:release' : 'status dispatch, SUPER_ADMIN'})`, async () => {
  const r = MODE === 'servicing' ? await handover('cashier') : await dispatch('super');
  assert(r.status === 201 || r.status === 200, `hand-over ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  assert(['ACTIVE', 'ITEM_DISPATCHED'].includes(statusOf(paid.id)), statusOf(paid.id));
  return state(paid.id);
});
if (MODE === 'servicing') {
  await check('servicing: the return is recorded on the POS (rentals:update-status) → RETURNED', async () => {
    const r = await call('POST', `/pos-rentals/${paid.id}/return`, { token: tok.cashier, body: { condition: 'GOOD' } });
    eq(r.status, 201, `return ${JSON.stringify(r.data).slice(0, 160)}`);
    eq(statusOf(paid.id), 'RETURNED', 'status');
  });
}

// ---------------------------------------------------------------- 5. R1 refund
console.log('\n5. R1 refund request → independent approval → payout (online booking)');
await check('cancel a paid online booking → REFUND_DUE; full fee request → approved by a second person → paid out → ledger 0 held, one REFUNDED row', async () => {
  const b = await onlineBooking(10);
  eq((await webhook(gatewayPayment(b.id, 100000), 100000)).status, 201, 'paid');
  eq((await call('PATCH', `/rentals/${b.id}/status`, { token: tok.super, body: { status: 'CANCELLED' } })).status, 200, 'cancelled');
  if (!CX) eq(state(b.id).split('|').slice(0, 2).join('|'), 'CANCELLED|REFUND_DUE', 'liability');
  let reqId;
  if (CX) {
    reqId = sql(`SELECT id FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${b.id}' AND kind = 'CANCELLATION' AND amount = 100000`);
    assert(reqId, 'the cancellation raised the request itself');
    eq((await call('PATCH', `/rental-money/refund-requests/${reqId}/approve`, { token: tok.super })).status, 403, 'requester (who cancelled) cannot approve');
  } else {
    const q = await call('POST', `/rental-money/rentals/${b.id}/refund-requests`, { token: tok.cashier, body: { kind: 'CANCELLATION', component: 'RENTAL_FEE', amount: 100000, reason: 'customer cancelled before collection' } });
    eq(q.status, 201, `request ${JSON.stringify(q.data).slice(0, 140)}`);
    reqId = q.data.id;
    eq((await call('PATCH', `/rental-money/refund-requests/${reqId}/approve`, { token: tok.cashier })).status, 403, 'requester cannot approve');
  }
  eq((await call('PATCH', `/rental-money/refund-requests/${reqId}/approve`, { token: tok.approver })).status, 200, 'approve');
  const p = await call('PATCH', `/rental-money/refund-requests/${reqId}/pay`, { token: tok.finance, body: { method: 'MOBILE_MONEY', reference: 'MPR1G' + randomBytes(5).toString('hex').toUpperCase() } });
  eq(p.status, 200, `pay ${JSON.stringify(p.data).slice(0, 120)}`);
  const l = await ledger(b.id);
  eq([l.totalHeld, l.refunded.RENTAL_FEE], [0, 100000], 'ledger');
  eq(sql(`SELECT count(*) FROM "Payment" WHERE "rentalOrderId" = '${b.id}' AND status = 'REFUNDED' AND "refundRequestId" = '${reqId}'`), '1', 'payout row');
  return state(b.id);
});

// ---------------------------------------------------------------- 6. production-mode probe
if (process.env.IT_PROD_DATABASE_URL && MODE !== 'recut') {
  console.log('\n6. a second API in NODE_ENV=production WITH NARO_TEST_UNRELEASED_POS_RENTALS=true');
  const port = Number(process.env.IT_PROD_PORT || 4199);
  const PAPI = `http://localhost:${port}/api/v1`;
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: path.join(WT, 'apps', 'api'),
    env: {
      ...process.env, NODE_ENV: 'production', NARO_TEST_UNRELEASED_POS_RENTALS: 'true', PORT: String(port), GIT_SHA: 'r1-gate-prod-probe',
      DATABASE_URL: process.env.IT_PROD_DATABASE_URL, TENANT_SCOPE_ENFORCEMENT: 'warn', STOREFRONT_URL: 'http://localhost:3101', ADMIN_URL: 'http://localhost:3233',
      SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', JWT_SECRET: 'ci-only-jwt-secret-0123456789abcdef0123456789', JWT_REFRESH_SECRET: 'ci-only-refresh-secret-0123456789abcdef01234567',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    try { const h = await fetch(`${PAPI}/health`); up = h.ok && (await h.text()).includes('r1-gate-prod-probe'); } catch { /* not yet */ }
    if (!up) await new Promise((r) => setTimeout(r, 1000));
  }
  await check('production-mode API (override env set) is up', async () => { assert(up, `did not start: ${log.slice(-400)}`); });
  if (up) {
    await check('production + override: capabilities still say not released; every create / walk-in route 404 POS_RENTALS_NOT_RELEASED for SUPER_ADMIN; a servicing payment on the POS booking refused; nothing written', async () => {
      const t = await loginAs(ids.admins.super, PAPI);
      const caps = await call('GET', '/pos/capabilities', { token: t, api: PAPI });
      eq([caps.status, caps.data?.posRentalsReleased], [200, false], 'capabilities');
      const before = counts();
      const bad = [];
      for (const [m, p, b, servicing] of ROUTES) {
        const r = await call(m, p, { token: t, body: (typeof b === 'function' ? b('super') : b) ?? undefined, key: m === 'POST' ? key() : undefined, api: PAPI });
        if (!NR(r)) bad.push(`${m} ${p} → ${r.status} ${r.data?.code ?? ''}`);
      }
      eq(bad, [], 'not refused');
      eq(counts(), before, 'rows written');
    });
  }
  child.kill();
  await new Promise((r) => setTimeout(r, 1500));
}

// ---------------------------------------------------------------- final
await check('no walk-in booking exists in the schema except the planted test row (channel POS)', async () => {
  eq(sql(`SELECT count(*) FROM "RentalOrder" WHERE channel <> 'ONLINE' AND id <> '${PLANT}'`), '0', 'POS bookings');
  eq(sql(`SELECT count(*) FROM "Payment" WHERE "rentalOrderId" = '${PLANT}'`), '1', 'payments on the planted booking (only the planted PENDING row)');
});

const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
