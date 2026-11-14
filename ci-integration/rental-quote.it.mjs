// Real API + real Postgres integration test for the rental quote and booking.
// Targets ONLY a local API (default http://localhost:4100) running against the
// isolated schema it_quote of the local dev database. Never production.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const API = (process.env.IT_API || 'http://localhost:4100/api/v1').replace(/\/$/, '');
const ids = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const LOG = process.argv[3];
if (!/^http:\/\/localhost:/.test(API)) throw new Error('refusing: IT_API must be localhost');
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe';

function sql(q) {
  return execFileSync(PSQL, ['-U', 'naro_admin', '-h', 'localhost', '-d', 'naro_fashion', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-c', `SET search_path TO it_quote; ${q}`], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8' }).trim();
}
const setProductPct = (v, pid = ids.gown.id) => sql(`UPDATE "Product" SET "rentalDownPaymentPct" = ${v === null ? 'NULL' : v} WHERE id = '${pid}'`);
// Upsert: one case deletes the shop's policy row, so later cases must re-create it.
const setShopPct = (v) => {
  if (sql(`SELECT count(*) FROM "RentalPolicy" WHERE "tenantId" = '${ids.tenantA}'`) === '0') {
    sql(`INSERT INTO "RentalPolicy" (id, "tenantId", "defaultDownPaymentPct", "updatedAt") VALUES ('it-pol-a', '${ids.tenantA}', ${v}, now())`);
  } else sql(`UPDATE "RentalPolicy" SET "defaultDownPaymentPct" = ${v} WHERE "tenantId" = '${ids.tenantA}'`);
  if (sql(`SELECT "defaultDownPaymentPct" FROM "RentalPolicy" WHERE "tenantId" = '${ids.tenantA}'`) !== String(v)) throw new Error('shop % not set');
};

