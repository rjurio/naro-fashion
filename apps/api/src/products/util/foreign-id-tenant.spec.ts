import { BadRequestException, NotFoundException } from '@nestjs/common';
import { assertAllSameTenant, assertSameTenant } from './tenant-ownership';
import { CategoriesService } from '../../categories/categories.service';
import { FlashSalesService } from '../../flash-sales/flash-sales.service';
import { ShippingService } from '../../shipping/shipping.service';
import { EventsService } from '../../events/events.service';
import { CartService } from '../../cart/cart.service';
import { WishlistService } from '../../wishlist/wishlist.service';

/**
 * Regression #3 (Oct 2026 review): client-supplied foreign ids must belong to
 * the caller's tenant. Each service must look the id up WITH tenantId and 404
 * (never link) when it isn't found.
 */
const T = 'tenant_a';
const tenantContext: any = { requireId: T };
const audit: any = { log: jest.fn() };

describe('tenant-ownership helpers', () => {
  it('assertSameTenant scopes by tenant and 404s when missing', async () => {
    const delegate = { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn() };
    await expect(assertSameTenant(delegate, 'x', T, 'Thing')).rejects.toBeInstanceOf(NotFoundException);
    expect(delegate.findFirst.mock.calls[0][0].where).toEqual({ id: 'x', tenantId: T });
  });
  it('assertSameTenant is a no-op for empty ids', async () => {
    const delegate = { findFirst: jest.fn(), count: jest.fn() };
    await assertSameTenant(delegate, undefined, T, 'Thing');
    await assertSameTenant(delegate, '', T, 'Thing');
    expect(delegate.findFirst).not.toHaveBeenCalled();
  });
  it('assertAllSameTenant 404s when any id is foreign (dedupes)', async () => {
    const delegate = { findFirst: jest.fn(), count: jest.fn().mockResolvedValue(1) };
    await expect(assertAllSameTenant(delegate, ['a', 'b', 'a'], T, 'products')).rejects.toBeInstanceOf(NotFoundException);
    expect(delegate.count.mock.calls[0][0].where).toEqual({ id: { in: ['a', 'b'] }, tenantId: T });
  });
});

describe('CategoriesService parentId / sizeGuideId', () => {
  function make(found: { cat?: any; sg?: any }) {
    const prisma: any = {
      category: {
        findFirst: jest.fn().mockResolvedValue(found.cat ?? null),
        create: jest.fn().mockResolvedValue({ id: 'new' }),
        update: jest.fn().mockResolvedValue({ id: 'c1' }),
      },
      sizeGuide: { findFirst: jest.fn().mockResolvedValue(found.sg ?? null) },
    };
    return { prisma, svc: new CategoriesService(prisma, tenantContext, audit) };
  }
  it('create rejects a foreign parentId', async () => {
    const { prisma, svc } = make({});
    await expect(svc.create({ name: 'Kids', parentId: 'foreign' } as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.category.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'foreign', tenantId: T });
    expect(prisma.category.create).not.toHaveBeenCalled();
  });
  it('create rejects a foreign sizeGuideId', async () => {
    const { prisma, svc } = make({});
    await expect(svc.create({ name: 'Kids', sizeGuideId: 'sg-x' } as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.sizeGuide.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'sg-x', tenantId: T });
  });
  it('update rejects self-parenting', async () => {
    const { svc } = make({ cat: { id: 'c1', deletedAt: null } });
    await expect(svc.update('c1', { parentId: 'c1' } as any)).rejects.toBeInstanceOf(BadRequestException);
  });
  it('findAll tenant-filters children includes', async () => {
    const prisma: any = {
      category: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
    };
    await new CategoriesService(prisma, tenantContext, audit).findAll();
    const inc = prisma.category.findMany.mock.calls[0][0].include;
    expect(inc.children.where).toMatchObject({ tenantId: T, deletedAt: null });
    expect(inc.children.include.children.where).toMatchObject({ tenantId: T, deletedAt: null });
  });
});

