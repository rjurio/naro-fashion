# NARO apps on a dedicated OS account (`naro`): tooling and runbook

**Status:** tooling only, **inactive until `/etc/naro-pm2.env` exists**. Production today runs every NARO app as root under `pm2-root.service`.

**Window:** a **separate** owner-authorised window from the database-role migration. The full design, inspection and rehearsal (32/32) are in the release kit, `OS_USER_ISOLATION.md`.

## What the tooling does in OS-user mode

**The switch:** `/etc/naro-pm2.env`, root-owned, not writable by group/others, not secret:
```
NARO_PM2_USER=naro
NARO_PM2_HOME=/home/naro/.pm2
NARO_PM2_UNIT=pm2-naro.service
# optional: NARO_PM2_PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
```

**`scripts/ops/pm2-guard.sh`** checks BOTH units (it still never runs pm2):
- `pm2-root.service`, as before, because it still hosts Jumuiya, Sportflow, staging and logrotate;
- `pm2-naro.service`: User=naro, active, MainPID = `/home/naro/.pm2/pm2.pid`, a God Daemon titled with that PM2_HOME, uid naro, inside the unit's cgroup, holding `rpc.sock` / `pub.sock`.

Then:
- every `naro-*` process must be inside the naro unit, running as uid naro;
- ports 4000 / 3000 / 3001 must be held by the naro daemon's tree, as naro;
- no `naro-*` app may be left in the root daemon;
- there must be no second naro daemon, and no second root daemon.

An unsafe or incomplete switch file is a refusal.

**`deploy-lib.sh`:**
- **Commands:** every NARO pm2 command goes through `naro_pm2`:
  ```sh
  sudo -u naro -H env PATH=… PM2_HOME=/home/naro/.pm2 GIT_SHA=… pm2 …
  ```
  The environment reset means no root variable or secret reaches the apps through `--update-env`. Still only the three named commands; never `all`.
- **File modes:** `naro_fs_modes` runs right before every reload:
  - `.env` ×3 → `root:naro 640`;
  - `apps/api/uploads` and `PRIVATE_UPLOAD_DIR` → naro (private one 700);
  - Next standalone caches → naro;
  - it refuses if code (`deploy.sh`, `ecosystem.config.js`, `apps/api/dist`) is naro-owned.
- **Rollback tooling:** a rollback to a commit whose guard predates OS-user mode keeps the current deploy tooling, as for pre-guard commits.

## Rollout (production window; needs the owner's authorisation)

1. **Pre-checks:**
   - `bash scripts/ops/pm2-guard.sh` PASS;
   - a backup (`pg-backup.sh`);
   - no other app building;
   - this tooling deployed (a normal deploy);
   - `PRIVATE_UPLOAD_DIR` known.
2. **Create the account:**
   ```sh
   useradd --system --create-home --home-dir /home/naro --shell /usr/sbin/nologin naro
   ```
3. **Start its daemon:**
   ```sh
   pm2 startup systemd -u naro --hp /home/naro
   systemctl start pm2-naro.service
   ```
   The first command creates and enables `pm2-naro.service`.
4. **Move the apps** (from `/var/www/naro-fashion`):
   - **File modes first**, so the apps can read `.env` as naro the moment they start (root still reads them; `<PRIVATE_UPLOAD_DIR>` from `apps/api/.env`, default `apps/api/private-uploads`):
     ```sh
     chown root:naro .env apps/api/.env packages/database/.env
     chmod 640 .env apps/api/.env packages/database/.env
     chown -R naro:naro apps/api/uploads <PRIVATE_UPLOAD_DIR> && chmod 700 <PRIVATE_UPLOAD_DIR>
     ```
   - As root (guarded; only the three NARO names, never `all`):
     ```sh
     bash scripts/ops/pm2-guard.sh && pm2 delete naro-api naro-storefront naro-admin && pm2 save
     ```
   - Then start them under naro, with the live commit for `/health`:
     ```sh
     sudo -u naro -H env PM2_HOME=/home/naro/.pm2 GIT_SHA="$(cat .deploy/current_sha)" pm2 start ecosystem.config.js
     sudo -u naro -H env PM2_HOME=/home/naro/.pm2 pm2 save
     ```
   - Rehearsed downtime: about 1.4 s per app.
5. **Turn the switch on:**
   ```sh
   install -m 644 -o root -g root naro-pm2.env /etc/naro-pm2.env
   ```
   Then run `bash scripts/ops/pm2-guard.sh`; it must PASS in OS-user mode.
6. **Re-assert the file modes** (also covers the Next caches): a normal deploy does it, or source `scripts/ops/deploy-lib.sh` from `/var/www/naro-fashion` and run `naro_fs_modes`.
7. **Verify:**
   - `/api/v1/health`, the storefront, admin login, an image upload;
   - logs in `/home/naro/.pm2/logs`;
   - the other apps' PIDs unchanged;
   - `systemctl is-enabled pm2-naro.service pm2-root.service` (both start at boot).

## Rollback

