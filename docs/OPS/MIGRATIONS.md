# Database Migrations

Since October 2026 the schema changes **only** through committed Prisma
migrations in `packages/database/prisma/migrations/`. Production runs
`prisma migrate deploy`; `prisma db push --accept-data-loss` is gone from
`deploy.sh`.

Always use the **local** Prisma CLI (v6.19.2) from `packages/database/`:
`pnpm prisma ...`. Never the global v7 CLI.

## Layout

```
packages/database/prisma/migrations/
  migration_lock.toml          provider = "postgresql" (do not edit)
  0_init/migration.sql         baseline: the whole schema as of Oct 2026
  <timestamp>_<name>/migration.sql   every change after that
```

`0_init` was generated with
`pnpm prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`
and verified to produce no diff against a DB in sync with `schema.prisma`.

## Day-to-day workflow

1. Edit `packages/database/prisma/schema.prisma`.
2. From `packages/database/`:
   ```
   pnpm prisma migrate dev --name add_order_gift_note     # or: pnpm db:migrate:dev --name ...
   ```
   This writes `prisma/migrations/<timestamp>_add_order_gift_note/migration.sql`,
   applies it to your local DB and regenerates the client.
3. **Read the generated SQL.** Fix it by hand if needed (e.g. add a backfill
   `UPDATE` before a `SET NOT NULL`).
4. Commit `schema.prisma` **and** the migration folder in the same commit.
5. Push to `prod` → `deploy.sh` takes a pre-deploy dump, runs
   `prisma migrate deploy`, then checks the DB matches `schema.prisma`.

Useful scripts (`packages/database/package.json`):
`db:migrate:dev`, `db:migrate:deploy`, `db:migrate:status`. `db:push` still
exists for throwaway local experiments only — never for a change you intend
to ship (it leaves no migration, and the deploy drift guard will fail).

### The deploy drift guard

After `migrate deploy`, `deploy.sh` runs `migrate diff` from the live DB to
`schema.prisma`. A non-empty diff means `schema.prisma` was changed without a
migration; the deploy **aborts before building** (the old build stays live).
Fix: run `migrate dev` locally, commit the migration, push again.

## One-time: baseline your local dev DB

Local DBs were created with `db push`, so they have no `_prisma_migrations`
table and `migrate dev` would want to reset them. Baseline once (no SQL runs,
it only records 0_init as applied):

```
cd packages/database
pnpm prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code   # must print "No difference detected." (exit 0)
pnpm prisma migrate resolve --applied 0_init
pnpm prisma migrate status    # "Database schema is up to date!"
```

If the first command shows a difference, your local DB is behind/ahead of
`schema.prisma` — bring it in line first (for a disposable dev DB,
`pnpm prisma db push` then re-check), and only then resolve.

## First deploy / drift (production, automatic)

The first deploy that contains `0_init` finds no `_prisma_migrations` table
on prod. `deploy.sh` then:

1. takes the pre-deploy `pg_dump` (as always);
2. diffs the live DB against `schema.prisma` **as of the commit that added
   0_init** (so a release that also carries newer migrations still works);
3. **no difference** → `prisma migrate resolve --applied 0_init` (records it,
   runs no SQL), then `migrate deploy` applies anything newer;
4. **any difference** → the deploy **aborts** with the SQL printed. Nothing is
   pushed automatically. Reconcile by hand:
   - read the printed SQL (it is what would make prod match 0_init);
   - if prod is simply behind (e.g. an earlier `db push` never ran), apply
     that SQL deliberately after reviewing it — or restore from a known dump;
   - if prod has extra objects created by hand, decide whether they belong
     in `schema.prisma` (then regenerate 0_init) or should be dropped;
   - re-run `bash deploy.sh` once `migrate diff` reports no difference.

## A migration failed in production

`migrate deploy` runs each migration in a transaction where Postgres allows
it; on failure the deploy aborts before building (old build stays live) and
the migration is recorded as **failed**, which blocks every later deploy.

1. Look at the error in the deploy log and `pnpm prisma migrate status`.
2. If the migration left nothing behind (rolled back by the transaction):
   ```
   cd /var/www/naro-fashion/packages/database
   pnpm exec prisma migrate resolve --rolled-back <migration_folder_name>
   ```
   then fix the migration in git (or add a corrective one) and redeploy.
3. If it partly applied (e.g. `CREATE INDEX CONCURRENTLY`, non-transactional
   statements), finish or undo the remaining statements by hand, then either
   `migrate resolve --applied <name>` (finished) or `--rolled-back <name>`
   (undone).
4. Last resort: restore the pre-deploy dump printed in the deploy log
   (`docs/OPS/BACKUPS.md` "Restoring").

Never edit a migration that has already been applied in production — add a
new one.

## Rule: destructive changes need expand / contract

Migrations are forward-only and the app rollback (`scripts/ops/rollback.sh`
or the automatic one in `deploy.sh`) does **not** roll the DB back. The
previous release must keep working against the new schema. So:

- **Additive changes ship in one step**: new table, new nullable column, new
  column with a default, new index.
- **Destructive or narrowing changes take two releases**:
  1. *Expand* — add the new column/table, write to both, backfill; the code
     stops reading the old column. Deploy, let it settle.
  2. *Contract* — a later release drops/renames the old column, adds
     `NOT NULL`, tightens a unique constraint, etc.
- Renames are add-new + copy + drop-old across two releases, never `RENAME`
  in one.
- New `@@unique` constraints: first a migration/script that removes
  duplicates, then the constraint.
- Anything Prisma flags as data loss in `migrate dev` must be reviewed and
  split before it is committed.
