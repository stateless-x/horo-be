import { pgTable, uuid, varchar, timestamp, integer, text, date, index } from 'drizzle-orm/pg-core';
import { birthProfiles } from './profiles';

export const dailyReadings = pgTable('daily_readings', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id').references(() => birthProfiles.id).notNull(),
  date: date('date').notNull(), // YYYY-MM-DD

  content: text('content').notNull(), // AI-generated reading
  luckyNumber: integer('lucky_number'),
  luckyColor: varchar('lucky_color', { length: 100 }),
  luckyDirection: varchar('lucky_direction', { length: 100 }),

  // Element energy for the day stored as JSON
  elementEnergy: varchar('element_energy', { length: 500 }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  profileDateIdx: index('daily_readings_profile_date_idx').on(table.profileId, table.date),
}));

export const chartNarratives = pgTable('chart_narratives', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id').references(() => birthProfiles.id).notNull().unique(),

  // Structured reading data as JSON (StructuredChartResponse)
  structuredReading: text('structured_reading').notNull(),
  updatedAt: timestamp('updated_at'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  profileIdx: index('chart_narratives_profile_idx').on(table.profileId),
}));

export const compatibility = pgTable('compatibility', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileAId: uuid('profile_a_id').references(() => birthProfiles.id).notNull(),
  profileBId: uuid('profile_b_id').references(() => birthProfiles.id).notNull(),

  score: integer('score').notNull(), // 0-100
  elementHarmony: integer('element_harmony'),
  branchHarmony: integer('branch_harmony'),

  analysis: text('analysis').notNull(), // AI-generated compatibility analysis
  strengths: varchar('strengths', { length: 2000 }), // JSON array
  challenges: varchar('challenges', { length: 2000 }), // JSON array

  shareToken: varchar('share_token', { length: 100 }).unique(), // For shareable links

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  profileAIdx: index('compatibility_profile_a_idx').on(table.profileAId),
  profileBIdx: index('compatibility_profile_b_idx').on(table.profileBId),
  shareTokenIdx: index('compatibility_share_token_idx').on(table.shareToken),
}));
