// LF-2026-11 late-fee consistency in real browsers (round 25B, A): the
// storefront booking page (EN + SW), the POS quote, the admin policies and the
// admin overdue widget all show what the API computes. Storefront :3101 and
// admin :3132 (next dev) -> local API :4130 -> isolated schema it_pos.
//   node latefee.browser.it.mjs <worktree> <ids.json> <screenshot-dir>
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const { chromium } = createRequire(process.argv[2] + '/apps/storefront/package.json')('playwright');
const ids = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const SHOTS = process.argv[4]; mkdirSync(SHOTS, { recursive: true });
const SF = 'http://localhost:3101', ADMIN = 'http://localhost:3132', API = 'http://localhost:4130/api/v1';
const T = ids.tenantId;
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
const login = async (who) => (await api('POST', '/auth/login', null, { email: who.email, password: who.password })).data;
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const eatNoon = (n) => { const e = new Date(Date.now() + 3 * 3600e3); return new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate(), 9, 0) - n * 86400e3).toISOString(); };
const G = ids.gown;

const quote = (await api('GET', `/rentals/quote/${G.id}`)).data;
assert(quote?.lateFee?.text?.en, 'quote');
const browser = await chromium.launch();
async function adminAs(who) {
  const tok = await login(who);
  assert(tok?.accessToken, `login ${who.email}`);
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  await ctx.addInitScript(([a, r]) => { localStorage.setItem('token', a); localStorage.setItem('refreshToken', r); }, [tok.accessToken, tok.refreshToken]);
  return { ctx, token: tok.accessToken };
}
const norm = (s) => s.replace(/\s+/g, ' ').trim();

console.log(`storefront ${SF} · admin ${ADMIN} · API quote: "${quote.lateFee.text.en}"`);
for (const [locale, text] of [['en', quote.lateFee.text.en], ['sw', quote.lateFee.text.sw]]) {
  await check(`storefront booking page (${locale.toUpperCase()}) shows exactly the API's late-fee sentence (incl. the cap)`, async () => {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
    await ctx.addInitScript((l) => localStorage.setItem('locale', l), locale);
    const p = await ctx.newPage();
    await p.goto(`${SF}/rentals/it-pos-gown`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    const el = p.getByTestId('rental-late-fee');
    await el.waitFor({ timeout: 180000 });
    const shown = norm(await el.innerText());
    assert(shown === norm(text), `shown "${shown}" vs API "${text}"`);
    await p.screenshot({ path: `${SHOTS}/lf-storefront-${locale}.png` });
    await ctx.close();
  });
}
const cashier = await adminAs(ids.admins.cashier);
await check('POS quote shows the same sentence (cap included), not only the daily amount', async () => {
  const p = await cashier.ctx.newPage();
  await p.goto(`${ADMIN}/dashboard/pos`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await p.getByTestId('pos-mode-rental').click({ timeout: 180000 });
  await p.getByTestId('rental-search').fill('ITPOS-M');
  await p.getByTestId('rental-search-go').click();
  await p.getByTestId('rental-item-it-pos-gown').click();
  await p.getByTestId('rental-size').selectOption({ label: 'M' });
  const far = 600 + Number(sql(`SELECT COALESCE(max("returnDate")::date - current_date, 0) FROM "RentalOrder" WHERE "tenantId" = '${T}'`));
  await p.getByTestId('rental-pickup').fill(day(far));
  await p.getByTestId('rental-return').fill(day(far + 2));
  await p.getByTestId('rental-check').click();
  const shown = norm(await p.getByTestId('rental-quote-late-fee').innerText({ timeout: 30000 }));
  assert(shown === norm(quote.lateFee.text.en), `POS "${shown}"`);
  await p.screenshot({ path: `${SHOTS}/lf-pos-quote.png` });
});
const sup = await adminAs(ids.admins.super);
await check('admin Policies page shows the shop default 10 % a day and the 100 % cap that the quote uses', async () => {
  const p = await sup.ctx.newPage();
  await p.goto(`${ADMIN}/dashboard/rentals/policies`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await p.getByText('Late Fee (% of the rental fee per late day)').first().waitFor({ timeout: 180000 });
  const values = await p.locator('input[type="number"]').evaluateAll((els) => els.map((e) => e.value));
  assert(values.includes('10') && values.includes('100'), `inputs ${values.join(',')}`);
  assert(quote.lateFee.pct === 10 && quote.lateFee.capAmount === quote.rentalFee, `quote pct ${quote.lateFee.pct} cap ${quote.lateFee.capAmount}`);
  await p.screenshot({ path: `${SHOTS}/lf-admin-policies.png`, fullPage: true });
});
await check('admin overdue widget: 3 whole days late → "3d overdue" and TZS 120,000 accrued — the API\'s numbers', async () => {
  const tag = Date.now().toString(36).slice(-4);
  // Re-runs: an earlier run's overdue gown blocks new bookings of it (legacy one-at-a-time rule) — mark those returned.
  sql(`UPDATE "RentalOrder" SET status = 'RETURNED' WHERE "tenantId" = '${T}' AND "productId" = '${G.id}' AND status = 'ACTIVE' AND "returnDate" < now()`);
  const c = (await api('POST', '/pos-rentals/customers', cashier.token, { firstName: 'Late', lastName: `Browser${tag}`, phone: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` })).data;
  const far = 20 + Number(sql(`SELECT COALESCE(max("returnDate")::date - current_date, 0) FROM "RentalOrder" WHERE "tenantId" = '${T}'`));
  const b = await api('POST', '/pos-rentals', cashier.token, { customerId: c.id, productId: G.id, variantId: G.S, startDate: day(far), returnDate: day(far + 2), pickupDate: day(far), termsAccepted: true });
  assert(b.status === 201, `book ${b.status}`);
  // Test-only shortcut past the hand-over: the documented single-use override (GATE_RECOVERY_PROCEDURE.md).
  sql(`INSERT INTO "RentalGateOverride" (id, "tenantId", "rentalOrderId", step, reason, "authorizedBy", "expiresAt") VALUES ('it-' || md5(random()::text), '${T}', '${b.data.id}', 'handover', 'integration test shortcut: simulated hand-over', 'it-harness', (now() AT TIME ZONE 'UTC') + interval '5 minutes'); UPDATE "RentalOrder" SET status = 'ACTIVE', "startDate" = '${eatNoon(6)}', "pickupDate" = '${eatNoon(6)}', "returnDate" = '${eatNoon(3)}' WHERE id = '${b.data.id}'`);
  const row = (await api('GET', '/rentals/overdue', sup.token)).data.find((r) => r.id === b.data.id);
  assert(row?.daysLate === 3 && row?.lateFeeAccrued === 120000, `API ${row?.daysLate}/${row?.lateFeeAccrued}`);
  const p = await sup.ctx.newPage();
  await p.goto(`${ADMIN}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  const item = p.getByText(`Late Browser${tag}`).first(); // the widget lists customer names
  await item.waitFor({ timeout: 180000 });
  await item.click();
  const body = norm(await p.locator('body').innerText());
  assert(/3d overdue/.test(body) && /3 days overdue/.test(body), 'day count');
  assert(/120,000/.test(body), 'accrued late fee');
  await p.screenshot({ path: `${SHOTS}/lf-admin-overdue.png` });
});

await browser.close();
const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
