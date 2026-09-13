# Drizzle migrations

`lib/db/schema/*.ts` describes the current application schema. This directory
holds the ordered SQL history and `meta/_journal.json` used by
`drizzle-kit migrate`.

## Current history

- `0000`–`0005`: base product/Auth schema, indexes, onboarding flag, and Better
  Auth timestamps.
- `0006`–`0010`: narrative and display-name evolution.
- `0011`–`0012`: compatibility v2 and optional MBTI.
- `0013_provider_identity.sql`: provider-scoped Google/X identity plus the
  one-time split of previously linked provider accounts.

Migration 0013 is intentionally custom SQL because it moves existing account
ownership. The earliest provider account keeps the original user ID, profile,
and reading history. Later providers move to fresh users with blank onboarding.
Affected sessions are revoked. If Google and X share the earliest
`account.createdAt`, the migration aborts before changing ownership.

## Development workflow

```bash
# 1. Edit lib/db/schema/*.ts
bun run db:generate

# 2. Review the new SQL and test it against a disposable database
bun run db:migrate

# 3. Verify the application
bun test
bun run type-check
```

Commit the schema, SQL migration, snapshot, and journal together. Do not edit a
migration after it has been applied to a shared database; create the next
migration instead.

`bun run db:push` is useful for a disposable development database. It compares
the current schema directly and does not execute migration data-repair logic.

## Production rollout

The current Docker image runs `drizzle-kit push` in the background while the
server starts (`Dockerfile:58-60`). It neither copies nor executes this migration
directory, so it cannot perform migration 0013's account split.

Before deploying code that reads the new provider columns:

1. Run `bun run test:migration:provider-identity`; it verifies Google-first,
   X-first, unaffected single-provider, and tied-timestamp abort behavior on
   PostgreSQL 16. Docker must be available.
2. Confirm `drizzle.__drizzle_migrations` is synchronized with the checked-in
   journal. Do not run all historical migrations against an untracked live
   schema.
3. From this repository with the production `DATABASE_URL`, run
   `bun run db:migrate`.
4. Confirm migration 0013 completed, then deploy horo-be, horo-fe, and
   horo-admin in that order.

If migration 0013 reports tied earliest provider timestamps, resolve those
specific account timestamps from known signup evidence and rerun it. Do not
choose a provider arbitrarily.
