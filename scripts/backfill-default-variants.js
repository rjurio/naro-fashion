// One-off backfill: create a single default ProductVariant for every
// Product that has zero variants. Without a variant, the storefront's
// Add-to-Cart button stays disabled ("Select a variant") and the cart
// API (which requires variantId) can't accept the item — so bulk-imported
// bouquets/shirts/jeans were un-buyable.
//
// What this does:
//   1. Finds every Product with 0 active variants
//   2. Inserts one ProductVariant per product:
//        name     = 'Standard'
//        sku      = product.sku || `STD-${productId}`  (unique per tenant)
//        size/color = null
//        price    = product.basePrice
//        stock    = DEFAULT_STOCK (10)
//        tenantId = product.tenantId
//
// Idempotent: re-running skips products that already have variants.
// The storefront already auto-selects when a product has exactly one
// active variant, so after the backfill those products become clickable
// without any UI change.
//
// Usage (on VPS):
//   cd /var/www/naro-fashion && node scripts/backfill-default-variants.js

const path = require('path');
const fs = require('fs');

const { PrismaClient } = require(path.join(__dirname, '..', 'packages', 'database', 'node_modules', '@prisma', 'client'));

function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv(path.join(__dirname, '..', 'apps', 'api', '.env'));
loadEnv(path.join(__dirname, '..', '.env'));
loadEnv(path.join(__dirname, '..', 'packages', 'database', '.env'));

const DEFAULT_STOCK = 10;

async function main() {
  const prisma = new PrismaClient();

  const products = await prisma.product.findMany({
    where: { variants: { none: {} } },
    select: { id: true, name: true, sku: true, tenantId: true, basePrice: true },
  });

  console.log(`Found ${products.length} product(s) without variants.\n`);

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const p of products) {
    const baseSku = p.sku && p.sku.trim() ? p.sku.trim() : `STD-${p.id}`;
    const variantSku = p.sku && p.sku.trim() ? `${baseSku}-STD` : baseSku;

    try {
      await prisma.productVariant.create({
        data: {
          tenantId: p.tenantId,
          productId: p.id,
          name: 'Standard',
          sku: variantSku,
          price: p.basePrice,
          stock: DEFAULT_STOCK,
          isActive: true,
        },
      });
      created++;
      console.log(`  [create] ${p.name} -> ${variantSku} (stock ${DEFAULT_STOCK})`);
    } catch (err) {
      if (err.code === 'P2002') {
        skipped++;
        console.log(`  [skip]   ${p.name}: sku ${variantSku} already exists`);
      } else {
        failed++;
        console.error(`  [fail]   ${p.name}: ${err.message}`);
      }
    }
  }

  console.log(`\n=== DEFAULT-VARIANT BACKFILL SUMMARY ===`);
  console.log(`  created: ${created}`);
  console.log(`  skipped (SKU clash): ${skipped}`);
  console.log(`  failed: ${failed}`);
  console.log(`  scanned: ${products.length}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
