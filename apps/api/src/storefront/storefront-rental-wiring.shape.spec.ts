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
    // money terms come from the server quote (rental-terms.ts), not page maths
    expect(s).toMatch(/rentalsApi\.quote\(/);
    expect(s).toMatch(/parseRentalQuote\(/);
    expect(s).toMatch(/rentals\.quoteUnavailable/);
    expect(s).not.toMatch(/bookNowWithPay/);
    expect(s).toMatch(/noOnlinePaymentNote/);
    // a failed availability check is shown, never silently treated as "not checked"
    expect(s).toMatch(/setAvailable\("error"\)/);
  });

  it('no storefront page computes a down payment or percentage itself', () => {
    for (const f of ['app/rentals/[slug]/page.tsx', 'app/products/[slug]/page.tsx']) {
      const src = read(f);
      expect(src).not.toMatch(/rentalQuote\(/);
      expect(src).not.toMatch(/downPaymentPct\s*\|\|\s*25|Pct\s*\/\s*100|\*\s*\(\s*\w*[Pp]ct/);
    }
    const pdp = read('app/products/[slug]/page.tsx');
    expect(pdp).toMatch(/rentalsApi\.quote\(/);
    expect(pdp).toMatch(/parseRentalQuote\(/);
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

  // Owner decisions, 2026-11-10 (round 7). Row 7 (payDeposit) is the "How it
  // works" step whose description says it SECURES THE DATES, i.e. the 25%
  // down payment, so it uses "kianzio", never "amana" (the refundable deposit).
  const APPROVED_SW: Record<string, string> = {
    'product.rent': 'Kodi',
    'product.buyOrRent': 'Nunua au kodi',
    'product.rentHint': 'Ada ya mara moja, hadi siku {max}',
    'product.rentalDownPaymentLine': 'Malipo ya awali (kianzio): {pct}% ya ada ya kukodi ({amount})',
    'product.chooseRentalDates': 'Kodi — chagua tarehe',
    'rentals.downPayment': 'Lipa kianzio cha 25%',
    // Owner wording 2026-11-12: no fixed percentage in "How it works".
    'rentals.payDeposit': 'Lipa kianzio',
    'rentals.payDepositDesc':
      'Lipa kianzio kinachohitajika ili kuthibitisha nafasi yako ya kukodi. Kiasi halisi kitaonyeshwa kabla ya kuthibitisha.',
    'rentals.downPaymentLine': 'Kianzio ({pct}% ya ada ya kukodi) — kinahitajika kuthibitisha nafasi',
    'rentals.remainingBeforeDispatch': 'Lipa salio na amana inayorejeshwa kabla ya kuchukua bidhaa',
  };
  const at = (o: any, k: string) => k.split('.').reduce((a, b) => a?.[b], o);
  const placeholders = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort();

  it('the approved Swahili rental strings are in place', () => {
    const sw = JSON.parse(read('messages/sw.json'));
    for (const [k, v] of Object.entries(APPROVED_SW)) expect([k, at(sw, k)]).toEqual([k, v]);
  });

  it('every Swahili string keeps exactly the placeholders of its English original (whole file)', () => {
    const en = JSON.parse(read('messages/en.json'));
    const sw = JSON.parse(read('messages/sw.json'));
    const walk = (e: any, s: any, path: string[]) => {
      for (const k of Object.keys(e)) {
        const p = [...path, k];
        if (typeof e[k] === 'string') {
          if (typeof s?.[k] === 'string') expect([p.join('.'), placeholders(s[k])]).toEqual([p.join('.'), placeholders(e[k])]);
        } else walk(e[k], s?.[k], p);
      }
    };
    walk(en, sw, []);
  });

  it('down payment (kianzio) and refundable deposit (amana) are never swapped', () => {
    const sw = JSON.parse(read('messages/sw.json'));
    for (const k of ['rentals.downPayment', 'rentals.payDeposit', 'rentals.downPaymentLine', 'product.rentalDownPaymentLine']) {
      expect([k, /kianzio/i.test(at(sw, k)), /amana/i.test(at(sw, k))]).toEqual([k, true, false]);
    }
    expect(at(sw, 'product.rentalDepositLine')).toMatch(/amana/i);
    expect(at(sw, 'rentals.remainingBeforeDispatch')).toMatch(/amana inayorejeshwa/);
    // the step's own description confirms it is the down payment that confirms the booking
    expect(at(JSON.parse(read('messages/en.json')), 'rentals.payDepositDesc')).toBe(
      'Pay the required down payment to confirm your rental booking. The exact amount will be shown before confirmation.',
    );
  });

  it('"How it works" names no fixed percentage, and adapts when the shop needs no down payment', () => {
    const en = JSON.parse(read('messages/en.json'));
    const sw = JSON.parse(read('messages/sw.json'));
    for (const k of ['rentals.payDeposit', 'rentals.payDepositDesc', 'rentals.noDownPaymentStep', 'rentals.noDownPaymentStepDesc']) {
      expect([k, /\d\s*%/.test(at(en, k)), /\d\s*%/.test(at(sw, k))]).toEqual([k, false, false]);
    }
    // no wording that implies money is taken online
    expect(at(en, 'rentals.payDepositDesc')).not.toMatch(/online|card|checkout/i);
    expect(at(sw, 'rentals.noDownPaymentStepDesc')).toMatch(/Hakuna kianzio/);
    const page = read('app/rentals/page.tsx');
    expect(page).toMatch(/rentalsApi\.termsSummary\(/);
    expect(page).toMatch(/downPaymentRequired \? t\('rentals\.payDeposit'\) : t\('rentals\.noDownPaymentStep'\)/);
    // unknown (loading / failed) defaults to the general wording
    expect(page).toMatch(/useState\(true\)/);
  });

  it('live customer-facing rental copy names no fixed down-payment percentage (FAQ, homepage + admin CMS defaults)', () => {
    const en = JSON.parse(read('messages/en.json'));
    const sw = JSON.parse(read('messages/sw.json'));
    for (const k of ['pages.faqRentalsContent', 'rentals.noDownPaymentStepDesc', 'rentals.noOnlinePaymentNoDownPayment']) {
      expect([k, /\d\s*%/.test(at(en, k)), /\d\s*%/.test(at(sw, k))]).toEqual([k, false, false]);
    }
    // Owner's approved Swahili FAQ answer, 2026-11-12 (verbatim).
    expect(at(sw, 'pages.faqRentalsContent')).toBe(
      'Chagua bidhaa unayotaka kukodi na tarehe za kukodi, kisha tuma ombi lako. Tutakuthibitishia upatikanaji wa bidhaa ' +
      'na kiasi cha kianzio kinachohitajika, ikiwa kipo. Hakuna malipo yanayofanyika mtandaoni wakati wa kutuma ombi. ' +
      'Salio la ada ya kukodi na amana inayorejeshwa vitalipwa kulingana na masharti ya uhifadhi wako kabla ya kuchukua bidhaa.',
    );
    const home = read('app/page.tsx');
    expect(home).not.toMatch(/rental_section_features: '[^']*\d+% /);
    const adminCms = require('fs').readFileSync(
      require('path').join(__dirname, '../../../admin/app/dashboard/cms/settings/page.tsx'), 'utf8');
    expect(adminCms).not.toMatch(/key: 'rental_section_features'[^\n]*\d+% down payment/);
  });

  it('the FAQ explains the down payment without implying online payment, and says 0 % still has obligations', () => {
    const en = JSON.parse(read('messages/en.json'));
    const sw = JSON.parse(read('messages/sw.json'));
    expect(at(en, 'pages.faqRentalsContent')).toMatch(/No payment is taken online/);
    // a down payment only "if any"; the fee balance and the deposit still apply
    expect(at(en, 'pages.faqRentalsContent')).toMatch(/down payment required, if any/);
    expect(at(en, 'pages.faqRentalsContent')).toMatch(/rental fee and the refundable deposit are paid before pickup/);
    expect(at(sw, 'pages.faqRentalsContent')).toMatch(/Hakuna malipo yanayofanyika mtandaoni/);
    expect(at(sw, 'pages.faqRentalsContent')).toMatch(/ikiwa kipo/);
    expect(at(sw, 'pages.faqRentalsContent')).toMatch(/kianzio/);
    expect(at(sw, 'pages.faqRentalsContent')).toMatch(/amana inayorejeshwa/);
    // 0 %: the fee and the refundable deposit still apply (EN + SW)
    for (const k of ['rentals.noDownPaymentStepDesc', 'rentals.noOnlinePaymentNoDownPayment']) {
      expect(at(en, k)).toMatch(/rental fee and the refundable deposit/);
      expect(at(sw, k)).toMatch(/Ada ya kukodi na amana inayorejeshwa/);
    }
  });

  it('booking page sends the amounts it showed and handles a terms change without booking', () => {
    const s = read('app/rentals/[slug]/page.tsx');
    expect(s).toMatch(/quotedRentalFee: quote\.rentalFee, quotedDeposit: quote\.deposit, quotedDownPayment: quote\.downPayment/);
    expect(s).toMatch(/changedTermsFromError\(err\.data\)/);
    expect(s).toMatch(/data-testid="rental-terms-changed"/);
    // the terms-changed branch returns before the success navigation
    const i = s.indexOf('changedTermsFromError(err.data)');
    expect(s.slice(i, i + 400)).toMatch(/return;/);
  });

  // Owner rule 2026-11-11: the CUSTOMER renting -> kodi / kukodi; NARO letting
  // out -> kodisha / kukodisha. Reviewed key by key in context, not replaced
  // wholesale.
  const CUSTOMER_RENTS = [
    'account.idNeedToVerify', 'auth.joinCommunityDesc', 'auth.welcomeBackDesc', 'footer.footerDesc',
    'home.heroSubtitle', 'home.rentAGown', 'idVerification.allSetDesc', 'idVerification.verifiedDesc',
    'pages.faqRentalsContent', 'product.rentFrom', 'product.rentalPrice', 'rentals.pickYourDatesDesc',
    'rentals.selectRentalPeriod', 'rentals.selectSizeAndDates', 'rentals.title',
  ];
  const NARO_LETS_OUT = [
    'idVerification.uploadPrompt', 'rentals.rentalOnly', 'rentals.noRentalProducts', 'rentals.loadFailed',
    'home.gownsForRent', 'home.premiumRentalService',
  ];
  // Shown for every rentable product (gowns, bouquets, ...): never "gauni".
  const SHARED_RENTAL = [
    'rentals.remainingBeforeDispatch', 'rentals.loadFailed', 'rentals.loadMoreFailed',
    'account.idNeedToVerify', 'idVerification.verifiedDesc', 'pages.faqRentalsContent',
  ];

  it('customer-side strings use kodi / kukodi; NARO-side strings keep kodisha', () => {
    const sw = JSON.parse(read('messages/sw.json'));
    for (const k of CUSTOMER_RENTS) {
      expect([k, /\bk(u)?kodi\b|\bKodi\b/i.test(at(sw, k)), /kodish/i.test(at(sw, k))]).toEqual([k, true, false]);
    }
    for (const k of NARO_LETS_OUT) expect([k, /kodish/i.test(at(sw, k))]).toEqual([k, true]);
  });

  it('shared rental messages are item-neutral (no gauni / gown)', () => {
    const sw = JSON.parse(read('messages/sw.json'));
    const en = JSON.parse(read('messages/en.json'));
    for (const k of SHARED_RENTAL) {
      expect([k, /gaun/i.test(at(sw, k)), /gown/i.test(at(en, k))]).toEqual([k, false, false]);
    }
  });

  it('the rentals FAQ uses the approved terms: kianzio for the down payment, amana inayorejeshwa for the deposit', () => {
    const faq: string = at(JSON.parse(read('messages/sw.json')), 'pages.faqRentalsContent');
    // Owner 2026-11-12: no fixed percentage in live copy (it depends on the policy).
    expect(faq).toMatch(/kianzio/);
    expect(faq).not.toMatch(/\d\s*%/);
    expect(faq).toMatch(/[Aa]mana inayorejeshwa/);
    // "online" appears only to say that NO payment is taken online
    expect(faq.replace('Hakuna malipo yanayofanyika mtandaoni', '')).not.toMatch(/mtandaoni|online|kadi/i);
  });

  it('no Swahili rental string implies an online payment (none is taken online)', () => {
    const sw = JSON.parse(read('messages/sw.json'));
    for (const k of Object.keys(APPROVED_SW)) expect([k, /mtandaoni|online|kadi/i.test(at(sw, k))]).toEqual([k, false]);
    expect(at(sw, 'rentals.noOnlinePaymentNote')).toMatch(/^Hakuna malipo yanayofanywa mtandaoni/);
  });
});
