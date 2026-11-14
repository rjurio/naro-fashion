// Real admin UI (localhost:3132) -> real API (localhost:4130) -> it_pos.
// Round 25C F: cancelling a rental needs a structured reason; the money becomes
// full refund REQUESTS (shown on Admin → Refunds). Never production.
//   node cancel-dialog.browser.it.mjs <worktree> <pos-ids.json> <screenshot-dir>
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const { chromium } = createRequire(process.argv[2] + '/apps/storefront/package.json')('playwright');
const ids = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const SHOTS = process.argv[4]; mkdirSync(SHOTS, { recursive: true });
const ADMIN = 'http://localhost:3132', API = 'http://localhost:4130/api/v1', T = ids.tenantId;
const sql = (q) => execFileSync(process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe', ['-U', 'naro_admin', '-h', 'localhost', '-d', 'naro_fashion', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO it_pos; ${q}`], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8' }).trim();
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
const login = async (w) => (await api('POST', '/auth/login', null, { email: w.email, password: w.password })).data;
const browser = await chromium.launch();
const cashierTok = await login(ids.admins.cashier);
const reviewerTok = await login(ids.admins.reviewer);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const start = 20 + Number(sql(`SELECT COALESCE(max("returnDate")::date - current_date, 0) FROM "RentalOrder" WHERE "tenantId" = '${T}'`));
const c = (await api('POST', '/pos-rentals/customers', cashierTok.accessToken, { firstName: 'Dialog', lastName: 'Cancel', phone: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` })).data;
const b = (await api('POST', '/pos-rentals', cashierTok.accessToken, { customerId: c.id, productId: ids.gown.id, variantId: ids.gown.M, startDate: day(start), returnDate: day(start + 2), pickupDate: day(start), termsAccepted: true })).data;
await api('POST', `/pos-rentals/${b.id}/id-in-person`, reviewerTok.accessToken, { idType: 'NATIONAL_ID', idNumber: '19940404-44444' });
for (const [component, amount] of [['RENTAL_FEE', 100000], ['DEPOSIT', 200000]]) {
  await api('POST', `/pos-rentals/${b.id}/payments`, cashierTok.accessToken, { component, sessionId: ids.sessions.cashier, tenders: [{ method: 'CASH', amount }] });
}
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await ctx.addInitScript(([a, r]) => { localStorage.setItem('token', a); localStorage.setItem('refreshToken', r); }, [cashierTok.accessToken, cashierTok.refreshToken]);

console.log(`real admin ${ADMIN} -> real API -> it_pos · cancel dialog`);
await check('Cancel rental opens a dialog: the reason is required (button disabled), "Other" needs a note; the text says the money becomes refund requests', async () => {
  const p = await ctx.newPage();
  await p.goto(`${ADMIN}/dashboard/rentals`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  const row = p.locator('div').filter({ hasText: b.rentalNumber }).filter({ has: p.getByRole('button', { name: 'Cancel rental' }) }).last();
  await row.getByRole('button', { name: 'Cancel rental' }).click({ timeout: 180000 });
  const dlg = p.getByTestId('cancel-rental-dialog');
  await dlg.waitFor({ timeout: 20000 });
  assert(/full refund request/.test(await dlg.innerText()), 'explains the refund');
  const confirm = dlg.getByRole('button', { name: 'Cancel rental' });
  assert(await confirm.isDisabled(), 'no reason → disabled');
  await dlg.getByLabel('Cancellation reason').selectOption('OTHER');
  assert(await confirm.isDisabled(), 'OTHER without a note → disabled');
  await dlg.getByLabel('Cancellation reason').selectOption('CUSTOMER_REQUEST');
  await dlg.getByLabel('Cancellation note').fill('Wedding moved to next year');
  await p.screenshot({ path: `${SHOTS}/cancel-01-dialog.png` });
  await confirm.click();
  await p.getByText(/Rental marked cancelled/i).first().waitFor({ timeout: 20000 });
  await p.close();
});
await check('the booking records the reason, note and who; fee + deposit became REQUESTED refund requests (nothing paid)', async () => {
  assert(sql(`SELECT status || '|' || "cancellationReason" || '|' || "cancellationNote" || '|' || "cancelledById" FROM "RentalOrder" WHERE id = '${b.id}'`) === `CANCELLED|CUSTOMER_REQUEST|Wedding moved to next year|${ids.admins.cashier.id}`, 'booking');
  assert(sql(`SELECT string_agg(component || ':' || amount::int || ':' || status, ',' ORDER BY component DESC) FROM "RentalRefundRequest" WHERE "rentalOrderId" = '${b.id}'`) === 'RENTAL_FEE:100000:REQUESTED,DEPOSIT:200000:REQUESTED', 'requests');
  assert(sql(`SELECT count(*) FROM "Payment" WHERE "rentalOrderId" = '${b.id}' AND status = 'REFUNDED'`) === '0', 'nothing paid');
});

await browser.close();
const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
