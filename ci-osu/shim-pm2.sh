#!/usr/bin/env bash
# REHEARSAL ONLY: first `pm2` on the deploy scripts' PATH (root mode: the
# rehearsal PATH; OS-user mode: NARO_PM2_PATH in /etc/naro-pm2.env). Records
# who called it, which daemon (PM2_HOME) and the arguments, then runs the REAL
# pm2. The harness itself calls the real binary directly, so the trace holds
# ONLY what deploy.sh / rollback.sh / deploy-lib.sh ran.
printf 'uid=%s home=%s args=%s\n' "$(id -u)" "${PM2_HOME:-}" "$*" >> /var/log/pm2-trace.log
exec __REAL_PM2__ "$@"
