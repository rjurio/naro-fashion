// Seeds the ISOLATED schema it_quote (local dev Postgres) for the rental-quote
// integration test. Never points at production. Usage:
//   DATABASE_URL=...?schema=it_quote node seed.js <worktree> <out.json>
const path = require('path');
const fs = require('fs');
const [, , wt, out] = process.argv;
if (!/schema=it_quote/.test(process.env.DATABASE_URL || '') || !/localhost/.test(process.env.DATABASE_URL)) {
  throw new Error('refusing: DATABASE_URL must be the local it_quote schema');
}
const { PrismaClient } = require(path.join(wt, 'packages', 'database', 'node_modules', '@prisma', 'client'));
const bcrypt = require(path.join(wt, 'apps', 'api', 'node_modules', 'bcryptjs'));
const db = new PrismaClient();

async function tenant(slug) {
  const t = await db.tenant.create({ data: { name: `IT ${slug}`, slug, status: 'ACTIVE' } });
  await db.tenantModule.create({ data: { tenantId: t.id, moduleCode: 'rentals', isEnabled: true } });
  const c = await db.category.create({ data: { tenantId: t.id, name: 'Gowns', slug: `gowns-${slug}` } });
  return { t, c };
}
async function product(tenantId, categoryId, slug, extra) {
  const p = await db.product.create({
    data: {
      tenantId, categoryId, name: `IT ${slug}`, slug, basePrice: 950000, isActive: true,
      availabilityMode: 'BOTH', rentalPricePerDay: 140000, rentalDepositAmount: 350000, maxRentalDays: 7,
      ...extra,
    },
  });
  const v = await db.productVariant.create({
    data: { tenantId, productId: p.id, name: 'Standard', sku: `IT-${slug}`, price: 950000, stock: 1, isActive: true },
  });
  return { id: p.id, slug, variantId: v.id };
}

(async () => {
  const A = await tenant('it-shop');
  const B = await tenant('it-other');
  await db.rentalPolicy.create({ data: { tenantId: A.t.id, defaultDownPaymentPct: 25 } });
  await db.rentalPolicy.create({ data: { tenantId: B.t.id, defaultDownPaymentPct: 50 } });
  const ids = {
    tenantA: A.t.id, tenantASlug: 'it-shop', tenantB: B.t.id,
    gown: await product(A.t.id, A.c.id, 'it-gown', {}),
    gown2: await product(A.t.id, A.c.id, 'it-gown-2', {}),
    inactive: await product(A.t.id, A.c.id, 'it-inactive', { isActive: false }),
    saleOnly: await product(A.t.id, A.c.id, 'it-sale-only', { availabilityMode: 'PURCHASE_ONLY' }),
    noFee: await product(A.t.id, A.c.id, 'it-no-fee', { rentalPricePerDay: null, basePrice: 0 }),
    otherTenant: await product(B.t.id, B.c.id, 'it-other-gown', {}),
  };
  const user = await db.user.create({
    data: {
      tenantId: A.t.id, email: 'it-customer@example.test', passwordHash: await bcrypt.hash('ItTest12345', 10),
      firstName: 'Test', lastName: 'Customer', phone: '+255700000000', isActive: true,
    },
  });
  await db.address.create({
    data: { userId: user.id, fullName: 'Test Customer', phone: '+255700000000', street: 'Test St', city: 'Dar es Salaam', region: 'Dar es Salaam' },
  });
  ids.customer = { email: 'it-customer@example.test', password: 'ItTest12345' };
  fs.writeFileSync(out, JSON.stringify(ids, null, 2));
  console.log('seeded', Object.keys(ids).join(','));
  await db.$disconnect();
})().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
