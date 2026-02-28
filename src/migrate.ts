import postgres from 'postgres';
import { readFileSync } from 'fs';
import { join } from 'path';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

const sql = postgres(DATABASE_URL);

async function runMigration() {
  try {
    console.log('[Migration] Connecting to database...');

    // Read the migration file
    const migrationSQL = readFileSync(
      join(process.cwd(), 'drizzle', '0005_abnormal_thunderbolt_ross.sql'),
      'utf-8'
    );

    console.log('[Migration] Running migration...');

    // Split by statement-breakpoint and execute each statement
    const statements = migrationSQL
      .split('--> statement-breakpoint')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const statement of statements) {
      console.log('[Migration] Executing:', statement.substring(0, 80) + '...');
      await sql.unsafe(statement);
    }

    console.log('[Migration] ✓ Migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('[Migration] Error:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

runMigration();
