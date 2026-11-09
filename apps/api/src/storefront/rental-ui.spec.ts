import { join } from 'path';

/**
 * Unit tests for the storefront's pure Buy-vs-Rent helpers
 * (apps/storefront/lib/rental-ui.ts). The storefront has no test runner of
 * its own; these run in the API jest suite (and therefore in CI).
 *
 * Loaded with a runtime require (ts-jest still transpiles it) rather than an
 * `import`, because the file lives outside the API's tsconfig rootDir and
 * `tsc --noEmit -p apps/api` would reject it (TS6059).
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ui = require(join(__dirname, '..', '..', '..', 'storefront', 'lib', 'rental-ui'));
const {
  autoSelectRentalVariantId,
  canBuy,
  canRent,
  cardActions,
  listData,
  listTotal,
  normalizeAvailabilityMode,
  rentalHref,
  rentalQuote,
  toCardProduct,
} = ui;

describe('availability modes', () => {
  it('unknown / missing → PURCHASE_ONLY (the API default)', () => {
    expect(normalizeAvailabilityMode(undefined)).toBe('PURCHASE_ONLY');
    expect(normalizeAvailabilityMode('rental_only')).toBe('PURCHASE_ONLY');
    expect(normalizeAvailabilityMode('BOTH')).toBe('BOTH');
  });

  it('canBuy / canRent', () => {
    expect([canBuy('PURCHASE_ONLY'), canRent('PURCHASE_ONLY')]).toEqual([true, false]);
    expect([canBuy('RENTAL_ONLY'), canRent('RENTAL_ONLY')]).toEqual([false, true]);
    expect([canBuy('BOTH'), canRent('BOTH')]).toEqual([true, true]);
  });
});

describe('cardActions (product card quick actions)', () => {
  it.each([
    ['PURCHASE_ONLY', 'shop', { buy: true, rent: false }],
    ['RENTAL_ONLY', 'shop', { buy: false, rent: true }],
    ['BOTH', 'shop', { buy: true, rent: true }],
    // On /rentals a card must never sell the gown at retail price.
    ['BOTH', 'rentals', { buy: false, rent: true }],
    ['RENTAL_ONLY', 'rentals', { buy: false, rent: true }],
    ['PURCHASE_ONLY', 'rentals', { buy: true, rent: false }],
  ] as const)('%s on %s → %j', (mode, ctx, expected) => {
    expect(cardActions(mode, ctx)).toEqual(expected);
  });

  it('RENTAL_ONLY never offers Add to Cart in any context', () => {
    expect(cardActions('RENTAL_ONLY').buy).toBe(false);
    expect(cardActions('RENTAL_ONLY', 'rentals').buy).toBe(false);
  });

  it('rentalHref encodes the slug', () => {
    expect(rentalHref('ivory-gown')).toBe('/rentals/ivory-gown');
    expect(rentalHref('a/b')).toBe('/rentals/a%2Fb');
  });
});

describe('list helpers (API pagination shape)', () => {
  it('listTotal reads meta.total (the /rentals "All (0)" + hidden Load-more bug)', () => {
    expect(listTotal({ data: [], meta: { total: 23, page: 1 } })).toBe(23);
  });
  it('listTotal falls back to legacy top-level total, then to the fallback', () => {
    expect(listTotal({ total: 5 })).toBe(5);
    expect(listTotal({ data: [1, 2] }, 2)).toBe(2);
    expect(listTotal(null, 7)).toBe(7);
    expect(listTotal({ meta: { total: 'x' } }, 3)).toBe(3);
    expect(listTotal({ meta: { total: -1 } }, 3)).toBe(3);
  });
  it('listData accepts a bare array or { data }', () => {
    expect(listData([1, 2])).toEqual([1, 2]);
    expect(listData({ data: [3] })).toEqual([3]);
    expect(listData({ data: 'nope' })).toEqual([]);
    expect(listData(undefined)).toEqual([]);
  });
});

describe('autoSelectRentalVariantId', () => {
  it('preselects the only active variant (e.g. "Standard")', () => {
    expect(autoSelectRentalVariantId([{ id: 'v1' }])).toBe('v1');
    expect(autoSelectRentalVariantId([{ id: 'v1', isActive: false }, { id: 'v2', isActive: true }])).toBe('v2');
  });
  it('does not guess when there is a real choice, or nothing to choose', () => {
    expect(autoSelectRentalVariantId([{ id: 'v1' }, { id: 'v2' }])).toBe('');
    expect(autoSelectRentalVariantId([])).toBe('');
    expect(autoSelectRentalVariantId(undefined)).toBe('');
    expect(autoSelectRentalVariantId([{ id: 'v1', isActive: false }])).toBe('');
  });
});

describe('rentalQuote (mirrors RentalsService.create arithmetic)', () => {
  it('prod example: flat 140,000 fee, 350,000 deposit, 25% of the FEE only', () => {
    const q = rentalQuote({ rentalPricePerDay: '140000', rentalDepositAmount: '350000', rentalDownPaymentPct: 25, basePrice: '950000' });
    expect(q).toEqual({
      rentalFee: 140000,
      deposit: 350000,
      downPaymentPct: 25,
      downPayment: 35000,
      total: 490000,
      remaining: 455000,
    });
  });
  it('never uses the retail price as the rental fee when a rental price exists', () => {
    expect(rentalQuote({ rentalPricePerDay: 120000, basePrice: 850000 }).rentalFee).toBe(120000);
  });
  it('falls back to 10% of retail (same as the API) when no rental price is set', () => {
    expect(rentalQuote({ basePrice: 900000 }).rentalFee).toBe(90000);
  });
  it('defaults the down payment to 25% and the deposit to 0', () => {
    const q = rentalQuote({ rentalPricePerDay: 100000 });
    expect(q.downPaymentPct).toBe(25);
    expect(q.deposit).toBe(0);
    expect(q.downPayment).toBe(25000);
  });
});

describe('toCardProduct ("You May Also Like" showed TSh 0)', () => {
  const raw = {
    id: 'p1',
    slug: 'white-gown',
    name: 'White Gown',
    basePrice: '1000000',
    compareAtPrice: '1400000',
    rentalPricePerDay: '140000',
    availabilityMode: 'BOTH',
    images: [{ url: '/uploads/products/white-gown-01.jpg' }],
    variants: [{ id: 'v1' }],
  };
  it('maps basePrice → price (not 0) and keeps the rental info', () => {
    const c = toCardProduct(raw, 'https://api.example');
    expect(c.price).toBe(1000000);
    expect(c.originalPrice).toBe(1400000);
    expect(c.isOnSale).toBe(true);
    expect(c.rentPrice).toBe(140000);
    expect(c.isRentable).toBe(true);
    expect(c.availabilityMode).toBe('BOTH');
    expect(c.defaultVariantId).toBe('v1');
  });
  it('resolves /uploads images against the API origin; leaves absolute URLs', () => {
    expect(toCardProduct(raw, 'https://api.example').image).toBe('https://api.example/uploads/products/white-gown-01.jpg');
    expect(toCardProduct({ ...raw, images: ['https://cdn.x/a.jpg'] }, 'https://api.example').image).toBe('https://cdn.x/a.jpg');
  });
  it('purchase-only products are not rentable', () => {
    const c = toCardProduct({ ...raw, availabilityMode: 'PURCHASE_ONLY', rentalPricePerDay: null }, '');
    expect(c.isRentable).toBe(false);
    expect(c.rentPrice).toBeUndefined();
  });
});
