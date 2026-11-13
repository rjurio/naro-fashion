// Real API + real Postgres acceptance test for the unified refund workflow
// (R1b) and the R1 hand-over safety switch's "purchases are never blocked"
// rule. Local API (default :4150) on the isolated schema it_ref. Never production.
//   node refunds.it.mjs <ids.json>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const R3 = process.env.IT_R3 === '1';
// Round 25B D build (feat/return-inspection): goods are disposed of at APPROVAL, payout is money only.
const RI = process.env.IT_RETURN_INSPECTION === '1';
const API = (process.env.IT_API || 'http://localhost:4150/api/v1').replace(/\/$/, '');
if (!/^http:\/\/localhost:/.test(API)) throw new Error('refusing: IT_API must be localhost');
const ids = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const A = ids.a, B = ids.b;
const sql = (q) => execFileSync(process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe', ['-U', 'naro_admin', '-h', 'localhost', '-d', 'naro_fashion', '-qAt', '-v', 'ON_ERROR_STOP=1',
  '-c', `SET search_path TO it_ref; ${q}`], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8' }).trim();
const xff = (s) => { const h = createHash('sha256').update(String(s)).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
async function call(method, p, { token, body, key } = {}) {
  const r = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff(token || body?.email || p), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data, headers: r.headers };
}
const results = [];
async function check(name, fn) {
  try { const n = await fn(); results.push('PASS'); console.log(`  ✔ ${name}${n ? `  — ${n}` : ''}`); }
  catch (e) { results.push('FAIL'); console.log(`  ✖ ${name}\n      ${String(e?.message || e).split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
const login = async (who) => { const r = await call('POST', '/auth/login', { body: { email: who.email, password: ids.password } }); assert(r.data?.accessToken, `login ${who.email}`); return r.data.accessToken; };
const tok = {};
for (const k of Object.keys(A.admins)) tok[k] = await login(A.admins[k]);
tok.superB = await login(B.admins.super);
const req = (id) => sql(`SELECT status||'|'||amount::int FROM "RentalRefundRequest" WHERE id = '${id}'`);
const stock = () => Number(sql(`SELECT stock FROM "ProductVariant" WHERE id = '${A.variant}'`));

console.log(`real API ${API} · isolated schema it_ref`);

// --------------------------------------------------------------------------- online order
console.log('\n1. online order refund: request → independent approval → payout by someone else');
let o1;
await check('requesting writes a REQUEST only: no refund payment, order unchanged; idempotent retry → one request', async () => {
  const key = `it-${randomBytes(6).toString('hex')}`;
  const a = await call('POST', `/orders/${A.onlineOrder}/refunds`, { token: tok.clerk, key, body: { amount: 20000, reason: 'Customer returned a damaged item' } });
  const b = await call('POST', `/orders/${A.onlineOrder}/refunds`, { token: tok.clerk, key, body: { amount: 20000, reason: 'Customer returned a damaged item' } });
  o1 = a.data?.refundRequest;
  eq([a.status, b.status, b.data?.refundRequest?.id === o1?.id], [201, 201, true], 'replayed');
  eq(sql(`SELECT count(*) FROM "RentalRefundRequest" WHERE "orderId" = '${A.onlineOrder}'`), '1', 'one request');
  eq(sql(`SELECT count(*) FROM "Payment" WHERE "orderId" = '${A.onlineOrder}' AND status = 'REFUNDED'`), '0', 'no payout');
  eq(sql(`SELECT "paymentStatus" FROM "Order" WHERE id = '${A.onlineOrder}'`), 'PAID', 'order unchanged');
});
await check('open requests reserve money: asking for more than what is left (50,000 − 20,000 open) → 400', async () => {
  const r = await call('POST', `/orders/${A.onlineOrder}/refunds`, { token: tok.clerk, body: { amount: 30001, reason: 'too much' } });
  eq(r.status, 400, 'over cap');
});
await check('a person without refunds:approve cannot approve (403); the approver can', async () => {
  const r1 = await call('PATCH', `/refund-requests/${o1.id}/approve`, { token: tok.cashier, body: {} });
  eq(r1.status, 403, 'cashier lacks refunds:approve');
  const ok = await call('PATCH', `/refund-requests/${o1.id}/approve`, { token: tok.approver, body: {} });
  eq([ok.status, ok.data?.status], [200, 'APPROVED'], 'approved');
});
await check('payout: no reference for mobile money → 400 PAYOUT_INVALID, nothing claimed', async () => {
  const r = await call('PATCH', `/refund-requests/${o1.id}/pay`, { token: tok.finance, body: { method: 'MOBILE_MONEY' } });
  eq([r.status, r.data?.code, req(o1.id)], [400, 'PAYOUT_INVALID', 'APPROVED|20000'], 'refused');
});
await check('finance pays it out by mobile money (same method the customer used): linked REFUNDED row, order PARTIALLY_REFUNDED', async () => {
  const r = await call('PATCH', `/refund-requests/${o1.id}/pay`, { token: tok.finance, body: { method: 'MOBILE_MONEY', reference: 'MP-RF-0001' } });
  eq([r.status, r.data?.status], [200, 'PAID'], 'paid');
  eq(sql(`SELECT count(*)||'|'||min(amount::int) FROM "Payment" WHERE "refundRequestId" = '${o1.id}' AND status = 'REFUNDED'`), '1|20000', 'linked payout row');
  eq(sql(`SELECT "paymentStatus" FROM "Order" WHERE id = '${A.onlineOrder}'`), 'PARTIALLY_REFUNDED', 'order status');
});
await check('a second payout of the same request is refused (409); nothing more is paid', async () => {
  const r = await call('PATCH', `/refund-requests/${o1.id}/pay`, { token: tok.finance, body: { method: 'MOBILE_MONEY', reference: 'MP-RF-0002' } });
  eq([r.status, sql(`SELECT count(*) FROM "Payment" WHERE "orderId" = '${A.onlineOrder}' AND status = 'REFUNDED'`)], [409, '1'], 'once');
});
await check('the requester can never approve (403 SELF_APPROVAL) nor pay out (403 PAYOUT_BY_REQUESTER, audited), even SUPER_ADMIN', async () => {
  const s = (await call('POST', `/orders/${A.onlineOrder}/refunds`, { token: tok.super, body: { amount: 1000, reason: 'goodwill' } })).data.refundRequest;
  const self = await call('PATCH', `/refund-requests/${s.id}/approve`, { token: tok.super, body: {} });
  eq([self.status, self.data?.code], [403, 'SELF_APPROVAL'], 'requester cannot approve, even SUPER_ADMIN');
  eq((await call('PATCH', `/refund-requests/${s.id}/approve`, { token: tok.approver, body: {} })).status, 200, 'approved');
  const p = await call('PATCH', `/refund-requests/${s.id}/pay`, { token: tok.super, body: { method: 'MOBILE_MONEY', reference: 'MP-RF-0003' } });
  eq([p.status, p.data?.code, req(s.id)], [403, 'PAYOUT_BY_REQUESTER', 'APPROVED|1000'], 'refused');
  eq(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action = 'REFUND_PAYOUT_DENIED' AND "entityId" = '${s.id}'`), '1', 'audited');
  eq((await call('PATCH', `/refund-requests/${s.id}/reject`, { token: tok.approver, body: { reason: 'agreed with customer: no refund' } })).status, 409, 'APPROVED cannot be rejected');
});
await check('payout failed: row REVERSED, order back to REFUND_PENDING (owed, never shown as refunded); a retry is a NEW request', async () => {
  const f = await call('PATCH', `/refund-requests/${o1.id}/fail`, { token: tok.finance, body: { reason: 'Number not registered for mobile money' } });
  eq([f.status, f.data?.status], [200, 'FAILED'], 'failed');
  eq(sql(`SELECT status FROM "Payment" WHERE "refundRequestId" = '${o1.id}'`), 'REVERSED', 'payout reversed');
  eq(sql(`SELECT "paymentStatus" FROM "Order" WHERE id = '${A.onlineOrder}'`), 'REFUND_PENDING', 'owed again');
  const t = await call('POST', `/refund-requests/${o1.id}/retry`, { token: tok.clerk, body: { reason: 'Pay by bank instead' } });
  eq([t.status, t.data?.status, t.data?.retryOfId], [201, 'REQUESTED', o1.id], 'retry');
  eq((await call('POST', `/refund-requests/${o1.id}/retry`, { token: tok.clerk, body: { reason: 'again' } })).status, 409, 'one retry');
});

