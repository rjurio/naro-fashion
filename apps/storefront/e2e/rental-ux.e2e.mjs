/**
 * Browser regression tests for the Nov 2026 rental-discoverability and
 * order-history fixes. Runs against a LOCAL storefront wired to the mock API
 * below — never production, no database, no real bookings or payments.
 *
 * Run (two terminals, from the repo root):
 *   1) NEXT_PUBLIC_API_URL=http://localhost:4999/api/v1 NEXT_PUBLIC_TENANT_SLUG=naro-fashion \
 *        pnpm --filter storefront exec next dev --port 3100
 *   2) node apps/storefront/e2e/rental-ux.e2e.mjs            # STOREFRONT_URL defaults to http://localhost:3100
 *
 * Exit code 0 = all checks passed.
 */
import http from 'node:http';
import { chromium, devices } from 'playwright';

const MOCK_PORT = Number(process.env.MOCK_API_PORT || 4999);
const SF = (process.env.STOREFRONT_URL || 'http://localhost:3100').replace(/\/$/, '');

// ---------------------------------------------------------------- fixtures
const TENANT = { id: 'tenant-e2e', slug: 'naro-fashion', name: 'Naro E2E', status: 'ACTIVE', domain: 'localhost' };
const cat = (i) => (i < 10 ? { id: 'c-wed', name: 'Wedding Dresses', slug: 'wedding-dresses' } : { id: 'c-mer', name: 'Mermaid', slug: 'mermaid' });
const RENTALS = Array.from({ length: 15 }, (_, k) => {
  const i = k + 1;
  const n = String(i).padStart(2, '0');
  return {
    id: `p-${n}`, slug: `rental-gown-${n}`, name: `Rental Gown ${n}`, description: 'E2E gown',
    basePrice: '950000', compareAtPrice: null, availabilityMode: 'BOTH', isActive: true,
    rentalPricePerDay: '140000', rentalDepositAmount: '350000', rentalDownPaymentPct: 25, maxRentalDays: 3,
    categoryId: cat(k).id, category: { ...cat(k) }, images: [], reviews: [], reviewCount: 0, avgRating: 0,
    variants: [{ id: `v-${n}`, name: 'Standard', size: null, color: null, stock: 1, isActive: true }],
  };
});
const JEANS = {
  id: 'p-jeans', slug: 'jeans', name: 'Jeans', description: 'E2E jeans', basePrice: '45000', compareAtPrice: null,
  availabilityMode: 'PURCHASE_ONLY', isActive: true, rentalPricePerDay: null, categoryId: 'c-men',
  category: { id: 'c-men', name: 'Men', slug: 'men' }, images: [], reviews: [], reviewCount: 0, avgRating: 0,
  variants: [{ id: 'v-jeans', name: 'Standard', size: null, stock: 5, isActive: true }],
};
const RENTAL_ONLY = {
  ...RENTALS[0], id: 'p-ro', slug: 'rental-only-gown', name: 'Rental Only Gown', availabilityMode: 'RENTAL_ONLY',
  variants: [{ id: 'v-ro', name: 'Standard', size: null, color: null, stock: 1, isActive: true }],
};
const RENTABLE = [...RENTALS, RENTAL_ONLY]; // what availability_mode=RENTAL_ONLY,BOTH returns (16)
const ALL_PRODUCTS = [JEANS, RENTAL_ONLY, ...RENTALS]; // shop page 1 (12/page) includes the rental-only gown
const ORDER = {
  id: 'o-1', orderNumber: 'NF-E2E-1', status: 'DELIVERED', paymentStatus: 'PAID', total: '45000', subtotal: '45000',
  shippingFee: '0', createdAt: '2026-11-01T10:00:00Z', items: [{ id: 'oi-1', quantity: 1, unitPrice: '45000', totalPrice: '45000', product: { id: 'p-jeans', name: 'Jeans', slug: 'jeans' }, variant: { id: 'v-jeans', name: 'Standard' } }],
};

// ---------------------------------------------------------------- mock API
const mode = { products: 'ok', availability: 'ok', orders: 'ok', quote: 'product' };
// Down-payment scenarios: product row % and shop default % (null = not set).
const SCENARIOS = {
  product: { product: 25, shop: 30 },   // explicit product 25 % wins -> 25 %
  shop: { product: null, shop: 30 },    // no product % -> shop 30 %
  zero: { product: 0, shop: 30 },       // explicit 0 % is valid -> 0 %
  invalid: { product: 150, shop: 30 },  // invalid product % ignored -> shop 30 %
  none: { product: null, shop: null },  // neither -> 25 % fallback
  shopZero: { product: null, shop: 0 }, // shop needs no down payment
};
const validPct = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) || v < 0 || v > 100 ? null : Number(v));
function mockQuote() {
  const sc = SCENARIOS[mode.quote] || SCENARIOS.product;
  const pct = validPct(sc.product) ?? validPct(sc.shop) ?? 25;
  const rentalFee = 140000, deposit = 350000, downPayment = rentalFee * pct / 100;
  return { rentalFee, deposit, downPaymentPct: pct, downPayment, total: rentalFee + deposit, remaining: rentalFee + deposit - downPayment };
}
const withScenario = (p) => (p && p.availabilityMode !== 'PURCHASE_ONLY'
  ? { ...p, rentalDownPaymentPct: (SCENARIOS[mode.quote] || SCENARIOS.product).product }
  : p);
