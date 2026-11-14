// Real admin UI -> real API -> isolated schema (default it_r4). R4 shift
// reconciliation screen (round 25D F; round 25E: MANAGER and CASHIER views,
// completeness banner, every untagged row listed, overpayment label). Run AFTER
// shift-reconciliation.it.mjs (it leaves the shifts this suite opens).
//   IT_ADMIN=http://localhost:3172 IT_API=http://localhost:4170/api/v1 \
//   node shift-reconciliation.browser.it.mjs <worktree> <ids.json> <screenshot-dir>
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const { chromium } = createRequire(process.argv[2] + '/apps/storefront/package.json')('playwright');
const ids = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const SHOTS = process.argv[4]; mkdirSync(SHOTS, { recursive: true });
const ADMIN = (process.env.IT_ADMIN || 'http://localhost:3172').replace(/\/$/, '');
const API = (process.env.IT_API || 'http://localhost:4170/api/v1').replace(/\/$/, '');
if (!/^http:\/\/localhost:/.test(ADMIN) || !/^http:\/\/localhost:/.test(API)) throw new Error('refusing: local only');
const T = ids.tenantId, SID = ids.sessions.cashier, CSID = ids.sessions.counter, FSID = ids.sessions.finance;
const results = [];
async function check(name, fn) {
  try { const n = await fn(); results.push('PASS'); console.log(`  ✔ ${name}${n ? `  — ${n}` : ''}`); }
  catch (e) { results.push('FAIL'); console.log(`  ✖ ${name}\n      ${String(e?.message || e).split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const xff = (s) => { const h = createHash('sha256').update(s).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
const login = async (w) => {
  const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': T, 'X-Forwarded-For': xff(w.email) }, body: JSON.stringify({ email: w.email, password: w.password }) });
  const d = await r.json(); assert(d?.accessToken, `login ${w.email}`); return d;
};
const browser = await chromium.launch();
const ctxFor = async (w) => {
  const t = await login(w);
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1400 } });
  await ctx.addInitScript(([a, r]) => { localStorage.setItem('token', a); localStorage.setItem('refreshToken', r); }, [t.accessToken, t.refreshToken]);
  return ctx;
};
const text = async (p, id) => (await p.getByTestId(id).first().innerText()).trim();
const openShift = async (ctx, sid, { mineOnly = false } = {}) => {
  const p = await ctx.newPage();
  await p.goto(`${ADMIN}/dashboard/financials/shifts`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  if (mineOnly) await p.getByTestId('shifts-mine-only').check({ timeout: 180000 });
  await p.getByTestId(`shift-${sid}`).getByRole('button').first().click({ timeout: 180000 });
  return p;
};

console.log(`real admin ${ADMIN} -> real API ${API} · shift reconciliation screen (manager + cashier views)`);
const manager = await ctxFor(ids.admins.cashier); // holds reports:view → MANAGER view
await check('MANAGER view of the cashier\'s shift: drawer (expected 466k incl. the row recorded after close, counted 460k, −6k), mismatch notice, INCOMPLETE banner with the two warnings', async () => {
  const p = await openShift(manager, SID);
  await p.getByTestId('shift-reconciliation').waitFor({ timeout: 30000 });
  assert(/Manager view/.test(await text(p, 'recon-view')), 'manager badge');
  assert((await text(p, 'recon-cash-in')) === 'TZS 416,000', `cash in ${await text(p, 'recon-cash-in')}`);
  assert((await text(p, 'recon-expected')) === 'TZS 466,000', 'expected');
  assert((await text(p, 'recon-counted')) === 'TZS 460,000', 'counted');
  assert((await text(p, 'recon-difference')) === 'TZS -6,000', `difference ${await text(p, 'recon-difference')}`);
  assert(/TZS 465,000/.test(await text(p, 'recon-close-mismatch')), 'mismatch notice');
  const banner = p.getByTestId('recon-completeness');
  assert((await banner.getAttribute('data-complete')) === 'false', 'incomplete');
  const b = await banner.innerText();
  assert(/Incomplete/.test(b) && /without a drawer tag/.test(b) && /non-cash row\(s\) by this cashier/.test(b), `banner: ${b}`);
  await p.screenshot({ path: `${SHOTS}/shift-recon-25e-01-manager.png`, fullPage: true });
  await p.close();
});
await check('MANAGER detail: categories, deposits as customer money, every untagged row listed with its reason and the "not in the drawer figure" totals line, shop liabilities', async () => {
  const p = await openShift(manager, SID);
  await p.getByTestId('shift-reconciliation').waitFor({ timeout: 30000 });
  const dep = await text(p, 'recon-receipt-DEPOSIT');
  assert(/Refundable deposits/.test(dep) && /Held for customer/.test(dep) && /TZS 250,000/.test(dep), `deposit row: ${dep}`);
  assert(/Income/.test(await text(p, 'recon-receipt-RENTAL_FEE')), 'fee is income');
  assert(/Layaway/.test(await text(p, 'recon-receipt-LAYAWAY')), 'layaway row');
  assert(/Late fees/.test(await text(p, 'recon-receipt-LATE_FEE')), 'late fee row');
  assert((await text(p, 'recon-net-income')) === 'TZS 260,000', `net income ${await text(p, 'recon-net-income')}`);
  const totals = await text(p, 'recon-not-attributed-totals');
  assert(/cash TZS 7,000 \(1 row\(s\)\)/.test(totals) && /non-cash TZS 30,000/.test(totals) && /not in the drawer figure/.test(totals), `totals: ${totals}`);
  const na = await text(p, 'recon-not-attributed');
  assert(/Received TZS 30,000 · MPESA/.test(na) && /without a shift tag/.test(na), `rows: ${na}`);
  assert((await text(p, 'recon-deposits-held')).startsWith('TZS'), 'shop liabilities shown');
  await p.getByTestId('shift-reconciliation').screenshot({ path: `${SHOTS}/shift-recon-25e-02-manager-detail.png` });
  await p.close();
});
const counter = await ctxFor(ids.admins.counter); // no reports:view → CASHIER view of their own shift
await check('CASHIER view: the till cashier opens THEIR OWN shift ("My shifts only"): their drawer, their untagged M-Pesa listed, shop liabilities hidden, hidden rows counted, incomplete banner', async () => {
  const p = await openShift(counter, CSID, { mineOnly: true });
  await p.getByTestId('shift-reconciliation').waitFor({ timeout: 30000 });
  assert(/Cashier view/.test(await text(p, 'recon-view')), 'cashier badge');
  assert((await text(p, 'recon-expected')) === 'TZS 280,000', `expected ${await text(p, 'recon-expected')}`); // 100k + 30k + 100k + 50k
  assert(/managers \(View Reports\) only/.test(await text(p, 'recon-liabilities-hidden')), 'liabilities hidden');
  assert((await p.getByTestId('recon-deposits-held').count()) === 0, 'no shop figures');
  const na = await text(p, 'recon-not-attributed');
  assert(/Received TZS 10,000 · MPESA/.test(na), `own untagged row: ${na}`);
  assert(/hidden in the cashier view/.test(await text(p, 'recon-hidden-note')), 'hidden rows counted');
  assert((await p.getByTestId('recon-completeness').getAttribute('data-complete')) === 'false', 'incomplete');
  await p.screenshot({ path: `${SHOTS}/shift-recon-25e-03-cashier.png`, fullPage: true });
  await p.close();
});
await check('CASHIER on another cashier\'s shift → a permission message, no reconciliation', async () => {
  const p = await openShift(counter, SID);
  await p.getByText(/Only the cashier who ran this shift/).first().waitFor({ timeout: 30000 });
  assert(!(await p.getByTestId('shift-reconciliation').count()), 'no reconciliation shown');
  await p.screenshot({ path: `${SHOTS}/shift-recon-25e-04-cashier-other-shift.png` });
  await p.close();
});
await check('MANAGER (finance) shift: the overpayment payout reads "Overpayment returned (surplus)", not rental fee', async () => {
  const fin = await ctxFor(ids.admins.finance);
  const p = await openShift(fin, FSID);
  await p.getByTestId('shift-reconciliation').waitFor({ timeout: 30000 });
  assert(/Overpayment returned \(surplus\): TZS 20,000/.test(await text(p, 'recon-rental-payout-OVERPAID')), 'label');
  assert((await p.getByTestId('recon-rental-payout-RENTAL_FEE').count()) === 0, 'not under rental fee');
  assert((await text(p, 'recon-overpaid-returned')) === 'TZS 20,000', 'books line');
  await p.getByTestId('shift-reconciliation').screenshot({ path: `${SHOTS}/shift-recon-25e-05-overpaid.png` });
  await p.close();
});

await browser.close();
const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
