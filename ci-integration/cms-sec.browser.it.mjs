// Real browsers -> local admin (next dev :3142) + storefront (next dev :3143,
// shop it-sec-a) -> local API (:4140) on the isolated schema it_sec.
// CMS release #21 + security fixes #25 / #26 together. Never production.
//   node cms-sec.browser.it.mjs <worktree> <sec-ids.json>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const { chromium } = createRequire(process.argv[2] + '/apps/storefront/package.json')('playwright');
const ids = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const ADMIN = 'http://localhost:3142';
const STORE = 'http://localhost:3143';
const API = 'http://localhost:4140/api/v1';
const sql = (q) => execFileSync(process.env.PSQL || 'C:/Program Files/PostgreSQL/17/bin/psql.exe', ['-U', 'naro_admin', '-h', 'localhost', '-d', 'naro_fashion', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', `SET search_path TO it_sec; ${q}`], { env: { ...process.env, PGPASSWORD: 'Admin123' }, encoding: 'utf8' }).trim();
const results = [];
async function check(name, fn) {
  try { const n = await fn(); results.push('PASS'); console.log(`  ✔ ${name}${n ? `  — ${n}` : ''}`); }
  catch (e) { results.push('FAIL'); console.log(`  ✖ ${name}\n      ${String(e?.message || e).split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const xff = (s) => { const h = createHash('sha256').update(s).digest(); return `10.${h[0]}.${h[1]}.${h[2] || 1}`; };
const login = async (email) => (await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff(email) }, body: JSON.stringify({ email, password: ids.password }) })).json());

const browser = await chromium.launch();
async function adminCtx(email) {
  const tok = await login(email);
  assert(tok?.accessToken, `login ${email}`);
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
  await ctx.addInitScript(([a, r]) => { localStorage.setItem('token', a); localStorage.setItem('refreshToken', r); }, [tok.accessToken, tok.refreshToken]);
  return ctx;
}
const pagesScreen = async (ctx) => {
  const p = await ctx.newPage();
  await p.goto(`${ADMIN}/dashboard/cms/pages`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await p.getByRole('button', { name: /Create Page/ }).first().waitFor({ timeout: 180000 });
  await p.locator('h3').first().waitFor({ timeout: 60000 });
  return p;
};
const row = (p, title) => p.locator('div.grid > div', { has: p.locator('h3', { hasText: title }) });

// Known starting state (the test edits / publishes the draft): re-runnable.
sql(`UPDATE "Page" SET title='SECRET DRAFT a', "isPublished"=false WHERE id='${ids.a.pages.draft}'`);
console.log(`admin ${ADMIN} + storefront ${STORE} -> API -> it_sec`);
const anon = await browser.newContext();
await check('storefront: the published page renders for an anonymous visitor', async () => {
  const p = await anon.newPage();
  await p.goto(`${STORE}/pages/faq`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await p.getByText('public a').first().waitFor({ timeout: 120000 });
  await p.close();
});
await check('storefront: the draft page is not found, and its text appears nowhere', async () => {
  const p = await anon.newPage();
  const r = await p.goto(`${STORE}/pages/upcoming-sale`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await p.waitForTimeout(4000);
  const html = await p.content();
  assert(!html.includes('SECRET DRAFT') && !html.includes('draft-only text'), 'draft text in the page');
  return `HTTP ${r?.status()}`;
});
await check('storefront footer: links the published page, never the draft (it reads the public list)', async () => {
  const p = await anon.newPage();
  let listed = null;
  p.on('response', async (res) => { if (/\/cms\/pages$/.test(new URL(res.url()).pathname)) listed = await res.text().catch(() => null); });
  await p.goto(`${STORE}/`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await p.locator('footer a[href="/pages/faq"]').first().waitFor({ timeout: 120000 });
  assert((await p.locator('footer a[href="/pages/upcoming-sale"]').count()) === 0, 'draft linked in the footer');
  assert(listed && !listed.includes('SECRET') && !listed.includes('"content"'), `public list as seen by the browser: ${String(listed).slice(0, 120)}`);
  await p.close();
});

const ownerA = await adminCtx(ids.a.superEmail);
await check('admin (shop A): the Pages editor lists A\'s published page AND draft, nothing from shop B', async () => {
  const p = await pagesScreen(ownerA);
  await row(p, 'SECRET DRAFT a').waitFor();
  await row(p, 'Published a').waitFor();
  assert((await p.getByText('SECRET DRAFT b').count()) === 0 && (await p.getByText('Published b').count()) === 0, 'shop B page shown');
  assert((await p.getByText('Deleted a').count()) === 0, 'deleted page shown');
  await p.close();
});
await check('admin: editing the draft saves (#21 version check passes on a fresh form)', async () => {
  const p = await pagesScreen(ownerA);
  await row(p, 'SECRET DRAFT a').getByRole('button', { name: /Edit/ }).click();
  await p.getByPlaceholder('Page title in English').fill('SECRET DRAFT a (edited)');
  await p.getByRole('button', { name: 'Update Page' }).click();
  await p.getByText('Page updated').first().waitFor({ timeout: 30000 });
  assert(sql(`SELECT title FROM "Page" WHERE id='${ids.a.pages.draft}'`) === 'SECRET DRAFT a (edited)', 'not saved');
  await p.close();
});
await check('admin: a stale editor never overwrites a newer save (#21): 409 message, nothing written', async () => {
  const p = await pagesScreen(ownerA);
  await row(p, 'SECRET DRAFT a (edited)').getByRole('button', { name: /Edit/ }).click();
  sql(`UPDATE "Page" SET title='changed elsewhere', "updatedAt"=now() AT TIME ZONE 'UTC' + interval '1 second' WHERE id='${ids.a.pages.draft}'`);
  await p.getByPlaceholder('Page title in English').fill('stale overwrite attempt');
  await p.getByRole('button', { name: 'Update Page' }).click();
  await p.getByText(/changed by someone else/).first().waitFor({ timeout: 30000 });
  assert(sql(`SELECT title FROM "Page" WHERE id='${ids.a.pages.draft}'`) === 'changed elsewhere', 'stale save overwrote');
  await p.close();
});
await check('admin: publishing the draft makes it public; unpublishing hides it again', async () => {
  const pub = async () => (await (await fetch(`${API}/cms/pages`, { headers: { 'X-Tenant-Id': ids.a.tenantId, 'X-Forwarded-For': xff('pub') } })).json()).map((x) => x.slug);
  assert(!(await pub()).includes('upcoming-sale'), 'draft already public');
  const p = await pagesScreen(ownerA);
  await row(p, 'changed elsewhere').getByTitle('Publish').click();
  await p.getByText('Page published').first().waitFor({ timeout: 30000 });
  assert((await pub()).includes('upcoming-sale'), 'published page not in the public list');
  await row(p, 'changed elsewhere').getByTitle('Unpublish').click();
  await p.getByText('Page unpublished').first().waitFor({ timeout: 30000 });
  assert(!(await pub()).includes('upcoming-sale'), 'unpublished page still public');
  await p.close();
});
await check('admin: the Size guide screen (also reads the page list) loads without an error', async () => {
  const p = await ownerA.newPage();
  await p.goto(`${ADMIN}/dashboard/cms/size-guide`, { waitUntil: 'domcontentloaded', timeout: 240000 });
  await p.waitForTimeout(8000);
  assert((await p.getByText('Failed to load size guide').count()) === 0, 'load error toast');
  await p.close();
});
const ownerB = await adminCtx(ids.b.superEmail);
await check('admin (shop B): sees only shop B\'s pages', async () => {
  const p = await pagesScreen(ownerB);
  await row(p, 'SECRET DRAFT b').waitFor();
  assert((await p.getByText(/SECRET DRAFT a|Published a|changed elsewhere/).count()) === 0, 'shop A page shown');
  await p.close();
});

await browser.close();
const pass = results.filter((r) => r === 'PASS').length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