async function call(method, path, { tenant = ids.tenantA, token, body, ip } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json', 'X-Tenant-Id': tenant,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      // as nginx forwards it; a loopback request WITHOUT this header is the
      // API's own in-process traffic, which the throttler exempts by design
      ...(ip ? { 'X-Forwarded-For': ip } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
}
const quote = (pid = ids.gown.id, tenant) => call('GET', `/rentals/quote/${pid}`, { tenant });

const results = [];
async function check(name, fn) {
  try { const note = await fn(); results.push(['PASS', name]); console.log(`  ✔ ${name}${note ? `  — ${note}` : ''}`); }
  catch (e) { results.push(['FAIL', name]); console.log(`  ✖ ${name}\n      ${String(e?.message || e).split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

console.log(`real API ${API} · isolated schema it_quote`);

console.log('\nseeded data');
await check('a product created without a down-payment % gets 25 from the DATABASE DEFAULT (not NULL)', async () => {
  eq(sql(`SELECT "rentalDownPaymentPct" FROM "Product" WHERE id = '${ids.gown.id}'`), '25', 'stored %');
  return 'so the shop default never applies to it';
});

console.log('\nprecedence (owner cases) through the real endpoint');
const CASES = [
  ['product override 25 %, shop 30 %', 25, 30, 25, 35000],
  ['product override absent, shop 30 %', null, 30, 30, 42000],
  ['product override 0 %, shop 30 %', 0, 30, 0, 0],
  ['invalid product (150), shop 30 %', 150, 30, 30, 42000],
  ['both absent (shop row removed)', null, null, 25, 35000],
];
for (const [label, prod, shop, pct, dp] of CASES) {
  await check(`${label} → ${pct} % (TSh ${dp})`, async () => {
    setProductPct(prod);
    if (shop === null) sql(`DELETE FROM "RentalPolicy" WHERE "tenantId" = '${ids.tenantA}'`);
    else setShopPct(shop);
    const r = await quote();
    eq(r.status, 200, 'status');
    eq([r.data.downPaymentPct, r.data.downPayment, r.data.remaining], [pct, dp, 490000 - dp], 'terms');
  });
}
await check('the invalid product % was logged as a warning (ids + value, no customer data)', async () => {
  const log = readFileSync(LOG, 'utf8');
  const line = log.split('\n').find((l) => l.includes('[RENTAL_TERMS] invalid product down-payment % ignored') && l.includes(ids.gown.id));
  assert(line, 'no warning in the API log');
  assert(/value="150"/.test(line) && /using the shop default \(30%\)/.test(line), line);
  assert(!/@|\+255|password/i.test(line), 'warning contains personal data');
  return line.replace(/\x1b\[[0-9;]*m/g, '').replace(/^.*\[RENTAL_TERMS\]/, '[RENTAL_TERMS]').slice(0, 150);
});

console.log('\nquote envelope');
setProductPct(null); setShopPct(30);
await check('returns exactly six finite, non-negative amounts', async () => {
  const r = await quote();
  eq(Object.keys(r.data).sort(), ['deposit', 'downPayment', 'downPaymentPct', 'remaining', 'rentalFee', 'total'], 'keys');
  for (const v of Object.values(r.data)) assert(typeof v === 'number' && Number.isFinite(v) && v >= 0, `bad value ${v}`);
  eq(r.data, { rentalFee: 140000, deposit: 350000, downPaymentPct: 30, downPayment: 42000, total: 490000, remaining: 448000 }, 'values');
});
await check('inactive product → 404', async () => eq((await quote(ids.inactive.id)).status, 404, 'status'));
await check('purchase-only product → 404', async () => eq((await quote(ids.saleOnly.id)).status, 404, 'status'));
await check("another tenant's product with this tenant's header → 404", async () => eq((await quote(ids.otherTenant.id)).status, 404, 'status'));
await check('the same product under its own tenant → 200 (its own terms)', async () => {
  const r = await quote(ids.otherTenant.id, ids.tenantB);
  eq(r.status, 200, 'status');
  eq(r.data.downPaymentPct, 25, 'tenant B product (DB default 25 beats B shop 50)');
});
await check('no usable rental price → 422 RENTAL_TERMS_UNAVAILABLE (no NaN quote)', async () => {
  const r = await quote(ids.noFee.id);
  eq([r.status, r.data?.code], [422, 'RENTAL_TERMS_UNAVAILABLE'], 'response');
});
await check('terms-summary: shop 30 % → required; shop 0 % → not required; only that field', async () => {
  const a = await call('GET', '/rentals/terms-summary');
  setShopPct(0);
  const b = await call('GET', '/rentals/terms-summary');
  setShopPct(30);
  eq([a.data, b.data], [{ downPaymentRequired: true }, { downPaymentRequired: false }], 'summary');
});

console.log('\nquote → booking (real create, real rows)');
const login = await call('POST', '/auth/login', { body: { email: ids.customer.email, password: ids.customer.password, audience: 'customer' } });
const token = login.data?.accessToken || login.data?.access_token || login.data?.tokens?.accessToken;
await check('customer signs in (tenant-scoped)', async () => { assert(token, `login ${login.status} ${JSON.stringify(login.data).slice(0, 120)}`); });
const rentals = () => Number(sql(`SELECT count(*) FROM "RentalOrder" WHERE "tenantId" = '${ids.tenantA}'`));
const stored = (id) => sql(`SELECT "totalRentalPrice"::text || '|' || "downPaymentAmount"::text || '|' || "damageDeposit"::text FROM "RentalOrder" WHERE id = '${id}'`);
const book = (pid, vid, start, extra = {}) => call('POST', '/rentals', {
  token, body: { productId: pid, variantId: vid, startDate: day(start), returnDate: day(start + 2), pickupDate: day(start), ...extra },
});

await check('quoted amounts match → 201; the stored row equals the quote', async () => {
  setProductPct(null); setShopPct(25);
  const q = (await quote()).data;
  const r = await book(ids.gown.id, ids.gown.variantId, 30, { quotedRentalFee: q.rentalFee, quotedDeposit: q.deposit, quotedDownPayment: q.downPayment });
  eq(r.status, 201, `create ${JSON.stringify(r.data).slice(0, 160)}`);
  eq(stored(r.data.id), '140000.00|35000.00|350000.00', 'stored fee|down payment|deposit');
  return `quote ${q.downPayment} = stored 35000.00`;
});
await check('shop default changes 25 → 30 % after the quote: 409 RENTAL_TERMS_CHANGED, new terms returned, NOTHING stored', async () => {
  const shown = (await quote(ids.gown2.id)).data; // 25 %
  setProductPct(null, ids.gown2.id);
  const shownNull = (await quote(ids.gown2.id)).data; // product NULL, shop 25 → 25 %
  setShopPct(30);
  const before = rentals();
  const r = await book(ids.gown2.id, ids.gown2.variantId, 30, { quotedRentalFee: shownNull.rentalFee, quotedDeposit: shownNull.deposit, quotedDownPayment: shownNull.downPayment });
  eq([r.status, r.data?.code], [409, 'RENTAL_TERMS_CHANGED'], 'response');
  eq(r.data.current, { rentalFee: 140000, deposit: 350000, downPaymentPct: 30, downPayment: 42000, total: 490000, remaining: 448000 }, 'current');
  eq(rentals(), before, 'rental count');
  return `shown ${shownNull.downPayment} (was ${shown.downPayment}), now ${r.data.current.downPayment}`;
});
await check('re-submitting with the new amounts → 201, stored 42,000', async () => {
  const r = await book(ids.gown2.id, ids.gown2.variantId, 30, { quotedRentalFee: 140000, quotedDeposit: 350000, quotedDownPayment: 42000 });
  eq(r.status, 201, `create ${JSON.stringify(r.data).slice(0, 160)}`);
  eq(stored(r.data.id), '140000.00|42000.00|350000.00', 'stored');
});
await check('a changed rental FEE alone is refused as well', async () => {
  sql(`UPDATE "Product" SET "rentalPricePerDay" = 150000 WHERE id = '${ids.gown.id}'`);
  const r = await book(ids.gown.id, ids.gown.variantId, 70, { quotedRentalFee: 140000, quotedDeposit: 350000, quotedDownPayment: 42000 });
  sql(`UPDATE "Product" SET "rentalPricePerDay" = 140000 WHERE id = '${ids.gown.id}'`);
  eq([r.status, r.data?.code, r.data?.current?.rentalFee], [409, 'RENTAL_TERMS_CHANGED', 150000], 'response');
});
await check('no quoted amounts (quote failed to load) → 201 on the server\'s own terms', async () => {
  const r = await book(ids.gown.id, ids.gown.variantId, 110);
  eq(r.status, 201, `create ${JSON.stringify(r.data).slice(0, 160)}`);
  eq(stored(r.data.id), '140000.00|42000.00|350000.00', 'stored');
});
await check('invalid quoted values are rejected by validation (400), nothing stored', async () => {
  const before = rentals();
  const bad = [{ quotedDownPayment: -1 }, { quotedDownPayment: 'abc' }, { quotedDeposit: 1.001 }, { quotedRentalFee: 1e15 }, { quotedDownPaymentPct: 30 }];
  for (const b of bad) eq((await book(ids.gown.id, ids.gown.variantId, 150, b)).status, 400, JSON.stringify(b));
  eq(rentals(), before, 'rental count');
});
await check('the quote is advisory: a client cannot lower the stored amount by sending its own', async () => {
  const before = rentals();
  const r = await book(ids.gown.id, ids.gown.variantId, 190, { quotedRentalFee: 140000, quotedDeposit: 350000, quotedDownPayment: 1 });
  eq([r.status, rentals()], [409, before], 'refused, nothing stored');
});

if (process.env.IT_ROUNDING === '1') {
  console.log('\nwith PR #12 rounding (trial build)');
  await check('fee 250 / deposit 50 at 25 %: quote 63 (rounded up), remaining 237; booking stores 63', async () => {
    sql(`UPDATE "Product" SET "rentalPricePerDay" = 250, "rentalDepositAmount" = 50, "rentalDownPaymentPct" = 25 WHERE id = '${ids.gown2.id}'`);
    const q = (await quote(ids.gown2.id)).data;
    eq(q, { rentalFee: 250, deposit: 50, downPaymentPct: 25, downPayment: 63, total: 300, remaining: 237 }, 'quote');
    const stale = await book(ids.gown2.id, ids.gown2.variantId, 230, { quotedRentalFee: 250, quotedDeposit: 50, quotedDownPayment: 62.5 });
    eq([stale.status, stale.data?.code], [409, 'RENTAL_TERMS_CHANGED'], 'old unrounded amount refused');
    const r = await book(ids.gown2.id, ids.gown2.variantId, 230, { quotedRentalFee: 250, quotedDeposit: 50, quotedDownPayment: 63 });
    eq(r.status, 201, `create ${JSON.stringify(r.data).slice(0, 160)}`);
    eq(stored(r.data.id), '250.00|63.00|50.00', 'stored fee|down payment|deposit');
    sql(`UPDATE "Product" SET "rentalPricePerDay" = 140000, "rentalDepositAmount" = 350000 WHERE id = '${ids.gown2.id}'`);
    return 'quote 63 = stored 63.00; remaining 237 = 250 + 50 − 63';
  });
}

console.log('\nrate limit');
await check('the public quote is throttled per client (429 within the minute)', async () => {
  let got429 = 0;
  for (let i = 0; i < 70; i += 1) {
    if ((await call('GET', `/rentals/quote/${ids.gown.id}`, { ip: '203.0.113.77' })).status === 429) got429 += 1;
  }
  // a different client is unaffected
  eq((await call('GET', `/rentals/quote/${ids.gown.id}`, { ip: '203.0.113.78' })).status, 200, 'other client');
  assert(got429 > 0, 'never throttled');
  return `${got429} of 70 rapid calls from one client refused (60/min); another client still 200`;
});

const failed = results.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} integration checks passed`);
process.exit(failed ? 1 : 0);
