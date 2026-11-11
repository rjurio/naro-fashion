import { ConflictException } from '@nestjs/common';
import { PosService } from '../pos/pos.service';
import { OrdersService } from '../orders/orders.service';
import { PromoCodesService } from '../promo-codes/promo-codes.service';
import { RentalsService } from './rentals.service';
import {
  RESERVED_FOR_RENTAL,
  SALE_RELEASING_RENTAL_STATUSES,
  assertNotReservedForRental,
} from './rental-sale-guard';
import { RENTAL_WORKFLOW } from './rental-rules';

/**
 * P0b (Nov 2026): a gown committed to a rental can't be sold — online or POS
 * — and a sold-out buy-or-rent gown can't be booked. Both sides take the
 * same per-product advisory lock, so a concurrent sale + booking serialise.
 */

const T = 't1';
const FUTURE = (d: number) => new Date(Date.now() + d * 86_400_000);

/**
 * Minimal in-memory DB with a faithful-enough advisory lock: a transaction
 * that calls pg_advisory_xact_lock(hashtext(key)) waits until no other
 * open transaction holds that key; locks release when the tx callback ends.
 */
function makeDb(opts: { mode?: string; stock?: number; rentals?: any[]; restockAt?: Date | null; layaways?: any[] } = {}) {
  const state = {
    rentals: [...(opts.rentals ?? [])] as any[],
    stock: opts.stock ?? 1,
    orders: [] as any[],
    restockAt: opts.restockAt ?? null as Date | null,
    layaways: [...(opts.layaways ?? [])] as any[],
    sqlKeys: [] as string[],
    waits: 0,
  };
  const held = new Map<string, Promise<void>>();
  const product = { id: 'p1', tenantId: T, name: 'Ivory Gown', availabilityMode: opts.mode ?? 'BOTH', isActive: true, deletedAt: null, archivedAt: null, rentalPricePerDay: 140000, rentalDepositAmount: 350000, rentalDownPaymentPct: 25, bufferDaysOverride: null };
  const variant = { id: 'v1', tenantId: T, productId: 'p1', name: 'Default', isActive: true, price: 950000, get stock() { return state.stock; }, product };

  const matchStatus = (r: any, where: any) =>
    (!where.status?.notIn || !where.status.notIn.includes(r.status)) && (!where.status?.in || where.status.in.includes(r.status));

  const makeTx = (release: Array<() => void>) => {
    const tx: any = {
      $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...vals: any[]) => {
        const sql = strings.join('?');
        if (!/pg_advisory_xact_lock\(hashtext\(\?\)\)/.test(sql)) return 1; // other locks (per-user) are irrelevant here
        const key = String(vals[0]);
        state.sqlKeys.push(sql + '|' + key);
        while (held.has(key)) { state.waits += 1; await held.get(key); }
        let done!: () => void;
        held.set(key, new Promise<void>((r) => (done = r)));
        release.push(() => { held.delete(key); done(); });
        // Hold the lock across a timer tick so a concurrent tx really arrives while it's held.
        await new Promise((r) => setTimeout(r, 15));
        return 1;
      }),
      rentalOrder: {
        findMany: jest.fn(async ({ where }: any) =>
          state.rentals.filter((r) =>
            r.tenantId === where.tenantId &&
            (typeof where.productId === 'string' ? r.productId === where.productId : where.productId.in.includes(r.productId)) &&
            (!where.id?.not || r.id !== where.id.not) &&
            matchStatus(r, where))),
        count: jest.fn(async ({ where }: any) =>
          state.rentals.filter((r) => r.productId === where.productId && matchStatus(r, where) && r.startDate < where.startDate.lt && r.returnDate > where.returnDate.gt).length),
        create: jest.fn(async ({ data }: any) => { const r = { id: `r${state.rentals.length + 1}`, ...data }; state.rentals.push(r); return r; }),
      },
      inventoryTransaction: {
        findFirst: jest.fn(async () => (state.restockAt ? { createdAt: state.restockAt } : null)),
        create: jest.fn().mockResolvedValue({}),
      },
      orderItem: {
        // Lines of every recorded order (POS creates them via nested `items.create`).
        findMany: jest.fn(async ({ where }: any) =>
          state.orders
            .filter((o) => !where.order.status.notIn.includes(o.status))
            .filter((o) => !where.order.createdAt || new Date(o.createdAt ?? Date.now()) > where.order.createdAt.gt)
            .flatMap((o) => (o.items?.create ?? o.lines ?? []).filter((l: any) => l.productId === where.productId))
            .map((l: any) => ({ quantity: l.quantity, refundedQuantity: l.refundedQuantity ?? 0 }))),
      },
      layaway: {
        create: jest.fn(async ({ data }: any) => ({ id: 'l1', ...data })),
        findMany: jest.fn(async ({ where }: any) => state.layaways.filter((l) => l.status === where.status)),
      },
      productVariant: {
        aggregate: jest.fn(async () => ({ _sum: { stock: state.stock } })),
        findMany: jest.fn(async () => [{ id: 'v1' }]),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (where.stock?.gte !== undefined && state.stock < where.stock.gte) return { count: 0 };
          state.stock -= data.stock.decrement; return { count: 1 };
        }),
        findFirst: jest.fn(async () => ({ stock: state.stock })),
      },
      order: {
        create: jest.fn(async ({ data }: any) => {
          const o = { id: `o${state.orders.length + 1}`, createdAt: new Date(), ...data };
          state.orders.push(o);
          return { ...o, items: [] };
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      payment: { create: jest.fn().mockResolvedValue({}) },
      posSession: { update: jest.fn().mockResolvedValue({}) },
    };
    return tx;
  };

  const prisma: any = {
    $transaction: jest.fn(async (cb: any) => {
      const release: Array<() => void> = [];
      try { return await cb(makeTx(release)); } finally { release.forEach((r) => r()); }
    }),
    // pre-transaction reads
    user: {
      findUnique: jest.fn(async () => ({ id: 'u1', tenantId: T, firstName: 'A', lastName: 'B', phone: '0700', email: 'a@b.c', addresses: [{ id: 'ad1' }] })),
      findFirst: jest.fn(async () => ({ id: 'u1' })),
    },
    product: { findUnique: jest.fn(async () => product) },
    productVariant: {
      findUnique: jest.fn(async () => variant),
      findMany: jest.fn(async () => [{ ...variant, stock: state.stock }]),
    },
    rentalPolicy: { findFirst: jest.fn(async () => null) },
    rentalOrder: { count: jest.fn(async () => 0) }, // pre-check outside the tx (fast-fail only)
    customerIDDocument: { findFirst: jest.fn(async () => null) },
    posSession: { findFirst: jest.fn(async () => ({ id: 's1', adminUserId: 'cashier-1', status: 'OPEN', tenantId: T, openedAt: new Date(Date.now() - 3600_000), closedAt: null })) },
  };
  // Reads made OUTSIDE a transaction (availability endpoint, booking pre-check).
  const reads = makeTx([]);
  prisma.rentalOrder.findMany = reads.rentalOrder.findMany;
  prisma.productVariant.aggregate = reads.productVariant.aggregate;
  prisma.inventoryTransaction = reads.inventoryTransaction;
  prisma.orderItem = reads.orderItem;
  prisma.layaway = reads.layaway;
  const tenant = { requireId: T } as any;
  return {
    state,
    prisma,
    rentals: new RentalsService(prisma, tenant, { log: jest.fn() } as any),
    pos: new PosService(prisma, tenant),
  };
}

