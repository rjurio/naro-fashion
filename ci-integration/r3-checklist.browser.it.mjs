// Real admin UI (localhost:3132, next dev) -> real API (localhost:4130) ->
// isolated schema it_pos. R3 mandatory checklist screens (POS hand-over /
// return, Admin rental page, templates editor). Never production.
//   node r3-checklist.browser.it.mjs <worktree> <ids.json> <screenshot-dir>
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const { chromium } = createRequire(process.argv[2] + '/apps/storefront/package.json')('playwright');
const ids = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const SHOTS = process.argv[4]; mkdirSync(SHOTS, { recursive: true });
const ADMIN = process.env.IT_ADMIN || 'http://localhost:3132';
const API = process.env.IT_API || 'http://localhost:4130/api/v1';
if (!/^http:\/\/localhost:/.test(ADMIN) || !/^http:\/\/localhost:/.test(API)) throw new Error('refusing: localhost only');
const T = ids.tenantId;
const sql = (q) => execFileSync(process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe', ['-U', 'naro_admin', '-h', 'localhost', '-d', 'naro_fashion', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO ${process.env.IT_SCHEMA || 'it_pos'}; ${q}`], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8' }).trim();
const results = [];
async function check(name, fn) {
  try { const n = await fn(); results.push('PASS'); console.log(`  ✔ ${name}${n ? `  — ${n}` : ''}`); }
  catch (e) { results.push('FAIL'); console.log(`  ✖ ${name}\n      ${String(e?.message || e).split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const xff = (s) => { const h = createHash('sha256').update(s).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
const api = async (method, p, token, body) => {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': T, 'X-Forwarded-For': xff(token || body?.email || p), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const login = async (who) => (await api('POST', '/auth/login', null, { email: who.email, password: who.password })).data;
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const statusOf = (id) => sql(`SELECT status FROM "RentalOrder" WHERE id = '${id}'`);

const browser = await chromium.launch();
async function as(who) {
  const tok = await login(who);
  assert(tok?.accessToken, `login ${who.email}`);
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  await ctx.addInitScript(([a, r]) => { localStorage.setItem('token', a); localStorage.setItem('refreshToken', r); window.print = () => {}; }, [tok.accessToken, tok.refreshToken]);
  return { ctx, token: tok.accessToken };
}
const cashier = await as(ids.admins.cashier);
const checker = await as(ids.admins.checker);

// ---- set-up through the API: the gown's checklist + two confirmed, fully paid bookings
const tpl = await api('POST', '/rental-checklists/templates', checker.token, { name: 'Ivory gown set', productId: ids.gown.id, items: [
  { label: 'Gown', itemType: 'DISPATCH', instructions: 'Check hem, zip and beading' },
  { label: 'Veil', itemType: 'DISPATCH' },
  { label: 'Padded hangers', itemType: 'DISPATCH', quantity: 2, requiresCondition: false },
  { label: 'Stains / odour check', itemType: 'RETURN' },
] });
assert(tpl.status === 201, `template ${tpl.status}`);
// Round 25F D builds (IT_TEMPLATE_APPROVAL=1, default off): a DIFFERENT person (the seeded
// independent approver) approves the exact version before bookings can use it.
if (process.env.IT_TEMPLATE_APPROVAL === '1') {
  const t = tpl.data;
  assert(t?.approvalStatus !== undefined && ids.admins.tplApprover, `template approval set-up: ${JSON.stringify(t).slice(0, 120)}`);
  const ap = await login(ids.admins.tplApprover);
  const r = await api('POST', `/rental-checklists/templates/${t.id}/approve`, ap.accessToken, {
    version: t.version, hash: t.contentHash, scope: { productId: t.productId ?? null, categoryId: t.categoryId ?? null },
    confirmedItems: t.items.map((i) => ({ itemId: i.id, quantity: i.quantity })) });
  assert(r.status === 201, `approve template ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
}
let seq = 0;
let reviewerTok;
async function ready(variant, start) {
  const c = (await api('POST', '/pos-rentals/customers', cashier.token, { firstName: 'Browser', lastName: `R3-${++seq}`, phone: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` })).data;
  await api('POST', `/pos-rentals/customers/${c.id}/address`, cashier.token, { street: 'Mwenge 12', city: 'Dar es Salaam', region: 'Dar es Salaam' });
  assert(c?.id, `customer: ${JSON.stringify(c).slice(0, 200)}`);
  const br = await api('POST', '/pos-rentals', cashier.token, { customerId: c.id, productId: ids.gown.id, variantId: ids.gown[variant], startDate: day(start), returnDate: day(start + 2), pickupDate: day(start), termsAccepted: true });
  assert(br.status === 201, `booking ${br.status}: ${JSON.stringify(br.data).slice(0, 200)}`);
  const b = br.data;
  const reviewer = reviewerTok ??= await login(ids.admins.reviewer);
  await api('POST', `/pos-rentals/${b.id}/id-in-person`, reviewer.accessToken, { idType: 'NATIONAL_ID', idNumber: `1991${seq}0101-12345` });
  for (const [component, amount] of [['RENTAL_FEE', 400000], ['DEPOSIT', 200000]]) {
    await api('POST', `/pos-rentals/${b.id}/payments`, cashier.token, { component, sessionId: ids.sessions.cashier, tenders: [{ method: 'CASH', amount }] });
  }
  assert(statusOf(b.id) === 'FULLY_PAID', `booking not confirmed: ${statusOf(b.id)}`);
  return b;
}
// Fresh dates per run: after every booking already in the database (2-day buffer).
const START = 10 + Number(sql(`SELECT COALESCE(max("returnDate")::date - current_date, 0) FROM "RentalOrder" WHERE "tenantId" = '${T}'`));
const b1 = await ready('M', START);
const b2 = await ready('S', START + 8); // without per-gown tracking, one booking per product at a time

async function openPosBooking(ctx, rentalNumber) {
  const p = await ctx.newPage();
  await p.goto(`${ADMIN}/dashboard/pos`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await p.getByTestId('pos-mode-rental').waitFor({ timeout: 180000 });
  await p.getByTestId('pos-mode-rental').click();
  await p.getByTestId('rental-ref').fill(rentalNumber);
  await p.getByTestId('rental-open').click();
  await p.getByTestId('rental-booking').waitFor({ timeout: 30000 });
  await p.getByTestId('checklist-panel').waitFor({ timeout: 30000 });
  return p;
}
const row = (p, label) => p.locator(`[data-testid="item-${label}"]`);
async function recordRow(p, label, condition, note) {
  const r = row(p, label);
  if (condition) await r.getByLabel(`${label} condition`).selectOption(condition);
  if (note) await r.getByLabel(`${label} note`).fill(note);
  await r.getByRole('button', { name: /^(Record|Correct)$/ }).click();
  await p.getByText(new RegExp(`"${label.replace(/[/]/g, '\\/')}" (recorded|corrected)`)).first().waitFor({ timeout: 20000 });
}

console.log(`real admin ${ADMIN} -> real API -> it_pos · R3 checklist screens`);
let pos;
await check('POS: the booking shows its checklist (fixed from the product template) and "Hand-over blocked — still to check …"', async () => {
  pos = await openPosBooking(cashier.ctx, b1.rentalNumber);
  const v = await pos.getByTestId('handover-verdict').innerText();
  assert(/Hand-over blocked/.test(v) && /Gown, Veil, Padded hangers/.test(v), v);
  assert(/product checklist "Ivory gown set" v1/.test(await pos.getByTestId('checklist-panel').innerText()), 'source line');
  await pos.screenshot({ path: `${SHOTS}/r3-01-pos-handover-blocked.png`, fullPage: true });
});
await check('POS: pressing "Hand over" with the checklist incomplete is refused (message shown, status unchanged)', async () => {
  await pos.getByTestId('rental-handover').click();
  await pos.getByText(/checklist isn't complete/i).first().waitFor({ timeout: 20000 });
  assert(statusOf(b1.id) === 'FULLY_PAID', 'status changed');
});
await check('POS: recording each item (condition required) turns the verdict green; staff name + time shown per item', async () => {
  await recordRow(pos, 'Gown', 'GOOD');
  await recordRow(pos, 'Veil', 'GOOD');
  await recordRow(pos, 'Padded hangers');
  await pos.getByText(/Checklist complete/).waitFor({ timeout: 20000 });
  const gown = await row(pos, 'Gown').innerText();
  assert(/1 × Good/.test(gown) && /POS cashier/.test(gown), gown);
  await pos.screenshot({ path: `${SHOTS}/r3-02-pos-checklist-complete.png`, fullPage: true });
});
await check('POS: hand-over now succeeds (ACTIVE)', async () => {
  await pos.getByTestId('rental-handover').click();
  await pos.getByText('Handed over').first().waitFor({ timeout: 20000 });
  assert(statusOf(b1.id) === 'ACTIVE', statusOf(b1.id));
});
await check('POS return: the inspector sees what went out; a damaged gown opens a discrepancy; the deposit request is refused while it is open', async () => {
  await pos.getByTestId('rental-record-return').click();
  await pos.getByText('Return recorded').first().waitFor({ timeout: 20000 });
  await pos.getByText('Return inspection').first().waitFor({ timeout: 20000 });
  assert(/1 × Good/.test(await row(pos, 'Gown').innerText()), 'handed-over column');
  await recordRow(pos, 'Gown', 'DAMAGED', 'Torn lace at the hem');
  await recordRow(pos, 'Veil', 'GOOD');
  await recordRow(pos, 'Padded hangers');
  await recordRow(pos, 'Stains / odour check', 'GOOD');
  await pos.getByTestId('discrepancy-OPEN').waitFor({ timeout: 20000 });
  assert(/waiting for a reviewer/.test(await pos.getByTestId('inspection-verdict').innerText()), 'verdict');
  await pos.getByTestId('rental-dep-reason').fill('Lace repair');
  await pos.getByTestId('rental-dep-retained').fill('50000');
  await pos.getByTestId('rental-dep-request').click();
  await pos.getByText(/deposit can't be settled yet/i).first().waitFor({ timeout: 20000 });
  assert(sql(`SELECT count(*) FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${b1.id}'`) === '0', 'request written');
  await pos.screenshot({ path: `${SHOTS}/r3-03-pos-return-discrepancy.png`, fullPage: true });
});

// ---- Admin: decisions by a different person
let adminPage;
async function openAdminRental(ctx, rentalNumber, tab) {
  const p = await ctx.newPage();
  await p.goto(`${ADMIN}/dashboard/rentals`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  if (tab) await p.getByRole('button', { name: new RegExp(tab) }).first().click({ timeout: 180000 });
  await p.getByText(rentalNumber).first().click({ timeout: 180000 });
  await p.getByTestId('checklist-panel').waitFor({ timeout: 30000 });
  return p;
}
await check('Admin rental page (reviewer): decides the discrepancy "Deduct from deposit" with a note; recorded with the reviewer\'s name', async () => {
  adminPage = await openAdminRental(checker.ctx, b1.rentalNumber, 'Returns & Inspection');
  const d = adminPage.getByTestId('discrepancy-OPEN');
  await d.getByLabel('Resolution').selectOption('RESOLVED_DEDUCTED');
  await d.getByLabel('Decision note').fill('Lace repair quote TZS 50,000');
  await d.getByRole('button', { name: 'Decide' }).click();
  await adminPage.getByText('Discrepancy decided').first().waitFor({ timeout: 20000 });
  assert(/Deduct from deposit by POS checker/.test(await adminPage.getByTestId('discrepancy-RESOLVED_DEDUCTED').innerText()), 'resolved line');
  await adminPage.screenshot({ path: `${SHOTS}/r3-04-admin-discrepancy-decided.png`, fullPage: true });
});
await check('POS: with the inspection complete and the discrepancy decided, the deposit return (50,000 kept) is accepted', async () => {
  await pos.reload({ waitUntil: 'domcontentloaded' });
  await pos.getByTestId('pos-mode-rental').click();
  await pos.getByTestId('rental-ref').fill(b1.rentalNumber);
  await pos.getByTestId('rental-open').click();
  await pos.getByTestId('rental-dep-reason').fill('Lace repair');
  await pos.getByTestId('rental-dep-retained').fill('50000');
  await pos.getByTestId('rental-dep-request').click();
  await pos.getByText(/Deposit return requested/).first().waitFor({ timeout: 20000 });
  assert(sql(`SELECT kind || ':' || "retainedAmount"::int FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${b1.id}'`) === 'DEPOSIT_RETURN:50000', 'request');
});
await check('Exception in the UI: the cashier requests "Veil missing"; the cashier sees no approval right (403); the reviewer approves on the Admin page', async () => {
  const p2 = await openPosBooking(cashier.ctx, b2.rentalNumber);
  await recordRow(p2, 'Gown', 'GOOD');
  await recordRow(p2, 'Padded hangers');
  await p2.getByRole('button', { name: 'Request an exception' }).click();
  await p2.getByLabel('Veil', { exact: true }).check();
  await p2.getByLabel('Reason').fill('Veil at the cleaners; customer collects it tomorrow');
  await p2.getByRole('button', { name: 'Send for approval' }).click();
  await p2.getByText(/Exception requested/).first().waitFor({ timeout: 20000 });
  await p2.getByTestId('exception-REQUESTED').getByRole('button', { name: 'Approve' }).click();
  await p2.getByText(/permission|forbidden|not allowed/i).first().waitFor({ timeout: 20000 });
  assert(sql(`SELECT status FROM "RentalChecklistException" WHERE "rentalOrderId" = '${b2.id}'`) === 'REQUESTED', 'cashier approved?');
  const a2 = await openAdminRental(checker.ctx, b2.rentalNumber);
  await a2.getByTestId('exception-REQUESTED').getByRole('button', { name: 'Approve' }).click();
  await a2.getByText('Exception approved').first().waitFor({ timeout: 20000 });
  await a2.getByTestId('exception-APPROVED').waitFor({ timeout: 20000 });
  await a2.screenshot({ path: `${SHOTS}/r3-05-admin-exception-approved.png`, fullPage: true });
  await p2.reload({ waitUntil: 'domcontentloaded' });
  await p2.getByTestId('pos-mode-rental').click();
  await p2.getByTestId('rental-ref').fill(b2.rentalNumber);
  await p2.getByTestId('rental-open').click();
  await p2.getByText(/Checklist complete/).waitFor({ timeout: 20000 });
  await p2.getByTestId('rental-handover').click();
  await p2.getByText('Handed over').first().waitFor({ timeout: 20000 });
  assert(statusOf(b2.id) === 'ACTIVE' && sql(`SELECT status FROM "RentalChecklistException" WHERE "rentalOrderId" = '${b2.id}'`) === 'USED', 'handed over once, exception used');
});
await check('Templates editor: "Applies to" (shop / category / product) and per-item quantity, mandatory, condition, instructions; saved as a CATEGORY list', async () => {
  const p = await checker.ctx.newPage();
  await p.goto(`${ADMIN}/dashboard/rentals/checklists`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await p.getByRole('button', { name: 'New Template' }).click({ timeout: 180000 });
  await p.getByPlaceholder('e.g. Standard Gown Dispatch Checklist').fill('Bouquets');
  await p.getByRole('button', { name: 'A category' }).click();
  await p.getByLabel('Category').selectOption({ label: 'Bridal accessories' });
  await p.getByPlaceholder('Item description (English)').first().fill('Satin ribbons');
  await p.getByLabel('Item 1 quantity').fill('2');
  await p.getByLabel('Item 1 instructions').fill('No fraying');
  await p.screenshot({ path: `${SHOTS}/r3-06-template-editor.png`, fullPage: true });
  await p.getByRole('button', { name: /^(Create|Save|Create Template|Save Changes)/ }).last().click();
  await p.getByText('Bouquets').first().waitFor({ timeout: 20000 });
  const t = sql(`SELECT t."categoryId" = '${ids.bouquet.categoryId}' AND i.quantity = 2 AND i.instructions = 'No fraying' FROM "RentalChecklistTemplate" t JOIN "RentalChecklistTemplateItem" i ON i."templateId" = t.id WHERE t.name = 'Bouquets' ORDER BY t."createdAt" DESC LIMIT 1`);
  assert(t === 't', `saved: ${t}`);
});

await browser.close();
const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
