import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ProductsService } from '../products/products.service';
import { CategoriesService } from '../categories/categories.service';
import { ExpensesService } from '../expenses/expenses.service';
import { OrdersService } from '../orders/orders.service';
import { RentalsService } from '../rentals/rentals.service';
import { CreateProductDto } from '../products/dto/create-product.dto';
import { UpdateProductDto } from '../products/dto/update-product.dto';
import { CreateCategoryDto } from '../categories/dto/create-category.dto';
import { UpdateCategoryDto } from '../categories/dto/update-category.dto';
import { CreateExpenseDto } from '../expenses/dto/create-expense.dto';
import { UpdateExpenseDto } from '../expenses/dto/update-expense.dto';
import { UpdateOrderStatusDto } from '../orders/dto/update-order-status.dto';
import { UpdateRentalStatusDto } from '../rentals/dto/update-rental-status.dto';
import { CLIENT_ID_REGEX, isPrimaryKeyConflict, parseExpectedUpdatedAt } from './offline-sync.util';

/**
 * Admin offline mode, Phase 2 — optimistic concurrency + client-generated ids.
 * expectedUpdatedAt / expectedStatus are optional: omitting them keeps
 * today's behaviour; a mismatch answers 409 { code: 'CONFLICT', current }.
 */

const T0 = new Date('2026-10-18T08:00:00.123Z');
const T1 = new Date('2026-10-18T09:00:00.456Z');
const audit: any = { log: jest.fn() };
const tenantContext: any = { requireId: 't1' };

function pkError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`id`)', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['id'] },
  });
}

async function conflictBody(p: Promise<unknown>) {
  const err: any = await p.catch((e) => e);
  expect(err).toBeInstanceOf(ConflictException);
  return err.getResponse();
}

