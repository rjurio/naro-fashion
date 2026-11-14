// Round 25F D: the admin Checklists screen's two-person approval flow.
// Real admin UI (next dev) -> real API -> isolated schema seeded by
// pos-rental-seed.js (template-approval build: seeds tplApprover). Never production.
//   IT_ADMIN=http://localhost:3185 IT_API=http://localhost:4185/api/v1 IT_SCHEMA=it_tpl PSQL=<psql> \
//     node template-approval.browser.it.mjs <worktree> <ids.json> <screenshot-dir>
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const { chromium } = createRequire(process.argv[2] + '/apps/storefront/package.json')('playwright');
const ids = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const SHOTS = process.argv[4]; mkdirSync(SHOTS, { recursive: true });
const ADMIN = process.env.IT_ADMIN || 'http://localhost:3132';
const API = process.env.IT_API || 'http://localhost:4130/api/v1';
if (!/^http:\/\/localhost:/.test(ADMIN) || !/^http:\/\/localhost:/.test(API)) throw new Error('refusing: localhost only');
const SCHEMA = process.env.IT_SCHEMA || 'it_pos';
const T = ids.tenantId;
const sql = (q) => execFileSync(process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe', ['-U', 'naro_admin', '-h', 'localhost', '-d', 'naro_fashion', '-w', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO ${SCHEMA}`, '-c', q], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8' }).trim();
const results = [];
async function check(name, fn) {
  try { const n = await fn(); results.push('PASS'); console.log(`  ✔ ${name}${n ? `  — ${n}` : ''}`); }
  catch (e) { results.push('FAIL'); console.log(`  ✖ ${name}\n      ${String(e?.message || e).split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const xff = (s) => { const h = createHash('sha256').update(s).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
const api = async (method, p, token, body) => {
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': T, 'X-Forwarded-For': xff(token || body?.email || p), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const login = async (who) => (await api('POST', '/auth/login', null, { email: who.email, password: who.password })).data;
assert(ids.admins.tplApprover, 'the seed has no tplApprover (needs a template-approval build)');

const browser = await chromium.launch();
async function as(who) {
  const tok = await login(who);
  assert(tok?.accessToken, `login ${who.email}`);
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  await ctx.addInitScript(([a, r]) => { localStorage.setItem('token', a); localStorage.setItem('refreshToken', r); }, [tok.accessToken, tok.refreshToken]);
  return { ctx, token: tok.accessToken };
}
const superA = await as(ids.admins.super);
const checker = await as(ids.admins.checker);
const approver = await as(ids.admins.tplApprover);

const NAME = `Veil set (browser ${Date.now().toString(36)})`;
// Prepared by the SUPER_ADMIN: the author can't approve it, SUPER_ADMIN included.
const created = await api('POST', '/rental-checklists/templates', superA.token, { name: NAME, productId: ids.zero.id, items: [
  { label: 'Veil', itemType: 'DISPATCH', quantity: 1 },
  { label: 'Veil pouch', itemType: 'DISPATCH', quantity: 2, requiresCondition: false },
] });
assert(created.status === 201 && created.data?.approvalStatus === 'DRAFT', `template ${created.status} ${JSON.stringify(created.data).slice(0, 160)}`);
const TID = created.data.id;
const row = (p) => p.getByText(NAME).first().locator('xpath=ancestor::*[.//*[@data-testid="template-status"]][1]');
const db = () => sql(`SELECT "approvalStatus" || '|' || coalesce("approvedVersion"::text, '') || '|' || coalesce("approvedById", '') || '|' || version || '|' || coalesce("withdrawnById", '') FROM "RentalChecklistTemplate" WHERE id = '${TID}'`);
async function openList(ctx) {
  const p = await ctx.newPage();
  await p.goto(`${ADMIN}/dashboard/rentals/checklists`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await p.getByText(NAME).first().waitFor({ timeout: 180000 });
  return p;
}
async function openApprove(p) {
  await p.getByRole('button', { name: `Approve ${NAME}` }).click();
  const d = p.getByTestId('template-approval-dialog');
  await d.waitFor({ timeout: 20000 });
  return d;
}
const tickAll = async (d) => {
  await d.getByLabel('Confirm scope').check();
  await d.getByLabel('Confirm Veil', { exact: true }).check();
  await d.getByLabel('Confirm Veil pouch').check();
};

console.log(`real admin ${ADMIN} -> API ${API} · schema ${SCHEMA} · checklist template approval (browser)`);

await check('the list shows the new template as "Draft — needs a second person · v1"', async () => {
  const p = await openList(checker.ctx);
  const t = (await row(p).getByTestId('template-status').innerText()).trim();
  assert(/Draft — needs a second person · v1/.test(t), `badge: ${t}`);
  await p.screenshot({ path: `${SHOTS}/tpl-01-draft.png`, fullPage: true });
  await p.close();
});

await check('the SUPER_ADMIN who prepared it ticks everything and approves → refused on screen; still DRAFT; denial audited', async () => {
  const p = await openList(superA.ctx);
  const d = await openApprove(p);
  await tickAll(d);
  await d.getByRole('button', { name: 'Approve this version' }).click();
  await d.getByRole('alert').waitFor({ timeout: 20000 });
  const msg = (await d.getByRole('alert').innerText()).trim();
  await p.screenshot({ path: `${SHOTS}/tpl-02-self-approval-refused.png`, fullPage: true });
  assert(db().startsWith('DRAFT||'), `db: ${db()}`);
  assert(Number(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE "entityId" = '${TID}' AND action = 'TEMPLATE_APPROVAL_DENIED'`)) >= 1, 'denial not audited');
  await p.close();
  return msg.slice(0, 90);
});

