// Round 25H (PR #42 readiness): seeds an ISOLATED schema with the PRODUCTION
// grant shapes — the shared system MANAGER / STAFF / SUPER_ADMIN roles exactly
// as the API seeds them on boot (MANAGER = catalogue minus MANAGER_EXCLUDED,
// plus MANAGER_DEFAULT_GRANTS; STAFF = STAFF_CODES). No custom MANAGER role:
// the test identities hold the real system rows. Never production.
// Run AFTER the API booted once on the schema (catalogue + system roles).
//   IT_SCHEMA=it_r42 DATABASE_URL=...?schema=it_r42 node manager-compat-seed.js <worktree> <out.json>
const path = require('path');
const fs = require('fs');
const [, , wt, out] = process.argv;
const SEED_SCHEMA = process.env.IT_SCHEMA || 'it_r42';
if (!/^it_[a-z0-9_]+$/.test(SEED_SCHEMA)) throw new Error('refusing: isolated it_* schema only');
if (!new RegExp(`schema=${SEED_SCHEMA}\\b`).test(process.env.DATABASE_URL || '') || !/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || '')) {
  throw new Error(`refusing: DATABASE_URL must be the local ${SEED_SCHEMA} schema`);
}
const { PrismaClient } = require(path.join(wt, 'packages', 'database', 'node_modules', '@prisma', 'client'));
const bcrypt = require(path.join(wt, 'apps', 'api', 'node_modules', 'bcryptjs'));
const db = new PrismaClient();
const PW = 'ItTest12345';

(async () => {
  const sys = async (name) => {
    const r = await db.role.findFirst({ where: { name, isSystem: true, tenantId: null } });
    if (!r) throw new Error(`system role ${name} missing — boot the API once first`);
    return r;
  };
  const superRole = await sys('SUPER_ADMIN');
  const managerRole = await sys('MANAGER');
  const staffRole = await sys('STAFF');
  const codesOf = async (roleId) => (await db.rolePermission.findMany({ where: { roleId }, select: { permission: { select: { code: true } } } }))
    .map((r) => r.permission.code).sort();

  async function shop(slug) {
    const t = await db.tenant.create({ data: { name: `IT ${slug}`, slug, status: 'ACTIVE' } });
    for (const moduleCode of ['inventory', 'pos']) await db.tenantModule.create({ data: { tenantId: t.id, moduleCode, isEnabled: true } });
    return t;
  }
  async function customRole(tenantId, name, codes, { deleted = false } = {}) {
    const ps = await db.permission.findMany({ where: { code: { in: codes } } });
    if (ps.length !== codes.length) throw new Error(`missing permission codes for ${name}`);
    const r = await db.role.create({ data: { tenantId, name, isSystem: false, ...(deleted ? { deletedAt: new Date(), isActive: false } : {}) } });
    await db.rolePermission.createMany({ data: ps.map((p) => ({ roleId: r.id, permissionId: p.id })) });
    return r.id;
  }
  async function admin(tenantId, tag, roleString, roleIds, extra = {}) {
    const email = `it-r42-${tag}@example.test`;
    const a = await db.adminUser.create({ data: { tenantId, email, passwordHash: await bcrypt.hash(PW, 10), firstName: 'R42', lastName: tag, role: roleString, isActive: true, ...extra } });
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

  const A = await shop(`${SEED_SCHEMA.replace(/_/g, '-')}-a`);
  const B = await shop(`${SEED_SCHEMA.replace(/_/g, '-')}-b`);
  const catA = await db.category.create({ data: { tenantId: A.id, name: 'R42 Gowns', slug: 'r42-gowns' } });
  const catB = await db.category.create({ data: { tenantId: B.id, name: 'R42 Gowns B', slug: 'r42-gowns-b' } });
  const roles = {
    // a role carrying a code the MANAGER does not hold (payments:manage is in MANAGER_EXCLUDED)
    strong: await customRole(A.id, 'R42 Payments clerk', ['payments:manage', 'orders:view']),
    // a role within the MANAGER's own codes
    low: await customRole(A.id, 'R42 Low', ['inventory:view', 'products:view']),
    deletedLow: await customRole(A.id, 'R42 Deleted low', ['inventory:view'], { deleted: true }),
  };
  const products = {
    restock: await product(A.id, catA.id, 'r42-restock', 'R42 Restock Gown', [['M', 10]], { purchasePrice: 40000, minimumStock: 2, supplierName: 'Acme', supplierContact: '+255700000001' }),
    race: await product(A.id, catA.id, 'r42-race', 'R42 Race Gown', [['M', 15]]),
    sizes: await product(A.id, catA.id, 'r42-sizes', 'R42 Sizes Gown', [['L', 0], ['S', 5]]),
    staff: await product(A.id, catA.id, 'r42-staff', 'R42 Staff Gown', [['M', 6], ['S', 4]], { purchasePrice: 30000, minimumStock: 1, supplierName: 'Beta', supplierContact: '+255700000002' }),
    shopB: await product(B.id, catB.id, 'r42-shop-b', 'R42 Shop B Gown', [['M', 3]]),
  };
  const ids = {
    schema: SEED_SCHEMA, tenantA: A.id, tenantB: B.id, categoryId: catA.id, categorySlug: 'r42-gowns',
    systemRoles: { super: superRole.id, manager: managerRole.id, staff: staffRole.id },
    managerCodes: await codesOf(managerRole.id), staffCodes: await codesOf(staffRole.id),
    roles, products,
    admins: {
      super: await admin(A.id, 'super', 'SUPER_ADMIN', [superRole.id]),
      manager: await admin(A.id, 'manager', 'MANAGER', [managerRole.id]),
      manager2: await admin(A.id, 'manager2', 'MANAGER', [managerRole.id]),
      staff: await admin(A.id, 'staff', 'STAFF', [staffRole.id]),
      staff2: await admin(A.id, 'staff2', 'STAFF', [staffRole.id]),
      strong: await admin(A.id, 'strong', 'STAFF', [staffRole.id, roles.strong]),
      super2: await admin(A.id, 'super2', 'SUPER_ADMIN', [superRole.id]),
      lockedStaff: await admin(A.id, 'locked-staff', 'STAFF', [staffRole.id], { failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 30 * 60e3) }),
      lockedSuper: await admin(A.id, 'locked-super', 'SUPER_ADMIN', [superRole.id], { failedLoginAttempts: 5, lockedUntil: new Date(Date.now() + 30 * 60e3) }),
      managerB: await admin(B.id, 'manager-b', 'MANAGER', [managerRole.id]),
    },
  };
  fs.writeFileSync(out, JSON.stringify(ids, null, 2));
  console.log(`seeded ${SEED_SCHEMA}: 2 shops, 10 admins on the SYSTEM roles (MANAGER ${ids.managerCodes.length} codes, STAFF ${ids.staffCodes.length}), 5 products`);
  await db.$disconnect();
})().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
