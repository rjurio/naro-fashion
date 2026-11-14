// NON-DESTRUCTIVE live checks for security windows W2 (#25 + #26) and W3 (#42).
// It writes NOTHING to production. It sends only:
//   - reads;
//   - requests refused by design, before any write: a stale page version
//     (409), a malformed page version (400), and a PATCH /payments on an id
//     that cannot exist (404). In W3 it also sends an inventory adjust with a
//     forbidden type on a product id that cannot exist: 400 on W3, 404 on the
//     old code, never a write.
//   - unauthenticated writes (401).
// Then it proves no CMS page changed.
//
//   ADMIN_TOKEN=... node sec-live-probe.mjs snapshot <out.json>
//       right before the push. Uses the admin page list (GET /cms/pages/admin)
//       when it exists (W2+). On W1 it falls back to the public list, which
//       still carries drafts and bodies there.
//   ADMIN_TOKEN=... node sec-live-probe.mjs verify-w2 <snapshot.json> <expected-sha>
//   ADMIN_TOKEN=... node sec-live-probe.mjs verify-w3 <snapshot.json> <expected-sha>
//
// ADMIN_TOKEN = a SUPER_ADMIN access token. It is read from the environment and
// never printed or stored. On the office network, add NODE_OPTIONS=--use-system-ca.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// Overridable ONLY for a rehearsal against a local or CI copy of the release code.
const API = process.env.PROBE_API || 'https://api.narofashion.co.tz/api/v1';
const STORE = process.env.PROBE_STORE || 'https://narofashion.co.tz';
const TENANT = process.env.PROBE_TENANT || 'cmmxulgmi0000csxzrropa4tw';
const FAQ_ID = process.env.PROBE_FAQ_ID || 'cmmxunpf7001ncs0a19916k3p';
const FAKE_ID = 'cmnotarealid00000000000000'; // cuid-shaped, cannot exist
const SENSITIVE = /(_secret$|_token$|password|client_secret|api_?key)/i; // = isSensitiveSettingKey
const token = process.env.ADMIN_TOKEN;
const h = (s) => createHash('sha256').update(s ?? '', 'utf8').digest('hex');
let fails = 0;
const ok = (m) => console.log(`  ✔ ${m}`);
const no = (m) => { fails++; console.log(`  ✖ ${m}`); };
const warn = (m) => console.log(`  ⚠ ${m}`);

