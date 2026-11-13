# Deploy and Rollback

Push to `prod` → `.github/workflows/deploy-prod.yml` runs the `verify` job
(typecheck, jest, audit), then SSHes to the VPS and runs
`EXPECTED_SHA=<sha> bash deploy.sh` in `/var/www/naro-fashion`.

## What `deploy.sh` does

| # | Stage | On failure |
|---|-------|-----------|
| 0 | **PM2 supervision guard** (`scripts/ops/pm2-guard.sh`, see below) — also run by the CI step before its own `git reset` | abort, nothing changed |
| 1 | `git fetch` + `reset --hard origin/prod`; assert `HEAD == EXPECTED_SHA`; work out the **live** commit (`.deploy/current_sha` → `/health` `commit` → `ORIG_HEAD`) | abort, nothing changed |
| 2 | `pnpm install --frozen-lockfile` | abort |
| 3 | `prisma generate` | abort |
| 4 | pre-deploy `pg_dump` via `scripts/ops/pg-backup.sh` (path printed) | abort, schema untouched |
| 5 | migrations: one-time 0_init baseline (only if no drift), `prisma migrate deploy`, post-migrate drift guard — see [MIGRATIONS.md](MIGRATIONS.md) | abort, old build still live |
| 6 | sequential IN-PLACE builds: api → storefront → admin, each after copying the live build aside (`dist-prev.pending`, `.next-prev.pending`, cache excluded); each Next build must contain `BUILD_ID` + `routes-manifest.json` | abort, pre-build copies restored, processes not reloaded |
| 6b | after each Next build: copy `.next/static` + `public` into the standalone server folder (`.next/standalone/apps/<app>/`) — PM2 runs that `server.js`, which serves only what's copied there | abort (missing `server.js`) |
| 6c | PM2 supervision guard again (builds take minutes) | abort, pre-build copies restored, processes not reloaded |
| 7 | promote the pre-build copies to `.next-prev` / `dist-prev`; write `.deploy/previous_sha` + `.deploy/current_sha`; `pm2 reload --only naro-api` + **hard** `pm2 restart --only naro-storefront,naro-admin` (`--update-env`, `GIT_SHA`) | automatic rollback |
| 8 | health checks: API `/api/v1/health` 200, storefront `/` (with a real tenant `Host`, from `STOREFRONT_DEFAULT_HOSTS`), admin `/`, **plus one `/_next/static` asset referenced by each app's page must return 200** | **automatic rollback** |

**Why not build to a side directory and rename it?** Tried on 2026-10-04 and it
broke production: `next build` bakes its `distDir` name into the output
(`required-server-files.json`, server chunks), so a build made in
`.next-build` and renamed to `.next` served HTML whose every `/_next/static`
CSS/JS asset returned 404 — an unstyled, non-interactive site for ~6.5 hours.
The HTML-only health check passed, which is why the asset probe now exists.
Trade-off of building in place: pages can misbehave for the few minutes a
build runs (same as before October 2026); a failed build restores the copy.

### Downtime: not zero, and why

All three PM2 apps run in **cluster mode, one instance each** on a 2GB VPS, so
`pm2 reload` is a stop/start: a few seconds of 502s per app. True zero
downtime would need cluster mode / two instances behind nginx (or blue-green
ports), which the RAM doesn't allow. The deploy only *minimises* the window
(the swap happens right before the reload, after all builds are done).
Brief caveat: `nest build` rebuilds `apps/api/dist` in place; the running API
keeps its code in memory, but on-demand reads from `dist` (Handlebars email
templates) can fail during the ~1 minute API build.

## PM2 supervision guard

> **OS-user mode (round 25F, inactive until `/etc/naro-pm2.env` exists):** the NARO apps can run under a dedicated unprivileged account `naro` with its own `pm2-naro.service`.
> - The guard then verifies both daemons; every NARO pm2 command goes through `naro_pm2` (`sudo -u naro`, reset environment).
> - `naro_fs_modes` re-asserts file modes before each reload.
> - Rollout, rollback and checks: [OS_USER.md](OS_USER.md).

### Who supervises PM2 on this VPS

