/**
 * Multi-Tenant Migration Script
 *
 * This script:
 * 1. Creates the first Tenant ("Naro Fashion")
 * 2. Creates TenantBranding with current defaults
 * 3. Creates a SubscriptionPlan (Enterprise) and TenantSubscription
 * 4. Creates TenantModule entries (all modules enabled)
 * 5. Backfills tenantId on ALL existing records
 * 6. Creates a PlatformAdmin from the first SUPER_ADMIN
 *
 * Run: node prisma/migrate-to-multi-tenant.js
 */

const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

// Simple bcrypt-compatible hash using Node's built-in crypto (pbkdf2)
// For the migration script only — the API uses bcryptjs at runtime
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `$pbkdf2$${salt}$${hash}`;
}

// Actually, let's use bcryptjs from the API's node_modules
let bcrypt;
try {
  bcrypt = require('bcryptjs');
} catch {
  // Fallback: try loading from api's dependencies
  try {
    bcrypt = require('../../apps/api/node_modules/bcryptjs');
  } catch {
    // Last resort: try the hoisted pnpm location
    try {
      const path = require('path');
      const root = path.resolve(__dirname, '../../..');
      const glob = require('fs').readdirSync(path.join(root, 'node_modules/.pnpm'))
        .find(d => d.startsWith('bcryptjs@'));
      if (glob) {
        bcrypt = require(path.join(root, 'node_modules/.pnpm', glob, 'node_modules/bcryptjs'));
      }
    } catch {
      // Use crypto fallback
      bcrypt = {
        hash: async (password, rounds) => {
          const salt = crypto.randomBytes(16).toString('hex');
          return crypto.pbkdf2Sync(password, salt, rounds * 10000, 64, 'sha512').toString('hex');
        },
      };
      console.log('⚠ bcryptjs not found, using crypto fallback. Change the platform admin password after first login.');
    }
  }
}

const prisma = new PrismaClient();

// All available module codes
const ALL_MODULES = [
  'products', 'categories', 'orders', 'cart', 'wishlist', 'cms',
  'auth', 'users', 'shipping', 'reviews', 'rentals', 'rental-checklists',
  'rental-policies', 'pos', 'analytics', 'inventory', 'expenses',
  'reports', 'flash-sales', 'referrals', 'events', 'promo-codes',
  'id-verification', 'notifications',
];

