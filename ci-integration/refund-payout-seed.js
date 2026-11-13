// Seeds the ISOLATED schema it_payout (local dev / CI Postgres) for the
// refunds:payout three-person workflow test. Never production. Run AFTER the
// API booted once on it_payout (permission catalogue + system roles).
//   DATABASE_URL=...?schema=it_payout node refund-payout-seed.js <worktree> <out.json>
// The three staff identities and their custom roles exist ONLY in this test
// schema; nothing is granted anywhere else.
const path = require('path');
const fs = require('fs');
const [, , wt, out] = process.argv;
if (!/schema=it_payout\b/.test(process.env.DATABASE_URL || '') || !/@localhost[:/]/.test(process.env.DATABASE_URL)) {
  throw new Error('refusing: DATABASE_URL must be the local it_payout schema');
}
const { PrismaClient } = require(path.join(wt, 'packages', 'database', 'node_modules', '@prisma', 'client'));
const bcrypt = require(path.join(wt, 'apps', 'api', 'node_modules', 'bcryptjs'));
const db = new PrismaClient();
const PW = 'ItTest12345';

async function role(tenantId, name, codes) {
  const perms = await db.permission.findMany({ where: { code: { in: codes } } });
  if (perms.length !== codes.length) throw new Error(`missing permissions for ${name}: ${codes.filter((c) => !perms.some((p) => p.code === c))}`);
  const r = await db.role.create({ data: { tenantId, name, isSystem: false } });
  await db.rolePermission.createMany({ data: perms.map((p) => ({ roleId: r.id, permissionId: p.id })) });
  return r;
}
async function admin(tenantId, tag, roleString, roleId, twoFA = false) {
  const email = `it-payout-${tag}@example.test`;
  const a = await db.adminUser.create({
    data: { tenantId, email, passwordHash: await bcrypt.hash(PW, 10), firstName: 'Payout', lastName: tag, role: roleString, isActive: true, is2FAEnabled: twoFA },
  });
  if (roleId) await db.adminUserRole.create({ data: { adminUserId: a.id, roleId } });
  return { id: a.id, email, password: PW };
}

// The three people (STAFF_ASSIGNMENT_3_PEOPLE.xlsx, with refunds:payout for the cashier instead of payments:manage).
const CASHIER = [
  'rentals:view', 'rentals:create', 'rentals:record-payment', 'rentals:release', 'rentals:update-status',
  'rentals:checklist-verify', 'rentals:refund-request', 'pos:refund', 'orders:refund', 'orders:view', 'refunds:payout',
];
const MANAGER = [
  'rentals:view', 'rentals:update-status', 'rentals:checklist-exception', 'rentals:checklist-templates',
  'refunds:approve', 'id-verification:review', 'rentals:refund-request', 'reports:view',
];
const OWNER = ['rentals:view', 'orders:view', 'refunds:approve', 'payments:manage', 'reports:view'];

