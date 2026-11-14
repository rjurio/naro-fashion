// Round 25H: PR #42 rollback rehearsal on ONE isolated schema (seeded by
// manager-compat-seed.js). Phases run against different builds on the same
// schema, in this order:
//   old1  (production build 3d95365)  baseline operations
//   new   (#42 build)                 writes: atomic adjustments, audited settings, role grant / restore / denials, admin edits, products
//   old2  (3d95365 again = rollback)  must read and operate on every row #42 wrote
//   new2  (#42 again = roll forward)  must read and operate on rows the old build wrote
//   PSQL=<psql> IT_API=.. IT_SCHEMA=it_r42rb node r42-rollback.it.mjs <ids.json> <state.json> <phase>
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const [, , idsFile, stateFile, phase] = process.argv;
const ids = JSON.parse(readFileSync(idsFile, 'utf8'));
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
const API = (process.env.IT_API || 'http://localhost:4146/api/v1').replace(/\/$/, '');
const SCHEMA = process.env.IT_SCHEMA || ids.schema;
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/18/bin/psql.exe';
if (!/^it_[a-z0-9_]+$/.test(SCHEMA)) throw new Error('refusing: isolated it_* schema only');
if (!['old1', 'new', 'old2', 'new2'].includes(phase)) throw new Error('phase = old1|new|old2|new2');
const NEW = phase.startsWith('new');
const sql = (q) => execFileSync(PSQL, ['-U', 'naro_admin', '-h', 'localhost', '-d', 'naro_fashion', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO ${SCHEMA}`, '-c', q], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\r/g, '').trim();
const ip = (s) => { const h = createHash('sha256').update(String(s)).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
async function call(method, p, { token, body, tenant = ids.tenantA } = {}) {
  const headers = { 'X-Tenant-Id': tenant, 'X-Forwarded-For': ip(token || body?.email || randomBytes(4).toString('hex')), 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const r = await fetch(API + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
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
const short = (r) => JSON.stringify(r.data ?? null).slice(0, 140);
const st = (r, want, m) => eq(r.status, want, `${m} ${short(r)}`);
const login = async (w, tenant) => { const r = await call('POST', '/auth/login', { body: { email: w.email, password: w.password }, tenant }); assert(r.data?.accessToken, `login ${w.email} ${r.status} ${short(r)}`); return r.data.accessToken; };
const A = ids.admins;
const P = ids.products;
const tok = {};
for (const k of ['super', 'manager', 'staff']) tok[k] = await login(A[k]);
const stockOf = (v) => Number(sql(`SELECT stock FROM "ProductVariant" WHERE id = '${v}'`));
const variantsOf = (pid) => JSON.parse(sql(`SELECT coalesce(json_agg(json_build_object('id', id, 'name', name, 'price', price::float8, 'stock', stock) ORDER BY name), '[]') FROM "ProductVariant" WHERE "productId" = '${pid}' AND "isActive"`));
const adjust = (token, body) => call('POST', '/inventory/adjust', { token, body });
// Ledger chain for one variant: every row's before = the previous row's after.
const chainBreaks = (v) => Number(sql(`SELECT count(*) FROM (SELECT "quantityBefore", lag("quantityAfter") OVER (ORDER BY "createdAt", id) AS prev, "quantityAfter", "quantityChange" FROM "InventoryTransaction" WHERE "variantId" = '${v}') t WHERE (prev IS NOT NULL AND "quantityBefore" <> prev) OR "quantityAfter" <> "quantityBefore" + "quantityChange"`));
const readEverything = async (label) => {
  for (const p of ['/inventory', '/inventory/low-stock', '/inventory/valuation', `/inventory/${P.restock.id}/transactions`, '/products/admin', `/products/by-id/${P.restock.id}`,
    '/roles', `/roles/${ids.roles.low}/permissions`, '/admin-users', '/audit', '/audit/filters', ...(state.newProductId ? [`/products/by-id/${state.newProductId}`, `/inventory/${state.newProductId}/transactions`] : []),
    ...(state.newRoleId ? [`/roles/${state.newRoleId}`, `/roles/${state.newRoleId}/permissions`] : [])]) {
    st(await call('GET', p, { token: tok.super }), 200, `${label} GET ${p}`);
  }
  st(await call('GET', '/inventory', { token: tok.manager }), 200, `${label} MANAGER GET /inventory`);
};

console.log(`real API ${API} · schema ${SCHEMA} · rollback rehearsal phase ${phase}`);
const v = P.restock.variants.M;

if (phase === 'old1') {
  await check('old build: MANAGER restocks +5 and records damage 1 (10 → 15 → 14); every read works', async () => {
    st(await adjust(tok.manager, { productId: P.restock.id, variantId: v, type: 'RESTOCK', quantity: 5, note: 'old1' }), 201, 'restock');
    st(await adjust(tok.manager, { productId: P.restock.id, variantId: v, type: 'DAMAGE', quantity: 1, note: 'old1' }), 201, 'damage');
    eq(stockOf(v), 14, 'stock');
    await readEverything('old1');
  });
}

if (phase === 'new') {
  await check('#42: MANAGER restock / damage (atomic, audited before/after), settings (audited), product with opening stock, edit with same stock', async () => {
    st(await adjust(tok.manager, { productId: P.restock.id, variantId: v, type: 'RESTOCK', quantity: 6, note: 'new' }), 201, 'restock');
    st(await adjust(tok.manager, { productId: P.restock.id, variantId: v, type: 'DAMAGE', quantity: 2, note: 'new', expectedStock: 20 }), 201, 'damage with expectedStock');
    eq(stockOf(v), 18, 'stock');
    st(await call('PATCH', `/inventory/${P.restock.id}/settings`, { token: tok.manager, body: { minimumStock: 6, supplierName: 'Acme R42' } }), 200, 'settings');
    const c = await call('POST', '/products', { token: tok.manager, body: { description: 'd', price: 1000, categoryId: ids.categoryId, availabilityMode: 'PURCHASE_ONLY', name: `R42 rb ${randomBytes(3).toString('hex')}`, variants: [{ name: 'S', price: 1000, stock: 4 }] } });
    st(c, 201, 'create with opening stock');
    state.newProductId = c.data.id; state.newVariantId = c.data.variants?.[0]?.id ?? variantsOf(c.data.id)[0].id;
    const vs = variantsOf(P.restock.id);
    st(await call('PATCH', `/products/${P.restock.id}`, { token: tok.manager, body: { name: 'R42 Restock (new)', variants: vs.map((x) => ({ id: x.id, name: x.name, price: x.price, stock: x.stock })) } }), 200, 'edit');
    eq(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action IN ('ADJUST_STOCK', 'UPDATE_INVENTORY_SETTINGS') AND details ? 'before'`), '3', 'audit rows with before/after');
  });
  await check('#42: SUPER_ADMIN creates a role, grants, deletes + restores it (RESTORE audited), assigns it; a roles:manage holder\'s over-grant is refused + audited', async () => {
    const r = await call('POST', '/roles', { token: tok.super, body: { name: `R42 rb role ${randomBytes(3).toString('hex')}` } });
    st(r, 201, 'create role');
    state.newRoleId = r.data.id;
    const perm = (c) => sql(`SELECT id FROM "Permission" WHERE code = '${c}'`);
    st(await call('POST', `/roles/${state.newRoleId}/permissions`, { token: tok.super, body: { permissionIds: [perm('roles:view'), perm('roles:manage'), perm('inventory:view')] } }), 201, 'grant');
    st(await call('DELETE', `/roles/${state.newRoleId}`, { token: tok.super }), 200, 'delete');
    st(await call('PATCH', `/roles/${state.newRoleId}/restore`, { token: tok.super }), 200, 'restore');
    const email = `it-r42-rb-roleadmin-${randomBytes(3).toString('hex')}@example.test`;
    const a = await call('POST', '/admin-users', { token: tok.super, body: { email, password: 'ItTest12345', firstName: 'Role', lastName: 'Admin', role: 'STAFF', roleId: state.newRoleId } });
    st(a, 201, 'create role admin');
    state.roleAdmin = { id: a.data.id, email, password: 'ItTest12345' };
    const ra = await login(state.roleAdmin);
    const deny = await call('POST', `/roles/${ids.roles.low}/permissions`, { token: ra, body: { permissionIds: [perm('inventory:manage')] } });
    eq([deny.status, deny.data?.code], [403, 'BEYOND_OWN_PERMISSIONS'], 'over-grant refused');
    eq(sql(`SELECT string_agg(action, ',' ORDER BY action) FROM "AdminActivityLog" WHERE action IN ('RESTORE', 'ADD_PERMISSIONS_DENIED')`), 'ADD_PERMISSIONS_DENIED,RESTORE', 'audit');
    st(await call('PATCH', `/admin-users/${A.staff2.id}`, { token: tok.manager, body: { firstName: 'EditedBy42' } }), 200, 'MANAGER edits STAFF');
  });
  await check('#42: holes closed (STAFF adjust 403)', async () => {
    st(await adjust(tok.staff, { productId: P.restock.id, variantId: v, type: 'RESTOCK', quantity: 1 }), 403, 'STAFF adjust');
  });
}

