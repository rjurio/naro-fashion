// Round 25H: PR #42 readiness — the PRODUCTION grant shapes (shared system
// MANAGER / STAFF roles as seeded on boot) against a real API + real Postgres.
// Run once against the production build (EXPECT=old, 3d95365) and once
// against the #42 build (EXPECT=new) on separate fresh schemas: the outcome
// table is the MANAGER / STAFF before-after evidence. Never production.
//   PSQL=<psql> IT_API=.. IT_SCHEMA=it_r42 EXPECT=old|new node manager-compat.it.mjs <ids.json> [<outcomes.json>]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const ids = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const OUT = process.argv[3];
const API = (process.env.IT_API || 'http://localhost:4142/api/v1').replace(/\/$/, '');
const SCHEMA = process.env.IT_SCHEMA || ids.schema || 'it_r42';
const EXPECT = process.env.EXPECT || 'new';
if (!['old', 'new'].includes(EXPECT)) throw new Error('EXPECT=old|new');
const NEW = EXPECT === 'new';
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/18/bin/psql.exe';
const HOST = process.env.PGHOST || 'localhost';
if (!/^(localhost|127\.0\.0\.1)$/.test(HOST)) throw new Error('refusing: local/CI database only');
if (!/^it_[a-z0-9_]+$/.test(SCHEMA)) throw new Error('refusing: isolated it_* schema only');
const sql = (q) => execFileSync(PSQL, ['-U', 'naro_admin', '-h', HOST, '-d', 'naro_fashion', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO ${SCHEMA}`, '-c', q], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\r/g, '').trim();
const ip = (s) => { const h = createHash('sha256').update(String(s)).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
async function call(method, p, { token, body, tenant = ids.tenantA, form, headers: extra = {} } = {}) {
  const headers = { 'X-Tenant-Id': tenant, 'X-Forwarded-For': ip(token || body?.email || randomBytes(4).toString('hex')), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
  if (!form) headers['Content-Type'] = 'application/json';
  const r = await fetch(API + p, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  let data = null; try { data = await r.json(); } catch { /* empty */ }
  return { status: r.status, data, replayed: r.headers.get('idempotency-replayed') };
}
const results = [];
const outcomes = [];
async function check(name, fn) {
  try { const n = await fn(); results.push('PASS'); console.log(`  ✔ ${name}${n ? `  — ${n}` : ''}`); }
  catch (e) { results.push('FAIL'); console.log(`  ✖ ${name}\n      ${String(e?.message || e).split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
const pick = (o, n) => (NEW ? n : o);
const short = (r) => JSON.stringify(r.data ?? null).slice(0, 140);
/** Record an operation's outcome for the before/after table and assert the build's expectation. */
function op(who, what, r, oldWant, newWant) {
  const want = pick(oldWant, newWant);
  const got = Array.isArray(want) ? [r.status, r.data?.code ?? null] : r.status;
  outcomes.push({ who, what, status: r.status, code: r.data?.code ?? null });
  eq(got, want, `${who}: ${what} ${short(r)}`);
}
const login = async (w, tenant) => { const r = await call('POST', '/auth/login', { body: { email: w.email, password: w.password }, tenant }); assert(r.data?.accessToken, `login ${w.email} ${r.status} ${short(r)}`); return r.data.accessToken; };

const A = ids.admins;
const P = ids.products;
const tok = {};
for (const k of ['super', 'manager', 'staff']) tok[k] = await login(A[k]);
tok.managerB = await login(A.managerB, ids.tenantB);
const stockOf = (v) => Number(sql(`SELECT stock FROM "ProductVariant" WHERE id = '${v}'`));
const ledger = (pid) => Number(sql(`SELECT count(*) FROM "InventoryTransaction" WHERE "productId" = '${pid}'`));
const adjust = (token, body, tenant) => call('POST', '/inventory/adjust', { token, tenant, body });
const productRow = (id) => sql(`SELECT coalesce("purchasePrice"::text,'') || '|' || coalesce("minimumStock"::text,'') || '|' || coalesce("supplierName",'') || '|' || coalesce("supplierContact",'') FROM "Product" WHERE id = '${id}'`);
const variantsOf = (pid) => JSON.parse(sql(`SELECT coalesce(json_agg(json_build_object('id', id, 'name', name, 'price', price::float8, 'stock', stock) ORDER BY name), '[]') FROM "ProductVariant" WHERE "productId" = '${pid}' AND "isActive"`));
const csv = (rows) => { const fd = new FormData(); fd.append('file', new Blob([`name,description,price,categorySlug,stock\n${rows}\n`], { type: 'text/csv' }), 'import.csv'); return fd; };
const base = { description: 'd', price: 1000, categoryId: ids.categoryId, availabilityMode: 'PURCHASE_ONLY' };
const uniq = () => randomBytes(5).toString('hex');

console.log(`real API ${API} · schema ${SCHEMA} · EXPECT=${EXPECT} · system MANAGER (${ids.managerCodes.length} codes) / STAFF (${ids.staffCodes.length} codes)`);

await check('grant set: MANAGER = catalogue − MANAGER_EXCLUDED (+ MANAGER_DEFAULT_GRANTS); holds inventory:manage, admins:update, admins:unlock; not roles:manage / admins:create', async () => {
  const excluded = ['admins:create', 'admins:delete', 'roles:manage', 'settings:manage', 'audit:export', 'payments:manage', 'payment-methods:manage', 'recycle-bin:purge'];
  const catalogue = sql(`SELECT string_agg(code, ',' ORDER BY code) FROM "Permission" WHERE "isActive"`).split(',');
  const defaults = ['pos:refund', 'expenses:manage', 'newsletter:send', 'customers:suspend', 'finance:close', 'reports:view', 'expense-categories:manage'];
  const wantMgr = [...new Set([...catalogue.filter((c) => !excluded.includes(c)), ...defaults])].sort();
  eq(ids.managerCodes, wantMgr, 'MANAGER codes');
  for (const c of ['inventory:manage', 'admins:update', 'admins:unlock']) assert(ids.managerCodes.includes(c), `MANAGER lacks ${c}`);
  for (const c of ['roles:manage', 'admins:create']) assert(!ids.managerCodes.includes(c), `MANAGER holds ${c}`);
  assert(!ids.staffCodes.includes('inventory:manage'), 'STAFF holds inventory:manage');
  return `MANAGER ${ids.managerCodes.length}/${catalogue.length} catalogue codes; STAFF ${ids.staffCodes.join(' ')}`;
});

console.log('\n[MANAGER keeps]');
await check('Inventory → Adjust RESTOCK +5 / ADJUSTMENT +2 / DAMAGE 3 (10 → 15 → 17 → 14), ledger rows', async () => {
  const v = P.restock.variants.M;
  op('MANAGER', 'adjust RESTOCK', await adjust(tok.manager, { productId: P.restock.id, variantId: v, type: 'RESTOCK', quantity: 5, note: 'delivery' }), 201, 201);
  op('MANAGER', 'adjust ADJUSTMENT', await adjust(tok.manager, { productId: P.restock.id, variantId: v, type: 'ADJUSTMENT', quantity: 2, note: 'count' }), 201, 201);
  op('MANAGER', 'adjust DAMAGE', await adjust(tok.manager, { productId: P.restock.id, variantId: v, type: 'DAMAGE', quantity: 3, note: 'torn' }), 201, 201);
  eq([stockOf(v), ledger(P.restock.id)], [14, 3], 'stock / ledger');
  if (NEW) eq(sql(`SELECT string_agg((details->>'before') || '>' || (details->>'after'), ',' ORDER BY "createdAt") FROM "AdminActivityLog" WHERE action = 'ADJUST_STOCK' AND "entityId" = '${P.restock.id}'`), '10>15,15>17,17>14', 'audit before/after');
});
await check('Inventory settings (threshold / supplier / cost) and every inventory read', async () => {
  op('MANAGER', 'inventory settings', await call('PATCH', `/inventory/${P.restock.id}/settings`, { token: tok.manager, body: { minimumStock: 4, supplierName: 'Acme 2', purchasePrice: 41000 } }), 200, 200);
  eq(productRow(P.restock.id), '41000.00|4|Acme 2|+255700000001', 'saved');
  for (const p of ['/inventory', '/inventory/low-stock', '/inventory/valuation', `/inventory/${P.restock.id}/transactions`]) {
    op('MANAGER', `GET ${p.replace(P.restock.id, ':id')}`, await call('GET', p, { token: tok.manager }), 200, 200);
  }
});
await check('product create with opening stock; CSV import with stock', async () => {
  const c = await call('POST', '/products', { token: tok.manager, body: { ...base, name: `Mgr stock ${uniq()}`, variants: [{ name: 'S', price: 1000, stock: 7 }] } });
  op('MANAGER', 'create product with opening stock', c, 201, 201);
  eq(variantsOf(c.data.id).map((v) => v.stock), [7], 'opening stock');
  const imp = await call('POST', '/products/bulk-import', { token: tok.manager, form: csv(`Mgr Csv ${uniq()},Nice,5000,${ids.categorySlug},3`) });
  outcomes.push({ who: 'MANAGER', what: 'CSV import with stock', status: imp.status, code: `created=${imp.data?.created} failed=${imp.data?.failed}` });
  eq([imp.data?.created, imp.data?.failed], [1, 0], `csv ${short(imp)}`);
});
await check('product edit without stock change (name / price, same stock re-sent); cost / threshold / supplier via the product form; new size with stock; remove a stocked size', async () => {
  const before = ledger(P.restock.id);
  const vs = variantsOf(P.restock.id);
  op('MANAGER', 'edit name/price (same stock re-sent)', await call('PATCH', `/products/${P.restock.id}`, { token: tok.manager, body: { name: 'R42 Restock Gown v2', price: 110000, variants: vs.map((v) => ({ id: v.id, name: v.name, price: 110000, stock: v.stock })) } }), 200, 200);
  eq([stockOf(P.restock.variants.M), ledger(P.restock.id)], [14, before], 'stock / ledger unchanged');
  op('MANAGER', 'edit cost/threshold/supplier in product form', await call('PATCH', `/products/${P.restock.id}`, { token: tok.manager, body: { purchasePrice: 42000, minimumStock: 5, supplierName: 'Acme 3' } }), 200, 200);
  const sv = variantsOf(P.sizes.id); // L 0, S 5
  op('MANAGER', 'add a new size with stock', await call('PATCH', `/products/${P.sizes.id}`, { token: tok.manager, body: { variants: [...sv.map((v) => ({ id: v.id, name: v.name, price: v.price, stock: v.stock })), { name: 'XL', price: 100000, stock: 2 }] } }), 200, 200);
  const sv2 = variantsOf(P.sizes.id).filter((v) => v.name !== 'S');
  op('MANAGER', 'remove a size holding stock (S=5)', await call('PATCH', `/products/${P.sizes.id}`, { token: tok.manager, body: { variants: sv2.map((v) => ({ id: v.id, name: v.name, price: v.price, stock: v.stock })) } }), 200, 200);
  eq(variantsOf(P.sizes.id).map((v) => `${v.name}:${v.stock}`), ['L:0', 'XL:2'], 'sizes');
});
await check('admins: edit STAFF name + reset password, edit another MANAGER, disable / re-enable STAFF, unlock a locked STAFF', async () => {
  op('MANAGER', 'edit STAFF name', await call('PATCH', `/admin-users/${A.staff2.id}`, { token: tok.manager, body: { firstName: 'Renamed' } }), 200, 200);
  op('MANAGER', 'reset STAFF password', await call('PATCH', `/admin-users/${A.staff2.id}`, { token: tok.manager, body: { password: 'NewPass12345' } }), 200, 200);
  op('MANAGER', 'edit another MANAGER', await call('PATCH', `/admin-users/${A.manager2.id}`, { token: tok.manager, body: { lastName: 'Second' } }), 200, 200);
  op('MANAGER', 'disable STAFF', await call('PATCH', `/admin-users/${A.staff2.id}/toggle`, { token: tok.manager }), 200, 200);
  op('MANAGER', 're-enable STAFF', await call('PATCH', `/admin-users/${A.staff2.id}/toggle`, { token: tok.manager }), 200, 200);
  op('MANAGER', 'unlock a locked STAFF', await call('PATCH', `/admin-users/${A.lockedStaff.id}/unlock`, { token: tok.manager }), 200, 200);
  op('MANAGER', 'own name', await call('PATCH', `/admin-users/${A.manager.id}`, { token: tok.manager, body: { firstName: 'Me' } }), 200, 200);
  for (const p of ['/admin-users', '/roles', `/roles/${ids.systemRoles.manager}/permissions`]) op('MANAGER', `GET ${p.replace(ids.systemRoles.manager, ':id')}`, await call('GET', p, { token: tok.manager }), 200, 200);
});
await check('unchanged by #42: MANAGER can unlock a locked SUPER_ADMIN (admins:unlock has no target check on either build)', async () => {
  op('MANAGER', 'unlock a locked SUPER_ADMIN', await call('PATCH', `/admin-users/${A.lockedSuper.id}/unlock`, { token: tok.manager }), 200, 200);
});
await check('unchanged by #42: MANAGER has no roles:manage / admins:create (403 on both builds)', async () => {
  op('MANAGER', 'create role', await call('POST', '/roles', { token: tok.manager, body: { name: `x-${uniq()}` } }), 403, 403);
  op('MANAGER', 'grant permission to a role', await call('POST', `/roles/${ids.roles.low}/permissions`, { token: tok.manager, body: { permissionIds: [sql(`SELECT id FROM "Permission" WHERE code = 'inventory:manage'`)] } }), 403, 403);
  op('MANAGER', 'restore a role', await call('PATCH', `/roles/${ids.roles.deletedLow}/restore`, { token: tok.manager }), 403, 403);
  op('MANAGER', 'assign a role', await call('POST', `/admin-users/${A.staff2.id}/roles`, { token: tok.manager, body: { roleId: ids.roles.low } }), 403, 403);
  op('MANAGER', 'create admin', await call('POST', '/admin-users', { token: tok.manager, body: { email: `x-${uniq()}@example.test`, password: 'Abcdefgh123', firstName: 'X', lastName: 'Y', role: 'STAFF' } }), 403, 403);
  op('MANAGER', 'edit a SUPER_ADMIN', await call('PATCH', `/admin-users/${A.super2.id}`, { token: tok.manager, body: { firstName: 'Nope' } }), 403, 403);
});

console.log('\n[MANAGER loses with #42 (everyone loses the first three)]');
await check('product form changing an existing size\'s stock: old = silently overwritten (no ledger); new = 409 STOCK_EDIT_NOT_ALLOWED, nothing written', async () => {
  const v = variantsOf(P.restock.id)[0];
  const before = ledger(P.restock.id);
  op('MANAGER', 'stock edit in product form', await call('PATCH', `/products/${P.restock.id}`, { token: tok.manager, body: { variants: [{ id: v.id, name: v.name, price: v.price, stock: 99 }] } }), 200, [409, 'STOCK_EDIT_NOT_ALLOWED']);
  eq([stockOf(v.id), ledger(P.restock.id)], [pick(99, 14), before], 'stock / ledger');
  if (!NEW) sql(`UPDATE "ProductVariant" SET stock = 14 WHERE id = '${v.id}'`); // put back for the next checks
});
await check('adjust types SALE / RETURN / RENTAL_OUT: old = accepted; new = 400', async () => {
  for (const type of ['SALE', 'RETURN', 'RENTAL_OUT']) op('MANAGER', `adjust ${type}`, await adjust(tok.manager, { productId: P.restock.id, variantId: P.restock.variants.M, type, quantity: 1 }), 201, 400);
  if (!NEW) sql(`UPDATE "ProductVariant" SET stock = 14 WHERE id = '${P.restock.variants.M}'`);
});
await check('a write-off larger than the stock: old = stock goes negative; new = 409 INSUFFICIENT_STOCK', async () => {
  op('MANAGER', 'DAMAGE beyond stock', await adjust(tok.manager, { productId: P.restock.id, variantId: P.restock.variants.M, type: 'DAMAGE', quantity: 50 }), 201, [409, 'INSUFFICIENT_STOCK']);
  eq(stockOf(P.restock.variants.M), pick(-36, 14), 'stock');
  if (!NEW) sql(`UPDATE "ProductVariant" SET stock = 14 WHERE id = '${P.restock.variants.M}'`);
});
await check('adjusting a size of ANOTHER product: old = accepted (ledger names the wrong product); new = 404', async () => {
  op('MANAGER', 'adjust another product\'s size', await adjust(tok.manager, { productId: P.restock.id, variantId: P.race.variants.M, type: 'RESTOCK', quantity: 1 }), 201, 404);
  if (!NEW) sql(`UPDATE "ProductVariant" SET stock = 15 WHERE id = '${P.race.variants.M}'`);
});
await check('editing / disabling an admin who holds a code the MANAGER lacks (payments:manage): old = allowed; new = 403 TARGET_HAS_MORE_PERMISSIONS', async () => {
  const was = sql(`SELECT "firstName" || '|' || "isActive"::text FROM "AdminUser" WHERE id = '${A.strong.id}'`);
  op('MANAGER', 'edit a stronger admin (name)', await call('PATCH', `/admin-users/${A.strong.id}`, { token: tok.manager, body: { firstName: 'Taken' } }), 200, [403, 'TARGET_HAS_MORE_PERMISSIONS']);
  op('MANAGER', 'reset a stronger admin\'s password', await call('PATCH', `/admin-users/${A.strong.id}`, { token: tok.manager, body: { password: 'Takeover12345' } }), 200, [403, 'TARGET_HAS_MORE_PERMISSIONS']);
  op('MANAGER', 'disable a stronger admin', await call('PATCH', `/admin-users/${A.strong.id}/toggle`, { token: tok.manager }), 200, [403, 'TARGET_HAS_MORE_PERMISSIONS']);
  if (NEW) eq(sql(`SELECT "firstName" || '|' || "isActive"::text FROM "AdminUser" WHERE id = '${A.strong.id}'`), was, 'untouched');
});
await check('changing their OWN role string: old = allowed; new = 403 OWN_ROLE', async () => {
  op('MANAGER', 'change own role string', await call('PATCH', `/admin-users/${A.manager.id}`, { token: tok.manager, body: { role: 'STAFF' } }), 200, [403, 'OWN_ROLE']);
  eq(sql(`SELECT role FROM "AdminUser" WHERE id = '${A.manager.id}'`), pick('STAFF', 'MANAGER'), 'role string');
  if (!NEW) sql(`UPDATE "AdminUser" SET role = 'MANAGER' WHERE id = '${A.manager.id}'`);
});
if (NEW) {
  await check('new: a stale expectedStock → 409 STALE_STOCK; nothing written', async () => {
    const r = await adjust(tok.manager, { productId: P.restock.id, variantId: P.restock.variants.M, type: 'RESTOCK', quantity: 1, expectedStock: 3 });
    eq([r.status, r.data?.code, r.data?.current], [409, 'STALE_STOCK', 14], 'stale');
    eq(stockOf(P.restock.variants.M), 14, 'unchanged');
  });
}

console.log('\n[atomic, shop-scoped, audited]');
await check('10 parallel DAMAGE 2 on stock 15 as MANAGER: new = exactly 7 succeed, stock 1, never negative, ledger chain + audit before/after per success; old = all 10 succeed, stock −5', async () => {
  const v = P.race.variants.M;
  const rs = await Promise.all(Array.from({ length: 10 }, () => adjust(tok.manager, { productId: P.race.id, variantId: v, type: 'DAMAGE', quantity: 2, note: 'race' })));
  const ok = rs.filter((r) => r.status === 201).length;
  outcomes.push({ who: 'MANAGER', what: '10 parallel DAMAGE 2 on stock 15', status: `${ok} ok`, code: `stock ${stockOf(v)}` });
  eq([ok, stockOf(v)], pick([10, -5], [7, 1]), `successes ${rs.map((r) => r.status)}`);
  if (NEW) {
    eq(rs.filter((r) => r.status === 409).map((r) => r.data?.code), ['INSUFFICIENT_STOCK', 'INSUFFICIENT_STOCK', 'INSUFFICIENT_STOCK'], 'refusals');
    eq(sql(`SELECT count(*) FROM "InventoryTransaction" WHERE "variantId" = '${v}' AND note = 'race' AND ("quantityAfter" <> "quantityBefore" + "quantityChange" OR "quantityAfter" < 0)`), '0', 'inconsistent ledger rows');
    eq(sql(`SELECT string_agg("quantityAfter"::text, ',' ORDER BY "quantityAfter" DESC) FROM "InventoryTransaction" WHERE "variantId" = '${v}' AND note = 'race'`), '13,11,9,7,5,3,1', 'each value once');
    eq(sql(`SELECT count(*) || '|' || count(DISTINCT details->>'after') || '|' || min((details->>'after')::int) || '|' || count(*) FILTER (WHERE "adminUserId" = '${A.manager.id}') FROM "AdminActivityLog" WHERE action = 'ADJUST_STOCK' AND "entityId" = '${P.race.id}'`), `7|7|1|7`, 'audit rows (count|distinct after|min after|by MANAGER)');
  }
});
await check('shop isolation: another shop\'s MANAGER → 404 with their own shop header, 403/404 with this shop\'s header; stock unchanged', async () => {
  const s = stockOf(P.restock.variants.M);
  op('MANAGER shop B', 'adjust shop A product (own header)', await adjust(tok.managerB, { productId: P.restock.id, variantId: P.restock.variants.M, type: 'RESTOCK', quantity: 1 }, ids.tenantB), 404, 404);
  const cross = await adjust(tok.managerB, { productId: P.restock.id, variantId: P.restock.variants.M, type: 'RESTOCK', quantity: 1 }, ids.tenantA);
  outcomes.push({ who: 'MANAGER shop B', what: 'adjust shop A product (shop A header)', status: cross.status, code: cross.data?.code ?? null });
  assert([403, 404].includes(cross.status), `cross header ${cross.status}`);
  op('MANAGER shop B', 'settings on shop A product', await call('PATCH', `/inventory/${P.restock.id}/settings`, { token: tok.managerB, tenant: ids.tenantB, body: { minimumStock: 9 } }), 404, 404);
  op('MANAGER shop B', 'shop-B variant under a shop-A product', await adjust(tok.managerB, { productId: P.restock.id, variantId: P.shopB.variants.M, type: 'RESTOCK', quantity: 1 }, ids.tenantB), 404, 404);
  eq(stockOf(P.restock.variants.M), s, 'unchanged');
});

console.log('\n[STAFF (system STAFF role) — no route around inventory:manage]');
const staffProduct = () => `${variantsOf(P.staff.id).map((v) => `${v.name}:${v.stock}`).join(',')}|${productRow(P.staff.id)}`;
const staffWas = staffProduct();
await check('inventory adjust ×3 types and settings', async () => {
  for (const type of ['RESTOCK', 'ADJUSTMENT', 'DAMAGE']) op('STAFF', `adjust ${type}`, await adjust(tok.staff, { productId: P.staff.id, variantId: P.staff.variants.M, type, quantity: 1 }), 201, 403);
  op('STAFF', 'inventory settings', await call('PATCH', `/inventory/${P.staff.id}/settings`, { token: tok.staff, body: { minimumStock: 0 } }), 200, 403);
  if (!NEW) { sql(`UPDATE "ProductVariant" SET stock = 6 WHERE id = '${P.staff.variants.M}'`); sql(`UPDATE "Product" SET "minimumStock" = 1 WHERE id = '${P.staff.id}'`); }
});
await check('product form: create with stock, CSV with stock, change stock, new size with stock, remove a stocked size, cost / threshold / supplier', async () => {
  op('STAFF', 'create product with opening stock', await call('POST', '/products', { token: tok.staff, body: { ...base, name: `Staff stock ${uniq()}`, variants: [{ name: 'S', price: 1000, stock: 7 }] } }), 201, [403, 'INVENTORY_PERMISSION_REQUIRED']);
  op('STAFF', 'create product with 0 stock', await call('POST', '/products', { token: tok.staff, body: { ...base, name: `Staff zero ${uniq()}`, variants: [{ name: 'S', price: 1000, stock: 0 }] } }), 201, 201);
  const imp = await call('POST', '/products/bulk-import', { token: tok.staff, form: csv(`Staff Csv ${uniq()},Nice,5000,${ids.categorySlug},3`) });
  outcomes.push({ who: 'STAFF', what: 'CSV import with stock', status: imp.status, code: `created=${imp.data?.created} failed=${imp.data?.failed}` });
  eq([imp.data?.created, imp.data?.failed], pick([1, 0], [0, 1]), `csv ${short(imp)}`);
  const vs = variantsOf(P.staff.id); // M 6, S 4
  const same = vs.map((v) => ({ id: v.id, name: v.name, price: v.price, stock: v.stock }));
  op('STAFF', 'stock edit in product form', await call('PATCH', `/products/${P.staff.id}`, { token: tok.staff, body: { variants: same.map((v) => ({ ...v, stock: v.stock + 10 })) } }), 200, [409, 'STOCK_EDIT_NOT_ALLOWED']);
  if (!NEW) { sql(`UPDATE "ProductVariant" SET stock = 6 WHERE id = '${P.staff.variants.M}'`); sql(`UPDATE "ProductVariant" SET stock = 4 WHERE id = '${P.staff.variants.S}'`); }
  op('STAFF', 'add a new size with stock', await call('PATCH', `/products/${P.staff.id}`, { token: tok.staff, body: { variants: [...same, { name: 'XL', price: 100000, stock: 3 }] } }), 200, [403, 'INVENTORY_PERMISSION_REQUIRED']);
  if (!NEW) sql(`DELETE FROM "ProductVariant" WHERE "productId" = '${P.staff.id}' AND name = 'XL'`);
  op('STAFF', 'remove a size holding stock', await call('PATCH', `/products/${P.staff.id}`, { token: tok.staff, body: { variants: same.filter((v) => v.name === 'M') } }), 200, [403, 'INVENTORY_PERMISSION_REQUIRED']);
  if (!NEW) sql(`UPDATE "ProductVariant" SET "isActive" = true WHERE id = '${P.staff.variants.S}'`);
  for (const [k, v] of [['purchasePrice', 1], ['minimumStock', 0], ['supplierName', 'Evil Ltd'], ['supplierContact', '+255799999999']]) {
    op('STAFF', `PATCH /products ${k}`, await call('PATCH', `/products/${P.staff.id}`, { token: tok.staff, body: { [k]: v } }), 200, [403, 'INVENTORY_PERMISSION_REQUIRED']);
  }
  if (!NEW) sql(`UPDATE "Product" SET "purchasePrice" = 30000, "minimumStock" = 1, "supplierName" = 'Beta', "supplierContact" = '+255700000002' WHERE id = '${P.staff.id}'`);
  op('STAFF', 'edit name only (same stock re-sent)', await call('PATCH', `/products/${P.staff.id}`, { token: tok.staff, body: { name: 'R42 Staff Gown v2', variants: same } }), 200, 200);
});
await check('AI routes: STAFF has no ai-agent:use → 403 on the AI draft (with threshold / supplier) and AI inventory reads', async () => {
  op('STAFF', 'AI draft with minimumStock/supplier', await call('POST', '/ai/products/draft', { token: tok.staff, body: { name: `AI ${uniq()}`, categoryId: ids.categoryId, availabilityMode: 'PURCHASE_ONLY', minimumStock: 3, supplierName: 'Evil Ltd' } }), 403, 403);
  op('STAFF', 'AI update-draft request', await call('POST', `/ai/products/${P.staff.id}/update-draft/request-approval`, { token: tok.staff, body: { minimumStock: 0 } }), 403, 403);
  op('STAFF', 'AI inventory read', await call('GET', '/ai/inventory', { token: tok.staff }), 403, 403);
});
await check('offline replay: the same Idempotency-Key re-sent never turns a refusal into a success; a key SUPER_ADMIN used is not replayable by STAFF', async () => {
  const key = `r42-${uniq()}-create`;
  const cid = `r42${uniq()}${uniq()}`.slice(0, 24);
  const body = { ...base, id: cid, name: `Offline ${uniq()}`, variants: [{ name: 'S', price: 1000, stock: 5 }] };
  const r1 = await call('POST', '/products', { token: tok.staff, body, headers: { 'Idempotency-Key': key } });
  const r2 = await call('POST', '/products', { token: tok.staff, body, headers: { 'Idempotency-Key': key } });
  op('STAFF', 'offline create with stock (1st)', r1, 201, [403, 'INVENTORY_PERMISSION_REQUIRED']);
  op('STAFF', 'offline create with stock (replay)', r2, 201, [403, 'INVENTORY_PERMISSION_REQUIRED']);
  if (NEW) eq(sql(`SELECT count(*) FROM "Product" WHERE id = '${cid}'`), '0', 'no product');
  const vs = variantsOf(P.staff.id).map((v) => ({ id: v.id, name: v.name, price: v.price, stock: v.stock }));
  const ukey = `r42-${uniq()}-update`;
  const cur = await call('GET', `/products/by-id/${P.staff.id}`, { token: tok.staff });
  const upd = { expectedUpdatedAt: cur.data?.updatedAt, variants: vs.map((v) => ({ ...v, stock: v.stock + 1 })) };
  op('STAFF', 'offline update stock (1st)', await call('PATCH', `/products/${P.staff.id}`, { token: tok.staff, body: upd, headers: { 'Idempotency-Key': ukey } }), 200, [409, 'STOCK_EDIT_NOT_ALLOWED']);
  op('STAFF', 'offline update stock (replay)', await call('PATCH', `/products/${P.staff.id}`, { token: tok.staff, body: upd, headers: { 'Idempotency-Key': ukey } }), NEW ? 409 : 200, [409, 'STOCK_EDIT_NOT_ALLOWED']);
  if (!NEW) { sql(`UPDATE "ProductVariant" SET stock = 6 WHERE id = '${P.staff.variants.M}'`); sql(`UPDATE "ProductVariant" SET stock = 4 WHERE id = '${P.staff.variants.S}'`); }
  // SUPER_ADMIN's successful key, re-used by STAFF with the same body → runs for STAFF (keys are per principal) → refused
  const skey = `r42-${uniq()}-super`;
  const sbody = { ...base, name: `Super offline ${uniq()}`, variants: [{ name: 'S', price: 1000, stock: 2 }] };
  op('SUPER_ADMIN', 'offline create with stock', await call('POST', '/products', { token: tok.super, body: sbody, headers: { 'Idempotency-Key': skey } }), 201, 201);
  const s2 = await call('POST', '/products', { token: tok.staff, body: sbody, headers: { 'Idempotency-Key': skey } });
  op('STAFF', 'replay SUPER_ADMIN\'s key', s2, 201, [403, 'INVENTORY_PERMISSION_REQUIRED']);
  assert(s2.replayed !== 'true', 'served a stored response to another principal');
});
await check('STAFF: no self-grant route (roles:manage / admins:update absent → 403 both builds)', async () => {
  const inv = sql(`SELECT id FROM "Permission" WHERE code = 'inventory:manage'`);
  op('STAFF', 'grant inventory:manage to a role', await call('POST', `/roles/${ids.roles.low}/permissions`, { token: tok.staff, body: { permissionIds: [inv] } }), 403, 403);
  op('STAFF', 'change own role string', await call('PATCH', `/admin-users/${A.staff.id}`, { token: tok.staff, body: { role: 'MANAGER' } }), 403, 403);
});
if (NEW) {
  await check('STAFF\'s product is exactly as seeded except the name (stock, sizes, cost, threshold, supplier)', async () => {
    eq(staffProduct(), staffWas, 'unchanged');
    eq(sql(`SELECT count(*) FROM "InventoryTransaction" WHERE "productId" = '${P.staff.id}'`), '0', 'no ledger rows');
  });
}

if (OUT) writeFileSync(OUT, JSON.stringify(outcomes, null, 2));
const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed (EXPECT=${EXPECT})`);
process.exit(pass === results.length ? 0 : 1);
