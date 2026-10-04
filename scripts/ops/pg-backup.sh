#!/usr/bin/env bash
# PostgreSQL backup for Naro Fashion production DB.
#
# Runs from cron at 03:15 UTC nightly (see /etc/cron.d/naro-pg-backup),
# and from deploy.sh right before `prisma migrate deploy` (with BACKUP_TAG set).
# Writes a compressed pg_dump in Postgres "custom" format to
# /var/backups/naro/postgres/, then prunes anything older than 30 days.
# Off-site sync to Vultr Object Storage is a separate step:
# scripts/ops/offsite-backup.sh (see docs/OPS/BACKUPS.md).
#
# Optional env:
#   BACKUP_TAG               e.g. "predeploy-abc1234" -> naro_fashion-predeploy-abc1234-<ts>.dump
#                            When set, the Healthchecks ping is SKIPPED (an ad-hoc
#                            dump must not mask a missed nightly run).
#   BACKUP_RESULT_FILE       if set, the absolute path of the dump is written here
#                            (used by deploy.sh to print the restore command).
#   HEALTHCHECK_PGBACKUP_URL Healthchecks.io ping URL. Pinged on success,
#                            <url>/fail on failure. Read from the env or from
#                            /etc/naro-backup.env if present.
#
# Restore example:
#   sudo -u postgres psql -c "DROP DATABASE naro_fashion;" -c "CREATE DATABASE naro_fashion OWNER naro_admin;"
#   PGPASSFILE=/root/.pgpass pg_restore \
#     --clean --if-exists --no-owner --no-acl \
#     -h localhost -U naro_admin -d naro_fashion \
#     /var/backups/naro/postgres/naro_fashion-YYYY-MM-DD_HHMMSSZ.dump
#
# Failure mode: any non-zero exit gets captured by cron (which mails root
# if an MTA is configured) AND appended to /var/log/naro-pg-backup.log,
# AND pings HEALTHCHECK_PGBACKUP_URL/fail when configured.
# Monitor with: tail -50 /var/log/naro-pg-backup.log

set -euo pipefail

# Shared ops env (Healthchecks URLs, S3 settings). Optional.
if [ -f /etc/naro-backup.env ]; then
  # shellcheck disable=SC1091
  set -a; . /etc/naro-backup.env; set +a
fi

BACKUP_DIR="/var/backups/naro/postgres"
LOG_FILE="/var/log/naro-pg-backup.log"
DB_NAME="${DB_NAME:-naro_fashion}"
DB_USER="${DB_USER:-naro_admin}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
BACKUP_TAG="${BACKUP_TAG:-}"
HC_URL="${HEALTHCHECK_PGBACKUP_URL:-}"
# Ad-hoc (tagged) runs never ping the nightly dead-man's switch.
if [ -n "$BACKUP_TAG" ]; then HC_URL=""; fi

mkdir -p "$BACKUP_DIR"
mkdir -p "$(dirname "$LOG_FILE")"

TIMESTAMP=$(date -u +%Y-%m-%d_%H%M%SZ)
if [ -n "$BACKUP_TAG" ]; then
  OUT_FILE="${BACKUP_DIR}/${DB_NAME}-${BACKUP_TAG}-${TIMESTAMP}.dump"
else
  OUT_FILE="${BACKUP_DIR}/${DB_NAME}-${TIMESTAMP}.dump"
fi

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"
}

hc_ping() {
  # hc_ping [suffix]   suffix: "" | "/start" | "/fail"
  [ -n "$HC_URL" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${HC_URL}${1:-}" || log "WARN: healthcheck ping ${1:-success} failed"
}

on_error() {
  log "ERROR on line $1 — backup FAILED"
  hc_ping /fail
}
trap 'on_error $LINENO' ERR

hc_ping /start
log "Starting pg_dump of ${DB_NAME} -> ${OUT_FILE}"

# pg_dump reads PGPASSFILE for the password. ~/.pgpass format:
#   hostname:port:database:username:password
# File must be mode 600 or pg_dump refuses to read it.
PGPASSFILE="${PGPASSFILE:-/root/.pgpass}" \
  pg_dump \
    --host="$DB_HOST" \
    --port="$DB_PORT" \
    --username="$DB_USER" \
    --format=custom \
    --no-owner \
    --no-acl \
    --compress=9 \
    --file="$OUT_FILE" \
    "$DB_NAME"

# Sanity check: dump must be non-empty
if [ ! -s "$OUT_FILE" ]; then
  log "ERROR: backup file is empty or missing -- aborting"
  hc_ping /fail
  exit 1
fi

SIZE=$(du -h "$OUT_FILE" | awk '{print $1}')
log "pg_dump complete (${SIZE})"

if [ -n "${BACKUP_RESULT_FILE:-}" ]; then
  printf '%s' "$OUT_FILE" > "$BACKUP_RESULT_FILE"
fi

# Prune backups older than RETENTION_DAYS (covers tagged pre-deploy dumps too)
PRUNED=$(find "$BACKUP_DIR" -name "${DB_NAME}-*.dump" -mtime "+${RETENTION_DAYS}" -print -delete | wc -l)
log "Pruned ${PRUNED} backup(s) older than ${RETENTION_DAYS} days"

# Summary line for easy log scanning
TOTAL_BACKUPS=$(find "$BACKUP_DIR" -name "${DB_NAME}-*.dump" -type f | wc -l)
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | awk '{print $1}')
log "OK ${DB_NAME} backups: ${TOTAL_BACKUPS} files, ${TOTAL_SIZE} total${BACKUP_TAG:+ (tag: ${BACKUP_TAG})}"

hc_ping
