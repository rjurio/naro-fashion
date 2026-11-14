#!/usr/bin/env bash
# Rebuild the isolated schema it_mig: production's current migrations, then the
# legacy seed, then the NEW migration. Local dev Postgres only.
set -euo pipefail
S="$1"; W="$S/naro-deps-wt"; PGB="/c/Program Files/PostgreSQL/17/bin"; export PGPASSWORD=Admin123
P() { "$PGB/psql" -U naro_admin -h localhost -d naro_fashion -qAt -v ON_ERROR_STOP=1 "$@"; }
P -c "DROP SCHEMA IF EXISTS it_mig CASCADE; CREATE SCHEMA it_mig;" 2>/dev/null
for m in 0_init 20261004120000_admin_2fa_columns 20261018120000_admin_offline_sync; do
  (echo "SET search_path TO it_mig;"; cat "$W/packages/database/prisma/migrations/$m/migration.sql") | P -f - >/dev/null 2>&1
done
node "$S/it/mig-seed.js" "$W" "$S/it/mig-seed.sql" >/dev/null && P -f "$S/it/mig-seed.sql"
SNAP='SET search_path TO it_mig; SELECT string_agg(id||'"':'"'||COALESCE("rentalDownPaymentPct"::text,'"'NULL'"'), '"','"' ORDER BY id) FROM "Product"; SELECT md5(string_agg(t::text, '"'|'"' ORDER BY id)) FROM "RentalOrder" t;'
B=$(P -c "$SNAP")
(echo "SET search_path TO it_mig;"; cat "$W/packages/database/prisma/migrations/20261112120000_product_down_payment_inheritance/migration.sql") | P -f -
A=$(P -c "$SNAP")
[ "$B" = "$A" ] && echo "migration: stored % and existing bookings unchanged ($B)" || { echo "MISMATCH: $B vs $A"; exit 1; }
