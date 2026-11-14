// Round 25F D: two-person activation of checklist templates — real API + real
// Postgres (local branch local/template-approval, on PR #35). Isolated schema
// (IT_SCHEMA, default it_tpl) seeded by an it_tpl copy of pos-rental-seed.js.
// Never production.
//   IT_API=http://localhost:4180/api/v1 IT_SCHEMA=it_tpl PSQL=<psql> node template-approval.it.mjs <ids.json>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const API = (process.env.IT_API || 'http://localhost:4180/api/v1').replace(/\/$/, '');
if (!/^http:\/\/localhost:/.test(API)) throw new Error('refusing: localhost only');
const SCHEMA = process.env.IT_SCHEMA || 'it_tpl';
const ids = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const T = ids.tenantId;
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe';
const sql = (q) => execFileSync(PSQL, ['-U', 'naro_admin', '-h', 'localhost', '-d', 'naro_fashion', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
  '-c', `SET search_path TO ${SCHEMA}`, '-c', q], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sqlError = (q) => { try { sql(q); return null; } catch (e) { return String(e.stderr || e.message); } };
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
const login = async (w) => { const r = await call('POST', '/auth/login', { body: { email: w.email, password: w.password } }); assert(r.data?.accessToken, `login ${w.email} ${r.status}`); return r.data.accessToken; };
const tok = {};
for (const k of ['super', 'cashier', 'reviewer', 'checker']) tok[k] = await login(ids.admins[k]);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const G = ids.gown, S = ids.sessions;
const statusOf = (id) => sql(`SELECT status FROM "RentalOrder" WHERE id = '${id}'`);
const audits = (id, action) => Number(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE "entityId" = '${id}' AND action = '${action}'`));

// The ID reviewer is also given the NEW approval code (test set-up, as the owner would grant it deliberately).
sql(`INSERT INTO "Role" (id, "tenantId", name, "isSystem", "updatedAt") VALUES ('tplrole${T}', '${T}', 'IT Template Approver (ID reviewer)', false, now()) ON CONFLICT DO NOTHING`);
sql(`INSERT INTO "RolePermission" ("roleId", "permissionId") SELECT 'tplrole${T}', id FROM "Permission" WHERE code = 'rentals:checklist-approve' ON CONFLICT DO NOTHING`);
sql(`INSERT INTO "AdminUserRole" ("adminUserId", "roleId") VALUES ('${ids.admins.reviewer.id}', 'tplrole${T}') ON CONFLICT DO NOTHING`);

let seq = 0;
async function readyBooking(start) {
  const c = (await call('POST', '/pos-rentals/customers', { token: tok.cashier, body: { firstName: 'Tpl', lastName: `C${++seq}`, phone: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } })).data;
  await call('POST', `/pos-rentals/customers/${c.id}/address`, { token: tok.cashier, body: { street: 'Mwenge 12', city: 'Dar es Salaam', region: 'Dar es Salaam' } });
  const b = await call('POST', '/pos-rentals', { token: tok.cashier, body: { customerId: c.id, productId: G.id, variantId: G.M, startDate: day(start), returnDate: day(start + 2), pickupDate: day(start), termsAccepted: true } });
  assert(b.status === 201, `book ${b.status} ${JSON.stringify(b.data).slice(0, 160)}`);
  await call('POST', `/pos-rentals/${b.data.id}/id-in-person`, { token: tok.reviewer, body: { idType: 'NATIONAL_ID', idNumber: `1997${String(seq).padStart(4, '0')}-12345` } });
  for (const [component, amount] of [['RENTAL_FEE', 400000], ['DEPOSIT', 200000]]) {
    const p = await call('POST', `/pos-rentals/${b.data.id}/payments`, { token: tok.cashier, body: { component, sessionId: S.cashier, tenders: [{ method: 'CASH', amount }] } });
    assert(p.status === 201, `pay ${component} ${p.status}`);
  }
  return b.data.id;
}
const state = async (id) => (await call('GET', `/rental-checklist/rentals/${id}`, { token: tok.cashier })).data;
const handover = (id) => call('POST', `/pos-rentals/${id}/handover`, { token: tok.cashier, body: {} });
const deskFreeze = (id) => call('POST', `/rental-checklist/rentals/${id}/snapshot`, { token: tok.cashier, body: {} });
const tpl = async (id) => (await call('GET', `/rental-checklists/templates/${id}`, { token: tok.reviewer })).data;
const confirmAll = (t) => ({ version: t.version, hash: t.contentHash, scope: { productId: t.productId ?? null, categoryId: t.categoryId ?? null }, confirmedItems: t.items.map((i) => ({ itemId: i.id, quantity: i.quantity })) });
const approve = (id, body, token = tok.reviewer) => call('POST', `/rental-checklists/templates/${id}/approve`, { token, body });
const BASE = 30 + Number(sql(`SELECT COALESCE(max("returnDate")::date - current_date, 0) FROM "RentalOrder" WHERE "tenantId" = '${T}'`));

console.log(`real API ${API} · isolated schema ${SCHEMA} · two-person checklist template approval (round 25F D)`);
let t0;
await check('a template the editor creates is a DRAFT (version 1) with the hash of its content', async () => {
  const r = await call('POST', '/rental-checklists/templates', { token: tok.checker, body: { name: 'Ivory gown set', productId: G.id, items: [
    { label: 'Gown', itemType: 'DISPATCH', quantity: 1 }, { label: 'Veil', itemType: 'DISPATCH', quantity: 1 },
    { label: 'Padded hangers', itemType: 'DISPATCH', quantity: 2, requiresCondition: false }, { label: 'Stains / odour check', itemType: 'RETURN' }] } });
  t0 = r.data;
  eq([r.status, t0.approvalStatus, t0.version, /^[0-9a-f]{64}$/.test(t0.contentHash), t0.draftAuthorIds], [201, 'DRAFT', 1, true, [ids.admins.checker.id]], 'draft');
  assert(audits(t0.id, 'TEMPLATE_SUBMITTED') === 1, 'submitted audited');
});
const b1 = await readyBooking(BASE);
await check('an UNAPPROVED template authorises nothing: a confirmed booking gets no checklist, the desk freeze is refused (409 TEMPLATE_NOT_APPROVED), hand-over refused', async () => {
  const st = await state(b1);
  eq(st?.snapshot ?? null, null, 'no snapshot at confirmation');
  const d = await deskFreeze(b1);
  eq([d.status, d.data?.code], [409, 'TEMPLATE_NOT_APPROVED'], 'desk freeze');
  const h = await handover(b1);
  eq([h.status, h.data?.missing?.includes('CHECKLIST_SNAPSHOT'), statusOf(b1)], [422, true, 'FULLY_PAID'], 'hand-over');
});
await check('two-person rule: someone without rentals:checklist-approve → 403; a SUPER_ADMIN who edited this version → 403 SELF_APPROVAL (no bypass)', async () => {
  eq((await approve(t0.id, confirmAll(t0), tok.checker)).status, 403, 'editor without the approval code');
  const ed = await call('PUT', `/rental-checklists/templates/${t0.id}`, { token: tok.super, body: { description: 'edited by the owner' } });
  eq([ed.status, ed.data?.version, ed.data?.approvalStatus], [200, 2, 'DRAFT'], 'super edits → v2');
  t0 = await tpl(t0.id);
  const self = await approve(t0.id, confirmAll(t0), tok.super);
  eq([self.status, self.data?.code], [403, 'SELF_APPROVAL'], 'super self-approval');
});
await check('the approval must match the exact version + hash (409 TEMPLATE_CHANGED) and confirm EVERY quantity (400 ITEMS_NOT_CONFIRMED); nothing approved; denials audited', async () => {
  eq((await approve(t0.id, { ...confirmAll(t0), version: 1 })).data?.code, 'TEMPLATE_CHANGED', 'old version');
  eq((await approve(t0.id, { ...confirmAll(t0), hash: 'a'.repeat(64) })).data?.code, 'TEMPLATE_CHANGED', 'other hash');
  const wrong = await approve(t0.id, { ...confirmAll(t0), confirmedItems: confirmAll(t0).confirmedItems.map((c, n) => (n === 2 ? { ...c, quantity: 1 } : c)) });
  eq([wrong.status, wrong.data?.code, wrong.data?.problems], [400, 'ITEMS_NOT_CONFIRMED', ['Padded hangers × 2']], 'wrong quantity');
  eq(sql(`SELECT "approvalStatus" FROM "RentalChecklistTemplate" WHERE id = '${t0.id}'`), 'DRAFT', 'still draft');
  assert(audits(t0.id, 'TEMPLATE_APPROVAL_DENIED') >= 4, 'denials audited');
});
await check('the database refuses an approval written directly by an author of the version (R3_TEMPLATE_APPROVAL)', async () => {
  const e = sqlError(`UPDATE "RentalChecklistTemplate" SET "approvalStatus" = 'APPROVED', "approvedVersion" = version, "approvedHash" = naro_r3_template_hash(id, "productId", "categoryId", "isDefault"), "approvedById" = '${ids.admins.super.id}', "approvedAt" = now() WHERE id = '${t0.id}'`);
  assert(/R3_TEMPLATE_APPROVAL/.test(e || ''), (e || 'ALLOWED').split('\n')[0]);
});
await check('a different, authorised person confirms everything → APPROVED for version 2 with the content hash (DB hash = API hash), audited with the items', async () => {
  const r = await approve(t0.id, confirmAll(t0));
  eq([r.status, r.data?.approvalStatus, r.data?.approvedVersion, r.data?.approvedById], [201, 'APPROVED', 2, ids.admins.reviewer.id], 'approved');
  eq(sql(`SELECT "approvedHash" = naro_r3_template_hash(id, "productId", "categoryId", "isDefault") FROM "RentalChecklistTemplate" WHERE id = '${t0.id}'`), 't', 'database hash agrees');
  eq(r.data.approvedHash, t0.contentHash, 'api hash');
  eq(audits(t0.id, 'TEMPLATE_APPROVED'), 1, 'audited');
  t0 = r.data;
});
let b2Items;
await check('approved: the waiting booking gets its checklist at the desk (version + hash recorded); evidence → hand-over works', async () => {
  eq((await deskFreeze(b1)).status, 201, 'desk freeze');
  eq(sql(`SELECT "templateVersion" || '|' || "templateHash" FROM "RentalChecklistSnapshot" WHERE "rentalOrderId" = '${b1}'`), `2|${t0.approvedHash}`, 'snapshot names the approval');
  const st = await state(b1);
  const entries = st.items.filter((i) => i.stage === 'BOTH').map((i) => ({ snapshotItemId: i.id, quantity: i.quantity, ...(i.requiresCondition ? { condition: 'GOOD' } : {}) }));
  eq((await call('POST', `/rental-checklist/rentals/${b1}/records`, { token: tok.cashier, body: { stage: 'HANDOVER', entries } })).status, 201, 'recorded');
  const h = await handover(b1);
  eq([h.status, statusOf(b1)], [201, 'ACTIVE'], 'handed over');
});
const b2 = await readyBooking(BASE + 10);
await check('a new booking confirmed while the template is approved gets it automatically', async () => {
  const st = await state(b2);
  b2Items = st.items.map((i) => `${i.label}×${i.quantity}`);
  eq([st.snapshot?.source, st.snapshot?.templateVersion, b2Items], ['PRODUCT', 2, ['Gown×1', 'Veil×1', 'Padded hangers×2', 'Stains / odour check×1']], 'snapshot');
});
await check('a correction (edit after approval) → DRAFT v3, audited TEMPLATE_CORRECTED; the existing booking keeps its checklist; a new booking is blocked until re-approval', async () => {
  const u = await call('PUT', `/rental-checklists/templates/${t0.id}`, { token: tok.checker, body: { items: [
    { label: 'Gown', itemType: 'DISPATCH', quantity: 1 }, { label: 'Veil', itemType: 'DISPATCH', quantity: 1 }, { label: 'Tiara', itemType: 'DISPATCH', quantity: 1 },
    { label: 'Padded hangers', itemType: 'DISPATCH', quantity: 2, requiresCondition: false }, { label: 'Stains / odour check', itemType: 'RETURN' }] } });
  eq([u.status, u.data?.version, u.data?.approvalStatus], [200, 3, 'DRAFT'], 'draft v3');
  eq(audits(t0.id, 'TEMPLATE_CORRECTED'), 1, 'audited');
  eq((await state(b2)).items.map((i) => `${i.label}×${i.quantity}`), b2Items, 'existing snapshot unchanged');
  const b3 = await readyBooking(BASE + 20);
  eq((await state(b3))?.snapshot ?? null, null, 'new booking: no checklist');
  eq((await handover(b3)).status, 422, 'new booking blocked');
  t0 = await tpl(t0.id);
});
await check('the database refuses a snapshot taken directly from a DRAFT template (R3_TEMPLATE_NOT_APPROVED)', async () => {
  const b = sql(`SELECT id FROM "RentalOrder" WHERE "tenantId" = '${T}' AND id NOT IN (SELECT "rentalOrderId" FROM "RentalChecklistSnapshot") AND status = 'FULLY_PAID' LIMIT 1`);
  const e = sqlError(`INSERT INTO "RentalChecklistSnapshot" (id, "tenantId", "rentalOrderId", "templateId", "templateVersion", "templateHash", source) VALUES ('snap${randomBytes(4).toString('hex')}', '${T}', '${b}', '${t0.id}', 3, '${t0.contentHash}', 'PRODUCT')`);
  assert(/R3_TEMPLATE_NOT_APPROVED/.test(e || ''), (e || 'ALLOWED').split('\n')[0]);
});
await check('after re-approval, an item changed behind the approval (direct SQL) makes the template unusable: the next booking gets no checklist', async () => {
  eq((await approve(t0.id, confirmAll(t0))).status, 201, 're-approved v3');
  sql(`UPDATE "RentalChecklistTemplateItem" SET quantity = 3 WHERE "templateId" = '${t0.id}' AND label = 'Padded hangers'`);
  const b4 = await readyBooking(BASE + 30);
  eq((await state(b4))?.snapshot ?? null, null, 'no checklist from tampered content');
  sql(`UPDATE "RentalChecklistTemplateItem" SET quantity = 2 WHERE "templateId" = '${t0.id}' AND label = 'Padded hangers'`); // restore the approved content
});
await check('withdrawal (reason required, audited) stops new checklists; bookings that have one keep it', async () => {
  eq((await call('POST', `/rental-checklists/templates/${t0.id}/withdraw`, { token: tok.reviewer, body: { reason: 'short' } })).status, 400, 'reason required');
  const w = await call('POST', `/rental-checklists/templates/${t0.id}/withdraw`, { token: tok.reviewer, body: { reason: 'tiara no longer lent with this gown' } });
  eq([w.status, w.data?.approvalStatus], [201, 'WITHDRAWN'], 'withdrawn');
  eq(audits(t0.id, 'TEMPLATE_WITHDRAWN'), 1, 'audited');
  const b5 = await readyBooking(BASE + 40);
  eq((await state(b5))?.snapshot ?? null, null, 'new booking: no checklist');
  eq((await state(b2)).items.map((i) => `${i.label}×${i.quantity}`), b2Items, 'b2 unchanged');
});

const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