Root PM2 is supervised by **`pm2-root.service`** (systemd, `Type=forking`,
`PIDFile=/root/.pm2/pm2.pid`, `ExecStart=pm2 resurrect`, `ExecStop=pm2 kill`).
Until 2026-11-09 the daemon lived inside an old SSH session. That root daemon
runs **every** root app on the box, not just NARO's. As verified on
2026-11-09 those are `naro-api`, `naro-storefront`, `naro-admin`,
`jumuiya-api`, `jumuiya-web`, `jumuiya-staging-api`, `jumuiya-staging-web`,
`sportflow-web` and `pm2-logrotate`. `kiuruwi` has its own daemon
(user `kiuruwi`, `pm2-kiuruwi.service`), which NARO never touches.

Any `pm2 ...` call, even `pm2 status`, **starts a new daemon when it can't
reach one**. Run from a deploy's SSH session, that daemon would bypass
systemd again. So **no pm2 command may run unless supervision is verified**:
`scripts/ops/pm2-guard.sh` checks it **without invoking pm2**. It never
starts, resurrects or repairs PM2.

| Check | Refuses when |
|-------|--------------|
| caller | not root, or the CLI's `PM2_HOME` (`$PM2_HOME` or `$HOME/.pm2`) ≠ the unit's `PM2_HOME` |
| unit | `pm2-root.service` not loaded / not `active`+`running` / no `MainPID` / not `User=root` |
| PID | `PM2_HOME/pm2.pid` missing, or ≠ `MainPID` |
| identity | that PID is dead, not uid 0, not titled `PM2 v…: God Daemon (PM2_HOME)`, or **not in the unit's cgroup** (e.g. in `user.slice/…/session-N.scope`) |
| sockets | `rpc.sock` / `pub.sock` missing, or not exactly one listener held by that daemon (`ss -xlp`) |
| second daemon | any other root `God Daemon` process exists |
| NARO ports | a listener on 4000 / 3000 / 3001 (read from `ecosystem.config.js`) is outside the daemon's process tree or cgroup: a foreign process or a duplicate listener |
| NARO processes | a `naro-*` process runs outside the unit's cgroup (unsupervised), or the daemon has more direct children per app than `instances` (1) |

These produce warnings only, and the deploy continues:
- **A legitimately stopped NARO app.** The daemon is healthy, nothing listens
  on its port, and no instance exists. PM2 will start it, and a rollback must
  still be able to run.
- **Other users' non-root PM2 daemons**, such as `kiuruwi`.

A stopped app (nothing on the port) is accepted. A port held by anything
other than the supervised daemon tree is refused.

Real-VPS baseline (validated read-only on 2026-11-09, guard PASSED with 1
warning for `kiuruwi`):

| Fact | Value |
|------|-------|
| daemon | PID = `pm2.pid` = `MainPID`, uid 0, PPid 1, cgroup `/system.slice/pm2-root.service`, title `PM2 v6.0.14: God Daemon (/root/.pm2)` |
| sockets | `/root/.pm2/rpc.sock`, `/root/.pm2/pub.sock`, one listener each, held by the daemon |
| ports | `:4000`, `:3000`, `:3001` are held by the daemon itself (cluster-mode primary) |
| NARO workers | `naro-api` (pm_id 1), `naro-storefront` (2), `naro-admin` (3): `cluster_mode`, 1 instance each, direct children of the daemon |

### Where the guard runs

1. In the CI deploy step, **before** its `git fetch`/`git reset`, using the
   guard already on the VPS.
2. At `deploy.sh` stage 0, before any git, dependency, database or build
   change.
3. After the builds, **before the swap**. A refusal here restores the
   pre-build copies and touches no process.
4. Inside `reload_pm2`, immediately before the first pm2 command, and again
   before **each** of the three pm2 commands (`pm2_guarded`). So a daemon
   that vanished after `reload naro-api` is not re-spawned by
   `restart naro-storefront,naro-admin`.
5. At the start of `rollback.sh`, before anything is swapped.

The `pm2 status` / `pm2 logs` failure diagnostics go through
`pm2_diagnostics`, which skips them unless the guard passes. The logs are the
three NARO apps' only (`pm2 logs '/^naro-(api|storefront|admin)$/'`): a bare
`pm2 logs` means `all`, and in root mode it would copy the other apps' log
lines into NARO's deploy output.

### NARO never restarts other apps

`deploy.sh` and `rollback.sh` run exactly three pm2 commands, all through
`pm2_guarded`:
- `pm2 reload ecosystem.config.js --only naro-api --update-env`
- `pm2 restart ecosystem.config.js --only naro-storefront,naro-admin --update-env`
- `pm2 save`