1. `rm /etc/naro-pm2.env`. The guard is then back in root-only mode and will refuse until step 3 is done, which fails closed.
2. Stop the naro apps and the unit:
   ```sh
   sudo -u naro -H env PM2_HOME=/home/naro/.pm2 pm2 delete naro-api naro-storefront naro-admin
   sudo -u naro -H env PM2_HOME=/home/naro/.pm2 pm2 save --force
   systemctl stop pm2-naro.service
   systemctl disable pm2-naro.service
   ```
3. `.env` ×3 back to `root:root 600`. Uploads can stay naro-owned, because root can write them.
4. Start the apps in the root daemon again (guarded):
   ```sh
   bash scripts/ops/pm2-guard.sh && GIT_SHA="$(cat .deploy/current_sha)" pm2 start ecosystem.config.js && pm2 save
   ```
5. Verify as in rollout step 7.

The account `naro` can stay.

**Never** `systemctl reload pm2-root` (its ExecReload is `pm2 reload all`), and never a bare pm2 command without the guard.

## Neighbour apps and recovery access

The VPS is shared: the root daemon (`pm2-root.service`) also runs Jumuiya (prod and staging), sportflow-web (:3200) and pm2-logrotate; kiuruwi has its own account and `pm2-kiuruwi.service`.

**What the NARO tooling touches** (deploy.sh, rollback.sh, deploy-lib.sh, pm2-guard.sh; both modes):
- pm2 commands: only `reload ecosystem.config.js --only naro-api`, `restart ecosystem.config.js --only naro-storefront,naro-admin`, `save`, and, on a failed deploy, `status` + `logs` of the three NARO apps. Every one runs behind the guard.
- **Root mode**: those commands go to the root daemon. `pm2 save` rewrites `/root/.pm2/dump.pm2`, which also records the other apps' current state, as their own deploys' `pm2 save` does.
- **OS-user mode**: they go only to the naro daemon, as user naro. NARO sends **no** command to the root daemon, and its dump is never written.
- `systemctl`: only the guard's read-only `systemctl show`.
- Files: the NARO tree only (`.env` ×3, uploads, private uploads and Next caches in OS-user mode).

**What it never touches:** any other app by name, `all`, `pm2 resurrect / kill / update / delete / startup`, `systemctl` start/stop/reload/restart/enable of `pm2-root` or `pm2-kiuruwi`, the kiuruwi daemon, sshd or its config, `/root/.ssh` / `authorized_keys`, PAM, sudoers, ufw, root's password, and user accounts. The self-test enforces this statically. It also runs deploy, rollback and automatic rollback in both modes with neighbour decoys online, stopped, errored and restarting, and fails if any neighbour PID changes.

**The guard and the neighbours:**
- Stopped, errored or restarting neighbours never fail it.
- Kiuruwi's daemon is a warning ("not NARO's, ignored").
- Look-alike names (for example `naro-admin-preview`) are not counted as NARO.
- A neighbour listening on :3200 or another port is not read as a NARO listener.
- It refuses only when something other than the NARO app holds a NARO port (4000 / 3000 / 3001), or when the root daemon itself is unsupervised. A broken root daemon therefore still blocks NARO deploys in OS-user mode: fail-safe, by design.
- Limit (root mode only): a neighbour in **cluster mode** on a NARO port can't be told apart, because the God Daemon holds every cluster port. OS-user mode removes this limit.

The **migration itself** (rollout steps 3–4 and rollback steps 2 and 4) runs root pm2 commands: `pm2 startup systemd -u naro`, then `pm2 delete` / `pm2 start` of the three NARO apps and `pm2 save`. They name only NARO apps or the naro unit. The `naro` account (`--shell /usr/sbin/nologin`, no password, no `~/.ssh`) adds no login path. Root runs `sudo -u naro` with the default sudoers, which doesn't change.

**Pre-window checks** (the window operator):
1. **Recovery access first.** Open a **second SSH session as root** from a trusted network (not the office network: it intercepts SSH) and keep it open, untouched, until the end. Know the way into the **Vultr web console** (my.vultr.com → the server → View Console) as the last resort if SSH is lost.
2. **Record the neighbours before:** `pm2 jlist` filtered to the other apps (name, pid, `restart_time`, status), the kiuruwi daemon's list (`sudo -u kiuruwi -H env PM2_HOME=/home/kiuruwi/.pm2 pm2 jlist`), and `systemctl show pm2-root.service pm2-kiuruwi.service -p MainPID -p NRestarts`. Run `pm2` as root only after `bash scripts/ops/pm2-guard.sh` passes, as always.
3. Also record `sha256sum /etc/ssh/sshd_config /root/.ssh/authorized_keys`.
4. **After the window**, compare all three: the other apps' PIDs and restart counts, both units' MainPID / NRestarts, and the checksums must be unchanged. Then check that `curl -sI` of Jumuiya, Sportflow and kiuruwi still answers, and that a **new** SSH login works before closing the kept session.

Rehearsed on real systemd + pm2 6.0.14 with all of these decoys, in both modes, including the migration and its rollback.
