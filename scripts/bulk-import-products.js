// Bulk product importer for Naro Fashion.
// Reads a JSON manifest, copies photos to apps/api/uploads/products/,
// creates Product + ProductImage rows under the naro-fashion tenant.
//
// Usage: node scripts/bulk-import-products.js scripts/manifests/<file>.json
//
// Manifest shape (per product):
//   {
//     "name":         "Balotti White Dress Shirt",
//     "description":  "...",
//     "categorySlug": "shirts",                 // existing category
//     "basePrice":    45000,                    // TZS (Decimal)
//     "compareAtPrice": 60000,                  // optional
//     "sku":          "NF-SHIRT-BALOTTI-WHITE", // optional; we auto-generate if missing
//     "isFeatured":   true,                     // optional
//     "availabilityMode": "PURCHASE_ONLY",      // optional; default PURCHASE_ONLY
//     "photos":       ["n027.jpg", "n028.jpg"]  // paths relative to docs/photo-staging/ OR absolute
//     "heroPhoto":    "ai photos/Gemini_xxx.png" // optional primary image (relative to docs/instagram/)
//   }

const path = require('path');
const fs = require('fs');
const { PrismaClient } = require(path.join(__dirname, '..', 'packages', 'database', 'node_modules', '@prisma', 'client'));

const prisma = new PrismaClient();
const ROOT = path.join(__dirname, '..');
const STAGING = path.join(ROOT, 'docs', 'photo-staging');
const INSTAGRAM = path.join(ROOT, 'docs', 'instagram');
const UPLOADS = path.join(ROOT, 'apps', 'api', 'uploads', 'products');
const TENANT_SLUG = 'naro-fashion';

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function resolveSource(photo) {
  if (path.isAbsolute(photo) && fs.existsSync(photo)) return photo;
  const staged = path.join(STAGING, photo);
  if (fs.existsSync(staged)) return staged;
  const ig = path.join(INSTAGRAM, photo);
  if (fs.existsSync(ig)) return ig;
  throw new Error(`Photo not found: ${photo} (looked in ${STAGING} and ${INSTAGRAM})`);
}

function copyPhoto(src, targetBasename) {
  if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });
  const ext = path.extname(src).toLowerCase();
  const dest = path.join(UPLOADS, `${targetBasename}${ext}`);
  fs.copyFileSync(src, dest);
  return `/uploads/products/${targetBasename}${ext}`;
}

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    console.error('Usage: node scripts/bulk-import-products.js <manifest.json>');
    process.exit(1);
  }
  const manifestAbs = path.isAbsolute(manifestPath) ? manifestPath : path.join(ROOT, manifestPath);
  const products = JSON.parse(fs.readFileSync(manifestAbs, 'utf8'));
  console.log(`Loaded ${products.length} product(s) from ${path.basename(manifestAbs)}`);

  const tenant = await prisma.tenant.findFirst({ where: { slug: TENANT_SLUG } });
  if (!tenant) throw new Error(`Tenant ${TENANT_SLUG} not found`);

  // Cache categories
  const cats = await prisma.category.findMany({
    where: { tenantId: tenant.id, deletedAt: null },
    select: { id: true, slug: true },
  });
  const catBySlug = new Map(cats.map((c) => [c.slug, c.id]));

  let created = 0;
  let skipped = 0;
  const errors = [];

  for (const p of products) {
    try {
      const baseSlug = slugify(p.name);
      const existing = await prisma.product.findFirst({
        where: { tenantId: tenant.id, slug: baseSlug, deletedAt: null },
      });
      if (existing) {
        console.log(`  skip     "${p.name}" (slug "${baseSlug}" already exists)`);
        skipped++;
        continue;
      }
      const categoryId = catBySlug.get(p.categorySlug);
      if (!categoryId) throw new Error(`Unknown categorySlug: ${p.categorySlug}`);

      // Build image list: hero first (if provided), then product photos
      const imagePhotos = [];
      if (p.heroPhoto) imagePhotos.push({ src: p.heroPhoto, isHero: true });
      for (const ph of p.photos || []) imagePhotos.push({ src: ph, isHero: false });
      if (imagePhotos.length === 0) throw new Error('At least one photo required');

      const sku = p.sku || `NF-${baseSlug.toUpperCase().replace(/-/g, '-').slice(0, 40)}`;

      const product = await prisma.product.create({
        data: {
          tenantId: tenant.id,
          name: p.name,
          nameSwahili: p.nameSwahili ?? null,
          slug: baseSlug,
          description: p.description ?? null,
          descriptionSwahili: p.descriptionSwahili ?? null,
          categoryId,
          availabilityMode: p.availabilityMode ?? 'PURCHASE_ONLY',
          basePrice: p.basePrice,
          compareAtPrice: p.compareAtPrice ?? null,
          rentalPricePerDay: p.rentalPricePerDay ?? null,
          rentalDepositAmount: p.rentalDepositAmount ?? null,
          rentalDownPaymentPct: p.rentalDownPaymentPct ?? undefined,
          minRentalDays: p.minRentalDays ?? null,
          maxRentalDays: p.maxRentalDays ?? null,
          sku,
          isActive: p.isActive !== false,
          isFeatured: !!p.isFeatured,
        },
      });

      // Copy files + create ProductImage rows
      for (let i = 0; i < imagePhotos.length; i++) {
        const { src, isHero } = imagePhotos[i];
        const resolved = resolveSource(src);
        const targetName = `${baseSlug}-${String(i + 1).padStart(2, '0')}`;
        const url = copyPhoto(resolved, targetName);
        await prisma.productImage.create({
          data: {
            productId: product.id,
            url,
            altText: `${p.name} — ${isHero ? 'model hero' : `view ${i + 1}`}`,
            sortOrder: i,
            isPrimary: i === 0,
          },
        });
      }

      created++;
      console.log(
        `  created  "${p.name}" (${p.photos?.length ?? 0} photos${p.heroPhoto ? ' + hero' : ''})`,
      );
    } catch (err) {
      errors.push({ name: p.name, error: err.message });
      console.error(`  FAILED   "${p.name}": ${err.message}`);
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`  created: ${created}`);
  console.log(`  skipped: ${skipped}`);
  console.log(`  failed:  ${errors.length}`);
  if (errors.length) console.log(errors);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