async function call(method, path, { auth = false, body, tenant = true } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: {
      ...(tenant ? { 'X-Tenant-Id': TENANT } : {}),
      ...(auth ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, text, data };
}
const asList = (d) => (Array.isArray(d) ? d : d?.data ?? []);
const digest = (list) => Object.fromEntries(list.map((p) => [p.id, {
  slug: p.slug, updatedAt: p.updatedAt, isPublished: p.isPublished,
  title: h(p.title), titleSwahili: h(p.titleSwahili), content: h(p.content), contentSwahili: h(p.contentSwahili),
}]));
async function adminPages() {
  const r = await call('GET', '/cms/pages/admin', { auth: true });
  if (r.status !== 200) throw new Error(`GET /cms/pages/admin ${r.status} ${r.text.slice(0, 100)}`);
  return digest(asList(r.data));
}

const [mode, file, expectedSha] = process.argv.slice(2);
if (!token) { console.log('STOP: ADMIN_TOKEN (SUPER_ADMIN access token) is required'); process.exit(2); }

if (mode === 'snapshot') {
  let source = 'admin';
  let r = await call('GET', '/cms/pages/admin', { auth: true });
  if (r.status !== 200) { // W1: the route doesn't exist yet; the public list still has drafts + bodies
    source = 'public';
    r = await call('GET', '/cms/pages');
    if (r.status !== 200) { console.log(`STOP: GET /cms/pages ${r.status}`); process.exit(1); }
  }
  const pages = digest(asList(r.data));
  const drafts = Object.values(pages).filter((p) => p.isPublished !== true).length;
  writeFileSync(file, JSON.stringify({ source, takenAt: new Date().toISOString(), pages }, null, 2));
  console.log(`snapshot (${source} list): ${Object.keys(pages).length} pages, ${drafts} unpublished, written to ${file}`);
  process.exit(0);
}
if (!['verify-w2', 'verify-w3'].includes(mode) || !file || !/^[0-9a-f]{40}$/.test(expectedSha ?? '')) {
  console.log('usage: snapshot <out.json> | verify-w2|verify-w3 <snapshot.json> <expected-40-char-sha>');
  process.exit(2);
}
const snap = JSON.parse(readFileSync(file, 'utf8'));
const before = snap.pages ?? snap; // also accepts a cms-live-probe.mjs snapshot (public list, same digest)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
console.log(`== ${mode} live verification (non-destructive) — ${API}`);

// 1. the right code is live. Stop before anything else if not.
const hr = await call('GET', '/health', { tenant: false });
if (hr.data?.commit === expectedSha && hr.data?.db === 'ok') ok(`health ok, commit ${expectedSha.slice(0, 7)}`);
else { no(`health ${hr.status} ${hr.text.slice(0, 160)}`); console.log('\nVERIFY FAILED: wrong or unhealthy build, nothing else probed'); process.exit(1); }

// 2. CMS pages: nothing rewritten by the deploy (admin list = every page incl. drafts)
const now1 = await adminPages();
for (const [id, p] of Object.entries(before)) {
  same(now1[id], p) ? ok(`page ${p.slug}${p.isPublished ? '' : ' (draft)'}: EN + SW title/content and updatedAt unchanged`) : no(`page ${p.slug} differs: ${JSON.stringify(now1[id])}`);
}
Object.keys(now1).length === Object.keys(before).length ? ok(`${Object.keys(now1).length} pages, none added or removed`) : no('page count changed');

// 3. #25: the public list is published-only with display fields only; drafts stay private
const pub = await call('GET', '/cms/pages');
const pubList = asList(pub.data);
pub.status === 200 ? ok('public GET /cms/pages 200') : no(`public GET /cms/pages ${pub.status}`);
pubList.every((p) => p.isPublished === true) ? ok(`public list: ${pubList.length} published pages, no draft`) : no('public list contains an unpublished page');
pubList.every((p) => !('content' in p) && !('contentSwahili' in p)) ? ok('public list carries no page bodies') : no('public list still returns page bodies');
const pubIds = pubList.map((p) => p.id).sort();
const expPub = Object.entries(before).filter(([, p]) => p.isPublished === true).map(([id]) => id).sort();
same(pubIds, expPub) ? ok('public list = exactly the published pages (footer links intact)') : no(`public list ids ${pubIds} vs published ${expPub}`);
for (const p of Object.values(before).filter((x) => x.isPublished !== true)) {
  const r = await call('GET', `/cms/pages/${encodeURIComponent(p.slug)}`);
  r.status === 404 ? ok(`draft ${p.slug}: not public (404)`) : no(`draft ${p.slug} → ${r.status}`);
}
const anonAdmin = await call('GET', '/cms/pages/admin');
anonAdmin.status === 401 ? ok('anonymous GET /cms/pages/admin → 401') : no(`anonymous GET /cms/pages/admin → ${anonAdmin.status}`);

// 4. public settings still strip secret-valued keys
const st = await call('GET', '/cms/settings');
const keys = asList(st.data).map((s) => s.key);
st.status === 200 && keys.length > 0 ? ok(`public GET /cms/settings 200 (${keys.length} keys)`) : no(`public GET /cms/settings ${st.status}`);
const leaked = keys.filter((k) => SENSITIVE.test(k));
leaked.length === 0 ? ok('no secret-valued setting key in the public settings') : no(`secret keys public: ${leaked.join(', ')}`);

// 5. page editor version check (W1, still live): refused by design, nothing written
const patchFaq = (body) => call('PATCH', `/cms/pages/${FAQ_ID}`, { auth: true, body });
const m = await patchFaq({ expectedUpdatedAt: 'not-a-date' });
m.status === 400 ? ok('malformed page version → 400') : no(`malformed page version → ${m.status} ${m.text.slice(0, 100)}`);
const s = await patchFaq({ expectedUpdatedAt: '2000-01-01T00:00:00.000Z' });
s.status === 409 && /CONFLICT/.test(s.text) ? ok('stale page version → 409 CONFLICT (nothing written)') : no(`stale page version → ${s.status} ${s.text.slice(0, 100)}`);

// 6. #26: PATCH /payments/:id answers normally (no 5xx); unknown id → 404, anonymous → 401
const pAnon = await call('PATCH', `/payments/${FAKE_ID}`, { body: { status: 'COMPLETED' } });
pAnon.status === 401 ? ok('anonymous PATCH /payments/:id → 401') : no(`anonymous PATCH /payments → ${pAnon.status}`);
const pFake = await call('PATCH', `/payments/${FAKE_ID}`, { auth: true, body: { status: 'COMPLETED' } });
pFake.status === 404 ? ok('PATCH /payments/<id that cannot exist> → 404 (nothing to write)') : no(`PATCH /payments/<fake> → ${pFake.status} ${pFake.text.slice(0, 100)}`);

// 7. W3 (#42): inventory writes
if (mode === 'verify-w3') {
  for (const [method, path] of [['POST', '/inventory/adjust'], ['PATCH', `/inventory/${FAKE_ID}/settings`]]) {
    const r = await call(method, path, { body: {} });
    r.status === 401 ? ok(`anonymous ${method} ${path.replace(FAKE_ID, ':id')} → 401`) : no(`anonymous ${method} ${path} → ${r.status}`);
  }
  // Forbidden type on a product that cannot exist: W3 refuses in validation (400);
  // the old code would answer 404 "Product not found". Neither writes anything.
  const t = await call('POST', '/inventory/adjust', { auth: true, body: { productId: FAKE_ID, type: 'SALE', quantity: 1 } });
  if (t.status === 400 && /type/i.test(t.text)) ok('adjust type SALE → 400 (only RESTOCK / ADJUSTMENT / DAMAGE; #42 live)');
  else if (t.status === 403 && /module/i.test(t.text)) warn('inventory module not enabled for this shop: type check not reachable (inconclusive)');
  else no(`adjust type SALE → ${t.status} ${t.text.slice(0, 120)} (404 = old code)`);
  const pr = await call('GET', '/products?limit=1');
  pr.status === 200 ? ok('public GET /products 200') : no(`public GET /products ${pr.status}`);
  const inv = await call('GET', '/inventory?search=zz-probe-no-match', { auth: true });
  inv.status === 200 ? ok('admin GET /inventory 200') : (inv.status === 403 && /module/i.test(inv.text) ? warn('inventory module disabled') : no(`admin GET /inventory ${inv.status}`));
}

// 8. nothing changed by the probes
const now2 = await adminPages();
same(now2, before) ? ok('after the probes: every page still identical — nothing was written') : no('a page changed after the probes — investigate');

if (process.env.PROBE_SKIP_STORE !== '1') {
  for (const p of ['/', '/pages/faq']) {
    const r = await fetch(STORE + p, { redirect: 'follow' });
    r.status === 200 ? ok(`storefront ${p} 200`) : no(`storefront ${p} ${r.status}`);
  }
}
console.log(fails ? `\nVERIFY FAILED: ${fails} problem(s)` : '\nVERIFY PASSED');
process.exit(fails ? 1 : 0);
