// Seeds the ISOLATED schema it_esc for the stock + permission-escalation
// security suite (round 25F, PR #42 follow-up 5efa247). Never production.
// Run AFTER the API booted once on it_esc (permission catalogue + system roles).
//   DATABASE_URL=...?schema=it_esc node escalation-seed.js <worktree> <out.json>
const path = require('path');
const fs = require('fs');
const [, , wt, out] = process.argv;
if (!/schema=it_esc\b/.test(process.env.DATABASE_URL || '') || !/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL)) {
  throw new Error('refusing: DATABASE_URL must be the local it_esc schema');
}
const { PrismaClient } = require(path.join(wt, 'packages', 'database', 'node_modules', '@prisma', 'client'));
const bcrypt = require(path.join(wt, 'apps', 'api', 'node_modules', 'bcryptjs'));
const db = new PrismaClient();
const PW = 'ItTest12345';

(async () => {
  const superRole = await db.role.findFirst({ where: { name: 'SUPER_ADMIN', isSystem: true, tenantId: null } });
  if (!superRole) throw new Error('boot the API once first');
  const perm = async (codes) => db.permission.findMany({ where: { code: { in: codes } } });
  async function shop(slug) {
    const t = await db.tenant.create({ data: { name: `IT ${slug}`, slug, status: 'ACTIVE' } });
    for (const moduleCode of ['inventory', 'pos']) await db.tenantModule.create({ data: { tenantId: t.id, moduleCode, isEnabled: true } });
    return t;
  }
  async function role(tenantId, name, codes, { deleted = false } = {}) {
    const ps = await perm(codes);
    if (ps.length !== codes.length) throw new Error(`missing permission codes for ${name}`);
    const r = await db.role.create({
      data: { tenantId, name, isSystem: false, ...(deleted ? { deletedAt: new Date(), isActive: false } : {}) },
    });
    await db.rolePermission.createMany({ data: ps.map((p) => ({ roleId: r.id, permissionId: p.id })) });
    return r.id;
  }
  async function admin(tenantId, tag, roleString, roleIds = []) {
    const email = `it-esc-${tag}@example.test`;
    const a = await db.adminUser.create({ data: { tenantId, email, passwordHash: await bcrypt.hash(PW, 10), firstName: 'Esc', lastName: tag, role: roleString, isActive: true } });
    for (const roleId of roleIds) await db.adminUserRole.create({ data: { adminUserId: a.id, roleId } });
    return { id: a.id, email, password: PW };
  }
  async function product(tenantId, categoryId, slug, name, variants, extra = {}) {
    const p = await db.product.create({
      data: {
        tenantId, name, slug, description: 'test', categoryId, availabilityMode: 'PURCHASE_ONLY', basePrice: 100000, isActive: true, ...extra,
        variants: { create: variants.map(([vname, stock]) => ({ tenantId, name: vname, sku: `${slug}-${vname}`.toUpperCase(), price: 100000, stock })) },
      },
      include: { variants: { orderBy: { name: 'asc' } } },
    });
    return { id: p.id, variants: Object.fromEntries(p.variants.map((v) => [v.name, v.id])) };
  }

  const A = await shop('it-esc-a');
  const B = await shop('it-esc-b');
  const MGR = ['roles:view', 'roles:manage', 'admins:view', 'admins:create', 'admins:update', 'inventory:view'];
  const roles = {
    staff: await role(A.id, 'IT Staff', ['inventory:view']),
    manager: await role(A.id, 'IT Manager-like', MGR),
    inventory: await role(A.id, 'IT Inventory', ['inventory:view', 'inventory:manage']),
    cashier: await role(A.id, 'IT Cashier', ['pos:refund']),
    low: await role(A.id, 'IT Low', ['inventory:view']),
    low2: await role(A.id, 'IT Low 2', ['inventory:view']),
    spare: await role(A.id, 'IT Spare', ['inventory:view']),
    deletedStrong: await role(A.id, 'IT Deleted strong', ['inventory:view', 'inventory:manage'], { deleted: true }),
    deletedLow: await role(A.id, 'IT Deleted low', ['inventory:view'], { deleted: true }),
    deletedOwn: await role(A.id, 'IT Deleted own', ['inventory:view'], { deleted: true }),
    shopB: await role(B.id, 'IT B role', ['inventory:view']),
    shopBDeleted: await role(B.id, 'IT B deleted', ['inventory:view'], { deleted: true }),
    shopBInventory: await role(B.id, 'IT B inventory', ['inventory:view', 'inventory:manage']),
  };
  const catA = await db.category.create({ data: { tenantId: A.id, name: 'Esc Gowns', slug: 'esc-gowns' } });
  const catB = await db.category.create({ data: { tenantId: B.id, name: 'Esc Gowns B', slug: 'esc-gowns-b' } });
  const products = {
    daily: await product(A.id, catA.id, 'esc-daily', 'Esc Daily Gown', [['M', 10]]),
    other: await product(A.id, catA.id, 'esc-other', 'Esc Other Dress', [['M', 5]]),
    sizes: await product(A.id, catA.id, 'esc-sizes', 'Esc Sizes Gown', [['L', 0], ['S', 5], ['XL', 0]]),
    pos: await product(A.id, catA.id, 'esc-pos', 'Esc POS Item', [['M', 8]]),
    settings: await product(A.id, catA.id, 'esc-settings', 'Esc Settings Gown', [['M', 3]], {
      purchasePrice: 40000, minimumStock: 2, supplierName: 'Acme', supplierContact: '+255700000001',
    }),
    shopB: await product(B.id, catB.id, 'esc-shop-b', 'Esc Shop B Gown', [['M', 3]]),
  };
  const ids = {
    tenantA: A.id, tenantB: B.id, categorySlug: 'esc-gowns', categoryId: catA.id, roles, products,
    admins: {
      super: await admin(A.id, 'super', 'SUPER_ADMIN', [superRole.id]),
      staff: await admin(A.id, 'staff', 'STAFF', [roles.staff]),
      manager: await admin(A.id, 'manager', 'MANAGER', [roles.manager, roles.deletedOwn]),
      inventory: await admin(A.id, 'inventory', 'STAFF', [roles.inventory]),
      cashier: await admin(A.id, 'cashier', 'STAFF', [roles.cashier]),
      targetStrong: await admin(A.id, 'target-strong', 'STAFF', [roles.inventory]),
      targetLow: await admin(A.id, 'target-low', 'STAFF', [roles.low]),
      targetToggle: await admin(A.id, 'target-toggle', 'STAFF', [roles.low]),
      superB: await admin(B.id, 'super-b', 'SUPER_ADMIN', [superRole.id]),
      adminB: await admin(B.id, 'admin-b', 'STAFF', [roles.shopB]),
    },
  };
  fs.writeFileSync(out, JSON.stringify(ids, null, 2));
  console.log('seeded it_esc: 2 shops, 10 admins, 13 roles, 6 products');
  await db.$disconnect();
})().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