They never run `all`. The self-test fails the build on any pm2 command
outside `pm2_guarded`/`pm2_diagnostics`, any pm2 command naming `all`, and
any backtick or `$(` inside an unquoted heredoc. That last check exists
because the rollback help text once **executed** `pm2 restart all` that way.
It also fails on a pm2 subcommand other than reload / restart / save /
status / logs, on any `systemctl` use beyond the guard's read-only `show`, and
on any reference to sshd, `~/.ssh`, sudoers, PAM, ufw, passwords or account
commands in the deploy path. Section 6 of the self-test runs deploy, rollback
and automatic rollback in both modes with Jumuiya / Sportflow / logrotate /
kiuruwi decoys online, stopped, errored and restarting, and fails if any
neighbour PID changes. Neighbours and recovery access: [OS_USER.md](OS_USER.md).

In **root mode**, `pm2 save` writes the shared `/root/.pm2/dump.pm2`, so it
also records the other apps' current state (as their own deploys' `pm2 save`
does). In OS-user mode NARO never sends any command to the root daemon.

Also keep these off this box:
- `systemctl reload pm2-root.service`: its `ExecReload` is `pm2 reload all`.
- `systemctl restart pm2-root.service`: `pm2 kill` + `resurrect`, which
  restarts every app above.

Use them only as a coordinated recovery step.

### Recovering from a refused deployment

The guard printed `🛑 PM2 supervision check FAILED`, and the deploy exited
non-zero.

| Refused at | State left behind |
|------------|-------------------|
| CI step / stage 0 | Nothing changed (no git, deps, DB or builds). |
| Before the swap | Source is on the new commit, DB migrated (backward compatible), but every build is the pre-build copy and no process was touched. |
| `rollback.sh` start | Nothing changed. |

1. **Do not run pm2** from that shell.
2. Diagnose (read-only):
   ```
   systemctl status pm2-root.service --no-pager
   journalctl -u pm2-root.service -n 100 --no-pager
   ps -eo pid,ppid,user,lstart,cgroup:60,args | grep -E '[P]M2 v.*God Daemon'
   ss -ltnp | grep -E ':(4000|3000|3001)\s'
   ```
3. Recover through systemd. Other apps share this daemon, so coordinate
   with their owners first.
   - **Unit inactive and no root daemon in `ps`:**
     `systemctl start pm2-root.service`. Its `ExecStart` is `pm2 resurrect`
     from `/root/.pm2/dump.pm2`.
   - **A root daemon outside `system.slice/pm2-root.service`:** follow the
     2026-11-09 recovery procedure and move the apps back under the unit.
     Don't just kill it, because it may be serving the other apps.
   - **A foreign process on 4000/3000/3001:** identify it (`ss -ltnp`,
     `ps -o pid,user,lstart,args -p <pid>`) and stop it deliberately. It is
     not supervised and would make the PM2 restart fail with `EADDRINUSE`.
4. `cd /var/www/naro-fashion && bash scripts/ops/pm2-guard.sh` must PASS.
5. Re-run the deploy: re-run the CI job, or by hand
   `EXPECTED_SHA=$(git rev-parse origin/prod) bash deploy.sh`.

### `ROLLBACK INCOMPLETE` / `ROLLBACK NOT PERFORMED` (exit 3)

Exit code **3** means a rollback did not fully succeed, from either
`deploy.sh`'s automatic rollback or `rollback.sh`. It is never reported as
successful. The scripts print `❌ ROLLBACK INCOMPLETE — OPERATOR INTERVENTION
REQUIRED` with the reason. Possible reasons:

| Reason printed | State left behind |
|----------------|-------------------|
| PM2 reload refused or failed (supervision broke, a foreign listener appeared, or a `pm2` command failed) | Builds and git are back on the target. **No unguarded pm2 ran.** The processes were not (fully) reloaded. |
| Restored build is NOT healthy | Builds, git and processes are on the target, but health checks fail. |
| Source tree / dependencies not fully restored | `git reset`, `pnpm install`, `prisma generate` or the guard-tooling overlay failed. |
| Moving the previous builds back failed | Builds may be **mixed**. pm2 was not touched. |
| `ROLLBACK NOT PERFORMED` — previous builds missing | Nothing was swapped. The failed build is still in place. |

