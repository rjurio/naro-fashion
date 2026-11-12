import { BadRequestException, ConflictException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { join } from 'path';
import { RentalsService } from './rentals.service';
import { InventoryService } from '../inventory/inventory.service';
import { AdjustStockDto } from '../inventory/dto/adjust-stock.dto';
import { findRentalAvailabilityBlock } from './rental-availability';

/**
 * Release 1 (P0a + P0b): availability and booking share ONE rule.
 *
 * For every scenario below, the availability endpoint's answer must equal
 * the outcome of an actual booking for the same dates, and the booking must
 * re-check under the per-product advisory lock instead of trusting the
 * pre-check. Seeded stock is never rental capacity.
 */

const T = 't1';
const DAY = 86_400_000;
const at = (d: number) => new Date(Date.now() + d * DAY);

interface Line { productId: string; quantity: number; refundedQuantity?: number }
interface FakeOpts {
  mode?: string;
  stock?: number;
  isActive?: boolean;
  deletedAt?: Date | null;
  bufferDays?: number;
  /** Override product fields (e.g. a bouquet configured like production). */
  product?: Record<string, any>;
}

function makeDb(opts: FakeOpts = {}) {
  const state = {
    product: {
      id: 'p1', tenantId: T, name: 'Ivory Gown', availabilityMode: opts.mode ?? 'BOTH',
      isActive: opts.isActive ?? true, deletedAt: opts.deletedAt ?? null, archivedAt: null,
      rentalPricePerDay: 140000, rentalDepositAmount: 350000, rentalDownPaymentPct: 25,
      bufferDaysOverride: opts.bufferDays ?? null, purchasePrice: 100,
      ...(opts.product ?? {}),
    } as any,
    otherProduct: { id: 'p2', tenantId: T, name: 'Other', availabilityMode: 'PURCHASE_ONLY', isActive: true, deletedAt: null, purchasePrice: 0 } as any,
    stock: opts.stock ?? 1,
    rentals: [] as any[],
    orders: [] as Array<{ status: string; createdAt: Date; lines: Line[] }>,
    txns: [] as Array<{ type: string; productId: string; quantityChange: number; createdAt: Date; note?: string | null; performedBy?: string | null }>,
    layaways: [] as Array<{ status: string; items: any[] }>,
    writes: 0,
    onFirstLock: null as null | (() => void),
  };
  const variant = { id: 'v1', tenantId: T, productId: 'p1', name: 'Default', isActive: true, get stock() { return state.stock; } };
  const otherVariant = { id: 'v2', tenantId: T, productId: 'p2', name: 'Other', isActive: true, stock: 3 };

  const statusOk = (r: any, where: any) =>
    (!where.status?.notIn || !where.status.notIn.includes(r.status)) && (!where.status?.in || where.status.in.includes(r.status));

  const reads: any = {
    rentalOrder: {
      findMany: jest.fn(async ({ where }: any) =>
        state.rentals
          .filter((r) => r.tenantId === where.tenantId)
          .filter((r) => (typeof where.productId === 'string' ? r.productId === where.productId : !where.productId || where.productId.in.includes(r.productId)))
          .filter((r) => !where.id?.not || r.id !== where.id.not)
          .filter((r) => statusOk(r, where))
          .map((r) => ({ ...r }))),
    },
    productVariant: {
      aggregate: jest.fn(async () => ({ _sum: { stock: state.stock } })),
      findMany: jest.fn(async () => [{ id: 'v1' }]),
      findUnique: jest.fn(async ({ where }: any) => (where.id === 'v1' ? variant : where.id === 'v2' ? otherVariant : null)),
      findFirst: jest.fn(async ({ where }: any) => (where.id === 'v1' ? { ...variant, stock: state.stock } : where.id === 'v2' ? otherVariant : null)),
    },
    inventoryTransaction: {
      findFirst: jest.fn(async ({ where }: any) => {
        const rows = state.txns
          .filter((t) => t.productId === where.productId && t.type === where.type && t.quantityChange > (where.quantityChange?.gt ?? -Infinity))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return rows[0] ? { createdAt: rows[0].createdAt } : null;
      }),
    },
    orderItem: {
      findMany: jest.fn(async ({ where }: any) =>
        state.orders
          .filter((o) => !where.order.status.notIn.includes(o.status))
          .filter((o) => !where.order.createdAt || o.createdAt > where.order.createdAt.gt)
          .flatMap((o) => o.lines.filter((l) => l.productId === where.productId))
          .map((l) => ({ quantity: l.quantity, refundedQuantity: l.refundedQuantity ?? 0 }))),
    },
    layaway: { findMany: jest.fn(async ({ where }: any) => state.layaways.filter((l) => l.status === where.status)) },
  };

  const held = new Map<string, Promise<void>>();
  let locks = 0;
  const makeTx = (release: Array<() => void>) => ({
    ...reads,
    $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...vals: any[]) => {
      if (!/pg_advisory_xact_lock\(hashtext\(/.test(strings.join('?'))) return 1;
      const key = String(vals[0]);
      while (held.has(key)) await held.get(key);
      let done!: () => void;
      held.set(key, new Promise<void>((r) => (done = r)));
      release.push(() => { held.delete(key); done(); });
      locks += 1;
      if (locks === 1 && state.onFirstLock) state.onFirstLock();
      await new Promise((r) => setTimeout(r, 10));
      return 1;
    }),
    rentalOrder: {
      ...reads.rentalOrder,
      create: jest.fn(async ({ data }: any) => {
        state.writes += 1;
        const r = { id: `r${state.rentals.length + 1}`, ...data };
        state.rentals.push(r);
        return r;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        state.writes += 1;
        const r = state.rentals.find((x) => x.id === where.id);
        Object.assign(r, data);
        return r;
      }),
    },
    productVariant: {
      ...reads.productVariant,
      update: jest.fn(async ({ where, data }: any) => {
        state.writes += 1;
        if (where.id === 'v1') state.stock += data.stock.increment;
        else otherVariant.stock += data.stock.increment;
        return {};
      }),
    },
    product: { update: jest.fn(async () => ({})) },
    inventoryTransaction: {
      ...reads.inventoryTransaction,
      create: jest.fn(async ({ data }: any) => {
        state.writes += 1;
        const row = { ...data, createdAt: new Date() };
        state.txns.push(row);
        return { id: `it${state.txns.length}`, ...row };
      }),
    },
  });

  const prisma: any = {
    ...reads,
    $transaction: jest.fn(async (cb: any) => {
      const release: Array<() => void> = [];
      try { return await cb(makeTx(release)); } finally { release.forEach((r) => r()); }
    }),
    user: { findUnique: jest.fn(async () => ({ id: 'u1', tenantId: T, firstName: 'A', lastName: 'B', phone: '0700', email: 'a@b.c', addresses: [{ id: 'ad1' }] })) },
    product: {
      findUnique: jest.fn(async () => state.product),
      findFirst: jest.fn(async ({ where }: any) => (where.id === 'p1' ? state.product : where.id === 'p2' ? state.otherProduct : null)),
    },
    rentalPolicy: { findFirst: jest.fn(async () => null) },
    customerIDDocument: { findFirst: jest.fn(async () => null) },
  };
  prisma.rentalOrder = { ...reads.rentalOrder, findFirst: jest.fn(async ({ where }: any) => state.rentals.find((r) => r.id === where.id) ?? null) };

  const audit = { log: jest.fn(async () => undefined) };
  const tenant = { requireId: T } as any;
  return {
    state,
    prisma,
    audit,
    rentals: new RentalsService(prisma, tenant, audit as any),
    inventory: new InventoryService(prisma, tenant, audit as any),
    addRental: (r: Partial<any>) => state.rentals.push({ id: `x${state.rentals.length + 1}`, tenantId: T, productId: 'p1', actualReturnDate: null, ...r }),
    sell: (when = new Date(), status = 'DELIVERED', lines: Line[] = [{ productId: 'p1', quantity: 1 }]) => {
      state.orders.push({ status, createdAt: when, lines });
      state.stock -= lines.reduce((s, l) => s + (l.productId === 'p1' ? l.quantity : 0), 0);
    },
    restock: (when = new Date(), qty = 1) => { state.txns.push({ type: 'RESTOCK', productId: 'p1', quantityChange: qty, createdAt: when }); state.stock += qty; },
  };
}

type Db = ReturnType<typeof makeDb>;

/** A booking from day `s` for `len` days. */
const bookingFor = (s: number, len = 2) => {
  const start = at(s);
  return { productId: 'p1', variantId: 'v1', startDate: start.toISOString(), returnDate: new Date(start.getTime() + len * DAY).toISOString(), pickupDate: start.toISOString() };
};

async function bookingOutcome(db: Db, s: number, len = 2): Promise<string> {
  try {
    await db.rentals.create('u1', bookingFor(s, len) as any);
    return 'BOOKED';
  } catch (e: any) {
    const body = e.getResponse?.();
    return (typeof body === 'object' && (body.reason || body.code)) || e.constructor.name;
  }
}
async function advertised(db: Db, s: number, len = 2): Promise<boolean> {
  const b = bookingFor(s, len);
  const r = await db.rentals.getAvailability('p1', new Date(b.startDate), new Date(b.returnDate));
  return r.available;
}

// ---------------------------------------------------------------------------
// 1. The scenario table: availability === booking outcome, every time.
// ---------------------------------------------------------------------------
type Scenario = [string, FakeOpts, (db: Db) => void, boolean, string];
const scenarios: Scenario[] = [
  ['RENTAL_ONLY gown, no rentals', { mode: 'RENTAL_ONLY', stock: 0 }, () => {}, true, 'BOOKED'],
  ['BOTH gown, never sold, 1 in stock', {}, () => {}, true, 'BOOKED'],
  ['BOTH gown, seeded stock 10, never sold (one gown, still free)', { stock: 10 }, () => {}, true, 'BOOKED'],
  ['BOTH gown SOLD at the POS, seeded stock 10 → 9 left, no restock', { stock: 10 }, (db) => db.sell(), false, 'SOLD_NO_VERIFIED_RESTOCK'],
  ['BOTH gown sold online and still PENDING payment', { stock: 10 }, (db) => db.sell(new Date(), 'PENDING'), false, 'SOLD_NO_VERIFIED_RESTOCK'],
  ['BOTH gown sold, then a recorded RESTOCK', { stock: 10 }, (db) => { db.sell(at(-3)); db.restock(at(-1)); }, true, 'BOOKED'],
  ['BOTH gown restocked, then sold again', { stock: 10 }, (db) => { db.restock(at(-3)); db.sell(at(-1)); }, false, 'SOLD_SINCE_LAST_RESTOCK'],
  ['BOTH gown sold but the order was CANCELLED', { stock: 1 }, (db) => { db.sell(new Date(), 'CANCELLED'); db.state.stock = 1; }, true, 'BOOKED'],
  ['BOTH gown sold and the line fully refunded', { stock: 1 }, (db) => { db.sell(new Date(), 'DELIVERED', [{ productId: 'p1', quantity: 1, refundedQuantity: 1 }]); db.state.stock = 1; }, true, 'BOOKED'],
  ['BOTH gown with 0 stock', { stock: 0 }, () => {}, false, 'SOLD_OUT'],
  ['BOTH gown on an ACTIVE layaway', { stock: 1 }, (db) => db.state.layaways.push({ status: 'ACTIVE', items: [{ variantId: 'v1' }] }), false, 'ON_LAYAWAY'],
  ['BOTH gown whose layaway was completed (hand-over order recorded)', { stock: 1 }, (db) => { db.state.layaways.push({ status: 'COMPLETED', items: [{ variantId: 'v1' }] }); db.sell(); db.state.stock = 1; }, false, 'SOLD_NO_VERIFIED_RESTOCK'],
  ['BOTH gown with a CANCELLED layaway', { stock: 1 }, (db) => db.state.layaways.push({ status: 'CANCELLED', items: [{ variantId: 'v1' }] }), true, 'BOOKED'],
  ['BOTH gown: stock raised by a product edit after the sale (no restock event)', { stock: 1 }, (db) => { db.sell(); db.state.stock = 10; }, false, 'SOLD_NO_VERIFIED_RESTOCK'],
  ['BOTH gown: a positive ADJUSTMENT after the sale is not a restock', { stock: 1 }, (db) => { db.sell(at(-2)); db.state.txns.push({ type: 'ADJUSTMENT', productId: 'p1', quantityChange: 1, createdAt: at(-1) }); db.state.stock = 1; }, false, 'SOLD_NO_VERIFIED_RESTOCK'],
  ['PURCHASE_ONLY product', { mode: 'PURCHASE_ONLY', stock: 5 }, () => {}, false, 'BadRequestException'],
  ['archived (inactive) gown', { mode: 'RENTAL_ONLY', isActive: false }, () => {}, false, 'BadRequestException'],
  ['deleted gown', { mode: 'RENTAL_ONLY', deletedAt: new Date() }, () => {}, false, 'BadRequestException'],
  ['another booking (DOWN_PAYMENT_PAID) overlapping the dates', { mode: 'RENTAL_ONLY' }, (db) => db.addRental({ status: 'DOWN_PAYMENT_PAID', startDate: at(29), returnDate: at(31) }), false, 'DATES_TAKEN'],
  ['another booking within the 7-day buffer', { mode: 'RENTAL_ONLY' }, (db) => db.addRental({ status: 'FULLY_PAID', startDate: at(20), returnDate: at(25) }), false, 'DATES_TAKEN'],
  ['another booking just outside the buffer', { mode: 'RENTAL_ONLY' }, (db) => db.addRental({ status: 'FULLY_PAID', startDate: at(10), returnDate: at(22) }), true, 'BOOKED'],
  ['an unpaid hold (PENDING_ID_VERIFICATION) on the dates', { mode: 'RENTAL_ONLY' }, (db) => db.addRental({ status: 'PENDING_ID_VERIFICATION', startDate: at(30), returnDate: at(32) }), false, 'DATES_TAKEN'],
  ['a CANCELLED booking on the dates', { mode: 'RENTAL_ONLY' }, (db) => db.addRental({ status: 'CANCELLED', startDate: at(30), returnDate: at(32) }), true, 'BOOKED'],
  ['a REJECTED request on the dates', { mode: 'RENTAL_ONLY' }, (db) => db.addRental({ status: 'REJECTED', startDate: at(30), returnDate: at(32) }), true, 'BOOKED'],
  ['a CLOSED rental on the dates (returned and inspected)', { mode: 'RENTAL_ONLY' }, (db) => db.addRental({ status: 'CLOSED', startDate: at(30), returnDate: at(32) }), true, 'BOOKED'],
  ['an ACTIVE rental out with a customer, not yet due, far from the dates', { mode: 'RENTAL_ONLY' }, (db) => db.addRental({ status: 'ACTIVE', startDate: at(-1), returnDate: at(2) }), true, 'BOOKED'],
  ['an OVERDUE rental (ACTIVE, booked return in the past) blocks even far-future dates', { mode: 'RENTAL_ONLY' }, (db) => db.addRental({ status: 'ACTIVE', startDate: at(-10), returnDate: at(-2) }), false, 'OVERDUE_RETURN'],
  ['an overdue ITEM_DISPATCHED rental', { mode: 'RENTAL_ONLY' }, (db) => db.addRental({ status: 'ITEM_DISPATCHED', startDate: at(-10), returnDate: at(-1) }), false, 'OVERDUE_RETURN'],
  ['a legacy OVERDUE status', { mode: 'RENTAL_ONLY' }, (db) => db.addRental({ status: 'OVERDUE', startDate: at(-10), returnDate: at(-1) }), false, 'OVERDUE_RETURN'],
  ['a RETURNED rental (not yet inspected) still holds its window', { mode: 'RENTAL_ONLY' }, (db) => db.addRental({ status: 'RETURNED', startDate: at(25), returnDate: at(28), actualReturnDate: at(28) }), false, 'DATES_TAKEN'],
  ['a RETURNED rental, measured to its LATE actual return', { mode: 'RENTAL_ONLY' }, (db) => db.addRental({ status: 'RETURNED', startDate: at(-12), returnDate: at(-10), actualReturnDate: at(25) }), false, 'DATES_TAKEN'],
  ['an INSPECTION rental overlapping', { mode: 'RENTAL_ONLY' }, (db) => db.addRental({ status: 'INSPECTION', startDate: at(26), returnDate: at(28) }), false, 'DATES_TAKEN'],
];

describe('availability endpoint and booking give the same answer', () => {
  it.each(scenarios)('%s', async (_name, opts, setup, wantAvailable, wantOutcome) => {
    const db = makeDb(opts);
    setup(db);
    const shown = await advertised(db, 30);
    const outcome = await bookingOutcome(db, 30);
    expect(shown).toBe(wantAvailable);
    expect(outcome).toBe(wantOutcome);
    expect(shown).toBe(outcome === 'BOOKED'); // the consistency property itself
  });

  it('the availability check is read-only (no writes in any scenario)', async () => {
    for (const [, opts, setup] of scenarios) {
      const db = makeDb(opts);
      setup(db);
      const before = JSON.stringify({ r: db.state.rentals, s: db.state.stock, t: db.state.txns.length });
      await advertised(db, 30);
      expect(JSON.stringify({ r: db.state.rentals, s: db.state.stock, t: db.state.txns.length })).toBe(before);
      expect(db.state.writes).toBe(0);
    }
  });

  it('the response shape is unchanged (no reason or other customers’ details are exposed)', async () => {
    const db = makeDb({ stock: 10 });
    db.sell();
    const b = bookingFor(30);
    const r = await db.rentals.getAvailability('p1', new Date(b.startDate), new Date(b.returnDate));
    expect(Object.keys(r).sort()).toEqual(['available', 'bufferDays', 'endDate', 'productId', 'startDate']);
  });

  it('rejects invalid or reversed dates with 400 instead of guessing', async () => {
    const db = makeDb();
    await expect(db.rentals.getAvailability('p1', new Date('nope'), at(3))).rejects.toBeInstanceOf(BadRequestException);
    await expect(db.rentals.getAvailability('p1', at(5), at(3))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('the customer refusal never names another booking', async () => {
    const db = makeDb({ mode: 'RENTAL_ONLY' });
    db.addRental({ status: 'FULLY_PAID', startDate: at(29), returnDate: at(31), rentalNumber: 'RNT-SECRET' });
    const err: any = await db.rentals.create('u1', bookingFor(30) as any).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(JSON.stringify(err.getResponse())).not.toContain('RNT-SECRET');
    expect(err.getResponse().message).toBe('Product is not available for the selected dates');
  });
});

// ---------------------------------------------------------------------------
// 2. The booking re-validates under the lock; it never trusts the pre-check.
// ---------------------------------------------------------------------------
describe('final booking validates again under the product lock', () => {
  it('a sale committed after the pre-check but before the lock → booking refused', async () => {
    const db = makeDb({ stock: 10 });
    db.state.onFirstLock = () => db.sell(); // lands between the pre-check and the locked check
    expect(await bookingOutcome(db, 30)).toBe('SOLD_NO_VERIFIED_RESTOCK');
    expect(db.state.rentals).toHaveLength(0);
  });

  it('a booking committed after the pre-check → second booking refused', async () => {
    const db = makeDb({ mode: 'RENTAL_ONLY' });
    db.state.onFirstLock = () => db.addRental({ status: 'DOWN_PAYMENT_PAID', startDate: at(30), returnDate: at(32) });
    expect(await bookingOutcome(db, 30)).toBe('DATES_TAKEN');
  });

  it('a layaway opened after the pre-check → booking refused', async () => {
    const db = makeDb({ stock: 1 });
    db.state.onFirstLock = () => db.state.layaways.push({ status: 'ACTIVE', items: [{ variantId: 'v1' }] });
    expect(await bookingOutcome(db, 30)).toBe('ON_LAYAWAY');
  });

  it('the locked check reads through the TRANSACTION client, after the lock', async () => {
    const db = makeDb({ mode: 'RENTAL_ONLY' });
    const order: string[] = [];
    const origTx = db.prisma.$transaction;
    db.prisma.$transaction = jest.fn(async (cb: any) =>
      origTx(async (tx: any) => {
        const exec = tx.$executeRaw;
        tx.$executeRaw = jest.fn(async (...a: any[]) => { order.push('lock'); return exec(...a); });
        const fm = tx.rentalOrder.findMany;
        tx.rentalOrder.findMany = jest.fn(async (...a: any[]) => { order.push('check'); return fm(...a); });
        const cr = tx.rentalOrder.create;
        tx.rentalOrder.create = jest.fn(async (...a: any[]) => { order.push('insert'); return cr(...a); });
        return cb(tx);
      }));
    await db.rentals.create('u1', bookingFor(30) as any);
    expect(order).toEqual(['lock', 'check', 'insert']);
  });

  it('two simultaneous bookings for the same dates: exactly one succeeds, even with seeded stock 10', async () => {
    const db = makeDb({ stock: 10 });
    const results = await Promise.allSettled([db.rentals.create('u1', bookingFor(30) as any), db.rentals.create('u1', bookingFor(30) as any)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(db.state.rentals).toHaveLength(1);
  });

  it('seeded stock 10 is not 10 rental gowns: an overlapping second booking is refused afterwards too', async () => {
    const db = makeDb({ stock: 10 });
    expect(await bookingOutcome(db, 30)).toBe('BOOKED');
    expect(await advertised(db, 31)).toBe(false);
    expect(await bookingOutcome(db, 31)).toBe('DATES_TAKEN');
    expect(await advertised(db, 60)).toBe(true); // a later, non-overlapping window is still fine
    expect(await bookingOutcome(db, 60)).toBe('BOOKED');
  });
});

// ---------------------------------------------------------------------------
// 3. Rescheduling an existing booking (admin) uses the same window rule.
// ---------------------------------------------------------------------------
describe('admin date changes use the same window rule', () => {
  it('cannot extend over a RETURNED (not yet inspected) rental window', async () => {
    const db = makeDb({ mode: 'RENTAL_ONLY' });
    db.addRental({ id: 'mine', status: 'FULLY_PAID', startDate: at(10), returnDate: at(12), pickupDate: at(9) });
    db.addRental({ status: 'RETURNED', startDate: at(20), returnDate: at(22), actualReturnDate: at(22) });
    await expect(db.rentals.update('mine', { returnDate: at(16).toISOString() } as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('another rental being overdue does not stop an admin moving an existing booking', async () => {
    const db = makeDb({ mode: 'RENTAL_ONLY' });
    db.addRental({ id: 'mine', status: 'FULLY_PAID', startDate: at(40), returnDate: at(42), pickupDate: at(39) });
    db.addRental({ status: 'ACTIVE', startDate: at(-10), returnDate: at(-2) });
    await expect(db.rentals.update('mine', { returnDate: at(43).toISOString() } as any)).resolves.toBeDefined();
  });

  it('a booking never blocks itself', async () => {
    const block = await findRentalAvailabilityBlock(
      { rentalOrder: { findMany: jest.fn(async ({ where }: any) => (where.id?.not === 'r1' ? [] : [{ id: 'r1', status: 'FULLY_PAID', startDate: at(1), returnDate: at(3) }])) } },
      { tenantId: T, product: { id: 'p1', availabilityMode: 'RENTAL_ONLY' }, startDate: at(1), returnDate: at(4), bufferDays: 7, excludeRentalId: 'r1', scope: 'reschedule' },
    );
    expect(block).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Restocks: only a legitimate, audited RESTOCK clears a sold gown.
// ---------------------------------------------------------------------------
describe('inventory adjustments cannot quietly clear a rental restriction', () => {
  it('a RESTOCK through InventoryService (with a reason) makes the sold gown rentable, and is audited', async () => {
    const db = makeDb({ stock: 10 });
    db.sell(at(-1));
    expect(await advertised(db, 30)).toBe(false);
    await db.inventory.adjustStock({ productId: 'p1', variantId: 'v1', type: 'RESTOCK', quantity: 1, note: 'Second gown from supplier, invoice 42' } as any, 'admin-7');
    const row = db.state.txns.find((t) => t.type === 'RESTOCK')!;
    expect(row.performedBy).toBe('admin-7');
    expect(row.note).toContain('invoice 42');
    expect(db.audit.log).toHaveBeenCalledWith('ADJUST_STOCK', 'Inventory', 'p1', expect.objectContaining({ type: 'RESTOCK', quantity: 1, variantId: 'v1', note: expect.stringContaining('invoice 42') }));
    expect(await advertised(db, 30)).toBe(true);
    expect(await bookingOutcome(db, 30)).toBe('BOOKED');
  });

  it('a RESTOCK of a buy-or-rent gown without a reason is refused and writes nothing', async () => {
    const db = makeDb({ stock: 10 });
    db.sell(at(-1));
    for (const note of [undefined, '', '   ', 'ok']) {
      const err: any = await db.inventory.adjustStock({ productId: 'p1', variantId: 'v1', type: 'RESTOCK', quantity: 1, note } as any, 'admin-7').catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse().code).toBe('RESTOCK_REASON_REQUIRED');
    }
    expect(db.state.writes).toBe(0);
    expect(await advertised(db, 30)).toBe(false);
  });

  it('a variant of ANOTHER product can not be used to file a restock under this gown', async () => {
    const db = makeDb({ stock: 10 });
    db.sell(at(-1));
    const err = await db.inventory.adjustStock({ productId: 'p1', variantId: 'v2', type: 'RESTOCK', quantity: 1, note: 'Second gown from supplier' } as any, 'admin-7').catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(db.state.writes).toBe(0);
    expect(await advertised(db, 30)).toBe(false);
  });

  it('ADJUSTMENT (+) and DAMAGE never re-enable renting', async () => {
    const db = makeDb({ stock: 10 });
    db.sell(at(-1));
    await db.inventory.adjustStock({ productId: 'p1', variantId: 'v1', type: 'ADJUSTMENT', quantity: 3 } as any, 'admin-7');
    await db.inventory.adjustStock({ productId: 'p1', variantId: 'v1', type: 'DAMAGE', quantity: 1 } as any, 'admin-7');
    expect(await advertised(db, 30)).toBe(false);
    expect(await bookingOutcome(db, 30)).toBe('SOLD_NO_VERIFIED_RESTOCK');
  });

  it('only the three manual types are accepted by the API (SALE / RENTAL_OUT / typos are rejected)', async () => {
    for (const [type, ok] of [['RESTOCK', true], ['ADJUSTMENT', true], ['DAMAGE', true], ['SALE', false], ['RENTAL_OUT', false], ['restock', false], ['RETURN', false]] as const) {
      const errors = await validate(plainToInstance(AdjustStockDto, { productId: 'p1', type, quantity: 1 }));
      expect(errors.length === 0).toBe(ok);
    }
  });

  it('PURCHASE_ONLY and RENTAL_ONLY restocks keep working without a note (normal behaviour)', async () => {
    for (const mode of ['PURCHASE_ONLY', 'RENTAL_ONLY']) {
      const db = makeDb({ mode, stock: 2 });
      await expect(db.inventory.adjustStock({ productId: 'p1', variantId: 'v1', type: 'RESTOCK', quantity: 2 } as any, 'admin-7')).resolves.toBeDefined();
      expect(db.state.stock).toBe(4);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Offline till: buy-or-rent gowns are not sold offline.
// ---------------------------------------------------------------------------
describe('offline POS (admin helper)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ui = require(join(__dirname, '..', '..', '..', 'admin', 'lib', 'pos-sale-eligibility'));

  it.each([
    ['PURCHASE_ONLY', false, null],
    ['BOTH', false, null],
    ['RENTAL_ONLY', false, 'RENTAL_ONLY'],
    [undefined, false, null],
    ['PURCHASE_ONLY', true, null],
    ['BOTH', true, 'NEEDS_ONLINE'],
    ['RENTAL_ONLY', true, 'RENTAL_ONLY'],
    [undefined, true, 'NEEDS_ONLINE'], // old snapshot without the mode: unknown → conservative
  ])('mode %s, offline=%s → %s', (mode, offline, want) => {
    expect(ui.posSaleBlock(mode, offline)).toBe(want);
  });

  it('checkout offline refuses the buy-or-rent lines and keeps purchase-only ones', () => {
    const cart = [
      { productName: 'Veil', availabilityMode: 'PURCHASE_ONLY' },
      { productName: 'Ivory Gown', availabilityMode: 'BOTH' },
      { productName: 'Recalled line', availabilityMode: undefined },
    ];
    expect(ui.offlineBlockedItems(cart).map((i: any) => i.productName)).toEqual(['Ivory Gown', 'Recalled line']);
  });

  it('the POS page enforces it at "Complete sale" and the search/scan show why', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('fs');
    const admin = join(__dirname, '..', '..', '..', 'admin', 'app', 'dashboard', 'pos');
    const page = readFileSync(join(admin, 'page.tsx'), 'utf8');
    expect(page).toMatch(/const needOnline = offline \? offlineBlockedItems\(cartItems\) : \[\];/);
    const search = readFileSync(join(admin, 'components', 'ProductSearch.tsx'), 'utf8');
    expect(search).toMatch(/availabilityMode: product\.availabilityMode,/);
    expect(search).toMatch(/type: 'needsOnline'/);
  });
});

// ---------------------------------------------------------------------------
// 6. Not every rentable product is a gown (owner decision 2026-11-11: the
//    bridal bouquet stays buy-or-rent). Rules key on availabilityMode, never
//    on the category, and every message is item-neutral.
// ---------------------------------------------------------------------------
describe('non-gown rentable items (the bridal bouquet)', () => {
  // Mirrors the production row read on 2026-11-11 (Flowers, BOTH, stock 11).
  const bouquet = {
    name: 'Orange Rose & White Hydrangea Bridal Bouquet', categoryName: 'Flowers',
    basePrice: 500, rentalPricePerDay: 250, rentalDepositAmount: 50, rentalDownPaymentPct: 25,
    minRentalDays: 1, maxRentalDays: 7,
  };
  const make = (extra: FakeOpts = {}) => makeDb({ mode: 'BOTH', stock: 11, bufferDays: 2, product: bouquet, ...extra });

  it('is rentable and books with its own price, deposit and down payment', async () => {
    const db = make();
    expect(await advertised(db, 30)).toBe(true);
    await db.rentals.create('u1', bookingFor(30) as any);
    const r = db.state.rentals[0];
    expect(Number(r.totalRentalPrice)).toBe(250);
    expect(Number(r.damageDeposit)).toBe(50);
    expect(Number(r.downPaymentAmount)).toBe(63); // 62.50 rounded up to a whole shilling (down-payment.ts)
  });

  it('uses its own 2-day buffer (not the 7-day gown default)', async () => {
    const db = make();
    db.addRental({ status: 'FULLY_PAID', startDate: at(25), returnDate: at(27) });
    expect(await advertised(db, 28, 2)).toBe(false);
    expect(await bookingOutcome(db, 28, 2)).toBe('DATES_TAKEN'); // 1 day after: inside the 2-day buffer
    expect(await advertised(db, 30, 2)).toBe(true);
    expect(await bookingOutcome(db, 30, 2)).toBe('BOOKED'); // 3 days after: outside the buffer
  });

  it('seeded stock 11 is still one rentable unit, and a sale blocks renting until a recorded restock', async () => {
    const db = make();
    db.sell(at(-1));
    expect(await advertised(db, 30)).toBe(false);
    expect(await bookingOutcome(db, 30)).toBe('SOLD_NO_VERIFIED_RESTOCK');
  });

  it('the customer refusal never calls it a gown', async () => {
    const db = make();
    db.sell(at(-1));
    const err: any = await db.rentals.create('u1', bookingFor(30) as any).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(JSON.stringify(err.getResponse())).not.toMatch(/gown/i);
    expect(err.getResponse().message).toBe('This item is not available to rent.');
  });

  it('a restock without a note is refused with item-neutral wording', async () => {
    const db = make();
    const err: any = await db.inventory.adjustStock({ productId: 'p1', variantId: 'v1', type: 'RESTOCK', quantity: 1 } as any, 'admin-7').catch((e) => e);
    expect(err.getResponse().code).toBe('RESTOCK_REASON_REQUIRED');
    expect(err.getResponse().message).not.toMatch(/gown/i);
  });

  it('staff-facing POS and inventory wording is item-neutral', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('fs');
    const admin = join(__dirname, '..', '..', '..', 'admin');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ui = require(join(admin, 'lib', 'pos-sale-eligibility'));
    expect(ui.POS_SALE_BLOCK_LABEL.NEEDS_ONLINE).not.toMatch(/gown/i);
    for (const rel of ['app/dashboard/pos/page.tsx', 'app/dashboard/pos/components/ProductSearch.tsx', 'app/dashboard/inventory/page.tsx']) {
      const visible = readFileSync(join(admin, rel), 'utf8')
        .split('\n')
        .filter((l: string) => !/^\s*(\/\/|\*|\/\*)/.test(l)) // ignore comments
        .join('\n');
      expect([rel, /buy-or-rent gown/i.test(visible)]).toEqual([rel, false]);
    }
    const guard = readFileSync(join(__dirname, 'rental-sale-guard.ts'), 'utf8');
    expect(guard).not.toMatch(/'This gown/);
  });
});