// --------------------------------------------------------------------------- POS sale
console.log('\n2. POS sale refund: a request at the till, executed at payout');
let sale, pr;
await check('setup: a real POS cash sale of 2 scarves (20,000)', async () => {
  const s = await call('POST', '/pos/sales', { token: tok.super, body: { sessionId: A.sessions.super, items: [{ productId: A.product, variantId: A.variant, quantity: 2, unitPrice: 10000 }], payments: [{ method: 'CASH', amount: 20000 }] } });
  sale = s.data?.order ?? s.data;
  assert(s.status === 201 && sale?.id, `sale ${s.status} ${JSON.stringify(s.data).slice(0, 120)}`);
  return `stock now ${stock()}`;
});
await check('the cashier\'s refund is only a request: stock, refunded quantity and money untouched', async () => {
  const before = stock();
  const item = sql(`SELECT id FROM "OrderItem" WHERE "orderId" = '${sale.id}'`);
  const r = await call('POST', `/pos/sales/${sale.id}/refund`, { token: tok.cashier, body: { items: [{ orderItemId: item, quantity: 1, condition: 'RESALEABLE' }], refundMethod: 'CASH', reason: 'wrong colour' } });
  pr = r.data?.refundRequest;
  eq([r.status, r.data?.status, r.data?.estimatedAmount], [201, 'REQUESTED', 10000], 'request');
  eq([stock(), sql(`SELECT "refundedQuantity" FROM "OrderItem" WHERE id = '${item}'`), sql(`SELECT count(*) FROM "Payment" WHERE "orderId" = '${sale.id}' AND status = 'REFUNDED'`)], [before, '0', '0'], 'nothing moved');
  const twice = await call('POST', `/pos/sales/${sale.id}/refund`, { token: tok.cashier, body: { items: [{ orderItemId: item, quantity: 2, condition: 'RESALEABLE' }], refundMethod: 'CASH', reason: 'both' } });
  eq(twice.status, 400, 'units already requested are reserved');
});
await check(RI ? 'approved by the approver → restocked AT APPROVAL; paid out in cash by finance from THEIR shift (money only)' : 'approved by the approver, paid out in cash by finance from THEIR shift: restock + refunded qty + linked row tagged with finance\'s shift', async () => {
  const beforeApproval = stock();
  eq((await call('PATCH', `/refund-requests/${pr.id}/approve`, { token: tok.approver, body: {} })).status, 200, 'approved');
  if (RI) eq(stock(), beforeApproval + 1, 'restocked at approval (resale not blocked by the payout)');
  eq((await call('PATCH', `/refund-requests/${pr.id}/pay`, { token: tok.cashier, body: { method: 'CASH' } })).status, 403, 'cashier has no payments:manage');
  const before = stock();
  const p = await call('PATCH', `/refund-requests/${pr.id}/pay`, { token: tok.finance, body: { method: 'CASH' } });
  eq([p.status, p.data?.status], [200, 'PAID'], 'paid');
  eq(stock(), RI ? before : before + 1, RI ? 'payout moves money only' : 'restocked at payout');
  eq(sql(`SELECT "gatewayResponse"->>'posSessionId' FROM "Payment" WHERE "refundRequestId" = '${pr.id}'`), A.sessions.finance, "finance's drawer");
});
await check('exchange where the customer is owed, item returned DAMAGED: not restocked (DAMAGE ledger row), the money owed is a REQUEST', async () => {
  const item = sql(`SELECT id FROM "OrderItem" WHERE "orderId" = '${sale.id}'`);
  const before = stock();
  const ex = await call('POST', '/pos/exchanges', { token: tok.super, body: { originalOrderId: sale.id, returnedItems: [{ orderItemId: item, quantity: 1, condition: 'DAMAGED' }], newItems: [], reason: 'did not fit, seam torn' } });
  eq([ex.status, !!ex.data?.refundRequestId], [201, true], `exchange ${JSON.stringify(ex.data).slice(0, 100)}`);
  eq(stock(), before, 'damaged return NOT put back into stock');
  eq(sql(`SELECT count(*) FROM "InventoryTransaction" WHERE "variantId" = '${A.variant}' AND type = 'DAMAGE' AND "quantityChange" = 0`), '1', 'damage recorded');
  eq(sql(`SELECT kind||'|'||status||'|'||amount::int FROM "RentalRefundRequest" WHERE id = '${ex.data.refundRequestId}'`), 'EXCHANGE_DIFFERENCE|REQUESTED|10000', 'owed as a request');
  eq(sql(`SELECT count(*) FROM "Payment" WHERE "orderId" = '${sale.id}' AND status = 'REFUNDED'`), '1', 'only the earlier approved payout');
});

