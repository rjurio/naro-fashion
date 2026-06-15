#!/usr/bin/env bash
# Daily PostgreSQL backup for Naro Fashion production DB.
#
# Runs from cron at 03:15 UTC nightly (see /etc/cron.d/naro-pg-backup).
# Writes a compressed pg_dump in Postgres "custom" format to
# /var/backups/naro/postgres/, then prunes anything older than 30 days.
# Off-site sync to Vultr Object Storage is a separate step (see
# scripts/ops/pg-backup-s3-sync.sh once the bucket is configured).
#
# Restore example:
#   sudo -u postgres psql -c "DROP DATABASE naro_fashion;" -c "CREATE DATABASE naro_fashion OWNER naro_admin;"
#   PGPASSFILE=/root/.pgpass pg_restore \
#     --clean --if-exists --no-owner --no-acl \
#     -h localhost -U naro_admin -d naro_fashion \
#     /var/backups/naro/postgres/naro_fashion-YYYY-MM-DD_HHMMSSZ.dump
#
# Failure mode: any non-zero exit gets captured by cron (which mails root
# if an MTA is configured) AND appended to /var/log/naro-pg-backup.log.
# Monitor with: tail -50 /var/log/naro-pg-backup.log

set -euo pipefail

BACKUP_DIR="/var/backups/naro/postgres"
LOG_FILE="/var/log/naro-pg-backup.log"
DB_NAME="${DB_NAME:-naro_fashion}"
DB_USER="${DB_USER:-naro_admin}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"

mkdir -p "$BACKUP_DIR"
mkdir -p "$(dirname "$LOG_FILE")"

TIMESTAMP=$(date -u +%Y-%m-%d_%H%M%SZ)
OUT_FILE="${BACKUP_DIR}/${DB_NAME}-${TIMESTAMP}.dump"

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"
}

trap 'log "ERROR on line $LINENO — backup FAILED"' ERR

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

SIZE=$(du -h "$OUT_FILE" | awk '{print $1}')
log "pg_dump complete (${SIZE})"

# Sanity check: dump must be non-empty
if [ ! -s "$OUT_FILE" ]; then
  log "ERROR: backup file is empty or missing -- aborting"
  exit 1
fi

# Prune backups older than RETENTION_DAYS
PRUNED=$(find "$BACKUP_DIR" -name "${DB_NAME}-*.dump" -mtime "+${RETENTION_DAYS}" -print -delete | wc -l)
log "Pruned ${PRUNED} backup(s) older than ${RETENTION_DAYS} days"

# Summary line for easy log scanning
TOTAL_BACKUPS=$(find "$BACKUP_DIR" -name "${DB_NAME}-*.dump" -type f | wc -l)
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | awk '{print $1}')
log "OK ${DB_NAME} backups: ${TOTAL_BACKUPS} files, ${TOTAL_SIZE} total"
