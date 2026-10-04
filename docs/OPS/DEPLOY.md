# Deploy and Rollback

Push to `prod` → `.github/workflows/deploy-prod.yml` runs the `verify` job
(typecheck, jest, audit), then SSHes to the VPS and runs
`EXPECTED_SHA=<sha> bash deploy.sh` in `/var/www/naro-fashion`.

## What `deploy.sh` does

| # | Stage | On failure |
|---|-------|-----------|
| 1 | `git fetch` + `reset --hard origin/prod`; assert `HEAD == EXPECTED_SHA`; work out the **live** commit (`.deploy/current_sha` → `/health` `commit` → `ORIG_HEAD`) | abort, nothing changed |
| 2 | `pnpm install --frozen-lockfile` | abort |
| 3 | `prisma generate` | abort |
| 4 | pre-deploy `pg_dump` via `scripts/ops/pg-backup.sh` (path printed) | abort, schema untouched |
| 5 | migrations: one-time 0_init baseline (only if no drift), `prisma migrate deploy`, post-migrate drift guard — see [MIGRATIONS.md](MIGRATIONS.md) | abort, old build still live |
| 6 | sequential IN-PLACE builds: api → storefront → admin, each after copying the live build aside (`dist-prev.pending`, `.next-prev.pending`, cache excluded); each Next build must contain `BUILD_ID` + `routes-manifest.json` | abort, pre-build copies restored, processes not reloaded |
| 7 | promote the pre-build copies to `.next-prev` / `dist-prev`; write `.deploy/previous_sha` + `.deploy/current_sha`; `pm2 reload ecosystem.config.js --update-env` with `GIT_SHA` | automatic rollback |
| 8 | health checks: API `/api/v1/health` 200, storefront `/` (with a real tenant `Host`, from `STOREFRONT_DEFAULT_HOSTS`), admin `/`, **plus one `/_next/static` asset referenced by each app's page must return 200** | **automatic rollback** |

**Why not build to a side directory and rename it?** Tried on 2026-10-04 and it
broke production: `next build` bakes its `distDir` name into the output
(`required-server-files.json`, server chunks), so a build made in
`.next-build` and renamed to `.next` served HTML whose every `/_next/static`
CSS/JS asset returned 404 — an unstyled, non-interactive site for ~6.5 hours.
The HTML-only health check passed, which is why the asset probe now exists.
Trade-off of building in place: pages can misbehave for the few minutes a
build runs (same as before October 2026); a failed build restores the copy.

### Downtime: not zero, and why

All three PM2 apps run in **fork mode, one instance each** on a 2GB VPS, so
`pm2 reload` is a stop/start: a few seconds of 502s per app. True zero
downtime would need cluster mode / two instances behind nginx (or blue-green
ports), which the RAM doesn't allow. The deploy only *minimises* the window
(the swap happens right before the reload, after all builds are done).
Brief caveat: `nest build` rebuilds `apps/api/dist` in place; the running API
keeps its code in memory, but on-demand reads from `dist` (Handlebars email
templates) can fail during the ~1 minute API build.

## Automatic rollback

If anything fails after the swap (reload error, or any health check not
green within 60 s), `deploy.sh`:

1. moves `.next-prev` back to `.next` for each app and `dist-prev` back to
   `dist` (the bad builds are kept as `.next-failed` / `dist-failed`);
2. `git reset --hard <previous_sha>`, `pnpm install --frozen-lockfile` if the
   lockfile differs, `prisma generate` — so source matches the running build;
3. `pm2 reload ecosystem.config.js --update-env` with the old `GIT_SHA`;
4. re-runs the health checks and reports;
5. prints the pre-deploy dump path + `pg_restore` command and **exits
   non-zero** (CI goes red).

The **database is not rolled back**. Migrations are forward-only and must be
backward compatible (expand/contract), so the previous build runs against
the migrated schema. Restore the dump only if it truly can't.

## Manual rollback

```
ssh root@80.240.30.107 "cd /var/www/naro-fashion && bash scripts/ops/rollback.sh --yes"
```

Same steps as the automatic rollback. One-shot: it refuses when
`.deploy/previous_sha` or any of `apps/storefront/.next-prev`,
`apps/admin/.next-prev`, `apps/api/dist-prev` is missing (already rolled
back, or no deploy has kept a previous build), so it can never mix builds
from different commits. After a rollback, **revert the bad commit on
`prod`** — the next push redeploys the tip of `prod`.

## State on the VPS (all gitignored)

| Path | Meaning |
|------|---------|
| `apps/<app>/.next` | served build |
| `apps/<app>/.next-prev.pending` | copy of the live build taken before an in-place build (restored on build failure, else promoted to `.next-prev`) |
| `apps/<app>/.next-prev` | previous build (rollback target) |
| `apps/<app>/.next-failed`, `apps/api/dist-failed` | build swapped out by a rollback |
| `apps/api/dist-prev`, `apps/api/dist-prev.pending` | previous API build / pre-build copy |
| `.deploy/current_sha`, `.deploy/previous_sha`, `.deploy/rolled_back_from` | deployed commits |

Disk cost: roughly 2× each `.next` (+ cache) — fine on the 64GB disk.
