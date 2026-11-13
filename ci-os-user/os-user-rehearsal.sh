#!/usr/bin/env bash
# Round 25E C — REHEARSAL ONLY (disposable CI runner, never the VPS): move
# the NARO API from the shared root PM2 daemon to a dedicated, unprivileged
# OS account `naro` with its own systemd-supervised PM2 daemon (the pattern
# kiuruwi already uses on the VPS: pm2-kiuruwi.service), then roll back.
# Run as root:  REPO=<built checkout> DATABASE_URL=... bash os-user-rehearsal.sh
set -uo pipefail
: "${REPO:?}" "${DATABASE_URL:?}"
APP=/var/www/naro-fashion
NHOME=/home/naro
PM2BIN="$(command -v pm2)"
results=(); fails=0
pass() { results+=("PASS  $1"); echo "  ✔ $1"; }
fail() { results+=("FAIL  $1"); fails=$((fails + 1)); echo "  ✖ $1"; }
check() { if eval "$2" >/dev/null 2>&1; then pass "$1"; else fail "$1"; fi; }
refused() { if eval "$2" >/dev/null 2>&1; then fail "$1 (ALLOWED)"; else pass "$1"; fi; }
health() { curl -sf -m 5 http://127.0.0.1:4000/api/v1/health | grep -q '"db":"ok"'; }
wait_health() { for _ in $(seq 1 60); do health && return 0; sleep 1; done; return 1; }
listener_user() { local pid; pid=$(ss -ltnpH 'sport = :4000' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2); [ -n "$pid" ] && stat -c %U "/proc/$pid"; }
api_worker_user() { pgrep -f "$APP/apps/api/dist/main.js" | head -1 | xargs -r -I{} stat -c %U /proc/{}; }
root_pm2() { PM2_HOME=/root/.pm2 "$PM2BIN" "$@"; }
naro_pm2() { sudo -u naro -H env PATH="$PATH" PM2_HOME="$NHOME/.pm2" "$PM2BIN" "$@"; }

echo "== 0. today's layout: NARO API under the ROOT PM2 daemon, next to another app"
rm -rf "$APP" /var/www/other-app && mkdir -p /var/www && cp -a "$REPO" "$APP"
for f in "$APP/.env" "$APP/apps/api/.env" "$APP/packages/database/.env"; do
  cat > "$f" <<EOF
DATABASE_URL="$DATABASE_URL"
JWT_SECRET=rehearsal-only-jwt-secret-0123456789abcdef0123456789abcdef
JWT_REFRESH_SECRET=rehearsal-only-refresh-secret-0123456789abcdef0123456789
EOF
  chown root:root "$f"; chmod 600 "$f"
done
mkdir -p "$APP/apps/api/uploads/products" /var/www/other-app
printf 'SECRET=other-app-secret\n' > /var/www/other-app/.env; chmod 600 /var/www/other-app/.env
cat > /var/www/other-app/server.js <<'EOF'
require('http').createServer((q, s) => s.end('other-app ok')).listen(3200, '127.0.0.1');
EOF
printf 'OWNER_SECRET=x\n' > /etc/naro-db-owner.env; chmod 600 /etc/naro-db-owner.env
cd "$APP" && GIT_SHA=rehearsal root_pm2 start ecosystem.config.js --only naro-api >/dev/null && root_pm2 start /var/www/other-app/server.js --name other-app >/dev/null
check "baseline: API healthy with the database (as root)" wait_health
check "baseline: API runs as root" '[ "$(api_worker_user)" = root ]'
OTHER_PID=$(pgrep -f /var/www/other-app/server.js | head -1)
check "baseline: the other app is up" 'curl -sf -m 3 http://127.0.0.1:3200 | grep -q "other-app ok"'

echo "== 1. migrate: dedicated user, its own supervised PM2 daemon, minimal write access"
useradd --system --create-home --home-dir "$NHOME" --shell /usr/sbin/nologin naro
for f in "$APP/.env" "$APP/apps/api/.env" "$APP/packages/database/.env"; do chown root:naro "$f"; chmod 640 "$f"; done
chown -R naro:naro "$APP/apps/api/uploads"
mkdir -p "$APP/apps/api/private-uploads" && chown naro:naro "$APP/apps/api/private-uploads" && chmod 700 "$APP/apps/api/private-uploads"
"$PM2BIN" startup systemd -u naro --hp "$NHOME" >/dev/null 2>&1
check "pm2-naro.service installed and enabled" 'systemctl is-enabled pm2-naro.service'
systemctl start pm2-naro.service; sleep 2
T0=$(date +%s%N)
root_pm2 delete naro-api >/dev/null
(cd "$APP" && GIT_SHA=rehearsal naro_pm2 start ecosystem.config.js --only naro-api >/dev/null)
wait_health; T1=$(date +%s%N)
naro_pm2 save >/dev/null; root_pm2 save >/dev/null
echo "  (API unavailable for $(( (T1 - T0) / 1000000 )) ms during the switch)"
check "API healthy with the database after the switch" health
check "API worker runs as naro" '[ "$(api_worker_user)" = naro ]'
check "port 4000 is held by naro (not root)" '[ "$(listener_user)" = naro ]'
check "pm2-naro.service is the supervisor (MainPID = naro daemon)" '[ "$(stat -c %U /proc/$(systemctl show -p MainPID --value pm2-naro.service))" = naro ]'
check "the root daemon no longer runs naro-api" '! root_pm2 jlist | grep -q "\"name\":\"naro-api\""'
check "logs now under /home/naro/.pm2/logs" 'ls $NHOME/.pm2/logs | grep -q naro-api'

echo "== 2. what the unprivileged account can and cannot do"
check "naro can write uploads (product images)" 'sudo -u naro touch "$APP/apps/api/uploads/products/rehearsal.jpg"'
check "naro can write private uploads (ID documents)" 'sudo -u naro touch "$APP/apps/api/private-uploads/rehearsal.bin"'
check "naro can read the runtime .env (group read, 640)" 'sudo -u naro cat "$APP/apps/api/.env"'
refused "naro cannot modify the code or build (dist)" 'sudo -u naro touch "$APP/apps/api/dist/main.js"'
refused "naro cannot modify deploy tooling" 'sudo -u naro touch "$APP/deploy.sh"'
refused "naro cannot change the .env files" 'sudo -u naro sh -c "echo X >> $APP/apps/api/.env"'
refused "naro cannot read the database OWNER credential (/etc/naro-db-owner.env)" 'sudo -u naro cat /etc/naro-db-owner.env'
refused "naro cannot read /root (e.g. /root/.pgpass, the root PM2 dump)" 'sudo -u naro ls /root'
refused "naro cannot read another app's secrets" 'sudo -u naro cat /var/www/other-app/.env'
refused "naro cannot use sudo" 'sudo -u naro sudo -n true'
refused "naro cannot signal the root PM2 daemon or other apps" 'sudo -u naro kill -0 "$OTHER_PID"'
refused "naro cannot control the root PM2 daemon" 'sudo -u naro -H env PATH="$PATH" PM2_HOME=/root/.pm2 "$PM2BIN" ping'
check "the other app kept running throughout (same PID)" '[ "$(pgrep -f /var/www/other-app/server.js | head -1)" = "$OTHER_PID" ]'

echo "== 3. restart behaviour"
kill -9 "$(pgrep -f "$APP/apps/api/dist/main.js" | head -1)"; sleep 3
check "API worker killed → PM2 restarts it, healthy, still naro" 'wait_health && [ "$(api_worker_user)" = naro ]'
systemctl restart pm2-naro.service
check "systemctl restart pm2-naro → API back, still naro" 'wait_health && [ "$(api_worker_user)" = naro ]'
systemctl stop pm2-naro.service; refused "stopped unit → API down" health
systemctl start pm2-naro.service
check "reboot-style start → resurrected from the naro dump" 'wait_health && [ "$(api_worker_user)" = naro ]'
(cd "$APP" && GIT_SHA=rehearsal-2 naro_pm2 reload naro-api --update-env >/dev/null)
check "deploy-style reload (root → naro daemon) → healthy" wait_health
check "the other app is still the same process" '[ "$(pgrep -f /var/www/other-app/server.js | head -1)" = "$OTHER_PID" ]'

echo "== 4. rollback to the root daemon"
naro_pm2 delete naro-api >/dev/null; naro_pm2 save --force >/dev/null
systemctl stop pm2-naro.service; systemctl disable pm2-naro.service >/dev/null 2>&1
for f in "$APP/.env" "$APP/apps/api/.env" "$APP/packages/database/.env"; do chown root:root "$f"; chmod 600 "$f"; done
(cd "$APP" && GIT_SHA=rollback root_pm2 start ecosystem.config.js --only naro-api >/dev/null && root_pm2 save >/dev/null)
check "after rollback: API healthy as root again" 'wait_health && [ "$(api_worker_user)" = root ]'
check "after rollback: uploads still writable by the API (root)" 'touch "$APP/apps/api/uploads/products/rollback.jpg"'
check "after rollback: the other app untouched" '[ "$(pgrep -f /var/www/other-app/server.js | head -1)" = "$OTHER_PID" ]'

echo; echo "================ summary"
printf '%s\n' "${results[@]}"
echo "$(( ${#results[@]} - fails ))/${#results[@]} passed"
root_pm2 kill >/dev/null 2>&1 || true
[ "$fails" -eq 0 ]