if (phase === 'old2') {
  await check('rollback (old build): every read works on rows #42 wrote (inventory, ledger, products, roles incl. the restored one, admins, audit incl. RESTORE / ADD_PERMISSIONS_DENIED)', async () => {
    await readEverything('old2');
    const audit = await call('GET', '/audit?limit=100', { token: tok.super });
    const rows = JSON.stringify(audit.data);
    assert(/ADD_PERMISSIONS_DENIED/.test(rows) && /UPDATE_INVENTORY_SETTINGS/.test(rows), 'audit list shows #42 rows');
  });
  await check('rollback: old build operates on #42 rows — adjusts the #42-adjusted size and the #42-created product (ledger chain continues), edits both products, logs in the #42-created admin, edits roles', async () => {
    st(await adjust(tok.manager, { productId: P.restock.id, variantId: v, type: 'RESTOCK', quantity: 2, note: 'old2' }), 201, 'restock #42-adjusted size');
    eq(stockOf(v), 20, 'stock');
    st(await adjust(tok.manager, { productId: state.newProductId, variantId: state.newVariantId, type: 'RESTOCK', quantity: 1, note: 'old2' }), 201, 'restock #42-created product');
    eq(stockOf(state.newVariantId), 5, 'new product stock');
    for (const pid of [P.restock.id, state.newProductId]) {
      const vs = variantsOf(pid);
      st(await call('PATCH', `/products/${pid}`, { token: tok.manager, body: { name: `edited in old2 ${randomBytes(2).toString('hex')}`, variants: vs.map((x) => ({ id: x.id, name: x.name, price: x.price, stock: x.stock })) } }), 200, `edit ${pid}`);
    }
    eq([chainBreaks(v), chainBreaks(state.newVariantId)], [0, 0], 'ledger chain breaks');
    await login(state.roleAdmin);
    st(await call('PATCH', `/roles/${state.newRoleId}`, { token: tok.super, body: { description: 'edited in old2' } }), 200, 'edit restored role');
    st(await call('PATCH', `/inventory/${P.restock.id}/settings`, { token: tok.manager, body: { minimumStock: 7 } }), 200, 'settings');
  });
  await check('rollback re-opens the holes (documented): STAFF adjust → 201 on the old build', async () => {
    st(await adjust(tok.staff, { productId: P.restock.id, variantId: v, type: 'RESTOCK', quantity: 1, note: 'old2-hole' }), 201, 'STAFF adjust');
    eq(stockOf(v), 21, 'stock');
  });
}

