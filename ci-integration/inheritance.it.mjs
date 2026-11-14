// Real API + isolated Postgres (schema it_mig, migrated from production's
// current migration set + legacy data). Down-payment inheritance end to end.
// Local only: refuses anything but localhost.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const API = 'http://localhost:4100/api/v1';
const T = 't-mig';
const LOG = process.argv[2];
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe';
const sql = (q) => execFileSync(PSQL, ['-U', 'naro_admin', '-h', 'localhost', '-d', 'naro_fashion', '-qAt', '-v', 'ON_ERROR_STOP=1',
  '-c', `SET search_path TO it_mig; ${q}`], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8' }).trim();
async function call(method, path, { token, body, tenant = T } = {}) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenant, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data };
}
const results = [];
async function check(name, fn) {
  try { const n = await fn(); results.push('PASS'); console.log(`  ✔ ${name}${n ? `  — ${n}` : ''}`); }
  catch (e) { results.push('FAIL'); console.log(`  ✖ ${name}\n      ${String(e?.message || e).split('\n')[0]}`); }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };
const login = async (email, password, audience) => (await call('POST', '/auth/login', { body: { email, password, ...(audience ? { audience } : {}) } })).data?.accessToken;
const quote = async (pid) => (await call('GET', `/rentals/quote/${pid}`)).data;
const bookingsHash = () => sql(`SELECT md5(string_agg(t::text, '|' ORDER BY id)) FROM "RentalOrder" t WHERE id = 'r-old'`);
const OLD_BOOKING = bookingsHash();
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

console.log(`real API ${API} · isolated schema it_mig (migrated, legacy data; shop default 30 %)`);
const owner = await login('mig-owner@example.test', 'MigOwner12345');
const staff = await login('mig-staff@example.test', 'MigStaff12345');
const customer = await login('mig-customer@example.test', 'MigTest12345', 'customer');
await check('owner, staff and customer sign in', async () => { if (!owner || !staff || !customer) throw new Error(`tokens ${!!owner}/${!!staff}/${!!customer}`); });

console.log('\nafter the migration, before anyone chooses');
await check('legacy product keeps its stored 25 % although the shop default is 30 % (no silent change)', async () => {
  eq([(await quote('p-leg1')).downPaymentPct, (await quote('p-leg1')).downPayment], [25, 35000], 'quote');
});
await check('the SQL-set 40 % product keeps 40 %', async () => eq((await quote('p-expl')).downPaymentPct, 40, 'quote'));
await check('admin view: NOT_REVIEWED, stored 25, effective 25 (this product), shop 30', async () => {
  const r = await call('GET', '/products/p-leg1/rental-down-payment', { token: owner });
  eq([r.status, r.data.mode, r.data.storedPct, r.data.effectivePct, r.data.effectiveSource, r.data.shopPct], [200, 'NOT_REVIEWED', 25, 25, 'product', 30], 'view');
});
await check('a customer cannot read the admin view (401/403)', async () => {
  const r = await call('GET', '/products/p-leg1/rental-down-payment', { token: customer });
  if (![401, 403].includes(r.status)) throw new Error(`status ${r.status}`);
});

