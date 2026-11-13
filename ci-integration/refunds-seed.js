// Seeds the ISOLATED schema it_ref (local dev Postgres) for the unified refund
// workflow test (R1b). Never production. Run AFTER the local API booted once
// on it_ref (permission catalogue + system roles).
//   DATABASE_URL=...?schema=it_ref node refunds-seed.js <worktree> <out.json>
const path = require('path');
const fs = require('fs');
const [, , wt, out] = process.argv;
if (!/schema=it_ref\b/.test(process.env.DATABASE_URL || '') || !/@localhost[:/]/.test(process.env.DATABASE_URL)) {
  throw new Error('refusing: DATABASE_URL must be the local it_ref schema');
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
async function admin(tenantId, tag, roleString, roleId) {
  const email = `it-ref-${tag}@example.test`;
  const a = await db.adminUser.create({ data: { tenantId, email, passwordHash: await bcrypt.hash(PW, 10), firstName: 'Ref', lastName: tag, role: roleString, isActive: true } });
  if (roleId) await db.adminUserRole.create({ data: { adminUserId: a.id, roleId } });
  return { id: a.id, email, password: PW };
}

(async () => {
  const superRole = await db.role.findFirst({ where: { name: 'SUPER_ADMIN', isSystem: true, tenantId: null } });
  const staffRole = await db.role.findFirst({ where: { name: 'STAFF', isSystem: true, tenantId: null } });
  if (!superRole) throw new Error('boot the API once first');
  const ids = { password: PW };
  for (const tag of ['a', 'b']) {
    const t = await db.tenant.create({ data: { name: `IT REF ${tag}`, slug: `it-ref-${tag}`, status: 'ACTIVE' } });
    for (const moduleCode of ['pos', 'rentals', 'reports']) await db.tenantModule.create({ data: { tenantId: t.id, moduleCode, isEnabled: true } });
    const c = await db.category.create({ data: { tenantId: t.id, name: 'Accessories', slug: `acc-${tag}` } });
    const scarf = await db.product.create({ data: { tenantId: t.id, categoryId: c.id, name: `IT Scarf ${tag}`, slug: `it-scarf-${tag}`, basePrice: 10000, isActive: true, availabilityMode: 'PURCHASE_ONLY' } });
    const v = await db.productVariant.create({ data: { tenantId: t.id, productId: scarf.id, name: 'One size', sku: `IT-SCARF-${tag}`, price: 10000, stock: 20, isActive: true } });
    const customer = await db.user.create({ data: { tenantId: t.id, email: `it-ref-${tag}-c@example.test`, phone: `+2557110000${tag === 'a' ? '1' : '2'}`, firstName: 'Cust', lastName: tag } });
    const x = { tenantId: t.id, product: scarf.id, variant: v.id, customer: customer.id };
    if (tag === 'a') {
      const cashierRole = await role(t.id, 'IT Cashier', ['pos:refund', 'pos:layaway-cancel']);
      const orderClerk = await role(t.id, 'IT Order clerk', ['orders:refund', 'orders:view']);
      const approverRole = await role(t.id, 'IT Approver', ['refunds:approve']);
      const financeRole = await role(t.id, 'IT Finance', ['payments:manage']);
      x.admins = {
        super: await admin(t.id, 'a-super', 'SUPER_ADMIN', superRole.id),
        cashier: await admin(t.id, 'a-cashier', 'STAFF', cashierRole.id),
        clerk: await admin(t.id, 'a-clerk', 'STAFF', orderClerk.id),
        approver: await admin(t.id, 'a-approver', 'STAFF', approverRole.id),
        finance: await admin(t.id, 'a-finance', 'STAFF', financeRole.id),
        staff: await admin(t.id, 'a-staff', 'STAFF', staffRole?.id),
      };
      x.sessions = {};
      for (const k of ['cashier', 'finance', 'super']) {
        x.sessions[k] = (await db.posSession.create({ data: { tenantId: t.id, adminUserId: x.admins[k].id, openingCash: 100000, status: 'OPEN' } })).id;
      }
      // Online order paid 50,000 by mobile money.
      const o = await db.order.create({
        data: { tenantId: t.id, orderNumber: 'IT-ONL-1', userId: customer.id, subtotal: 50000, total: 50000, paymentMethod: 'MPESA', status: 'DELIVERED', paymentStatus: 'PAID', channel: 'ONLINE' },
      });
      await db.payment.create({ data: { tenantId: t.id, orderId: o.id, amount: 50000, method: 'MPESA', status: 'COMPLETED', transactionRef: 'IT-MP-ONL-1', providerCode: 'clickpesa' } });
      x.onlineOrder = o.id;
      // Layaway with two instalments (30,000 + 20,000) still active.
      const lay = await db.layaway.create({
        data: {
          tenantId: t.id, layawayNumber: 'IT-LAY-1', customerId: customer.id, cashierId: x.admins.cashier.id, items: [{ productId: scarf.id, variantId: v.id, quantity: 8, unitPrice: 10000 }],
          subtotal: 80000, total: 80000, depositAmount: 30000, depositPaid: 50000, balanceDue: 30000, dueDate: new Date(Date.now() + 30 * 86400e3), status: 'ACTIVE',
        },
      });
      for (const [amount, ref] of [[30000, 'IT-LAY-P1'], [20000, 'IT-LAY-P2']]) {
        await db.payment.create({ data: { tenantId: t.id, layawayId: lay.id, amount, method: 'CASH', status: 'COMPLETED', transactionRef: ref, gatewayResponse: { posSessionId: x.sessions.cashier } } });
      }
      x.layaway = lay.id;
    } else {
      x.admins = { super: await admin(t.id, 'b-super', 'SUPER_ADMIN', superRole.id) };
    }
    ids[tag] = x;
  }
  fs.writeFileSync(out, JSON.stringify(ids, null, 2));
  console.log('seeded it_ref: 2 shops; shop a: 6 admins, 3 open shifts, 1 paid online order, 1 layaway with 2 instalments');
  await db.$disconnect();
})().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
