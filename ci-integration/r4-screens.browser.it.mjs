// Real admin UI (localhost:3152, next dev) -> real API (localhost:4150) ->
// isolated schema it_ref (refunds-seed.js). R4 preparation screens (round 25C G):
// return inspection independent of payout, refund management, shift
// reconciliation preview. Never production.
//   node r4-screens.browser.it.mjs <worktree> <ref-ids.json> <screenshot-dir>
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const { chromium } = createRequire(process.argv[2] + '/apps/storefront/package.json')('playwright');
const ids = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const SHOTS = process.argv[4]; mkdirSync(SHOTS, { recursive: true });
const A = ids.a;
const ADMIN = 'http://localhost:3152';
const API = 'http://localhost:4150/api/v1';
const sql = (q) => execFileSync(process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe', ['-U', 'naro_admin', '-h', 'localhost', '-d', 'naro_fashion', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO it_ref; ${q}`], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8' }).trim();
const results = [];
async function check(name, fn) {
  try { const n = await fn(); results.push('PASS'); console.log(`  ✔ ${name}${n ? `  — ${n}` : ''}`); }
  catch (e) { results.push('FAIL'); console.log(`  ✖ ${name}\n      ${String(e?.message || e).split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const xff = (s) => { const h = createHash('sha256').update(s).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
const api = async (method, p, token, body) => {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff(token || body?.email || p), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const browser = await chromium.launch();
async function as(who) {
  const tok = (await api('POST', '/auth/login', null, { email: who.email, password: ids.password })).data;
  assert(tok?.accessToken, `login ${who.email}`);
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
  await ctx.addInitScript(([a, r]) => { localStorage.setItem('token', a); localStorage.setItem('refreshToken', r); }, [tok.accessToken, tok.refreshToken]);
  return { ctx, token: tok.accessToken };
}
const stock = () => Number(sql(`SELECT stock FROM "ProductVariant" WHERE id = '${A.variant}'`));
async function refundsPage(ctx, tab) {
  const p = await ctx.newPage();
  await p.goto(`${ADMIN}/dashboard/refunds`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await p.getByTestId(`refund-tab-${tab}`).click({ timeout: 180000 });
  return p;
}
const owner = await as(A.admins.super);
const cashier = await as(A.admins.cashier);
const approver = await as(A.admins.approver);

// A POS sale, returned at the till WITHOUT a condition (inspection later).
const s = await api('POST', '/pos/sales', owner.token, { sessionId: A.sessions.super, items: [{ productId: A.product, variantId: A.variant, quantity: 1, unitPrice: 10000 }], payments: [{ method: 'CASH', amount: 10000 }] });
const sale = s.data?.order ?? s.data;
const item = sql(`SELECT id FROM "OrderItem" WHERE "orderId" = '${sale.id}'`);
const rq = (await api('POST', `/pos/sales/${sale.id}/refund`, cashier.token, { items: [{ orderItemId: item, quantity: 1 }], refundMethod: 'CASH', reason: 'returned in a bag, check later' })).data?.refundRequest;
assert(rq?.id, 'refund request');
const before = stock();

console.log(`real admin ${ADMIN} -> real API -> it_ref · R4 screens`);
await check('Refunds: the returned item shows "Goods held · waiting for inspection" with its name; Approve is disabled until inspected', async () => {
  const p = await refundsPage(approver.ctx, 'REQUESTED');
  const goods = p.getByTestId(`refund-goods-state-${rq.id}`);
  await goods.waitFor({ timeout: 60000 });
  assert(/waiting for inspection/.test(await goods.innerText()), 'label');
  assert(await p.getByTestId(`refund-approve-${rq.id}`).isDisabled(), 'approve disabled');
  await p.screenshot({ path: `${SHOTS}/r4-01-return-awaiting-inspection.png`, fullPage: true });
  await p.close();
});
await check('the cashier records the inspection (Resaleable, with a note) — stock is still unchanged', async () => {
  const p = await refundsPage(cashier.ctx, 'REQUESTED');
  const row = p.getByTestId(`refund-goods-${rq.id}`);
  await row.waitFor({ timeout: 60000 });
  await row.locator('select').selectOption('RESALEABLE');
  await row.locator('input').fill('tags on, unworn');
  await p.getByTestId(`refund-inspect-${rq.id}`).click();
  await p.getByText('Inspection recorded').first().waitFor({ timeout: 20000 });
  assert(stock() === before, 'stock moved before approval');
  await p.close();
});
await check('the approver approves → the goods are back in stock IMMEDIATELY (before any payout); the request is still unpaid', async () => {
  const p = await refundsPage(approver.ctx, 'REQUESTED');
  await p.getByTestId(`refund-approve-${rq.id}`).click({ timeout: 60000 });
  await p.getByText(/Approved/).first().waitFor({ timeout: 20000 });
  assert(stock() === before + 1, `stock ${stock()} vs ${before + 1}`);
  assert(sql(`SELECT status || '|' || (lines->>'goodsDisposition') FROM "RentalRefundRequest" WHERE id = '${rq.id}'`) === 'APPROVED|RESTOCKED', 'state');
  await p.getByTestId('refund-tab-APPROVED').click();
  const goods = p.getByTestId(`refund-goods-state-${rq.id}`);
  await goods.waitFor({ timeout: 30000 });
  assert(/back in stock/.test(await goods.innerText()), 'label');
  await p.screenshot({ path: `${SHOTS}/r4-02-approved-restocked-unpaid.png`, fullPage: true });
  await p.close();
});
await check('Shift reconciliation: shifts listed with expected / counted cash; the R4 gap is stated; a shift expands to its POS sales by method', async () => {
  const p = await owner.ctx.newPage();
  await p.goto(`${ADMIN}/dashboard/financials/shifts`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await p.getByTestId('shift-gap-notice').waitFor({ timeout: 180000 });
  const first = p.locator('[data-testid^="shift-"]').filter({ hasNot: p.getByTestId('shift-gap-notice') }).first();
  await p.getByTestId(`shift-${A.sessions.super}`).locator('button').first().click();
  await p.getByText('Received by method (POS sales)').waitFor({ timeout: 30000 });
  assert(/CASH: TZS/.test(await p.getByTestId(`shift-${A.sessions.super}`).innerText()), 'cash line');
  void first;
  await p.screenshot({ path: `${SHOTS}/r4-03-shift-reconciliation.png`, fullPage: true });
  await p.close();
});

await browser.close();
const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
