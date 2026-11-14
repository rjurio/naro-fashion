// Round 25F E (PR): real admin UI (next dev) -> real API -> isolated schema
// seeded by approvals-seed.js (approvals.it.mjs may run before; this suite
// creates its own requests). Admin → Stock & payment approvals:
//  - a stock write-off requested by one person is approved by ANOTHER in the UI;
//  - on your OWN request the Approve / Reject buttons are not offered (only
//    Withdraw) — SUPER_ADMIN included — and the server refuses it anyway;
//  - a payment reversal requested by one reverser is approved in the UI by the other.
// Never production.
//   IT_ADMIN=http://localhost:3197 IT_API=http://localhost:4196/api/v1 IT_SCHEMA=it_appr \
//     node approvals.browser.it.mjs <worktree> <ids.json>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
const { chromium } = createRequire(process.argv[2] + '/apps/storefront/package.json')('playwright');
const ids = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const ADMIN = (process.env.IT_ADMIN || 'http://localhost:3197').replace(/\/$/, '');
const API = (process.env.IT_API || 'http://localhost:4196/api/v1').replace(/\/$/, '');
const SCHEMA = process.env.IT_SCHEMA || 'it_e';
const HOST = process.env.PGHOST || 'localhost';
if (!/^(localhost|127\.0\.0\.1)$/.test(HOST)) throw new Error('refusing: local/CI database only');
const T = ids.tenantId, C = ids.clutch;
const sql = (q) => execFileSync(process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe', ['-U', 'naro_admin', '-h', HOST, '-d', 'naro_fashion', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO ${SCHEMA}`, '-c', q], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8' }).trim();
const results = [];
async function check(name, fn) {
  try { const n = await fn(); results.push('PASS'); console.log(`  ✔ ${name}${n ? `  — ${n}` : ''}`); }
  catch (e) { results.push('FAIL'); console.log(`  ✖ ${name}\n      ${String(e?.message || e).split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const xff = (s) => { const h = createHash('sha256').update(String(s)).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
async function call(method, p, { token, body } = {}) {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': T, 'X-Forwarded-For': xff(token || randomBytes(4).toString('hex')), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
}
const tokens = {};
async function login(who) {
  const r = await call('POST', '/auth/login', { body: { email: who.email, password: who.password } });
  assert(r.data?.accessToken, `login ${who.email} ${r.status}`);
  return r.data;
}
const browser = await chromium.launch();
async function as(key) {
  const t = await login(ids.admins[key]);
  tokens[key] = t.accessToken;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript(([a, r]) => { localStorage.setItem('token', a); localStorage.setItem('refreshToken', r); }, [t.accessToken, t.refreshToken]);
  return ctx;
}
async function approvals(ctx, waitFor) {
  const p = await ctx.newPage();
  await p.goto(`${ADMIN}/dashboard/approvals`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await p.getByText('Stock & payment approvals').first().waitFor({ timeout: 180000 });
  if (waitFor) await p.getByTestId(waitFor).waitFor({ timeout: 60000 });
  return p;
}
const stock = () => Number(sql(`SELECT stock FROM "ProductVariant" WHERE id = '${C.variantId}'`));

const stocker = await as('stocker');
const approver = await as('stockApprover');
const owner = await as('super');
const reverser = await as('reverser');
const reverser2 = await as('reverser2');
const cashierTok = (await login(ids.admins.cashier)).accessToken;

console.log(`real admin ${ADMIN} -> real API ${API} -> ${SCHEMA}`);
let reqA;
await check('a stocker\'s write-off waits in the queue; on the stocker\'s own page the row offers only "Withdraw" (no Approve / Reject)', async () => {
  const r = await call('POST', '/inventory/adjust', { token: tokens.stocker, body: { productId: C.id, variantId: C.variantId, type: 'DAMAGE', quantity: 1, note: 'browser check: torn lining' } });
  assert(r.data?.status === 'PENDING_APPROVAL', `request ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  reqA = r.data.request.id;
  const p = await approvals(stocker);
  // the stocker has no inventory:approve: the stock queue is hidden entirely, or shown without decide buttons
  const section = await p.getByTestId('stock-approvals').count();
  if (section) {
    await p.getByTestId(`stock-request-${reqA}`).waitFor({ timeout: 60000 });
    assert((await p.getByTestId(`stock-approve-${reqA}`).count()) === 0, 'approve button offered on own request');
    assert((await p.getByTestId(`stock-withdraw-${reqA}`).count()) === 1, 'withdraw missing');
  }
  await p.close();
  return section ? 'own row: withdraw only' : 'queue hidden (no inventory:approve)';
});
await check('a DIFFERENT approver approves it in the UI: stock reduced once, request APPLIED, ledger row names the requester', async () => {
  const before = stock();
  const p = await approvals(approver, `stock-request-${reqA}`);
  assert((await p.getByTestId(`stock-withdraw-${reqA}`).count()) === 0, 'withdraw offered on someone else\'s request');
  await p.getByTestId(`stock-approve-${reqA}`).click();
  await p.getByText('Applied').first().waitFor({ timeout: 30000 });
  await p.getByTestId(`stock-request-${reqA}`).waitFor({ state: 'detached', timeout: 30000 });
  await p.close();
  assert(sql(`SELECT status FROM "InventoryAdjustmentRequest" WHERE id = '${reqA}'`) === 'APPLIED', 'not APPLIED');
  assert(stock() === before - 1, `stock ${before} -> ${stock()}`);
  assert(sql(`SELECT "performedBy" FROM "InventoryTransaction" WHERE reference = 'ADJ-REQ:${reqA}'`) === ids.admins.stocker.id, 'ledger requester');
});
await check('SUPER_ADMIN\'s own write-off: their page offers no Approve (only Withdraw); a forced approve is refused (403 SELF_APPROVAL); nothing written', async () => {
  const r = await call('POST', '/inventory/adjust', { token: tokens.super, body: { productId: C.id, variantId: C.variantId, type: 'DAMAGE', quantity: 1, note: 'browser check: owner write-off' } });
  assert(r.data?.status === 'PENDING_APPROVAL', `request ${r.status}`);
  const id = r.data.request.id;
  const before = stock();
  const p = await approvals(owner, `stock-request-${id}`);
  assert((await p.getByTestId(`stock-approve-${id}`).count()) === 0, 'approve button offered to the requester');
  assert((await p.getByTestId(`stock-own-${id}`).count()) === 1, 'own-request note missing');
  await p.close();
  const forced = await call('PATCH', `/inventory/adjustment-requests/${id}/approve`, { token: tokens.super, body: {} });
  assert(forced.status === 403 && forced.data?.code === 'SELF_APPROVAL', `forced ${forced.status} ${forced.data?.code}`);
  assert(stock() === before, 'stock changed');
  // the approver sees it with the decide buttons; the owner withdraws it in the UI
  const pa = await approvals(approver, `stock-request-${id}`);
  assert((await pa.getByTestId(`stock-approve-${id}`).count()) === 1, 'approver has no approve button');
  await pa.close();
  const po = await approvals(owner, `stock-request-${id}`);
  await po.getByTestId(`stock-withdraw-${id}`).click();
  await po.getByTestId(`stock-request-${id}`).waitFor({ state: 'detached', timeout: 30000 });
  await po.close();
  assert(sql(`SELECT status FROM "InventoryAdjustmentRequest" WHERE id = '${id}'`) === 'WITHDRAWN', 'not WITHDRAWN');
});
await check('payment reversal: the requester sees only "Withdraw"; the other reverser approves in the UI → payment REVERSED once', async () => {
  const sale = await call('POST', '/pos/sales', { token: cashierTok, body: { items: [{ productId: C.id, variantId: C.variantId, quantity: 1, unitPrice: 30000 }], payments: [{ method: 'CARD', amount: 30000, transactionRef: 'RRN' + randomBytes(4).toString('hex').toUpperCase(), approvalCode: 'AP' + randomBytes(3).toString('hex').toUpperCase() }] } });
  assert(sale.status === 201, `sale ${sale.status} ${JSON.stringify(sale.data).slice(0, 160)}`);
  const orderId = sale.data?.id ?? sale.data?.order?.id;
  const paymentId = sql(`SELECT id FROM "Payment" WHERE "orderId" = '${orderId}' AND method = 'CARD'`);
  const r = await call('POST', `/pos/payments/${paymentId}/reverse`, { token: tokens.reverser, body: { reason: 'browser check: not on the settlement report' } });
  assert(r.data?.status === 'PENDING_APPROVAL', `request ${r.status}`);
  const id = r.data.request.id;
  const p = await approvals(reverser, `reversal-request-${id}`);
  assert((await p.getByTestId(`reversal-approve-${id}`).count()) === 0, 'approve offered to the requester');
  assert((await p.getByTestId(`reversal-withdraw-${id}`).count()) === 1, 'withdraw missing');
  await p.close();
  const p2 = await approvals(reverser2, `reversal-request-${id}`);
  await p2.getByTestId(`reversal-approve-${id}`).click();
  await p2.getByText('Reversed').first().waitFor({ timeout: 30000 });
  await p2.close();
  assert(sql(`SELECT status FROM "Payment" WHERE id = '${paymentId}'`) === 'REVERSED', 'payment not reversed');
  assert(sql(`SELECT status || '|' || "decidedById" FROM "PaymentReversalRequest" WHERE id = '${id}'`) === `EXECUTED|${ids.admins.reverser2.id}`, 'request state');
});

await browser.close();
const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