if (phase === 'new2') {
  await check('roll forward (#42 again): every read works on rows the old build wrote; adjust continues the ledger chain; STAFF blocked again', async () => {
    await readEverything('new2');
    st(await adjust(tok.manager, { productId: P.restock.id, variantId: v, type: 'DAMAGE', quantity: 1, note: 'new2', expectedStock: 21 }), 201, 'damage');
    eq([stockOf(v), chainBreaks(v), chainBreaks(state.newVariantId)], [20, 0, 0], 'stock / chain');
    st(await adjust(tok.staff, { productId: P.restock.id, variantId: v, type: 'RESTOCK', quantity: 1 }), 403, 'STAFF adjust');
    const vs = variantsOf(P.restock.id);
    st(await call('PATCH', `/products/${P.restock.id}`, { token: tok.manager, body: { name: 'R42 Restock (new2)', variants: vs.map((x) => ({ id: x.id, name: x.name, price: x.price, stock: x.stock })) } }), 200, 'edit');
    await login(state.roleAdmin);
    return `ledger rows on the size: ${sql(`SELECT count(*) FROM "InventoryTransaction" WHERE "variantId" = '${v}'`)}`;
  });
}

writeFileSync(stateFile, JSON.stringify(state, null, 2));
const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed (phase ${phase})`);
process.exit(pass === results.length ? 0 : 1);
