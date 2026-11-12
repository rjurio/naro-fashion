import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException, ConflictException, ValidationPipe } from '@nestjs/common';
import { PERMISSIONS_KEY as PERMISSION_KEY } from '../auth/decorators/requires-permission.decorator';
import { PermissionGuard } from '../auth/guards/permission.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { effectiveDownPaymentPct, rentalTerms } from '../rentals/rental-terms';
import { RentalsService } from '../rentals/rentals.service';
import { CreateProductDto, UpdateProductDto } from './dto';
import { SetRentalDownPaymentDto } from './dto/set-rental-down-payment.dto';
import { ProductDownPaymentController } from './product-down-payment.controller';
import { DOWN_PAYMENT_CHANGED, PCT_NOT_ALLOWED_WITH_INHERIT, ProductDownPaymentService } from './product-down-payment.service';
import { ProductsService } from './products.service';

/**
 * Owner decision 2026-11-12: a product either inherits the shop's rental
 * down-payment policy or has its own custom %. Existing products (all stored
 * at 25 % by the old DB default) are NOT reinterpreted: their mode is NULL
 * ("not reviewed") and their stored % keeps applying until an admin chooses.
 */

const T = 'tenant-a';
const pipe = new ValidationPipe({
  whitelist: true, forbidNonWhitelisted: true, transform: true,
  transformOptions: { enableImplicitConversion: true },
});

// ---------------------------------------------------------------- the rule
describe('effective down payment by mode', () => {
  it.each([
    // [label, mode, product %, shop %, expected %, source]
    ['INHERIT uses the shop default and ignores any product %', 'INHERIT', 40, 30, 30, 'shop'],
    ['INHERIT with no shop policy → 25 % fallback', 'INHERIT', null, null, 25, 'default'],
    ['CUSTOM uses the product %', 'CUSTOM', 40, 30, 40, 'product'],
    ['CUSTOM 0 % is valid (no down payment), not "absent"', 'CUSTOM', 0, 30, 0, 'product'],
    ['NOT REVIEWED (NULL) keeps the stored 25 % even when the shop says 30 %', null, 25, 30, 25, 'product'],
    ['NOT REVIEWED with no stored % → shop default', null, null, 30, 30, 'shop'],
  ])('%s', (_l, mode, productPct, shopPct, pct, source) => {
    expect(effectiveDownPaymentPct(productPct as any, shopPct as any, mode as any)).toMatchObject({ pct, source });
  });
  it('CUSTOM with no valid % is reported invalid and falls back to the shop default', () => {
    expect(effectiveDownPaymentPct(null, 30, 'CUSTOM')).toEqual({ pct: 30, source: 'shop', invalid: ['product'] });
    expect(effectiveDownPaymentPct(150, 30, 'CUSTOM')).toEqual({ pct: 30, source: 'shop', invalid: ['product'] });
  });
  it('an unknown mode is reported, then treated like "not reviewed"', () => {
    expect(effectiveDownPaymentPct(25, 30, 'FOO')).toEqual({ pct: 25, source: 'product', invalid: ['mode'] });
  });
  it('rentalTerms (quote + booking) honours the mode', () => {
    const fee = { rentalPricePerDay: '140000', basePrice: '950000', rentalDepositAmount: '350000' };
    expect(rentalTerms({ ...fee, rentalDownPaymentMode: 'INHERIT', rentalDownPaymentPct: 40 }, { defaultDownPaymentPct: 30 }).downPayment).toBe(42000);
    expect(rentalTerms({ ...fee, rentalDownPaymentMode: 'CUSTOM', rentalDownPaymentPct: 40 }, { defaultDownPaymentPct: 30 }).downPayment).toBe(56000);
    expect(rentalTerms({ ...fee, rentalDownPaymentMode: null, rentalDownPaymentPct: 25 }, { defaultDownPaymentPct: 30 }).downPayment).toBe(35000);
  });
});

