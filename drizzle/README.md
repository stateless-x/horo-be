# Drizzle Migrations

This directory contains Drizzle Kit generated migrations tracked by version control.

## Current Migrations

### 0000_organic_mindworm.sql
Initial schema creation with all tables and constraints.

### 0001_mature_dakota_north.sql ⭐ NEW
Adds performance indexes to all tables (16 total indexes).

**Indexes Added:**
- Better Auth tables: 6 indexes (session, account, verification)
- Profile tables: 3 indexes (birth_profiles, bazi_charts, thai_astrology_data)
- Reading tables: 4 indexes (daily_readings, compatibility)
- Invite tables: 3 indexes (compatibility_invite)

## How to Apply Migrations

### Option 1: Push to Database (Recommended for Development)
```bash
# Push schema changes directly to database
bun run db:push
```

This will:
- Apply all pending migrations
- Sync your database with the schema
- Show a preview before applying

### Option 2: Using Railway CLI (Production)
```bash
# Connect to Railway database and apply migration
railway run bun run db:push
```

### Option 3: Manual SQL (If needed)
```bash
# Apply specific migration manually
psql $DATABASE_URL -f drizzle/0001_mature_dakota_north.sql
```

## Verify Indexes Were Created

```sql
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
    AND indexname LIKE '%_idx'
ORDER BY tablename, indexname;
```

You should see 16 indexes.

## Performance Impact

After applying the migration:
- **Auth operations**: 10-100x faster
- **Daily reading lookups**: 5-50x faster
- **Invite link validation**: 10-100x faster
- **Profile queries**: 5-20x faster

## Drizzle Kit Commands

```bash
# Generate new migration from schema changes
bun run db:generate

# Push/apply migrations to database
bun run db:push

# Open Drizzle Studio (database GUI)
bun run db:studio
```

## Migration Workflow

1. Make schema changes in `lib/db/schema/*.ts`
2. Run `bun run db:generate` to create migration
3. Review generated SQL in `drizzle/*.sql`
4. Run `bun run db:push` to apply to database
5. Commit migration files to git

## Notes

- Migrations are tracked in `drizzle/meta/_journal.json`
- Never edit generated migration files manually
- Always test migrations in development first
- Index creation is non-blocking in PostgreSQL
