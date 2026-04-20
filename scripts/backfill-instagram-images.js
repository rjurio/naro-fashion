// One-off backfill: mirror Instagram CDN images to local disk so the
// storefront feed survives Instagram's ~24h signed-URL expiry.
//
// What this does:
//   1. Calls the Instagram Graph API for the tenant's latest 50 media
//   2. Downloads each media_url (or thumbnail_url for VIDEO posts) to
//      apps/api/uploads/instagram/{mediaId}.jpg
//   3. Upserts InstagramPost rows, overwriting any stale remote imageUrl
//      with the local /uploads/instagram/... path
//
// Env vars required (read from apps/api/.env or process env):
//   INSTAGRAM_ACCESS_TOKEN
//   INSTAGRAM_BUSINESS_ACCOUNT_ID
//
// Usage (on VPS):
//   cd /var/www/naro-fashion && node scripts/backfill-instagram-images.js
//
// Safe to run multiple times — existing files are kept, existing rows
// are updated in place. No-op if the token/account ID env vars are
// missing.

const path = require('path');
const fs = require('fs');
const { pipeline } = require('stream/promises');

// axios isn't hoisted to the repo root — resolve it from apps/api where
// NestJS declares it as a dependency. Same rationale as PrismaClient.
const axios = require(path.join(__dirname, '..', 'apps', 'api', 'node_modules', 'axios'));
const { PrismaClient } = require(path.join(__dirname, '..', 'packages', 'database', 'node_modules', '@prisma', 'client'));

// Tiny in-script .env loader so we don't pull in the dotenv package.
// Loads INSTAGRAM_* (and anything else) from the three .env files into
// process.env without overriding vars that are already set.
function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv(path.join(__dirname, '..', 'apps', 'api', '.env'));
loadEnv(path.join(__dirname, '..', '.env'));
loadEnv(path.join(__dirname, '..', 'packages', 'database', '.env'));

const UPLOADS_DIR = path.join(__dirname, '..', 'apps', 'api', 'uploads', 'instagram');

async function downloadMedia(remoteUrl, mediaId) {
  const pathPart = remoteUrl.split('?')[0];
  const extMatch = pathPart.match(/\.(jpe?g|png|webp|gif|mp4)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
  const fileName = `${mediaId}.${ext}`;
  const finalPath = path.join(UPLOADS_DIR, fileName);
  const publicPath = `/uploads/instagram/${fileName}`;

  if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 0) {
    return { publicPath, skipped: true };
  }

  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const tmpPath = `${finalPath}.part`;

  const response = await axios.get(remoteUrl, {
    responseType: 'stream',
    timeout: 30000,
    maxContentLength: 15 * 1024 * 1024,
  });
  await pipeline(response.data, fs.createWriteStream(tmpPath));
  fs.renameSync(tmpPath, finalPath);

  return { publicPath, skipped: false };
}

async function main() {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const accountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

  if (!token || !accountId) {
    console.error('Missing INSTAGRAM_ACCESS_TOKEN or INSTAGRAM_BUSINESS_ACCOUNT_ID');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const tenant = await prisma.tenant.findFirst({ where: { status: 'ACTIVE' }, select: { id: true, slug: true } });
  if (!tenant) {
    console.error('No active tenant found');
    process.exit(1);
  }
  console.log(`Tenant: ${tenant.slug} (${tenant.id})`);

  console.log('Fetching latest 50 media from Graph API...');
  const apiUrl = `https://graph.facebook.com/v25.0/${accountId}/media`;
  const response = await axios.get(apiUrl, {
    params: {
      fields: 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp',
      access_token: token,
      limit: 50,
    },
    timeout: 15000,
  });

  const posts = response.data?.data || [];
  console.log(`Got ${posts.length} media items.\n`);

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const post of posts) {
    const remoteUrl = post.media_type === 'VIDEO'
      ? (post.thumbnail_url || post.media_url)
      : post.media_url;

    if (!remoteUrl) {
      console.log(`  [skip] ${post.id}: no media_url`);
      continue;
    }

    try {
      const { publicPath, skipped: wasSkipped } = await downloadMedia(remoteUrl, post.id);
      if (wasSkipped) skipped++;
      else downloaded++;

      await prisma.instagramPost.upsert({
        where: { instagramMediaId: post.id },
        update: {
          tenantId: tenant.id,
          caption: post.caption || null,
          imageUrl: publicPath,
          postUrl: post.permalink || null,
          mediaType: post.media_type || null,
          postedAt: post.timestamp ? new Date(post.timestamp) : null,
        },
        create: {
          tenantId: tenant.id,
          instagramMediaId: post.id,
          caption: post.caption || null,
          imageUrl: publicPath,
          postUrl: post.permalink || null,
          likes: 0,
          mediaType: post.media_type || null,
          postedAt: post.timestamp ? new Date(post.timestamp) : null,
          source: 'INSTAGRAM_API',
          isActive: true,
          sortOrder: 0,
        },
      });

      const label = wasSkipped ? 'keep' : 'save';
      console.log(`  [${label}] ${post.id} -> ${publicPath}`);
    } catch (err) {
      failed++;
      console.error(`  [fail] ${post.id}: ${err.message}`);
    }
  }

  console.log(`\n=== BACKFILL SUMMARY ===`);
  console.log(`  downloaded: ${downloaded}`);
  console.log(`  already cached: ${skipped}`);
  console.log(`  failed: ${failed}`);
  console.log(`  total media: ${posts.length}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
