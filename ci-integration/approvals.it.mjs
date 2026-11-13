// Round 25F E: independent approval for stock write-offs / decreases and
// payment reversals; independent review of manual non-cash confirmations.
// Real API + real Postgres, isolated schema (default it_e) seeded by the it_e
// copy of shift-reconciliation-seed.js (+ stocker / stock approvers / reversers).
// Never production.
//   IT_API=http://localhost:4195/api/v1 IT_SCHEMA=it_e [PSQL=..] node approvals.it.mjs <ids.json>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const ids = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const API = (process.env.IT_API || 'http://localhost:4195/api/v1').replace(/\/$/, '');
const SCHEMA = process.env.IT_SCHEMA || 'it_e';
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe';
const HOST = process.env.PGHOST || 'localhost';
if (!/^(localhost|127\.0\.0\.1)$/.test(HOST)) throw new Error('refusing: local/CI database only');
const T = ids.tenantId, C = ids.clutch;
const sql = (q) => execFileSync(PSQL, ['-U', 'naro_admin', '-h', HOST, '-d', 'naro_fashion', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO ${SCHEMA}`, '-c', q], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sqlErr = (q) => { try { sql(q); return null; } catch (e) { return String(e.stderr || e.message); } };
const ip = (s) => { const h = createHash('sha256').update(String(s)).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
async function call(method, p, { token, body, tenant = T } = {}) {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenant, 'X-Forwarded-For': ip(token || body?.email || randomBytes(4).toString('hex')), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
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
const login = async (w, tenant) => { const r = await call('POST', '/auth/login', { body: { email: w.email, password: w.password }, tenant }); assert(r.data?.accessToken, `login ${w.email} ${r.status}`); return r.data.accessToken; };
const tok = {};
for (const k of ['super', 'cashier', 'counter', 'stocker', 'stockApprover', 'stockApprover2', 'reverser', 'reverser2', 'finance']) tok[k] = await login(ids.admins[k]);
if (ids.otherShop?.approver) tok.approverB = await login(ids.otherShop.approver, ids.otherShop.tenantId);
const stock = () => Number(sql(`SELECT stock FROM "ProductVariant" WHERE id = '${C.variantId}'`));
const adjust = (token, body) => call('POST', '/inventory/adjust', { token, body: { productId: C.id, variantId: C.variantId, ...body } });
const approveAdj = (id, token) => call('PATCH', `/inventory/adjustment-requests/${id}/approve`, { token, body: {} });

console.log(`real API ${API} · isolated schema ${SCHEMA} · stock and payment approvals (round 25F E)`);

console.log('\n1. stock write-offs and decreases');
let req1;
await check('no threshold set: a write-off becomes a REQUEST — nothing written; a person without inventory:manage is refused (403)', async () => {
  const before = stock();
  eq((await adjust(tok.cashier, { type: 'DAMAGE', quantity: 1, note: 'scratched clasp' })).status, 403, 'cashier');
  const r = await adjust(tok.stocker, { type: 'DAMAGE', quantity: 2, note: 'water damage in storage' });
  eq([r.status, r.data?.status, r.data?.reason], [201, 'PENDING_APPROVAL', 'NO_THRESHOLD_SET'], 'pending');
  eq(stock(), before, 'unchanged');
  req1 = r.data.request.id;
  eq(sql(`SELECT (details->>'stockBefore') || '|' || (details->>'stockAfterIfApproved') || '|' || "adminUserId" FROM "AdminActivityLog" WHERE action = 'INVENTORY_ADJUSTMENT_REQUESTED' AND details->>'requestId' = '${req1}'`), `${before}|${before - 2}|${ids.admins.stocker.id}`, 'request audited');
  return `stock ${before}`;
});
await check('the requester cannot approve it; nor can a SUPER_ADMIN approve their own request (403 SELF_APPROVAL)', async () => {
  eq([(await approveAdj(req1, tok.stocker)).status], [403], 'stocker has no inventory:approve');
  const own = await adjust(tok.super, { type: 'DAMAGE', quantity: 1, note: 'super admin own write-off' });
  const self = await approveAdj(own.data.request.id, tok.super);
  eq([self.status, self.data?.code], [403, 'SELF_APPROVAL'], 'super self');
  eq((await call('PATCH', `/inventory/adjustment-requests/${own.data.request.id}/withdraw`, { token: tok.super })).status, 200, 'withdrawn');
});
await check('a different approver applies it: stock reduced once, ledger row (before / after, requester, ADJ-REQ ref) + audit with before / after', async () => {
  const before = stock();
  const r = await approveAdj(req1, tok.stockApprover);
  eq([r.status, r.data?.status], [200, 'APPLIED'], 'applied');
  eq(stock(), before - 2, 'stock');
  eq(sql(`SELECT type || '|' || "quantityBefore" || '|' || "quantityAfter" || '|' || "performedBy" FROM "InventoryTransaction" WHERE reference = 'ADJ-REQ:${req1}'`), `DAMAGE|${before}|${before - 2}|${ids.admins.stocker.id}`, 'ledger');
  eq(sql(`SELECT (details->>'quantityBefore') || '|' || (details->>'quantityAfter') || '|' || "adminUserId" FROM "AdminActivityLog" WHERE action = 'INVENTORY_ADJUSTMENT_APPROVED' AND details->>'requestId' = '${req1}'`), `${before}|${before - 2}|${ids.admins.stockApprover.id}`, 'audit');
});
await check('two approvers at once → exactly one applies it', async () => {
  const before = stock();
  const r = await adjust(tok.stocker, { type: 'DAMAGE', quantity: 1, note: 'torn lining, not repairable' });
  const rs = await Promise.all([approveAdj(r.data.request.id, tok.stockApprover), approveAdj(r.data.request.id, tok.stockApprover2)]);
  eq(rs.map((x) => x.status).sort(), [200, 409], 'one wins');
  eq(stock(), before - 1, 'applied once');
  eq(sql(`SELECT count(*) FROM "InventoryTransaction" WHERE reference = 'ADJ-REQ:${r.data.request.id}'`), '1', 'one ledger row');
});
await check('stock moved since the request (a restock) → approval refused (409 STOCK_CHANGED), request STALE, nothing written', async () => {
  const r = await adjust(tok.stocker, { type: 'ADJUSTMENT', direction: 'DECREASE', quantity: 3, note: 'recount found three fewer' });
  eq(r.data?.status, 'PENDING_APPROVAL', 'pending');
  const restock = await adjust(tok.stocker, { type: 'RESTOCK', quantity: 1, note: 'supplier delivery' });
  eq([restock.status, restock.data?.quantityChange], [201, 1], 'restock is one step');
  const before = stock();
  const a = await approveAdj(r.data.request.id, tok.stockApprover);
  eq([a.status, a.data?.code], [409, 'STOCK_CHANGED'], 'stale');
  eq([stock(), sql(`SELECT status FROM "InventoryAdjustmentRequest" WHERE id = '${r.data.request.id}'`)], [before, 'STALE'], 'unchanged + STALE');
});
await check('owner threshold (settings:manage only): a decrease within it is one step; above it still needs approval; the stocker cannot change it', async () => {
  eq((await call('PUT', '/inventory/approval-thresholds', { token: tok.stocker, body: { maxUnits: 100 } })).status, 403, 'stocker');
  eq((await call('PUT', '/inventory/approval-thresholds', { token: tok.super, body: { maxUnits: 1 } })).data, { maxUnits: 1, maxPct: null }, 'set');
  const before = stock();
  const small = await adjust(tok.stocker, { type: 'ADJUSTMENT', direction: 'DECREASE', quantity: 1, note: 'recount found one fewer' });
  eq([small.status, small.data?.quantityAfter, stock()], [201, before - 1, before - 1], 'one step');
  const big = await adjust(tok.stocker, { type: 'DAMAGE', quantity: 2, note: 'two damaged in transit' });
  eq([big.data?.status, big.data?.reason], ['PENDING_APPROVAL', 'OVER_UNIT_THRESHOLD'], 'above threshold');
  eq((await call('PUT', '/inventory/approval-thresholds', { token: tok.super, body: { maxUnits: null } })).data, { maxUnits: null, maxPct: null }, 'cleared');
  eq(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action = 'INVENTORY_APPROVAL_THRESHOLDS_CHANGED'`), '2', 'audited');
});