// --------------------------------------------------------------------------- layaway
console.log('\n3. layaway cancellation: permission, reason, explicit financial disposition, no forfeiture');
let lr;
await check('without pos:layaway-cancel → 403; without a reason → 400; the layaway stays ACTIVE', async () => {
  eq((await call('POST', `/pos/layaways/${A.layaway}/cancel`, { token: tok.staff, body: { reason: 'customer changed mind' } })).status, 403, 'staff');
  eq((await call('POST', `/pos/layaways/${A.layaway}/cancel`, { token: tok.cashier, body: {} })).status, 400, 'no reason');
  eq(sql(`SELECT status FROM "Layaway" WHERE id = '${A.layaway}'`), 'ACTIVE', 'unchanged');
});
await check('cancelled with a reason: both instalments kept COMPLETED, a refund request for the full 50,000, disposition REFUND_REQUESTED, audited', async () => {
  const r = await call('POST', `/pos/layaways/${A.layaway}/cancel`, { token: tok.cashier, body: { reason: 'Customer moved to Arusha' } });
  lr = r.data?.refundRequest;
  eq([r.status, r.data?.status, r.data?.financialDisposition, Number(lr?.amount)], [201, 'CANCELLED', 'REFUND_REQUESTED', 50000], 'cancelled');
  eq(sql(`SELECT count(*) FROM "Payment" WHERE "layawayId" = '${A.layaway}' AND status = 'COMPLETED'`), '2', 'history kept');
  eq(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action = 'LAYAWAY_CANCELLED' AND "entityId" = '${A.layaway}'`), '1', 'audited');
  // Nothing silently retained: money held − refunds − open refund requests = 0.
  eq(sql(`SELECT (COALESCE(sum(amount) FILTER (WHERE status = 'COMPLETED'),0) - COALESCE(sum(amount) FILTER (WHERE status = 'REFUNDED'),0)
            - (SELECT COALESCE(sum(amount),0) FROM "RentalRefundRequest" WHERE "layawayId" = '${A.layaway}' AND status IN ('REQUESTED','APPROVED','PAYING')))::int
          FROM "Payment" WHERE "layawayId" = '${A.layaway}'`), '0', 'no unclaimed balance');
});
await check('approved and paid by bank transfer (customer paid cash → verification note required): disposition REFUNDED, linked row', async () => {
  eq((await call('PATCH', `/refund-requests/${lr.id}/approve`, { token: tok.approver, body: {} })).status, 200, 'approved');
  const noNote = await call('PATCH', `/refund-requests/${lr.id}/pay`, { token: tok.finance, body: { method: 'BANK_TRANSFER', reference: 'BANK-LAY-1' } });
  eq([noNote.status, noNote.data?.code], [400, 'PAYOUT_INVALID'], 'needs a verification note');
  const ok = await call('PATCH', `/refund-requests/${lr.id}/pay`, { token: tok.finance, body: { method: 'BANK_TRANSFER', reference: 'BANK-LAY-1', verificationNote: 'Customer showed ID and bank card in the same name' } });
  eq([ok.status, sql(`SELECT "financialDisposition" FROM "Layaway" WHERE id = '${A.layaway}'`)], [200, 'REFUNDED'], 'paid');
  eq(sql(`SELECT count(*)||'|'||min(amount::int) FROM "Payment" WHERE "layawayId" = '${A.layaway}' AND status = 'REFUNDED' AND "refundRequestId" = '${lr.id}'`), '1|50000', 'payout row');
});

// --------------------------------------------------------------------------- inventory while a refund waits
console.log('\n3b. inventory disposition while a refund waits, is rejected or is paid');
let sale2, rq2;
await check('a returned item waiting for its refund is NOT back in stock; an exchange cannot take the same unit', async () => {
  const s = await call('POST', '/pos/sales', { token: tok.super, body: { sessionId: A.sessions.super, items: [{ productId: A.product, variantId: A.variant, quantity: 1, unitPrice: 10000 }], payments: [{ method: 'CASH', amount: 10000 }] } });
  sale2 = s.data?.order ?? s.data;
  const item = sql(`SELECT id FROM "OrderItem" WHERE "orderId" = '${sale2.id}'`);
  const before = stock();
  const r = await call('POST', `/pos/sales/${sale2.id}/refund`, { token: tok.cashier, body: { items: [{ orderItemId: item, quantity: 1, condition: 'RESALEABLE' }], refundMethod: 'CASH', reason: 'customer changed mind' } });
  rq2 = r.data?.refundRequest;
  eq([r.status, stock(), sql(`SELECT lines->>'goodsDisposition' FROM "RentalRefundRequest" WHERE id = '${rq2.id}'`)], [201, before, RI ? 'HELD_PENDING_APPROVAL' : 'HELD_PENDING_REFUND'], 'held, not stocked');
  const ex = await call('POST', '/pos/exchanges', { token: tok.super, body: { originalOrderId: sale2.id, returnedItems: [{ orderItemId: item, quantity: 1 }], newItems: [], reason: 'try to exchange the reserved unit' } });
  eq(ex.status, 400, 'reserved unit cannot be exchanged');
  const noCond = await call('POST', `/pos/sales/${sale2.id}/refund`, { token: tok.cashier, body: { refundMethod: 'CASH', reason: 'no condition given' } });
  eq(noCond.status, 400, 'condition required');
});
await check('a REJECTED return: still not in stock, recorded as "hand back to customer", nothing refunded', async () => {
  const before = stock();
  eq((await call('PATCH', `/refund-requests/${rq2.id}/reject`, { token: tok.approver, body: { reason: 'outside the return window' } })).status, 200, 'rejected');
  eq([stock(), sql(`SELECT lines->>'goodsDisposition' FROM "RentalRefundRequest" WHERE id = '${rq2.id}'`), sql(`SELECT "refundedQuantity" FROM "OrderItem" WHERE "orderId" = '${sale2.id}'`)], [before, 'HAND_BACK_TO_CUSTOMER', '0'], 'disposition');
  eq(sql(`SELECT count(*) FROM "Payment" WHERE "orderId" = '${sale2.id}' AND status = 'REFUNDED'`), '0', 'no refund');
});
await check(RI ? 'an approved resaleable return: disposition RESTOCKED with who + when, one restock row written at approval' : 'a PAID resaleable return is back in stock only at payout, disposition RESTOCKED', async () => {
  eq(sql(`SELECT lines->>'goodsDisposition' FROM "RentalRefundRequest" WHERE id = '${pr.id}'`), 'RESTOCKED', 'disposition');
  eq(sql(`SELECT count(*) FROM "InventoryTransaction" WHERE "variantId" = '${A.variant}' AND type = 'ADJUSTMENT' AND "quantityChange" = 1 AND note LIKE '${RI ? 'POS return accepted for resale%' : 'POS partial refund%'}'`), '1', 'one restock row');
  if (RI) eq(sql(`SELECT (lines->>'disposedById') = '${A.admins.approver.id}' AND (lines->>'receivedById') = '${A.admins.cashier.id}' FROM "RentalRefundRequest" WHERE id = '${pr.id}'`), 't', 'who received / who authorised');
});
if (RI) {
  await check('accept now, inspect later: no condition → HELD_PENDING_INSPECTION; approval refused (409) until inspected; nothing in stock meanwhile', async () => {
    const s3 = await call('POST', '/pos/sales', { token: tok.super, body: { sessionId: A.sessions.super, items: [{ productId: A.product, variantId: A.variant, quantity: 1, unitPrice: 10000 }], payments: [{ method: 'CASH', amount: 10000 }] } });
    const sale3 = s3.data?.order ?? s3.data;
    const item = sql(`SELECT id FROM "OrderItem" WHERE "orderId" = '${sale3.id}'`);
    const before = stock();
    const r = await call('POST', `/pos/sales/${sale3.id}/refund`, { token: tok.cashier, body: { items: [{ orderItemId: item, quantity: 1 }], refundMethod: 'CASH', reason: 'returned in a bag, not checked yet' } });
    const rq = r.data?.refundRequest;
    eq([r.status, sql(`SELECT lines->>'goodsDisposition' FROM "RentalRefundRequest" WHERE id = '${rq.id}'`), stock()], [201, 'HELD_PENDING_INSPECTION', before], 'accepted, held');
    const early = await call('PATCH', `/refund-requests/${rq.id}/approve`, { token: tok.approver, body: {} });
    eq([early.status, early.data?.code, stock()], [409, 'INSPECTION_PENDING', before], 'no approval before inspection');
    const ins = await call('PATCH', `/refund-requests/${rq.id}/inspect`, { token: tok.cashier, body: { items: [{ orderItemId: item, condition: 'DAMAGED', note: 'zip broken' }] } });
    eq([ins.status, ins.data?.lines?.goodsDisposition, ins.data?.lines?.items?.[0]?.inspectedById], [200, 'HELD_PENDING_APPROVAL', A.admins.cashier.id], 'inspected');
    eq((await call('PATCH', `/refund-requests/${rq.id}/approve`, { token: tok.approver, body: {} })).status, 200, 'approved');
    eq([stock(), sql(`SELECT lines->>'goodsDisposition' FROM "RentalRefundRequest" WHERE id = '${rq.id}'`)], [before, 'DAMAGED_NOT_RESTOCKED'], 'damaged: never sellable');
    eq(sql(`SELECT count(*) FROM "InventoryTransaction" WHERE "variantId" = '${A.variant}' AND type = 'DAMAGE' AND reference = '${sale3.orderNumber}'`), '1', 'DAMAGE row at approval');
    eq((await call('PATCH', `/refund-requests/${rq.id}/inspect`, { token: tok.cashier, body: { items: [{ orderItemId: item, condition: 'RESALEABLE' }] } })).status, 409, 'no re-inspection after the decision');
    eq(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action IN ('RETURN_INSPECTED', 'RETURN_GOODS_DISPOSED') AND "entityId" = '${rq.id}'`), '2', 'audited');
  });
}

