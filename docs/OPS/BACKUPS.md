# Database Backups

Live since 2026-06-15. Single safety net for the production PostgreSQL DB.

## What's running

- **Script**: `/usr/local/bin/naro-pg-backup.sh` (deployed from [`scripts/ops/pg-backup.sh`](../../scripts/ops/pg-backup.sh))
- **Schedule**: daily at 03:15 UTC (06:15 EAT — low-traffic window for Tanzania)
- **Cron file**: `/etc/cron.d/naro-pg-backup`
- **Output dir**: `/var/backups/naro/postgres/`
- **Format**: `pg_dump --format=custom --compress=9 --no-owner --no-acl`
- **Filename pattern**: `naro_fashion-YYYY-MM-DD_HHMMSSZ.dump`
- **Retention**: 30 days rolling. Older files are deleted at the end of each run.
- **Log file**: `/var/log/naro-pg-backup.log` — append-only, every run writes a structured line.
- **Credentials**: `pg_dump` reads `/root/.pgpass` (mode 600). Format: `localhost:5432:naro_fashion:naro_admin:<password>`.

## One-time setup on a new VPS

```bash
sudo bash /var/www/naro-fashion/scripts/ops/setup-backups.sh
# (no arg = reads the password from packages/database/.env)
# or:
sudo bash /var/www/naro-fashion/scripts/ops/setup-backups.sh '<db_password>'
```

The installer is idempotent — safe to re-run. It also fires off the first backup immediately so you can confirm the chain works end-to-end before going to bed.

## Daily verification

```bash
# Confirm backups are landing
ls -lh /var/backups/naro/postgres/ | tail -5

# Read the last few cron runs
tail -30 /var/log/naro-pg-backup.log

# Today's backup should exist and be > 1 MB
ls /var/backups/naro/postgres/naro_fashion-$(date -u +%Y-%m-%d)*.dump
```

A healthy log line looks like:

```
[2026-06-15T03:15:04Z] Starting pg_dump of naro_fashion -> /var/backups/naro/postgres/naro_fashion-2026-06-15_031504Z.dump
[2026-06-15T03:15:11Z] pg_dump complete (4.2M)
[2026-06-15T03:15:11Z] Pruned 0 backup(s) older than 30 days
[2026-06-15T03:15:11Z] OK naro_fashion backups: 1 files, 4.2M total
```

## Restoring

**Stop the API + admin first** so no writes hit the DB while you restore:

```bash
pm2 stop naro-api naro-admin
```

**Restore from a specific backup**:

```bash
# Drop + recreate the DB
sudo -u postgres psql -c "DROP DATABASE naro_fashion;"
sudo -u postgres psql -c "CREATE DATABASE naro_fashion OWNER naro_admin;"

# Restore (substitute the actual dump filename)
PGPASSFILE=/root/.pgpass pg_restore \
  --clean --if-exists --no-owner --no-acl \
  -h localhost -U naro_admin -d naro_fashion \
  /var/backups/naro/postgres/naro_fashion-2026-06-15_031504Z.dump

# Re-apply table ownership (see packages/database/CLAUDE.md "PostgreSQL ownership")
sudo -u postgres psql -d naro_fashion -c "DO \$\$ DECLARE r RECORD; BEGIN FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP EXECUTE format('ALTER TABLE public.%I OWNER TO naro_admin', r.tablename); END LOOP; END \$\$;"

# Bring services back
pm2 restart naro-api naro-admin
```

Smoke test before declaring restore complete:

```bash
curl -sS https://api.narofashion.co.tz/api/v1/cms/storefront-stats -H "X-Tenant-Id: <id>" | head -c 200
```

## What's NOT covered

This setup protects against:
- Accidental `DELETE` / `DROP TABLE` / bad migration
- Schema corruption
- App-level data corruption

It does NOT protect against:
- **VPS disk failure** — the backup lives on the same disk as the DB. If `/dev/vda2` dies, both are gone.
- **VPS being wiped** (e.g. Vultr account suspension, accidental destroy)
- **Ransomware** that encrypts the backup dir alongside the live DB

