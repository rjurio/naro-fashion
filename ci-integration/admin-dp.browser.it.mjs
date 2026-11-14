// Real admin UI (localhost:3102) -> real API (4100) -> isolated schema it_mig.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const { chromium } = createRequire(process.argv[2] + '/apps/storefront/package.json')('playwright');
const ADMIN = 'http://localhost:3102';
const API = 'http://localhost:4100/api/v1';
const sql = (q) => execFileSync(process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe', ['-U', 'naro_admin', '-h', 'localhost', '-d', 'naro_fashion', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO it_mig; ${q}`], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8' }).trim();
const results = [];
async function check(name, fn) {
  try { const n = await fn(); results.push('PASS'); console.log(`  ✔ ${name}${n ? `  — ${n}` : ''}`); }
  catch (e) { results.push('FAIL'); console.log(`  ✖ ${name}\n      ${String(e?.message || e).split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const login = async (email, password) => (await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json());

// known starting state for this run
sql(`UPDATE "Product" SET "rentalDownPaymentMode" = NULL, "rentalDownPaymentPct" = 40 WHERE id = 'p-expl'`);
sql(`UPDATE "RentalPolicy" SET "defaultDownPaymentPct" = 25 WHERE "tenantId" = 't-mig'`);
const OLD = sql(`SELECT md5(string_agg(t::text, '|' ORDER BY id)) FROM "RentalOrder" t`);

const browser = await chromium.launch();
async function as(email, password) {
  const tok = await login(email, password);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.addInitScript(([a, r]) => { localStorage.setItem('token', a); localStorage.setItem('refreshToken', r); }, [tok.accessToken, tok.refreshToken]);
  return ctx;
}
const owner = await as('mig-owner@example.test', 'MigOwner12345');
const openEdit = async (ctx, id) => {
  const p = await ctx.newPage();
  await p.goto(`${ADMIN}/dashboard/products/${id}/edit`, { waitUntil: 'networkidle', timeout: 180000 });
  await p.getByTestId('dp-control').waitFor({ timeout: 60000 });
  return p;
};

console.log(`real admin ${ADMIN} -> real API -> it_mig`);
await check('not-reviewed product: shows "Not reviewed", effective 40 % (this product), no option preselected', async () => {
  const p = await openEdit(owner, 'p-expl');
  await p.getByTestId('dp-not-reviewed').waitFor();
  const eff = await p.getByTestId('dp-effective').innerText();
  assert(/40%/.test(eff) && /own setting/.test(eff), eff);
  assert(!(await p.getByTestId('dp-inherit').isChecked()) && !(await p.getByTestId('dp-custom').isChecked()), 'an option was preselected');
  assert(await p.getByTestId('dp-save').isDisabled(), 'save enabled without a choice');
  await p.close();
});
await check('Inherit shows the shop default (currently 25%) and saving switches the product; old bookings untouched', async () => {
  const p = await openEdit(owner, 'p-expl');
  const label = await p.locator('label', { has: p.getByTestId('dp-inherit') }).innerText();
  assert(/currently 25%/.test(label), label);
  await p.getByTestId('dp-inherit').check();
  await p.getByTestId('dp-save').click();
  await p.getByText(/Down payment saved/).waitFor();
  const eff = await p.getByTestId('dp-effective').innerText();
  assert(/25%/.test(eff) && /shop default/.test(eff), eff);
  assert(sql(`SELECT "rentalDownPaymentMode"||'/'||COALESCE("rentalDownPaymentPct"::text,'NULL') FROM "Product" WHERE id='p-expl'`) === 'INHERIT/NULL', 'db');
  assert(sql(`SELECT md5(string_agg(t::text, '|' ORDER BY id)) FROM "RentalOrder" t`) === OLD, 'bookings changed');
  await p.close();
});
await check('Custom 0 % saves as an explicit 0; out-of-range input keeps Save disabled', async () => {
  const p = await openEdit(owner, 'p-expl');
  await p.getByTestId('dp-custom').check();
  await p.getByTestId('dp-pct').fill('150');
  assert(await p.getByTestId('dp-save').isDisabled(), '150 % allowed');
  await p.getByTestId('dp-pct').fill('0');
  await p.getByTestId('dp-save').click();
  await p.getByText(/Down payment saved/).waitFor();
  assert(/0%/.test(await p.getByTestId('dp-effective').innerText()), 'effective not 0 %');
  assert(sql(`SELECT "rentalDownPaymentMode"||'/'||"rentalDownPaymentPct" FROM "Product" WHERE id='p-expl'`) === 'CUSTOM/0', 'db');
  await p.close();
});
await check('the product form\'s own Save leaves the setting alone', async () => {
  const p = await openEdit(owner, 'p-expl');
  const slugBefore = sql(`SELECT slug FROM "Product" WHERE id='p-expl'`);
  const name = p.getByPlaceholder('e.g. Elegant Evening Gown');
  await name.fill('Explicit 40 (edited)');
  await p.getByRole('button', { name: 'Update Product' }).click();
  await p.waitForTimeout(3000);
  assert(sql(`SELECT name FROM "Product" WHERE id='p-expl'`).includes('edited'), 'product save did not happen');
  assert(sql(`SELECT "rentalDownPaymentMode"||'/'||"rentalDownPaymentPct" FROM "Product" WHERE id='p-expl'`) === 'CUSTOM/0', 'down payment changed by the form save');
  if (process.env.IT_PR11 === '1') {
    const slugAfter = sql(`SELECT slug FROM "Product" WHERE id='p-expl'`);
    assert(slugAfter === slugBefore, `[PR #11] slug changed on save: ${slugBefore} -> ${slugAfter}`);
    return `[with PR #11] slug kept: ${slugAfter}`;
  }
  await p.close();
});
await check('someone else changed it meanwhile → "Nothing was saved", current setting shown', async () => {
  const p = await openEdit(owner, 'p-expl');
  sql(`UPDATE "Product" SET "rentalDownPaymentMode" = 'CUSTOM', "rentalDownPaymentPct" = 35 WHERE id = 'p-expl'`);
  await p.getByTestId('dp-inherit').check();
  await p.getByTestId('dp-save').click();
  await p.getByTestId('dp-error').waitFor();
  assert(/Nothing was saved/.test(await p.getByTestId('dp-error').innerText()), 'message');
  assert(/35%/.test(await p.getByTestId('dp-effective').innerText()), 'current not shown');
  assert(sql(`SELECT "rentalDownPaymentMode"||'/'||"rentalDownPaymentPct" FROM "Product" WHERE id='p-expl'`) === 'CUSTOM/35', 'overwritten');
  await p.close();
});
await check('STAFF admin: can see the setting, cannot change it (permission message)', async () => {
  const staff = await as('mig-staff@example.test', 'MigStaff12345');
  const p = await openEdit(staff, 'p-expl');
  await p.getByTestId('dp-inherit').check();
  await p.getByTestId('dp-save').click();
  await p.getByTestId('dp-error').waitFor();
  assert(/Manage Rental Down-Payment Terms/.test(await p.getByTestId('dp-error').innerText()), 'message');
  assert(sql(`SELECT "rentalDownPaymentMode"||'/'||"rentalDownPaymentPct" FROM "Product" WHERE id='p-expl'`) === 'CUSTOM/35', 'changed by staff');
  await p.close();
});
await check('new product page: "New products inherit the shop default (currently 25%)"', async () => {
  const p = await owner.newPage();
  await p.goto(`${ADMIN}/dashboard/products/new`, { waitUntil: 'networkidle', timeout: 180000 });
  await p.locator('select').filter({ hasText: /Rental Only/ }).first().selectOption('RENTAL_ONLY');
  await p.getByTestId('dp-new-product').waitFor({ timeout: 60000 });
  assert(/currently 25%/.test(await p.getByTestId('dp-new-product').innerText()), 'text');
  await p.close();
});
await browser.close();
const failed = results.filter((r) => r === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} admin browser checks passed`);
process.exit(failed ? 1 : 0);
