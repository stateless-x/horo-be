import postgres from 'postgres';
import { readFileSync } from 'node:fs';

const sql = postgres(process.env.DATABASE_URL);
const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
const expected = journal.entries.map((entry) => ({
  index: entry.idx,
  tag: entry.tag,
  createdAt: entry.when,
}));

const migrations = await sql`
  SELECT id, LEFT(hash, 12) as hash_short, created_at
  FROM drizzle.__drizzle_migrations
  ORDER BY created_at
`;

const appliedTimes = new Set(migrations.map((migration) => Number(migration.created_at)));
const missing = expected.filter((migration) => !appliedTimes.has(migration.createdAt));

console.log('=== Migration Status ===\n');
console.log('Applied migrations:');
migrations.forEach(m => console.log(`  ${m.id}. ${m.hash_short}...`));
console.log(`\nTotal: ${migrations.length}/${expected.length} migrations`);

if (missing.length === 0 && migrations.length === expected.length) {
  console.log('\n✅ All migrations tracked correctly');
} else {
  console.log('\n⚠️  Migration tracker differs from the checked-in journal');
  missing.forEach((migration) => console.log(`  missing ${migration.index}: ${migration.tag}`));
  process.exitCode = 1;
}

await sql.end();
