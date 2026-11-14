// refunds:payout in the real admin UI: Admin → Refunds, real API, isolated
// schema (default it_payb) seeded by refund-payout-seed.js (IT_SCHEMA=it_payb).
// Never production.
//   IT_ADMIN=http://localhost:3158 IT_API=http://localhost:4178/api/v1 IT_SCHEMA=it_payb \
//     node refund-payout.browser.it.mjs <worktree> <ids.json>
// Checks: a person holding ONLY refunds:payout sees an approved refund and
// records its payout; their Approve / Reject attempts are refused with a clear
// message and nothing changes; the requester (who also holds refunds:payout)
// can't pay out their own request.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
const { chromium } = createRequire(process.argv[2] + '/apps/storefront/package.json')('playwright');
const ids = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const A = ids.a, P = A.admins, T = A.tenantId;
const ADMIN = (process.env.IT_ADMIN || 'http://localhost:3158').replace(/\/$/, '');
const API = (process.env.IT_API || 'http://localhost:4178/api/v1').replace(/\/$/, '');
const SCHEMA = process.env.IT_SCHEMA || 'it_payb';
if (!/^http:\/\/localhost:/.test(API) || !/^http:\/\/localhost:/.test(ADMIN) || !/^it_[a-z0-9_]+$/.test(SCHEMA)) throw new Error('refusing: local only');
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/18/bin/psql.exe';
const sql = (q) => execFileSync(PSQL, ['-U', 'naro_admin', '-h', process.env.PGHOST || 'localhost', '-d', 'naro_fashion', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO ${SCHEMA}`, '-c', q],
  { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8' }).replace(/\r/g, '').trim();
const results = [];
async function check(name, fn) {
  try { const n = await fn(); results.push('PASS'); console.log(`  ✔ ${name}${n ? `  — ${n}` : ''}`); }
  catch (e) { results.push('FAIL'); console.log(`  ✖ ${name}\n      ${String(e?.message || e).split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const xff = (s) => { const h = createHash('sha256').update(s).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
const tokens = {};
async function login(who) {
  const r = await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff(who.email) }, body: JSON.stringify({ email: who.email, password: ids.password }) })).json();
  assert(r?.accessToken, `login ${who.email}`);
  return r;
}
async function api(method, p, who, body) {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': T, 'X-Forwarded-For': xff(who.email), Authorization: `Bearer ${tokens[who.email].accessToken}` }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
}
for (const k of ['cashier', 'manager', 'probe']) tokens[P[k].email] = await login(P[k]);
const status = (id) => sql(`SELECT status || '|' || COALESCE("paidById", '-') FROM "RentalRefundRequest" WHERE id = '${id}'`);

