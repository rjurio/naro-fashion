// Real admin UI (next dev, localhost:3233) -> real API -> isolated schema.
// R1 walk-in exposure: the POS page must not offer walk-in rentals.
//   IT_MODE=gate|servicing|recut|override IT_API=.. node r1-gate.browser.it.mjs <worktree> <ids.json>
// override = gate build with the API's test override on: the toggle appears
// (proves the page follows the SERVER, not a client constant).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const { chromium } = createRequire(process.argv[2] + '/apps/storefront/package.json')('playwright');
const MODE = process.env.IT_MODE;
const ids = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const ADMIN = 'http://localhost:3233';
const API = process.env.IT_API;
if (!/^http:\/\/localhost:\d+\/api\/v1$/.test(API || '')) throw new Error('IT_API must be a localhost API');
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
const tok = (await api('POST', '/auth/login', null, { email: ids.admins.super.email, password: ids.admins.super.password })).data;
assert(tok?.accessToken, 'login super');
await api('POST', '/pos/sessions/open', tok.accessToken, { openingCash: 0 });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await ctx.addInitScript(([a, r]) => { localStorage.setItem('token', a); localStorage.setItem('refreshToken', r); }, [tok.accessToken, tok.refreshToken]);
const page = await ctx.newPage();
const walkInRequests = [];
const walkInChunks = [];
page.on('request', (r) => {
  const u = r.url();
  if (u.includes('/pos-rentals')) walkInRequests.push(`${r.method()} ${u}`);
  if (/pos-rental|PosRentalMode/i.test(u) && !u.includes('/api/v1/')) walkInChunks.push(u);
});
console.log(`real admin ${ADMIN} -> ${API} · mode ${MODE} · SUPER_ADMIN`);

let caps;
await check('SUPER_ADMIN opens the POS (sale screen); the page asks the server for capabilities', async () => {
  const capsResp = page.waitForResponse((r) => r.url().includes('/pos/capabilities'), { timeout: 240000 }).catch(() => null);
  await page.goto(`${ADMIN}/dashboard/pos`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await page.getByText('NARO FASHION POS').waitFor({ timeout: 240000 });
  const r = await capsResp;
  caps = r ? await r.json().catch(() => null) : null;
  await page.waitForTimeout(2500); // let the capabilities state settle
  return JSON.stringify(caps);
});

if (MODE === 'gate' || MODE === 'recut') {
  await check('no Rental toggle, no walk-in screen, no /pos-rentals request, walk-in screen code never downloaded', async () => {
    assert((await page.getByTestId('pos-mode-rental').count()) === 0, 'Rental toggle shown');
    assert((await page.getByTestId('pos-mode-sale').count()) === 0, 'mode toggle shown');
    assert((await page.getByTestId('rental-mode').count()) === 0, 'walk-in screen mounted');
    assert((await page.getByRole('tab', { name: /rental/i }).count()) === 0, 'rental tab');
    assert(walkInRequests.length === 0, walkInRequests.join(', '));
    assert(walkInChunks.length === 0, walkInChunks.join(', '));
    return `capabilities ${JSON.stringify(caps)}`;
  });
}
if (MODE === 'servicing') {
  await check('"Rental bookings" tab only: open-a-booking card; no new-booking column, no customer registration', async () => {
    const tab = page.getByTestId('pos-mode-rental');
    await tab.waitFor({ timeout: 20000 });
    assert(/Rental bookings/.test(await tab.innerText()), await tab.innerText());
    await tab.click();
    await page.getByTestId('rental-mode').waitFor();
    assert((await page.getByTestId('rental-ref').count()) === 1, 'open-a-booking input');
    for (const t of ['rental-search', 'rental-check', 'rental-customer-search', 'rental-new-customer', 'rental-terms', 'rental-book']) {
      assert((await page.getByTestId(t).count()) === 0, `${t} shown`);
    }
    assert(walkInRequests.length === 0, walkInRequests.join(', '));
  });
}
if (MODE === 'override') {
  await check('with the API test override (non-production only) the server reports released and the full Rental toggle appears', async () => {
    const tab = page.getByTestId('pos-mode-rental');
    await tab.waitFor({ timeout: 20000 });
    assert((await tab.innerText()).trim() === 'Rental', await tab.innerText());
    await tab.click();
    await page.getByTestId('rental-search').waitFor();
    return `capabilities ${JSON.stringify(caps)}`;
  });
}
await browser.close();
const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