// One clock read per booking: computing start and pickup separately could put
// pickup 1 ms AFTER start ("Pickup date must be on or before start date").
const booking = () => {
  const start = FUTURE(30);
  return { productId: 'p1', variantId: 'v1', startDate: start.toISOString(), returnDate: new Date(start.getTime() + 2 * 86_400_000).toISOString(), pickupDate: start.toISOString() };
};
const posSale = () => ({ items: [{ productId: 'p1', variantId: 'v1', quantity: 1, unitPrice: 950000 }], payments: [{ method: 'CASH', amount: 950000 }] });
const rental = (status: string, over: any = {}) => ({ id: 'rx', tenantId: T, productId: 'p1', rentalNumber: 'RNT-X1', status, startDate: FUTURE(10), returnDate: FUTURE(12), ...over });

async function codeOf(p: Promise<unknown>) {
  try { await p; return 'OK'; } catch (e: any) { return e instanceof ConflictException ? (e.getResponse() as any).code ?? 'CONFLICT' : `ERR:${e?.message}`; }
}

describe('which rental states block a sale', () => {
  const blocking = [...RENTAL_WORKFLOW.filter((s) => !SALE_RELEASING_RENTAL_STATUSES.includes(s)), 'PENDING_PAYMENT', 'PENDING', 'CONFIRMED'];
  it.each(blocking)('%s blocks the sale', async (status) => {
    const { pos, state } = makeDb({ rentals: [rental(status)] });
    expect(await codeOf(pos.createSale(posSale() as any, 'cashier-1'))).toBe(RESERVED_FOR_RENTAL);
    expect(state.orders).toHaveLength(0);
    expect(state.stock).toBe(1);
  });

  it('an OVERDUE gown (ACTIVE, booked return in the past) still blocks — status, not dates, decides', async () => {
    const { pos } = makeDb({ rentals: [rental('ACTIVE', { startDate: FUTURE(-10), returnDate: FUTURE(-3) })] });
    expect(await codeOf(pos.createSale(posSale() as any, 'cashier-1'))).toBe(RESERVED_FOR_RENTAL);
  });

  it.each(['RETURNED', 'INSPECTION'])('%s still blocks (gown back but not yet checked in)', async (status) => {
    const { pos } = makeDb({ rentals: [rental(status, { startDate: FUTURE(-10), returnDate: FUTURE(-3) })] });
    expect(await codeOf(pos.createSale(posSale() as any, 'cashier-1'))).toBe(RESERVED_FOR_RENTAL);
  });

  it.each(['CLOSED', 'CANCELLED'])('%s releases the gown — the sale goes through', async (status) => {
    const { pos, state } = makeDb({ rentals: [rental(status)] });
    expect(await codeOf(pos.createSale(posSale() as any, 'cashier-1'))).toBe('OK');
    expect(state.orders).toHaveLength(1);
    expect(state.stock).toBe(0);
  });

  it('a gown with no rentals at all sells normally (PURCHASE_ONLY and BOTH unchanged)', async () => {
    for (const mode of ['BOTH', 'PURCHASE_ONLY']) {
      const { pos, state } = makeDb({ mode });
      expect(await codeOf(pos.createSale(posSale() as any, 'cashier-1'))).toBe('OK');
      expect(state.orders).toHaveLength(1);
    }
  });

  it('seeded stock (10) does not make a booked gown sellable', async () => {
    const { pos } = makeDb({ stock: 10, rentals: [rental('DOWN_PAYMENT_PAID')] });
    expect(await codeOf(pos.createSale(posSale() as any, 'cashier-1'))).toBe(RESERVED_FOR_RENTAL);
  });
});

