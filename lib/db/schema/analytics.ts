import { pgTable, uuid, varchar, text, timestamp, date, uniqueIndex } from 'drizzle-orm/pg-core';
import { user } from './users';

/**
 * Which dashboard surface a user opened, at most one row per user per surface
 * per Bangkok calendar day.
 *
 * The unique index is the dedup guarantee: inserts use onConflictDoNothing, so
 * a user reopening /dashboard/today all afternoon still writes a single row.
 * That keeps the write volume bounded by (users x surfaces) per day rather than
 * by page views, and makes "unique users per surface" a plain COUNT.
 *
 * Deliberately stores no MBTI, birth data, or prose — MBTI is joined from
 * birth_profiles at report time so this table never duplicates personal data.
 */
export const surfaceViews = pgTable('surface_views', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => user.id).notNull(),
  surface: varchar('surface', { length: 32 }).notNull(), // TrackedSurface: 'today' | 'fortune'
  viewDate: date('view_date').notNull(), // Bangkok calendar date, YYYY-MM-DD
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userSurfaceDateIdx: uniqueIndex('surface_views_user_surface_date_idx').on(table.userId, table.surface, table.viewDate),
}));