// --------------------------------------------------------------------------- isolation, shift, safety switch
console.log('\n4. shop isolation, shift reconciliation, hand-over safety switch');
await check('another shop can neither see nor act on these requests (404)', async () => {
  eq((await call('GET', `/refund-requests/${lr.id}`, { token: tok.superB })).status, 404, 'get');
  eq((await call('PATCH', `/refund-requests/${pr.id}/fail`, { token: tok.superB, body: { reason: 'cross-shop attempt' } })).status, 404, 'fail');
  const list = await call('GET', '/refund-requests', { token: tok.superB });
  eq([list.status, list.data.length], [200, 0], 'empty list');
});
await check('POS shift writes stay in their shop: shop B\'s open shift is untouched by shop A\'s sales and closes', async () => {
  const open = await call('POST', '/pos/sessions/open', { token: tok.superB, body: { openingCash: 5000 } });
  eq(open.status, 201, `open B ${JSON.stringify(open.data).slice(0, 80)}`);
  const s = await call('POST', '/pos/sales', { token: tok.super, body: { sessionId: A.sessions.super, items: [{ productId: A.product, variantId: A.variant, quantity: 1, unitPrice: 10000 }], payments: [{ method: 'CASH', amount: 10000 }] } });
  eq(s.status, 201, 'sale in A');
  eq(sql(`SELECT "totalSales"::int||'|'||"totalTransactions" FROM "PosSession" WHERE id = '${open.data.id}'`), '0|0', 'shop B shift untouched');
  const close = await call('POST', '/pos/sessions/close', { token: tok.superB, body: { closingCash: 5000 } });
  eq([close.status, close.data?.status, Number(close.data?.expectedCash)], [201, 'CLOSED', 5000], 'B closes');
  eq((await call('POST', '/pos/sessions/close', { token: tok.superB, body: { closingCash: 5000 } })).status, 404, 'no open shift left');
});
await check('finance shift closes with the cash payout subtracted (opening 100,000 − 10,000 POS refund)', async () => {
  const r = await call('POST', '/pos/sessions/close', { token: tok.finance, body: { closingCash: 90000 } });
  eq([r.status, Number(r.data?.expectedCash), Number(r.data?.cashDifference)], [201, 90000, 0], 'expected cash');
});
await check('safety switch: only rentals:handover-safeguard may change it (staff 403); while ON a product purchase still works; audited', async () => {
  eq((await call('PUT', '/rental-handover-safeguard', { token: tok.staff, body: { checklistRequired: true, reason: 'attempt by staff' } })).status, 403, 'staff');
  const on = await call('PUT', '/rental-handover-safeguard', { token: tok.super, body: { checklistRequired: true, reason: 'rehearse R3 rollback safety' } });
  // R3 build (IT_R3=1): the checklist exists, so ON still allows hand-overs (the checklist gates them).
  eq([on.status, on.data?.handoversAllowed], [200, R3], 'on');
  const s = await call('POST', '/pos/sales', { token: tok.super, body: { sessionId: A.sessions.super, items: [{ productId: A.product, variantId: A.variant, quantity: 1, unitPrice: 10000 }], payments: [{ method: 'CASH', amount: 10000 }] } });
  eq(s.status, 201, 'purchase unaffected');
  const off = await call('PUT', '/rental-handover-safeguard', { token: tok.super, body: { checklistRequired: false, reason: 'rehearsal finished' } });
  if (R3) eq([off.status, off.data?.code], [422, 'SAFEGUARD_LOCKED_ON'], 'R3: the switch stays on');
  else eq([off.status, off.data?.handoversAllowed], [200, true], 'off');
  // R3: only the ON change is written (OFF is refused before anything is written).
  eq(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action = 'HANDOVER_SAFEGUARD_CHANGED'`), R3 ? '1' : '2', 'audited');
});

const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
