#!/usr/bin/env bash
# One-shot installer for the Naro Fashion DB backup system.
#
# Run this ONCE on a fresh VPS (or after migrating to a new VPS):
#   sudo bash scripts/ops/setup-backups.sh <db_password>
#
# It installs the pg-backup.sh script, creates ~/.pgpass with the
# provided password, schedules the cron entry, and runs the first
# backup immediately to verify the chain works end-to-end.
#
# Idempotent — re-running just refreshes the script and cron file.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: must run as root (sudo bash $0 <password>)" >&2
  exit 1
fi

DB_PASSWORD="${1:-}"
if [ -z "$DB_PASSWORD" ]; then
  echo "Usage: sudo bash $0 <db_password>" >&2
  echo "(reads /var/www/naro-fashion/packages/database/.env if no arg given)"
  if [ -f /var/www/naro-fashion/packages/database/.env ]; then
    DB_PASSWORD=$(grep -oP 'postgresql://[^:]+:\K[^@]+' /var/www/naro-fashion/packages/database/.env | head -1)
    if [ -n "$DB_PASSWORD" ]; then
      echo "Found password in packages/database/.env — using it."
    else
      echo "Could not extract password from .env — pass it explicitly." >&2
      exit 1
    fi
  else
    exit 1
  fi
fi

SCRIPT_SRC="$(cd "$(dirname "$0")" && pwd)/pg-backup.sh"
SCRIPT_DST="/usr/local/bin/naro-pg-backup.sh"
CRON_DST="/etc/cron.d/naro-pg-backup"
PGPASS="/root/.pgpass"

echo "[1/5] Installing backup script to ${SCRIPT_DST}"
install -m 0755 "$SCRIPT_SRC" "$SCRIPT_DST"

echo "[2/5] Writing /root/.pgpass (mode 600)"
echo "localhost:5432:naro_fashion:naro_admin:${DB_PASSWORD}" > "$PGPASS"
chmod 600 "$PGPASS"

echo "[3/5] Installing cron entry at ${CRON_DST}"
cat > "$CRON_DST" <<'EOF'
# Daily PostgreSQL backup for Naro Fashion (managed by scripts/ops/setup-backups.sh)
# Runs 03:15 UTC = 06:15 EAT — low-traffic window for Tanzania.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=root
15 3 * * * root /usr/local/bin/naro-pg-backup.sh
EOF
chmod 0644 "$CRON_DST"

echo "[4/5] Verifying cron is parsed by the daemon"
# `crontab -T` exists on newer crontabs; fall back to running the file through cron
if command -v crontab >/dev/null 2>&1; then
  crontab -T "$CRON_DST" 2>/dev/null || true
fi
systemctl reload cron 2>/dev/null || systemctl restart cron 2>/dev/null || true

echo "[5/5] Running first backup now to verify the chain works..."
"$SCRIPT_DST"

echo
echo "=========================================="
echo "Backup system installed."
echo "  Backups dir: /var/backups/naro/postgres/"
echo "  Log file:    /var/log/naro-pg-backup.log"
echo "  Cron entry:  ${CRON_DST}"
echo "  Schedule:    daily at 03:15 UTC (06:15 EAT)"
echo "  Retention:   30 days (rolling)"
echo
echo "Next: configure S3 off-site sync once you have a Vultr Object"
echo "Storage bucket. See docs/OPS/BACKUPS.md for the procedure."
echo "=========================================="
