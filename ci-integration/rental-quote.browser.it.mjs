// Real browser + real local API + real (isolated) database. No mocks.
// Storefront on http://localhost:3101 (NEXT_PUBLIC_API_URL -> local API 4100,
// NEXT_PUBLIC_TENANT_SLUG=it-shop). Settings are changed with SQL in it_quote.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const WT = process.argv[3];
const require = createRequire(WT + '/apps/storefront/package.json');
const { chromium } = require('playwright');
const ids = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const SF = 'http://localhost:3101';
const API = 'http://localhost:4100/api/v1';
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe';
const sql = (q) => execFileSync(PSQL, ['-U', 'naro_admin', '-h', 'localhost', '-d', 'naro_fashion', '-qAt', '-v', 'ON_ERROR_STOP=1',
  '-c', `SET search_path TO it_quote; ${q}`], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8' }).trim();
const setShop = (v) => sql(`UPDATE "RentalPolicy" SET "defaultDownPaymentPct" = ${v} WHERE "tenantId" = '${ids.tenantA}'`);
const setProd = (v, pid) => sql(`UPDATE "Product" SET "rentalDownPaymentPct" = ${v === null ? 'NULL' : v} WHERE id = '${pid}'`);
const isoIn = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
const results = [];
async function check(name, fn) {
  try { const n = await fn(); results.push('PASS'); console.log(`  ✔ ${name}${n ? `  — ${n}` : ''}`); }
  catch (e) { results.push('FAIL'); console.log(`  ✖ ${name}\n      ${String(e?.message || e).split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const open = async (c, path) => { const p = await c.newPage(); await p.goto(SF + path, { waitUntil: 'networkidle', timeout: 180000 }); return p; };
const pick = async (p, start) => {
  const d = p.locator('input[type="date"]');
  await d.nth(0).fill(isoIn(start)); await d.nth(1).fill(isoIn(start + 2));
  await p.getByTestId('rental-available').waitFor({ timeout: 60000 });
};

console.log(`real storefront ${SF} -> real API ${API} -> isolated schema it_quote`);
setProd(null, ids.gown.id); setProd(null, ids.gown2.id); setShop(30);

await check('booking page shows the REAL server quote: shop default 30 % → TSh 42,000', async () => {
  const p = await open(ctx, '/rentals/it-gown');
  await pick(p, 300);
  const box = await p.getByTestId('rental-price-breakdown').innerText();
  assert(/\(30%/.test(box) && /42,000/.test(box) && /448,000/.test(box) && /350,000/.test(box), box.replace(/\s+/g, ' '));
  await p.close();
  return 'fee 140,000 · deposit 350,000 · down payment 42,000 · remaining 448,000';
});
await check('product override 25 % beats the shop 30 % on the page', async () => {
  setProd(25, ids.gown.id);
  const p = await open(ctx, '/rentals/it-gown');
  await pick(p, 300);
  assert(/35,000/.test(await p.getByTestId('rental-down-payment').innerText()), 'not 35,000');
  await p.close();
  setProd(null, ids.gown.id);
});
await check('product 0 %: "No down payment required"', async () => {
  setProd(0, ids.gown.id);
  const p = await open(ctx, '/rentals/it-gown');
  await pick(p, 300);
  await p.getByTestId('rental-no-down-payment').waitFor();
  await p.close();
  setProd(null, ids.gown.id);
});
await check('"How it works" with the real API: general wording at 30 %, "no down payment" at shop 0 %', async () => {
  let p = await open(ctx, '/rentals');
  await p.getByText('Pay the required down payment to confirm your rental booking. The exact amount will be shown before confirmation.').waitFor();
  await p.close();
  setShop(0);
  p = await open(ctx, '/rentals');
  await p.getByText(/No down payment is required to confirm your rental booking/).waitFor();
  await p.close();
  setShop(30);
});

const sw = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await sw.addCookies([{ name: 'locale', value: 'sw', url: SF }]);
await sw.addInitScript(() => { localStorage.setItem('locale', 'sw'); });
await check('Swahili with the real API: kianzio 30 % and the How-it-works text', async () => {
  const p = await open(sw, '/rentals/it-gown');
  await pick(p, 300);
  const box = await p.getByTestId('rental-price-breakdown').innerText();
  assert(/Kianzio \(30% ya ada ya kukodi\)/.test(box) && /42,000/.test(box), box.replace(/\s+/g, ' '));
  await p.goto(SF + '/rentals', { waitUntil: 'networkidle' });
  await p.getByText('Lipa kianzio kinachohitajika ili kuthibitisha nafasi yako ya kukodi. Kiasi halisi kitaonyeshwa kabla ya kuthibitisha.').waitFor();
  await p.close();
});

// signed-in, real booking + a real policy change between page load and submit
const login = await (await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': ids.tenantA },
  body: JSON.stringify({ email: ids.customer.email, password: ids.customer.password, audience: 'customer' }),
})).json();
const signed = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await signed.addInitScript(([a, r]) => { localStorage.setItem('token', a); if (r) localStorage.setItem('refreshToken', r); }, [login.accessToken, login.refreshToken]);
const count = () => Number(sql(`SELECT count(*) FROM "RentalOrder" WHERE "productId" = '${ids.gown2.id}'`));
await check('real policy change after the page loaded: refused, new amount shown, nothing stored; re-submit books the shown amount', async () => {
  setShop(30);
  const p = await open(signed, '/rentals/it-gown-2');
  await pick(p, 200);
  assert(/42,000/.test(await p.getByTestId('rental-down-payment').innerText()), 'first quote');
  const before = count();
  setShop(40); // the shop raises its default while the customer is on the page
  await p.getByTestId('rental-book').click();
  await p.getByTestId('rental-terms-changed').waitFor({ timeout: 30000 });
  assert(count() === before, 'a booking was stored on unseen terms');
  assert(/56,000/.test(await p.getByTestId('rental-down-payment').innerText()), 'new amount not shown');
  await p.getByTestId('rental-book').click();
  await p.waitForURL(/\/account\/rentals/, { timeout: 60000 });
  assert(count() === before + 1, 'not booked after re-submit');
  const row = sql(`SELECT "downPaymentAmount"::text || '|' || "totalRentalPrice"::text || '|' || "damageDeposit"::text FROM "RentalOrder" WHERE "productId" = '${ids.gown2.id}' ORDER BY "createdAt" DESC LIMIT 1`);
  assert(row === '56000.00|140000.00|350000.00', `stored ${row}`);
  await p.close();
  setShop(30);
  return `stored ${row.replace(/\|/g, ' / ')} (down payment / fee / deposit) = what the page showed`;
});

await browser.close();
const failed = results.filter((r) => r === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} real-API browser checks passed`);
process.exit(failed ? 1 : 0);
