// Real admin UI (localhost:3132, next dev) -> real API (localhost:4130) ->
// isolated schema it_pos. Walk-in POS rental MVP, M4 screens. Never production.
//   node pos-rental.browser.it.mjs <worktree> <ids.json>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const { chromium } = createRequire(process.argv[2] + '/apps/storefront/package.json')('playwright');
const ids = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const ADMIN = 'http://localhost:3132';
const API = 'http://localhost:4130/api/v1';
const sql = (q) => execFileSync(process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe', ['-U', 'naro_admin', '-h', 'localhost', '-d', 'naro_fashion', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO it_pos; ${q}`], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8' }).trim();
const results = [];
async function check(name, fn) {
  try { const n = await fn(); results.push('PASS'); console.log(`  ✔ ${name}${n ? `  — ${n}` : ''}`); }
  catch (e) { results.push('FAIL'); console.log(`  ✖ ${name}\n      ${String(e?.message || e).split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const xff = (s) => { const h = createHash('sha256').update(s).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
const api = async (method, p, token, body) => {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff(token || p), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const login = async (who) => (await api('POST', '/auth/login', null, { email: who.email, password: who.password })).data;
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const START = 100 + (Math.floor(Date.now() / 60000) % 60) * 6; // fresh dates per run, clear of other bookings (2-day buffer)

const browser = await chromium.launch();
async function as(who) {
  const tok = await login(who);
  assert(tok?.accessToken, `login ${who.email}`);
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript(([a, r]) => {
    localStorage.setItem('token', a); localStorage.setItem('refreshToken', r);
    window.print = () => {}; // agreement popup: no print dialog in the test
  }, [tok.accessToken, tok.refreshToken]);
  return { ctx, token: tok.accessToken };
}
async function openPos(ctx) {
  const p = await ctx.newPage();
  await p.goto(`${ADMIN}/dashboard/pos`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await p.getByTestId('pos-mode-rental').waitFor({ timeout: 180000 });
  return p;
}
const toastText = (p, re) => p.getByText(re).first().waitFor({ timeout: 20000 });

// The reviewer needs an open shift to reach the POS screen.
const reviewer = await as(ids.admins.reviewer);
await api('POST', '/pos/sessions/open', reviewer.token, { openingCash: 0 });
const cashier = await as(ids.admins.cashier);

console.log(`real admin ${ADMIN} -> real API -> it_pos`);
let page, rentalNumber, rentalId;
const phone = `+2557${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

await check('POS opens in Sale mode (sale panels visible); Rental tab switches without losing the sale screen', async () => {
  page = await openPos(cashier.ctx);
  assert((await page.getByTestId('pos-mode-sale').getAttribute('aria-selected')) === 'true', 'sale not default');
  assert((await page.getByTestId('rental-mode').count()) === 0, 'rental mode shown by default');
  await page.getByTestId('pos-mode-rental').click();
  await page.getByTestId('rental-mode').waitFor();
  await page.getByTestId('pos-mode-sale').click();
  assert((await page.getByTestId('rental-mode').count()) === 0, 'rental still shown in sale mode');
  await page.getByTestId('pos-mode-rental').click();
  await page.getByTestId('rental-mode').waitFor();
});

await check('search by barcode, pick size S + dates → quote: available by unit, fee 400,000, down payment 100,000, due before handover 600,000', async () => {
  await page.getByTestId('rental-search').fill('ITPOS-S');
  await page.getByTestId('rental-search-go').click();
  await page.getByTestId('rental-item-it-pos-gown').click();
  await page.getByTestId('rental-size').selectOption({ label: 'S' });
  await page.getByTestId('rental-pickup').fill(day(START));
  await page.getByTestId('rental-return').fill(day(START + 2));
  await page.getByTestId('rental-check').click();
  const q = await page.getByTestId('rental-quote').innerText({ timeout: 20000 });
  assert(/Available/.test(q) && /by physical unit/.test(q), q);
  assert(/400,000/.test(q) && /100,000/.test(q) && /Due before handover: TZS 600,000/.test(q), q);
});

await check('Book stays disabled until a customer is chosen and the terms are ticked', async () => {
  assert(await page.getByTestId('rental-book').isDisabled(), 'enabled with no customer');
  await page.getByTestId('rental-new-customer').click();
  await page.getByTestId('rental-nc-firstName').fill('Browser');
  await page.getByTestId('rental-nc-lastName').fill('Walkin');
  await page.getByTestId('rental-nc-phone').fill(phone);
  await page.getByTestId('rental-nc-save').click(); // no email, no address
  await page.getByTestId('rental-customer').waitFor();
  assert(await page.getByTestId('rental-book').isDisabled(), 'enabled without terms');
  await page.getByTestId('rental-terms').check();
  assert(!(await page.getByTestId('rental-book').isDisabled()), 'still disabled');
});

await check('booking (double-clicked) creates ONE POS request: pending ID, unit GOWN-S-01 allocated, created by the cashier', async () => {
  await page.getByTestId('rental-book').dblclick();
  await page.getByTestId('rental-booking').waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  const rows = sql(`SELECT r.id||'|'||r."rentalNumber"||'|'||r.status||'|'||r.channel||'|'||u.code||'|'||r."createdByAdminId"||'|'||(r."termsAcceptedAt" IS NOT NULL) FROM "RentalOrder" r JOIN "User" c ON c.id=r."userId" LEFT JOIN "RentalUnit" u ON u.id=r."rentalUnitId" WHERE c.phone='${phone}'`).split('\n').filter(Boolean);
  assert(rows.length === 1, `${rows.length} bookings`);
  const [id, num, status, channel, unit, by, terms] = rows[0].split('|');
  assert(status === 'PENDING_ID_VERIFICATION' && channel === 'POS' && unit === 'GOWN-S-01' && by === ids.admins.cashier.id && terms === 'true', rows[0]);
  rentalId = id; rentalNumber = num;
  assert((await page.getByTestId('rental-status').innerText()) === 'PENDING_ID_VERIFICATION', 'screen status');
  return num;
});

await check('the cashier (no id-verification:review) cannot record the ID: refused, nothing stored', async () => {
  await page.getByTestId('rental-id-number').fill('19940404-55555');
  await page.getByTestId('rental-id-verify').click();
  await page.waitForTimeout(2500);
  assert(sql(`SELECT count(*) FROM "CustomerIDDocument" d JOIN "User" c ON c.id=d."userId" WHERE c.phone='${phone}'`) === '0', 'ID stored');
  assert((await page.getByTestId('rental-id-state').innerText()) === 'not approved yet', 'screen says approved');
});

await check('handover before ID / payment / address is refused with the missing items; status unchanged', async () => {
  // Down payment first (allowed before ID; the booking stays pending until the ID is approved).
  await page.getByTestId('rental-pay-component').selectOption('RENTAL_FEE');
  await page.getByTestId('rental-pay-method').selectOption('CASH');
  await page.getByTestId('rental-pay-amount').fill('100000');
  await page.getByTestId('rental-pay').click();
  await toastText(page, /Rental fee payment recorded/);
  const st = sql(`SELECT status FROM "RentalOrder" WHERE id='${rentalId}'`);
  assert(st === 'PENDING_ID_VERIFICATION', `paid before ID → ${st}`);
  assert((await page.getByTestId('rental-handover').count()) === 0, 'handover offered while pending ID');
  return 'down payment taken; still pending ID; no handover button';
});

await check('a reviewer with 2FA resumes the booking by reference in another POS and verifies the ID in person → confirmed (down payment covered)', async () => {
  const rp = await openPos(reviewer.ctx);
  await rp.getByTestId('pos-mode-rental').click();
  await rp.getByTestId('rental-ref').fill(rentalNumber.toLowerCase());
  await rp.getByTestId('rental-open').click();
  await rp.getByTestId('rental-booking').waitFor({ timeout: 20000 });
  await rp.getByTestId('rental-id-number').fill('19940404-55555');
  await rp.getByTestId('rental-id-verify').click();
  await toastText(rp, /ID verified in person/);
  assert((await rp.getByTestId('rental-id-state').innerText()) === 'approved', 'not approved on screen');
  const st = sql(`SELECT status FROM "RentalOrder" WHERE id='${rentalId}'`);
  assert(st === 'DOWN_PAYMENT_PAID', st);
  const doc = sql(`SELECT d."verificationStatus"||'|'||COALESCE(d."frontImageUrl",'') FROM "CustomerIDDocument" d JOIN "User" c ON c.id=d."userId" WHERE c.phone='${phone}'`);
  assert(/^APPROVED\|in-person:\/\//.test(doc), doc);
  await rp.close();
  return st;
});

await check('cashier refreshes: handover refused while fee / deposit / address outstanding (server lists them)', async () => {
  await page.getByTestId('rental-ref').fill(rentalNumber);
  await page.getByTestId('rental-open').click();
  await page.getByTestId('rental-handover').waitFor({ timeout: 20000 });
  await page.getByTestId('rental-handover').click();
  await page.waitForTimeout(2500);
  assert(sql(`SELECT status FROM "RentalOrder" WHERE id='${rentalId}'`) === 'DOWN_PAYMENT_PAID', 'status changed');
  assert(sql(`SELECT "handedOverAt" IS NULL FROM "RentalOrder" WHERE id='${rentalId}'`) === 't', 'handed over');
});

await check('mobile money without a reference is refused; with a reference it is recorded separately; deposit in cash', async () => {
  const before = sql(`SELECT count(*) FROM "Payment" WHERE "rentalOrderId"='${rentalId}'`);
  await page.getByTestId('rental-pay-component').selectOption('RENTAL_FEE');
  await page.getByTestId('rental-pay-method').selectOption('MPESA');
  await page.getByTestId('rental-pay-amount').fill('300000');
  await page.getByTestId('rental-pay').click();
  await page.waitForTimeout(2500);
  assert(sql(`SELECT count(*) FROM "Payment" WHERE "rentalOrderId"='${rentalId}'`) === before, 'unreferenced mobile money stored');
  await page.getByTestId('rental-pay-amount').fill('300000');
  await page.getByTestId('rental-pay-ref').fill(`QX${Date.now().toString(36).toUpperCase()}`);
  await page.getByTestId('rental-pay').click();
  await toastText(page, /Rental fee payment recorded/);
  await page.getByTestId('rental-pay-component').selectOption('DEPOSIT');
  await page.getByTestId('rental-pay-method').selectOption('CASH');
  await page.getByTestId('rental-pay-amount').fill('200000');
  await page.getByTestId('rental-pay').click();
  await page.getByText(/Refundable deposit payment recorded/).first().waitFor({ timeout: 20000 });
  const comp = sql(`SELECT string_agg(component||':'||method||':'||amount::int, ',' ORDER BY "createdAt") FROM "Payment" WHERE "rentalOrderId"='${rentalId}' AND status='COMPLETED'`);
  assert(comp === 'RENTAL_FEE:CASH:100000,RENTAL_FEE:MPESA:300000,DEPOSIT:CASH:200000' || /RENTAL_FEE.*100000.*RENTAL_FEE.*300000.*DEPOSIT.*200000/.test(comp), comp);
  assert((await page.getByTestId('rental-out-RENTAL_FEE').innerText()) === 'TZS 0' && (await page.getByTestId('rental-out-DEPOSIT').innerText()) === 'TZS 0', 'outstanding not zero on screen');
  return comp;
});

await check('agreement prints the booking and terms, never the ID number', async () => {
  const [pop] = await Promise.all([page.waitForEvent('popup'), page.getByTestId('rental-agreement').click()]);
  const txt = await pop.locator('body').innerText();
  assert(txt.includes(rentalNumber) && /NARO-RENTAL-AGREEMENT/.test(txt) && /National ID approved: yes/.test(txt), txt.slice(0, 200));
  assert(!txt.includes('19940404'), 'ID number printed');
  await pop.close();
});

await check('address missing blocks handover; after saving it, a wrong unit tag is refused and the right one hands over', async () => {
  await page.getByTestId('rental-unit-code').fill('GOWN-S-01');
  await page.getByTestId('rental-handover').click();
  await page.waitForTimeout(2500);
  assert(sql(`SELECT status FROM "RentalOrder" WHERE id='${rentalId}'`) === 'FULLY_PAID', 'handed over without address');
  await page.getByTestId('rental-addr-street').fill('Mtaa wa Uhuru 1');
  await page.getByTestId('rental-addr-city').fill('Dar es Salaam');
  await page.getByTestId('rental-addr-region').fill('Dar es Salaam');
  await page.getByTestId('rental-addr-save').click();
  await page.getByTestId('rental-addr-save').waitFor({ state: 'detached', timeout: 20000 });
  await page.getByTestId('rental-unit-code').fill('GOWN-M-02');
  await page.getByTestId('rental-handover').click();
  await page.waitForTimeout(2500);
  assert(sql(`SELECT status FROM "RentalOrder" WHERE id='${rentalId}'`) === 'FULLY_PAID', 'wrong unit accepted');
  await page.getByTestId('rental-unit-code').fill('GOWN-S-01');
  await page.getByTestId('rental-handover').click();
  await toastText(page, /Handed over/);
  const r = sql(`SELECT status||'|'||("handedOverByAdminId"='${ids.admins.cashier.id}') FROM "RentalOrder" WHERE id='${rentalId}'`);
  assert(r === 'ACTIVE|true', r); // walk-in: handed over in the shop = out with the customer
});

await check('return in GOOD condition, then a deposit return is REQUESTED (not paid, not refunded)', async () => {
  await page.getByTestId('rental-return-condition').selectOption('GOOD');
  await page.getByTestId('rental-record-return').click();
  await toastText(page, /Return recorded/);
  await page.getByTestId('rental-dep-reason').fill('Inspected: no damage');
  await page.getByTestId('rental-dep-request').click();
  await toastText(page, /Deposit return requested/);
  const rr = sql(`SELECT status||'|'||amount::int||'|'||"retainedAmount"::int FROM "RentalRefundRequest" WHERE "rentalOrderId"='${rentalId}'`);
  assert(rr === 'REQUESTED|200000|0', rr);
  assert(sql(`SELECT count(*) FROM "Payment" WHERE "rentalOrderId"='${rentalId}' AND status='REFUNDED'`) === '0', 'money paid out');
  return `${sql(`SELECT status FROM "RentalOrder" WHERE id='${rentalId}'`)}; refund ${rr}`;
});

await check('offline: Rental mode is disabled entirely ("Rentals need internet"); no booking request leaves the browser', async () => {
  let posted = 0;
  page.on('request', (r) => { if (r.method() !== 'GET' && r.url().includes('/pos-rentals')) posted++; });
  await cashier.ctx.setOffline(true);
  await page.getByTestId('rental-offline').waitFor({ timeout: 60000 });
  assert((await page.getByTestId('rental-book').count()) === 0 && (await page.getByTestId('rental-pay').count()) === 0, 'actions still shown offline');
  await cashier.ctx.setOffline(false);
  assert(posted === 0, `${posted} writes offline`);
});

await check('Sale mode still works after the rental flow: sale screen visible, no rental rows in sales or layaways', async () => {
  await page.getByTestId('pos-mode-sale').click();
  assert((await page.getByTestId('rental-mode').count()) === 0 && (await page.getByTestId('rental-offline').count()) === 0, 'rental UI visible');
  const n = sql(`SELECT count(*) FROM "Order" o JOIN "User" c ON c.id=o."userId" WHERE c.phone='${phone}'`);
  assert(n === '0', `${n} orders for the rental customer`);
});

await browser.close();
const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
