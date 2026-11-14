// Writes the PRE-MIGRATION seed for schema it_mig (local dev Postgres only).
// Inserts rows the way the old code did: products WITHOUT a down-payment %
// so the old column DEFAULT 25 supplies it. Usage: node mig-seed.js <wt> <out.sql>
const path = require('path');
const fs = require('fs');
const bcrypt = require(path.join(process.argv[2], 'apps', 'api', 'node_modules', 'bcryptjs'));
const out = process.argv[3];
const h = (p) => bcrypt.hashSync(p, 10).replace(/'/g, "''");
const sql = `
SET search_path TO it_mig;
INSERT INTO "Tenant"(id, name, slug, status, "updatedAt") VALUES ('t-mig', 'Mig Shop', 'mig-shop', 'ACTIVE', now());
INSERT INTO "TenantModule"(id, "tenantId", "moduleCode", "isEnabled") VALUES ('tm-1', 't-mig', 'rentals', true), ('tm-2', 't-mig', 'rental-policies', true);
INSERT INTO "RentalPolicy"(id, "tenantId", "defaultDownPaymentPct", "updatedAt") VALUES ('rp-1', 't-mig', 30, now());
INSERT INTO "Category"(id, "tenantId", name, slug, "updatedAt") VALUES ('c-1', 't-mig', 'Gowns', 'gowns', now());
-- legacy products: NO rentalDownPaymentPct given -> old DEFAULT 25
INSERT INTO "Product"(id, "tenantId", name, slug, "categoryId", "basePrice", "isActive", "availabilityMode", "rentalPricePerDay", "rentalDepositAmount", "maxRentalDays", "updatedAt")
VALUES ('p-leg1', 't-mig', 'Legacy Gown 1', 'leg-gown', 'c-1', 950000, true, 'BOTH', 140000, 350000, 7, now()),
       ('p-leg2', 't-mig', 'Legacy Gown 2', 'leg-gown-2', 'c-1', 950000, true, 'RENTAL_ONLY', 140000, 350000, 7, now()),
       ('p-leg3', 't-mig', 'Legacy Gown 3', 'leg-gown-3', 'c-1', 950000, true, 'RENTAL_ONLY', 250, 50, 7, now());
-- a product someone set to 40 % by SQL (the only way a non-default value could exist)
INSERT INTO "Product"(id, "tenantId", name, slug, "categoryId", "basePrice", "isActive", "availabilityMode", "rentalPricePerDay", "rentalDepositAmount", "rentalDownPaymentPct", "maxRentalDays", "updatedAt")
VALUES ('p-expl', 't-mig', 'Explicit 40', 'expl-gown', 'c-1', 950000, true, 'RENTAL_ONLY', 140000, 350000, 40, 7, now());
INSERT INTO "ProductVariant"(id, "tenantId", "productId", name, sku, price, stock, "isActive", "updatedAt")
VALUES ('v-leg1', 't-mig', 'p-leg1', 'Standard', 'MIG-1', 950000, 1, true, now()),
       ('v-leg2', 't-mig', 'p-leg2', 'Standard', 'MIG-2', 950000, 1, true, now()),
       ('v-leg3', 't-mig', 'p-leg3', 'Standard', 'MIG-3', 950000, 1, true, now()),
       ('v-expl', 't-mig', 'p-expl', 'Standard', 'MIG-E', 950000, 1, true, now());
INSERT INTO "User"(id, "tenantId", email, "passwordHash", "firstName", "lastName", phone, "isActive", "updatedAt")
VALUES ('u-1', 't-mig', 'mig-customer@example.test', '${h('MigTest12345')}', 'Test', 'Customer', '+255700000001', true, now());
INSERT INTO "Address"(id, "userId", "fullName", phone, street, city, region, "updatedAt")
VALUES ('a-1', 'u-1', 'Test Customer', '+255700000001', 'Test St', 'Dar es Salaam', 'Dar es Salaam', now());
INSERT INTO "AdminUser"(id, "tenantId", email, "passwordHash", "firstName", "lastName", role, "isActive", "updatedAt")
VALUES ('adm-super', 't-mig', 'mig-owner@example.test', '${h('MigOwner12345')}', 'Owner', 'Test', 'SUPER_ADMIN', true, now()),
       ('adm-staff', 't-mig', 'mig-staff@example.test', '${h('MigStaff12345')}', 'Staff', 'Test', 'STAFF', true, now());
-- an EXISTING booking with its stored amounts (old 25 % on the legacy gown)
INSERT INTO "RentalOrder"(id, "tenantId", "rentalNumber", "userId", "productId", "variantId", "startDate", "returnDate", "pickupDate", "totalRentalPrice", "downPaymentAmount", "damageDeposit", status, "updatedAt")
VALUES ('r-old', 't-mig', 'RNT-OLD-1', 'u-1', 'p-leg1', 'v-leg1', now() + interval '100 days', now() + interval '102 days', now() + interval '100 days', 140000, 35000, 350000, 'CONFIRMED', now());
`;
fs.writeFileSync(out, sql);
console.log('wrote', out);