describe('every sale path is guarded', () => {
  it('POS offline replay is refused too', async () => {
    const { pos } = makeDb({ rentals: [rental('FULLY_PAID')] });
    const sale = { ...posSale(), offline: true, clientCreatedAt: new Date(Date.now() - 60_000).toISOString(), sessionId: 's1' };
    expect(await codeOf(pos.createSale(sale as any, 'cashier-1'))).toBe(RESERVED_FOR_RENTAL);
  });

  it('POS layaway create is refused', async () => {
    const { pos } = makeDb({ rentals: [rental('ID_VERIFIED')] });
    expect(await codeOf(pos.createLayaway({ customerId: 'u1', items: posSale().items, depositAmount: 0, depositMethod: 'CASH' } as any, 'cashier-1'))).toBe(RESERVED_FOR_RENTAL);
  });

  it('staff message names the rental; the customer message never does', async () => {
    const tx: any = { $executeRaw: jest.fn(), rentalOrder: { findMany: jest.fn(async () => [rental('DOWN_PAYMENT_PAID')]) } };
    let staff: any; let customer: any;
    try { await assertNotReservedForRental(tx, T, [{ id: 'p1', name: 'Ivory Gown' }], 'staff'); } catch (e: any) { staff = e.getResponse(); }
    try { await assertNotReservedForRental(tx, T, [{ id: 'p1', name: 'Ivory Gown' }], 'customer'); } catch (e: any) { customer = e.getResponse(); }
    expect(staff.message).toMatch(/RNT-X1 \(DOWN_PAYMENT_PAID/);
    expect(customer.message).toMatch(/Ivory Gown is reserved and can't be bought right now/);
    expect(JSON.stringify(customer)).not.toMatch(/RNT-|DOWN_PAYMENT_PAID|rentals/);
    expect(customer.code).toBe(RESERVED_FOR_RENTAL);
  });

  it('locks every product in sorted order with the SAME SQL the booking code uses', async () => {
    const tx: any = { $executeRaw: jest.fn(), rentalOrder: { findMany: jest.fn(async () => []) } };
    await assertNotReservedForRental(tx, T, [{ id: 'p9' }, { id: 'p2' }, { id: 'p9' }], 'staff');
    const calls = tx.$executeRaw.mock.calls.map((c: any[]) => [(c[0] as TemplateStringsArray).join('?'), c[1]]);
    expect(calls).toEqual([
      ['SELECT pg_advisory_xact_lock(hashtext(?))', 'p2'],
      ['SELECT pg_advisory_xact_lock(hashtext(?))', 'p9'],
    ]);
  });

  it('online checkout refuses a reserved gown with the neutral customer message and keeps the cart', async () => {
    const cart = [{ variantId: 'v1', productId: 'p1', quantity: 1, variant: { id: 'v1', tenantId: T, productId: 'p1', isActive: true, price: 950000, stock: 1, product: { id: 'p1', tenantId: T, name: 'Ivory Gown', isActive: true, deletedAt: null, archivedAt: null, availabilityMode: 'BOTH' } } }];
    const tx: any = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      cartItem: { findMany: jest.fn(async () => cart), deleteMany: jest.fn() },
      order: { count: jest.fn(async () => 0), create: jest.fn() },
      rentalOrder: { findMany: jest.fn(async () => [rental('READY_FOR_PICKUP')]) },
      flashSaleItem: { findMany: jest.fn(async () => []) },
    };
    const prisma: any = { $transaction: jest.fn((cb: any) => cb(tx)) };
    const tenant = { requireId: T } as any;
    const svc = new OrdersService(prisma, tenant, { log: jest.fn() } as any, new PromoCodesService(prisma, tenant));
    let err: any;
    try { await svc.create('u1', { paymentMethod: 'MOBILE_MONEY' } as any); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().message).toMatch(/reserved and can't be bought/);
    expect(JSON.stringify(err.getResponse())).not.toMatch(/RNT-/);
    expect(tx.order.create).not.toHaveBeenCalled();
    expect(tx.cartItem.deleteMany).not.toHaveBeenCalled();
  });
});

describe('booking side: a sold-out buy-or-rent gown cannot be rented', () => {
  it('BOTH with zero stock is refused', async () => {
    const { rentals } = makeDb({ stock: 0 });
    await expect(rentals.create('u1', booking() as any)).rejects.toThrow(/not available to rent/);
  });
  it('BOTH with stock left books normally', async () => {
    const { rentals, state } = makeDb({ stock: 1 });
    await rentals.create('u1', booking() as any);
    expect(state.rentals).toHaveLength(1);
  });
  it('RENTAL_ONLY ignores stock entirely (rental-only gowns need no sale stock)', async () => {
    const { rentals, state } = makeDb({ mode: 'RENTAL_ONLY', stock: 0 });
    await rentals.create('u1', booking() as any);
    expect(state.rentals).toHaveLength(1);
  });
});

describe('booking side, strengthened: no renting a gown that was sold (seeded stock is not evidence)', () => {
  const reasonOf = async (p: Promise<unknown>) => { try { await p; return 'OK'; } catch (e: any) { return e.getResponse?.().reason ?? e.message; } };

  it('sale → rental: after a POS sale, a gown with seeded stock 10 (9 left) can NOT be rented', async () => {
    const db = makeDb({ stock: 10 });
    expect(await codeOf(db.pos.createSale(posSale() as any, 'cashier-1'))).toBe('OK');
    expect(db.state.stock).toBe(9);
    expect(await reasonOf(db.rentals.create('u1', booking() as any))).toBe('SOLD_NO_VERIFIED_RESTOCK');
    expect(db.state.rentals).toHaveLength(0);
  });

  it('a recorded RESTOCK after the sale is the evidence that re-enables renting', async () => {
    const db = makeDb({ stock: 10 });
    await db.pos.createSale(posSale() as any, 'cashier-1');
    expect(await reasonOf(db.rentals.create('u1', booking() as any))).toBe('SOLD_NO_VERIFIED_RESTOCK');
    db.state.restockAt = new Date(Date.now() + 1000); // admin records a restock after the sale
    expect(await reasonOf(db.rentals.create('u1', booking() as any))).toBe('OK');
  });

  it('a sale BEFORE the last restock does not block (the restock added a gown)', async () => {
    const db = makeDb({ stock: 2, restockAt: new Date(Date.now() + 60_000) });
    db.state.orders.push({ id: 'old', status: 'DELIVERED', createdAt: new Date(), lines: [{ productId: 'p1', quantity: 1 }] });
    expect(await reasonOf(db.rentals.create('u1', booking() as any))).toBe('OK');
  });

  it.each([
    ['cancelled order', { status: 'CANCELLED', lines: [{ productId: 'p1', quantity: 1 }] }],
    ['fully refunded order', { status: 'REFUNDED', lines: [{ productId: 'p1', quantity: 1 }] }],
    ['line fully refunded (gown came back)', { status: 'DELIVERED', lines: [{ productId: 'p1', quantity: 1, refundedQuantity: 1 }] }],
  ])('%s does not block renting', async (_l, order) => {
    const db = makeDb({ stock: 5 });
    db.state.orders.push({ id: 'x', createdAt: new Date(), ...order });
    expect(await reasonOf(db.rentals.create('u1', booking() as any))).toBe('OK');
  });

  it('a partially refunded multi-unit line still blocks', async () => {
    const db = makeDb({ stock: 5 });
    db.state.orders.push({ id: 'x', status: 'DELIVERED', createdAt: new Date(), lines: [{ productId: 'p1', quantity: 2, refundedQuantity: 1 }] });
    expect(await reasonOf(db.rentals.create('u1', booking() as any))).toBe('SOLD_NO_VERIFIED_RESTOCK');
  });

  it('an online order still PENDING payment holds the gown too', async () => {
    const db = makeDb({ stock: 5 });
    db.state.orders.push({ id: 'web', status: 'PENDING', createdAt: new Date(), lines: [{ productId: 'p1', quantity: 1 }] });
    expect(await reasonOf(db.rentals.create('u1', booking() as any))).toBe('SOLD_NO_VERIFIED_RESTOCK');
  });

  it('an ACTIVE layaway holding the gown blocks renting', async () => {
    const active = makeDb({ stock: 5, layaways: [{ status: 'ACTIVE', items: [{ productId: 'p1', variantId: 'v1', quantity: 1 }] }] });
    expect(await reasonOf(active.rentals.create('u1', booking() as any))).toBe('ON_LAYAWAY');
  }, 20_000);

  it('a CANCELLED layaway does not block renting', async () => {
    const cancelled = makeDb({ stock: 5, layaways: [{ status: 'CANCELLED', items: [{ productId: 'p1', variantId: 'v1', quantity: 1 }] }] });
    expect(await reasonOf(cancelled.rentals.create('u1', booking() as any))).toBe('OK');
  }, 20_000);

  it('a layaway item mislabelled with another productId is still matched by variant', async () => {
    const db = makeDb({ stock: 5, layaways: [{ status: 'ACTIVE', items: [{ productId: 'pX', variantId: 'v1', quantity: 1 }] }] });
    expect(await reasonOf(db.rentals.create('u1', booking() as any))).toBe('ON_LAYAWAY');
  });

  it('offline POS sale, once synced, counts as a sale (booking refused afterwards)', async () => {
    const db = makeDb({ stock: 10 });
    const offline = { ...posSale(), offline: true, clientCreatedAt: new Date(Date.now() - 60_000).toISOString(), sessionId: 's1' };
    expect(await codeOf(db.pos.createSale(offline as any, 'cashier-1'))).toBe('OK');
    expect(await reasonOf(db.rentals.create('u1', booking() as any))).toBe('SOLD_NO_VERIFIED_RESTOCK');
  });

  it('exchange replacement lines (a new order) count as a sale', async () => {
    const db = makeDb({ stock: 5 });
    db.state.orders.push({ id: 'exch', status: 'DELIVERED', createdAt: new Date(), lines: [{ productId: 'p1', quantity: 1 }] });
    expect(await reasonOf(db.rentals.create('u1', booking() as any))).toBe('SOLD_NO_VERIFIED_RESTOCK');
  });

  it('the customer only ever sees the neutral message', async () => {
    const db = makeDb({ stock: 10 });
    await db.pos.createSale(posSale() as any, 'cashier-1');
    let err: any;
    try { await db.rentals.create('u1', booking() as any); } catch (e) { err = e; }
    expect(err.getResponse().message).toBe('This item is not available to rent.');
    expect(err.getResponse().code).toBe('NOT_AVAILABLE_FOR_RENTAL');
  });

  it('never writes stock or data while checking', async () => {
    const db = makeDb({ stock: 10 });
    await db.pos.createSale(posSale() as any, 'cashier-1');
    const before = db.state.stock;
    await reasonOf(db.rentals.create('u1', booking() as any));
    expect(db.state.stock).toBe(before);
  });
});

describe('concurrency with SEEDED stock (10): simultaneous purchase and rental never both succeed', () => {
  it('booking first → booking wins, sale refused', async () => {
    const db = makeDb({ stock: 10 });
    const b = db.rentals.create('u1', booking() as any);
    await new Promise((r) => setTimeout(r, 0));
    const s = db.pos.createSale(posSale() as any, 'cashier-1');
    expect(await Promise.all([codeOf(b), codeOf(s)])).toEqual(['OK', RESERVED_FOR_RENTAL]);
    expect(db.state.waits).toBeGreaterThan(0);
  });
  it('sale first → sale wins, booking refused although 9 remain in stock', async () => {
    const db = makeDb({ stock: 10 });
    const s = db.pos.createSale(posSale() as any, 'cashier-1');
    await new Promise((r) => setTimeout(r, 0));
    const b = db.rentals.create('u1', booking() as any);
    const [rs, rb] = await Promise.all([codeOf(s), codeOf(b)]);
    expect(rs).toBe('OK');
    expect(rb).toBe('NOT_AVAILABLE_FOR_RENTAL');
    expect(db.state.rentals).toHaveLength(0);
    expect(db.state.waits).toBeGreaterThan(0);
  });
});

describe('concurrency: a booking and a sale of the same one-stock gown never both succeed', () => {
  it('booking reaches the lock first → booking wins, sale refused', async () => {
    const db = makeDb({ stock: 1 });
    const b = db.rentals.create('u1', booking() as any);
    await new Promise((r) => setTimeout(r, 0));
    const s = db.pos.createSale(posSale() as any, 'cashier-1');
    const [rb, rs] = await Promise.all([codeOf(b), codeOf(s)]);
    expect([rb, rs]).toEqual(['OK', RESERVED_FOR_RENTAL]);
    expect(db.state.waits).toBeGreaterThan(0); // the sale really queued behind the booking's lock
    expect(db.state.rentals).toHaveLength(1);
    expect(db.state.orders).toHaveLength(0);
  });

  it('sale reaches the lock first → sale wins, booking refused (gown sold)', async () => {
    const db = makeDb({ stock: 1 });
    const s = db.pos.createSale(posSale() as any, 'cashier-1');
    await new Promise((r) => setTimeout(r, 0));
    const b = db.rentals.create('u1', booking() as any);
    const [rs, rb] = await Promise.all([codeOf(s), codeOf(b)]);
    expect(rs).toBe('OK');
    expect(rb).toBe('NOT_AVAILABLE_FOR_RENTAL');
    expect(db.state.waits).toBeGreaterThan(0); // the booking really queued behind the sale's lock
    expect(db.state.orders).toHaveLength(1);
    expect(db.state.rentals).toHaveLength(0);
  });

  it('both paths used the same lock key for the product', async () => {
    const db = makeDb({ stock: 1 });
    await Promise.all([codeOf(db.rentals.create('u1', booking() as any)), codeOf(db.pos.createSale(posSale() as any, 'cashier-1'))]);
    expect(new Set(db.state.sqlKeys)).toEqual(new Set(['SELECT pg_advisory_xact_lock(hashtext(?))|p1']));
  });
});