async function main() {
  console.log('🚀 Starting multi-tenant migration...\n');

  // Step 1: Create the first Tenant
  console.log('1. Creating first tenant: Naro Fashion...');
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'naro-fashion' },
    update: {},
    create: {
      name: 'Naro Fashion',
      slug: 'naro-fashion',
      domain: null, // Will be set when deploying with custom domain
      status: 'ACTIVE',
    },
  });
  console.log(`   ✓ Tenant created: ${tenant.id}`);

  // Step 2: Create TenantBranding
  console.log('2. Creating tenant branding...');
  await prisma.tenantBranding.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: {
      tenantId: tenant.id,
      companyName: 'Naro Fashion',
      tagline: 'Premium Fashion & Clothing in Tanzania',
      colorPrimary: '#D4AF37',
      colorSecondary: '#1A1A1A',
      colorAccent: '#D4AF37',
      fontHeading: 'Playfair Display',
      fontBody: 'Inter',
      metaTitle: 'Naro Fashion | Premium Fashion & Clothing in Tanzania',
      metaDescription: 'Shop the latest fashion trends, rent gowns for weddings, and more at Naro Fashion.',
    },
  });
  console.log('   ✓ Branding created');

  // Step 3: Create Enterprise SubscriptionPlan
  console.log('3. Creating subscription plans...');
  const plans = [
    {
      name: 'Starter',
      description: 'Basic e-commerce features for small businesses',
      priceMonthly: 50000,
      priceYearly: 500000,
      maxProducts: 100,
      maxAdminUsers: 2,
      maxStorageGB: 5,
      enabledModules: ['products', 'categories', 'orders', 'cart', 'wishlist', 'cms', 'auth', 'users', 'shipping', 'reviews'],
      sortOrder: 1,
    },
    {
      name: 'Business',
      description: 'Full e-commerce with rentals, inventory, and analytics',
      priceMonthly: 150000,
      priceYearly: 1500000,
      maxProducts: null,
      maxAdminUsers: 5,
      maxStorageGB: 20,
      enabledModules: [
        'products', 'categories', 'orders', 'cart', 'wishlist', 'cms', 'auth', 'users', 'shipping', 'reviews',
        'rentals', 'rental-checklists', 'rental-policies', 'inventory', 'analytics', 'flash-sales', 'promo-codes',
        'id-verification', 'notifications',
      ],
      sortOrder: 2,
    },
    {
      name: 'Enterprise',
      description: 'All features including POS, reports, expenses, referrals, and events',
      priceMonthly: 350000,
      priceYearly: 3500000,
      maxProducts: null,
      maxAdminUsers: null,
      maxStorageGB: 100,
      enabledModules: ALL_MODULES,
      sortOrder: 3,
    },
  ];

  let enterprisePlan;
  for (const plan of plans) {
    const created = await prisma.subscriptionPlan.upsert({
      where: { name: plan.name },
      update: {},
      create: plan,
    });
    if (plan.name === 'Enterprise') enterprisePlan = created;
    console.log(`   ✓ Plan "${plan.name}" created`);
  }

  // Step 4: Create TenantSubscription (Enterprise for existing tenant)
  console.log('4. Creating tenant subscription...');
  const existingSub = await prisma.tenantSubscription.findFirst({
    where: { tenantId: tenant.id },
  });
  if (!existingSub) {
    const endDate = new Date();
    endDate.setFullYear(endDate.getFullYear() + 10); // 10-year subscription for founding tenant
    await prisma.tenantSubscription.create({
      data: {
        tenantId: tenant.id,
        planId: enterprisePlan.id,
        status: 'ACTIVE',
        billingCycle: 'YEARLY',
        startDate: new Date(),
        endDate,
        autoRenew: false,
      },
    });
    console.log('   ✓ Enterprise subscription created (10-year)');
  } else {
    console.log('   ⏭ Subscription already exists, skipping');
  }

  // Step 5: Create TenantModule entries (all enabled)
  console.log('5. Creating tenant module entries...');
  for (const moduleCode of ALL_MODULES) {
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleCode: { tenantId: tenant.id, moduleCode } },
      update: {},
      create: {
        tenantId: tenant.id,
        moduleCode,
        isEnabled: true,
      },
    });
  }
  console.log(`   ✓ ${ALL_MODULES.length} modules enabled`);

  // Step 6: Backfill tenantId on all existing records
  console.log('6. Backfilling tenantId on existing records...');

  const tables = [
    'User', 'AdminUser', 'AdminActivityLog', 'LoginAttempt', 'CustomerIDDocument',
    'Category', 'Product', 'ProductVariant',
    'Order', 'Payment', 'Shipment', 'Invoice', 'ShippingZone',
    'Review', 'RentalOrder', 'RentalChecklistTemplate', 'RentalPolicy',
    'FlashSale', 'ReferralCode',
    'Banner', 'HeroSlide', 'Page', 'SizeGuide', 'SiteSetting', 'InstagramPost',
    'NewsletterSubscriber', 'Newsletter', 'PickupPoint',
    'InventoryTransaction', 'ExpenseCategory', 'BusinessExpense', 'FinancialPeriod',
    'Role', 'PosSession', 'HeldSale', 'Layaway', 'PosExchange',
    'PromoCode', 'CustomerEvent', 'AbandonedCartReminder', 'PaymentMethod', 'ContactSubmission',
  ];

  for (const table of tables) {
    try {
      const result = await prisma.$executeRawUnsafe(
        `UPDATE "${table}" SET "tenantId" = $1 WHERE "tenantId" IS NULL`,
        tenant.id
      );
      console.log(`   ✓ ${table}: ${result} rows updated`);
    } catch (err) {
      // Table might not exist or be empty
      console.log(`   ⚠ ${table}: ${err.message?.substring(0, 80)}`);
    }
  }

  // Step 7: Create PlatformAdmin from existing SUPER_ADMIN
  console.log('7. Creating PlatformAdmin...');
  const existingSuperAdmin = await prisma.adminUser.findFirst({
    where: { role: 'SUPER_ADMIN' },
  });

  if (existingSuperAdmin) {
    const existing = await prisma.platformAdmin.findUnique({
      where: { email: `platform-${existingSuperAdmin.email}` },
    });
    if (!existing) {
      const hashedPassword = await bcrypt.hash('Admin123', 12);
      await prisma.platformAdmin.create({
        data: {
          email: 'platform@naro.co.tz',
          passwordHash: hashedPassword,
          firstName: 'Platform',
          lastName: 'Admin',
          role: 'PLATFORM_ADMIN',
        },
      });
      console.log('   ✓ PlatformAdmin created: platform@naro.co.tz / Admin123');
    } else {
      console.log('   ⏭ PlatformAdmin already exists');
    }
  } else {
    // Create a fresh platform admin
    const hashedPassword = await bcrypt.hash('Admin123', 12);
    await prisma.platformAdmin.upsert({
      where: { email: 'platform@naro.co.tz' },
      update: {},
      create: {
        email: 'platform@naro.co.tz',
        passwordHash: hashedPassword,
        firstName: 'Platform',
        lastName: 'Admin',
        role: 'PLATFORM_ADMIN',
      },
    });
    console.log('   ✓ PlatformAdmin created: platform@naro.co.tz / Admin123');
  }

  console.log('\n✅ Multi-tenant migration complete!');
  console.log('\nNext steps:');
  console.log('  1. Make tenantId non-nullable in schema.prisma');
  console.log('  2. Run: npx prisma db push');
  console.log('  3. Update auth system (Phase 2)');
}

main()
  .catch((e) => {
    console.error('❌ Migration failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