await check('shop isolation: shop B\'s approver can neither list nor approve shop A\'s stock request (404 / refused), with either shop header', async () => {
  if (!tok.approverB) return 'skipped (seed without shop B approver)';
  const r = await adjust(tok.stocker, { type: 'DAMAGE', quantity: 1, note: 'shop isolation probe' });
  eq(r.data?.status, 'PENDING_APPROVAL', 'pending');
  const own = await call('PATCH', `/inventory/adjustment-requests/${r.data.request.id}/approve`, { token: tok.approverB, body: {}, tenant: ids.otherShop.tenantId });
  eq(own.status, 404, 'own header');
  const cross = await call('PATCH', `/inventory/adjustment-requests/${r.data.request.id}/approve`, { token: tok.approverB, body: {}, tenant: T });
  assert([403, 404].includes(cross.status), `cross header ${cross.status}`);
  const list = await call('GET', '/inventory/adjustment-requests', { token: tok.approverB, tenant: ids.otherShop.tenantId });
  assert(!(list.data ?? []).some((x) => x.id === r.data.request.id), 'listed in shop B');
  eq(sql(`SELECT status FROM "InventoryAdjustmentRequest" WHERE id = '${r.data.request.id}'`), 'REQUESTED', 'untouched');
  eq((await call('PATCH', `/inventory/adjustment-requests/${r.data.request.id}/withdraw`, { token: tok.stocker })).status, 200, 'withdrawn');
});
await check('no existing role was granted the new code: system MANAGER / STAFF rows hold no inventory:approve; only the seeded test approver roles do', async () => {
  const sys = sql(`SELECT coalesce(string_agg(r.name, ',' ORDER BY r.name), '') FROM "RolePermission" rp JOIN "Role" r ON r.id = rp."roleId" JOIN "Permission" p ON p.id = rp."permissionId" WHERE p.code = 'inventory:approve' AND r."isSystem" AND r.name IN ('MANAGER', 'STAFF')`);
  eq(sys, '', 'MANAGER / STAFF');
  const superRow = sql(`SELECT count(*) FROM "RolePermission" rp JOIN "Role" r ON r.id = rp."roleId" JOIN "Permission" p ON p.id = rp."permissionId" WHERE p.code = 'inventory:approve' AND r."isSystem" AND r.name = 'SUPER_ADMIN'`);
  return `system SUPER_ADMIN row on this FRESH database: ${superRow} (seeded at first boot only; existing databases get none)`;
});