// ---------------------------------------------------------------------------
describe('Products — expectedUpdatedAt + client id', () => {
  function make(current = { id: 'p1', tenantId: 't1', slug: 'gown', deletedAt: null, updatedAt: T0 }) {
    const tx: any = {
      product: {
        updateMany: jest.fn(async ({ where }: any) => ({
          count: where.updatedAt.getTime() === current.updatedAt.getTime() ? 1 : 0,
        })),
        update: jest.fn(async ({ data }: any) => ({ ...current, ...data })),
      },
      productImage: { deleteMany: jest.fn(), createMany: jest.fn() },
    };
    const prisma: any = {
      product: {
        findFirst: jest.fn(async () => current),
        create: jest.fn(async ({ data }: any) => ({ id: data.id ?? 'generated', ...data })),
      },
      category: { findFirst: jest.fn(async () => ({ id: 'c1' })) },
      sizeGuide: { findFirst: jest.fn(async () => ({ id: 's1' })) },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    return { svc: new ProductsService(prisma, tenantContext, audit), prisma, tx };
  }

  it('matching expectedUpdatedAt → atomic claim on {id, tenantId, updatedAt} then update', async () => {
    const { svc, tx } = make();
    await svc.update('p1', { name: 'New', expectedUpdatedAt: T0.toISOString() } as any);
    const claim = tx.product.updateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({ id: 'p1', tenantId: 't1', updatedAt: T0 });
    expect(tx.product.update).toHaveBeenCalled();
  });

  it('mismatching expectedUpdatedAt → 409 CONFLICT with the current record, no write', async () => {
    const { svc, tx } = make();
    const body = await conflictBody(svc.update('p1', { name: 'New', expectedUpdatedAt: T1.toISOString() } as any));
    expect(body).toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(body.message).toMatch(/changed by someone else/);
    expect(body.current).toMatchObject({ id: 'p1', updatedAt: T0 });
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it('omitting expectedUpdatedAt keeps today’s behaviour (no claim)', async () => {
    const { svc, tx } = make();
    await svc.update('p1', { name: 'New' } as any);
    expect(tx.product.updateMany).not.toHaveBeenCalled();
    expect(tx.product.update).toHaveBeenCalled();
  });

  it('create uses the client-generated id', async () => {
    const { svc, prisma } = make();
    const id = 'ckofflineproduct00000001';
    await svc.create({ id, name: 'Gown', description: 'd', price: 10 } as any);
    expect(prisma.product.create.mock.calls[0][0].data.id).toBe(id);
    expect(prisma.product.create.mock.calls[0][0].data.tenantId).toBe('t1');
  });

  it('create with an id that already exists → 409 ID_CONFLICT (no other-tenant data)', async () => {
    const { svc, prisma } = make();
    prisma.product.create.mockRejectedValueOnce(pkError());
    const body = await conflictBody(svc.create({ id: 'ckofflineproduct00000001', name: 'G', description: 'd', price: 1 } as any));
    expect(body).toEqual({ statusCode: 409, code: 'ID_CONFLICT', message: 'A record with this id already exists.' });
  });

  it('without a client id, a PK-shaped error is NOT mapped to ID_CONFLICT', async () => {
    const { svc, prisma } = make();
    prisma.product.create.mockRejectedValueOnce(pkError());
    const body = await conflictBody(svc.create({ name: 'G', description: 'd', price: 1 } as any));
    expect(body.code).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe('Categories — expectedUpdatedAt + client id', () => {
  function make() {
    const current = { id: 'c1', tenantId: 't1', name: 'Gowns', deletedAt: null, updatedAt: T0 };
    const prisma: any = {
      category: {
        findFirst: jest.fn(async () => current),
        updateMany: jest.fn(async ({ where }: any) => ({
          count: where.updatedAt.getTime() === T0.getTime() ? 1 : 0,
        })),
        update: jest.fn(async ({ data }: any) => ({ ...current, ...data })),
        create: jest.fn(async ({ data }: any) => ({ id: data.id ?? 'gen', ...data })),
      },
      sizeGuide: { findFirst: jest.fn() },
    };
    return { svc: new CategoriesService(prisma, tenantContext, audit), prisma };
  }

  it('match → conditional updateMany on {id, tenantId, updatedAt}', async () => {
    const { svc, prisma } = make();
    await svc.update('c1', { name: 'Bridal', expectedUpdatedAt: T0.toISOString() } as any);
    expect(prisma.category.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'c1', tenantId: 't1', updatedAt: T0 });
    expect(prisma.category.update).not.toHaveBeenCalled();
  });

  it('mismatch → 409 CONFLICT with current', async () => {
    const { svc } = make();
    const body = await conflictBody(svc.update('c1', { name: 'Bridal', expectedUpdatedAt: T1.toISOString() } as any));
    expect(body).toMatchObject({ code: 'CONFLICT', current: { id: 'c1' } });
  });

  it('omitted → plain update', async () => {
    const { svc, prisma } = make();
    await svc.update('c1', { name: 'Bridal' } as any);
    expect(prisma.category.updateMany).not.toHaveBeenCalled();
    expect(prisma.category.update).toHaveBeenCalled();
  });

  it('client id on create + ID_CONFLICT', async () => {
    const { svc, prisma } = make();
    await svc.create({ id: 'ckofflinecategory0000001', name: 'Veils' } as any);
    expect(prisma.category.create.mock.calls[0][0].data.id).toBe('ckofflinecategory0000001');
    prisma.category.create.mockRejectedValueOnce(pkError());
    const body = await conflictBody(svc.create({ id: 'ckofflinecategory0000001', name: 'Veils' } as any));
    expect(body.code).toBe('ID_CONFLICT');
  });
});

// ---------------------------------------------------------------------------
describe('Expenses — expectedUpdatedAt + client id', () => {
  function make() {
    const current = { id: 'e1', tenantId: 't1', period: '2026-10', categoryId: 'ec1', updatedAt: T0 };
    const prisma: any = {
      businessExpense: {
        findFirst: jest.fn(async () => current),
        updateMany: jest.fn(async ({ where }: any) => ({
          count: where.updatedAt.getTime() === T0.getTime() ? 1 : 0,
        })),
        update: jest.fn(async ({ data }: any) => ({ ...current, ...data })),
        create: jest.fn(async ({ data }: any) => ({ id: data.id ?? 'gen', ...data })),
      },
      expenseCategory: { findFirst: jest.fn(async () => ({ id: 'ec1' })) },
      financialPeriod: { findFirst: jest.fn(async () => null) },
    };
    return { svc: new ExpensesService(prisma, tenantContext), prisma };
  }

  it('match → conditional updateMany scoped by tenant', async () => {
    const { svc, prisma } = make();
    await svc.update('e1', { amount: 5, expectedUpdatedAt: T0.toISOString() } as any);
    expect(prisma.businessExpense.updateMany.mock.calls[0][0].where).toEqual({ id: 'e1', tenantId: 't1', updatedAt: T0 });
    expect(prisma.businessExpense.update).not.toHaveBeenCalled();
  });

  it('mismatch → 409 CONFLICT with current', async () => {
    const { svc } = make();
    const body = await conflictBody(svc.update('e1', { amount: 5, expectedUpdatedAt: T1.toISOString() } as any));
    expect(body).toMatchObject({ code: 'CONFLICT', current: { id: 'e1' } });
  });

  it('omitted → plain update', async () => {
    const { svc, prisma } = make();
    await svc.update('e1', { amount: 5 } as any);
    expect(prisma.businessExpense.update).toHaveBeenCalled();
  });

  it('client id on create + ID_CONFLICT', async () => {
    const { svc, prisma } = make();
    const dto = { id: 'ckofflineexpense00000001', categoryId: 'ec1', amount: 10, expenseDate: '2026-10-10' } as any;
    await svc.create(dto);
    expect(prisma.businessExpense.create.mock.calls[0][0].data.id).toBe(dto.id);
    prisma.businessExpense.create.mockRejectedValueOnce(pkError());
    expect((await conflictBody(svc.create(dto))).code).toBe('ID_CONFLICT');
  });
});

// ---------------------------------------------------------------------------
describe('Orders — expectedStatus', () => {
  const admin = { id: 'a1', isAdmin: true, tenantId: 't1' };
  function make(status = 'CONFIRMED', casCount = 1) {
    const order = { id: 'o1', tenantId: 't1', status, paymentStatus: 'PAID', channel: 'ONLINE', shippingCost: 0 };
    const prisma: any = {
      order: {
        findFirst: jest.fn(async () => order),
        updateMany: jest.fn(async () => ({ count: casCount })),
      },
    };
    const svc = new OrdersService(prisma, tenantContext, audit, {} as any);
    return { svc, prisma };
  }

  it('matching expectedStatus → transition applies (CAS on that status)', async () => {
    const { svc, prisma } = make('CONFIRMED');
    await svc.updateStatus('o1', 'PROCESSING', admin, 'CONFIRMED');
    expect(prisma.order.updateMany.mock.calls[0][0].where).toEqual({ id: 'o1', tenantId: 't1', status: 'CONFIRMED' });
  });

  it('mismatching expectedStatus → 409 CONFLICT with current, before transition validation', async () => {
    const { svc, prisma } = make('SHIPPED');
    // PROCESSING from SHIPPED would be a 400 transition error; a stale client gets CONFLICT instead.
    const body = await conflictBody(svc.updateStatus('o1', 'PROCESSING', admin, 'CONFIRMED'));
    expect(body).toMatchObject({ code: 'CONFLICT', current: { id: 'o1', status: 'SHIPPED' } });
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
  });

  it('race after the read (CAS 0 rows) with expectedStatus → CONFLICT shape', async () => {
    const { svc } = make('CONFIRMED', 0);
    const body = await conflictBody(svc.updateStatus('o1', 'PROCESSING', admin, 'CONFIRMED'));
    expect(body.code).toBe('CONFLICT');
  });

  it('omitted expectedStatus → unchanged behaviour (invalid transition still 400)', async () => {
    const { svc } = make('SHIPPED');
    await expect(svc.updateStatus('o1', 'PROCESSING', admin)).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
describe('Rentals — expectedStatus', () => {
  function make(status = 'READY_FOR_PICKUP') {
    const rental = { id: 'r1', tenantId: 't1', status };
    const prisma: any = {
      rentalOrder: {
        findFirst: jest.fn(async () => rental),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    return { svc: new RentalsService(prisma, tenantContext, audit), prisma };
  }

  it('match → CAS update', async () => {
    const { svc, prisma } = make('READY_FOR_PICKUP');
    await svc.updateStatus('r1', 'ITEM_DISPATCHED', 'READY_FOR_PICKUP', { isAdmin: true });
    expect(prisma.rentalOrder.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'r1', tenantId: 't1', status: 'READY_FOR_PICKUP' });
  });

  it('mismatch → 409 CONFLICT with current', async () => {
    const { svc, prisma } = make('ACTIVE');
    const body = await conflictBody(svc.updateStatus('r1', 'ITEM_DISPATCHED', 'READY_FOR_PICKUP', { isAdmin: true }));
    expect(body).toMatchObject({ code: 'CONFLICT', current: { id: 'r1', status: 'ACTIVE' } });
    expect(prisma.rentalOrder.updateMany).not.toHaveBeenCalled();
  });

  it('omitted → unchanged', async () => {
    const { svc, prisma } = make('READY_FOR_PICKUP');
    await svc.updateStatus('r1', 'ITEM_DISPATCHED');
    expect(prisma.rentalOrder.updateMany).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('DTO whitelist accepts the new optional fields', () => {
  const ok = async (cls: any, body: any) => {
    const errors = await validate(plainToInstance(cls, body), { whitelist: true, forbidNonWhitelisted: true });
    return errors.map((e) => e.property);
  };

  it('expectedUpdatedAt on product/category/expense updates', async () => {
    const iso = T0.toISOString();
    expect(await ok(UpdateProductDto, { expectedUpdatedAt: iso })).toEqual([]);
    expect(await ok(UpdateCategoryDto, { expectedUpdatedAt: iso })).toEqual([]);
    expect(await ok(UpdateExpenseDto, { expectedUpdatedAt: iso })).toEqual([]);
    expect(await ok(UpdateProductDto, { expectedUpdatedAt: 'yesterday' })).toEqual(['expectedUpdatedAt']);
  });

  it('expectedStatus on order/rental status updates', async () => {
    expect(await ok(UpdateOrderStatusDto, { status: 'SHIPPED', expectedStatus: 'PROCESSING' })).toEqual([]);
    expect(await ok(UpdateRentalStatusDto, { status: 'ACTIVE', expectedStatus: 'ITEM_DISPATCHED' })).toEqual([]);
  });

  it('client id on product/category/expense create (format enforced)', async () => {
    const id = 'ckofflineid0000000000001';
    expect(await ok(CreateProductDto, { id, name: 'G', description: 'd', price: 1, categoryId: 'c1' })).toEqual([]);
    expect(await ok(CreateCategoryDto, { id, name: 'C' })).toEqual([]);
    expect(await ok(CreateExpenseDto, { id, categoryId: 'c', amount: 1, expenseDate: '2026-10-01' })).toEqual([]);
    expect(await ok(CreateCategoryDto, { id: 'TooShort', name: 'C' })).toEqual(['id']);
    expect(await ok(CreateCategoryDto, { id: 'UPPERCASEisNotAllowed00001', name: 'C' })).toEqual(['id']);
  });
});

describe('offline-sync.util', () => {
  it('CLIENT_ID_REGEX', () => {
    expect(CLIENT_ID_REGEX.test('cm2abcdefghijklmnopqrstu')).toBe(true);
    expect(CLIENT_ID_REGEX.test('a'.repeat(20))).toBe(true);
    expect(CLIENT_ID_REGEX.test('a'.repeat(19))).toBe(false);
    expect(CLIENT_ID_REGEX.test('a'.repeat(42))).toBe(false);
    expect(CLIENT_ID_REGEX.test('-abcdefghijklmnopqrstu')).toBe(false);
  });

  it('isPrimaryKeyConflict recognises both PK target shapes only', () => {
    expect(isPrimaryKeyConflict(pkError())).toBe(true);
    const named = new Prisma.PrismaClientKnownRequestError('x', { code: 'P2002', clientVersion: 't', meta: { target: 'Product_pkey' } });
    expect(isPrimaryKeyConflict(named)).toBe(true);
    const slug = new Prisma.PrismaClientKnownRequestError('x', { code: 'P2002', clientVersion: 't', meta: { target: ['tenantId', 'slug'] } });
    expect(isPrimaryKeyConflict(slug)).toBe(false);
    expect(isPrimaryKeyConflict(new Error('x'))).toBe(false);
  });

  it('parseExpectedUpdatedAt', () => {
    expect(parseExpectedUpdatedAt(undefined)).toBeUndefined();
    expect(parseExpectedUpdatedAt(T0.toISOString())!.getTime()).toBe(T0.getTime());
    expect(() => parseExpectedUpdatedAt('nope')).toThrow(BadRequestException);
  });
});
