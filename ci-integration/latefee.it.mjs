// Real API + real Postgres test for the late-fee rules LF-2026-11 (round 25 C).
// Local API (:4130) on the isolated schema it_pos seeded by pos-rental-seed.js.
// Overdue returns are simulated by moving a booking's dates in SQL (the API
// then performs the real return and computes the fee). Never production.
//   node latefee.it.mjs <pos-ids.json>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const API = (process.env.IT_API || 'http://localhost:4130/api/v1').replace(/\/$/, '');
if (!/^http:\/\/localhost:/.test(API)) throw new Error('refusing: localhost only');
const ids = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const T = ids.tenantId;
const sql = (q) => execFileSync(process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe', ['-U', 'naro_admin', '-h', 'localhost', '-d', 'naro_fashion', '-qAt', '-v', 'ON_ERROR_STOP=1',
  '-c', `SET search_path TO it_pos; ${q}`], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8' }).trim();
const xff = (s) => { const h = createHash('sha256').update(String(s)).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
async function call(method, p, { token, body, tenant } = {}) {
  const r = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff(token || body?.email || p), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(tenant ? { 'X-Tenant-Id': tenant } : {}) },
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
const login = async (who) => { const r = await call('POST', '/auth/login', { body: { email: who.email, password: who.password } }); assert(r.data?.accessToken, `login ${who.email}`); return r.data.accessToken; };
const tok = { super: await login(ids.admins.super), cashier: await login(ids.admins.cashier) };
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const customer = async (tag) => (await call('POST', '/pos-rentals/customers', { token: tok.cashier, body: { firstName: 'Late', lastName: tag, phone: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } })).data;
const book = async (productId, variantId, start) => {
  const c = await customer(`c${start}`);
  const r = await call('POST', '/pos-rentals', { token: tok.cashier, body: { customerId: c.id, productId, variantId, startDate: day(start), returnDate: day(start + 2), pickupDate: day(start), termsAccepted: true } });
  assert(r.status === 201, `book ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  return r.data;
};
// Simulate: handed over long ago, agreed return `late` whole days ago (EAT), still out.
// Noon in Tanzania, `n` calendar days ago (so whole-day counting is deterministic).
const eatNoon = (n) => { const e = new Date(Date.now() + 3 * 3600e3); return new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate(), 9, 0) - n * 86400e3).toISOString(); };
// Test-only shortcut past the hand-over. On an R3 database the trigger refuses a
// direct hand-over write; the harness uses the documented single-use override
// (GATE_RECOVERY_PROCEDURE.md). Older databases have no override table.
const R3DB = sql(`SELECT to_regclass('"RentalGateOverride"') IS NOT NULL`) === 't';
const makeOverdue = (id, late) => sql(`${R3DB ? `INSERT INTO "RentalGateOverride" (id, "tenantId", "rentalOrderId", step, reason, "authorizedBy", "expiresAt") VALUES ('it-' || md5(random()::text), '${T}', '${id}', 'handover', 'integration test shortcut: simulated hand-over', 'it-harness', (now() AT TIME ZONE 'UTC') + interval '5 minutes');` : ''} UPDATE "RentalOrder" SET status = 'ACTIVE', "startDate" = '${eatNoon(late + 3)}', "pickupDate" = '${eatNoon(late + 3)}', "returnDate" = '${eatNoon(late)}' WHERE id = '${id}'`);
const returnNow = (id) => call('PATCH', `/rentals/${id}/status`, { token: tok.super, body: { status: 'RETURNED' } });
const G = ids.gown, Z = ids.zero;

console.log(`real API ${API} · isolated schema it_pos · late-fee rules LF-2026-11`);
await check('the public storefront quote and the POS quote show the SAME terms: 10 % = TZS 40,000 a day, capped at TZS 400,000, EN + SW text', async () => {
  const pub = await call('GET', `/rentals/quote/${G.id}`, { tenant: T });
  eq([pub.status, pub.data?.lateFee?.basis, pub.data?.lateFee?.pct, pub.data?.lateFee?.perDay, pub.data?.lateFee?.capAmount], [200, 'PERCENT', 10, 40000, 400000], 'public');
  assert(/up to TZS 400,000/.test(pub.data.lateFee.text.en) && /isiyozidi TZS 400,000/.test(pub.data.lateFee.text.sw), 'text');
  const pos = await call('POST', '/pos-rentals/quote', { token: tok.cashier, body: { productId: G.id, variantId: G.M, startDate: day(300), returnDate: day(302), pickupDate: day(300) } });
  eq(pos.data?.lateFeePerDay, 40000, 'POS');
});
let b1, b2, b3;
await check('a new booking stores the terms it was made under', async () => {
  // All gown bookings first: an overdue gown (legacy one-at-a-time rule) blocks new bookings of it.
  b1 = await book(G.id, G.M, 310);
  b2 = await book(G.id, G.M, 330);
  b3 = await book(G.id, G.M, 370);
  eq(sql(`SELECT "lateFeeTerms"->>'version' || '|' || ("lateFeeTerms"->>'perDay') || '|' || ("lateFeeTerms"->>'capAmount') FROM "RentalOrder" WHERE id = '${b1.id}'`), 'LF-2026-11|40000|400000', 'stored');
});
await check('the agreed terms are kept: raising the product to 50 % after booking does not change THIS booking', async () => {
  sql(`UPDATE "Product" SET "latePenaltyPercent" = 50 WHERE id = '${G.id}'`);
  makeOverdue(b1.id, 3);
  const over = await call('GET', '/rentals/overdue', { token: tok.super });
  const row = over.data.find((r) => r.id === b1.id);
  eq([row?.daysLate, row?.lateFeeAccrued], [3, 120000], 'overdue list (accrued so far)');
  const r = await returnNow(b1.id);
  eq([r.status, Number(sql(`SELECT "lateFee" FROM "RentalOrder" WHERE id = '${b1.id}'`))], [200, 120000], '3 days × 40,000 at return');
  sql(`UPDATE "Product" SET "latePenaltyPercent" = 10 WHERE id = '${G.id}'`);
});
await check('the cap: 12 days late → TZS 400,000 (100 % of the fee), not 480,000', async () => {
  const b = b2;
  makeOverdue(b.id, 12);
  eq((await returnNow(b.id)).status, 200, 'returned');
  eq(Number(sql(`SELECT "lateFee" FROM "RentalOrder" WHERE id = '${b.id}'`)), 400000, 'capped');
});
await check('an explicit 0 % means NO late fee: the shop\'s fixed daily fee (10,000) is NOT used instead', async () => {
  sql(`UPDATE "Product" SET "latePenaltyPercent" = 0 WHERE id = '${Z.id}'`);
  sql(`UPDATE "RentalPolicy" SET "lateFeePerDay" = 10000 WHERE "tenantId" = '${T}'`);
  const q = await call('GET', `/rentals/quote/${Z.id}`, { tenant: T });
  eq([q.data?.lateFee?.basis, q.data?.lateFee?.perDay, q.data?.lateFee?.text?.en], ['NONE', 0, 'No late fee applies to this item.'], 'quote');
  const b = await book(Z.id, Z.variantId, 350);
  makeOverdue(b.id, 5);
  eq((await returnNow(b.id)).status, 200, 'returned');
  eq(Number(sql(`SELECT "lateFee" FROM "RentalOrder" WHERE id = '${b.id}'`)), 0, 'no fee');
});
await check('a booking made BEFORE the rules (no stored terms) keeps its legacy rule (uncapped 10 % a day)', async () => {
  const b = b3;
  sql(`UPDATE "RentalOrder" SET "lateFeeTerms" = NULL WHERE id = '${b.id}'`);
  makeOverdue(b.id, 12);
  eq((await returnNow(b.id)).status, 200, 'returned');
  eq(Number(sql(`SELECT "lateFee" FROM "RentalOrder" WHERE id = '${b.id}'`)), 480000, 'legacy rule preserved');
});
let w1;
await check('waiver: the requester cannot approve (403, audited); another person approves; what is due falls; over-waiving refused', async () => {
  const req = await call('POST', `/rental-money/rentals/${b1.id}/late-fee-waivers`, { token: tok.cashier, body: { amount: 40000, reason: 'Customer phoned in advance; one day waived' } });
  w1 = req.data;
  eq([req.status, w1?.status], [201, 'REQUESTED'], 'requested');
  eq((await call('PATCH', `/rental-money/late-fee-waivers/${w1.id}/approve`, { token: tok.cashier, body: {} })).status, 403, 'cashier lacks rentals:waive-late-fee');
  const ok = await call('PATCH', `/rental-money/late-fee-waivers/${w1.id}/approve`, { token: tok.super, body: { note: 'agreed' } });
  eq([ok.status, ok.data?.status], [200, 'APPROVED'], 'approved by a different person');
  const ledger = await call('GET', `/rental-money/rentals/${b1.id}/ledger`, { token: tok.super });
  eq(ledger.data?.due?.LATE_FEE, 80000, 'due after waiver');
  const over = await call('POST', `/rental-money/rentals/${b1.id}/late-fee-waivers`, { token: tok.cashier, body: { amount: 90000, reason: 'too much' } });
  eq(over.status, 400, 'over-waive');
  assert(Number(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action IN ('LATE_FEE_WAIVER_REQUESTED','LATE_FEE_WAIVER_APPROVED')`)) >= 2, 'audited');
});
await check('a self-approval attempt is refused even for a SUPER_ADMIN requester (403 SELF_APPROVAL)', async () => {
  const req = (await call('POST', `/rental-money/rentals/${b1.id}/late-fee-waivers`, { token: tok.super, body: { amount: 1000, reason: 'test self approval' } })).data;
  const self = await call('PATCH', `/rental-money/late-fee-waivers/${req.id}/approve`, { token: tok.super, body: {} });
  eq([self.status, self.data?.code], [403, 'SELF_APPROVAL'], 'self');
});
await check('the agreement prints the agreed late-fee terms in English and Swahili', async () => {
  const a = await call('GET', `/pos-rentals/${b1.id}/agreement`, { token: tok.cashier });
  assert(/40,000.*up to TZS 400,000/.test(a.data?.amounts?.lateFeeText?.en) && /kwa kila siku kamili/.test(a.data?.amounts?.lateFeeText?.sw), JSON.stringify(a.data?.amounts?.lateFeeText));
});

const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
