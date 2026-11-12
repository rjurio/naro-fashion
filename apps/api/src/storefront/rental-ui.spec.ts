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
  parseRentalQuote,
  displayRentalFee,
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

describe('parseRentalQuote (the page shows the server quote, never its own arithmetic)', () => {
  const ok = { rentalFee: 140000, deposit: 350000, downPaymentPct: 30, downPayment: 42000, total: 490000, remaining: 448000 };
  it('accepts the server quote unchanged, including a non-25 % shop default', () => {
    expect(parseRentalQuote(ok)).toEqual(ok);
    expect(parseRentalQuote({ ...ok, rentalFee: '140000', downPayment: '42000' })).toEqual(ok);
  });
  it('a 0 % down payment is a valid server answer (no obligation), not an error', () => {
    const z = { ...ok, downPaymentPct: 0, downPayment: 0, remaining: 490000 };
    expect(parseRentalQuote(z)).toEqual(z);
  });
  it.each([
    ['nothing', null],
    ['not an object', 'boom'],
    ['a missing field', { ...ok, downPayment: undefined }],
    ['a null field (e.g. NaN on the server)', { ...ok, rentalFee: null }],
    ['a non-number', { ...ok, downPaymentPct: 'abc' }],
    ['a negative amount', { ...ok, deposit: -1 }],
    ['a percentage over 100', { ...ok, downPaymentPct: 150 }],
    ['a zero rental fee', { ...ok, rentalFee: 0 }],
    ['a down payment above the fee', { ...ok, downPayment: 150000 }],
  ])('rejects %s → null (the page says it could not load, never guesses)', (_l, v) => {
    expect(parseRentalQuote(v)).toBeNull();
  });
  it('never derives a percentage: there is no client-side default left in the helper', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../../storefront/lib/rental-ui.ts'), 'utf8');
    expect(src).not.toMatch(/export function rentalQuote/);
    expect(src).not.toMatch(/\/ 100\)|\* 0\.1\b|: 25\b/);
    expect(src).toMatch(/export function parseRentalQuote/);
  });
});

describe('displayRentalFee (headline price before / without the quote)', () => {
  it('uses the server fee when the quote is loaded', () => {
    expect(displayRentalFee({ rentalPricePerDay: '1' }, { rentalFee: 400000 } as any)).toBe(400000);
  });
  it("else the product's own flat rental price", () => {
    expect(displayRentalFee({ rentalPricePerDay: '140000' }, null)).toBe(140000);
  });
  it('else nothing: no 10 %-of-retail guess on the client', () => {
    expect(displayRentalFee({ rentalPricePerDay: null }, null)).toBeNull();
    expect(displayRentalFee(undefined, null)).toBeNull();
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
