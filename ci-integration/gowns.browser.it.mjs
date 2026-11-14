// Real admin UI (localhost:3132, next dev) -> real API (localhost:4130) ->
// isolated schema it_pos. R2 "Physical gowns" screen: register, count,
// independent approval, rollback. Uses the seed's veil product (no gowns
// before this test). Never production.
//   node gowns.browser.it.mjs <worktree> <pos-ids.json>
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
const P = ids.zero.id;
// Re-runnable: remove this test's gowns and counts for the veil.
sql(`DELETE FROM "RentalUnitTrackingChange" WHERE "productId" = '${P}'; DELETE FROM "RentalUnitVariant" WHERE "unitId" IN (SELECT id FROM "RentalUnit" WHERE "productId" = '${P}'); UPDATE "RentalOrder" SET "rentalUnitId" = NULL WHERE "productId" = '${P}'; DELETE FROM "RentalUnit" WHERE "productId" = '${P}'; UPDATE "Product" SET "rentalUnitTrackingActivatedAt" = NULL WHERE id = '${P}'`);
const T0 = sql(`SELECT (now() AT TIME ZONE 'UTC')::text`);
const active = () => sql(`SELECT ("rentalUnitTrackingActivatedAt" IS NOT NULL)::text FROM "Product" WHERE id = '${P}'`);

const browser = await chromium.launch();
async function as(who) {
  const tok = await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff(who.email) }, body: JSON.stringify({ email: who.email, password: who.password }) })).json();
  assert(tok?.accessToken, `login ${who.email}`);
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
  await ctx.addInitScript(([a, r]) => { localStorage.setItem('token', a); localStorage.setItem('refreshToken', r); }, [tok.accessToken, tok.refreshToken]);
  return ctx;
}
async function openVeil(ctx) {
  const p = await ctx.newPage();
  await p.goto(`${ADMIN}/dashboard/rentals/gowns`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await p.getByTestId('gown-product-search').waitFor({ timeout: 180000 });
  await p.getByTestId('gown-product-search').fill('Veil');
  await p.getByTestId('gown-product-find').click();
  await p.getByTestId('gown-product-it-pos-veil').click();
  await p.getByTestId('gown-tracking').waitFor({ timeout: 30000 });
  return p;
}
const inventory = await as(ids.admins.super);    // holds rentals:manage-inventory (SUPER_ADMIN)
const reviewer = await as(ids.admins.approver);  // holds rentals:approve-unit-tracking (seed)

console.log(`real admin ${ADMIN} -> real API -> it_pos (veil product)`);
let page;
await check('no gowns: the screen says "one booking at a time"', async () => {
  page = await openVeil(inventory);
  assert(/One booking at a time/.test(await page.getByTestId('gown-mode').innerText()), 'mode');
});
await check('register two gowns with tag + size: listed as "not counted"; availability unchanged (still one at a time)', async () => {
  for (const code of ['VEIL-01', 'VEIL-02']) {
    await page.getByTestId('gown-new-code').fill(code);
    await page.getByTestId('gown-new-size-One size').check();
    await page.getByTestId('gown-register').click();
    await page.getByTestId(`gown-row-${code}`).waitFor({ timeout: 30000 });
  }
  assert(/not counted/.test(await page.getByTestId('gown-row-VEIL-02').innerText()), 'not counted');
  assert(active() === 'false' && /One booking at a time/.test(await page.getByTestId('gown-mode').innerText()), 'activated by registering');
});
await check('a count that does not match the registered gowns is refused with the numbers shown', async () => {
  await page.getByTestId('gown-count-input').fill('3');
  await page.getByTestId('gown-count-submit').click();
  await page.getByText(/You counted 3 gown\(s\) but 2 are registered/).first().waitFor({ timeout: 30000 });
  assert(sql(`SELECT count(*) FROM "RentalUnitTrackingChange" WHERE "productId" = '${P}'`) === '0', 'request created');
});
await check('a matching count becomes a request waiting for a second person; the counter\'s own approval is refused', async () => {
  await page.getByTestId('gown-count-input').fill('2');
  await page.getByTestId('gown-count-submit').click();
  await page.getByTestId('gown-open-request').waitFor({ timeout: 30000 });
  await page.getByTestId('gown-approve').click();
  await page.getByText(/different person than the one who submitted it/).first().waitFor({ timeout: 30000 });
  assert(active() === 'false', 'self-approved');
});
await check('the reviewer (a different person) approves: per-gown tracking on, both gowns counted', async () => {
  const r = await openVeil(reviewer);
  await r.getByTestId('gown-approve').click();
  await r.getByText(/per-gown tracking is on/).first().waitFor({ timeout: 30000 });
  assert(/Per-gown tracking on/.test(await r.getByTestId('gown-mode').innerText()), 'mode');
  assert(active() === 'true' && sql(`SELECT count(*) FROM "RentalUnit" WHERE "productId" = '${P}' AND "trackingVerifiedAt" IS NOT NULL`) === '2', 'db');
  await r.close();
});
await check('rollback from the screen: switch off with a reason → one booking at a time again, recorded in the history', async () => {
  const r = await openVeil(reviewer);
  await r.getByTestId('gown-deactivate-reason').fill('rehearsing a rollback');
  await r.getByTestId('gown-deactivate').click();
  await r.getByText(/Back to one booking at a time/).first().waitFor({ timeout: 30000 });
  assert(active() === 'false', 'still active');
  assert(/DEACTIVATE · APPLIED/.test(await r.getByTestId('gown-history').innerText()), 'history');
  assert(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE action IN ('UNIT_TRACKING_REQUESTED','UNIT_TRACKING_APPROVAL_DENIED','UNIT_TRACKING_ACTIVATED','UNIT_TRACKING_DEACTIVATED') AND "entityId" = '${P}' AND "createdAt" >= '${T0}'`) === '4', 'audit rows');
  await r.close();
});

await browser.close();
const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
