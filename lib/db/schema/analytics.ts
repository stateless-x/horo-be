import { pgTable, uuid, varchar, text, timestamp, date, uniqueIndex, index } from 'drizzle-orm/pg-core';
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
 *
 * SUPERSEDED for new data by product_events ('surface_viewed'). Kept as-is so
 * the historical rows stay queryable; nothing new writes here.
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

/**
 * Generic product events: what a user opened, one row per meaningful action.
 * Replaces surface_views as the write target — see TrackedEvent in
 * lib/shared/types/analytics.ts for the full vocabulary.
 *
 * Columns are deliberately generic rather than one table per event, so adding
 * an event is a vocabulary change instead of a migration:
 *   surface  — which page ('today' | 'fortune' | 'compatibility' | 'settings')
 *   category — fortune category key, for category_opened
 *   detail   — the leftover discriminator: tab name or relationshipType
 *
 * Dedup: the unique index covers (userId, event, dedupKey, viewDate) and
 * Postgres treats NULLs as DISTINCT. So a deduped event (dedupKey set, e.g.
 * 'today:love') collides on its second insert of the day and onConflictDoNothing
 * drops it, while a non-deduped event (dedupKey NULL, e.g. every compatibility
 * check) never collides and inserts freely. One index, both behaviours — the
 * nullability of dedupKey IS the per-event dedup switch.
 *
 * Stores no MBTI, birth data, names, or prose — MBTI is joined from
 * birth_profiles at report time.
 */
export const productEvents = pgTable('product_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => user.id).notNull(),
  event: varchar('event', { length: 64 }).notNull(), // TrackedEventName
  surface: varchar('surface', { length: 32 }), // TrackedEventSurface, null for compatibility_checked
  category: varchar('category', { length: 32 }), // FortuneCategoryKey, category_opened only
  detail: varchar('detail', { length: 64 }), // tab name or relationshipType
  viewDate: date('view_date').notNull(), // Bangkok calendar date, YYYY-MM-DD
  dedupKey: text('dedup_key'), // null = count every occurrence (see above)
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userEventDedupDateIdx: uniqueIndex('product_events_user_event_dedup_date_idx').on(
    table.userId,
    table.event,
    table.dedupKey,
    table.viewDate,
  ),
  // Reporting indexes: "how many of event X on day Y" and "which categories on
  // which surface" are the two shapes fetch-stats.ts groups by.
  eventDateIdx: index('product_events_event_date_idx').on(table.event, table.viewDate),
  surfaceCategoryIdx: index('product_events_surface_category_idx').on(table.surface, table.category),
}));
