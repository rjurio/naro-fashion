const path = require('path');
const { PrismaClient } = require(path.join(__dirname, '..', 'packages', 'database', 'node_modules', '@prisma', 'client'));
const p = new PrismaClient();
(async () => {
  const t = await p.tenant.findFirst({ where: { slug: 'naro-fashion' } });
  const cats = await p.category.findMany({ where: { tenantId: t.id, deletedAt: null }, select: { slug: true, id: true } });
  for (const c of cats) {
    const n = await p.product.count({ where: { tenantId: t.id, categoryId: c.id, deletedAt: null } });
    if (n > 0) console.log(c.slug.padEnd(22), n);
  }
  const total = await p.product.count({ where: { tenantId: t.id, deletedAt: null } });
  console.log('---TOTAL', total);
  await p.$disconnect();
})();
