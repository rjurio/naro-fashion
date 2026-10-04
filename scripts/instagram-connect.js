#!/usr/bin/env node
// Connect a tenant's Instagram feed with a NON-EXPIRING Facebook Page token.
//
// Same flow as Admin → CMS → Instagram → Connect (POST /cms/instagram/connect)
// without the HTTP layer — use it when the admin UI is unavailable.
//
//   1. exchange the pasted User token (Graph API Explorer) for a long-lived
//      user token (fb_exchange_token, app id/secret from apps/api/.env)
//   2. GET /me/accounts → pick the Page linked to the tenant's Instagram
//      business account (SiteSetting instagram_business_account_id, else
//      env INSTAGRAM_BUSINESS_ACCOUNT_ID, else the only Page with one)
//   3. debug_token the Page token (must be valid; expires_at 0 = never)
//      and test GET /{ig-id}/media?limit=1
//   4. upsert the tenant's SiteSettings (instagram_access_token = Page token,
//      instagram_token_type=PAGE, instagram_page_id/_name, instagram_username,
//      instagram_token_expires_at, instagram_token_checked_at) and clear
//      instagram_last_sync_at so the next hourly sweep (HH:15) syncs.
//
// Never prints a token (last 4 chars at most).
//
// Usage (on the VPS):
//   cd /var/www/naro-fashion
//   node scripts/instagram-connect.js <tenantSlug>            # paste token on stdin
//   node scripts/instagram-connect.js <tenantSlug> <userToken> # (lands in shell history)

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const GRAPH = 'https://graph.facebook.com/v25.0';

// Same precedence the API sees at boot: Prisma's .env first, never override.
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadEnv(path.join(ROOT, 'packages', 'database', '.env'));
loadEnv(path.join(ROOT, 'apps', 'api', '.env'));
loadEnv(path.join(ROOT, '.env'));

const { PrismaClient } = require(path.join(ROOT, 'packages', 'database', 'node_modules', '@prisma', 'client'));

const hint = (t) => (t ? `…${String(t).slice(-4)}` : '(none)');

function fail(msg) {
  console.error(`FAILED: ${msg}`);
  process.exitCode = 1;
}

async function graphGet(url, params) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, String(v));
  const res = await fetch(u, { signal: AbortSignal.timeout(15000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const e = body.error || {};
    const err = new Error(`${e.type || 'GraphError'} code ${e.code ?? res.status}: ${e.message || res.statusText}`);
    err.code = e.code;
    throw err;
  }
  return body;
}

async function readStdin() {
  if (process.stdin.isTTY) process.stderr.write('Paste the User access token, then press Enter: ');
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => {
      data += c;
      if (data.includes('\n')) {
        process.stdin.pause();
        resolve(data.split('\n')[0]);
      }
    });
    process.stdin.on('end', () => resolve(data));
  });
}

