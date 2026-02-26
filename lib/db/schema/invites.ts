import { pgTable, text, uuid, timestamp, boolean, index } from 'drizzle-orm/pg-core';
import { user } from './users';
import { birthProfiles } from './profiles';

/**
 * Compatibility Invites
 *
 * When a user wants to share their fortune with someone for compatibility checking,
 * they generate an invite link with a unique token. The recipient can click the link,
 * complete onboarding, and see their compatibility results.
 */
export const compatibilityInvites = pgTable('compatibility_invite', {
  id: uuid('id').primaryKey().defaultRandom(),
  token: text('token').notNull().unique(), // Short unique token for URL

  // Inviter info
  inviterId: text('inviter_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  inviterName: text('inviter_name').notNull(), // Cached for display
  inviterProfileId: uuid('inviter_profile_id')
    .notNull()
    .references(() => birthProfiles.id, { onDelete: 'cascade' }),

  // Invite status
  isUsed: boolean('is_used').notNull().default(false),
  usedBy: text('used_by').references(() => user.id, { onDelete: 'set null' }),
  usedAt: timestamp('used_at'),

  // Metadata
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(), // 7 days from creation
}, (table) => ({
  tokenIdx: index('compatibility_invite_token_idx').on(table.token),
  inviterIdIdx: index('compatibility_invite_inviter_idx').on(table.inviterId),
  expiresAtIdx: index('compatibility_invite_expires_at_idx').on(table.expiresAt),
}));
