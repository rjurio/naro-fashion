// Seeds the ISOLATED schema it_pos (or it_r1i, for r1-integration) (local dev Postgres) for the walk-in POS
// rental MVP integration test. Never production. Run AFTER the local API
// booted once on it_pos (permission catalogue + system roles).
//   DATABASE_URL=...?schema=it_pos node pos-rental-seed.js <worktree> <out.json>
const path = require('path');
const fs = require('fs');
const [, , wt, out] = process.argv;
if (!/schema=it_(pos|r1i|tpl|r1g|r1c|r1s|r1b)\b/.test(process.env.DATABASE_URL || "") || !/@localhost[:/]/.test(process.env.DATABASE_URL)) {
  throw new Error('refusing: DATABASE_URL must be the local it_pos / it_r1i / it_tpl schema');
}
const { PrismaClient } = require(path.join(wt, 'packages', 'database', 'node_modules', '@prisma', 'client'));
const bcrypt = require(path.join(wt, 'apps', 'api', 'node_modules', 'bcryptjs'));
const db = new PrismaClient();
const PW = 'ItTest12345';

async function role(tenantId, name, codes) {
  const perms = await db.permission.findMany({ where: { code: { in: codes } } });
  // r1w: the re-cut build has no walk-in codes (rentals:create / rentals:record-payment).
  if (process.env.IT_ALLOW_MISSING_CODES === '1') codes = codes.filter((c) => perms.some((p) => p.code === c));
  if (perms.length !== codes.length) throw new Error(`missing permissions for ${name}: ${codes.filter((c) => !perms.some((p) => p.code === c))}`);
  const r = await db.role.create({ data: { tenantId, name, isSystem: false } });
  await db.rolePermission.createMany({ data: perms.map((p) => ({ roleId: r.id, permissionId: p.id })) });
  return r;
}
async function admin(tenantId, tag, roleString, roleId, twoFA = false) {
  const email = `it-pos-${tag}@example.test`;
  const a = await db.adminUser.create({
    data: { tenantId, email, passwordHash: await bcrypt.hash(PW, 10), firstName: 'POS', lastName: tag, role: roleString, isActive: true, is2FAEnabled: twoFA },
  });
  if (roleId) await db.adminUserRole.create({ data: { adminUserId: a.id, roleId } });
  return { id: a.id, email, password: PW };
}