console.log('\n2. payment reversals');
async function cardSale(token, ref) {
  const s = await call('POST', '/pos/sales', { token, body: { items: [{ productId: C.id, variantId: C.variantId, quantity: 1, unitPrice: 30000 }], payments: [{ method: 'CARD', amount: 30000, transactionRef: ref, approvalCode: 'AP' + randomBytes(3).toString('hex').toUpperCase() }] } });
  assert(s.status === 201, `sale ${s.status} ${JSON.stringify(s.data).slice(0, 160)}`);
  const orderId = s.data?.id ?? s.data?.order?.id;
  return { orderId, paymentId: sql(`SELECT id FROM "Payment" WHERE "orderId" = '${orderId}' AND method = 'CARD'`) };
}
let sale1;
await check('the reversal route only REQUESTS: the payment stays COMPLETED; a second open request for it is refused', async () => {
  sale1 = await cardSale(tok.cashier, 'RRN' + randomBytes(4).toString('hex').toUpperCase());
  const r = await call('POST', `/pos/payments/${sale1.paymentId}/reverse`, { token: tok.reverser, body: { reason: 'Not on the terminal settlement report' } });
  eq([r.status, r.data?.status], [201, 'PENDING_APPROVAL'], 'requested');
  eq(sql(`SELECT status FROM "Payment" WHERE id = '${sale1.paymentId}'`), 'COMPLETED', 'unchanged');
  const again = await call('POST', `/pos/payments/${sale1.paymentId}/reverse`, { token: tok.reverser2, body: { reason: 'same payment again please' } });
  eq([again.status, again.data?.code], [409, 'REVERSAL_ALREADY_REQUESTED'], 'one open request');
  sale1.requestId = r.data.request.id;
});
await check('the requester cannot approve (403 SELF_APPROVAL); two different approvers at once → exactly one reversal; order flagged; requester + approver recorded', async () => {
  const self = await call('PATCH', `/pos/reversal-requests/${sale1.requestId}/approve`, { token: tok.reverser, body: {} });
  eq([self.status, self.data?.code], [403, 'SELF_APPROVAL'], 'self');
  const rs = await Promise.all([
    call('PATCH', `/pos/reversal-requests/${sale1.requestId}/approve`, { token: tok.reverser2, body: {} }),
    call('PATCH', `/pos/reversal-requests/${sale1.requestId}/approve`, { token: tok.super, body: {} }),
  ]);
  eq(rs.map((x) => x.status).sort(), [200, 409], 'one wins');
  eq(sql(`SELECT p.status || '|' || o."paymentStatus" FROM "Payment" p JOIN "Order" o ON o.id = p."orderId" WHERE p.id = '${sale1.paymentId}'`), 'REVERSED|PAYMENT_REVERSED', 'reversed');
  eq(sql(`SELECT ("gatewayResponse"->'reversal'->>'requestedByAdminId') = '${ids.admins.reverser.id}' FROM "Payment" WHERE id = '${sale1.paymentId}'`), 't', 'requester on the row');
  eq(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action = 'PAYMENT_REVERSED' AND "entityId" = '${sale1.paymentId}'`), '1', 'audited once');
});
await check('a person without payments:reverse can neither request nor approve (403)', async () => {
  const s = await cardSale(tok.cashier, 'RRN' + randomBytes(4).toString('hex').toUpperCase());
  eq((await call('POST', `/pos/payments/${s.paymentId}/reverse`, { token: tok.cashier, body: { reason: 'customer complained' } })).status, 403, 'cashier');
  eq((await call('POST', `/pos/payments/${s.paymentId}/reverse`, { token: tok.stockApprover, body: { reason: 'customer complained' } })).status, 403, 'stock approver');
});

await check('an already-reversed payment can\'t be requested again (409)', async () => {
  const again = await call('POST', `/pos/payments/${sale1.paymentId}/reverse`, { token: tok.reverser2, body: { reason: 'reverse it once more please' } });
  eq(again.status, 409, `already reversed ${JSON.stringify(again.data).slice(0, 120)}`);
});
await check('a request expires after 48 h: approving an expired request → 409 REVERSAL_EXPIRED, request EXPIRED, payment COMPLETED', async () => {
  const s = await cardSale(tok.cashier, 'RRN' + randomBytes(4).toString('hex').toUpperCase());
  const r = await call('POST', `/pos/payments/${s.paymentId}/reverse`, { token: tok.reverser, body: { reason: 'Not on the terminal settlement report' } });
  eq(r.status, 201, 'requested');
  const hours = Number(sql(`SELECT round(extract(epoch FROM ("expiresAt" - "createdAt")) / 3600) FROM "PaymentReversalRequest" WHERE id = '${r.data.request.id}'`));
  eq(hours, 48, 'expiry window');
  sql(`UPDATE "PaymentReversalRequest" SET "expiresAt" = (now() AT TIME ZONE 'UTC') - interval '1 minute' WHERE id = '${r.data.request.id}'`);
  const a = await call('PATCH', `/pos/reversal-requests/${r.data.request.id}/approve`, { token: tok.reverser2, body: {} });
  eq([a.status, a.data?.code], [409, 'REVERSAL_EXPIRED'], 'expired');
  eq(sql(`SELECT r.status || '|' || p.status FROM "PaymentReversalRequest" r JOIN "Payment" p ON p.id = r."paymentId" WHERE r.id = '${r.data.request.id}'`), 'EXPIRED|COMPLETED', 'state');
  const fresh = await call('POST', `/pos/payments/${s.paymentId}/reverse`, { token: tok.reverser, body: { reason: 'Still not on the settlement report' } });
  eq(fresh.status, 201, 'a new request is possible after expiry');
  eq((await call('PATCH', `/pos/reversal-requests/${fresh.data.request.id}/withdraw`, { token: tok.reverser })).status, 200, 'withdrawn');
});
await check('a sale that already has a refund (requested or paid) can\'t be reversed: request → 409 HAS_REFUNDS; a refund raised after the request blocks the approval too', async () => {
  const s = await cardSale(tok.cashier, 'RRN' + randomBytes(4).toString('hex').toUpperCase());
  const r = await call('POST', `/pos/payments/${s.paymentId}/reverse`, { token: tok.reverser, body: { reason: 'Not on the terminal settlement report' } });
  eq(r.status, 201, 'requested before the refund');
  const refundId = 'it-appr-refund-' + randomBytes(4).toString('hex');
  sql(`INSERT INTO "RentalRefundRequest" (id, "tenantId", kind, amount, reason, status, "requestedById", subject, "orderId", "updatedAt") VALUES ('${refundId}', '${T}', 'OVERPAYMENT', 30000, 'customer returned it', 'REQUESTED', '${ids.admins.cashier.id}', 'POS_SALE', '${s.orderId}', now())`);
  const a = await call('PATCH', `/pos/reversal-requests/${r.data.request.id}/approve`, { token: tok.reverser2, body: {} });
  eq([a.status, a.data?.code], [409, 'HAS_REFUNDS'], 'approval blocked');
  eq(sql(`SELECT status FROM "Payment" WHERE id = '${s.paymentId}'`), 'COMPLETED', 'not reversed');
  eq((await call('PATCH', `/pos/reversal-requests/${r.data.request.id}/withdraw`, { token: tok.reverser })).status, 200, 'withdrawn');
  const again = await call('POST', `/pos/payments/${s.paymentId}/reverse`, { token: tok.reverser, body: { reason: 'Not on the terminal settlement report' } });
  eq([again.status, again.data?.code], [409, 'HAS_REFUNDS'], 'request blocked');
});
await check('shop isolation: shop B\'s reverser can\'t approve shop A\'s reversal request (404 / refused)', async () => {
  if (!tok.approverB) return 'skipped (seed without shop B approver)';
  const s = await cardSale(tok.cashier, 'RRN' + randomBytes(4).toString('hex').toUpperCase());
  const r = await call('POST', `/pos/payments/${s.paymentId}/reverse`, { token: tok.reverser, body: { reason: 'Not on the terminal settlement report' } });
  eq((await call('PATCH', `/pos/reversal-requests/${r.data.request.id}/approve`, { token: tok.approverB, body: {}, tenant: ids.otherShop.tenantId })).status, 404, 'own header');
  const cross = await call('PATCH', `/pos/reversal-requests/${r.data.request.id}/approve`, { token: tok.approverB, body: {}, tenant: T });
  assert([403, 404].includes(cross.status), `cross header ${cross.status}`);
  eq(sql(`SELECT status FROM "Payment" WHERE id = '${s.paymentId}'`), 'COMPLETED', 'untouched');
  eq((await call('PATCH', `/pos/reversal-requests/${r.data.request.id}/withdraw`, { token: tok.reverser })).status, 200, 'withdrawn');
});

console.log('\n3. manual confirmation review (detection; changes no money)');
await check('the queue lists manual card confirmations with who confirmed them; the confirmer can\'t review their own (403 SELF_REVIEW); another reviewer can, once', async () => {
  const s = await cardSale(tok.super, 'RRN' + randomBytes(4).toString('hex').toUpperCase());
  const q = await call('GET', '/pos/manual-confirmations?filter=UNREVIEWED', { token: tok.finance });
  const row = (q.data ?? []).find((x) => x.paymentId === s.paymentId);
  eq([q.status, row?.confirmedById], [200, ids.admins.super.id], 'queued');
  const self = await call('POST', `/pos/manual-confirmations/${s.paymentId}/review`, { token: tok.super, body: { outcome: 'OK' } });
  eq([self.status, self.data?.code], [403, 'SELF_REVIEW'], 'self');
  eq((await call('POST', `/pos/manual-confirmations/${s.paymentId}/review`, { token: tok.finance, body: { outcome: 'OK' } })).status, 201, 'reviewed');
  const again = await call('POST', `/pos/manual-confirmations/${s.paymentId}/review`, { token: tok.finance, body: { outcome: 'OK' } });
  eq([again.status, again.data?.code], [409, 'ALREADY_REVIEWED'], 'once');
  eq(sql(`SELECT status FROM "Payment" WHERE id = '${s.paymentId}'`), 'COMPLETED', 'no money changed');
  eq((await call('GET', '/pos/manual-confirmations', { token: tok.counter })).status, 403, 'a till cashier without reports:view');
});

console.log('\n4. "a different person" is also a database rule');
await check('direct SQL: deciding your own request / reviewing your own confirmation is refused by CHECK constraints', async () => {
  const e1 = sqlErr(`UPDATE "PaymentReversalRequest" SET "decidedById" = "requestedById", status = 'EXECUTED' WHERE id = '${sale1.requestId}'`);
  const e2 = sqlErr(`UPDATE "InventoryAdjustmentRequest" SET "decidedById" = "requestedById" WHERE id = '${req1}'`);
  const e3 = sqlErr(`UPDATE "ManualPaymentReview" SET "reviewedById" = "confirmedById"`);
  for (const [e, n] of [[e1, 'reversal'], [e2, 'stock'], [e3, 'review']]) assert(/violates check constraint/.test(e || ''), `${n}: ${(e || 'ALLOWED').split('\n')[0]}`);
});

const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
