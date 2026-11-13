#!/usr/bin/env bash
# CI VEHICLE ONLY (never merged, never run on the VPS): proves on REAL systemd
# + REAL pm2 6.0.14 that the NARO deploy / rollback paths and the OS-user
# migration leave the VPS's other tenants and the recovery access alone.
#
#   root: REPO=<built checkout> DATABASE_URL=... bash ci-osu/osu-neighbours-rehearsal.sh
#
# Decoys, as on the VPS (2026-11-09):
#   root daemon (pm2-root.service): the 3 NARO apps + jumuiya-web (cluster,
#     :3100), jumuiya-staging-web (:3110), sportflow-web (fork, :3200),
#     pm2-logrotate (stand-in), jumuiya-cron (STOPPED), jumuiya-worker (ERRORED)
#   kiuruwi daemon (pm2-kiuruwi.service, user kiuruwi): kiuruwi-web (:3300)
# Runs the REAL deploy.sh (via the same steps as the CI deploy job) and the
# REAL rollback.sh in root mode, the OS-user migration of docs/OPS/OS_USER.md,
# deploy + rollback in OS-user mode, the migration's rollback, and a final
# root-mode deploy. Only builds and `pnpm install` are stand-ins
# (ci-osu/shim-pnpm.sh); every pm2 call the deploy scripts make is traced
# (ci-osu/shim-pm2.sh) and must be one of the NARO allow-list.
set -uo pipefail
: "${REPO:?}" "${DATABASE_URL:?}"
export HOME=/root PM2_HOME=/root/.pm2
APP=/var/www/naro-fashion
NHOME=/home/naro
KHOME=/home/kiuruwi
SHIM=/usr/local/lib/naro-rehearsal
TRACE=/var/log/pm2-trace.log
ORIGIN=/srv/naro-origin.git
PM2BIN="$(command -v pm2)"
PNPMBIN="$(command -v pnpm)"
NODEDIR="$(dirname "$(command -v node)")"
SYSPATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
results=()
fails=0
pass() { results+=("PASS  $1"); echo "  ✔ $1"; }
fail() { results+=("FAIL  $1"); fails=$((fails + 1)); echo "  ✖ $1"; }
check() {
  if eval "$2" > /tmp/step.out 2>&1; then pass "$1"; else
    fail "$1"; sed 's/^/      | /' /tmp/step.out | tail -40
  fi
}
G() { git -C "$APP" -c user.name=rehearsal -c user.email=rehearsal@ci -c core.autocrlf=false -c core.hooksPath=/dev/null "$@"; }
rpm2() { "$PM2BIN" "$@"; }
npm2() { sudo -u naro -H env PATH="$NODEDIR:$SYSPATH" PM2_HOME="$NHOME/.pm2" "$PM2BIN" "$@"; }
kpm2() { sudo -u kiuruwi -H env PATH="$NODEDIR:$SYSPATH" PM2_HOME="$KHOME/.pm2" "$PM2BIN" "$@"; }
guard() { (cd "$APP" && bash scripts/ops/pm2-guard.sh) > /tmp/guard.out 2>&1; }
guard_pass() { guard; local rc=$?; cat /tmp/guard.out; [ "$rc" = 0 ] && grep -q "PASSED" /tmp/guard.out && ! grep -q '✖' /tmp/guard.out; }
health_commit() { curl -sf -m 5 http://127.0.0.1:4000/api/v1/health | grep -q "\"commit\":\"$1\""; }
wait_commit() { local _; for _ in $(seq 1 60); do health_commit "$1" && return 0; sleep 1; done; curl -s -m 5 http://127.0.0.1:4000/api/v1/health; return 1; }
api_user() { stat -c %U "/proc/$(pgrep -f "$APP/apps/api/dist/main.js" | head -1)"; }
sum() { sha256sum < "$1" 2>/dev/null | cut -c1-64; }

# --- what must never change ---------------------------------------------------
neighbours() {
  # The other tenants: both other daemons (systemd MainPID, restarts, start
  # time, pid file) and every non-NARO app (pid, restart count, start time,
  # status). Any restart / stop / start / respawn changes this text.
  local u
  for u in pm2-root.service pm2-kiuruwi.service; do
    echo "$u $(systemctl show "$u" -p MainPID -p NRestarts -p ExecMainStartTimestampMonotonic -p ActiveState | tr '\n' ' ')"
  done
  echo "root daemon pid $(cat /root/.pm2/pm2.pid)  kiuruwi daemon pid $(cat "$KHOME/.pm2/pm2.pid")"
  echo "-- root daemon, non-NARO apps:"; rpm2 jlist 2>/dev/null | node "$SHIM/jlist-filter.js"
  echo "-- kiuruwi daemon:"; kpm2 jlist 2>/dev/null | node "$SHIM/jlist-filter.js"
  echo "kiuruwi dump.pm2 $(sum "$KHOME/.pm2/dump.pm2")"
}
access_state() {
  # Recovery access: sshd config, root's keys, sudoers, PAM, firewall config,
  # root's password hash + account line, and the ssh service.
  local f d
  for f in /etc/ssh/sshd_config /root/.ssh/authorized_keys /etc/sudoers; do
    echo "$f $(stat -c '%U:%G %a' "$f" 2>/dev/null) $(sum "$f")"
  done
  for d in /etc/ssh/sshd_config.d /etc/sudoers.d /etc/pam.d /etc/ufw /etc/security; do
    [ -d "$d" ] && find "$d" -type f -print0 | sort -z | xargs -0 -r sha256sum
  done
  stat -c '%n %U:%G %a' /root/.ssh
  echo "root shadow line $(getent shadow root | sha256sum | cut -c1-64)"
  getent passwd root
  systemctl show ssh.service -p ActiveState -p MainPID -p NRestarts 2>/dev/null | tr '\n' ' '; echo
}
units_state() { sha256sum /etc/systemd/system/pm2-root.service /etc/systemd/system/pm2-kiuruwi.service; }
same_as() { # same_as <label> <expected> <actual>
  [ "$2" = "$3" ] && return 0
  echo "$1 CHANGED:"; diff <(printf '%s\n' "$2") <(printf '%s\n' "$3")
  return 1
}
tmark() { wc -l < "$TRACE" | tr -d ' '; }
trace_only_naro() {
  # trace_only_naro <mark> <uid> <PM2_HOME>: every pm2 call the deploy scripts
  # made since <mark> ran as <uid> against <PM2_HOME> and is on the allow-list
  local l rest n=0 bad=0
  while IFS= read -r l; do
    n=$((n + 1)); echo "  pm2 $l"
    case "$l" in
      "uid=$2 home=$3 args="*) rest="${l#"uid=$2 home=$3 args="}" ;;
      *) echo "  ^ WRONG user/daemon"; bad=1; continue ;;
    esac
    case "$rest" in
      "reload ecosystem.config.js --only naro-api --update-env"|"restart ecosystem.config.js --only naro-storefront,naro-admin --update-env"|save|status|'logs /^naro-(api|storefront|admin)$/ --nostream --lines 40') ;;
      *) echo "  ^ NOT on the NARO allow-list"; bad=1 ;;
    esac
  done < <(tail -n +"$(( $1 + 1 ))" "$TRACE")
  [ "$bad" = 0 ] && [ "$n" -ge 3 ]
}
ci_deploy() {
  # What .github/workflows/deploy-prod.yml's deploy step runs on the VPS.
  ( cd "$APP" || exit 1
    export PATH="$SHIM:$PATH" DB_USER=postgres PGPASSFILE=/root/.pgpass
    set -e
    bash scripts/ops/pm2-guard.sh
    git fetch -q origin prod
    git checkout -q -f prod
    git reset -q --hard origin/prod
    EXPECTED_SHA="$1" bash deploy.sh ) > /tmp/deploy.out 2>&1
  local rc=$?
  tail -60 /tmp/deploy.out
  return "$rc"
}
do_rollback() {
  ( cd "$APP" && export PATH="$SHIM:$PATH" && bash scripts/ops/rollback.sh --yes ) > /tmp/rollback.out 2>&1
  local rc=$?
  tail -40 /tmp/rollback.out
  return "$rc"
}

