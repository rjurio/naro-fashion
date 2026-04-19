const path = require('path');
const { PrismaClient } = require(path.join(__dirname, '..', 'packages', 'database', 'node_modules', '@prisma', 'client'));
const p = new PrismaClient();
(async () => {
  const t = await p.tenant.findFirst({ where: { slug: 'naro-fashion' } });
  console.log('tenant:', t.id, t.slug, 'isActive:', t.isActive);

  const sample = await p.product.findFirst({
    where: { tenantId: t.id, deletedAt: null, slug: 'red-sequin-off-shoulder-sendoff-gown' },
    include: { images: true, category: true },
  });
  console.log('\nsendoff product:');
  console.log('  id:', sample?.id);
  console.log('  name:', sample?.name);
  console.log('  isActive:', sample?.isActive);
  console.log('  images:', sample?.images.length);
  console.log('  first image url:', sample?.images[0]?.url);
  console.log('  category:', sample?.category?.slug);

  const activeCount = await p.product.count({ where: { tenantId: t.id, deletedAt: null, isActive: true } });
  console.log('\nactive products total:', activeCount);
  await p.$disconnect();
})();
