#!/usr/bin/env bash
# PM2 supervision preflight guard — run before ANY root `pm2` command.
#
#   bash scripts/ops/pm2-guard.sh            # report, exit 0 = safe, 1 = refuse
#   . scripts/ops/pm2-guard.sh; pm2_supervision_check [--quiet]
#
# WHY: every `pm2 <anything>` CLI call (status, logs, reload, save...) starts
# a NEW PM2 daemon when it cannot reach one. Run from an SSH session, that
# daemon lives in the SSH session's cgroup instead of pm2-root.service — the
# unsupervised state recovered on 2026-11-09 (the VPS is shared with
# Jumuiya, sportflow and others, so a stray daemon affects every app).
# This guard proves supervision is intact WITHOUT invoking pm2, and it NEVER
# starts, resurrects or repairs PM2. Recovery is an administrator's job,
# through systemd (docs/OPS/DEPLOY.md "PM2 supervision guard").
#
# Checks (all must pass):
#   1. caller is root and the pm2 CLI would use the unit's PM2_HOME
#   2. pm2-root.service is loaded, active, running, with a MainPID
#   3. PM2_HOME/pm2.pid exists and equals the unit's MainPID
#   4. that PID is alive, uid 0, titled "PM2 ... God Daemon (PM2_HOME)",
#      and lives in the unit's cgroup (NOT an SSH session scope)
#   5. rpc.sock + pub.sock are sockets with exactly one listener each,
#      held by that daemon
#   6. no other root PM2 God Daemon is running anywhere
#   7. whatever listens on each NARO port (from ecosystem.config.js) is the
#      daemon or one of its descendants inside the unit's cgroup
#   8. no NARO app process runs outside the unit's cgroup, and the daemon
#      has no more direct children per app than ecosystem `instances`
#
# NARO OS-user mode (round 25F): when /etc/naro-pm2.env exists (root-owned,
# not writable by group/others) it names a dedicated unprivileged account:
#   NARO_PM2_USER=naro  NARO_PM2_HOME=/home/naro/.pm2  NARO_PM2_UNIT=pm2-naro.service
# Then checks 2-5 run for BOTH units (the root daemon still hosts the other
# VPS apps and must stay supervised), and checks 6-8 hold the NARO apps to the
# naro daemon: inside its cgroup and tree, running as that user, ports held
# there, no NARO app left in the root daemon, no second naro daemon. Without
# the file the behaviour is exactly the root-only check above.
#
# Uses only systemctl (read-only `show`), ss, node (to read
# ecosystem.config.js) and /proc. Overrides for the self-test
# (scripts/ops/tests/pm2-guard.test.sh) are honoured ONLY when
# PM2_GUARD_TEST=1; deploy.sh and rollback.sh unset it.

PM2_GUARD_UNIT="pm2-root.service"
PM2_GUARD_NARO_CONF_DEFAULT="/etc/naro-pm2.env"

_pm2g_setup() {
  if [ "${PM2_GUARD_TEST:-}" = "1" ]; then
    _PG_PROC="${PM2_GUARD_PROC_ROOT:-/proc}"
    _PG_SYSTEMCTL="${PM2_GUARD_SYSTEMCTL:-systemctl}"
    _PG_SS="${PM2_GUARD_SS:-ss}"
    _PG_UID="${PM2_GUARD_UID:-$(id -u)}"
    _PG_SOCKFLAG="${PM2_GUARD_SOCKET_FLAG:--S}"
  else
    _PG_PROC="/proc"
    _PG_SYSTEMCTL="systemctl"
    _PG_SS="ss"
    _PG_UID="$(id -u)"
    _PG_SOCKFLAG="-S"
  fi
  _PG_APP_DIR="${APP_DIR:-/var/www/naro-fashion}"
  _pm2g_naro_conf
  _PG_FAILS=0
  _PG_WARNS=0
  _PG_REPORT=""
}

