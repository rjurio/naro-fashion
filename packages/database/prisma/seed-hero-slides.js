const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding hero slides...');

  // Check if hero slides already exist
  const count = await prisma.heroSlide.count();
  if (count > 0) {
    console.log(`Hero slides already exist (${count} found). Skipping.`);
    return;
  }

  await prisma.heroSlide.createMany({
    data: [
      {
        title: 'Elegant Fashion Collection',
        imageUrl: '/uploads/hero-slides/hero-fashion-1.jpg',
        sortOrder: 0,
        isActive: true,
      },
      {
        title: 'Designer Dresses',
        imageUrl: '/uploads/hero-slides/hero-fashion-2.jpg',
        sortOrder: 1,
        isActive: true,
      },
      {
        title: 'Premium Gowns & Accessories',
        imageUrl: '/uploads/hero-slides/hero-fashion-3.jpg',
        sortOrder: 2,
        isActive: true,
      },
    ],
  });

  console.log('Created 3 hero slides');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
