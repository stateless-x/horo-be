import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL);

const migrations = await sql`
  SELECT id, LEFT(hash, 12) as hash_short
  FROM drizzle.__drizzle_migrations
  ORDER BY id
`;

console.log('=== Migration Status ===\n');
console.log('Applied migrations:');
migrations.forEach(m => console.log(`  ${m.id}. ${m.hash_short}...`));
console.log(`\nTotal: ${migrations.length}/8 migrations`);

if (migrations.length === 8) {
  console.log('\n✅ All migrations tracked correctly');
} else {
  console.log(`\n⚠️  Missing ${8 - migrations.length} migrations`);
}

await sql.end();
