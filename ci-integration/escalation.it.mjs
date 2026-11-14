// Round 25F: stock + permission-escalation fixes (PR #42 head 5efa247) —
// real API + real Postgres. Isolated schema it_esc seeded by
// escalation-seed.js. Never production.
//   PSQL=<psql> [IT_API=..] [IT_SCHEMA=it_esc] node escalation.it.mjs <ids.json>
// Identities: SUPER_ADMIN; STAFF (inventory:view); a MANAGER-like custom role
// (roles:manage + admins:create + admins:update, NOT inventory:manage); an
// inventory:manage holder; a POS cashier (pos:refund); a second shop.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';

const ids = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const API = (process.env.IT_API || 'http://localhost:4136/api/v1').replace(/\/$/, '');
const SCHEMA = process.env.IT_SCHEMA || 'it_esc';
const PSQL = process.env.PSQL || 'C:/Program Files/PostgreSQL/18/bin/psql.exe';
const HOST = process.env.PGHOST || 'localhost';
if (!/^(localhost|127\.0\.0\.1)$/.test(HOST)) throw new Error('refusing: local/CI database only');
if (!/^it_[a-z0-9_]+$/.test(SCHEMA)) throw new Error('refusing: isolated it_* schema only');
const sql = (q) => execFileSync(PSQL, ['-U', 'naro_admin', '-h', HOST, '-d', 'naro_fashion', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO ${SCHEMA}`, '-c', q], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).replace(/\r/g, '').trim();
// One stable client IP per identity (auth + global limits are per IP).
const ip = (s) => { const h = createHash('sha256').update(String(s)).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
async function call(method, p, { token, body, tenant = ids.tenantA, form } = {}) {
  const headers = { 'X-Tenant-Id': tenant, 'X-Forwarded-For': ip(token || body?.email || randomBytes(4).toString('hex')), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  if (!form) headers['Content-Type'] = 'application/json';
  const r = await fetch(API + p, { method, headers, body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
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
const sc = (r) => [r.status, r.data?.code];
const short = (r) => JSON.stringify(r.data ?? null).slice(0, 160);
const login = async (w, tenant) => { const r = await call('POST', '/auth/login', { body: { email: w.email, password: w.password }, tenant }); assert(r.data?.accessToken, `login ${w.email} ${r.status}`); return r.data.accessToken; };
const q = (s) => s.replace(/'/g, "''");

const A = ids.admins;
const P = ids.products;
const tok = {};
for (const k of ['super', 'staff', 'manager', 'inventory', 'cashier']) tok[k] = await login(A[k]);
tok.superB = await login(A.superB, ids.tenantB);

const stockOf = (variantId) => Number(sql(`SELECT stock FROM "ProductVariant" WHERE id = '${variantId}'`));
const ledgerCount = (productId) => Number(sql(`SELECT count(*) FROM "InventoryTransaction" WHERE "productId" = '${productId}'`));
const adjust = (token, body, tenant) => call('POST', '/inventory/adjust', { token, tenant, body });
const perm = (code) => sql(`SELECT id FROM "Permission" WHERE code = '${q(code)}'`);
const roleState = (id) => sql(`SELECT ("deletedAt" IS NULL)::text || '|' || "isActive"::text FROM "Role" WHERE id = '${id}'`);
const lastAudit = (action, entityId, extra = '') => sql(`SELECT "adminUserId" || '|' || coalesce(details::text, '') FROM "AdminActivityLog" WHERE action = '${action}' AND "entityId" = '${entityId}' ${extra} ORDER BY "createdAt" DESC LIMIT 1`);
const holdsRole = (adminId, roleId) => sql(`SELECT count(*) FROM "AdminUserRole" WHERE "adminUserId" = '${adminId}' AND "roleId" = '${roleId}'`);
const adminRow = (id) => sql(`SELECT "firstName" || '|' || email || '|' || role || '|' || "isActive"::text || '|' || "tokenVersion"::text || '|' || "passwordHash" FROM "AdminUser" WHERE id = '${id}'`);
const csv = (rows) => { const fd = new FormData(); fd.append('file', new Blob([`name,description,price,categorySlug,stock\n${rows}\n`], { type: 'text/csv' }), 'import.csv'); return fd; };

console.log(`real API ${API} · isolated schema ${SCHEMA} · stock + permission-escalation fixes (5efa247)`);

// ---------------------------------------------------------------- inventory
console.log('\n[inventory]');
await check('adjust: a variant of ANOTHER product is refused (404) for the inventory holder and SUPER_ADMIN; no stock or ledger change', async () => {
  const before = [stockOf(P.daily.variants.M), stockOf(P.other.variants.M), ledgerCount(P.daily.id), ledgerCount(P.other.id)];
  for (const k of ['inventory', 'super']) {
    for (const type of ['RESTOCK', 'DAMAGE', 'ADJUSTMENT']) {
      const r = await adjust(tok[k], { productId: P.daily.id, variantId: P.other.variants.M, type, quantity: 1 });
      eq(r.status, 404, `${k} ${type} ${short(r)}`);
    }
  }
  eq([stockOf(P.daily.variants.M), stockOf(P.other.variants.M), ledgerCount(P.daily.id), ledgerCount(P.other.id)], before, 'unchanged');
});
await check('product form: changing cost price / low-stock threshold / supplier needs inventory:manage (403 INVENTORY_PERMISSION_REQUIRED for STAFF and the manager-like role); nothing written', async () => {
  const was = sql(`SELECT "purchasePrice"::text || '|' || "minimumStock"::text || '|' || "supplierName" || '|' || "supplierContact" || '|' || name FROM "Product" WHERE id = '${P.settings.id}'`);
  for (const [k, body] of [
    ['staff', { purchasePrice: 1 }], ['staff', { minimumStock: 9 }], ['staff', { supplierName: 'Evil Ltd' }], ['staff', { supplierContact: '+255799999999' }],
    ['manager', { purchasePrice: 1 }], ['manager', { supplierName: 'Evil Ltd' }],
    ['staff', { name: 'Renamed with cost change', purchasePrice: 1 }],
  ]) {
    const r = await call('PATCH', `/products/${P.settings.id}`, { token: tok[k], body });
    eq(sc(r), [403, 'INVENTORY_PERMISSION_REQUIRED'], `${k} ${JSON.stringify(body)}`);
  }
  eq(sql(`SELECT "purchasePrice"::text || '|' || "minimumStock"::text || '|' || "supplierName" || '|' || "supplierContact" || '|' || name FROM "Product" WHERE id = '${P.settings.id}'`), was, 'unchanged (incl. the name sent with it: one transaction)');
});
await check('product form: re-sending the CURRENT settings is fine for STAFF; the inventory holder and SUPER_ADMIN can change them', async () => {
  const r1 = await call('PATCH', `/products/${P.settings.id}`, { token: tok.staff, body: { name: 'Esc Settings Gown v2', purchasePrice: 40000, minimumStock: 2, supplierName: 'Acme', supplierContact: '+255700000001' } });
  eq(r1.status, 200, `staff same values ${short(r1)}`);
  eq((await call('PATCH', `/products/${P.settings.id}`, { token: tok.inventory, body: { purchasePrice: 45000 } })).status, 200, 'inventory holder');
  eq((await call('PATCH', `/products/${P.settings.id}`, { token: tok.super, body: { minimumStock: 4, supplierName: 'Acme Ltd' } })).status, 200, 'super');
  eq(sql(`SELECT "purchasePrice"::numeric::int::text || '|' || "minimumStock"::text || '|' || "supplierName" || '|' || name FROM "Product" WHERE id = '${P.settings.id}'`), '45000|4|Acme Ltd|Esc Settings Gown v2', 'stored');
});
await check('product form: removing a size that still holds stock needs inventory:manage (STAFF / manager-like → 403); the size and its stock stay; nothing else written', async () => {
  const v = P.sizes.variants;
  const keepLXL = [{ id: v.L, name: 'L', price: 100000, stock: 0 }, { id: v.XL, name: 'XL', price: 100000, stock: 0 }];
  for (const k of ['staff', 'manager']) {
    const r = await call('PATCH', `/products/${P.sizes.id}`, { token: tok[k], body: { name: 'Esc Sizes hacked', variants: keepLXL } });
    eq(sc(r), [403, 'INVENTORY_PERMISSION_REQUIRED'], k);
  }
  eq(sql(`SELECT stock || '|' || "isActive"::text FROM "ProductVariant" WHERE id = '${v.S}'`), '5|true', 'S intact');
  eq(sql(`SELECT name FROM "Product" WHERE id = '${P.sizes.id}'`), 'Esc Sizes Gown', 'name unchanged');
});
await check('product form: STAFF may still remove an EMPTY size; the inventory holder may remove a stocked one', async () => {
  const v = P.sizes.variants;
  const r = await call('PATCH', `/products/${P.sizes.id}`, { token: tok.staff, body: { variants: [{ id: v.L, name: 'L', price: 100000, stock: 0 }, { id: v.S, name: 'S', price: 100000, stock: 5 }] } });
  eq(r.status, 200, `staff drops empty XL ${short(r)}`);
  eq(sql(`SELECT count(*) FROM "ProductVariant" WHERE id = '${v.XL}' AND "isActive"`), '0', 'XL gone');
  const r2 = await call('PATCH', `/products/${P.sizes.id}`, { token: tok.inventory, body: { variants: [{ id: v.L, name: 'L', price: 100000, stock: 0 }] } });
  eq(r2.status, 200, `inventory holder drops stocked S ${short(r2)}`);
  eq(sql(`SELECT count(*) FROM "ProductVariant" WHERE id = '${v.S}' AND "isActive"`), '0', 'S gone');
});

// -------------------------------------------------------------------- roles
console.log('\n[roles]');
await check('restore = grant: the manager-like role can\'t restore a role carrying inventory:manage (403 BEYOND_OWN_PERMISSIONS) nor one they hold (403 OWN_ROLE); both stay deleted; refusals audited', async () => {
  const r1 = await call('PATCH', `/roles/${ids.roles.deletedStrong}/restore`, { token: tok.manager });
  eq(sc(r1), [403, 'BEYOND_OWN_PERMISSIONS'], 'strong');
  assert((r1.data?.codes ?? []).includes('inventory:manage'), `names the code ${short(r1)}`);
  const r2 = await call('PATCH', `/roles/${ids.roles.deletedOwn}/restore`, { token: tok.manager });
  eq(sc(r2), [403, 'OWN_ROLE'], 'own');
  eq([roleState(ids.roles.deletedStrong), roleState(ids.roles.deletedOwn)], ['false|false', 'false|false'], 'still deleted');
  const a1 = lastAudit('RESTORE_DENIED', ids.roles.deletedStrong);
  assert(a1.startsWith(`${A.manager.id}|`) && /BEYOND_OWN/.test(a1) && /inventory:manage/.test(a1), `audit strong ${a1}`);
  const a2 = lastAudit('RESTORE_DENIED', ids.roles.deletedOwn);
  assert(a2.startsWith(`${A.manager.id}|`) && /OWN_ROLE/.test(a2), `audit own ${a2}`);
});
await check('restore: the manager-like role CAN restore a role within their own permissions; SUPER_ADMIN restores the strong one; both audited (RESTORE)', async () => {
  eq((await call('PATCH', `/roles/${ids.roles.deletedLow}/restore`, { token: tok.manager })).status, 200, 'manager low');
  eq((await call('PATCH', `/roles/${ids.roles.deletedStrong}/restore`, { token: tok.super })).status, 200, 'super strong');
  eq([roleState(ids.roles.deletedLow), roleState(ids.roles.deletedStrong)], ['true|true', 'true|true'], 'restored');
  assert(lastAudit('RESTORE', ids.roles.deletedLow).startsWith(`${A.manager.id}|`), 'audit manager');
  assert(lastAudit('RESTORE', ids.roles.deletedStrong).startsWith(`${A.super.id}|`), 'audit super');
});
await check('restore: another shop\'s deleted role → 404 (manager-like and SUPER_ADMIN); it stays deleted', async () => {
  for (const k of ['manager', 'super']) eq((await call('PATCH', `/roles/${ids.roles.shopBDeleted}/restore`, { token: tok[k] })).status, 404, k);
  eq(roleState(ids.roles.shopBDeleted), 'false|false', 'still deleted');
});
await check('addPermissions rejects bad / unknown ids (400 / 404, also for SUPER_ADMIN) and a mixed list with a code the caller lacks (403); nothing written', async () => {
  const spare = ids.roles.spare;
  const count = () => sql(`SELECT count(*) FROM "RolePermission" WHERE "roleId" = '${spare}'`);
  const before = count();
  for (const [k, body, want] of [
    ['manager', { permissionIds: 'inventory:manage' }, 400], ['manager', { permissionIds: [] }, 400], ['manager', {}, 400],
    ['manager', { permissionIds: [{ not: 'an id' }] }, 400], ['manager', { permissionIds: ['no-such-permission-id'] }, 404],
    ['super', { permissionIds: [{ in: [perm('inventory:manage')] }] }, 400], ['super', { permissionIds: [perm('inventory:view'), 'no-such-permission-id'] }, 404],
  ]) {
    const r = await call('POST', `/roles/${spare}/permissions`, { token: tok[k], body });
    eq(r.status, want, `${k} ${JSON.stringify(body)} ${short(r)}`);
  }
  const mixed = await call('POST', `/roles/${spare}/permissions`, { token: tok.manager, body: { permissionIds: [perm('roles:view'), perm('inventory:manage')] } });
  eq(sc(mixed), [403, 'BEYOND_OWN_PERMISSIONS'], 'mixed');
  eq(count(), before, 'nothing written');
});
await check('addPermissions: the manager-like role can grant a permission they hold to a role they don\'t hold; SUPER_ADMIN can grant inventory:manage', async () => {
  const spare = ids.roles.spare;
  const r = await call('POST', `/roles/${spare}/permissions`, { token: tok.manager, body: { permissionIds: [perm('roles:view')] } });
  assert([200, 201].includes(r.status), `manager ${r.status} ${short(r)}`);
  const s = await call('POST', `/roles/${spare}/permissions`, { token: tok.super, body: { permissionIds: [perm('inventory:manage')] } });
  assert([200, 201].includes(s.status), `super ${s.status}`);
  eq(sql(`SELECT string_agg(p.code, ',' ORDER BY p.code) FROM "RolePermission" rp JOIN "Permission" p ON p.id = rp."permissionId" WHERE rp."roleId" = '${spare}'`), 'inventory:manage,inventory:view,roles:view', 'grants');
});

// -------------------------------------------------------------- admin users
console.log('\n[admin accounts]');
const newAdmin = (tag, extra) => ({ firstName: 'Esc', lastName: tag, email: `it-esc-new-${tag}@example.test`, password: 'ItTest12345', ...extra });
const adminExists = (email) => sql(`SELECT count(*) FROM "AdminUser" WHERE email = '${q(email)}'`);
await check('create: the manager-like role can\'t create an account with a role carrying permissions they lack (roleId or roleIds → 403 BEYOND_OWN_PERMISSIONS), nor SUPER_ADMIN (403), nor another shop\'s role (404); no account created', async () => {
  for (const [tag, extra, want] of [
    ['m1', { roleId: ids.roles.inventory }, [403, 'BEYOND_OWN_PERMISSIONS']],
    ['m2', { roleIds: [ids.roles.low, ids.roles.inventory] }, [403, 'BEYOND_OWN_PERMISSIONS']],
    ['m3', { role: 'SUPER_ADMIN' }, [403, undefined]],
    ['m4', { roleId: ids.roles.shopB }, [404, undefined]],
  ]) {
    const r = await call('POST', '/admin-users', { token: tok.manager, body: newAdmin(tag, extra) });
    eq(sc(r), want, `${tag} ${short(r)}`);
    eq(adminExists(`it-esc-new-${tag}@example.test`), '0', `${tag} not created`);
  }
});
await check('create: the manager-like role CAN create an account with a role within their permissions; SUPER_ADMIN can create one with the inventory role', async () => {
  const r = await call('POST', '/admin-users', { token: tok.manager, body: newAdmin('ok1', { roleIds: [ids.roles.low2] }) });
  eq(r.status, 201, `manager ${short(r)}`);
  eq(holdsRole(r.data.id, ids.roles.low2), '1', 'role attached');
  ids.created = r.data.id;
  const s = await call('POST', '/admin-users', { token: tok.super, body: newAdmin('ok2', { roleId: ids.roles.inventory }) });
  eq(s.status, 201, `super ${short(s)}`);
  eq(holdsRole(s.data.id, ids.roles.inventory), '1', 'super role attached');
});
await check('assignRole: the manager-like role can\'t assign a role carrying inventory:manage to another admin (403 BEYOND_OWN_PERMISSIONS), nor to themself (403), nor across shops (404 either way)', async () => {
  const r = await call('POST', `/admin-users/${A.targetLow.id}/roles`, { token: tok.manager, body: { roleId: ids.roles.inventory } });
  eq(sc(r), [403, 'BEYOND_OWN_PERMISSIONS'], `other ${short(r)}`);
  eq((await call('POST', `/admin-users/${A.manager.id}/roles`, { token: tok.manager, body: { roleId: ids.roles.low2 } })).status, 403, 'self');
  eq((await call('POST', `/admin-users/${A.adminB.id}/roles`, { token: tok.manager, body: { roleId: ids.roles.low } })).status, 404, 'shop-B admin');
  eq((await call('POST', `/admin-users/${A.targetLow.id}/roles`, { token: tok.manager, body: { roleId: ids.roles.shopB } })).status, 404, 'shop-B role');
  eq([holdsRole(A.targetLow.id, ids.roles.inventory), holdsRole(A.manager.id, ids.roles.low2), holdsRole(A.adminB.id, ids.roles.low), holdsRole(A.targetLow.id, ids.roles.shopB)], ['0', '0', '0', '0'], 'nothing assigned');
});
await check('assignRole: the manager-like role CAN assign a role within their permissions; SUPER_ADMIN can assign the inventory role', async () => {
  const r = await call('POST', `/admin-users/${A.targetLow.id}/roles`, { token: tok.manager, body: { roleId: ids.roles.low2 } });
  eq(r.status, 201, `manager ${short(r)}`);
  eq((await call('POST', `/admin-users/${ids.created}/roles`, { token: tok.super, body: { roleId: ids.roles.inventory } })).status, 201, 'super');
  eq([holdsRole(A.targetLow.id, ids.roles.low2), holdsRole(ids.created, ids.roles.inventory)], ['1', '1'], 'assigned');
});
await check('update: below SUPER_ADMIN nobody changes their own role (403 OWN_ROLE); own name and an unchanged role are fine', async () => {
  eq(sc(await call('PATCH', `/admin-users/${A.manager.id}`, { token: tok.manager, body: { role: 'STAFF' } })), [403, 'OWN_ROLE'], 'own role');
  eq(sql(`SELECT role FROM "AdminUser" WHERE id = '${A.manager.id}'`), 'MANAGER', 'role unchanged');
  eq((await call('PATCH', `/admin-users/${A.manager.id}`, { token: tok.manager, body: { firstName: 'Mgr', role: 'MANAGER' } })).status, 200, 'own name + same role');
});
await check('update: editing (password / email / name) an admin holding permissions the caller lacks → 403 TARGET_HAS_MORE_PERMISSIONS; password, sessions, email untouched', async () => {
  const before = adminRow(A.targetStrong.id);
  for (const body of [{ password: 'Takeover12345' }, { email: 'it-esc-takeover@example.test' }, { firstName: 'Owned' }, { role: 'MANAGER' }]) {
    const r = await call('PATCH', `/admin-users/${A.targetStrong.id}`, { token: tok.manager, body });
    eq(sc(r), [403, 'TARGET_HAS_MORE_PERMISSIONS'], `${JSON.stringify(body)} ${short(r)}`);
  }
  eq(adminRow(A.targetStrong.id), before, 'row unchanged');
  eq((await call('POST', '/auth/login', { body: { email: 'it-esc-takeover@example.test', password: 'Takeover12345' } })).status, 401, 'takeover login fails');
  eq((await call('PATCH', `/admin-users/${A.super.id}`, { token: tok.manager, body: { firstName: 'X' } })).status, 403, 'SUPER_ADMIN target');
});
await check('update: the manager-like role CAN edit an admin within their permissions (name + password reset revokes sessions); SUPER_ADMIN can edit the stronger admin; another shop\'s admin → 404', async () => {
  const tv = Number(sql(`SELECT "tokenVersion" FROM "AdminUser" WHERE id = '${A.targetLow.id}'`));
  eq((await call('PATCH', `/admin-users/${A.targetLow.id}`, { token: tok.manager, body: { firstName: 'Low2', password: 'ResetPass12345' } })).status, 200, 'manager edits low');
  eq(Number(sql(`SELECT "tokenVersion" FROM "AdminUser" WHERE id = '${A.targetLow.id}'`)), tv + 1, 'sessions revoked');
  eq((await call('PATCH', `/admin-users/${A.targetStrong.id}`, { token: tok.super, body: { firstName: 'Strong2' } })).status, 200, 'super edits strong');
  eq(sql(`SELECT "firstName" FROM "AdminUser" WHERE id = '${A.targetStrong.id}'`), 'Strong2', 'stored');
  for (const k of ['manager', 'super']) eq((await call('PATCH', `/admin-users/${A.adminB.id}`, { token: tok[k], body: { firstName: 'X' } })).status, 404, `${k} shop B`);
  eq((await call('PATCH', `/admin-users/${A.targetStrong.id}`, { token: tok.superB, tenant: ids.tenantB, body: { firstName: 'X' } })).status, 404, 'shop-B SUPER_ADMIN on shop A admin');
});
await check('toggle: the manager-like role can\'t disable / re-enable a stronger admin (403 TARGET_HAS_MORE_PERMISSIONS); can toggle one within their permissions; SUPER_ADMIN can toggle the stronger one; another shop\'s admin → 404', async () => {
  const r = await call('PATCH', `/admin-users/${A.targetStrong.id}/toggle`, { token: tok.manager });
  eq(sc(r), [403, 'TARGET_HAS_MORE_PERMISSIONS'], 'strong');
  eq(sql(`SELECT "isActive"::text FROM "AdminUser" WHERE id = '${A.targetStrong.id}'`), 'true', 'still active');
  eq((await call('PATCH', `/admin-users/${A.targetToggle.id}/toggle`, { token: tok.manager })).status, 200, 'low off');
  eq(sql(`SELECT "isActive"::text FROM "AdminUser" WHERE id = '${A.targetToggle.id}'`), 'false', 'off');
  eq((await call('PATCH', `/admin-users/${A.targetToggle.id}/toggle`, { token: tok.manager })).status, 200, 'low on');
  eq((await call('PATCH', `/admin-users/${A.targetStrong.id}/toggle`, { token: tok.super })).status, 200, 'super off');
  eq((await call('PATCH', `/admin-users/${A.targetStrong.id}/toggle`, { token: tok.super })).status, 200, 'super on');
  eq(sql(`SELECT string_agg("isActive"::text, ',' ORDER BY email) FROM "AdminUser" WHERE id IN ('${A.targetStrong.id}', '${A.targetToggle.id}')`), 'true,true', 'both active again');
  for (const k of ['manager', 'super']) eq((await call('PATCH', `/admin-users/${A.adminB.id}/toggle`, { token: tok[k] })).status, 404, `${k} shop B`);
  eq(sql(`SELECT "isActive"::text FROM "AdminUser" WHERE id = '${A.adminB.id}'`), 'true', 'shop-B admin untouched');
});

// ------------------------------------------------------- daily operations
console.log('\n[daily operations still work]');
for (const k of ['super', 'inventory']) {
  await check(`${k === 'super' ? 'SUPER_ADMIN' : 'the inventory:manage holder'} can RESTOCK / DAMAGE / ADJUSTMENT; ledger before/after + performedBy; audit ADJUST_STOCK with before/after and actor`, async () => {
    const v = P.daily.variants.M;
    let cur = stockOf(v);
    for (const [type, qty, change] of [['RESTOCK', 5, 5], ['DAMAGE', 2, -2], ['ADJUSTMENT', 1, 1]]) {
      const r = await adjust(tok[k], { productId: P.daily.id, variantId: v, type, quantity: qty, note: `${k} ${type}` });
      eq(r.status, 201, `${type} ${short(r)}`);
      eq(sql(`SELECT "quantityBefore" || '|' || "quantityChange" || '|' || "quantityAfter" || '|' || "performedBy" || '|' || type FROM "InventoryTransaction" WHERE id = '${r.data.id}'`), `${cur}|${change}|${cur + change}|${A[k].id}|${type}`, `${type} ledger`);
      eq(sql(`SELECT "adminUserId" || '|' || (details->>'before') || '|' || (details->>'after') || '|' || (details->>'type') FROM "AdminActivityLog" WHERE action = 'ADJUST_STOCK' AND details->>'transactionId' = '${r.data.id}'`), `${A[k].id}|${cur}|${cur + change}|${type}`, `${type} audit`);
      cur += change;
      eq(stockOf(v), cur, `${type} stock`);
    }
    return `stock now ${cur}`;
  });
}
await check('settings via Inventory by SUPER_ADMIN → audited with before/after', async () => {
  eq((await call('PATCH', `/inventory/${P.daily.id}/settings`, { token: tok.super, body: { minimumStock: 6 } })).status, 200, 'settings');
  const a = sql(`SELECT "adminUserId" || '|' || coalesce(details->'before'->>'minimumStock', 'null') || '|' || (details->'after'->>'minimumStock') FROM "AdminActivityLog" WHERE action = 'UPDATE_INVENTORY_SETTINGS' AND "entityId" = '${P.daily.id}' ORDER BY "createdAt" DESC LIMIT 1`);
  assert(a.startsWith(`${A.super.id}|`) && a.endsWith('|6'), `audit ${a}`);
});
await check('SUPER_ADMIN and the inventory holder can create a product with opening stock', async () => {
  for (const k of ['super', 'inventory']) {
    const r = await call('POST', '/products', { token: tok[k], body: { name: `Esc Opening ${k}`, description: 'd', price: 1000, categoryId: ids.categoryId, availabilityMode: 'PURCHASE_ONLY', variants: [{ name: 'S', price: 1000, stock: 6 }] } });
    eq(r.status, 201, `${k} ${short(r)}`);
    eq(sql(`SELECT stock FROM "ProductVariant" WHERE "productId" = '${r.data.id}'`), '6', `${k} stock`);
  }
});
await check('SUPER_ADMIN and the inventory holder can CSV-import with stock', async () => {
  for (const k of ['super', 'inventory']) {
    const r = await call('POST', '/products/bulk-import', { token: tok[k], form: csv(`Esc Csv ${k},Nice,5000,${ids.categorySlug},4`) });
    eq([r.data?.created, r.data?.failed], [1, 0], `${k} ${short(r)}`);
    eq(sql(`SELECT v.stock FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId" WHERE p.name = 'Esc Csv ${k}' AND p."tenantId" = '${ids.tenantA}'`), '4', `${k} stock`);
  }
});
await check('everyone (STAFF, manager-like, inventory holder, SUPER_ADMIN) can edit a product\'s name / price without touching stock; re-sending the same stock is fine; no ledger row', async () => {
  const v = P.daily.variants.M;
  const s0 = stockOf(v); const l0 = ledgerCount(P.daily.id);
  let i = 0;
  for (const k of ['staff', 'manager', 'inventory', 'super']) {
    i++;
    eq((await call('PATCH', `/products/${P.daily.id}`, { token: tok[k], body: { name: `Esc Daily Gown ${i}`, price: 100000 + i } })).status, 200, `${k} name/price`);
  }
  eq((await call('PATCH', `/products/${P.daily.id}`, { token: tok.staff, body: { variants: [{ id: v, name: 'M', price: 100005, stock: s0 }] } })).status, 200, 'staff same stock');
  eq(sql(`SELECT name || '|' || "basePrice"::numeric::int::text FROM "Product" WHERE id = '${P.daily.id}'`), 'Esc Daily Gown 4|100004', 'stored');
  eq([stockOf(v), ledgerCount(P.daily.id)], [s0, l0], 'stock + ledger unchanged');
});
await check('POS: a cashier (pos:refund, no inventory:manage) sells 2 (stock 8 → 6, SALE ledger) and refunds 1 (→ 7, ledger); STAFF without pos:refund can\'t refund (403)', async () => {
  const v = P.pos.variants.M;
  eq(stockOf(v), 8, 'start');
  const open = await call('POST', '/pos/sessions/open', { token: tok.cashier, body: { openingCash: 0 } });
  eq(open.status, 201, `open shift ${short(open)}`);
  const sale = await call('POST', '/pos/sales', { token: tok.cashier, body: { items: [{ productId: P.pos.id, variantId: v, quantity: 2, unitPrice: 100000 }], payments: [{ method: 'CASH', amount: 200000 }] } });
  eq(sale.status, 201, `sale ${short(sale)}`);
  const orderId = sale.data.order.id;
  eq(stockOf(v), 6, 'after sale');
  eq(sql(`SELECT "quantityBefore" || '|' || "quantityChange" || '|' || "quantityAfter" || '|' || "performedBy" FROM "InventoryTransaction" WHERE "variantId" = '${v}' AND type = 'SALE' ORDER BY "createdAt" DESC LIMIT 1`), `8|-2|6|${A.cashier.id}`, 'sale ledger');
  const detail = await call('GET', `/pos/sales/${orderId}`, { token: tok.cashier });
  const itemId = detail.data?.items?.[0]?.id;
  assert(itemId, `order item ${short(detail)}`);
  eq((await call('POST', `/pos/sales/${orderId}/refund`, { token: tok.staff, body: { items: [{ orderItemId: itemId, quantity: 1 }], refundMethod: 'CASH' } })).status, 403, 'staff refund');
  const ref = await call('POST', `/pos/sales/${orderId}/refund`, { token: tok.cashier, body: { items: [{ orderItemId: itemId, quantity: 1 }], refundMethod: 'CASH', reason: 'it' } });
  assert([200, 201].includes(ref.status), `refund ${ref.status} ${short(ref)}`);
  eq(stockOf(v), 7, 'after refund');
  eq(sql(`SELECT "quantityBefore" || '|' || "quantityChange" || '|' || "quantityAfter" || '|' || "performedBy" FROM "InventoryTransaction" WHERE "variantId" = '${v}' AND type = 'ADJUSTMENT' ORDER BY "createdAt" DESC LIMIT 1`), `6|1|7|${A.cashier.id}`, 'refund ledger');
});
await check('STAFF and the manager-like role get 403 on every stock-admin route (adjust ×3, settings, create with stock, new size with stock); CSV with stock fails the row; stock unchanged', async () => {
  const v = P.daily.variants.M; const s0 = stockOf(v); const l0 = ledgerCount(P.daily.id);
  for (const k of ['staff', 'manager']) {
    for (const type of ['RESTOCK', 'DAMAGE', 'ADJUSTMENT']) eq((await adjust(tok[k], { productId: P.daily.id, variantId: v, type, quantity: 1 })).status, 403, `${k} ${type}`);
    eq((await call('PATCH', `/inventory/${P.daily.id}/settings`, { token: tok[k], body: { minimumStock: 1 } })).status, 403, `${k} settings`);
    eq(sc(await call('POST', '/products', { token: tok[k], body: { name: `Esc ${k} stock`, description: 'd', price: 1000, categoryId: ids.categoryId, availabilityMode: 'PURCHASE_ONLY', variants: [{ name: 'S', price: 1000, stock: 2 }] } })), [403, 'INVENTORY_PERMISSION_REQUIRED'], `${k} create`);
    eq(sc(await call('PATCH', `/products/${P.daily.id}`, { token: tok[k], body: { variants: [{ id: v, name: 'M', price: 100005, stock: s0 }, { name: 'XXL', price: 100005, stock: 3 }] } })), [403, 'INVENTORY_PERMISSION_REQUIRED'], `${k} new size with stock`);
    const imp = await call('POST', '/products/bulk-import', { token: tok[k], form: csv(`Esc Csv bad ${k},Nice,5000,${ids.categorySlug},3`) });
    eq([imp.data?.created, imp.data?.failed], [0, 1], `${k} csv ${short(imp)}`);
  }
  eq([stockOf(v), ledgerCount(P.daily.id)], [s0, l0], 'unchanged');
  eq(sql(`SELECT count(*) FROM "Product" WHERE name LIKE 'Esc % stock' OR name LIKE 'Esc Csv bad %'`), '0', 'no products created');
  eq(sql(`SELECT count(*) FROM "ProductVariant" WHERE "productId" = '${P.daily.id}'`), '1', 'no size added');
});
await check('shop isolation: shop A admins can\'t adjust shop B stock (404); shop B\'s SUPER_ADMIN adjusts its own; a shop-B variant under a shop-A product → 404', async () => {
  const vb = P.shopB.variants.M;
  for (const k of ['inventory', 'super']) eq((await adjust(tok[k], { productId: P.shopB.id, variantId: vb, type: 'RESTOCK', quantity: 1 })).status, 404, `${k} B product`);
  eq((await adjust(tok.super, { productId: P.daily.id, variantId: vb, type: 'RESTOCK', quantity: 1 })).status, 404, 'B variant under A product');
  eq(stockOf(vb), 3, 'B unchanged');
  eq((await adjust(tok.superB, { productId: P.shopB.id, variantId: vb, type: 'RESTOCK', quantity: 2 }, ids.tenantB)).status, 201, 'B super own');
  eq(stockOf(vb), 5, 'B restocked');
});

const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
