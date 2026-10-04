#!/usr/bin/env bash
# Off-site backup for Naro Fashion -> S3-compatible bucket (Vultr Object Storage).
#
# What it ships (each run, idempotent — rclone only uploads new/changed files):
#   1. /var/backups/naro/postgres/*.dump          -> s3://$BUCKET/postgres/
#      (age-encrypted to *.dump.age when BACKUP_AGE_RECIPIENT is set; strongly
#       recommended — dumps contain customer PII + password hashes)
#   2. apps/api/uploads/                           -> s3://$BUCKET/uploads/
#      (public product/CMS images; already world-readable via the site, so
#       uploaded unencrypted)
#   3. apps/api/private-uploads/ (ID documents)    -> s3://$BUCKET/private-uploads/
#      packed as one tar.gz per run and ENCRYPTED with `age` (or gpg symmetric
#      fallback). This step REFUSES to run without an encryption key: national
#      ID scans must never sit in a bucket in plaintext.
#
# Remote retention: uses `rclone copy` (never `sync`), so a local deletion or
# ransomware wipe does NOT propagate to the bucket. Configure a lifecycle rule
# on the bucket to expire postgres/ and private-uploads/ objects after N days.
#
# Dead-man's switch: pings $HEALTHCHECK_BACKUP_URL on success, /fail on failure.
#
# Config: env vars, or /etc/naro-backup.env (mode 600, root-owned):
#   BACKUP_S3_ENDPOINT            e.g. https://fra1.vultrobjects.com   (required)
#   BACKUP_S3_BUCKET              e.g. naro-fashion-backups            (required)
#   BACKUP_S3_ACCESS_KEY_ID       bucket access key                    (required*)
#   BACKUP_S3_SECRET_ACCESS_KEY   bucket secret key                    (required*)
#     * or omit both and define an rclone remote named by BACKUP_RCLONE_REMOTE
#       in /root/.config/rclone/rclone.conf instead.
#   BACKUP_AGE_RECIPIENT          age public key (age1...). Private key is kept
#                                 OFF the VPS (password manager) — the server can
#                                 encrypt but never decrypt.
#   BACKUP_GPG_PASSPHRASE_FILE    fallback if age isn't available: file holding a
#                                 passphrase for `gpg --symmetric` (AES256).
#   HEALTHCHECK_BACKUP_URL        https://hc-ping.com/<uuid>
#   APP_DIR                       default /var/www/naro-fashion
#
# Cron (installed manually, see docs/OPS/BACKUPS.md): 04:00 UTC, after the
# 03:15 pg dump.

set -euo pipefail

if [ -f /etc/naro-backup.env ]; then
  # shellcheck disable=SC1091
  set -a; . /etc/naro-backup.env; set +a
fi

APP_DIR="${APP_DIR:-/var/www/naro-fashion}"
PG_DIR="${PG_BACKUP_DIR:-/var/backups/naro/postgres}"
STAGING_DIR="${OFFSITE_STAGING_DIR:-/var/backups/naro/offsite-staging}"
UPLOADS_DIR="${APP_DIR}/apps/api/uploads"
PRIVATE_DIR="${APP_DIR}/apps/api/private-uploads"
LOG_FILE="/var/log/naro-offsite-backup.log"
HC_URL="${HEALTHCHECK_BACKUP_URL:-}"
BUCKET="${BACKUP_S3_BUCKET:-}"
REMOTE_NAME="${BACKUP_RCLONE_REMOTE:-narobackup}"

mkdir -p "$(dirname "$LOG_FILE")" "$STAGING_DIR"
chmod 700 "$STAGING_DIR"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"; }

hc_ping() {
  [ -n "$HC_URL" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${HC_URL}${1:-}" || log "WARN: healthcheck ping ${1:-success} failed"
}

TMP_FILES=()
cleanup() { for f in "${TMP_FILES[@]:-}"; do [ -n "$f" ] && rm -f "$f"; done; }
on_error() { log "ERROR on line $1 — off-site backup FAILED"; hc_ping /fail; }
trap 'on_error $LINENO' ERR
trap cleanup EXIT

fail() { log "ERROR: $*"; hc_ping /fail; exit 1; }

# ---------------------------------------------------------------- preflight
command -v rclone >/dev/null 2>&1 || fail "rclone not installed (apt install -y rclone)"
[ -n "$BUCKET" ] || fail "BACKUP_S3_BUCKET not set"

# Define the rclone remote purely from env so no secrets land in rclone.conf.
if [ -n "${BACKUP_S3_ACCESS_KEY_ID:-}" ] && [ -n "${BACKUP_S3_SECRET_ACCESS_KEY:-}" ]; then
  [ -n "${BACKUP_S3_ENDPOINT:-}" ] || fail "BACKUP_S3_ENDPOINT not set"
  REMOTE_ENV_PREFIX="RCLONE_CONFIG_$(echo "$REMOTE_NAME" | tr '[:lower:]' '[:upper:]')"
  export "${REMOTE_ENV_PREFIX}_TYPE=s3"
  export "${REMOTE_ENV_PREFIX}_PROVIDER=Other"
  export "${REMOTE_ENV_PREFIX}_ENDPOINT=${BACKUP_S3_ENDPOINT}"
  export "${REMOTE_ENV_PREFIX}_ACCESS_KEY_ID=${BACKUP_S3_ACCESS_KEY_ID}"
  export "${REMOTE_ENV_PREFIX}_SECRET_ACCESS_KEY=${BACKUP_S3_SECRET_ACCESS_KEY}"
  export "${REMOTE_ENV_PREFIX}_ACL=private"
fi
REMOTE="${REMOTE_NAME}:${BUCKET}"
RCLONE_OPTS=(--transfers 2 --checkers 4 --log-level NOTICE --log-file "$LOG_FILE")

# Encryption helper: encrypt <in> <out>. Returns non-zero if no key configured.
ENC_EXT=""
if [ -n "${BACKUP_AGE_RECIPIENT:-}" ] && command -v age >/dev/null 2>&1; then
  ENC_EXT=".age"
elif [ -n "${BACKUP_GPG_PASSPHRASE_FILE:-}" ] && [ -r "${BACKUP_GPG_PASSPHRASE_FILE}" ] && command -v gpg >/dev/null 2>&1; then
  ENC_EXT=".gpg"
fi
encrypt() {
  local in="$1" out="$2"
  case "$ENC_EXT" in
    .age) age -r "$BACKUP_AGE_RECIPIENT" -o "$out" "$in" ;;
    .gpg) gpg --batch --yes --quiet --symmetric --cipher-algo AES256 \
            --pinentry-mode loopback --passphrase-file "$BACKUP_GPG_PASSPHRASE_FILE" \
            -o "$out" "$in" ;;
    *) return 1 ;;
  esac
}