It also did NOT cover **uploaded files** (`apps/api/uploads/` product/CMS images, `apps/api/private-uploads/` ID documents) — those were on the VPS disk only.

**Mitigation: off-site sync to Vultr Object Storage** via [`scripts/ops/offsite-backup.sh`](../../scripts/ops/offsite-backup.sh). The script is in the repo; **the operator must complete the setup below before it does anything** (status: NOT YET LIVE until the steps are ticked off).

## Pre-deploy dumps (automatic)

`deploy.sh` now runs `pg-backup.sh` with `BACKUP_TAG=predeploy-<sha7>` right before `prisma migrate deploy` (see [MIGRATIONS.md](MIGRATIONS.md)), and **aborts the deploy** if the dump fails or is empty. These land in the same dir as `naro_fashion-predeploy-<sha7>-<timestamp>.dump`, are pruned by the same 30-day rule, and are picked up by the off-site sync. The deploy log prints the dump path and the exact `pg_restore` command. Pre-deploy runs do **not** ping the nightly Healthchecks URL (so a deploy can't hide a missed nightly backup).

Requirement: the deploy user (root) must have a working `/root/.pgpass` — already true if `setup-backups.sh` was run.

## Off-site sync — operator setup (MANUAL)

Cost: Vultr Object Storage ~US$6/mo tier minimum (check current pricing); a cheaper alternative is Backblaze B2 / Cloudflare R2, which work identically with rclone (`PROVIDER=Other`, change the endpoint).

1. **[MANUAL — Vultr console]** Storage → Object Storage → Add, region **Frankfurt (fra1)** (same as VPS). Create bucket `naro-fashion-backups`, **private**. Copy the Access Key, Secret Key and hostname (e.g. `fra1.vultrobjects.com`).
2. **[MANUAL — Vultr console / s3 API]** Add a lifecycle rule: expire `postgres/` and `private-uploads/` objects after 90 days (keeps ~3 months off-site vs 30 days local). Leave `uploads/` without expiry (it's a mirror of live images).
3. **[MANUAL — your laptop]** Create an encryption keypair. The **private key never goes on the VPS**:
   ```bash
   age-keygen -o naro-backup-age.key     # prints "Public key: age1..."
   # store naro-backup-age.key in your password manager + an offline copy
   ```
   (Rationale: with `age` public-key encryption the server can encrypt but cannot decrypt, so a VPS compromise doesn't expose old backups. `gpg --symmetric` with `BACKUP_GPG_PASSPHRASE_FILE` is supported as a fallback but leaves the passphrase on the server.)
4. **[MANUAL — VPS]** Install tools:
   ```bash
   apt install -y rclone age
   ```
5. **[MANUAL — VPS]** Create `/etc/naro-backup.env` (read by both `pg-backup.sh` and `offsite-backup.sh`):
   ```bash
   cat > /etc/naro-backup.env <<'EOF'
   BACKUP_S3_ENDPOINT=https://fra1.vultrobjects.com
   BACKUP_S3_BUCKET=naro-fashion-backups
   BACKUP_S3_ACCESS_KEY_ID=<access key>
   BACKUP_S3_SECRET_ACCESS_KEY=<secret key>
   BACKUP_AGE_RECIPIENT=age1<public key from step 3>
   HEALTHCHECK_PGBACKUP_URL=https://hc-ping.com/<uuid-1>
   HEALTHCHECK_BACKUP_URL=https://hc-ping.com/<uuid-2>
   EOF
   chmod 600 /etc/naro-backup.env
   ```
   (Healthchecks URLs: see [MONITORING.md](MONITORING.md). Create two checks: `naro-pg-backup` daily, grace 2h; `naro-offsite-backup` daily, grace 2h.)
6. **[MANUAL — VPS]** Re-install the updated nightly script (it now pings Healthchecks) and add the off-site cron:
   ```bash
   install -m 0755 /var/www/naro-fashion/scripts/ops/pg-backup.sh /usr/local/bin/naro-pg-backup.sh
   install -m 0755 /var/www/naro-fashion/scripts/ops/offsite-backup.sh /usr/local/bin/naro-offsite-backup.sh
   cat > /etc/cron.d/naro-offsite-backup <<'EOF'
   SHELL=/bin/bash
   PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
   MAILTO=root
   # 04:00 UTC — 45 min after the 03:15 pg dump
   0 4 * * * root APP_DIR=/var/www/naro-fashion /usr/local/bin/naro-offsite-backup.sh
   EOF
   chmod 0644 /etc/cron.d/naro-offsite-backup
   ```
7. **[MANUAL — VPS]** First run + verify:
   ```bash
   /usr/local/bin/naro-offsite-backup.sh && tail -20 /var/log/naro-offsite-backup.log
   set -a; . /etc/naro-backup.env; set +a
   export RCLONE_CONFIG_NAROBACKUP_TYPE=s3 RCLONE_CONFIG_NAROBACKUP_PROVIDER=Other \
     RCLONE_CONFIG_NAROBACKUP_ENDPOINT=$BACKUP_S3_ENDPOINT \
     RCLONE_CONFIG_NAROBACKUP_ACCESS_KEY_ID=$BACKUP_S3_ACCESS_KEY_ID \
     RCLONE_CONFIG_NAROBACKUP_SECRET_ACCESS_KEY=$BACKUP_S3_SECRET_ACCESS_KEY
   rclone lsl narobackup:$BACKUP_S3_BUCKET/postgres | tail -5
   rclone size narobackup:$BACKUP_S3_BUCKET/uploads
   ```

### What lands where

| Source | Bucket path | Encrypted |
|---|---|---|
| `/var/backups/naro/postgres/*.dump` | `postgres/<name>.dump.age` | yes (age) — plaintext + WARN if no key |
| `apps/api/uploads/` | `uploads/` (mirror, copy-only) | no — already public via the site |
| `apps/api/private-uploads/` (ID documents) | `private-uploads/private-uploads-<ts>.tar.gz.age` | **always** — script refuses to upload without a key |

`rclone copy` is used (never `sync`), so a local deletion or ransomware wipe does not propagate to the bucket.

## Restore test (MANUAL — quarterly, and record it)

A backup that has never been restored is a hope, not a backup. Once a quarter:

1. On your laptop (or a throwaway VPS / Docker `postgres:16`), download the newest off-site dump:
   ```bash
   rclone copy narobackup:naro-fashion-backups/postgres/<newest>.dump.age .
   age -d -i naro-backup-age.key -o restore.dump <newest>.dump.age
   ```
2. Restore into a scratch DB:
   ```bash
   createdb naro_restore_test
   pg_restore --no-owner --no-acl -d naro_restore_test restore.dump
   psql -d naro_restore_test -c 'SELECT count(*) FROM "Product"; SELECT count(*) FROM "Order"; SELECT max("createdAt") FROM "Order";'
   ```
   The newest `Order.createdAt` should be within ~24h of the dump timestamp.
3. Decrypt + list one private-uploads archive: `age -d -i naro-backup-age.key private-uploads-<ts>.tar.gz.age | tar -tz | head`.
4. **Record it** in the table below (date, dump used, row counts, who). Drop the scratch DB and delete the decrypted files.

| Date | Dump restored | Product / Order rows | Newest order | Done by |
|---|---|---|---|---|
| 2026-10-04 | `naro_fashion-2026-10-04_031501Z.dump` (296K, local copy; restored into a scratch DB in 1s, then dropped) | 90 products / 96 variants / 6 orders — all 9 checked tables matched live counts | — | Claude (on-box test; off-site copy not yet configured) |

## Monitoring

- `pg-backup.sh` pings `HEALTHCHECK_PGBACKUP_URL` (`/start`, success, `/fail`) when set in the env or `/etc/naro-backup.env`.
- `offsite-backup.sh` pings `HEALTHCHECK_BACKUP_URL` the same way.
- If a ping doesn't arrive within the grace period, Healthchecks.io emails you. Setup steps: [MONITORING.md](MONITORING.md).
- Cron `MAILTO=root` remains as a secondary channel (only useful if an MTA relay is configured).