let pendingBody = null;
let lastRentalPost = null;
const seen = [];
const page = (rows, q) => {
  const limit = Number(q.get('limit') || 20);
  const p = Number(q.get('page') || 1);
  return { data: rows.slice((p - 1) * limit, p * limit), meta: { total: rows.length, page: p, limit, totalPages: Math.ceil(rows.length / limit) } };
};

function route(method, path, q) {
  if (path === '/__mock/set') { for (const [k, v] of q) mode[k] = v; return [200, mode]; }
  if (path === '/tenants/resolve') return [200, TENANT];
  if (path === '/auth/me') return [200, { id: 'u-1', email: 'customer@example.com', firstName: 'Test', lastName: 'Customer', isAdmin: false }];
  if (path === '/products' && method === 'GET') {
    const am = q.get('availability_mode');
    if (am) {
      if (mode.products === 'error') return [500, { message: 'boom' }];
      if (mode.products === 'empty') return [200, { data: [], meta: { total: 0, page: 1, limit: 12, totalPages: 0 } }];
      return [200, page(RENTABLE, q)];
    }
    const cs = q.get('categorySlug');
    if (cs) return [200, page(ALL_PRODUCTS.filter((p) => p.category.slug === cs), q)];
    return [200, page(ALL_PRODUCTS, q)];
  }
  const prod = path.match(/^\/products\/([^/]+)$/);
  if (prod) {
    const p = ALL_PRODUCTS.find((x) => x.slug === prod[1] || x.id === prod[1]);
    return p ? [200, withScenario(p)] : [404, { message: 'Product not found' }];
  }
  if (path.startsWith('/rentals/availability/')) {
    if (mode.availability === 'error') return [401, { message: 'Unauthorized', statusCode: 401 }];
    return [200, { available: mode.availability !== 'taken' }];
  }
  // Server-computed rental terms. The mock mirrors rentals/rental-terms.ts
  // precedence (product % -> shop default -> 25 %) from COHERENT fixtures:
  // the product row the page loads carries the same product % the quote uses.
  // (Before 2026-11-12 the 'shop' scenario returned 30 % while the product row
  // still said 25 % -- a state the real API can't produce, since an explicit
  // product 25 % wins.) The real-API check lives in rental-quote.it.mjs.
  if (path.startsWith('/rentals/quote/')) {
    if (mode.quote === 'error') return [500, { message: 'boom' }];
    if (mode.quote === 'bad') return [200, { rentalFee: 140000, deposit: 350000, downPaymentPct: 150, downPayment: 210000, total: 490000, remaining: 280000 }];
    return [200, mockQuote()];
  }
  if (path === '/rentals/terms-summary') {
    const sc = SCENARIOS[mode.quote] || SCENARIOS.product;
    const shop = validPct(sc.shop) ?? 25;
    return [200, { downPaymentRequired: shop > 0 }];
  }
  if (path === '/orders' && method === 'GET') {
    if (mode.orders === 'error') return [400, { message: ['property sort should not exist'], statusCode: 400 }];
    return [200, { data: [ORDER], meta: { total: 1, page: 1, limit: 50, totalPages: 1 } }];
  }
  if (path === '/rentals' && method === 'POST') {
    lastRentalPost = pendingBody;
    const now = mockQuote();
    const b = pendingBody || {};
    const differs = [['quotedRentalFee', 'rentalFee'], ['quotedDeposit', 'deposit'], ['quotedDownPayment', 'downPayment']]
      .some(([k, f]) => b[k] !== undefined && Math.round(b[k] * 100) !== Math.round(now[f] * 100));
    if (differs) return [409, { statusCode: 409, code: 'RENTAL_TERMS_CHANGED', message: 'The rental terms changed', current: now }];
    return [201, { id: 'r-1', rentalNumber: 'RNT-E2E-1' }];
  }
  if (path === '/rentals') return [200, []];
  if (path === '/cart') return [200, { items: [] }];
  if (path === '/wishlist') return [200, []];
  if (path.startsWith('/wishlist/check')) return [200, { inWishlist: false }];
  if (path === '/events') return [200, { data: [], meta: { total: 0 } }];
  if (path === '/cms/settings/business-profile') return [200, {}];
  // no CMS page: the storefront's built-in (i18n) page text is shown
  if (path.startsWith('/cms/pages/')) return [404, { message: 'Page not found', statusCode: 404 }];
  if (path === '/cms/storefront-stats') return [200, { productCount: 0, rentalCount: 0, customerCount: 0 }];
  if (path === '/analytics/track') return [204, null];
  return [200, []]; // categories, flash-sales, cms/*, payment-methods, reviews …
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const u = new URL(req.url, `http://localhost:${MOCK_PORT}`);
  const path = u.pathname.replace(/^\/api\/v1/, '');
  seen.push(`${req.method} ${path}${u.search}`);
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    try { pendingBody = raw ? JSON.parse(raw) : null; } catch { pendingBody = raw; }
    const [status, body] = route(req.method, path, u.searchParams);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body == null ? '' : JSON.stringify(body));
  });
});