await check('the independent approver: "Approve this version" stays disabled until the scope AND every item quantity are ticked; approval → "Approved · v1"', async () => {
  const p = await openList(approver.ctx);
  const d = await openApprove(p);
  const btn = d.getByRole('button', { name: 'Approve this version' });
  assert(await btn.isDisabled(), 'enabled with nothing ticked');
  // The scope is shown by NAME (the approver confirms it against the real item), not as a raw id.
  await d.getByText('product IT Veil (no down payment)').waitFor({ timeout: 20000 });
  await d.getByLabel('Confirm scope').check();
  await d.getByLabel('Confirm Veil', { exact: true }).check();
  assert(await btn.isDisabled(), 'enabled with one item unticked');
  assert(/2 ×/.test(await d.getByText('Veil pouch').first().locator('xpath=..').innerText()), 'quantity 2 not shown');
  await d.getByLabel('Confirm Veil pouch').check();
  assert(await btn.isEnabled(), 'still disabled with everything ticked');
  await p.screenshot({ path: `${SHOTS}/tpl-03-approve-dialog.png`, fullPage: true });
  await btn.click();
  await p.getByText('Checklist approved').first().waitFor({ timeout: 20000 });
  await d.waitFor({ state: 'detached', timeout: 20000 });
  const t = (await row(p).getByTestId('template-status').innerText()).trim();
  assert(/Approved · v1/.test(t), `badge: ${t}`);
  const [st, av, by] = db().split('|');
  assert(st === 'APPROVED' && av === '1' && by === ids.admins.tplApprover.id, `db: ${db()}`);
  assert(Number(sql(`SELECT count(*) FROM "AdminActivityLog" WHERE "entityId" = '${TID}' AND action = 'TEMPLATE_APPROVED'`)) === 1, 'approval not audited once');
  await p.screenshot({ path: `${SHOTS}/tpl-04-approved.png`, fullPage: true });
  await p.close();
});

await check('an edit (template editor, via the API) sends it back to "Draft · v2"; the approver can withdraw it with a reason (≥ 10 chars) → "Withdrawn"', async () => {
  const u = await api('PUT', `/rental-checklists/templates/${TID}`, checker.token, { items: [
    { label: 'Veil', itemType: 'DISPATCH', quantity: 1 }, { label: 'Veil pouch', itemType: 'DISPATCH', quantity: 1, requiresCondition: false }] });
  assert(u.status === 200 && u.data?.approvalStatus === 'DRAFT' && u.data?.version === 2, `edit ${u.status} ${JSON.stringify(u.data).slice(0, 120)}`);
  const p = await openList(approver.ctx);
  const t = (await row(p).getByTestId('template-status').innerText()).trim();
  assert(/Draft — needs a second person · v2/.test(t), `badge after edit: ${t}`);
  await p.getByRole('button', { name: `Withdraw ${NAME}` }).click();
  const d = p.getByTestId('template-approval-dialog');
  await d.waitFor({ timeout: 20000 });
  const btn = d.getByRole('button', { name: 'Withdraw' });
  await d.getByLabel('Withdrawal reason').fill('too short');
  assert(await btn.isDisabled(), 'enabled with a 9-character reason');
  await d.getByLabel('Withdrawal reason').fill('Veil retired from the rental range');
  await btn.click();
  await p.getByText('Checklist withdrawn').first().waitFor({ timeout: 20000 });
  const t2 = (await row(p).getByTestId('template-status').innerText()).trim();
  assert(/Withdrawn/.test(t2), `badge: ${t2}`);
  const parts = db().split('|');
  assert(parts[0] === 'WITHDRAWN' && parts[4] === ids.admins.tplApprover.id, `db: ${db()}`);
  await p.screenshot({ path: `${SHOTS}/tpl-05-withdrawn.png`, fullPage: true });
  await p.close();
});

await browser.close();
const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
