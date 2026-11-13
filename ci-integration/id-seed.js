// Seeds the ISOLATED schema it_id (local dev Postgres) for the National ID
// enforcement integration test. Never points at production. Run AFTER the
// local API has booted once (it seeds the permission catalogue + system roles).
//   DATABASE_URL=...?schema=it_id node id-seed.js <worktree> <out.json>
const path = require('path');
const fs = require('fs');
const [, , wt, out] = process.argv;
if (!/schema=it_id\b/.test(process.env.DATABASE_URL || '') || !/@localhost[:/]/.test(process.env.DATABASE_URL)) {
  throw new Error('refusing: DATABASE_URL must be the local it_id schema');
}
const { PrismaClient } = require(path.join(wt, 'packages', 'database', 'node_modules', '@prisma', 'client'));
const bcrypt = require(path.join(wt, 'apps', 'api', 'node_modules', 'bcryptjs'));
const db = new PrismaClient();
const PW = 'ItTest12345';

async function tenant(slug) {
  const t = await db.tenant.create({ data: { name: `IT ${slug}`, slug, status: 'ACTIVE' } });
  for (const moduleCode of ['rentals', 'id-verification']) {
    await db.tenantModule.create({ data: { tenantId: t.id, moduleCode, isEnabled: true } });
  }
  const c = await db.category.create({ data: { tenantId: t.id, name: 'Rentals', slug: `rentals-${slug}` } });
  await db.rentalPolicy.create({ data: { tenantId: t.id, defaultDownPaymentPct: 25, bufferDaysBetweenRentals: 0 } });
  return { t, c };
}
async function product(tenantId, categoryId, slug, pct = 25) {
  const p = await db.product.create({
    data: {
      tenantId, categoryId, name: `IT ${slug}`, slug, basePrice: 950000, isActive: true,
      availabilityMode: 'RENTAL_ONLY', rentalPricePerDay: 100000, rentalDepositAmount: 50000,
      rentalDownPaymentPct: pct, bufferDaysOverride: 0,
    },
  });
  const v = await db.productVariant.create({
    data: { tenantId, productId: p.id, name: 'Standard', sku: `IT-${slug}`, price: 950000, stock: 1, isActive: true },
  });
  return { id: p.id, variantId: v.id };
}
async function customer(tenantId, tag) {
  const email = `it-${tag}@example.test`;
  const u = await db.user.create({
    data: {
      tenantId, email, passwordHash: await bcrypt.hash(PW, 10),
      firstName: 'Test', lastName: tag, phone: `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, isActive: true,
    },
  });
  await db.address.create({
    data: { userId: u.id, fullName: `Test ${tag}`, phone: '+255700000000', street: 'Test St', city: 'Dar es Salaam', region: 'Dar es Salaam' },
  });
  return { id: u.id, email, password: PW };
}
async function admin(tenantId, tag, roleString, roleId) {
  const email = `it-admin-${tag}@example.test`;
  const a = await db.adminUser.create({
    data: { tenantId, email, passwordHash: await bcrypt.hash(PW, 10), firstName: 'Admin', lastName: tag, role: roleString, isActive: true },
  });
  if (roleId) await db.adminUserRole.create({ data: { adminUserId: a.id, roleId } });
  return { id: a.id, email, password: PW };
}

(async () => {
  const perm = await db.permission.findUnique({ where: { code: 'id-verification:review' } });
  const staffRole = await db.role.findFirst({ where: { name: 'STAFF', isSystem: true, tenantId: null } });
  const superRole = await db.role.findFirst({ where: { name: 'SUPER_ADMIN', isSystem: true, tenantId: null } });
  const managerRole = await db.role.findFirst({ where: { name: 'MANAGER', isSystem: true, tenantId: null } });
  if (!perm || !staffRole || !superRole || !managerRole) throw new Error('boot the API once first (permissions / system roles missing)');

  const A = await tenant('it-id-shop');
  const B = await tenant('it-id-other');
  // A custom role holding ONLY id-verification:review (an "ID reviewer").
  const reviewerRole = await db.role.create({ data: { tenantId: A.t.id, name: 'ID Reviewer', isSystem: false } });
  await db.rolePermission.create({ data: { roleId: reviewerRole.id, permissionId: perm.id } });

  const products = {};
  for (let i = 1; i <= 24; i++) products[`p${i}`] = await product(A.t.id, A.c.id, `it-id-item-${i}`);
  const ids = {
    tenantA: A.t.id, tenantB: B.t.id, products,
    otherTenantProduct: await product(B.t.id, B.c.id, 'it-id-other-item'),
    // 0 % down payment items (revised hold rules)
    zero: [await product(A.t.id, A.c.id, 'it-id-zero-1', 0), await product(A.t.id, A.c.id, 'it-id-zero-2', 0)],
    admins: {
      super: await admin(A.t.id, 'super', 'SUPER_ADMIN', superRole.id),
      staff: await admin(A.t.id, 'staff', 'STAFF', staffRole.id),
      reviewer: await admin(A.t.id, 'reviewer', 'STAFF', reviewerRole.id),
      manager: await admin(A.t.id, 'manager', 'MANAGER', managerRole.id),
    },
    customers: {},
  };
  const holdTags = ['h-noid', 'h-review', 'h-reject', 'h-zero', 'h-zero2', 'h-pickup', 'h-multi', 'h-pay', 'h-race', 'h-resched', 'h-ar', 'h-legacy1', 'h-legacy2', 'h-onfile', 'h-r2-pay', 'h-r2-other', 'h-r2-noid', 'h-r2-rev', 'h-r2-race'];
  for (const tag of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'race1', 'race2', 'race3', 'race4', 'race5', 'dbl', 'hold', ...holdTags]) {
    ids.customers[tag] = await customer(A.t.id, tag);
  }
  ids.customers.otherTenant = await customer(B.t.id, 'otb');
  fs.writeFileSync(out, JSON.stringify(ids, null, 2));
  console.log('seeded it_id:', Object.keys(ids.customers).length, 'customers,', Object.keys(products).length, 'items');
  await db.$disconnect();
})().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