(async () => {
  const superRole = await db.role.findFirst({ where: { name: 'SUPER_ADMIN', isSystem: true, tenantId: null } });
  if (!superRole) throw new Error('boot the API once first');
  const t = await db.tenant.create({ data: { name: 'IT POS', slug: 'it-pos-shop', status: 'ACTIVE' } });
  for (const moduleCode of ['rentals', 'id-verification', 'pos', 'reports']) {
    await db.tenantModule.create({ data: { tenantId: t.id, moduleCode, isEnabled: true } });
  }
  const c = await db.category.create({ data: { tenantId: t.id, name: 'Rentals', slug: 'rentals-it-pos' } });
  await db.rentalPolicy.create({ data: { tenantId: t.id, defaultDownPaymentPct: 25, bufferDaysBetweenRentals: 2, lateFeePerDay: 0 } });
  const gown = await db.product.create({
    data: {
      tenantId: t.id, categoryId: c.id, name: 'IT Ivory Ball Gown', slug: 'it-pos-gown', basePrice: 1500000, isActive: true,
      availabilityMode: 'RENTAL_ONLY', rentalPricePerDay: 400000, rentalDepositAmount: 200000, rentalDownPaymentPct: 25,
      latePenaltyPercent: 10, bufferDaysOverride: 2,
    },
  });
  const vS = await db.productVariant.create({ data: { tenantId: t.id, productId: gown.id, name: 'S', sku: 'IT-POS-GOWN-S', price: 1500000, stock: 1, isActive: true, barcode: 'ITPOS-S' } });
  const vM = await db.productVariant.create({ data: { tenantId: t.id, productId: gown.id, name: 'M', sku: 'IT-POS-GOWN-M', price: 1500000, stock: 1, isActive: true, barcode: 'ITPOS-M' } });
  const zero = await db.product.create({
    data: {
      tenantId: t.id, categoryId: c.id, name: 'IT Veil (no down payment)', slug: 'it-pos-veil', basePrice: 100000, isActive: true,
      availabilityMode: 'RENTAL_ONLY', rentalPricePerDay: 50000, rentalDepositAmount: 0, rentalDownPaymentPct: 0, bufferDaysOverride: 0,
    },
  });
  const vZ = await db.productVariant.create({ data: { tenantId: t.id, productId: zero.id, name: 'One size', sku: 'IT-POS-VEIL', price: 100000, stock: 1, isActive: true } });

  // R3 builds also seed the checklist permissions; older builds don't have them.
  const hasChecklist = !!(await db.permission.findFirst({ where: { code: 'rentals:checklist-verify' } }));
  const cashierRole = await role(t.id, 'IT Cashier', [
    'rentals:view', 'rentals:create', 'rentals:record-payment', 'rentals:release', 'rentals:update-status',
    'rentals:refund-request', 'payments:confirm-manual', ...(hasChecklist ? ['rentals:checklist-verify'] : []),
  ]);
  // R3: decides checklist exceptions / discrepancies; may also hand items over
  // (so the "decider can't hand over" rule is tested, not a missing permission).
  const checkerRole = hasChecklist
    ? await role(t.id, 'IT Checklist Reviewer', ['rentals:view', 'rentals:checklist-exception', 'rentals:checklist-templates', 'rentals:checklist-verify', 'rentals:release', 'rentals:update-status'])
    : null;
  // R3: a non-gown product (bouquet) whose checklist comes from its CATEGORY.
  const acc = await db.category.create({ data: { tenantId: t.id, name: 'Bridal accessories', slug: 'accessories-it-pos' } });
  const bouquet = await db.product.create({
    data: {
      tenantId: t.id, categoryId: acc.id, name: 'IT Bridal Bouquet', slug: 'it-pos-bouquet', basePrice: 300000, isActive: true,
      availabilityMode: 'RENTAL_ONLY', rentalPricePerDay: 100000, rentalDepositAmount: 50000, rentalDownPaymentPct: 25, bufferDaysOverride: 0,
    },
  });
  const vB = await db.productVariant.create({ data: { tenantId: t.id, productId: bouquet.id, name: 'Standard', sku: 'IT-POS-BOUQUET', price: 300000, stock: 3, isActive: true } });
  const reviewerRole = await role(t.id, 'IT ID Reviewer', ['rentals:view', 'id-verification:review']);
  // R2 builds also seed the gown-count reviewer permission; older builds don't have it.
  const hasTrackingReview = !!(await db.permission.findFirst({ where: { code: 'rentals:approve-unit-tracking' } }));
  const approverRole = await role(t.id, 'IT Refund Approver', ['rentals:view', 'refunds:approve', ...(hasTrackingReview ? ['rentals:approve-unit-tracking'] : [])]);
  const financeRole = await role(t.id, 'IT Finance', ['rentals:view', 'payments:manage', 'reports:view']);
  const staffRole = await db.role.findFirst({ where: { name: 'STAFF', isSystem: true, tenantId: null } });
  // Template-approval builds (round 25F D) seed rentals:checklist-approve: an independent
  // approver who never prepares templates (suites use it when IT_TEMPLATE_APPROVAL=1).
  const hasTemplateApproval = !!(await db.permission.findFirst({ where: { code: 'rentals:checklist-approve' } }));
  const tplApproverRole = hasTemplateApproval ? await role(t.id, 'IT Template Approver', ['rentals:view', 'rentals:checklist-approve']) : null;

  const ids = {
    tenantId: t.id,
    gown: { id: gown.id, S: vS.id, M: vM.id },
    zero: { id: zero.id, variantId: vZ.id },
    bouquet: { id: bouquet.id, variantId: vB.id, categoryId: acc.id },
    admins: {
      super: await admin(t.id, 'super', 'SUPER_ADMIN', superRole.id),
      cashier: await admin(t.id, 'cashier', 'STAFF', cashierRole.id),
      cashier2: await admin(t.id, 'cashier2', 'STAFF', cashierRole.id),
      reviewer: await admin(t.id, 'reviewer', 'STAFF', reviewerRole.id, true),
      reviewerNo2fa: await admin(t.id, 'reviewer-no2fa', 'STAFF', reviewerRole.id, false),
      approver: await admin(t.id, 'approver', 'STAFF', approverRole.id),
      finance: await admin(t.id, 'finance', 'STAFF', financeRole.id),
      staff: await admin(t.id, 'staff', 'STAFF', staffRole?.id),
      ...(checkerRole ? { checker: await admin(t.id, 'checker', 'STAFF', checkerRole.id) } : {}),
      ...(tplApproverRole ? { tplApprover: await admin(t.id, 'tpl-approver', 'STAFF', tplApproverRole.id) } : {}),
    },
  };
  // Open shifts for the cashiers and finance (cash in / cash out of the drawer).
  ids.sessions = {};
  for (const k of ['cashier', 'cashier2', 'finance']) {
    const s = await db.posSession.create({ data: { tenantId: t.id, adminUserId: ids.admins[k].id, openingCash: 100000, status: 'OPEN' } });
    ids.sessions[k] = s.id;
  }
  fs.writeFileSync(out, JSON.stringify(ids, null, 2));
  console.log(`seeded it_pos: 1 shop, 3 products, ${Object.keys(ids.admins).length} admins, 3 open shifts`);
  await db.$disconnect();
})().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