// Set-up through the API (the people of refund-payout-seed.js):
//  r1: cashier requests 10,000 on online order 1 → manager approves (the probe pays it in the UI)
//  r2: cashier requests 5,000 on online order 2, left REQUESTED (the probe tries to approve / reject it)
//  r3: cashier requests 5,000 on online order 1 → manager approves (the cashier, its requester, tries to pay it)
const req = async (orderId, amount, reason) => {
  const r = await api('POST', `/orders/${orderId}/refunds`, P.cashier, { amount, reason });
  assert(r.status === 201, `request ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  return r.data.refundRequest.id;
};
const r1 = await req(A.orders[0], 10000, 'browser: paid by the payout-only person');
const r2 = await req(A.orders[1], 5000, 'browser: approval attempt by the payout-only person');
const r3 = await req(A.orders[0], 5000, 'browser: the requester tries to pay');
for (const id of [r1, r3]) assert((await api('PATCH', `/refund-requests/${id}/approve`, P.manager, {})).status === 200, 'manager approves');

const browser = await chromium.launch();
async function as(who) {
  const tok = tokens[who.email];
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
  await ctx.addInitScript(([a, r]) => { localStorage.setItem('token', a); localStorage.setItem('refreshToken', r); }, [tok.accessToken, tok.refreshToken]);
  return ctx;
}
async function refunds(ctx, tab) {
  const p = await ctx.newPage();
  await p.goto(`${ADMIN}/dashboard/refunds`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await p.getByTestId(`refund-tab-${tab}`).waitFor({ timeout: 180000 });
  await p.getByTestId(`refund-tab-${tab}`).click();
  await p.waitForTimeout(1500);
  return p;
}
const probe = await as(P.probe);
const cashier = await as(P.cashier);

console.log(`real admin ${ADMIN} -> real API ${API} -> ${SCHEMA} · refunds:payout`);
await check('the payout-only person sees the approved refund under "To pay out" (approved, not paid yet)', async () => {
  const p = await refunds(probe, 'APPROVED');
  await p.getByTestId(`refund-row-${r1}`).waitFor({ timeout: 30000 });
  assert(/approved, not paid yet/.test(await p.getByTestId(`refund-state-${r1}`).innerText()), 'label');
  await p.close();
});
await check('approve attempt → refused with a clear message (permission needed: refunds:approve), still REQUESTED', async () => {
  const p = await refunds(probe, 'REQUESTED');
  await p.getByTestId(`refund-row-${r2}`).waitFor({ timeout: 30000 });
  await p.getByTestId(`refund-approve-${r2}`).click();
  await p.getByText(/You don't have permission to perform this action \(requires refunds:approve\)/).first().waitFor({ timeout: 30000 });
  assert(status(r2) === 'REQUESTED|-', `changed: ${status(r2)}`);
  await p.close();
});
await check('reject attempt → refused with a clear message, still REQUESTED', async () => {
  const p = await refunds(probe, 'REQUESTED');
  await p.getByTestId(`refund-note-${r2}`).fill('not a valid refund');
  await p.getByTestId(`refund-reject-${r2}`).click();
  await p.getByText(/You don't have permission to perform this action \(requires refunds:approve\)/).first().waitFor({ timeout: 30000 });
  assert(status(r2) === 'REQUESTED|-', `changed: ${status(r2)}`);
  await p.close();
});
await check('the requester (cashier, also holding refunds:payout) cannot pay out their own request: message shown, still APPROVED', async () => {
  const p = await refunds(cashier, 'APPROVED');
  await p.getByTestId(`refund-row-${r3}`).waitFor({ timeout: 30000 });
  await p.getByTestId(`refund-method-${r3}`).selectOption('MOBILE_MONEY');
  await p.getByTestId(`refund-ref-${r3}`).fill(`BR${randomBytes(4).toString('hex').toUpperCase()}`);
  await p.getByTestId(`refund-pay-${r3}`).click();
  await p.getByText(/The person who requested a refund cannot also pay it out/).first().waitFor({ timeout: 30000 });
  assert(status(r3) === 'APPROVED|-', `changed: ${status(r3)}`);
  await p.close();
});
await check('the payout-only person records the payout (mobile money + reference): "Payout recorded", PAID by them, one linked payout row', async () => {
  const p = await refunds(probe, 'APPROVED');
  const rr = `BR${randomBytes(4).toString('hex').toUpperCase()}`;
  await p.getByTestId(`refund-method-${r1}`).selectOption('MOBILE_MONEY');
  await p.getByTestId(`refund-ref-${r1}`).fill(rr);
  await p.getByTestId(`refund-pay-${r1}`).click();
  await p.getByText(/Payout recorded/).first().waitFor({ timeout: 30000 });
  assert(status(r1) === `PAID|${P.probe.id}`, `db: ${status(r1)}`);
  assert(sql(`SELECT count(*) || '|' || min("transactionRef") FROM "Payment" WHERE "refundRequestId" = '${r1}' AND status = 'REFUNDED'`) === `1|${rr}`, 'payout row');
  await p.getByTestId('refund-tab-PAID').click();
  await p.getByTestId(`refund-row-${r1}`).waitFor({ timeout: 30000 });
  assert(/Paid out/.test(await p.getByTestId(`refund-state-${r1}`).innerText()), 'label');
  await p.close();
});

await browser.close();
const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