describe('the public quote uses the mode', () => {
  it('INHERIT product with a stale 40 % stored: the quote says the shop 30 %', async () => {
    const prisma: any = {
      product: { findFirst: jest.fn().mockResolvedValue({ rentalPricePerDay: '140000', basePrice: '950000', rentalDepositAmount: '0', rentalDownPaymentPct: 40, rentalDownPaymentMode: 'INHERIT' }) },
      rentalPolicy: { findFirst: jest.fn().mockResolvedValue({ defaultDownPaymentPct: 30 }) },
    };
    const svc = new RentalsService(prisma, { requireId: T } as any, { log: jest.fn() } as any);
    const q = await svc.getQuote('p1');
    expect([q.downPaymentPct, q.downPayment]).toEqual([30, 42000]);
    expect(prisma.product.findFirst.mock.calls[0][0].select.rentalDownPaymentMode).toBe(true);
  });
});

// ---------------------------------------------------------------- endpoint contract
describe('PATCH /products/:id/rental-down-payment: guards and permission', () => {
  it('the controller is admin-only, and changing the setting needs rental-policies:manage', () => {
    expect(Reflect.getMetadata('__guards__', ProductDownPaymentController)).toEqual([JwtAuthGuard, AdminGuard]);
    const set = ProductDownPaymentController.prototype.set;
    expect(Reflect.getMetadata('__guards__', set)).toEqual([PermissionGuard]);
    expect(Reflect.getMetadata(PERMISSION_KEY, set)).toEqual(['rental-policies:manage']);
    // reading is for any admin (the product form shows it)
    expect(Reflect.getMetadata(PERMISSION_KEY, ProductDownPaymentController.prototype.get)).toBeUndefined();
  });
  it('the permission is seeded, and NOT auto-granted to MANAGER', () => {
    const src = readFileSync(join(__dirname, '..', 'permissions', 'permissions.service.ts'), 'utf8');
    expect(src).toMatch(/code: 'rental-policies:manage'/);
    const grants = src.slice(src.indexOf('export const MANAGER_DEFAULT_GRANTS'), src.indexOf('];', src.indexOf('export const MANAGER_DEFAULT_GRANTS')));
    expect(grants).not.toMatch(/rental-policies:manage/);
  });
});

