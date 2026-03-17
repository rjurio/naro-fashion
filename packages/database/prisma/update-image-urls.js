// Script to update existing database image URLs from /images/ to /uploads/
// Also adds category images and event cover images + gallery media
// Run: node packages/database/prisma/update-image-urls.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Updating image URLs in database...\n');

  // --- 1. Update ProductImage URLs ---
  const productImages = await prisma.productImage.findMany();
  let updatedCount = 0;
  for (const img of productImages) {
    if (img.url.startsWith('/images/')) {
      const newUrl = img.url.replace('/images/', '/uploads/');
      await prisma.productImage.update({
        where: { id: img.id },
        data: { url: newUrl },
      });
      console.log(`  ProductImage: ${img.url} -> ${newUrl}`);
      updatedCount++;
    }
  }
  console.log(`Updated ${updatedCount} product image URLs\n`);

  // --- 2. Update Banner URLs ---
  const banners = await prisma.banner.findMany();
  let bannerCount = 0;
  for (const banner of banners) {
    if (banner.imageUrl && banner.imageUrl.startsWith('/images/')) {
      const newUrl = banner.imageUrl.replace('/images/', '/uploads/');
      await prisma.banner.update({
        where: { id: banner.id },
        data: { imageUrl: newUrl },
      });
      console.log(`  Banner: ${banner.imageUrl} -> ${newUrl}`);
      bannerCount++;
    }
  }
  console.log(`Updated ${bannerCount} banner image URLs\n`);

  // --- 3. Add Category Images ---
  const categoryImages = {
    'women': '/uploads/categories/women.jpg',
    'men': '/uploads/categories/men.jpg',
    'dresses': '/uploads/categories/dresses.jpg',
    'gowns': '/uploads/categories/gowns.jpg',
    'shirts': '/uploads/categories/shirts.jpg',
    'accessories': '/uploads/categories/accessories.jpg',
  };

  let catCount = 0;
  for (const [slug, imageUrl] of Object.entries(categoryImages)) {
    try {
      const result = await prisma.category.updateMany({
        where: { slug, imageUrl: null },
        data: { imageUrl },
      });
      if (result.count > 0) {
        console.log(`  Category "${slug}": set imageUrl to ${imageUrl}`);
        catCount++;
      }
    } catch (e) {
      console.log(`  Category "${slug}" skipped:`, e.message?.slice(0, 60));
    }
  }
  console.log(`Updated ${catCount} category images\n`);

  // --- 4. Add Event Cover Images ---
  const events = await prisma.customerEvent.findMany({
    where: { coverImageUrl: null },
    select: { id: true, title: true },
  });

  const eventCovers = [
    '/uploads/events/wedding-1.jpg',
    '/uploads/events/graduation-1.jpg',
    '/uploads/events/nikah-1.jpg',
    '/uploads/events/birthday-1.jpg',
  ];

  let eventCoverCount = 0;
  for (let i = 0; i < events.length; i++) {
    const coverUrl = eventCovers[i % eventCovers.length];
    await prisma.customerEvent.update({
      where: { id: events[i].id },
      data: { coverImageUrl: coverUrl },
    });
    console.log(`  Event "${events[i].title}": set cover to ${coverUrl}`);
    eventCoverCount++;
  }
  console.log(`Updated ${eventCoverCount} event cover images\n`);

  // --- 5. Add Event Gallery Media ---
  const allEvents = await prisma.customerEvent.findMany({
    include: { media: true },
  });

  const galleryImages = [
    '/uploads/events/gallery-1.jpg',
    '/uploads/events/gallery-2.jpg',
    '/uploads/events/gallery-3.jpg',
    '/uploads/events/gallery-4.jpg',
  ];

  let mediaCount = 0;
  for (const event of allEvents) {
    if (event.media.length === 0) {
      const numMedia = Math.min(2 + allEvents.indexOf(event), galleryImages.length);
      for (let m = 0; m < numMedia; m++) {
        await prisma.eventMedia.create({
          data: {
            eventId: event.id,
            url: galleryImages[m],
            mediaType: 'IMAGE',
            altText: `${event.title} - Photo ${m + 1}`,
            sortOrder: m,
          },
        });
        mediaCount++;
      }
      console.log(`  Event "${event.title}": added ${numMedia} gallery photos`);
    }
  }
  console.log(`Added ${mediaCount} event gallery media items\n`);

  // --- Summary ---
  console.log('=== Update Summary ===');
  console.log(`  Product images updated: ${updatedCount}`);
  console.log(`  Banners updated: ${bannerCount}`);
  console.log(`  Categories with images: ${catCount}`);
  console.log(`  Event covers added: ${eventCoverCount}`);
  console.log(`  Event gallery media added: ${mediaCount}`);
  console.log('\nDone!');
}

main()
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