if (process.env.IT_ROUNDING === '1') {
  await check('[with PR #12] legacy 25 % on a 250 fee: quote 63 (whole TZS, rounded up), remaining 237', async () => {
    const q = await quote('p-leg3');
    eq([q.downPaymentPct, q.downPayment, q.remaining, q.total], [25, 63, 237, 300], 'quote');
  });
}
console.log('\npermission and validation');
await check('STAFF admin without rental-policies:manage → 403, nothing changed', async () => {
  const r = await call('PATCH', '/products/p-leg1/rental-down-payment', { token: staff, body: { mode: 'INHERIT', expectedMode: 'NOT_REVIEWED', expectedPct: 25 } });
  eq(r.status, 403, 'status');
  eq(sql(`SELECT COALESCE("rentalDownPaymentMode",'NULL')||'/'||"rentalDownPaymentPct" FROM "Product" WHERE id='p-leg1'`), 'NULL/25', 'row');
});
await check('invalid values → 400 (101 %, 12.5 %, CUSTOM without %, INHERIT with %)', async () => {
  for (const body of [
    { mode: 'CUSTOM', pct: 101, expectedMode: 'NOT_REVIEWED', expectedPct: 25 },
    { mode: 'CUSTOM', pct: 12.5, expectedMode: 'NOT_REVIEWED', expectedPct: 25 },
    { mode: 'CUSTOM', expectedMode: 'NOT_REVIEWED', expectedPct: 25 },
    { mode: 'INHERIT', pct: 30, expectedMode: 'NOT_REVIEWED', expectedPct: 25 },
  ]) eq((await call('PATCH', '/products/p-leg1/rental-down-payment', { token: owner, body })).status, 400, JSON.stringify(body));
});
await check('an ordinary product save cannot carry the setting (400) and does not change it', async () => {
  eq((await call('PATCH', '/products/p-leg1', { token: owner, body: { rentalDownPaymentPct: 10 } })).status, 400, 'pct in product PATCH');
  eq((await call('PATCH', '/products/p-leg1', { token: owner, body: { rentalDownPaymentMode: 'INHERIT' } })).status, 400, 'mode in product PATCH');
  const r = await call('PATCH', '/products/p-leg1', { token: owner, body: { name: 'Legacy Gown 1 (renamed)' } });
  eq(r.status, 200, `ordinary save ${JSON.stringify(r.data).slice(0, 120)}`);
  eq(sql(`SELECT COALESCE("rentalDownPaymentMode",'NULL')||'/'||"rentalDownPaymentPct" FROM "Product" WHERE id='p-leg1'`), 'NULL/25', 'row after save');
});

console.log('\nowner chooses');
await check('legacy → INHERIT: effective becomes the shop 30 %; quote follows; audited; OLD BOOKING UNCHANGED', async () => {
  const r = await call('PATCH', '/products/p-leg1/rental-down-payment', { token: owner, body: { mode: 'INHERIT', expectedMode: 'NOT_REVIEWED', expectedPct: 25 } });
  eq([r.status, r.data.mode, r.data.effectivePct, r.data.effectiveSource], [200, 'INHERIT', 30, 'shop'], 'response');
  eq((await quote('p-leg1')).downPayment, 42000, 'quote');
  eq(bookingsHash(), OLD_BOOKING, 'existing booking row');
  eq(sql(`SELECT "downPaymentAmount"::text FROM "RentalOrder" WHERE id='r-old'`), '35000.00', 'old booking keeps 35,000');
  const a = sql(`SELECT action||'|'||(details->'before'->>'effectivePct')||'>'||(details->'after'->>'effectivePct') FROM "AdminActivityLog" WHERE "entityId"='p-leg1' AND action='UPDATE_DOWN_PAYMENT' ORDER BY "createdAt" DESC LIMIT 1`);
  eq(a, 'UPDATE_DOWN_PAYMENT|25>30', 'audit');
  return 'audit UPDATE_DOWN_PAYMENT 25→30; booking r-old still 35,000 (md5 unchanged)';
});
await check('a stale second save (saw NOT_REVIEWED) → 409 DOWN_PAYMENT_CHANGED with the current setting', async () => {
  const r = await call('PATCH', '/products/p-leg1/rental-down-payment', { token: owner, body: { mode: 'CUSTOM', pct: 10, expectedMode: 'NOT_REVIEWED', expectedPct: 25 } });
  eq([r.status, r.data?.code, r.data?.current?.mode], [409, 'DOWN_PAYMENT_CHANGED', 'INHERIT'], 'response');
});
await check('CUSTOM 0 %: quote 0, booking stores 0 (explicit 0 is not "absent")', async () => {
  const r = await call('PATCH', '/products/p-leg3/rental-down-payment', { token: owner, body: { mode: 'CUSTOM', pct: 0, expectedMode: 'NOT_REVIEWED', expectedPct: 25 } });
  eq([r.status, r.data.effectivePct], [200, 0], 'set');
  const q = await quote('p-leg3');
  eq([q.downPaymentPct, q.downPayment, q.remaining], [0, 0, 300], 'quote');
  const b = await call('POST', '/rentals', { token: customer, body: { productId: 'p-leg3', variantId: 'v-leg3', startDate: day(40), returnDate: day(42), pickupDate: day(40), quotedRentalFee: 250, quotedDeposit: 50, quotedDownPayment: 0 } });
  eq(b.status, 201, `book ${JSON.stringify(b.data).slice(0, 140)}`);
  eq(sql(`SELECT "downPaymentAmount"::text FROM "RentalOrder" WHERE id='${b.data.id}'`), '0.00', 'stored');
});
await check('new product via the admin API is created as INHERIT with no % of its own; quote = shop 30 %', async () => {
  const r = await call('POST', '/products', { token: owner, body: { name: 'Brand New Gown', description: 'Integration test gown', categoryId: 'c-1', price: 900000, availabilityMode: 'RENTAL_ONLY', rentalPricePerDay: 100000, rentalDepositAmount: 0, variants: [{ name: 'Standard', sku: 'MIG-NEW', price: 900000, stock: 1 }] } });
  eq(r.status, 201, `create ${JSON.stringify(r.data).slice(0, 160)}`);
  eq(sql(`SELECT "rentalDownPaymentMode"||'/'||COALESCE("rentalDownPaymentPct"::text,'NULL') FROM "Product" WHERE id='${r.data.id}'`), 'INHERIT/NULL', 'stored');
  eq((await quote(r.data.id)).downPaymentPct, 30, 'quote');
});