What is serving traffic is then **unverified**.

1. Do not re-run `deploy.sh` or `rollback.sh`. The `*-prev` builds were
   consumed.
2. `bash scripts/ops/pm2-guard.sh` must pass. If it doesn't, recover
   `pm2-root.service` as above first, and run no pm2 command until then.
3. Fix the stated problem, then reload exactly the NARO apps:
   ```
   cd /var/www/naro-fashion
   SHA=$(cat .deploy/current_sha)
   GIT_SHA=$SHA pm2 reload ecosystem.config.js --only naro-api --update-env
   GIT_SHA=$SHA pm2 restart ecosystem.config.js --only naro-storefront,naro-admin --update-env
   pm2 save
   ```
4. Verify:
   - `curl -s http://127.0.0.1:4000/api/v1/health` reports `commit` = `$SHA`;
   - the storefront answers with `-H 'Host: narofashion.co.tz'`;
   - the admin `/login` answers;
   - one `/_next/static` asset loads for each Next app.

### Running the guard by hand

It is read-only, and safe at any time:

```
ssh -o StrictHostKeyChecking=yes root@80.240.30.107 "cd /var/www/naro-fashion && bash scripts/ops/pm2-guard.sh"
```

Tests: `scripts/ops/tests/pm2-guard.test.sh` (CI `verify`). It covers:
- guard scenarios against a fake `/proc` and fake `systemctl`/`ss`;
- the real `deploy.sh`/`rollback.sh` flows in a throwaway repo (normal,
  failed build, auto rollback, manual rollback, daemon lost at each stage,
  stopped app, foreign port, rollback to a pre-guard commit, unhealthy
  rollback, missing previous build);
- the static invariants above.

Every pm2/pnpm/psql/sudo/curl it can reach is a decoy, and it aborts if one
isn't. The guard's test overrides only apply with `PM2_GUARD_TEST=1`, which
`deploy.sh`/`rollback.sh` unset.

## Automatic rollback

If anything fails after the swap (a reload error, or any health check not
green within 60 s), `deploy.sh`:

1. moves `.next-prev` back to `.next` for each app and `dist-prev` back to
   `dist`, keeping the bad builds as `.next-failed` / `dist-failed`;
2. runs `git reset --hard <previous_sha>`, then `pnpm install
   --frozen-lockfile` if the lockfile differs, then `prisma generate`, so the
   source matches the running build. If `<previous_sha>` **predates the PM2
   guard**, the deploy tooling is kept at the newer, guarded version (see
   "Application rollback keeps the guard");
3. reloads the API and hard-restarts the Next apps (`reload_pm2`) with the
   old `GIT_SHA`, **only** if the PM2 supervision guard passes;
4. re-runs the health checks;
5. prints the pre-deploy dump path and the `pg_restore` command.

| Exit | Meaning |
|------|---------|
| 1 | Deploy failed; rollback **COMPLETE and healthy** (`↩ Rollback COMPLETE and healthy`). CI goes red. |
| 3 | Rollback **incomplete or not performed**: operator intervention required (see above). |

The **database is not rolled back**. Migrations are forward-only and must be
backward compatible (expand/contract), so the previous build runs against
the migrated schema. Restore the dump only if it truly can't.

## Manual rollback

```
ssh root@80.240.30.107 "cd /var/www/naro-fashion && bash scripts/ops/rollback.sh --yes"
```

It runs the same steps as the automatic rollback, including the guard. Exit
codes:
- **0**: complete and healthy.
- **1**: refused; nothing changed (no previous build, or PM2 unsupervised).
- **3**: incomplete.

It is one-shot. It refuses when `.deploy/previous_sha`, or any of
`apps/storefront/.next-prev`, `apps/admin/.next-prev` or `apps/api/dist-prev`,
is missing. That happens after a rollback has already run, or when no deploy
has kept a previous build. So it can never mix builds from different
commits. After a rollback, **revert the bad commit on `prod`**: the next push
redeploys the tip of `prod`.

## Application rollback keeps the guard

Rolling back **application code** (automatically or with `rollback.sh`)
never removes the PM2 guard.

