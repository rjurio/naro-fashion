import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { AdminQueryOrdersDto, QueryOrdersDto, orderSortToOrderBy } from './dto/query-orders.dto';

/**
 * Regression: the storefront's order history sends `sort=newest`. The strict
 * global ValidationPipe rejected the unknown field with 400, and the page
 * showed "No orders yet" to customers who HAVE orders (seen in prod
 * 2026-11-09). `sort` is now a validated, optional field.
 */

// Same options as main.ts
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
const asQuery = (metatype: any) => ({ type: 'query' as const, metatype });

describe('QueryOrdersDto.sort', () => {
  it('accepts what the storefront sends: sort=newest (+ limit)', async () => {
    const q = await pipe.transform({ sort: 'newest', limit: '3' }, asQuery(QueryOrdersDto));
    expect(q).toMatchObject({ sort: 'newest', limit: 3 });
  });

  it('accepts sort=oldest and no sort at all', async () => {
    await expect(pipe.transform({ sort: 'oldest' }, asQuery(QueryOrdersDto))).resolves.toBeTruthy();
    await expect(pipe.transform({}, asQuery(QueryOrdersDto))).resolves.toBeTruthy();
  });

  it('rejects other sort values (still validated, not free text)', async () => {
    await expect(pipe.transform({ sort: 'price' }, asQuery(QueryOrdersDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still rejects unknown fields (the strict whitelist stays on)', async () => {
    await expect(pipe.transform({ userId: 'someone-else' }, asQuery(QueryOrdersDto))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('admin query inherits it', async () => {
    await expect(pipe.transform({ sort: 'newest', search: 'NF-' }, asQuery(AdminQueryOrdersDto))).resolves.toBeTruthy();
  });

  it('maps to createdAt ordering, newest first by default', () => {
    expect(orderSortToOrderBy()).toEqual({ createdAt: 'desc' });
    expect(orderSortToOrderBy('newest')).toEqual({ createdAt: 'desc' });
    expect(orderSortToOrderBy('oldest')).toEqual({ createdAt: 'asc' });
  });
});

describe('OrdersService.findAll (customer order history)', () => {
  const T = 'tenant-a';
  function make() {
    const prisma: any = {
      order: {
        findMany: jest.fn().mockResolvedValue([{ id: 'o1', shippingFee: 0, total: 10 }]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const svc = new OrdersService(prisma, { requireId: T } as any, { log: jest.fn() } as any, {} as any);
    return { svc, prisma };
  }

  it("returns the customer's own orders, tenant + user scoped, with meta.total", async () => {
    const { svc, prisma } = make();
    const r: any = await svc.findAll('user-1', { sort: 'newest', page: 1, limit: 20 } as any);
    const args = prisma.order.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ tenantId: T, userId: 'user-1' });
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
    expect(r.meta.total).toBe(1);
    expect(r.data).toHaveLength(1);
  });

  it('honours sort=oldest', async () => {
    const { svc, prisma } = make();
    await svc.findAll('user-1', { sort: 'oldest' } as any);
    expect(prisma.order.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'asc' });
  });
});