describe('FlashSalesService productIds', () => {
  it('create 404s when a productId is foreign', async () => {
    const prisma: any = {
      product: { count: jest.fn().mockResolvedValue(1) },
      flashSale: { create: jest.fn() },
    };
    const svc = new FlashSalesService(prisma, tenantContext, audit);
    await expect(
      svc.create({ title: 'x', startDate: '2026-01-01', endDate: '2026-02-01', salePrice: 1, productIds: ['p1', 'p_foreign'] }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.product.count.mock.calls[0][0].where).toMatchObject({ tenantId: T, id: { in: ['p1', 'p_foreign'] } });
    expect(prisma.flashSale.create).not.toHaveBeenCalled();
  });
  it('update 404s when a productId is foreign', async () => {
    const prisma: any = {
      flashSale: { findFirst: jest.fn().mockResolvedValue({ id: 'fs1' }), update: jest.fn() },
      flashSaleItem: { deleteMany: jest.fn() },
      product: { count: jest.fn().mockResolvedValue(0) },
    };
    const svc = new FlashSalesService(prisma, tenantContext, audit);
    await expect(svc.update('fs1', { productIds: ['p_foreign'] })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.flashSaleItem.deleteMany).not.toHaveBeenCalled();
  });
});

describe('ShippingService shippingZoneId', () => {
  it('createShipment 404s for a foreign zone', async () => {
    const prisma: any = {
      order: { findFirst: jest.fn().mockResolvedValue({ id: 'o1' }) },
      shipment: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      shippingZone: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = new ShippingService(prisma, tenantContext);
    await expect(svc.createShipment({ orderId: 'o1', shippingZoneId: 'z_foreign' } as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.shippingZone.findFirst.mock.calls[0][0].where).toEqual({ id: 'z_foreign', tenantId: T });
    expect(prisma.shipment.create).not.toHaveBeenCalled();
  });
});

describe('EventsService', () => {
  function make() {
    const prisma: any = {
      customerEvent: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: 'e1' }),
      },
      product: { findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn() },
      user: { findFirst: jest.fn().mockResolvedValue({ firstName: 'A', lastName: 'B' }), findUnique: jest.fn() },
    };
    return { prisma, svc: new EventsService(prisma, tenantContext) };
  }
  it('customer submit looks the product up tenant-scoped (no findUnique by id)', async () => {
    const { prisma, svc } = make();
    await expect(
      svc.createByCustomer({ title: 'W', eventDate: '2026-01-01', productId: 'p_foreign' } as any, 'u1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.product.findUnique).not.toHaveBeenCalled();
    expect(prisma.product.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'p_foreign', tenantId: T });
  });
  it('admin create rejects a foreign productId', async () => {
    const { prisma, svc } = make();
    await expect(
      svc.createByAdmin({ title: 'W', eventDate: '2026-01-01', productId: 'p_foreign' } as any, 'admin1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.customerEvent.create).not.toHaveBeenCalled();
  });
  it('public list does not include user ids', async () => {
    const { prisma, svc } = make();
    await svc.findAllPublic();
    expect(prisma.customerEvent.findMany.mock.calls[0][0].include.user).toBeUndefined();
  });
});

describe('CartService.addItem', () => {
  function make(variant: any) {
    const prisma: any = {
      productVariant: { findFirst: jest.fn().mockResolvedValue(variant) },
      cartItem: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation((a: any) => Promise.resolve(a.data)),
      },
    };
    return { prisma, svc: new CartService(prisma, tenantContext) };
  }
  const live = {
    id: 'v1',
    productId: 'p1',
    isActive: true,
    product: { id: 'p1', tenantId: T, isActive: true, deletedAt: null, archivedAt: null, availabilityMode: 'BOTH' },
  };
  it('404s for a variant outside the tenant', async () => {
    const { prisma, svc } = make(null);
    await expect(svc.addItem('u1', { productId: 'p1', variantId: 'v_foreign' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.productVariant.findFirst.mock.calls[0][0].where).toEqual({ id: 'v_foreign', tenantId: T });
  });
  it('400s when productId does not match the variant', async () => {
    const { svc } = make(live);
    await expect(svc.addItem('u1', { productId: 'p_other', variantId: 'v1' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('400s for an inactive variant / archived product', async () => {
    await expect(make({ ...live, isActive: false }).svc.addItem('u1', { productId: 'p1', variantId: 'v1' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      make({ ...live, product: { ...live.product, isActive: false, archivedAt: new Date() } }).svc.addItem('u1', { productId: 'p1', variantId: 'v1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('stores productId derived from the variant', async () => {
    const { prisma, svc } = make(live);
    await svc.addItem('u1', { productId: 'p1', variantId: 'v1', quantity: 2 });
    expect(prisma.cartItem.create.mock.calls[0][0].data).toMatchObject({ productId: 'p1', variantId: 'v1', quantity: 2 });
  });
});

describe('WishlistService.addItem', () => {
  it('404s for a product outside the tenant', async () => {
    const prisma: any = {
      product: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn() },
      wishlistItem: { findFirst: jest.fn(), create: jest.fn() },
    };
    const svc = new WishlistService(prisma, tenantContext);
    await expect(svc.addItem('u1', 'p_foreign')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.product.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'p_foreign', tenantId: T });
    expect(prisma.wishlistItem.create).not.toHaveBeenCalled();
  });
});

describe('CategoriesService DTO mapping (image → imageUrl, no raw spread)', () => {
  function make() {
    const prisma: any = {
      category: {
        findFirst: jest.fn().mockResolvedValue({ id: 'c1', deletedAt: null }),
        create: jest.fn().mockImplementation((a: any) => Promise.resolve({ id: 'new', ...a.data })),
        update: jest.fn().mockImplementation((a: any) => Promise.resolve({ id: 'c1', ...a.data })),
      },
      sizeGuide: { findFirst: jest.fn().mockResolvedValue({ id: 'sg' }) },
    };
    return { prisma, svc: new CategoriesService(prisma, tenantContext, audit) };
  }
  it('create maps legacy keys to Prisma columns', async () => {
    const { prisma, svc } = make();
    await svc.create({ nameEn: 'Wedding Dresses', nameSw: 'Gauni', image: '/uploads/c.jpg', parentId: null } as any);
    const data = prisma.category.create.mock.calls[0][0].data;
    expect(data).toEqual({
      name: 'Wedding Dresses', nameSwahili: 'Gauni', imageUrl: '/uploads/c.jpg', parentId: null,
      slug: 'wedding-dresses', tenantId: T,
    });
    expect(data.image).toBeUndefined();
    expect(data.nameEn).toBeUndefined();
  });
  it('update accepts imageUrl and only writes provided keys', async () => {
    const { prisma, svc } = make();
    await svc.update('c1', { imageUrl: '/uploads/x.jpg' } as any);
    expect(prisma.category.update.mock.calls[0][0].data).toEqual({ imageUrl: '/uploads/x.jpg' });
  });
});

describe('ReviewsController moderation routes', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ReviewsController } = require('../../reviews/reviews.controller');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PermissionGuard } = require('../../auth/guards/permission.guard');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { AdminGuard } = require('../../auth/guards/admin.guard');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PERMISSIONS_KEY } = require('../../auth/decorators/requires-permission.decorator');
  for (const method of ['approve', 'reject']) {
    it(`${method} is AdminGuard + PermissionGuard + reviews:moderate`, () => {
      const handler = ReviewsController.prototype[method];
      expect(handler).toBeDefined();
      const guards = Reflect.getMetadata('__guards__', handler);
      expect(guards).toEqual(expect.arrayContaining([AdminGuard, PermissionGuard]));
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['reviews:moderate']);
      expect(Reflect.getMetadata('path', handler)).toBe(`:id/${method}`);
    });
  }
});