// Backfills ProductImage rows for Naro Fashion products by scanning
// apps/api/uploads/products/ for files matching {slug}-NN.{ext}.
//
// Use case: bulk-import-products.js copies photos from docs/photo-staging/
// during the original import, but when running on the VPS (where the source
// staging folder isn't committed), it creates the Product row and then
// errors on file copy, leaving the product image-less. This script fills
// that gap without re-importing the products.
//
// Safe to run multiple times: if a ProductImage already exists with a given
// url, it is skipped.
//
// Usage: cd /var/www/naro-fashion && node scripts/backfill-product-images.js

const path = require('path');
const fs = require('fs');
const { PrismaClient } = require(path.join(__dirname, '..', 'packages', 'database', 'node_modules', '@prisma', 'client'));

const prisma = new PrismaClient();
const ROOT = path.join(__dirname, '..');
const UPLOADS = path.join(ROOT, 'apps', 'api', 'uploads', 'products');
const TENANT_SLUG = 'naro-fashion';

async function main() {
  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant ${TENANT_SLUG} not found`);

  if (!fs.existsSync(UPLOADS)) throw new Error(`Uploads dir missing: ${UPLOADS}`);
  const allFiles = fs.readdirSync(UPLOADS);

  const products = await prisma.product.findMany({
    where: { tenantId: tenant.id, deletedAt: null },
    include: { images: true },
    orderBy: { createdAt: 'asc' },
  });

  let productsScanned = 0;
  let imagesCreated = 0;
  let productsWithoutFiles = [];

  for (const product of products) {
    productsScanned++;
    const slug = product.slug;

    // Match {slug}-NN.{jpg|png|jpeg}
    const re = new RegExp(`^${slug.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}-(\\d{2})\\.(jpg|jpeg|png)$`, 'i');
    const matches = allFiles
      .map((f) => ({ file: f, m: f.match(re) }))
      .filter((x) => x.m)
      .map((x) => ({ file: x.file, idx: parseInt(x.m[1], 10) }))
      .sort((a, b) => a.idx - b.idx);

    if (matches.length === 0) {
      productsWithoutFiles.push(product.name);
      continue;
    }

    const existingUrls = new Set(product.images.map((i) => i.url));

    for (const { file, idx } of matches) {
      const url = `/uploads/products/${file}`;
      if (existingUrls.has(url)) continue;

      await prisma.productImage.create({
        data: {
          productId: product.id,
          url,
          altText: `${product.name} — view ${idx}`,
          sortOrder: idx - 1,
          isPrimary: idx === 1 && product.images.length === 0,
        },
      });
      imagesCreated++;
    }
  }

  console.log(`\n=== BACKFILL SUMMARY ===`);
  console.log(`  products scanned:       ${productsScanned}`);
  console.log(`  images created:         ${imagesCreated}`);
  console.log(`  products without files: ${productsWithoutFiles.length}`);
  if (productsWithoutFiles.length) {
    for (const name of productsWithoutFiles) console.log(`    - ${name}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