async function main() {
  const slug = process.argv[2];
  if (!slug) return fail('usage: node scripts/instagram-connect.js <tenantSlug> [userToken]');
  const userToken = (process.argv[3] || (await readStdin()) || '').trim();
  if (!userToken) return fail('no User access token supplied');

  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) return fail('FACEBOOK_APP_ID / FACEBOOK_APP_SECRET missing from apps/api/.env');

  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findUnique({ where: { slug }, select: { id: true, name: true } });
    if (!tenant) return fail(`no tenant with slug "${slug}"`);
    const tenantId = tenant.id;
    const getSetting = async (key) =>
      (await prisma.siteSetting.findUnique({ where: { tenantId_key: { tenantId, key } } }))?.value || null;
    const setSetting = (key, value) =>
      prisma.siteSetting.upsert({
        where: { tenantId_key: { tenantId, key } },
        update: { value },
        create: { tenantId, key, value, type: 'string' },
      });

    // 1. long-lived user token
    let llUser;
    try {
      llUser = (await graphGet(`${GRAPH}/oauth/access_token`, {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: userToken,
      })).access_token;
    } catch (e) {
      return fail(`Facebook rejected the pasted token: ${e.message}`);
    }
    if (!llUser) return fail('Facebook did not return a long-lived token');

    // 2. Pages
    const pages = [];
    let next = null;
    let body = await graphGet(`${GRAPH}/me/accounts`, {
      fields: 'id,name,access_token,instagram_business_account{id,username}',
      limit: 100,
      access_token: llUser,
    });
    for (let i = 0; i < 10; i++) {
      if (Array.isArray(body.data)) pages.push(...body.data);
      next = body.paging && body.paging.next;
      if (!next) break;
      body = await graphGet(next);
    }
    const describe = () =>
      pages.length
        ? pages
            .map((p) => `"${p.name}" (${p.instagram_business_account ? 'IG ' + (p.instagram_business_account.username || p.instagram_business_account.id) : 'no IG linked'})`)
            .join(', ')
        : 'none';
    const withIg = pages.filter((p) => p.instagram_business_account && p.instagram_business_account.id);
    const configured = (await getSetting('instagram_business_account_id')) || process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || '';
    let page;
    if (configured) {
      page = withIg.find((p) => p.instagram_business_account.id === configured);
      if (!page) return fail(`no Page is linked to Instagram account ${configured}. Pages found: ${describe()}`);
    } else if (withIg.length === 1) {
      page = withIg[0];
    } else {
      return fail(`${withIg.length ? 'several Pages' : 'no Page'} with a linked Instagram account. Pages found: ${describe()}`);
    }
    if (!page.access_token) return fail(`Page "${page.name}" came back without a Page token (are you an admin of it?)`);
    const igId = page.instagram_business_account.id;
    const igUsername = page.instagram_business_account.username || null;

    // 3. verify
    const dbg = (await graphGet(`${GRAPH}/debug_token`, {
      input_token: page.access_token,
      access_token: `${appId}|${appSecret}`,
    })).data || {};
    if (!dbg.is_valid) return fail(`Facebook says the Page token is invalid${dbg.error ? ': ' + dbg.error.message : ''}`);
    if (dbg.app_id && String(dbg.app_id) !== String(appId)) return fail('token belongs to a different Facebook app — pick "Narofashion" in Graph API Explorer');
    try {
      await graphGet(`${GRAPH}/${encodeURIComponent(igId)}/media`, { fields: 'id', limit: 1, access_token: page.access_token });
    } catch (e) {
      return fail(`Page token cannot read Instagram media: ${e.message}`);
    }
    const expiresAt = Number(dbg.expires_at) ? new Date(Number(dbg.expires_at) * 1000).toISOString() : 'never';

    // 4. persist (tenant-scoped rows only)
    const now = new Date().toISOString();
    await setSetting('instagram_access_token', page.access_token);
    await setSetting('instagram_business_account_id', igId);
    await setSetting('instagram_token_type', 'PAGE');
    await setSetting('instagram_page_id', page.id);
    await setSetting('instagram_page_name', page.name);
    await setSetting('instagram_username', igUsername || '');
    await setSetting('instagram_token_expires_at', expiresAt);
    await setSetting('instagram_token_checked_at', now);
    await setSetting('instagram_token_valid', 'true');
    await setSetting('instagram_last_sync_at', ''); // next hourly sweep syncs

    console.log(`Tenant:     ${tenant.name} (${slug})`);
    console.log(`Page:       ${page.name}`);
    console.log(`Instagram:  ${igUsername ? '@' + igUsername : igId}`);
    console.log(`Token:      PAGE ${hint(page.access_token)}`);
    console.log(`Expires:    ${expiresAt}`);
    console.log(`Scopes:     ${(dbg.scopes || []).join(', ') || '(none reported)'}`);
    console.log('SUCCESS: Instagram connected. Click "Sync Now" in Admin → CMS → Instagram, or wait for the hourly sync (HH:15).');
  } catch (e) {
    fail(e && e.message ? e.message : String(e));
  } finally {
    await prisma.$disconnect();
  }
}

main();
