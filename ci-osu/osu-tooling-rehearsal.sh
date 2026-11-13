#!/usr/bin/env bash
# Round 25F F — REHEARSAL ONLY (disposable CI runner, never the VPS): the PM2
# guard + deploy-lib OS-user mode against REAL systemd units and REAL pm2.
#   root: REPO=<built checkout with the tooling> DATABASE_URL=... bash osu-tooling-rehearsal.sh
set -uo pipefail
: "${REPO:?}" "${DATABASE_URL:?}"
export HOME=/root PM2_HOME=/root/.pm2
APP=/var/www/naro-fashion
NHOME=/home/naro
PM2BIN="$(command -v pm2)"; NODEDIR="$(dirname "$(command -v node)")"
results=(); fails=0
pass() { results+=("PASS  $1"); echo "  ✔ $1"; }
fail() { results+=("FAIL  $1"); fails=$((fails + 1)); echo "  ✖ $1"; }
check() { if eval "$2" >/dev/null 2>&1; then pass "$1"; else fail "$1"; [ -s /tmp/guard.out ] && sed "s/^/      | /" /tmp/guard.out | tail -25; fi; }
refused() { if eval "$2" >/dev/null 2>&1; then fail "$1 (ALLOWED)"; else pass "$1"; fi; }
guard() { (cd "$APP" && bash scripts/ops/pm2-guard.sh) > /tmp/guard.out 2>&1; }
guard_says() { guard; grep -qF -- "$1" /tmp/guard.out; }
health_commit() { curl -sf -m 5 http://127.0.0.1:4000/api/v1/health | grep -q "\"commit\":\"$1\""; }
wait_commit() { for _ in $(seq 1 60); do health_commit "$1" && return 0; sleep 1; done; return 1; }
up() { curl -sf -m 3 "http://127.0.0.1:$1" >/dev/null; }
api_pid() { pgrep -f "$APP/apps/api/dist/main.js" | head -1; }
api_user() { stat -c %U "/proc/$(api_pid)"; }
port_user() { local pid; pid=$(ss -ltnpH "sport = :$1" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2); [ -n "$pid" ] && stat -c %U "/proc/$pid"; }
lib() { (cd "$APP" && . scripts/ops/deploy-lib.sh && "$@"); }
npm2() { sudo -u naro -H env PATH="$NODEDIR:/usr/local/bin:/usr/bin:/bin" PM2_HOME="$NHOME/.pm2" "$PM2BIN" "$@"; }

echo "== 0. the VPS today: NARO apps + another app under a systemd-supervised ROOT daemon"
rm -rf "$APP" /var/www/other-app && mkdir -p /var/www && cp -a "$REPO" "$APP" && chown -R root:root "$APP"   # as on the VPS: code root-owned
for f in "$APP/.env" "$APP/apps/api/.env" "$APP/packages/database/.env"; do
  printf 'DATABASE_URL="%s"\nJWT_SECRET=rehearsal-only-jwt-secret-0123456789abcdef0123456789abcdef\nJWT_REFRESH_SECRET=rehearsal-only-refresh-secret-0123456789abcdef0123456789\n' "$DATABASE_URL" > "$f"
  chown root:root "$f"; chmod 600 "$f"
done
mkdir -p "$APP/apps/api/uploads/products"
for app in storefront admin; do   # stand-ins for the Next standalone servers (only their supervision matters here)
  d="$APP/apps/$app/.next/standalone/apps/$app"; mkdir -p "$d/.next"
  printf "require('http').createServer((q, s) => s.end('%s ok')).listen(process.env.PORT);\n" "$app" > "$d/server.js"
done
mkdir -p /var/www/other-app
printf "require('http').createServer((q, s) => s.end('other ok')).listen(3200, '127.0.0.1');\n" > /var/www/other-app/server.js
"$PM2BIN" startup systemd -u root --hp /root >/dev/null 2>&1
systemctl start pm2-root.service; sleep 2
(cd "$APP" && GIT_SHA=sha0 "$PM2BIN" start ecosystem.config.js >/dev/null && "$PM2BIN" start /var/www/other-app/server.js --name other-app >/dev/null && "$PM2BIN" save >/dev/null)
check "root mode: API healthy" 'wait_commit sha0'
check "root mode: the REAL guard passes" 'guard_says "PM2 supervision check PASSED"'
check "root mode: deploy-lib reload_pm2 (3 named commands) → new commit live" 'lib reload_pm2 sha1 && wait_commit sha1'

echo "== 1. move the NARO apps to user naro + pm2-naro.service, switch ON"
useradd --system --create-home --home-dir "$NHOME" --shell /usr/sbin/nologin naro
"$PM2BIN" startup systemd -u naro --hp "$NHOME" >/dev/null 2>&1
systemctl start pm2-naro.service; sleep 2
(cd "$APP" && "$PM2BIN" delete naro-api naro-storefront naro-admin >/dev/null && "$PM2BIN" save >/dev/null)
chown -R naro:naro "$APP/apps/api/uploads"; for f in "$APP/.env" "$APP/apps/api/.env" "$APP/packages/database/.env"; do chown root:naro "$f"; chmod 640 "$f"; done
(cd "$APP" && GIT_SHA=sha1 npm2 start ecosystem.config.js >/dev/null && npm2 save >/dev/null)
printf 'NARO_PM2_USER=naro\nNARO_PM2_HOME=%s/.pm2\nNARO_PM2_UNIT=pm2-naro.service\nNARO_PM2_PATH=%s:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n' "$NHOME" "$NODEDIR" > /etc/naro-pm2.env
chown root:root /etc/naro-pm2.env; chmod 644 /etc/naro-pm2.env
check "OS-user mode: the REAL guard passes (both daemons verified)" 'guard_says "OS-user mode: NARO apps belong to pm2-naro.service" && grep -q PASSED /tmp/guard.out'
check "the root daemon is still verified in OS-user mode" 'grep -q "is a root God Daemon inside" /tmp/guard.out'
export ROOT_ONLY_SECRET=must-not-reach-the-apps
check "deploy-lib reload_pm2 in OS-user mode → sha2 live (GIT_SHA passed through sudo)" 'lib reload_pm2 sha2 && wait_commit sha2'
check "API worker runs as naro" '[ "$(api_user)" = naro ]'
check "ports 4000 / 3000 / 3001 held by the naro daemon" '[ "$(port_user 4000)" = naro ] && [ "$(port_user 3000)" = naro ] && [ "$(port_user 3001)" = naro ]'
check "no root variable leaked into the API (sudo reset the environment for --update-env)" '! tr "\0" "\n" < /proc/$(api_pid)/environ | grep -q ROOT_ONLY_SECRET'
unset ROOT_ONLY_SECRET
check "file modes: .env x3 root:naro 640" '[ "$(stat -c "%U:%G %a" "$APP/apps/api/.env")" = "root:naro 640" ] && [ "$(stat -c "%U:%G %a" "$APP/packages/database/.env")" = "root:naro 640" ]'
check "file modes: uploads naro, private uploads naro 700" '[ "$(stat -c %U "$APP/apps/api/uploads")" = naro ] && [ "$(stat -c "%U %a" "$APP/apps/api/private-uploads")" = "naro 700" ]'
check "file modes: Next caches naro, code root" '[ "$(stat -c %U "$APP/apps/admin/.next/standalone/apps/admin/.next/cache")" = naro ] && [ "$(stat -c %U "$APP/apps/api/dist")" = root ] && [ "$(stat -c %U "$APP/deploy.sh")" = root ]'
check "logs under /home/naro/.pm2/logs" 'ls "$NHOME/.pm2/logs" | grep -q naro-api'
refused "naro can't modify code" 'sudo -u naro touch "$APP/apps/api/dist/main.js"'
check "the other app is up and still in the root daemon" 'up 3200 && [ "$(port_user 3200)" = root ]'

echo "== 2. the guard refuses broken states (and runs no pm2)"
printf 'setInterval(() => {}, 1e9);
' > /var/www/other-app/idle.js
(cd "$APP" && "$PM2BIN" start /var/www/other-app/idle.js --name naro-admin >/dev/null 2>&1); sleep 2
check "a NARO-named app in the ROOT daemon → refused" '! guard && grep -q "runs OUTSIDE pm2-naro.service" /tmp/guard.out'
(cd "$APP" && "$PM2BIN" delete naro-admin >/dev/null 2>&1; "$PM2BIN" save >/dev/null)
check "after removing it → passes again" 'guard'
sudo -u naro -H env PATH="$NODEDIR:/usr/bin:/bin" PM2_HOME=/tmp/naro-stray "$PM2BIN" ping >/dev/null 2>&1; sleep 2
check "the stray naro daemon really runs (set-up)" 'pgrep -u naro -f "God Daemon \(/tmp/naro-stray\)"'
check "a second naro daemon → refused" '! guard && grep -q "another naro PM2 God Daemon" /tmp/guard.out'
sudo -u naro -H env PATH="$NODEDIR:/usr/bin:/bin" PM2_HOME=/tmp/naro-stray "$PM2BIN" kill >/dev/null 2>&1
check "after killing it → passes again" 'guard'
chmod 664 /etc/naro-pm2.env
check "switch file writable by group → refused" '! guard && grep -q "must be owned by root" /tmp/guard.out'
chmod 644 /etc/naro-pm2.env
systemctl stop pm2-naro.service
check "naro unit stopped → refused" '! guard && grep -q "pm2-naro.service is inactive" /tmp/guard.out'
check "naro unit stopped → reload_pm2 refuses, runs no pm2" '! lib reload_pm2 sha9 && ! pgrep -u naro -f "God Daemon" >/dev/null'
systemctl start pm2-naro.service; sleep 3
check "naro unit started again → resurrected from its dump, guard passes" 'wait_commit sha2 && guard'

echo "== 3. reboot-style restart of BOTH units"
systemctl stop pm2-naro.service pm2-root.service; sleep 1
systemctl start pm2-root.service pm2-naro.service; sleep 4
check "both units enabled for boot" 'systemctl is-enabled pm2-root.service && systemctl is-enabled pm2-naro.service'
check "after restart: guard passes, API back as naro, other app back in root" 'wait_commit sha2 && guard && [ "$(api_user)" = naro ] && up 3200 && [ "$(port_user 3200)" = root ]'

echo "== 4. rollback-style reload to the previous commit (deploy-lib)"
check "reload_pm2 sha1 (previous) → sha1 live, still naro" 'lib reload_pm2 sha1 && wait_commit sha1 && [ "$(api_user)" = naro ]'

echo "== 5. OS-user rollback (docs/OPS/OS_USER.md)"
rm -f /etc/naro-pm2.env
check "switch removed while apps still run as naro → root-only guard refuses (fail closed)" '! guard && grep -q "runs OUTSIDE pm2-root.service" /tmp/guard.out'
(cd "$APP" && npm2 delete naro-api naro-storefront naro-admin >/dev/null && npm2 save --force >/dev/null)
systemctl stop pm2-naro.service; systemctl disable pm2-naro.service >/dev/null 2>&1
for f in "$APP/.env" "$APP/apps/api/.env" "$APP/packages/database/.env"; do chown root:root "$f"; chmod 600 "$f"; done
(cd "$APP" && GIT_SHA=sha1 "$PM2BIN" start ecosystem.config.js >/dev/null && "$PM2BIN" save >/dev/null)
check "after rollback: guard passes in root mode, API healthy as root, other app up" 'wait_commit sha1 && guard && [ "$(api_user)" = root ] && up 3200'
check "after rollback: deploy-lib reload_pm2 works in root mode" 'lib reload_pm2 sha3 && wait_commit sha3'

echo; echo "================ summary"
printf '%s\n' "${results[@]}"
echo "$(( ${#results[@]} - fails ))/${#results[@]} passed"
[ "$fails" -eq 0 ]
