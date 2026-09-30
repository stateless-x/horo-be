import { boolean, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * Product switches, set from horo-admin (horo-be src/lib/feature-flags.ts owns
 * the keys and their meaning). A missing row is off. No env var sets these.
 */
export const featureFlags = pgTable('feature_flags', {
  key: varchar('key', { length: 64 }).primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  /** The admin who last changed it (their email), for the audit trail. */
  updatedBy: varchar('updated_by', { length: 255 }),
});