log "Starting off-site backup -> ${REMOTE} (encryption: ${ENC_EXT:-NONE})"
hc_ping /start

# ---------------------------------------------------------------- 1. postgres
if [ -d "$PG_DIR" ]; then
  if [ -n "$ENC_EXT" ]; then
    # Encrypt each dump once into the staging mirror; rclone then uploads
    # only the new .age/.gpg files.
    mkdir -p "$STAGING_DIR/postgres"
    for dump in "$PG_DIR"/*.dump; do
      [ -e "$dump" ] || continue
      target="$STAGING_DIR/postgres/$(basename "$dump")${ENC_EXT}"
      if [ ! -s "$target" ]; then
        encrypt "$dump" "${target}.part"
        mv "${target}.part" "$target"
      fi
    done
    # Drop staged copies whose source was pruned locally (remote keeps them
    # until the bucket lifecycle rule expires them).
    for staged in "$STAGING_DIR/postgres"/*"${ENC_EXT}"; do
      [ -e "$staged" ] || continue
      [ -e "$PG_DIR/$(basename "$staged" "$ENC_EXT")" ] || rm -f "$staged"
    done
    rclone copy "$STAGING_DIR/postgres" "${REMOTE}/postgres" "${RCLONE_OPTS[@]}"
  else
    log "WARN: no encryption key configured — uploading DB dumps UNENCRYPTED (set BACKUP_AGE_RECIPIENT)"
    rclone copy "$PG_DIR" "${REMOTE}/postgres" --include '*.dump' "${RCLONE_OPTS[@]}"
  fi
  log "postgres: synced $(find "$PG_DIR" -name '*.dump' -type f | wc -l) dump(s)"
else
  fail "postgres backup dir ${PG_DIR} missing — is pg-backup.sh running?"
fi

# ---------------------------------------------------------------- 2. public uploads
if [ -d "$UPLOADS_DIR" ]; then
  rclone copy "$UPLOADS_DIR" "${REMOTE}/uploads" "${RCLONE_OPTS[@]}"
  log "uploads: synced $(find "$UPLOADS_DIR" -type f | wc -l) file(s)"
else
  log "WARN: ${UPLOADS_DIR} not found — skipping public uploads"
fi

# ---------------------------------------------------------------- 3. private uploads (ID documents)
if [ -d "$PRIVATE_DIR" ] && [ -n "$(find "$PRIVATE_DIR" -type f -print -quit)" ]; then
  [ -n "$ENC_EXT" ] || fail "private-uploads present but no encryption key (BACKUP_AGE_RECIPIENT / BACKUP_GPG_PASSPHRASE_FILE) — refusing to upload ID documents in plaintext"
  TS=$(date -u +%Y-%m-%d_%H%M%SZ)
  TARBALL="$(mktemp "${STAGING_DIR}/private-uploads-XXXXXX.tar.gz")"
  TMP_FILES+=("$TARBALL")
  ENC_OUT="${STAGING_DIR}/private-uploads-${TS}.tar.gz${ENC_EXT}"
  TMP_FILES+=("$ENC_OUT")
  tar -C "$(dirname "$PRIVATE_DIR")" -czf "$TARBALL" "$(basename "$PRIVATE_DIR")"
  encrypt "$TARBALL" "$ENC_OUT"
  rclone copyto "$ENC_OUT" "${REMOTE}/private-uploads/$(basename "$ENC_OUT")" "${RCLONE_OPTS[@]}"
  log "private-uploads: uploaded $(basename "$ENC_OUT") ($(du -h "$ENC_OUT" | awk '{print $1}'))"
else
  log "private-uploads: nothing to back up"
fi

log "OK off-site backup complete"
hc_ping