console.log('\npolicy changes while a booking form is open');
await check('admin switches a product from its stored 25 % to INHERIT (30 %) after the customer\'s quote → booking refused, nothing stored', async () => {
  const shown = await quote('p-leg2'); // 25 %
  await call('PATCH', '/products/p-leg2/rental-down-payment', { token: owner, body: { mode: 'INHERIT', expectedMode: 'NOT_REVIEWED', expectedPct: 25 } });
  const before = sql(`SELECT count(*) FROM "RentalOrder" WHERE "productId"='p-leg2'`);
  const b = await call('POST', '/rentals', { token: customer, body: { productId: 'p-leg2', variantId: 'v-leg2', startDate: day(50), returnDate: day(52), pickupDate: day(50), quotedRentalFee: shown.rentalFee, quotedDeposit: shown.deposit, quotedDownPayment: shown.downPayment } });
  eq([b.status, b.data?.code, b.data?.current?.downPayment], [409, 'RENTAL_TERMS_CHANGED', 42000], 'refused');
  eq(sql(`SELECT count(*) FROM "RentalOrder" WHERE "productId"='p-leg2'`), before, 'nothing stored');
  return `shown ${shown.downPayment}, now ${b.data.current.downPayment}`;
});
await check('shop default changed 30 → 25 % (the owner\'s setting): INHERIT products follow, CUSTOM / not-reviewed don\'t, old booking untouched', async () => {
  const r = await call('PATCH', '/rental-policies', { token: owner, body: { defaultDownPaymentPct: 25 } });
  if (r.status >= 300) throw new Error(`policy patch ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  eq([(await quote('p-leg1')).downPaymentPct, (await quote('p-leg2')).downPaymentPct, (await quote('p-expl')).downPaymentPct, (await quote('p-leg3')).downPaymentPct], [25, 25, 40, 0], 'INHERIT, INHERIT, not reviewed 40, CUSTOM 0');
  eq(bookingsHash(), OLD_BOOKING, 'existing booking row');
});
await check('an invalid mode stored by SQL is ignored and logged (the product % still applies)', async () => {
  sql(`UPDATE "Product" SET "rentalDownPaymentMode" = 'SHOP' WHERE id = 'p-expl'`);
  eq((await quote('p-expl')).downPaymentPct, 40, 'quote');
  sql(`UPDATE "Product" SET "rentalDownPaymentMode" = NULL WHERE id = 'p-expl'`);
  const line = readFileSync(LOG, 'utf8').split('\n').find((l) => l.includes('invalid product down-payment mode ignored') && l.includes('p-expl'));
  if (!line) throw new Error('no warning');
  if (!line.includes("using the product's stored % (40%)")) throw new Error(line);
  return line.replace(/\x1b\[[0-9;]*m/g, '').replace(/^.*\[RENTAL_TERMS\]/, '[RENTAL_TERMS]').slice(0, 120);
});

const failed = results.filter((r) => r === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} inheritance integration checks passed`);
process.exit(failed ? 1 : 0);
