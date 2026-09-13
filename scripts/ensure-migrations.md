# Production migration runbook

The checked-in deployment currently does **not** run ordered migrations.
`Dockerfile:58-60` starts `drizzle-kit push` in the background and starts the API
immediately. Push reconciles schema shape; it does not run data movement in
custom SQL migrations.

## Before every production schema release

1. Compare `drizzle/meta/_journal.json` with
   `drizzle.__drizzle_migrations`. If the live tracker is incomplete while the
   tables already exist, stop: `db:migrate` would try to replay old schema
   creation. Run `bun scripts/check-migrations.js` for this comparison.
2. Test the pending migration against a disposable PostgreSQL database.
3. Run `bun run db:migrate` from this repository with the production
   `DATABASE_URL`.
4. Verify the new migration row and schema/data invariants.
5. Deploy the API only after migration success.

Useful read-only tracker query:

```sql
SELECT id, LEFT(hash, 12) AS hash_prefix, created_at
FROM drizzle.__drizzle_migrations
ORDER BY created_at;
```

Never truncate the production tracker or mark a migration applied without also
proving its SQL effects exist. Never rely on `db:push` for a data repair.

## Provider identity release

Migration `0013_provider_identity.sql` must precede the provider-aware backend.
It adds `providerEmail`, `authProvider`, and the previously untracked
`signupSource` column when needed; splits linked Google/X accounts by earliest
provider creation time; preserves the first provider's profile/readings; and
revokes affected sessions.

The migration aborts if the earliest Google and X timestamps tie. Resolve only
those users from known signup evidence, update the timestamps, and rerun. This
guard prevents assigning history to the wrong login provider.

Before production rollout, run `bun run test:migration:provider-identity` from
`horo-be`. Its PostgreSQL 16 fixtures verify both signup orders, history/session
ownership, unaffected single-provider accounts, and the tied-timestamp abort.