describe('SetRentalDownPaymentDto validation', () => {
  const meta = { type: 'body' as const, metatype: SetRentalDownPaymentDto };
  const ok = (b: any) => pipe.transform(b, meta);
  it('accepts INHERIT, CUSTOM with 0-100', async () => {
    await expect(ok({ mode: 'INHERIT', expectedMode: 'NOT_REVIEWED', expectedPct: 25 })).resolves.toBeTruthy();
    await expect(ok({ mode: 'CUSTOM', pct: 0, expectedMode: 'INHERIT', expectedPct: null })).resolves.toBeTruthy();
    await expect(ok({ mode: 'CUSTOM', pct: 100, expectedMode: 'CUSTOM', expectedPct: 40 })).resolves.toBeTruthy();
  });
  it.each([
    ['CUSTOM without a %', { mode: 'CUSTOM', expectedMode: 'INHERIT' }],
    ['over 100', { mode: 'CUSTOM', pct: 101, expectedMode: 'INHERIT' }],
    ['negative', { mode: 'CUSTOM', pct: -1, expectedMode: 'INHERIT' }],
    ['not whole', { mode: 'CUSTOM', pct: 12.5, expectedMode: 'INHERIT' }],
    ['not a number', { mode: 'CUSTOM', pct: 'abc', expectedMode: 'INHERIT' }],
    ['unknown mode', { mode: 'SHOP', expectedMode: 'INHERIT' }],
    ['missing expectedMode', { mode: 'INHERIT' }],
    ['unknown field', { mode: 'INHERIT', expectedMode: 'INHERIT', rentalDownPaymentPct: 5 }],
  ])('rejects %s', async (_l, b) => {
    await expect(ok(b)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('ordinary product create/update cannot carry the setting (field not accepted)', async () => {
    for (const metatype of [CreateProductDto, UpdateProductDto]) {
      for (const f of [{ rentalDownPaymentPct: 40 }, { rentalDownPaymentMode: 'CUSTOM' }]) {
        await expect(pipe.transform({ name: 'x', ...f }, { type: 'body', metatype })).rejects.toBeInstanceOf(BadRequestException);
      }
    }
  });
});

// ---------------------------------------------------------------- service
function svcWith(row: any, policy: any = { defaultDownPaymentPct: 25 }) {
  const updatedAt = new Date('2026-11-01T10:00:00Z');
  const prisma: any = {
    product: {
      findFirst: jest.fn().mockResolvedValue(row ? { ...row, updatedAt } : null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    rentalPolicy: { findFirst: jest.fn().mockResolvedValue(policy) },
    rentalOrder: { update: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
    payment: { update: jest.fn(), updateMany: jest.fn() },
  };
  const audit = { log: jest.fn() };
  return { svc: new ProductDownPaymentService(prisma, { requireId: T } as any, audit as any), prisma, audit, updatedAt };
}
const LEGACY = { rentalDownPaymentMode: null, rentalDownPaymentPct: 25 };

describe('ProductDownPaymentService', () => {
  it('describes a not-reviewed product: stored 25 % still applies, with the shop default shown', async () => {
    const { svc, prisma } = svcWith(LEGACY, { defaultDownPaymentPct: 30 });
    expect(await svc.get('p1')).toMatchObject({ mode: 'NOT_REVIEWED', storedPct: 25, effectivePct: 25, effectiveSource: 'product', shopPct: 30, shopPctSource: 'shop' });
    expect(prisma.product.findFirst.mock.calls[0][0].where).toEqual({ id: 'p1', tenantId: T, deletedAt: null });
  });
  it('defaults for a new product: inherit, showing the shop default (or the 25 % fallback)', async () => {
    expect(await svcWith(null, { defaultDownPaymentPct: 30 }).svc.defaults()).toMatchObject({ mode: 'INHERIT', effectivePct: 30, effectiveSource: 'shop' });
    expect(await svcWith(null, null).svc.defaults()).toMatchObject({ mode: 'INHERIT', effectivePct: 25, effectiveSource: 'default', shopPctSource: 'default' });
  });
  it('legacy → INHERIT: compare-and-swap on what the admin saw; % cleared; updatedAt kept; audited', async () => {
    const { svc, prisma, audit, updatedAt } = svcWith(LEGACY, { defaultDownPaymentPct: 25 });
    const r = await svc.set('p1', { mode: 'INHERIT', expectedMode: 'NOT_REVIEWED', expectedPct: 25 } as any);
    expect(prisma.product.updateMany).toHaveBeenCalledWith({
      where: { id: 'p1', tenantId: T, deletedAt: null, rentalDownPaymentMode: null, rentalDownPaymentPct: 25 },
      data: { rentalDownPaymentMode: 'INHERIT', rentalDownPaymentPct: null, updatedAt },
    });
    expect(r).toMatchObject({ mode: 'INHERIT', storedPct: null, effectivePct: 25 });
    expect(audit.log).toHaveBeenCalledWith('UPDATE_DOWN_PAYMENT', 'Product', 'p1', expect.objectContaining({
      before: { mode: 'NOT_REVIEWED', pct: 25, effectivePct: 25 },
      after: { mode: 'INHERIT', pct: null, effectivePct: 25 },
    }));
  });
  it('→ CUSTOM 0 %: stored as an explicit 0', async () => {
    const { svc, prisma } = svcWith({ rentalDownPaymentMode: 'INHERIT', rentalDownPaymentPct: null });
    const r = await svc.set('p1', { mode: 'CUSTOM', pct: 0, expectedMode: 'INHERIT', expectedPct: null } as any);
    expect(prisma.product.updateMany.mock.calls[0][0].data).toMatchObject({ rentalDownPaymentMode: 'CUSTOM', rentalDownPaymentPct: 0 });
    expect(r).toMatchObject({ mode: 'CUSTOM', storedPct: 0, effectivePct: 0 });
  });
  it('changed by someone else since the admin loaded it → 409 with the current setting, nothing written', async () => {
    const { svc, prisma, audit } = svcWith({ rentalDownPaymentMode: 'CUSTOM', rentalDownPaymentPct: 40 });
    const err: any = await svc.set('p1', { mode: 'INHERIT', expectedMode: 'NOT_REVIEWED', expectedPct: 25 } as any).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: DOWN_PAYMENT_CHANGED, current: { mode: 'CUSTOM', storedPct: 40 } });
    expect(prisma.product.updateMany).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });
  it('a race lost at write time (0 rows) → 409, not audited', async () => {
    const { svc, prisma, audit } = svcWith(LEGACY);
    prisma.product.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.set('p1', { mode: 'INHERIT', expectedMode: 'NOT_REVIEWED', expectedPct: 25 } as any)).rejects.toBeInstanceOf(ConflictException);
    expect(audit.log).not.toHaveBeenCalled();
  });
  it('INHERIT with a % is refused (ambiguous)', async () => {
    const { svc } = svcWith(LEGACY);
    const err: any = await svc.set('p1', { mode: 'INHERIT', pct: 30, expectedMode: 'NOT_REVIEWED', expectedPct: 25 } as any).catch((e) => e);
    expect(err.getResponse().code).toBe(PCT_NOT_ALLOWED_WITH_INHERIT);
  });
  it('NEVER touches existing bookings or payments', async () => {
    const { svc, prisma } = svcWith(LEGACY);
    await svc.set('p1', { mode: 'CUSTOM', pct: 40, expectedMode: 'NOT_REVIEWED', expectedPct: 25 } as any);
    for (const m of ['rentalOrder', 'payment']) for (const fn of Object.values(prisma[m])) expect(fn).not.toHaveBeenCalled();
    const src = readFileSync(join(__dirname, 'product-down-payment.service.ts'), 'utf8');
    expect(src).not.toMatch(/\.(rentalOrder|payment)\.(create|update|updateMany|upsert|delete)/);
  });
});

describe('new products inherit the shop default', () => {
  it('ProductsService.create stores mode INHERIT and no % of its own', async () => {
    const create = jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'new', ...data }));
    const prisma: any = new Proxy({
      product: { create, findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
      category: { findFirst: jest.fn().mockResolvedValue({ id: 'c1', tenantId: T }) },
    }, { get: (t: any, k: string) => t[k] ?? new Proxy({}, { get: () => jest.fn().mockResolvedValue(null) }) });
    const svc = new ProductsService(prisma, { requireId: T } as any, { log: jest.fn() } as any);
    await svc.create({ name: 'New Gown', categoryId: 'c1', basePrice: 100000, availabilityMode: 'BOTH', rentalPricePerDay: 50000 } as any);
    const data = create.mock.calls[0][0].data;
    expect(data.rentalDownPaymentMode).toBe('INHERIT');
    expect(data.rentalDownPaymentPct).toBeUndefined();
  });
  it('the schema no longer gives the % a default (no silent 25 % override)', () => {
    const schema = readFileSync(join(__dirname, '..', '..', '..', '..', 'packages', 'database', 'prisma', 'schema.prisma'), 'utf8');
    expect(schema).toMatch(/rentalDownPaymentPct\s+Int\?\s*\n/);
    expect(schema).toMatch(/rentalDownPaymentMode\s+String\?/);
  });
  it('the migration is expand-only: adds the mode column, drops the default, rewrites no rows', () => {
    const sql = readFileSync(join(__dirname, '..', '..', '..', '..', 'packages', 'database', 'prisma', 'migrations',
      '20261112120000_product_down_payment_inheritance', 'migration.sql'), 'utf8').replace(/--[^\n]*/g, '');
    expect(sql).toMatch(/ADD COLUMN\s+"rentalDownPaymentMode" TEXT/);
    expect(sql).toMatch(/ALTER COLUMN "rentalDownPaymentPct" DROP DEFAULT/);
    expect(sql).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bDROP COLUMN\b|SET DEFAULT|NOT NULL/i);
  });
});

describe('admin product form: an ordinary save cannot change the setting', () => {
  const form = readFileSync(join(__dirname, '..', '..', '..', 'admin', 'components', 'products', 'ProductForm.tsx'), 'utf8');
  const ctl = readFileSync(join(__dirname, '..', '..', '..', 'admin', 'components', 'products', 'RentalDownPaymentControl.tsx'), 'utf8');
  it('the form payload has no down-payment field; the control is embedded with the product id', () => {
    expect(form).not.toMatch(/rentalDownPayment(Pct|Mode)/);
    expect(form).toMatch(/<RentalDownPaymentControl productId=\{initialData\?\.id\} \/>/);
  });
  it('the control saves on its own endpoint with compare-and-swap, shows the server effective %, and uses type="button"', () => {
    expect(ctl).toMatch(/adminApi\.setProductDownPayment\(productId/);
    expect(ctl).toMatch(/expectedMode:/);
    expect(ctl).toMatch(/expectedPct: state\.storedPct/);
    expect(ctl).toMatch(/state\.effectivePct/);
    expect(ctl).not.toMatch(/<button(?![^>]*type="button")/);
    // no client-side percentage rule
    expect(ctl).not.toMatch(/\?\?\s*25|\|\|\s*25/);
  });
});
