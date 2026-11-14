// Real admin UI (localhost:3152, next dev) -> real API (localhost:4150) ->
// isolated schema it_ref, AFTER refunds.it.mjs ran (it leaves an exchange
// refund request REQUESTED, requested by the shop's SUPER_ADMIN). Admin →
// Refunds: self-approval refused, independent approval, payout refused /
// accepted, labels. Never production.
//   node refunds.browser.it.mjs <worktree> <ref-ids.json>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const { chromium } = createRequire(process.argv[2] + '/apps/storefront/package.json')('playwright');
const ids = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const A = ids.a;
const ADMIN = 'http://localhost:3152';
const API = 'http://localhost:4150/api/v1';
const sql = (q) => execFileSync(process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe', ['-U', 'naro_admin', '-h', 'localhost', '-d', 'naro_fashion', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO it_ref; ${q}`], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8' }).trim();
const results = [];
async function check(name, fn) {
  try { const n = await fn(); results.push('PASS'); console.log(`  ✔ ${name}${n ? `  — ${n}` : ''}`); }
  catch (e) { results.push('FAIL'); console.log(`  ✖ ${name}\n      ${String(e?.message || e).split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const xff = (s) => { const h = createHash('sha256').update(s).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
const browser = await chromium.launch();
async function as(who) {
  const tok = await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff(who.email) }, body: JSON.stringify({ email: who.email, password: ids.password }) })).json();
  assert(tok?.accessToken, `login ${who.email}`);
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
const ex = sql(`SELECT id FROM "RentalRefundRequest" WHERE kind = 'EXCHANGE_DIFFERENCE' AND status = 'REQUESTED' LIMIT 1`);
assert(ex, 'run refunds.it.mjs first (exchange request)');
const owner = await as(A.admins.super);
const approver = await as(A.admins.approver);
const finance = await as(A.admins.finance);

console.log(`real admin ${ADMIN} -> real API -> it_ref`);
await check('the request shows as "refund due · waiting for approval" (never as refunded)', async () => {
  const p = await refunds(owner, 'REQUESTED');
  await p.getByTestId(`refund-row-${ex}`).waitFor();
  assert(/Refund due · waiting for approval/.test(await p.getByTestId(`refund-state-${ex}`).innerText()), 'label');
  await p.close();
});
await check('the person who requested it (SUPER_ADMIN) is refused when approving: message shown, still REQUESTED', async () => {
  const p = await refunds(owner, 'REQUESTED');
  await p.getByTestId(`refund-approve-${ex}`).click();
  await p.getByText(/different person than the one who requested it/).first().waitFor({ timeout: 30000 });
  assert(sql(`SELECT status FROM "RentalRefundRequest" WHERE id = '${ex}'`) === 'REQUESTED', 'changed');
  await p.close();
});
await check('the approver approves it: it moves to "To pay out" as "approved, not paid yet"', async () => {
  const p = await refunds(approver, 'REQUESTED');
  await p.getByTestId(`refund-approve-${ex}`).click();
  await p.getByText(/Approved: it can now be paid out/).first().waitFor({ timeout: 30000 });
  await p.getByTestId('refund-tab-APPROVED').click();
  await p.getByTestId(`refund-row-${ex}`).waitFor({ timeout: 30000 });
  assert(/approved, not paid yet/.test(await p.getByTestId(`refund-state-${ex}`).innerText()), 'label');
  await p.close();
});
await check('finance: cash with no open shift is refused (the drawer is closed); nothing paid', async () => {
  const p = await refunds(finance, 'APPROVED');
  await p.getByTestId(`refund-method-${ex}`).selectOption('CASH');
  await p.getByTestId(`refund-pay-${ex}`).click();
  await p.getByText(/OPEN POS shift/).first().waitFor({ timeout: 30000 });
  assert(sql(`SELECT status FROM "RentalRefundRequest" WHERE id = '${ex}'`) === 'APPROVED', 'not back to APPROVED');
  await p.close();
});
await check('finance: mobile money for a cash sale needs the reference AND an account-verification note; then "Paid out"', async () => {
  const p = await refunds(finance, 'APPROVED');
  await p.getByTestId(`refund-method-${ex}`).selectOption('MOBILE_MONEY');
  await p.getByTestId(`refund-ref-${ex}`).fill('MP-EX-0001');
  await p.getByTestId(`refund-pay-${ex}`).click();
  await p.getByText(/how the account was verified/).first().waitFor({ timeout: 30000 });
  await p.getByPlaceholder(/how you verified the account/).first().fill('Customer present, number shown in their M-Pesa app');
  await p.getByTestId(`refund-pay-${ex}`).click();
  await p.getByText(/Payout recorded/).first().waitFor({ timeout: 30000 });
  assert(sql(`SELECT status||'|'||"payoutReference" FROM "RentalRefundRequest" WHERE id = '${ex}'`) === 'PAID|MP-EX-0001', 'db');
  await p.getByTestId('refund-tab-PAID').click();
  await p.getByTestId(`refund-row-${ex}`).waitFor({ timeout: 30000 });
  assert(/Paid out/.test(await p.getByTestId(`refund-state-${ex}`).innerText()), 'label');
  await p.close();
});

await browser.close();
const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
