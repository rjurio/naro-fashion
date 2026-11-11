# nginx → API proxy secret (`TRUSTED_PROXY_SECRET`)

**Status: designed and tested in isolation. NOT installed in production.** Installing it changes production nginx and env files, which needs the owner's separate approval and a window.

## What it does
- **Today:** the API believes `X-Forwarded-For` from any local caller (Express `trust proxy` = 1). So a process on the VPS that bypasses nginx can pick a fresh rate-limit bucket per request by forging that header.
- **With the secret:**
  - nginx adds `X-Naro-Proxy-Auth: <secret>` to every request it proxies to the API, and **overwrites** any value a visitor sends;
  - the API believes `X-Forwarded-For` only when that header matches;
  - anything else is keyed by its real socket peer (`peer:127.0.0.1`), so a forging local process shares one bucket.

## Isolated test (no production involvement)
- `.github/workflows/proxy-secret-test.yml` runs the Ubuntu nginx package in front of the real Express app and the throttle-tracker code, using the block below and a test-only secret.
- It proves:
  - visitors get their own bucket;
  - a visitor can't forge the secret header (nginx sends exactly one value, its own);
  - a visitor can't choose a bucket with a forged `X-Forwarded-For`;
  - a visitor never gets the AI exemption;
  - a local process bypassing nginx is keyed by its peer;
  - **the order matters:** env without the nginx header puts every visitor in one bucket.
- Locally the nginx part is skipped (no nginx on Windows); the direct-caller part always runs in the normal jest suite.

## Who can read the secret: the honest limit
- **Root (and any process running as root) can read the secret.** On this VPS that includes Jumuiya (prod and staging), sportflow-web and pm2-logrotate, because they all run under the root PM2 daemon. A compromise of one of those is already a root compromise: it can read the API `.env`, the JWT secrets, nginx config and process memory. The proxy secret does **not** defend against it, and neither does any other in-app control.
- **What it does defend against:** non-root local processes, for example `kiuruwi` (its own user), anything running as `www-data`, or a future app moved to its own user. That holds only if they **can't read** the secret, so:
  - the nginx include holding the secret must be `root:root 0600` (nginx's master process reads its config as root; workers never need it);
  - the three `.env` files must not be world-readable. Check before installing (read-only):
    ```bash
    stat -c '%a %U:%G %n' /var/www/naro-fashion/.env /var/www/naro-fashion/apps/api/.env /var/www/naro-fashion/packages/database/.env /etc/nginx/sites-enabled/*
    ```
    Anything ending in `4` (world-readable) should be fixed to `600` first. That's a separate approved change; it also protects the JWT secrets.
- **Recommendation (separate project):** run Jumuiya and sportflow under their own Unix users, like kiuruwi. Until then, P0d's protection against "another app on the box" is real only for non-root apps.

## Planned production change (owner-approved window only)
1. Generate the secret on the VPS: `openssl rand -hex 24` (48 hex characters). Never paste it into chat, tickets or git.
2. **nginx first.** Create `/etc/nginx/naro-secrets/proxy-auth.conf`:
   - directory `root:root 0700`, file `root:root 0600`;
   - contents: `proxy_set_header X-Naro-Proxy-Auth "<secret>";`

   Then add `include /etc/nginx/naro-secrets/proxy-auth.conf;` inside the `location` blocks of the **`api.narofashion.co.tz` server block only**, next to the existing `proxy_set_header` lines. Never add it to another site's block.

   Run `nginx -t && systemctl reload nginx`. That is nginx's own graceful reload; it isn't PM2 and doesn't touch other apps. The extra header is ignored by the API until step 3, so this step alone changes nothing.
3. **Then the API env.** Add `TRUSTED_PROXY_SECRET=<same>` to **all three** `.env` files: Prisma's dotenv loads first and never overrides. Then reload only the API, through the guard:
   ```bash
   bash scripts/ops/pm2-guard.sh && pm2 reload naro-api --update-env
   ```
   Never `pm2 restart all`; never `systemctl reload pm2-root`.
4. **Verify from outside the VPS** (a phone hotspot, not the office network):
   - `curl -sI https://api.narofashion.co.tz/api/v1/products | grep -i x-ratelimit-remaining`: two quick calls should count down from the same budget;
   - a second network should have its own budget.

   If every visitor shares one budget, the nginx include is missing: roll back (step 5).
5. **Rollback:**
   - remove `TRUSTED_PROXY_SECRET` from the three `.env` files, then the guarded `pm2 reload naro-api --update-env`;
   - optionally remove the include and `nginx -t && systemctl reload nginx`.

   No data is involved.
6. **Rotation:** repeat steps 1–4 with a new value. Brief double-bucketing during the swap is harmless.
