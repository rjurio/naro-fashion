import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Shape guards for the Nov 2026 rental-discoverability fixes. They read the
 * storefront source (no runner of its own) and fail if a page drifts back to
 * the patterns that hid the rental flow in production.
 */
const SF = join(__dirname, '..', '..', '..', 'storefront');
const read = (rel: string) => readFileSync(join(SF, rel), 'utf8');

describe('storefront rental wiring', () => {
  it('ProductCard derives its actions from cardActions() and has a Rent action', () => {
    const s = read('components/ui/ProductCard.tsx');
    expect(s).toMatch(/cardActions\(/);
    expect(s).toMatch(/actions\.buy\s*&&/); // Add to Cart is conditional, not unconditional
    expect(s).toMatch(/actions\.rent\s*&&/);
    expect(s).toMatch(/rentalHref\(/);
  });

  it('/rentals reads meta.total via listTotal, shows an error state, and renders Rent-only cards', () => {
    const s = read('app/rentals/page.tsx');
    expect(s).toMatch(/listTotal\(/);
    expect(s).not.toMatch(/productsRes\?\.total/);
    expect(s).toMatch(/loadError/);
    expect(s).toMatch(/t\('rentals\.loadFailed'\)/);
    expect(s).toMatch(/context="rentals"/);
  });

  it('gown page offers an explicit Buy / Rent choice and maps related products', () => {
    const s = read('app/products/[slug]/page.tsx');
    expect(s).toMatch(/data-testid="pdp-choose-rent"/);
    expect(s).toMatch(/data-testid="pdp-choose-buy"/);
    expect(s).toMatch(/toCardProduct\(/);
    // the raw API row must not be spread into ProductCard again (TSh 0 bug)
    expect(s).not.toMatch(/setRelatedProducts\(items\.filter\([^)]*\)\.slice\(0, 4\)\);/);
  });

  it('booking page preselects a lone variant, uses the shared quote, and makes no payment promise', () => {
    const s = read('app/rentals/[slug]/page.tsx');
    expect(s).toMatch(/autoSelectRentalVariantId\(/);
    expect(s).toMatch(/rentalQuote\(/);
    expect(s).not.toMatch(/bookNowWithPay/);
    expect(s).toMatch(/noOnlinePaymentNote/);
    // a failed availability check is shown, never silently treated as "not checked"
    expect(s).toMatch(/setAvailable\("error"\)/);
  });

  it('order history distinguishes a failed request from "no orders"', () => {
    const s = read('app/account/orders/page.tsx');
    expect(s).toMatch(/loadError/);
    expect(s).toMatch(/orders\.loadFailed/);
  });

  it('every new string exists in both English and Swahili', () => {
    const en = JSON.parse(read('messages/en.json'));
    const sw = JSON.parse(read('messages/sw.json'));
    const keys: Array<[string, string]> = [
      ['product', 'buy'], ['product', 'rent'], ['product', 'buyOrRent'], ['product', 'rentHint'],
      ['product', 'chooseRentalDates'], ['product', 'rentalDownPaymentLine'], ['product', 'rentalDepositLine'],
      ['rentals', 'loadFailed'], ['rentals', 'retry'], ['rentals', 'requestBooking'],
      ['rentals', 'noOnlinePaymentNote'], ['rentals', 'availabilityCheckFailed'], ['rentals', 'selectDatesToContinue'],
      ['orders', 'loadFailed'], ['orders', 'retry'],
    ];
    for (const [ns, k] of keys) {
      expect([ns, k, typeof en[ns]?.[k]]).toEqual([ns, k, 'string']);
      expect([ns, k, typeof sw[ns]?.[k]]).toEqual([ns, k, 'string']);
    }
    // placeholders survive translation
    expect(sw.rentals.noOnlinePaymentNote).toContain('{amount}');
    expect(sw.product.rentalDownPaymentLine).toMatch(/\{pct\}.*\{amount\}/);
  });
});
