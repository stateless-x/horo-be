# Migration Automation Guide

## How Railway Auto-Migrations Work

Railway runs migrations automatically via `railway.toml`:
```toml
[build]
buildCommand = "bun run db:migrate && bun run build"
```

This executes `drizzle-kit migrate` which:
1. Reads migration files from `drizzle/` directory
2. Checks `drizzle.__drizzle_migrations` table for applied migrations
3. Applies only NEW migrations (idempotent)

## Current Status

✅ **Migration tracker is in sync!**
- All 8 migrations (0000-0007) are tracked
- Future migrations will work automatically

## Why It Failed Previously

The migration failed because:
1. Migration tracker was out of sync with actual database state
2. `drizzle-kit migrate` tried to replay ALL migrations from scratch
3. Old migrations (0000-0005) tried to create existing tables → error
4. New migrations (0006-0007) never ran → missing columns

## How to Ensure Future Migrations Work

### 1. Always Follow the Workflow

```bash
# LOCAL DEVELOPMENT
cd horo-be

# Step 1: Modify schema
vim lib/db/schema/readings.ts

# Step 2: Generate migration
bun run db:generate
# This creates: drizzle/0008_new_migration.sql

# Step 3: Review the SQL
cat drizzle/0008_new_migration.sql
# ⚠️ Check for destructive operations (DROP COLUMN, DROP TABLE)

# Step 4: Test locally
bun run db:migrate

# Step 5: Commit BOTH schema AND migration
git add lib/db/schema/*.ts drizzle/*
git commit -m "feat: add new feature with migration"

# Step 6: Push to deploy
git push origin master
```

### 2. Railway Deployment Flow

```
Push to GitHub
    ↓
Railway detects changes
    ↓
Runs: bun run db:migrate
    ↓
Drizzle checks tracker table
    ↓
Applies ONLY new migrations (idempotent)
    ↓
Runs: bun run build
    ↓
Deploys
```

### 3. Verification After Deploy

Check Railway logs for:
```
✓ Migrations applied successfully
✓ No migration errors
```

Or run this script:
```bash
bun scripts/check-migration-status.js
```

## Best Practices

### ✅ DO

1. **Always generate migrations**: `bun run db:generate`
2. **Review SQL before committing**: Check for data loss
3. **Test migrations locally first**: `bun run db:migrate`
4. **Commit migration files**: They're the source of truth
5. **Keep migrations small**: One feature = one migration
6. **Never edit applied migrations**: Create new ones instead

### ❌ DON'T

1. **Don't use `db:push` in production**: It bypasses migration tracking
2. **Don't manually edit database**: Always use migrations
3. **Don't delete old migrations**: Breaks history
4. **Don't edit migration SQL after committing**: Hash changes
5. **Don't skip `db:generate`**: Direct schema edits won't deploy

## Troubleshooting

### If Migration Fails on Railway

1. **Check Railway logs**:
   ```
   Railway Dashboard → horo-be → Deployments → Latest → Logs
   ```

2. **Identify the error**:
   - "relation already exists" → Migration already applied manually
   - "column does not exist" → Migration not applied
   - "hash mismatch" → Migration file was edited

3. **Fix options**:

   **Option A: Manual sync (like we just did)**
   ```bash
   # Run SQL directly on Railway database
   # Update both schema AND tracker
   ```

   **Option B: Reset migrations (destructive)**
   ```sql
   TRUNCATE drizzle.__drizzle_migrations CASCADE;
   -- Then: bun run db:migrate (applies all)
   ```

   **Option C: Mark as applied**
   ```sql
   INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at)
   VALUES (8, 'hash-from-journal', NOW());
   ```

## Migration Tracker Table

```sql
-- Structure
CREATE TABLE drizzle.__drizzle_migrations (
  id integer PRIMARY KEY,      -- Migration index (0, 1, 2, ...)
  hash varchar(64),            -- SHA-256 of migration file
  created_at bigint            -- Unix timestamp (ms)
);

-- Check status
SELECT id, LEFT(hash, 12), created_at
FROM drizzle.__drizzle_migrations
ORDER BY id;
```

## Emergency Commands

```bash
# Check what migrations are pending
cd horo-be
bun run db:generate --custom  # See what would be generated

# Force re-sync (DANGEROUS - only for dev)
# 1. Drop tracker table
# 2. Re-run all migrations

# Safe re-sync (RECOMMENDED)
# 1. Manually apply pending schema changes
# 2. Update tracker to mark as applied
```

## Future-Proofing

### Railway will automatically migrate IF:

1. ✅ Migration files exist in `drizzle/` directory
2. ✅ Migration tracker table exists and is synced
3. ✅ `db:migrate` is in `railway.toml` buildCommand
4. ✅ DATABASE_URL environment variable is set
5. ✅ Migration SQL is valid and idempotent

### Current Setup: ALL ✅

- Migration tracker: **8/8 migrations synced**
- railway.toml: **Configured correctly**
- Migration files: **All present (0000-0007)**
- Database: **Schema matches migrations**

**You're all set! Future migrations will work automatically.**
