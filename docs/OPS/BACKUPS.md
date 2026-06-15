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

**Mitigation: off-site sync to Vultr Object Storage** is the documented next step. See "Off-site sync (TODO)" below.

## Off-site sync (TODO)

The plan is to upload each new dump to a Vultr Object Storage bucket (S3-compatible) immediately after the local backup completes. ~$1/mo for the bucket.

**Steps for whoever picks this up**:

1. In Vultr console → Storage → Object Storage → "Add Object Storage", pick the closest region (Frankfurt to match the VPS), name it `naro-fashion-backups`.
2. Copy the bucket's S3 credentials (Access Key, Secret Key, Endpoint URL).
3. On the VPS:
   ```bash
   apt install -y awscli
   aws configure --profile naro-backups
   # AWS Access Key ID:     <paste>
   # AWS Secret Access Key: <paste>
   # Default region name:   <leave blank>
   # Default output format: json
   # Then set the endpoint URL in ~/.aws/config:
   echo -e "[profile naro-backups]\ns3 =\n  endpoint_url = https://ewr1.vultrobjects.com" >> /root/.aws/config
   ```
4. Append the upload step to `pg-backup.sh` after the local dump succeeds:
   ```bash
   aws --profile naro-backups s3 cp "$OUT_FILE" "s3://naro-fashion-backups/postgres/$(basename "$OUT_FILE")"
   ```
5. Add a separate prune step that deletes objects older than `RETENTION_DAYS` from S3 (use a lifecycle policy on the bucket — set in the Vultr console, no script needed).
6. Verify once via the AWS CLI: `aws --profile naro-backups s3 ls s3://naro-fashion-backups/postgres/`

Until that ships, the system has a single-point-of-failure at the VPS disk level. Acceptable as a starting point; not acceptable as a long-term posture.

## Monitoring

There's no alerting on backup failure yet. Two options when you want it:

- **Cron MAILTO + Postfix relay through Brevo** — cheap; failures land in your Brevo inbox.
- **Healthcheck.io free tier** — `curl` a ping URL at the end of `pg-backup.sh`; if the ping doesn't arrive on schedule, Healthcheck.io emails/SMSes you. Free for up to 20 checks.

Both are ~10 minutes to set up once you decide which.
