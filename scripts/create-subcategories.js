// Creates missing subcategories for Naro Fashion catalog upload.
// Idempotent — safe to re-run. Usage: cd packages/database && node ../../scripts/create-subcategories.js
const path = require('path');
const { PrismaClient } = require(path.join(__dirname, '..', 'packages', 'database', 'node_modules', '@prisma', 'client'));
const prisma = new PrismaClient();

const TENANT_SLUG = 'naro-fashion';

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant ${TENANT_SLUG} not found`);

  const get = async (slug) =>
    prisma.category.findFirst({ where: { tenantId: tenant.id, slug, deletedAt: null } });

  const men = await get('men');
  const women = await get('women');
  const accessories = await get('accessories');
  if (!men || !women || !accessories) throw new Error('Required parent categories missing');

  const toCreate = [
    { name: 'Trousers', nameSwahili: 'Suruali', slug: 'trousers', parentId: men.id },
    { name: 'Jeans', nameSwahili: 'Jinzi', slug: 'jeans', parentId: men.id },
    { name: 'Underwear', nameSwahili: 'Chupi', slug: 'underwear', parentId: men.id },
    { name: 'Vests', nameSwahili: 'Fulana', slug: 'vests', parentId: men.id },
    { name: 'Sendoff Dresses', nameSwahili: 'Nguo za Kupeleka', slug: 'sendoff-dresses', parentId: women.id },
    { name: 'Flowers', nameSwahili: 'Maua', slug: 'flowers', parentId: accessories.id },
  ];

  for (const c of toCreate) {
    const existing = await prisma.category.findFirst({
      where: { tenantId: tenant.id, slug: c.slug, deletedAt: null },
    });
    if (existing) {
      console.log(`  exists   ${c.slug} (${existing.id})`);
      continue;
    }
    const created = await prisma.category.create({
      data: { ...c, tenantId: tenant.id, isActive: true },
    });
    console.log(`  created  ${c.slug} (${created.id})`);
  }

  // Print category map for script reference
  const cats = await prisma.category.findMany({
    where: { tenantId: tenant.id, deletedAt: null },
    select: { id: true, slug: true, name: true, parentId: true },
    orderBy: { name: 'asc' },
  });
  console.log('\n=== CATEGORY MAP ===');
  for (const c of cats) console.log(`${c.slug.padEnd(22)} ${c.id}  (parent ${c.parentId ?? '-'})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
