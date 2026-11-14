// Seeds the ISOLATED schema it_sec (local dev Postgres) for the CMS-draft and
// payment-tenant security tests. Never production. Run AFTER the local API
// booted once on it_sec (permission catalogue + system roles).
//   DATABASE_URL=...?schema=it_sec node sec-seed.js <worktree> <out.json>
const path = require('path');
const fs = require('fs');
const [, , wt, out] = process.argv;
if (!/schema=it_sec\b/.test(process.env.DATABASE_URL || '') || !/@localhost[:/]/.test(process.env.DATABASE_URL)) {
  throw new Error('refusing: DATABASE_URL must be the local it_sec schema');
}
const { PrismaClient } = require(path.join(wt, 'packages', 'database', 'node_modules', '@prisma', 'client'));
const bcrypt = require(path.join(wt, 'apps', 'api', 'node_modules', 'bcryptjs'));
const db = new PrismaClient();
const PW = 'ItTest12345';

(async () => {
  const superRole = await db.role.findFirst({ where: { name: 'SUPER_ADMIN', isSystem: true, tenantId: null } });
  const staffRole = await db.role.findFirst({ where: { name: 'STAFF', isSystem: true, tenantId: null } });
  if (!superRole || !staffRole) throw new Error('boot the API once first');
  const ids = { password: PW };
  for (const tag of ['a', 'b']) {
    const t = await db.tenant.create({ data: { name: `IT SEC ${tag}`, slug: `it-sec-${tag}`, status: 'ACTIVE' } });
    const mk = async (who, role, roleId) => {
      const a = await db.adminUser.create({
        data: { tenantId: t.id, email: `it-sec-${tag}-${who}@example.test`, passwordHash: await bcrypt.hash(PW, 10), firstName: 'Sec', lastName: who, role, isActive: true },
      });
      await db.adminUserRole.create({ data: { adminUserId: a.id, roleId } });
      return a.email;
    };
    const customer = await db.user.create({
      data: { tenantId: t.id, email: `it-sec-${tag}-customer@example.test`, passwordHash: await bcrypt.hash(PW, 10), firstName: 'Cust', lastName: tag, isActive: true },
    });
    const published = await db.page.create({ data: { tenantId: t.id, title: `Published ${tag}`, slug: 'faq', content: `<p>public ${tag}</p>`, isPublished: true } });
    const draft = await db.page.create({ data: { tenantId: t.id, title: `SECRET DRAFT ${tag}`, slug: 'upcoming-sale', content: `<p>draft-only text ${tag}</p>`, isPublished: false } });
    const deleted = await db.page.create({ data: { tenantId: t.id, title: `Deleted ${tag}`, slug: 'old', content: '<p>gone</p>', isPublished: true, deletedAt: new Date() } });
    const payment = await db.payment.create({ data: { tenantId: t.id, amount: 50000, method: 'MPESA', status: 'PENDING', transactionRef: `IT-SEC-${tag}-1` } });
    ids[tag] = {
      tenantId: t.id,
      superEmail: await mk('super', 'SUPER_ADMIN', superRole.id),
      staffEmail: await mk('staff', 'STAFF', staffRole.id),
      customerEmail: customer.email,
      pages: { published: published.id, draft: draft.id, deleted: deleted.id },
      paymentId: payment.id,
    };
  }
  fs.writeFileSync(out, JSON.stringify(ids, null, 2));
  console.log('seeded it_sec: 2 shops, 3 pages + 1 payment each, 2 admins + 1 customer each');
  await db.$disconnect();
})().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
