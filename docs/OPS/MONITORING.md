# Monitoring & Alerting

Status: **operator action required** — nothing in this document is live until the steps marked **[MANUAL]** are done. All services below have free tiers sufficient for Naro Fashion.

| Signal | Tool | Catches |
|---|---|---|
| Site / API up | UptimeRobot (free: 50 monitors, 5-min interval) | VPS down, Nginx/PM2 crash, SSL expiry, DNS breakage |
| Backups ran | Healthchecks.io (free: 20 checks) | cron not running, pg_dump failing, off-site upload failing |
| App errors | Sentry (free Developer plan: 1 user, ~5k errors/mo) | unhandled exceptions in API / storefront / admin |
| Deploy health | `deploy.sh` post-restart checks | build didn't serve, wrong commit deployed (CI goes red) |

---

## 1. Uptime monitors — UptimeRobot [MANUAL]

1. Sign up at https://uptimerobot.com (free plan). Add your email (and optionally the mobile app for push alerts).
2. Create three **HTTP(s)** monitors, interval 5 min:

   | Name | URL | Expect |
   |---|---|---|
   | Naro storefront | `https://narofashion.co.tz` | 200 |
   | Naro admin | `https://admin.narofashion.co.tz` | 200 (3xx to login is also fine — UptimeRobot follows redirects) |
   | Naro API health | `https://api.narofashion.co.tz/api/v1/health` | 200; optionally a **Keyword** monitor on a field the health JSON returns (e.g. `"ok"`) |

3. For the API monitor, enable **SSL certificate expiry** alerts (warn 14 days before) — catches a broken Let's Encrypt renewal.
4. Alert contacts: email at minimum. Set "notify after 2 failures" to avoid alerts on a 1-minute deploy restart.
5. Optional: a public status page (UptimeRobot → Status Pages) to share with tenants.

Note: `/api/v1/health` is a new endpoint (shipped alongside the deploy hardening). Until it is live on prod, point the API monitor at `https://api.narofashion.co.tz/api/v1/cms/storefront-stats` with header `X-Tenant-Id: <id>` instead.

Alternative: Healthchecks.io can't do HTTP probing; Better Stack / Uptime Kuma (self-hosted — but on the same VPS it can't alert when the VPS dies) are the other options.

## 2. Backup dead-man's switches — Healthchecks.io [MANUAL]

1. Sign up at https://healthchecks.io (free Hobbyist plan). Add an email integration (and optionally Telegram/WhatsApp-via-webhook).
2. Create two checks:

   | Name | Schedule | Grace | Env var |
   |---|---|---|---|
   | `naro-pg-backup` | Cron `15 3 * * *`, UTC | 2 h | `HEALTHCHECK_PGBACKUP_URL` |
   | `naro-offsite-backup` | Cron `0 4 * * *`, UTC | 2 h | `HEALTHCHECK_BACKUP_URL` |

3. Copy each check's ping URL (`https://hc-ping.com/<uuid>`) into `/etc/naro-backup.env` on the VPS (mode 600) — see [BACKUPS.md](BACKUPS.md) step 5.
4. Re-install the scripts to `/usr/local/bin` (BACKUPS.md step 6) so cron runs the versions that ping.
5. Test: `sudo /usr/local/bin/naro-pg-backup.sh` — the check should turn green within seconds. Both scripts send `/start`, then success or `/fail`, so Healthchecks also shows run duration.

Pre-deploy dumps (from `deploy.sh`) intentionally do **not** ping, so a deploy can never mask a missed nightly backup.

## 3. Error tracking — Sentry (outline) [MANUAL + code change]

This needs a small code change in the apps (owned by app developers, not done in this ops pass). Outline:

1. **[MANUAL]** Sign up at https://sentry.io (free Developer plan). Create one organization and three projects: `naro-api` (Node / NestJS), `naro-storefront` (Next.js), `naro-admin` (Next.js). Copy each project's DSN.
2. **[MANUAL — VPS env]** Add to the env files (remember the three-file `.env` sprawl — CLAUDE.md "Env File Sprawl"; keep values consistent):
   - API (`apps/api/.env`, and root/database `.env` if duplicated): `SENTRY_DSN=<naro-api DSN>`, `SENTRY_ENVIRONMENT=production`
   - Storefront: `NEXT_PUBLIC_SENTRY_DSN=<naro-storefront DSN>` (build-time — must be present **before** `pnpm --filter storefront build`), `SENTRY_DSN=<same>` for server-side
   - Admin: `NEXT_PUBLIC_SENTRY_DSN=<naro-admin DSN>`, `SENTRY_DSN=<same>`
   - Release tagging: `deploy.sh` already exports `GIT_SHA` into the PM2 env; use it as `release`.
3. **[CODE — API]** `pnpm add @sentry/nestjs --filter api`; create `apps/api/src/instrument.ts` calling `Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.SENTRY_ENVIRONMENT, release: process.env.GIT_SHA, tracesSampleRate: 0 })` and import it **first** in `main.ts`; add `SentryModule.forRoot()` to `AppModule` and `SentryGlobalFilter`. No-op when `SENTRY_DSN` is unset (dev).
   - Set `sendDefaultPii: false` and add a `beforeSend` that strips `authorization`, `cookie`, `x-tenant-id` headers and request bodies on `/auth/*` and `/id-verification/*` — the platform handles national ID data.
4. **[CODE — Next apps]** `pnpm add @sentry/nextjs --filter storefront --filter admin`; add `instrumentation.ts` + `sentry.client.config.ts`/`instrumentation-client.ts` per the Sentry Next.js guide; wrap `next.config.js` with `withSentryConfig` (source-map upload optional — needs `SENTRY_AUTH_TOKEN`, skip on the 2GB VPS to save build memory).
5. **[MANUAL]** In Sentry, set alert rules: "a new issue is created" → email; "issue seen > 50 times in 1h" → email.
6. Keep `tracesSampleRate` at 0 (or ≤0.05) to stay inside the free quota.

## 4. What the deploy pipeline checks (automatic)

- CI `verify` job (typecheck ×3, API jest, `pnpm audit --prod --audit-level=critical`) must pass before `deploy` runs.
- `deploy.sh` asserts the VPS HEAD equals the CI commit (`EXPECTED_SHA`), verifies each Next build produced `BUILD_ID` + `routes-manifest.json` before restarting, and after `pm2 reload` polls `http://127.0.0.1:4000/api/v1/health`, `:3000/`, `:3001/` for up to 60 s each. Any failure → non-zero exit → red CI run (GitHub emails the pusher).
- Recommended: enable GitHub → Settings → Notifications → Actions → "Send notifications for failed workflows only".

## Quick triage when an alert fires

```bash
ssh root@80.240.30.107
pm2 status && pm2 logs --lines 50 --nostream
curl -s http://127.0.0.1:4000/api/v1/health
cd /var/www/naro-fashion && git log --oneline -1
tail -20 /var/log/naro-pg-backup.log /var/log/naro-offsite-backup.log
df -h /    # full disk is the classic cause of backup + DB failures
```

See also `docs/OPERATIONS_RUNBOOK.md` for incident response.
