// NON-DESTRUCTIVE live checks for the CMS release (PR #21). Writes NOTHING to
// production: it only reads pages (public API) and sends two page updates that
// are rejected by design (a malformed version and a stale version), then
// proves nothing changed.
//
//   node cms-live-probe.mjs snapshot <out.json>        # before the deploy (no token needed)
//   ADMIN_TOKEN=... node cms-live-probe.mjs verify <snapshot.json> <expected-sha>
//
// ADMIN_TOKEN is read from the environment and never printed or stored.
// NODE_OPTIONS=--use-system-ca on the office network.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// Overridable ONLY for a local rehearsal against a copy of the release code.
const API = process.env.PROBE_API || 'https://api.narofashion.co.tz/api/v1';
const STORE = process.env.PROBE_STORE || 'https://narofashion.co.tz';
const TENANT = process.env.PROBE_TENANT || 'cmmxulgmi0000csxzrropa4tw';
const FAQ_ID = process.env.PROBE_FAQ_ID || 'cmmxunpf7001ncs0a19916k3p';
const sha = (s) => createHash('sha256').update(s ?? '', 'utf8').digest('hex');
let fails = 0;
const ok = (m) => console.log(`  ✔ ${m}`);
const no = (m) => { fails++; console.log(`  ✖ ${m}`); };

async function pages() {
  const r = await fetch(`${API}/cms/pages`, { headers: { 'X-Tenant-Id': TENANT } });
  if (r.status !== 200) throw new Error(`GET /cms/pages ${r.status}`);
  const j = await r.json();
  const list = Array.isArray(j) ? j : j.data ?? [];
  return Object.fromEntries(list.map((p) => [p.id, {
    slug: p.slug, updatedAt: p.updatedAt, isPublished: p.isPublished,
    title: sha(p.title), titleSwahili: sha(p.titleSwahili), content: sha(p.content), contentSwahili: sha(p.contentSwahili),
  }]));
}

const [mode, file, expectedSha] = process.argv.slice(2);
if (mode === 'snapshot') {
  const snap = await pages();
  writeFileSync(file, JSON.stringify(snap, null, 2));
  console.log(`snapshot of ${Object.keys(snap).length} pages written to ${file}`);
  process.exit(0);
}
if (mode !== 'verify' || !file || !/^[0-9a-f]{40}$/.test(expectedSha ?? '')) {
  console.log('usage: snapshot <out.json> | verify <snapshot.json> <expected-40-char-sha>');
  process.exit(2);
}
const token = process.env.ADMIN_TOKEN;
if (!token) { console.log('STOP: ADMIN_TOKEN is required for verify'); process.exit(2); }
const before = JSON.parse(readFileSync(file, 'utf8'));

console.log('== CMS release live verification (non-destructive)');
const h = await (await fetch(`${API}/health`)).json();
h.commit === expectedSha && h.db === 'ok' ? ok(`health ok, commit ${expectedSha.slice(0, 7)}`) : no(`health ${JSON.stringify(h)}`);

const now1 = await pages();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
for (const [id, p] of Object.entries(before)) {
  same(now1[id], p) ? ok(`page ${p.slug}: EN + SW title/content and updatedAt unchanged by the deploy`) : no(`page ${p.slug} changed: ${JSON.stringify(now1[id])}`);
}
Object.keys(now1).length === Object.keys(before).length ? ok(`${Object.keys(now1).length} pages, none added or removed`) : no('page count changed');

const patch = (body) => fetch(`${API}/cms/pages/${FAQ_ID}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': TENANT, Authorization: `Bearer ${token}` },
  body: JSON.stringify(body),
});
// 1. malformed version: refused by validation before the handler runs
const a = await patch({ expectedUpdatedAt: 'not-a-date' });
const at = await a.text();
a.status === 400 && /ISO 8601/.test(at) ? ok('malformed expectedUpdatedAt → 400 (new code validates it)')
  : no(`malformed version → ${a.status} ${at.slice(0, 120)} (old code says "should not exist")`);
// 2. stale version: the atomic version check refuses, nothing written
const b = await patch({ expectedUpdatedAt: '2000-01-01T00:00:00.000Z' });
const bt = await b.text();
b.status === 409 && /CONFLICT/.test(bt) ? ok('stale expectedUpdatedAt → 409 CONFLICT (atomic version check live, nothing written)')
  : no(`stale version → ${b.status} ${bt.slice(0, 120)}`);

const now2 = await pages();
same(now2, before) ? ok('after the probes: every page still identical (EN + SW, updatedAt) — nothing was written')
  : no('a page changed after the probes — investigate');

if (process.env.PROBE_SKIP_STORE !== '1') {
  const f = await fetch(`${STORE}/pages/faq`, { redirect: 'follow' });
  f.status === 200 ? ok('storefront /pages/faq 200') : no(`storefront /pages/faq ${f.status}`);
}

console.log(fails ? `\nVERIFY FAILED: ${fails} problem(s)` : '\nVERIFY PASSED');
process.exit(fails ? 1 : 0);
