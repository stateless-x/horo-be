import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to prepare daily reading uniqueness');
}

const sql = postgres(databaseUrl, { max: 1 });

try {
  const [table] = await sql<{ tableName: string | null }[]>`
    SELECT to_regclass('public.daily_readings')::text AS "tableName"
  `;

  // A brand-new database is created by the normal schema push that follows.
  if (!table?.tableName) {
    console.log('[DB Prepare] daily_readings does not exist yet; schema push will create it');
  } else {
    const [index] = await sql<{ indexDefinition: string }[]>`
      SELECT indexdef AS "indexDefinition"
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'daily_readings_profile_date_idx'
    `;

    if (index?.indexDefinition.includes('CREATE UNIQUE INDEX')) {
      console.log('[DB Prepare] Daily reading uniqueness already enforced');
    } else {
      await sql.begin(async (transaction) => {
        await transaction.unsafe('LOCK TABLE "daily_readings" IN SHARE ROW EXCLUSIVE MODE');
        await transaction.unsafe(`
          WITH ranked_daily_readings AS (
            SELECT
              "id",
              ROW_NUMBER() OVER (
                PARTITION BY "profile_id", "date"
                ORDER BY "created_at" ASC, "id" ASC
              ) AS duplicate_number
            FROM "daily_readings"
          )
          DELETE FROM "daily_readings"
          WHERE "id" IN (
            SELECT "id"
            FROM ranked_daily_readings
            WHERE duplicate_number > 1
          )
        `);
        await transaction.unsafe('DROP INDEX IF EXISTS "daily_readings_profile_date_idx"');
        await transaction.unsafe(
          'CREATE UNIQUE INDEX "daily_readings_profile_date_idx" ON "daily_readings" ("profile_id", "date")',
        );
      });
      console.log('[DB Prepare] Daily reading duplicates removed and uniqueness enforced');
    }
  }
} finally {
  await sql.end();
}