# OS-user mode switch (see header). Sets _PG_NARO_MODE / _USER / _HOME / _UNIT /
# _UID, and _PG_NARO_CONF_ERR when the switch itself is unsafe or incomplete.
_pm2g_naro_conf() {
  local conf="$PM2_GUARD_NARO_CONF_DEFAULT" meta mode
  [ "${PM2_GUARD_TEST:-}" = "1" ] && conf="${PM2_GUARD_NARO_CONF:-$conf}"
  _PG_NARO_MODE=0; _PG_NARO_USER=""; _PG_NARO_HOME=""; _PG_NARO_UNIT=""; _PG_NARO_UID=""; _PG_NARO_CONF_ERR=""; _PG_NARO_PATH=""
  [ -f "$conf" ] || return 0
  _PG_NARO_MODE=1
  _PG_NARO_USER="$(sed -n 's/^NARO_PM2_USER=//p' "$conf" | head -1 | tr -d '"')"
  _PG_NARO_HOME="$(sed -n 's/^NARO_PM2_HOME=//p' "$conf" | head -1 | tr -d '"')"
  _PG_NARO_UNIT="$(sed -n 's/^NARO_PM2_UNIT=//p' "$conf" | head -1 | tr -d '"')"
  _PG_NARO_USER="${_PG_NARO_USER:-naro}"
  _PG_NARO_HOME="${_PG_NARO_HOME:-/home/${_PG_NARO_USER}/.pm2}"
  _PG_NARO_HOME="${_PG_NARO_HOME%/}"
  _PG_NARO_UNIT="${_PG_NARO_UNIT:-pm2-${_PG_NARO_USER}.service}"
  _PG_NARO_PATH="$(sed -n 's/^NARO_PM2_PATH=//p' "$conf" | head -1 | tr -d '"')"
  _PG_NARO_PATH="${_PG_NARO_PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}"
  if [ "${PM2_GUARD_TEST:-}" = "1" ]; then
    _PG_NARO_UID="${PM2_GUARD_NARO_UID:-}"
  else
    _PG_NARO_UID="$(id -u "$_PG_NARO_USER" 2>/dev/null || true)"
    # the switch itself must be root's: nobody else may redirect pm2 commands
    meta="$(stat -c '%u %a' "$conf" 2>/dev/null || true)"
    mode="${meta##* }"
    if [ "${meta%% *}" != "0" ] || ! [[ "$mode" =~ ^[0-7]+$ ]] || [ $(( 8#$mode & 8#022 )) -ne 0 ]; then
      _PG_NARO_CONF_ERR="${conf} must be owned by root and not writable by group/others (got '${meta}')"
    fi
  fi
  if ! [[ "$_PG_NARO_UID" =~ ^[1-9][0-9]*$ ]]; then
    _PG_NARO_CONF_ERR="${_PG_NARO_CONF_ERR:+${_PG_NARO_CONF_ERR}; }account '${_PG_NARO_USER}' from ${conf} has no non-root uid ('${_PG_NARO_UID}')"
  fi
}

_pm2g_add() { _PG_REPORT+="$1"$'\n'; }
_pm2g_ok() { _pm2g_add "  ✔ $*"; }
_pm2g_warn() { _PG_WARNS=$((_PG_WARNS + 1)); _pm2g_add "  ⚠ $*"; }
_pm2g_fail() { _PG_FAILS=$((_PG_FAILS + 1)); _pm2g_add "  ✖ $*"; }

# key=value from `systemctl show` output held in $1
_pm2g_prop() { printf '%s\n' "$1" | sed -n "s/^$2=//p" | head -1; }

_pm2g_cmdline() { tr '\0' ' ' 2>/dev/null < "${_PG_PROC}/$1/cmdline" | sed 's/ *$//'; }

# The daemon sets process.title = "PM2 v<ver>: God Daemon (<PM2_HOME>)".
# Anchored, so an operator's concurrent `grep "God Daemon"` is not counted.
_pm2g_is_daemon_title() { [[ "$1" =~ ^PM2\ v[^\ ]*:\ God\ Daemon ]]; }

_pm2g_uid() { awk '/^Uid:/ {print $2; exit}' "${_PG_PROC}/$1/status" 2>/dev/null; }

_pm2g_ppid() { awk '/^PPid:/ {print $2; exit}' "${_PG_PROC}/$1/status" 2>/dev/null; }

_pm2g_cgroup() {
  # cgroup v2 ("0::/path"); v1 fallback: the name=systemd hierarchy.
  local f="${_PG_PROC}/$1/cgroup" cg
  cg="$(sed -n 's/^0:://p' "$f" 2>/dev/null | head -1)"
  [ -n "$cg" ] || cg="$(sed -n 's/^[0-9]*:name=systemd://p' "$f" 2>/dev/null | head -1)"
  printf '%s' "$cg"
}

_pm2g_descends_from() {
  # _pm2g_descends_from <pid> <ancestor>: true if pid == ancestor or below it
  local pid="$1" anc="$2" depth=0
  while [ -n "$pid" ] && [ "$pid" != "0" ] && [ "$depth" -lt 64 ]; do
    [ "$pid" = "$anc" ] && return 0
    [ "$pid" = "1" ] && return 1
    pid="$(_pm2g_ppid "$pid")"
    depth=$((depth + 1))
  done
  return 1
}

_pm2g_pids_in() { grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u; }

# _pm2g_check_unit <unit> <uid> <user> <default PM2_HOME>: checks 2-5 for one
# supervising unit; results in _PGU_DAEMON / _PGU_CGROUP / _PGU_HOME.
# Reads the unix-socket listing from $unix_out (set by the caller).
_pm2g_check_unit() {
  # --- 2. systemd unit -------------------------------------------------------
  local unit="$1" want_uid="$2" want_user="$3" default_home="$4"
  local show load active sub mainpid cgroup pidfile envline unit_user home
  show="$("$_PG_SYSTEMCTL" show "$unit" --no-pager \
    -p LoadState -p ActiveState -p SubState -p MainPID -p ControlGroup \
    -p PIDFile -p Environment -p User 2>/dev/null || true)"
  load="$(_pm2g_prop "$show" LoadState)"
  active="$(_pm2g_prop "$show" ActiveState)"
  sub="$(_pm2g_prop "$show" SubState)"
  mainpid="$(_pm2g_prop "$show" MainPID)"
  cgroup="$(_pm2g_prop "$show" ControlGroup)"
  pidfile="$(_pm2g_prop "$show" PIDFile)"
  envline="$(_pm2g_prop "$show" Environment)"
  unit_user="$(_pm2g_prop "$show" User)"

  if [ "$load" != "loaded" ]; then
    _pm2g_fail "${unit} is not installed/loaded (LoadState='${load:-unknown}')"
  elif [ "$active" != "active" ] || [ "$sub" != "running" ]; then
    _pm2g_fail "${unit} is ${active:-unknown}/${sub:-unknown}, not active/running"
  else
    _pm2g_ok "${unit} active/running"
  fi
  if ! [[ "$mainpid" =~ ^[1-9][0-9]*$ ]]; then
    _pm2g_fail "${unit} has no MainPID ('${mainpid:-}') — no supervised daemon"
    mainpid=""
  fi
  if [ -z "$cgroup" ]; then
    _pm2g_fail "${unit} has no ControlGroup — cannot tie processes to it"
  fi
  if [ "$want_user" = "root" ]; then
    if [ -n "$unit_user" ] && [ "$unit_user" != "root" ]; then
      _pm2g_fail "${unit} runs as User='${unit_user}', expected root"
    fi
  elif [ "$unit_user" != "$want_user" ]; then
    _pm2g_fail "${unit} runs as User='${unit_user:-root}', expected ${want_user}"
  fi
  home="$(printf '%s\n' "$envline" | grep -oE '(^|[[:space:]])PM2_HOME=[^[:space:]]+' | head -1 | sed 's/.*PM2_HOME=//')"
  [ -n "$home" ] || home="$default_home"
  home="${home%/}"
  if [ "$want_user" != "root" ] && [ "$home" != "${default_home%/}" ]; then
    _pm2g_fail "${unit} uses PM2_HOME '${home}', expected '${default_home%/}'"
  fi

  # --- 3. PID file ------------------------------------------------------------
  local daemon=""
  if [ -n "$pidfile" ] && [ "${pidfile%/}" != "${home}/pm2.pid" ]; then
    _pm2g_fail "unit PIDFile '${pidfile}' is not ${home}/pm2.pid"
  fi
  if [ ! -s "${home}/pm2.pid" ]; then
    _pm2g_fail "${home}/pm2.pid is missing or empty"
  else
    daemon="$(tr -d '[:space:]' 2>/dev/null < "${home}/pm2.pid")"
    if ! [[ "$daemon" =~ ^[1-9][0-9]*$ ]]; then
      _pm2g_fail "${home}/pm2.pid holds '${daemon}', not a PID"
      daemon=""
    elif [ -n "$mainpid" ] && [ "$daemon" != "$mainpid" ]; then
      _pm2g_fail "pm2.pid says ${daemon} but ${unit} MainPID is ${mainpid} — the daemon PM2 uses is not the one systemd supervises"
      daemon=""
    elif [ -n "$mainpid" ]; then
      _pm2g_ok "pm2.pid == MainPID (${daemon})"
    fi
  fi

  # --- 4. daemon identity -----------------------------------------------------
  if [ -n "$daemon" ]; then
    if [ ! -d "${_PG_PROC}/${daemon}" ]; then
      _pm2g_fail "daemon PID ${daemon} is not running"
      daemon=""
    else
      local cmd duid dcg title_home
      cmd="$(_pm2g_cmdline "$daemon")"
      duid="$(_pm2g_uid "$daemon")"
      dcg="$(_pm2g_cgroup "$daemon")"
      if [ "$want_user" = "root" ]; then
        [ "$duid" = "0" ] || _pm2g_fail "daemon ${daemon} runs as uid '${duid}', not root"
      else
        [ "$duid" = "$want_uid" ] || _pm2g_fail "daemon ${daemon} runs as uid '${duid}', not ${want_user} (uid ${want_uid})"
      fi
      if ! _pm2g_is_daemon_title "$cmd"; then
        _pm2g_fail "PID ${daemon} is not a PM2 God Daemon (cmdline: '${cmd:0:80}') — stale pid file / PID reuse?"
      else
        title_home="$(printf '%s' "$cmd" | sed -n 's/.*God Daemon (\([^)]*\)).*/\1/p')"
        if [ -z "$title_home" ]; then
          _pm2g_warn "daemon title has no PM2_HOME (truncated?) — identity rests on MainPID, cgroup and sockets"
        elif [ "${title_home%/}" != "$home" ]; then
          _pm2g_fail "daemon ${daemon} serves PM2_HOME '${title_home}', expected '${home}'"
        fi
      fi
      if [ -z "$dcg" ] || [ -z "$cgroup" ] || [ "$dcg" != "$cgroup" ]; then
        _pm2g_fail "daemon ${daemon} is in cgroup '${dcg:-?}', not ${unit} ('${cgroup:-?}') — it is NOT systemd-supervised"
      else
        _pm2g_ok "daemon ${daemon} is a ${want_user} God Daemon inside ${cgroup}"
      fi
    fi
  fi

  # --- 5. control sockets -----------------------------------------------------
  local sock lines pids
  for sock in rpc.sock pub.sock; do
    if ! test "$_PG_SOCKFLAG" "${home}/${sock}"; then
      _pm2g_fail "${home}/${sock} is missing or not a socket"
      continue
    fi
    lines="$(printf '%s\n' "$unix_out" | awk -v p="${home}/${sock}" '{for (i=1;i<=NF;i++) if ($i==p) {print; break}}')"
    local n=0
    [ -n "$lines" ] && n="$(printf '%s\n' "$lines" | wc -l | tr -d ' ')"
    pids="$(printf '%s\n' "$lines" | _pm2g_pids_in | tr '\n' ' ' | sed 's/ $//')"
    if [ "$n" != "1" ]; then
      _pm2g_fail "${sock}: ${n} listening sockets bound at ${home}/${sock} (expected exactly 1; pids: ${pids:-none})"
    elif [ -z "$daemon" ] || [ "$pids" != "$daemon" ]; then
      _pm2g_fail "${sock} is held by pid(s) '${pids:-?}', not the supervised daemon '${daemon:-?}'"
    else
      _pm2g_ok "${sock} held by daemon ${daemon}"
    fi
  done

  _PGU_DAEMON="$daemon"; _PGU_CGROUP="$cgroup"; _PGU_HOME="$home"
}

pm2_supervision_check() {
  local quiet=0
  [ "${1:-}" = "--quiet" ] && quiet=1
  _pm2g_setup

  local tool
  for tool in "$_PG_SYSTEMCTL" "$_PG_SS" node awk sed grep tr; do
    command -v "$tool" >/dev/null 2>&1 || _pm2g_fail "required tool '${tool}' not found — supervision is unverifiable"
  done
  if [ ! -r "${_PG_PROC}/1/status" ]; then
    _pm2g_fail "${_PG_PROC} is not readable — supervision is unverifiable"
  fi
  if [ "$_PG_FAILS" -gt 0 ]; then _pm2g_finish "$quiet"; return 1; fi

  local unix_out
  unix_out="$("$_PG_SS" -Hxlp 2>/dev/null)" || unix_out=""
  [ -n "$unix_out" ] || _pm2g_fail "'ss -xlp' returned nothing — socket ownership is unverifiable"

  # --- 2-5 for the root unit (it hosts the other VPS apps in every mode) -----
  _pm2g_check_unit "$PM2_GUARD_UNIT" 0 root /root/.pm2
  local root_daemon="$_PGU_DAEMON" root_cgroup="$_PGU_CGROUP" home="$_PGU_HOME"

  # --- 1. caller + PM2_HOME the CLI would use --------------------------------
  local cli_home="${PM2_HOME:-${HOME:-}/.pm2}"
  cli_home="${cli_home%/}"
  if [ "$_PG_UID" != "0" ]; then
    _pm2g_fail "running as uid ${_PG_UID}, not root — pm2 here would talk to a different (or new) daemon"
  fi
  if [ "$cli_home" != "$home" ]; then
    _pm2g_fail "pm2 CLI would use PM2_HOME='${cli_home}' but ${PM2_GUARD_UNIT} uses '${home}' — a pm2 call would start a second daemon"
  else
    _pm2g_ok "pm2 CLI targets the unit's PM2_HOME (${home})"
  fi

  # --- NARO daemon: the root one, or the dedicated account's (OS-user mode) ---
  local daemon="$root_daemon" cgroup="$root_cgroup" naro_unit="$PM2_GUARD_UNIT" naro_uid=0
  if [ "$_PG_NARO_MODE" = "1" ]; then
    naro_unit="$_PG_NARO_UNIT"; naro_uid="$_PG_NARO_UID"
    if [ -n "$_PG_NARO_CONF_ERR" ]; then
      _pm2g_fail "OS-user mode: ${_PG_NARO_CONF_ERR}"
      daemon=""; cgroup=""
    else
      _pm2g_ok "OS-user mode: NARO apps belong to ${naro_unit} (user ${_PG_NARO_USER}, uid ${naro_uid})"
      _pm2g_check_unit "$naro_unit" "$naro_uid" "$_PG_NARO_USER" "$_PG_NARO_HOME"
      daemon="$_PGU_DAEMON"; cgroup="$_PGU_CGROUP"
      if [ -n "$daemon" ] && [ "$daemon" = "$root_daemon" ]; then
        _pm2g_fail "${naro_unit} and ${PM2_GUARD_UNIT} report the same daemon ${daemon}"
        daemon=""
      fi
    fi
  fi

  # --- 6. second root daemon + 8. stray NARO processes ------------------------
  local apps_raw
  apps_raw="$(node -e '
    const c = require(process.argv[1]);
    for (const a of (c.apps || [])) {
      const port = (a.env && a.env.PORT) || "";
      console.log([a.name, port, a.instances == null ? 1 : a.instances].join(" "));
    }' "${_PG_APP_DIR}/ecosystem.config.js" 2>/dev/null)" || apps_raw=""
  if [ -z "$apps_raw" ]; then
    _pm2g_fail "could not read app names/ports/instances from ${_PG_APP_DIR}/ecosystem.config.js"
  fi

  local -a app_names=() app_ports=() app_inst=()
  local name port inst
  while read -r name port inst; do
    [ -n "$name" ] || continue
    if ! [[ "$port" =~ ^[0-9]+$ ]] || ! [[ "$inst" =~ ^[1-9][0-9]*$ ]]; then
      _pm2g_fail "ecosystem app '${name}' has port '${port}' / instances '${inst}' — need explicit numbers to verify"
      continue
    fi
    app_names+=("$name"); app_ports+=("$port"); app_inst+=("$inst")
  done <<< "$apps_raw"

  local -A direct_children=()
  local p pid pcmd env_txt i extra_daemons="" extra_naro=""
  for p in "${_PG_PROC}"/[0-9]*; do
    pid="${p##*/}"
    [ -r "$p/cmdline" ] || continue
    pcmd="$(_pm2g_cmdline "$pid")"
    if _pm2g_is_daemon_title "$pcmd" && [ "$pid" != "$root_daemon" ] && [ "$pid" != "$daemon" ]; then
      if [ "$(_pm2g_uid "$pid")" = "0" ]; then
        extra_daemons+="${pid}[$(_pm2g_cgroup "$pid")] "
      elif [ "$_PG_NARO_MODE" = "1" ] && [ "$(_pm2g_uid "$pid")" = "$naro_uid" ]; then
        extra_naro+="${pid}[$(_pm2g_cgroup "$pid")] "
      else
        _pm2g_warn "non-root PM2 daemon pid ${pid} (uid $(_pm2g_uid "$pid")) — not NARO's, ignored"
      fi
    fi
    [ "${#app_names[@]}" -gt 0 ] || continue
    env_txt="$(tr '\0' '\n' 2>/dev/null < "$p/environ")" || continue
    [ -n "$env_txt" ] || continue
    for i in "${!app_names[@]}"; do
      name="${app_names[$i]}"
      # fork mode: name=<app>; cluster mode: pm2_env={..."name":"<app>"...}
      if grep -qxF "name=${name}" <<< "$env_txt" \
         || grep -q "^pm2_env=.*\"name\":\"${name}\"" <<< "$env_txt"; then
        if [ -z "$cgroup" ] || [ "$(_pm2g_cgroup "$pid")" != "$cgroup" ]; then
          _pm2g_fail "${name} process ${pid} runs OUTSIDE ${naro_unit} (cgroup '$(_pm2g_cgroup "$pid")') — orphan from an unsupervised daemon?"
        elif [ "$_PG_NARO_MODE" = "1" ] && [ "$(_pm2g_uid "$pid")" != "$naro_uid" ]; then
          _pm2g_fail "${name} process ${pid} runs as uid '$(_pm2g_uid "$pid")', expected ${_PG_NARO_USER} (uid ${naro_uid})"
        elif [ -n "$daemon" ] && [ "$(_pm2g_ppid "$pid")" = "$daemon" ]; then
          direct_children[$name]=$(( ${direct_children[$name]:-0} + 1 ))
        fi
        break
      fi
    done
  done
  if [ -n "$extra_daemons" ]; then
    _pm2g_fail "another root PM2 God Daemon is running: ${extra_daemons% }"
  else
    _pm2g_ok "no second root PM2 daemon"
  fi
  if [ "$_PG_NARO_MODE" = "1" ]; then
    if [ -n "$extra_naro" ]; then
      _pm2g_fail "another ${_PG_NARO_USER} PM2 God Daemon is running: ${extra_naro% }"
    else
      _pm2g_ok "no second ${_PG_NARO_USER} PM2 daemon"
    fi
  fi

  # --- 7. NARO port listeners + instance counts -------------------------------
  local tcp_out lpids lp bad
  tcp_out="$("$_PG_SS" -Hltnp 2>/dev/null)" || tcp_out=""
  for i in "${!app_names[@]}"; do
    name="${app_names[$i]}"; port="${app_ports[$i]}"; inst="${app_inst[$i]}"
    lpids="$(printf '%s\n' "$tcp_out" | grep -E "[^[:space:]]:${port}[[:space:]]" | _pm2g_pids_in)"
    if [ -z "$lpids" ]; then
      _pm2g_warn "${name}: nothing listening on :${port} (app down? PM2 will start it)"
    else
      bad=""
      for lp in $lpids; do
        if [ -z "$daemon" ] || [ "$(_pm2g_cgroup "$lp")" != "$cgroup" ] || ! _pm2g_descends_from "$lp" "$daemon" \
           || { [ "$_PG_NARO_MODE" = "1" ] && [ "$(_pm2g_uid "$lp")" != "$naro_uid" ]; }; then
          bad+="${lp}[$(_pm2g_cgroup "$lp")] "
        fi
      done
      if [ -n "$bad" ]; then
        _pm2g_fail "${name}: :${port} is held by ${bad% }, outside the supervised daemon's tree"
      else
        _pm2g_ok "${name}: :${port} served from the supervised daemon tree"
      fi
    fi
    local nchild="${direct_children[$name]:-0}"
    if [ "$nchild" -gt "$inst" ]; then
      _pm2g_fail "${name}: ${nchild} instances under the daemon, ecosystem expects ${inst}"
    elif [ "$nchild" -eq 0 ]; then
      _pm2g_warn "${name}: no instance identified under the daemon (stopped, or env not visible)"
    else
      _pm2g_ok "${name}: ${nchild}/${inst} instance(s)"
    fi
  done

  _pm2g_finish "$quiet"
  [ "$_PG_FAILS" -eq 0 ]
}

_pm2g_finish() {
  local quiet="$1"
  if [ "$_PG_FAILS" -eq 0 ]; then
    [ "$quiet" -eq 1 ] && return 0
    echo "🛡  PM2 supervision check PASSED (${_PG_WARNS} warning(s)):"
    printf '%s' "$_PG_REPORT"
    return 0
  fi
  {
    echo "🛑 PM2 supervision check FAILED (${_PG_FAILS} problem(s)) — refusing to run any pm2 command:"
    printf '%s' "$_PG_REPORT"
    cat <<EOF
------------------------------------------------------------------------
Nothing was started, resurrected or changed. Do NOT run 'pm2 ...' from this
shell: with no reachable supervised daemon, ANY pm2 call starts a new,
unsupervised daemon in this SSH session.
An administrator must recover PM2 through systemd (the VPS is shared — other
apps run under the same daemon), e.g.:
  systemctl status ${PM2_GUARD_UNIT} --no-pager
  journalctl -u ${PM2_GUARD_UNIT} -n 100 --no-pager
  ps -eo pid,ppid,user,lstart,cgroup:60,args | grep -i '[G]od Daemon'
Runbook: docs/OPS/DEPLOY.md "PM2 supervision guard". Re-run the deploy
(or: bash scripts/ops/pm2-guard.sh) once this check passes.
------------------------------------------------------------------------
EOF
  } >&2
  return 1
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -uo pipefail
  pm2_supervision_check "$@"
  exit $?
fi
