/**
 * Programmatic Drizzle migration runner
 *
 * Uses drizzle-orm's migrate() to apply pending migrations from the drizzle/ folder.
 * Designed to run at deploy time (Railway startCommand) since drizzle-kit CLI
 * requires drizzle.config.ts which isn't available in the built output.
 *
 * Usage: bun src/migrate.ts
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('[MIGRATE] DATABASE_URL is not set');
  process.exit(1);
}

console.log('[MIGRATE] Running pending migrations...');

const sql = postgres(DATABASE_URL, { max: 1 });
const db = drizzle(sql);

try {
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('[MIGRATE] ✓ Migrations applied successfully');
} catch (error) {
  console.error('[MIGRATE] ✗ Migration failed:', error);
  process.exit(1);
} finally {
  await sql.end();
}