// ---------------------------------------------------------------- tiny test harness
const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log(`  ✔ ${name}`); }
  catch (e) { results.push(['FAIL', name, e]); console.log(`  ✖ ${name}\n      ${String(e?.message || e).split('\n')[0]}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const setMode = (m) => Object.assign(mode, { products: 'ok', availability: 'ok', orders: 'ok', quote: 'product' }, m);
const isoIn = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

async function main() {
  await new Promise((r) => server.listen(MOCK_PORT, r));
  console.log(`mock API on :${MOCK_PORT}, storefront ${SF}`);
  const browser = await chromium.launch();
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const mobile = await browser.newContext({ ...devices['Pixel 7'] });

  const open = async (ctx, path) => {
    const p = await ctx.newPage();
    await p.goto(SF + path, { waitUntil: 'networkidle', timeout: 120000 });
    return p;
  };

  console.log('\n/rentals');
  await check('lists the first page, "All" shows meta.total (16, not 0), Load more reveals the rest', async () => {
    setMode({});
    const p = await open(desktop, '/rentals');
    await p.getByTestId('rentals-grid').waitFor();
    assert((await p.getByTestId('rentals-grid').locator('a').count()) === 12, 'expected 12 cards on page 1');
    const all = await p.getByTestId('rental-filter-all').innerText();
    assert(/\(16\)/.test(all), `All filter shows "${all}"`);
    await p.getByTestId('rentals-load-more').click();
    await p.waitForFunction(() => document.querySelectorAll('[data-testid="rentals-grid"] > a').length === 16);
    assert((await p.getByTestId('rentals-load-more').count()) === 0, 'Load more should disappear when all 16 are shown');
    await p.close();
  });
  await check('cards on /rentals offer Rent and never Add to Cart; Rent opens the booking page', async () => {
    setMode({});
    const p = await open(desktop, '/rentals');
    await p.getByTestId('rentals-grid').waitFor();
    assert((await p.getByTestId('card-add-to-cart').count()) === 0, 'Add to Cart found on /rentals');
    assert((await p.getByTestId('card-rent').count()) === 12, 'every card needs a Rent action');
    await p.getByTestId('card-rent').first().click();
    await p.waitForURL(/\/rentals\/rental-gown-\d\d$/);
    await p.close();
  });
  await check('an API failure shows an error + Retry, not "No rental products available"', async () => {
    setMode({ products: 'error' });
    const p = await open(desktop, '/rentals');
    await p.getByTestId('rentals-load-error').waitFor();
    assert((await p.getByTestId('rentals-empty').count()) === 0, 'empty state shown on error');
    setMode({});
    await p.getByRole('button', { name: /try again/i }).click();
    await p.getByTestId('rentals-grid').waitFor();
    await p.close();
  });
  await check('a genuinely empty result still shows the empty state', async () => {
    setMode({ products: 'empty' });
    const p = await open(desktop, '/rentals');
    await p.getByTestId('rentals-empty').waitFor();
    assert((await p.getByTestId('rentals-load-error').count()) === 0, 'error state shown for an empty result');
    await p.close();
  });

  console.log('\nproduct cards elsewhere');
  await check('shop listing: purchase-only card = Add to Cart only; BOTH card = Buy + Rent', async () => {
    setMode({});
    const p = await open(desktop, '/products');
    const jeans = p.locator('a[href="/products/jeans"]').first();
    await jeans.waitFor();
    assert((await jeans.getByTestId('card-add-to-cart').count()) === 1, 'jeans needs Add to Cart');
    assert((await jeans.getByTestId('card-rent').count()) === 0, 'jeans must not offer Rent');
    const gown = p.locator('a[href="/products/rental-gown-01"]').first();
    assert((await gown.getByTestId('card-rent').count()) === 1, 'gown needs Rent');
    assert((await gown.getByTestId('card-add-to-cart').count()) === 1, 'BOTH gown keeps Buy');
    await p.close();
  });

  console.log('\ngown page (/products/rental-gown-01)');
  await check('Buy / Rent choice sits under the price; Rent shows the rental terms and hides Add to Cart', async () => {
    setMode({});
    const p = await open(desktop, '/products/rental-gown-01');
    await p.getByTestId('pdp-buy-rent').waitFor();
    assert((await p.getByTestId('pdp-add-to-cart').count()) === 1, 'Buy is the default for BOTH');
    await p.getByTestId('pdp-choose-rent').click();
    const terms = await p.getByTestId('pdp-rental-terms').innerText();
    assert(/140,000/.test(terms), `rental fee missing: ${terms}`);
    assert(/350,000/.test(terms), `deposit missing: ${terms}`);
    assert(/35,000/.test(terms), `25% down payment missing: ${terms}`);
    assert(!/950,000/.test(terms), 'retail price must not appear as the rental amount');
    assert((await p.getByTestId('pdp-add-to-cart').count()) === 0, 'Add to Cart still visible in Rent mode');
    const href = await p.getByTestId('pdp-rent').getAttribute('href');
    assert(href === '/rentals/rental-gown-01', `rent link ${href}`);
    await p.close();
  });
  await check('related products show real prices (not TSh 0)', async () => {
    setMode({});
    const p = await open(desktop, '/products/rental-gown-01');
    await p.getByText(/You May Also Like/i).waitFor();
    const section = p.locator('section, div').filter({ has: p.getByText(/You May Also Like/i) }).last();
    const txt = await section.innerText();
    assert(/950,000/.test(txt), 'related card price missing');
    assert(!/TSh\s*0(?![\d,])/.test(txt), `"TSh 0" still rendered: ${txt.slice(0, 200)}`);
    await p.close();
  });
  await check('mobile: the Rent choice comes right after the price — above Quantity and Add to Cart', async () => {
    setMode({});
    const p = await open(mobile, '/products/rental-gown-01');
    const rent = await p.getByTestId('pdp-choose-rent').boundingBox();
    const cart = await p.getByTestId('pdp-add-to-cart').boundingBox();
    const qty = await p.getByText(/^Quantity$/).first().boundingBox();
    // Before the fix the only Rent button sat BELOW Add to Cart (y≈1161 on an 839px screen).
    assert(rent && cart && rent.y < cart.y, `Rent choice y=${rent?.y} not above Add to Cart y=${cart?.y}`);
    assert(qty && rent.y < qty.y, `Rent choice y=${rent?.y} not above Quantity y=${qty?.y}`);
    await p.close();
  });

  console.log('\nbooking page (/rentals/rental-gown-01)');
  await check('single variant is preselected; picking dates is enough; honest wording, no "Pay"', async () => {
    setMode({});
    const p = await open(desktop, '/rentals/rental-gown-01');
    const book = p.getByTestId('rental-book');
    await book.waitFor();
    const dates = p.locator('input[type="date"]');
    await dates.nth(0).fill(isoIn(30));
    await dates.nth(1).fill(isoIn(32));
    await p.getByTestId('rental-available').waitFor();
    assert(await book.isEnabled(), 'Book should be enabled once dates are chosen (variant auto-selected)');
    const label = await book.innerText();
    assert(/request booking/i.test(label) && !/pay/i.test(label), `button label "${label}"`);
    const note = await p.getByTestId('rental-payment-note').innerText();
    assert(/no payment is taken online/i.test(note) && /35,000/.test(note), `note "${note}"`);
    // Signed out → Book goes to login (no booking is created)
    await book.click();
    await p.waitForURL(/\/auth\/login\?redirect=/);
    await p.close();
  });
  const pickDates = async (p) => {
    const dates = p.locator('input[type="date"]');
    await dates.nth(0).fill(isoIn(30));
    await dates.nth(1).fill(isoIn(32));
    await p.getByTestId('rental-available').waitFor();
  };
  await check('shop default (no product %): booking page shows the server 30 % / TSh 42,000, not 25 %', async () => {
    setMode({ quote: 'shop' });
    const p = await open(desktop, '/rentals/rental-gown-01');
    await pickDates(p);
    const box = await p.getByTestId('rental-price-breakdown').innerText();
    assert(/30%/.test(box) && !/25%/.test(box), `percentage: ${box}`);
    assert(seen.some((x) => x.startsWith('GET /rentals/quote/p-01')), 'page must ask the server for the quote');
    assert(/42,000/.test(await p.getByTestId('rental-down-payment').innerText()), 'down payment not 42,000');
    assert(/448,000/.test(box) && /350,000/.test(box) && /490,000/.test(box), `remaining/deposit/total: ${box}`);
    assert(/42,000/.test(await p.getByTestId('rental-payment-note').innerText()), 'payment note amount');
    await p.close();
  });
  await check('changed configuration: product 25 % → shop 30 % shows on the next load', async () => {
    setMode({ quote: 'product' });
    const p = await open(desktop, '/rentals/rental-gown-01');
    await pickDates(p);
    assert(/35,000/.test(await p.getByTestId('rental-down-payment').innerText()), 'first load not 35,000');
    setMode({ quote: 'shop' });
    await p.reload({ waitUntil: 'networkidle' });
    await pickDates(p);
    assert(/42,000/.test(await p.getByTestId('rental-down-payment').innerText()), 'reload not 42,000');
    await p.close();
  });
  await check('quote unavailable: no amount invented, a clear message, booking request still possible', async () => {
    setMode({ quote: 'error' });
    const p = await open(desktop, '/rentals/rental-gown-01');
    await pickDates(p);
    await p.getByTestId('rental-quote-error').waitFor();
    assert(/couldn't load the down payment/i.test(await p.getByTestId('rental-quote-error').innerText()), 'message');
    assert((await p.getByTestId('rental-down-payment').count()) === 0, 'an amount was shown');
    assert((await p.getByTestId('rental-payment-note').count()) === 0, 'payment note with an amount shown');
    assert(await p.getByTestId('rental-book').isEnabled(), 'booking request should stay possible (server stores the amount)');
    await p.close();
  });
  await check('a malformed quote (150 %) is treated as unavailable, never displayed', async () => {
    setMode({ quote: 'bad' });
    const p = await open(desktop, '/rentals/rental-gown-01');
    await pickDates(p);
    await p.getByTestId('rental-quote-error').waitFor();
    assert((await p.getByTestId('rental-down-payment').count()) === 0, 'malformed amount shown');
    await p.close();
  });
  for (const [sc, pct, amount] of [['product', 25, '35,000'], ['shop', 30, '42,000'], ['invalid', 30, '42,000'], ['none', 25, '35,000']]) {
    await check(`precedence "${sc}" (product ${SCENARIOS[sc].product} / shop ${SCENARIOS[sc].shop}) → ${pct} % = TSh ${amount}`, async () => {
      setMode({ quote: sc });
      const p = await open(desktop, '/rentals/rental-gown-01');
      await pickDates(p);
      const box = await p.getByTestId('rental-price-breakdown').innerText();
      assert(new RegExp(`\\(${pct}%`).test(box), `pct: ${box}`);
      assert(new RegExp(amount).test(await p.getByTestId('rental-down-payment').innerText()), `amount: ${box}`);
      await p.close();
    });
  }
  await check('explicit 0 % (shop 30 %): "No down payment required", no TSh 0 line, honest note', async () => {
    setMode({ quote: 'zero' });
    const p = await open(desktop, '/rentals/rental-gown-01');
    await pickDates(p);
    await p.getByTestId('rental-no-down-payment').waitFor();
    assert((await p.getByTestId('rental-down-payment').count()) === 0, 'a down-payment amount was shown for 0 %');
    const note = await p.getByTestId('rental-payment-note').innerText();
    assert(/no down payment is needed/i.test(note) && !/TSh\s*0\b/.test(note), `note: ${note}`);
    await p.close();
  });
  await check('policy changed after the page loaded: booking refused, new terms shown, re-submit books', async () => {
    setMode({ quote: 'none' }); // page shows 25 % = 35,000
    lastRentalPost = null;
    const signed = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await signed.addInitScript(() => { localStorage.setItem('token', 'e2e-token'); });
    const p = await open(signed, '/rentals/rental-gown-02');
    await pickDates(p);
    assert(/35,000/.test(await p.getByTestId('rental-down-payment').innerText()), 'first quote');
    setMode({ quote: 'shop' }); // the shop default becomes 30 % before submit
    await p.getByTestId('rental-book').click();
    await p.getByTestId('rental-terms-changed').waitFor();
    assert(lastRentalPost && lastRentalPost.quotedDownPayment === 35000, `sent ${JSON.stringify(lastRentalPost)}`);
    assert(/\/rentals\/rental-gown-02/.test(p.url()), 'must stay on the booking page');
    assert(/42,000/.test(await p.getByTestId('rental-down-payment').innerText()), 'new amount not shown');
    assert(/42,000/.test(await p.getByTestId('rental-terms-changed').innerText()), 'message lacks the new amount');
    await p.getByTestId('rental-book').click();
    await p.waitForURL(/\/account\/rentals/);
    assert(lastRentalPost.quotedDownPayment === 42000, `re-submit sent ${lastRentalPost.quotedDownPayment}`);
    await p.close();
  });
  await check('"How it works": no fixed %; adapts to a 0 % shop policy', async () => {
    setMode({ quote: 'shop' });
    let p = await open(desktop, '/rentals');
    let txt = await p.getByText(/How Renting Works/i).locator('xpath=..').innerText();
    assert(/Pay the required down payment to confirm your rental booking\. The exact amount will be shown before confirmation\./.test(txt), `step: ${txt}`);
    assert(!/\d\s*%/.test(txt), `a fixed percentage is still shown: ${txt}`);
    await p.close();
    setMode({ quote: 'shopZero' });
    p = await open(desktop, '/rentals');
    await p.getByText(/No down payment needed/).waitFor();
    txt = await p.getByText(/How Renting Works/i).locator('xpath=..').innerText();
    assert(/No down payment is required to confirm your rental booking/.test(txt), `0 % step: ${txt}`);
    await p.close();
  });
  await check('gown page: rental terms use the server quote (30 %), and say so when it fails', async () => {
    setMode({ quote: 'shop' });
    const p = await open(desktop, '/products/rental-gown-01');
    await p.getByTestId('pdp-choose-rent').click();
    const dp = await p.getByTestId('pdp-down-payment').innerText();
    assert(/30%/.test(dp) && /42,000/.test(dp), `pdp down payment: ${dp}`);
    setMode({ quote: 'error' });
    await p.reload({ waitUntil: 'networkidle' });
    await p.getByTestId('pdp-choose-rent').click();
    await p.getByTestId('pdp-quote-error').waitFor();
    assert((await p.getByTestId('pdp-down-payment').count()) === 0, 'pdp showed an amount without a quote');
    assert(/140,000/.test(await p.getByTestId('pdp-rental-terms').innerText()), 'fee should still show');
    await p.close();
  });
  await check('dates taken → "not available" and Book disabled', async () => {
    setMode({ availability: 'taken' });
    const p = await open(desktop, '/rentals/rental-gown-01');
    const dates = p.locator('input[type="date"]');
    await dates.nth(0).fill(isoIn(30));
    await dates.nth(1).fill(isoIn(32));
    await p.getByTestId('rental-not-available').waitFor();
    assert(!(await p.getByTestId('rental-book').isEnabled()), 'Book must be disabled for taken dates');
    await p.close();
  });
  await check('a failed availability check is shown (not silently ignored)', async () => {
    setMode({ availability: 'error' });
    const p = await open(desktop, '/rentals/rental-gown-01');
    const dates = p.locator('input[type="date"]');
    await dates.nth(0).fill(isoIn(30));
    await dates.nth(1).fill(isoIn(32));
    await p.getByTestId('rental-availability-error').waitFor();
    assert((await p.getByTestId('rental-available').count()) === 0, 'must not claim availability');
    await p.close();
  });

  console.log('\nrental-only and sale-only products');
  await check('shop listing: RENTAL_ONLY card = Rent only (never Add to Cart)', async () => {
    setMode({});
    const p = await open(desktop, '/products');
    const ro = p.locator('a[href="/products/rental-only-gown"]').first();
    await ro.waitFor();
    assert((await ro.getByTestId('card-rent').count()) === 1, 'rental-only card needs Rent');
    assert((await ro.getByTestId('card-add-to-cart').count()) === 0, 'rental-only card offers Add to Cart');
    await p.close();
  });
  await check('RENTAL_ONLY gown page: rental terms + Rent link, no Buy choice, no Add to Cart', async () => {
    setMode({});
    const p = await open(desktop, '/products/rental-only-gown');
    await p.getByTestId('pdp-rental-terms').waitFor();
    assert((await p.getByTestId('pdp-buy-rent').count()) === 0, 'no Buy/Rent choice for rental-only');
    assert((await p.getByTestId('pdp-add-to-cart').count()) === 0, 'Add to Cart on a rental-only gown');
    assert((await p.getByTestId('pdp-rent').getAttribute('href')) === '/rentals/rental-only-gown', 'rent link');
    await p.close();
  });
  await check('SALE_ONLY product page is unchanged: Add to Cart, no Rent anywhere', async () => {
    setMode({});
    const p = await open(desktop, '/products/jeans');
    await p.getByTestId('pdp-add-to-cart').waitFor();
    assert((await p.getByTestId('pdp-buy-rent').count()) === 0, 'Buy/Rent choice on a sale-only product');
    assert((await p.getByTestId('pdp-rent').count()) === 0, 'Rent link on a sale-only product');
    assert((await p.getByTestId('pdp-rental-terms').count()) === 0, 'rental terms on a sale-only product');
    await p.close();
  });

  console.log('\nsigned-in booking');
  const shopper = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await shopper.addInitScript(() => { localStorage.setItem('token', 'e2e-token'); });
  await check('signed-in shopper books: exact CreateRentalDto payload (auto-selected variant), then My Rentals', async () => {
    setMode({});
    lastRentalPost = null;
    const p = await open(shopper, '/rentals/rental-gown-03');
    const dates = p.locator('input[type="date"]');
    await dates.nth(0).fill(isoIn(40));
    await dates.nth(1).fill(isoIn(42));
    await p.getByTestId('rental-available').waitFor();
    await p.getByTestId('rental-book').click();
    await p.waitForURL(/\/account\/rentals/);
    const b = lastRentalPost || {};
    assert(JSON.stringify(Object.keys(b).sort()) === JSON.stringify(['pickupDate', 'productId', 'quotedDeposit', 'quotedDownPayment', 'quotedRentalFee', 'returnDate', 'startDate', 'variantId']),
      `payload keys ${JSON.stringify(Object.keys(b))}`);
    assert(b.quotedRentalFee === 140000 && b.quotedDeposit === 350000 && b.quotedDownPayment === 35000, `quoted ${JSON.stringify(b)}`);
    assert(b.productId === 'p-03' && b.variantId === 'v-03', `ids ${b.productId}/${b.variantId}`);
    assert(b.startDate === isoIn(40) && b.returnDate === isoIn(42) && b.pickupDate === isoIn(40), `dates ${JSON.stringify(b)}`);
    await p.close();
  });

  console.log('\nSwahili');
  const sw = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await sw.addCookies([{ name: 'locale', value: 'sw', url: SF }]);
  await sw.addInitScript(() => { localStorage.setItem('locale', 'sw'); });
  await check('Swahili: Buy/Rent choice, booking wording and the error state are translated', async () => {
    setMode({});
    const p = await open(sw, '/products/rental-gown-01');
    // wait for BOTH options (the rent option renders once the rental quote is known)
    await p.getByTestId('pdp-choose-rent').waitFor();
    const choice = await p.getByTestId('pdp-buy-rent').innerText();
    assert(/Nunua/.test(choice) && /\bKodi\b/.test(choice) && !/Kodisha/.test(choice), `choice: ${JSON.stringify(choice)}`);
    await p.goto(SF + '/rentals/rental-gown-01', { waitUntil: 'networkidle' });
    const dates = p.locator('input[type="date"]');
    await dates.nth(0).fill(isoIn(30));
    await dates.nth(1).fill(isoIn(32));
    await p.getByTestId('rental-available').waitFor();
    const label = await p.getByTestId('rental-book').innerText();
    assert(/Omba kuhifadhi/.test(label), `button: ${label}`);
    assert(/Hakuna malipo/.test(await p.getByTestId('rental-payment-note').innerText()), 'payment note not Swahili');
    // Swahili money terms: server percentage and amount, kianzio wording
    assert(/Kianzio \(25% ya ada ya kukodi\)/.test(await p.getByTestId('rental-price-breakdown').innerText()), 'sw breakdown label');
    setMode({ quote: 'shop' });
    await p.reload({ waitUntil: 'networkidle' });
    await dates.nth(0).fill(isoIn(30));
    await dates.nth(1).fill(isoIn(32));
    await p.getByTestId('rental-available').waitFor();
    const swBox = await p.getByTestId('rental-price-breakdown').innerText();
    assert(/Kianzio \(30% ya ada ya kukodi\)/.test(swBox) && /42,000/.test(swBox), `sw shop default: ${swBox}`);
    assert(/42,000/.test(await p.getByTestId('rental-payment-note').innerText()), 'sw note amount');
    await p.goto(SF + '/products/rental-gown-01', { waitUntil: 'networkidle' });
    await p.getByTestId('pdp-choose-rent').click();
    const swDp = await p.getByTestId('pdp-down-payment').innerText();
    assert(/kianzio/i.test(swDp) && /30%/.test(swDp) && /42,000/.test(swDp), `sw pdp: ${swDp}`);
    setMode({ quote: 'error' });
    await p.goto(SF + '/rentals/rental-gown-01', { waitUntil: 'networkidle' });
    await dates.nth(0).fill(isoIn(30));
    await dates.nth(1).fill(isoIn(32));
    await p.getByTestId('rental-quote-error').waitFor();
    assert(/Hatukuweza kupata kiasi cha kianzio/.test(await p.getByTestId('rental-quote-error').innerText()), 'sw quote error');
    setMode({ quote: 'zero' });
    await p.goto(SF + '/rentals/rental-gown-01', { waitUntil: 'networkidle' });
    await dates.nth(0).fill(isoIn(30));
    await dates.nth(1).fill(isoIn(32));
    await p.getByTestId('rental-no-down-payment').waitFor();
    assert(/Hakuna kianzio kinachohitajika/.test(await p.getByTestId('rental-no-down-payment').innerText()), 'sw 0 % line');
    setMode({ quote: 'shop' });
    await p.goto(SF + '/rentals', { waitUntil: 'networkidle' });
    await p.getByText(/Lipa kianzio kinachohitajika ili kuthibitisha nafasi yako ya kukodi\. Kiasi halisi kitaonyeshwa kabla ya kuthibitisha\./).waitFor();
    setMode({ quote: 'shopZero' });
    await p.reload({ waitUntil: 'networkidle' });
    await p.getByText(/Hakuna kianzio kinachohitajika ili kuthibitisha nafasi yako ya kukodi/).waitFor();
    setMode({ products: 'error' });
    await p.goto(SF + '/rentals', { waitUntil: 'networkidle' });
    await p.getByTestId('rentals-load-error').waitFor();
    assert(/Jaribu tena/.test(await p.getByTestId('rentals-load-error').innerText()), 'retry not Swahili');
    await p.close();
  });

  console.log('\nNational ID notice (approved policy)');
  await check('booking page ID notice: request before ID, once per account, confirmation + hand-over only after approval (EN + SW)', async () => {
    setMode({});
    const p = await open(desktop, '/rentals/rental-gown-01');
    await p.getByText(/send this booking request before your National ID \(NIDA\) is verified/).waitFor();
    const en = await p.locator('body').innerText();
    assert(/only once for your account/.test(en) && /handed over or sent to you, only after your ID is approved/.test(en), 'EN notice incomplete');
    await p.close();
    const q = await open(sw, '/rentals/rental-gown-01');
    await q.getByText(/Unaweza kutuma ombi hili la kukodi kabla Kitambulisho chako cha Taifa/).waitFor();
    const s2 = await q.locator('body').innerText();
    assert(/mara moja tu kwa akaunti yako/.test(s2) && /bidhaa itakabidhiwa au kutumwa kwako, baada tu ya kitambulisho chako kuidhinishwa/.test(s2), 'SW notice incomplete');
    await q.close();
  });

  console.log('\nFAQ (policy-neutral wording)');
  await check('FAQ rentals answer (owner wording): no fixed %, no online payment, down payment only if any, fee + deposit before pickup (EN + SW)', async () => {
    setMode({});
    const p = await open(desktop, '/pages/faq');
    await p.getByText(/the down payment required, if any/).waitFor();
    await p.getByText('How does renting work?', { exact: true }).waitFor();
    const en = await p.locator('body').innerText();
    const ans = en.slice(en.indexOf('Choose the item you want to rent'), en.indexOf('upload your ID from your account.') + 33);
    assert(ans.length > 50 && !/\d\s*%/.test(ans) && /No payment is taken online/.test(ans) && /one-time National ID \(NIDA\)/.test(ans), `EN: ${ans}`);
    await p.close();
    const q = await open(sw, '/pages/faq');
    await q.getByText(/kiasi cha kianzio kinachohitajika, ikiwa kipo/).waitFor();
    await q.getByText('Ninawezaje kukodi bidhaa?', { exact: true }).waitFor();
    const swTxt = await q.locator('body').innerText();
    const swAns = swTxt.slice(swTxt.indexOf('Chagua bidhaa unayotaka kukodi'), swTxt.indexOf('kupitia akaunti yako.') + 21);
    assert(swAns.length > 50 && !/\d\s*%/.test(swAns) && /amana inayorejeshwa/.test(swAns) && /Kitambulisho cha Taifa \(NIDA\) mara moja/.test(swAns), `SW: ${swAns}`);
    await q.close();
  });

  console.log('\norder history (/account/orders)');
  const signedIn = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await signedIn.addInitScript(() => { localStorage.setItem('token', 'e2e-token'); });
  await check('lists the customer\'s orders; the request carries sort=newest', async () => {
    setMode({});
    seen.length = 0;
    const p = await open(signedIn, '/account/orders');
    await p.getByText('NF-E2E-1').waitFor();
    assert(seen.some((s) => /^GET \/orders\?.*sort=newest/.test(s)), `orders request: ${seen.filter((s) => s.includes('/orders')).join(', ')}`);
    assert((await p.getByTestId('orders-empty').count()) === 0, '"No orders yet" shown although an order exists');
    await p.close();
  });
  await check('a failed request shows an error + Retry, not "No orders yet"', async () => {
    setMode({ orders: 'error' });
    const p = await open(signedIn, '/account/orders');
    await p.getByTestId('orders-load-error').waitFor();
    assert((await p.getByTestId('orders-empty').count()) === 0, 'empty state shown on error');
    setMode({});
    await p.getByRole('button', { name: /try again/i }).click();
    await p.getByText('NF-E2E-1').waitFor();
    await p.close();
  });

  await browser.close();
  server.close();
  const failed = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('FATAL', e); server.close(); process.exit(2); });