When the rollback target is a commit from before `scripts/ops/pm2-guard.sh`
existed, `restore_source_to` resets git to the target, then checks the deploy
tooling back out from the commit being left:
- `deploy.sh`
- `scripts/ops/deploy-lib.sh`
- `scripts/ops/rollback.sh`
- `scripts/ops/pm2-guard.sh`
- the self-test

The application code, `ecosystem.config.js` and the lockfile are the
target's. The tooling is the guarded version. `.deploy/tooling_from` records
where it came from, and `git status` shows those files as modified on
purpose. The next deploy's `git reset --hard origin/prod` clears it.

If no guarded tooling is available, the rollback is reported incomplete
(exit 3), not successful.

## Reverting the guard itself (emergency only)

Removing the guard is a **separate, deliberate change**, never a side effect
of a rollback. It removes these protections:

- the refusal to run pm2 when `pm2-root.service` is down, or its daemon is
  stray or unsupervised (any pm2 call could then start a new daemon in the
  deploy's SSH session);
- detection of a second root daemon, foreign listeners on 4000/3000/3001,
  orphan or duplicate NARO processes, and hijacked control sockets;
- the re-check before every pm2 command, and the exit-3 "incomplete" reporting;
- the CI pre-check before `git reset`;
- the self-test that forbids bare pm2 calls, `pm2 ... all`, and command
  substitution in unquoted heredocs. The last of these is the class of bug
  that made rollbacks run `pm2 restart all`.

Requirements:
1. **Written authorisation from the NARO owner** naming the reason (e.g. a
   guard false positive blocking an urgent fix).
2. Prefer the narrowest fix: correct the false positive in `pm2-guard.sh`
   (with a test) instead of removing it.
3. If it must go: create `git revert <guard commit(s)>`, with a commit
   message stating `GUARD REVERT - authorised by <name> <date>: <reason>`.
   Push it to `prod` (normal CI deploy).
4. If the guard on the VPS itself blocks that deploy (the CI pre-check uses
   the VPS copy), run on the VPS with authorisation:
   ```
   cd /var/www/naro-fashion && git fetch origin prod && git reset --hard origin/prod
   EXPECTED_SHA=$(git rev-parse HEAD) bash deploy.sh
   ```
   The reverted `deploy.sh` has no guard.
5. Reinstate the guard as soon as possible.

Repository code can't block a full revert (a revert also removes the CI
check), so this control is procedural.

## Installing a deploy-tooling-only change (no rebuild)

A change that touches **only** deploy tooling, CI and docs
(`deploy.sh`, `scripts/ops/**`, `.github/workflows/**`, `docs/**`,
`CLAUDE.md`) changes nothing the running apps read. It can be installed
without a rebuild or restart:

1. Push it to `prod` with an **empty** head commit whose message contains
   `[skip ci]`. GitHub then starts no workflow for that push (the skip applies
   to the commit that triggered the run, i.e. the head).
2. On the VPS, fast-forward the checkout without running `deploy.sh`:
   ```
   cd /var/www/naro-fashion
   bash scripts/ops/pm2-guard.sh
   git fetch origin prod
   git diff --name-only HEAD origin/prod      # must list only tooling/CI/docs paths
   git merge --ff-only origin/prod
   ```
   If the change keeps the application identical to the live build, also
   record it as live: `git rev-parse HEAD > .deploy/current_sha`. That way the
   next deploy's automatic rollback lands on this (guarded) commit.

Never use this for anything that touches `apps/**`, `packages/**`,
`ecosystem.config.js`, `pnpm-lock.yaml`, `package.json` or migrations. Those
need a full deploy (build + reload).

## State on the VPS (all gitignored)

| Path | Meaning |
|------|---------|
| `apps/<app>/.next` | served build |
| `apps/<app>/.next-prev.pending` | copy of the live build taken before an in-place build (restored on build failure, else promoted to `.next-prev`) |
| `apps/<app>/.next-prev` | previous build (rollback target) |
| `apps/<app>/.next-failed`, `apps/api/dist-failed` | build swapped out by a rollback |
| `apps/api/dist-prev`, `apps/api/dist-prev.pending` | previous API build / pre-build copy |
| `.deploy/tooling_from` | set after an application rollback to a pre-guard commit: the commit whose (guarded) deploy tooling was kept |
| `.deploy/current_sha`, `.deploy/previous_sha`, `.deploy/rolled_back_from` | deployed commits |

Disk cost: roughly 2× each `.next` (+ cache) — fine on the 64GB disk.
