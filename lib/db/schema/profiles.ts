import { pgTable, uuid, varchar, text, timestamp, integer, boolean, index } from 'drizzle-orm/pg-core';
import { user } from './users';

export const birthProfiles = pgTable('birth_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => user.id).notNull(),
  birthDate: timestamp('birth_date').notNull(),
  birthHour: integer('birth_hour'), // 0-23, null if unknown
  birthTimePeriod: varchar('birth_time_period', { length: 50 }), // Thai time period name
  gender: varchar('gender', { length: 10 }).notNull(), // 'male' | 'female'
  isTimeUnknown: boolean('is_time_unknown').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('birth_profiles_user_id_idx').on(table.userId),
}));

export const baziCharts = pgTable('bazi_charts', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id').references(() => birthProfiles.id).notNull().unique(),

  // Pillars stored as JSON strings of {stem, branch}
  yearPillar: varchar('year_pillar', { length: 100 }).notNull(),
  monthPillar: varchar('month_pillar', { length: 100 }).notNull(),
  dayPillar: varchar('day_pillar', { length: 100 }).notNull(),
  hourPillar: varchar('hour_pillar', { length: 100 }), // null if birth time unknown

  dayMaster: varchar('day_master', { length: 50 }).notNull(), // Day stem
  primaryElement: varchar('primary_element', { length: 50 }).notNull(),

  // Element strength percentages stored as JSON
  elementStrength: varchar('element_strength', { length: 500 }).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  profileIdIdx: index('bazi_charts_profile_id_idx').on(table.profileId),
}));

export const thaiAstrologyData = pgTable('thai_astrology_data', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id').references(() => birthProfiles.id).notNull().unique(),

  day: varchar('day', { length: 50 }).notNull(), // ThaiDay enum
  color: varchar('color', { length: 100 }).notNull(),
  planet: varchar('planet', { length: 100 }).notNull(),
  buddhaPosition: varchar('buddha_position', { length: 200 }).notNull(),
  personality: varchar('personality', { length: 500 }).notNull(),
  luckyNumber: integer('lucky_number').notNull(),
  luckyDirection: varchar('lucky_direction', { length: 100 }).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  profileIdIdx: index('thai_astrology_profile_id_idx').on(table.profileId),
}));