echo "== 0. recovery access + tooling stand-ins"
if [ ! -f /etc/ssh/sshd_config ]; then
  mkdir -p /etc/ssh
  printf 'PermitRootLogin prohibit-password\nPasswordAuthentication no\n' > /etc/ssh/sshd_config
  echo "  (created /etc/ssh/sshd_config for the rehearsal)"
fi
mkdir -p /root/.ssh && chmod 700 /root/.ssh
if [ ! -s /root/.ssh/authorized_keys ]; then
  echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIREHEARSALONLYnotARealKey00000000000000000 rehearsal@ci" > /root/.ssh/authorized_keys
  chmod 600 /root/.ssh/authorized_keys
  echo "  (created /root/.ssh/authorized_keys for the rehearsal)"
fi
ACCESS0="$(access_state)"
echo "$ACCESS0" | sed 's/^/    /'
mkdir -p "$SHIM"
cp "$REPO/ci-osu/standin-server.js" "$REPO/ci-osu/jlist-filter.js" "$SHIM/"
sed "s|__REAL_PM2__|$PM2BIN|" "$REPO/ci-osu/shim-pm2.sh" > "$SHIM/pm2"
sed -e "s|__REAL_PNPM__|$PNPMBIN|" -e "s|__STANDIN__|$SHIM/standin-server.js|" "$REPO/ci-osu/shim-pnpm.sh" > "$SHIM/pnpm"
chmod 755 "$SHIM" "$SHIM/pm2" "$SHIM/pnpm"; chmod 644 "$SHIM"/*.js
: > "$TRACE"; chmod 666 "$TRACE"
printf 'localhost:5432:*:postgres:ci\n' > /root/.pgpass; chmod 600 /root/.pgpass

echo "== 1. the VPS today: NARO + neighbours in the root daemon, kiuruwi in its own"
rm -rf "$APP" /var/www/jumuiya /var/www/sportflow /var/www/kiuruwi "$ORIGIN"
mkdir -p /var/www && cp -a "$REPO" "$APP" && chown -R root:root "$APP"
for f in "$APP/.env" "$APP/apps/api/.env" "$APP/packages/database/.env"; do
  printf 'DATABASE_URL="%s"\nJWT_SECRET=rehearsal-only-jwt-secret-0123456789abcdef0123456789abcdef\nJWT_REFRESH_SECRET=rehearsal-only-refresh-secret-0123456789abcdef0123456789\n' "$DATABASE_URL" > "$f"
  chown root:root "$f"; chmod 600 "$f"
done
mkdir -p "$APP/apps/api/uploads/products"
# git: prod = V1 (live) -> V2 on origin, like the VPS between two releases
git init -q --bare "$ORIGIN"
G checkout -q --orphan prod && G commit -q -m "rehearsal v1"
G remote remove origin 2>/dev/null; G remote add origin "$ORIGIN"
G push -q origin prod
V1="$(G rev-parse HEAD)"
G commit -q --allow-empty -m "rehearsal v2" && G push -q origin prod
V2="$(G rev-parse HEAD)"
G reset -q --hard "$V1" && G fetch -q origin
V3="$(G commit-tree -p "$V2" -m "rehearsal v3" "$V2^{tree}")"   # pushed later
for app in storefront admin; do
  (cd "$APP" && PATH="$SHIM:$PATH" pnpm --filter "$app" build)
  d="$APP/apps/$app/.next"; mkdir -p "$d/standalone/apps/$app/.next" && cp -a "$d/static" "$d/standalone/apps/$app/.next/static"
done
mkdir -p "$APP/.deploy" && echo "$V1" > "$APP/.deploy/current_sha"
# neighbours' code
for n in jumuiya sportflow kiuruwi; do mkdir -p "/var/www/$n" && cp "$SHIM/standin-server.js" "/var/www/$n/server.js"; done
printf 'setInterval(() => {}, 1e9);\n' > /var/www/jumuiya/idle.js
printf 'process.exit(1);\n' > /var/www/jumuiya/crash.js
chmod -R a+rX /var/www/jumuiya /var/www/sportflow /var/www/kiuruwi
# root daemon under systemd
"$PM2BIN" startup systemd -u root --hp /root > /dev/null 2>&1
systemctl start pm2-root.service; sleep 2
(cd "$APP" && GIT_SHA="$V1" rpm2 start ecosystem.config.js > /dev/null)
(cd /var/www/jumuiya && PORT=3100 HOST=127.0.0.1 STANDIN_LABEL=jumuiya rpm2 start server.js --name jumuiya-web -i 1 > /dev/null)
(cd /var/www/jumuiya && PORT=3110 HOST=127.0.0.1 STANDIN_LABEL=jumuiya-staging rpm2 start server.js --name jumuiya-staging-web > /dev/null)
(cd /var/www/sportflow && PORT=3200 HOST=127.0.0.1 STANDIN_LABEL=sportflow rpm2 start server.js --name sportflow-web > /dev/null)
rpm2 start /var/www/jumuiya/idle.js --name pm2-logrotate > /dev/null
rpm2 start /var/www/jumuiya/idle.js --name jumuiya-cron > /dev/null && rpm2 stop jumuiya-cron > /dev/null
rpm2 start /var/www/jumuiya/crash.js --name jumuiya-worker --max-restarts 2 --min-uptime 10000 --restart-delay 200 > /dev/null
for _ in $(seq 1 40); do rpm2 jlist | node "$SHIM/jlist-filter.js" | grep -q '^jumuiya-worker .*status=errored' && break; sleep 1; done
rpm2 save > /dev/null
# kiuruwi: its own account, unit and daemon
useradd --system --create-home --home-dir "$KHOME" --shell /usr/sbin/nologin kiuruwi
"$PM2BIN" startup systemd -u kiuruwi --hp "$KHOME" > /dev/null 2>&1
systemctl start pm2-kiuruwi.service; sleep 2
(cd /var/www/kiuruwi && sudo -u kiuruwi -H env PATH="$NODEDIR:$SYSPATH" PM2_HOME="$KHOME/.pm2" PORT=3300 HOST=127.0.0.1 STANDIN_LABEL=kiuruwi "$PM2BIN" start server.js --name kiuruwi-web > /dev/null)
kpm2 save > /dev/null
sleep 3
BASE="$(neighbours)"
UNITS0="$(units_state)"
echo "$BASE" | sed 's/^/    /'
check "set-up: jumuiya-cron is STOPPED and jumuiya-worker is ERRORED (neighbours in a bad state)" 'echo "$BASE" | grep -q "^jumuiya-cron .*status=stopped" && echo "$BASE" | grep -q "^jumuiya-worker .*status=errored"'
check "set-up: neighbours serve :3100 / :3110 / :3200 / :3300" 'for p in 3100 3110 3200 3300; do curl -sf -m 3 "http://127.0.0.1:$p/" > /dev/null || exit 1; done'
check "set-up: NARO live at V1 (root mode)" 'wait_commit "$V1"'

echo "== 2. ROOT mode: guard, real deploy (CI steps), real rollback"
check "root mode: guard PASSES with stopped + errored neighbours and kiuruwi's daemon (warning only)" 'guard_pass && grep -q "non-root PM2 daemon pid .* not NARO.s, ignored" /tmp/guard.out'
m="$(tmark)"
check "root mode: deploy.sh V1 -> V2 exit 0, V2 live" 'ci_deploy "$V2" && wait_commit "$V2"'
check "root mode: deploy ran ONLY the NARO pm2 commands, as root, against /root/.pm2" 'trace_only_naro "$m" 0 /root/.pm2'
check "root mode: neighbours untouched by the deploy (PIDs, restarts, status, daemons)" 'same_as neighbours "$BASE" "$(neighbours)"'
m="$(tmark)"
check "root mode: rollback.sh exit 0, V1 live again" 'do_rollback && wait_commit "$V1"'
check "root mode: rollback ran ONLY the NARO pm2 commands" 'trace_only_naro "$m" 0 /root/.pm2'
check "root mode: neighbours untouched by the rollback" 'same_as neighbours "$BASE" "$(neighbours)"'

echo "== 3. OS-user migration (docs/OPS/OS_USER.md rollout, in order)"
useradd --system --create-home --home-dir "$NHOME" --shell /usr/sbin/nologin naro
NUID="$(id -u naro)"
"$PM2BIN" startup systemd -u naro --hp "$NHOME" > /dev/null 2>&1
systemctl start pm2-naro.service; sleep 2
(cd "$APP" && for f in .env apps/api/.env packages/database/.env; do chown root:naro "$f" && chmod 640 "$f"; done \
  && mkdir -p apps/api/uploads apps/api/private-uploads && chown -R naro:naro apps/api/uploads apps/api/private-uploads && chmod 700 apps/api/private-uploads)
check "migration step 4: guard && pm2 delete the 3 NARO apps && pm2 save (root daemon)" '(cd "$APP" && bash scripts/ops/pm2-guard.sh && rpm2 delete naro-api naro-storefront naro-admin && rpm2 save)'
check "migration step 4: NARO apps started under naro (GIT_SHA from .deploy/current_sha)" '(cd "$APP" && sudo -u naro -H env PATH="$NODEDIR:$SYSPATH" PM2_HOME="$NHOME/.pm2" GIT_SHA="$(cat .deploy/current_sha)" "$PM2BIN" start ecosystem.config.js && npm2 save) && wait_commit "$V1"'
printf 'NARO_PM2_USER=naro\nNARO_PM2_HOME=%s/.pm2\nNARO_PM2_UNIT=pm2-naro.service\nNARO_PM2_PATH=%s:%s:%s\n' "$NHOME" "$SHIM" "$NODEDIR" "$SYSPATH" > /tmp/naro-pm2.env
install -m 644 -o root -g root /tmp/naro-pm2.env /etc/naro-pm2.env
check "migration step 5: guard PASSES in OS-user mode (neighbours + kiuruwi present)" 'guard_pass && grep -q "OS-user mode: NARO apps belong to pm2-naro.service" /tmp/guard.out'
check "migration step 6: naro_fs_modes" '(cd "$APP" && . scripts/ops/deploy-lib.sh && naro_fs_modes)'
check "migration: API runs as naro" '[ "$(api_user)" = naro ]'
check "migration: neighbours untouched by the whole migration" 'same_as neighbours "$BASE" "$(neighbours)"'

echo "== 4. OS-USER mode: real deploy (CI steps) + real rollback"
G push -q origin "$V3:refs/heads/prod"
ROOTDUMP="$(sum /root/.pm2/dump.pm2)"
m="$(tmark)"
check "OS-user mode: deploy.sh V1 -> V3 exit 0, V3 live" 'ci_deploy "$V3" && wait_commit "$V3"'
check "OS-user mode: deploy ran ONLY the NARO pm2 commands, as naro, against /home/naro/.pm2 (none on the root daemon)" 'trace_only_naro "$m" "$NUID" "$NHOME/.pm2"'
check "OS-user mode: the deploy's printed DB-rollback help carries the naro prefix" 'grep -qF "sudo -u naro -H env PM2_HOME=$NHOME/.pm2 pm2 stop naro-api" /tmp/deploy.out'
check "OS-user mode: API still runs as naro after the deploy" '[ "$(api_user)" = naro ]'
check "OS-user mode: neighbours untouched by the deploy" 'same_as neighbours "$BASE" "$(neighbours)"'
m="$(tmark)"
check "OS-user mode: rollback.sh exit 0, V1 live again" 'do_rollback && wait_commit "$V1"'
check "OS-user mode: rollback ran ONLY the NARO pm2 commands, as naro" 'trace_only_naro "$m" "$NUID" "$NHOME/.pm2"'
check "OS-user mode: neighbours untouched by the rollback" 'same_as neighbours "$BASE" "$(neighbours)"'
check "OS-user mode: root daemon dump.pm2 never written during the OS-user deploy + rollback" '[ "$(sum /root/.pm2/dump.pm2)" = "$ROOTDUMP" ]'

echo "== 5. OS-user rollback (docs/OPS/OS_USER.md 'Rollback', in order)"
rm -f /etc/naro-pm2.env
check "migration rollback step 1: switch removed while apps run as naro -> guard refuses (fail closed)" '! guard && grep -q "runs OUTSIDE pm2-root.service" /tmp/guard.out'
check "migration rollback step 2: naro apps deleted, naro unit stopped + disabled" '(cd "$APP" && npm2 delete naro-api naro-storefront naro-admin && npm2 save --force) && systemctl stop pm2-naro.service && systemctl disable pm2-naro.service'
(cd "$APP" && for f in .env apps/api/.env packages/database/.env; do chown root:root "$f" && chmod 600 "$f"; done)
check "migration rollback step 4: guard && pm2 start ecosystem (root) && pm2 save" '(cd "$APP" && bash scripts/ops/pm2-guard.sh && GIT_SHA="$(cat .deploy/current_sha)" rpm2 start ecosystem.config.js && rpm2 save) && wait_commit "$V1"'
check "migration rollback: API runs as root, guard PASSES in root mode" '[ "$(api_user)" = root ] && guard_pass'
check "migration rollback: neighbours untouched" 'same_as neighbours "$BASE" "$(neighbours)"'

echo "== 6. ROOT mode again: a normal deploy after the round trip"
m="$(tmark)"
check "root mode: deploy.sh V1 -> V3 exit 0, V3 live" 'ci_deploy "$V3" && wait_commit "$V3"'
check "root mode: only NARO pm2 commands, as root" 'trace_only_naro "$m" 0 /root/.pm2'

echo "== 7. end state"
check "neighbours unchanged over the WHOLE run (same PIDs, restart counts, start times, status; both daemons never restarted)" 'same_as neighbours "$BASE" "$(neighbours)"'
check "pm2-root.service + pm2-kiuruwi.service unit files unchanged" 'same_as units "$UNITS0" "$(units_state)"'
check "recovery access unchanged: sshd_config, root authorized_keys, sudoers, PAM, firewall config, root password, ssh service" 'same_as access "$ACCESS0" "$(access_state)"'
check "exactly two PM2 daemons left (root + kiuruwi), no stray naro daemon" '[ "$(pgrep -c -f "^PM2 v[^ ]*: God Daemon")" = 2 ] && ! pgrep -u naro -f "God Daemon"'
check "the naro account adds no login path (nologin shell, locked password, no ~/.ssh)" '[ "$(getent passwd naro | cut -d: -f7)" = /usr/sbin/nologin ] && getent shadow naro | cut -d: -f2 | grep -qE "^[!*]" && [ ! -e "$NHOME/.ssh" ]'
echo "  pm2 calls traced from the deploy scripts over the whole run:"; sed 's/^/    /' "$TRACE"

echo; echo "================ summary"
printf '%s\n' "${results[@]}"
echo "$(( ${#results[@]} - fails ))/${#results[@]} passed"
[ "$fails" -eq 0 ]
