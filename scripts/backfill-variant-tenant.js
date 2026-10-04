// One-off backfill: set ProductVariant.tenantId = parent Product.tenantId
// wherever the variant's tenantId is NULL.
//
// Why: ProductsService.create (admin form, CSV bulk import, AI
// create_product_draft) used a nested `variants.create` and product update
// used `createMany` — neither set tenantId, so those variants were invisible
// to every tenant-scoped variant lookup (POS barcode scan, online-order stock
// reservation, inventory adjust, cart add). Code fixed in the same change;
// this repairs existing rows.
//
// Unique constraints: ProductVariant has @@unique([tenantId, sku]) and
// @@unique([tenantId, barcode]). While tenantId was NULL those never
// collided (Postgres treats NULLs as distinct), so assigning the tenant can
// surface duplicates. Per row:
//   - sku collision     → sku gets a `-<last 6 of id>` suffix (printed)
//   - barcode collision → barcode set to NULL (old value printed so it can
//                         be re-assigned by hand)
//
// Idempotent: only touches rows with tenantId NULL whose product HAS a
// tenantId; re-running after success updates 0 rows.
//
// Usage (on VPS):
//   cd /var/www/naro-fashion && node scripts/backfill-variant-tenant.js --dry-run
//   cd /var/www/naro-fashion && node scripts/backfill-variant-tenant.js

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

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const prisma = new PrismaClient();
  try {
    const totalNull = await prisma.productVariant.count({ where: { tenantId: null } });
    const orphans = await prisma.productVariant.count({
      where: { tenantId: null, product: { tenantId: null } },
    });

    const rows = await prisma.productVariant.findMany({
      where: { tenantId: null, product: { tenantId: { not: null } } },
      select: { id: true, sku: true, barcode: true, product: { select: { tenantId: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    console.log(`[backfill-variant-tenant] ${DRY_RUN ? 'DRY RUN — ' : ''}variants with NULL tenantId: ${totalNull}`);
    console.log(`  fixable (product has tenantId): ${rows.length}`);
    console.log(`  skipped (product tenantId also NULL): ${orphans}`);

    // Seed the per-tenant taken-sets with already-tenanted variants.
    const tenantIds = Array.from(new Set(rows.map((r) => r.product.tenantId)));
    const taken = new Map(); // tenantId -> { skus:Set, barcodes:Set }
    for (const t of tenantIds) {
      const existing = await prisma.productVariant.findMany({
        where: { tenantId: t },
        select: { sku: true, barcode: true },
      });
      taken.set(t, {
        skus: new Set(existing.map((e) => e.sku)),
        barcodes: new Set(existing.filter((e) => e.barcode).map((e) => e.barcode)),
      });
    }

    let updated = 0;
    let skuRenamed = 0;
    let barcodeCleared = 0;
    let failed = 0;

    for (const v of rows) {
      const tenantId = v.product.tenantId;
      const sets = taken.get(tenantId);
      const data = { tenantId };

      let sku = v.sku;
      if (sets.skus.has(sku)) {
        sku = `${v.sku}-${v.id.slice(-6)}`;
        let n = 1;
        while (sets.skus.has(sku)) sku = `${v.sku}-${v.id.slice(-6)}-${n++}`;
        data.sku = sku;
        skuRenamed++;
        console.log(`  sku collision: variant ${v.id} (${v.product.name}) "${v.sku}" -> "${sku}"`);
      }

      if (v.barcode && sets.barcodes.has(v.barcode)) {
        data.barcode = null;
        barcodeCleared++;
        console.log(`  barcode collision: variant ${v.id} (${v.product.name}) barcode "${v.barcode}" cleared — reassign manually`);
      }

      if (!DRY_RUN) {
        try {
          const res = await prisma.productVariant.updateMany({
            where: { id: v.id, tenantId: null },
            data,
          });
          updated += res.count;
        } catch (err) {
          failed++;
          console.error(`  FAILED variant ${v.id}: ${err.message}`);
          continue;
        }
      } else {
        updated++;
      }

      sets.skus.add(sku);
      if (v.barcode && data.barcode !== null) sets.barcodes.add(v.barcode);
    }

    const remaining = DRY_RUN ? totalNull : await prisma.productVariant.count({ where: { tenantId: null } });
    console.log(`[backfill-variant-tenant] ${DRY_RUN ? 'would update' : 'updated'}: ${updated}`);
    console.log(`  sku renamed: ${skuRenamed}, barcode cleared: ${barcodeCleared}, failed: ${failed}`);
    console.log(`  variants still NULL tenantId: ${remaining}`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