(async () => {
  const superRole = await db.role.findFirst({ where: { name: 'SUPER_ADMIN', isSystem: true, tenantId: null } });
  if (!superRole) throw new Error('boot the API once first');
  if (!(await db.permission.findFirst({ where: { code: 'refunds:payout' } }))) throw new Error('this build has no refunds:payout');
  const ids = { password: PW };

  // ---------------------------------------------------------------- shop A
  const t = await db.tenant.create({ data: { name: 'IT PAYOUT', slug: 'it-payout-shop', status: 'ACTIVE' } });
  for (const moduleCode of ['rentals', 'id-verification', 'pos', 'reports']) await db.tenantModule.create({ data: { tenantId: t.id, moduleCode, isEnabled: true } });
  await db.rentalPolicy.create({ data: { tenantId: t.id, defaultDownPaymentPct: 25, bufferDaysBetweenRentals: 2, lateFeePerDay: 0 } });
  const rc = await db.category.create({ data: { tenantId: t.id, name: 'Rentals', slug: 'rentals-it-payout' } });
  const gown = await db.product.create({
    data: {
      tenantId: t.id, categoryId: rc.id, name: 'IT Payout Gown', slug: 'it-payout-gown', basePrice: 1500000, isActive: true,
      availabilityMode: 'RENTAL_ONLY', rentalPricePerDay: 400000, rentalDepositAmount: 200000, rentalDownPaymentPct: 25,
      latePenaltyPercent: 10, bufferDaysOverride: 2,
    },
  });
  const vS = await db.productVariant.create({ data: { tenantId: t.id, productId: gown.id, name: 'S', sku: 'IT-PO-GOWN-S', price: 1500000, stock: 1, isActive: true } });
  const vM = await db.productVariant.create({ data: { tenantId: t.id, productId: gown.id, name: 'M', sku: 'IT-PO-GOWN-M', price: 1500000, stock: 1, isActive: true } });
  const ac = await db.category.create({ data: { tenantId: t.id, name: 'Accessories', slug: 'acc-it-payout' } });
  const scarf = await db.product.create({ data: { tenantId: t.id, categoryId: ac.id, name: 'IT Payout Scarf', slug: 'it-payout-scarf', basePrice: 10000, isActive: true, availabilityMode: 'PURCHASE_ONLY' } });
  const sv = await db.productVariant.create({ data: { tenantId: t.id, productId: scarf.id, name: 'One size', sku: 'IT-PO-SCARF', price: 10000, stock: 20, isActive: true } });
  const customer = await db.user.create({ data: { tenantId: t.id, email: 'it-payout-c@example.test', phone: '+255711000091', firstName: 'Cust', lastName: 'Payout' } });

  const cashierRole = await role(t.id, 'IT Cashier (desk + payout)', CASHIER);
  const managerRole = await role(t.id, 'IT Manager / reviewer', MANAGER);
  const ownerRole = await role(t.id, 'IT Owner / finance', OWNER);
  const probeRole = await role(t.id, 'IT payout-only probe', ['refunds:payout']);
  const A = {
    tenantId: t.id,
    gown: { id: gown.id, S: vS.id, M: vM.id },
    scarf: { id: scarf.id, variantId: sv.id },
    admins: {
      cashier: await admin(t.id, 'cashier', 'STAFF', cashierRole.id),
      manager: await admin(t.id, 'manager', 'STAFF', managerRole.id, true), // ID reviewer: 2FA flag (ReviewerTwoFactorGuard)
      owner: await admin(t.id, 'owner', 'STAFF', ownerRole.id),
      // Not staff in the workflows: a probe with ONLY refunds:payout (route matrix)
      // and a SUPER_ADMIN (to show no role bypasses separation).
      probe: await admin(t.id, 'probe', 'STAFF', probeRole.id),
      super: await admin(t.id, 'super', 'SUPER_ADMIN', superRole.id),
    },
    sessions: {},
  };
  for (const k of ['cashier', 'owner']) {
    A.sessions[k] = (await db.posSession.create({ data: { tenantId: t.id, adminUserId: A.admins[k].id, openingCash: 500000, status: 'OPEN' } })).id;
  }
  // Two online orders paid by mobile money (order refunds).
  A.orders = [];
  for (const n of [1, 2]) {
    const o = await db.order.create({
      data: { tenantId: t.id, orderNumber: `IT-PO-ONL-${n}`, userId: customer.id, subtotal: 50000, total: 50000, paymentMethod: 'MPESA', status: 'DELIVERED', paymentStatus: 'PAID', channel: 'ONLINE' },
    });
    await db.payment.create({ data: { tenantId: t.id, orderId: o.id, amount: 50000, method: 'MPESA', status: 'COMPLETED', transactionRef: `IT-PO-MP-${n}`, providerCode: 'clickpesa' } });
    A.orders.push(o.id);
  }
  ids.a = A;

  // ---------------------------------------------------------------- shop B (cross-tenant)
  const tb = await db.tenant.create({ data: { name: 'IT PAYOUT B', slug: 'it-payout-b', status: 'ACTIVE' } });
  for (const moduleCode of ['rentals', 'pos']) await db.tenantModule.create({ data: { tenantId: tb.id, moduleCode, isEnabled: true } });
  const bSuper = await admin(tb.id, 'b-super', 'SUPER_ADMIN', superRole.id);
  const cb = await db.user.create({ data: { tenantId: tb.id, email: 'it-payout-b-c@example.test', phone: '+255711000092', firstName: 'Cust', lastName: 'B' } });
  const ob = await db.order.create({
    data: { tenantId: tb.id, orderNumber: 'IT-PO-B-1', userId: cb.id, subtotal: 30000, total: 30000, paymentMethod: 'MPESA', status: 'DELIVERED', paymentStatus: 'PAID', channel: 'ONLINE' },
  });
  await db.payment.create({ data: { tenantId: tb.id, orderId: ob.id, amount: 30000, method: 'MPESA', status: 'COMPLETED', transactionRef: 'IT-PO-B-MP-1', providerCode: 'clickpesa' } });
  const rb = await db.refundRequest.create({
    data: { tenantId: tb.id, subject: 'ORDER', kind: 'ORDER_REFUND', orderId: ob.id, amount: 10000, reason: 'shop B refund', status: 'APPROVED', requestedById: 'SYSTEM:TEST', approvedById: bSuper.id, approvedAt: new Date() },
  });
  ids.b = { tenantId: tb.id, order: ob.id, approvedRequest: rb.id, admins: { super: bSuper } };

  fs.writeFileSync(out, JSON.stringify(ids, null, 2));
  console.log('seeded it_payout: shop A (cashier / manager / owner + probe + super, 2 open shifts, 2 paid online orders, gown, scarf); shop B (1 approved request)');
  await db.$disconnect();
})().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
