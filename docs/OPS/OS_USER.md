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
4. **Move the apps:**
   - As root (guarded; never `all`):
     ```sh
     bash scripts/ops/pm2-guard.sh && pm2 delete naro-api naro-storefront naro-admin && pm2 save
     ```
   - Then, from `/var/www/naro-fashion`, start them under naro:
     ```sh
     sudo -u naro -H env PM2_HOME=/home/naro/.pm2 pm2 start ecosystem.config.js
     sudo -u naro -H env PM2_HOME=/home/naro/.pm2 pm2 save
     ```
   - Rehearsed downtime: about 1.4 s per app.
5. **Turn the switch on:**
   ```sh
   install -m 644 -o root -g root naro-pm2.env /etc/naro-pm2.env
   ```
   Then run `bash scripts/ops/pm2-guard.sh`; it must PASS in OS-user mode.
6. **Apply the file modes once:** a normal deploy does it, or source `scripts/ops/deploy-lib.sh` from `/var/www/naro-fashion` and run `naro_fs_modes`.
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
   bash scripts/ops/pm2-guard.sh && pm2 start ecosystem.config.js && pm2 save
   ```
5. Verify as in rollout step 7.

The account `naro` can stay.

**Never** `systemctl reload pm2-root` (its ExecReload is `pm2 reload all`), and never a bare pm2 command without the guard.
