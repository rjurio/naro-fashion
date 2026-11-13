// Seeds the ISOLATED schema it_inv for the inventory-authorization security
// test (round 25F B, production baseline). Never production. Run AFTER the API
// booted once on it_inv (permission catalogue + system roles).
//   DATABASE_URL=...?schema=it_inv node inventory-sec-seed.js <worktree> <out.json>
const path = require('path');
const fs = require('fs');
const [, , wt, out] = process.argv;
// IT_SCHEMA (default it_inv): the isolated schema this seed may write to.
const SEED_SCHEMA = process.env.IT_SCHEMA || 'it_inv';
if (!new RegExp(`schema=${SEED_SCHEMA}\\b`).test(process.env.DATABASE_URL || '') || !/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || '')) {
  throw new Error(`refusing: DATABASE_URL must be the local ${SEED_SCHEMA} schema`);
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
    for (const moduleCode of ['inventory']) await db.tenantModule.create({ data: { tenantId: t.id, moduleCode, isEnabled: true } });
    return t;
  }
  async function role(tenantId, name, codes) {
    const ps = await perm(codes);
    if (ps.length !== codes.length) throw new Error(`missing permission codes for ${name}`);
    const r = await db.role.create({ data: { tenantId, name, isSystem: false } });
    await db.rolePermission.createMany({ data: ps.map((p) => ({ roleId: r.id, permissionId: p.id })) });
    return r;
  }
  async function admin(tenantId, tag, roleString, roleId) {
    const email = `it-inv-${tag}@example.test`;
    const a = await db.adminUser.create({ data: { tenantId, email, passwordHash: await bcrypt.hash(PW, 10), firstName: 'Inv', lastName: tag, role: roleString, isActive: true } });
    if (roleId) await db.adminUserRole.create({ data: { adminUserId: a.id, roleId } });
    return { id: a.id, email, password: PW };
  }
  const A = await shop('it-inv-a');
  const B = await shop('it-inv-b');
  const staffRole = await role(A.id, 'IT Staff', ['inventory:view']);
  const invRole = await role(A.id, 'IT Inventory', ['inventory:view', 'inventory:manage']);
  const roleAdminRole = await role(A.id, 'IT Role admin', ['roles:view', 'roles:manage', 'inventory:view']);
  const spareRole = await role(A.id, 'IT Spare', ['inventory:view']);
  const invRoleB = await role(B.id, 'IT Inventory B', ['inventory:view', 'inventory:manage']);
  const cat = await db.category.create({ data: { tenantId: A.id, name: 'Gowns', slug: 'gowns-it-inv' } });
  const p = await db.product.create({
    data: {
      tenantId: A.id, name: 'IT Gown', slug: 'it-gown-inv', description: 'test', categoryId: cat.id, availabilityMode: 'PURCHASE_ONLY',
      basePrice: 100000, purchasePrice: 40000, isActive: true,
      variants: { create: [{ tenantId: A.id, name: 'M', sku: 'IT-INV-M', price: 100000, stock: 10 }] },
    },
    include: { variants: true },
  });
  const ids = {
    tenantA: A.id, tenantB: B.id, categoryId: cat.id, productId: p.id, variantId: p.variants[0].id,
    roles: { staff: staffRole.id, inventory: invRole.id, roleAdmin: roleAdminRole.id, spare: spareRole.id },
    admins: {
      super: await admin(A.id, 'super', 'SUPER_ADMIN', superRole.id),
      staff: await admin(A.id, 'staff', 'STAFF', staffRole.id),
      inventory: await admin(A.id, 'inventory', 'STAFF', invRole.id),
      roleAdmin: await admin(A.id, 'roleadmin', 'MANAGER', roleAdminRole.id),
      inventoryB: await admin(B.id, 'inventory-b', 'STAFF', invRoleB.id),
    },
  };
  fs.writeFileSync(out, JSON.stringify(ids, null, 2));
  console.log('seeded it_inv: 2 shops, 5 admins, 1 product (stock 10)');
  await db.$disconnect();
})().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
