// Round 25F B: inventory authorization security fix — real API + real
// Postgres on the PRODUCTION BASELINE build (fix/inventory-authorization).
// Isolated schema it_inv seeded by inventory-sec-seed.js. Never production.
//   PSQL=<psql> [IT_API=..] node inventory-sec.it.mjs <ids.json>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const ids = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const API = (process.env.IT_API || 'http://localhost:4135/api/v1').replace(/\/$/, '');
const SCHEMA = process.env.IT_SCHEMA || 'it_inv';
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe';
const HOST = process.env.PGHOST || 'localhost';
if (!/^(localhost|127\.0\.0\.1)$/.test(HOST)) throw new Error('refusing: local/CI database only');
const sql = (q) => execFileSync(PSQL, ['-U', 'naro_admin', '-h', HOST, '-d', 'naro_fashion', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO ${SCHEMA}`, '-c', q], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ip = (s) => { const h = createHash('sha256').update(String(s)).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
async function call(method, p, { token, body, tenant = ids.tenantA, form } = {}) {
  const headers = { 'X-Tenant-Id': tenant, 'X-Forwarded-For': ip(token || body?.email || randomBytes(4).toString('hex')), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (!form) headers['Content-Type'] = 'application/json';
  const r = await fetch(API + p, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
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
for (const k of ['super', 'staff', 'inventory', 'roleAdmin']) tok[k] = await login(ids.admins[k]);
tok.inventoryB = await login(ids.admins.inventoryB, ids.tenantB);
const stock = () => Number(sql(`SELECT stock FROM "ProductVariant" WHERE id = '${ids.variantId}'`));
const adjust = (token, body, tenant) => call('POST', '/inventory/adjust', { token, tenant, body: { productId: ids.productId, variantId: ids.variantId, ...body } });

console.log(`real API ${API} · isolated schema ${SCHEMA} · inventory authorization (round 25F B, production baseline)`);
await check('STAFF (inventory:view only) cannot adjust stock or change stock settings (403); stock unchanged', async () => {
  eq((await adjust(tok.staff, { type: 'RESTOCK', quantity: 5 })).status, 403, 'adjust');
  eq((await call('PATCH', `/inventory/${ids.productId}/settings`, { token: tok.staff, body: { minimumStock: 1 } })).status, 403, 'settings');
  eq(stock(), 10, 'stock');
});
await check('an inventory:manage holder restocks: stock 10 → 15, ledger before/after from the transaction, audit with before/after and actor', async () => {
  const r = await adjust(tok.inventory, { type: 'RESTOCK', quantity: 5, note: 'delivery' });
  eq(r.status, 201, `adjust ${JSON.stringify(r.data).slice(0, 120)}`);
  eq(stock(), 15, 'stock');
  eq(sql(`SELECT "quantityBefore" || '|' || "quantityChange" || '|' || "quantityAfter" || '|' || "performedBy" FROM "InventoryTransaction" WHERE id = '${r.data.id}'`), `10|5|15|${ids.admins.inventory.id}`, 'ledger');
  eq(sql(`SELECT (details->>'before') || '|' || (details->>'after') || '|' || "adminUserId" FROM "AdminActivityLog" WHERE action = 'ADJUST_STOCK' AND "entityId" = '${ids.productId}' ORDER BY "createdAt" DESC LIMIT 1`), `10|15|${ids.admins.inventory.id}`, 'audit');
});
await check('only RESTOCK / ADJUSTMENT / DAMAGE are accepted (SALE → 400)', async () => {
  eq((await adjust(tok.inventory, { type: 'SALE', quantity: 1 })).status, 400, 'SALE');
});
await check('a write-off larger than the stock → 409 INSUFFICIENT_STOCK; nothing written', async () => {
  const before = Number(sql(`SELECT count(*) FROM "InventoryTransaction" WHERE "variantId" = '${ids.variantId}'`));
  const r = await adjust(tok.inventory, { type: 'DAMAGE', quantity: 99 });
  eq([r.status, r.data?.code], [409, 'INSUFFICIENT_STOCK'], 'refused');
  eq([stock(), Number(sql(`SELECT count(*) FROM "InventoryTransaction" WHERE "variantId" = '${ids.variantId}'`))], [15, before], 'unchanged');
});
await check('6 concurrent write-offs of 3 on stock 15 → exactly 5 succeed, stock 0, never negative, ledger chain consistent', async () => {
  const rs = await Promise.all(Array.from({ length: 6 }, () => adjust(tok.inventory, { type: 'DAMAGE', quantity: 3, note: 'race' })));
  eq(rs.filter((r) => r.status === 201).length, 5, `successes ${rs.map((r) => r.status)}`);
  eq(stock(), 0, 'stock');
  eq(sql(`SELECT count(*) FROM "InventoryTransaction" WHERE "variantId" = '${ids.variantId}' AND note = 'race' AND ("quantityAfter" <> "quantityBefore" + "quantityChange" OR "quantityAfter" < 0)`), '0', 'inconsistent rows');
  eq(sql(`SELECT string_agg("quantityAfter"::text, ',' ORDER BY "quantityAfter" DESC) FROM "InventoryTransaction" WHERE "variantId" = '${ids.variantId}' AND note = 'race'`), '12,9,6,3,0', 'each value once');
});
await check('a stale expectedStock → 409 STALE_STOCK, nothing written; the right one works', async () => {
  const r = await adjust(tok.inventory, { type: 'RESTOCK', quantity: 4, expectedStock: 7 });
  eq([r.status, r.data?.code, r.data?.current], [409, 'STALE_STOCK', 0], 'stale');
  eq((await adjust(tok.inventory, { type: 'RESTOCK', quantity: 4, expectedStock: 0 })).status, 201, 'fresh');
  eq(stock(), 4, 'stock');
});
await check('settings by an inventory:manage holder → audited with before/after', async () => {
  const was = sql(`SELECT "minimumStock" FROM "Product" WHERE id = '${ids.productId}'`);
  eq((await call('PATCH', `/inventory/${ids.productId}/settings`, { token: tok.inventory, body: { minimumStock: 3 } })).status, 200, 'settings');
  eq(sql(`SELECT (details->'before'->>'minimumStock') || '|' || (details->'after'->>'minimumStock') FROM "AdminActivityLog" WHERE action = 'UPDATE_INVENTORY_SETTINGS' AND "entityId" = '${ids.productId}' ORDER BY "createdAt" DESC LIMIT 1`), `${was}|3`, 'audit');
});
await check('the product form can no longer change an existing size\'s stock (409 STOCK_EDIT_NOT_ALLOWED, even SUPER_ADMIN); re-sending the same stock is fine', async () => {
  const r = await call('PATCH', `/products/${ids.productId}`, { token: tok.super, body: { variants: [{ id: ids.variantId, name: 'M', price: 100000, stock: 50 }] } });
  eq([r.status, r.data?.code], [409, 'STOCK_EDIT_NOT_ALLOWED'], 'changed stock');
  eq(stock(), 4, 'unchanged');
  eq((await call('PATCH', `/products/${ids.productId}`, { token: tok.super, body: { variants: [{ id: ids.variantId, name: 'M', price: 100000, stock: 4 }] } })).status, 200, 'same stock');
});
await check('opening stock needs inventory:manage: STAFF → 403 (create) and a failed CSV row; with 0 stock STAFF can create; an inventory holder can set opening stock', async () => {
  const base = { description: 'd', price: 1000, categoryId: ids.categoryId, availabilityMode: 'PURCHASE_ONLY' };
  const s1 = await call('POST', '/products', { token: tok.staff, body: { ...base, name: 'Staff stock', variants: [{ name: 'S', price: 1000, stock: 7 }] } });
  eq([s1.status, s1.data?.code], [403, 'INVENTORY_PERMISSION_REQUIRED'], 'staff opening stock');
  eq((await call('POST', '/products', { token: tok.staff, body: { ...base, name: 'Staff zero', variants: [{ name: 'S', price: 1000, stock: 0 }] } })).status, 201, 'staff zero stock');
  eq((await call('POST', '/products', { token: tok.inventory, body: { ...base, name: 'Inv stock', variants: [{ name: 'S', price: 1000, stock: 7 }] } })).status, 201, 'inventory opening stock');
  const fd = new FormData();
  fd.append('file', new Blob(['name,description,price,categorySlug,stock\nCsv Gown,Nice,5000,gowns-it-inv,3\n'], { type: 'text/csv' }), 'import.csv');
  const imp = await call('POST', '/products/bulk-import', { token: tok.staff, form: fd });
  eq([imp.data?.created, imp.data?.failed], [0, 1], `csv ${JSON.stringify(imp.data).slice(0, 160)}`);
  assert(/inventory:manage/.test(JSON.stringify(imp.data?.errors ?? [])), 'row error names the permission');
});
await check('no self-granted bypass: a roles:manage holder can\'t add inventory:manage to their own role (403 OWN_ROLE) nor grant it to another role (403 BEYOND_OWN_PERMISSIONS); still 403 on adjust', async () => {
  const invPerm = sql(`SELECT id FROM "Permission" WHERE code = 'inventory:manage'`);
  const own = await call('POST', `/roles/${ids.roles.roleAdmin}/permissions`, { token: tok.roleAdmin, body: { permissionIds: [invPerm] } });
  eq([own.status, own.data?.code], [403, 'OWN_ROLE'], 'own role');
  const other = await call('POST', `/roles/${ids.roles.spare}/permissions`, { token: tok.roleAdmin, body: { permissionIds: [invPerm] } });
  eq([other.status, other.data?.code], [403, 'BEYOND_OWN_PERMISSIONS'], 'beyond own');
  eq(sql(`SELECT count(*) FROM "RolePermission" WHERE "permissionId" = '${invPerm}' AND "roleId" IN ('${ids.roles.roleAdmin}', '${ids.roles.spare}')`), '0', 'nothing granted');
  eq((await adjust(tok.roleAdmin, { type: 'RESTOCK', quantity: 1 })).status, 403, 'still no adjust');
});
await check('shop isolation: another shop\'s inventory:manage holder can\'t touch this shop\'s product (404), with either shop header', async () => {
  eq((await adjust(tok.inventoryB, { type: 'RESTOCK', quantity: 1 }, ids.tenantB)).status, 404, 'own header');
  const cross = await adjust(tok.inventoryB, { type: 'RESTOCK', quantity: 1 }, ids.tenantA);
  assert([403, 404].includes(cross.status), `cross header ${cross.status}`);
  eq(stock(), 4, 'unchanged');
});

const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
