import { sql } from 'drizzle-orm';
import { pgTable, uuid, varchar, text, timestamp, integer, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { user } from './users';

/**
 * มู wallet (1 มู = ฿1). Design and invariants: docs/wallet.md.
 * Additive only, so `drizzle-kit push` applies it at deploy (.claude/CLAUDE.md).
 *
 * Status, provider and kind are varchar with the allowed values in
 * lib/shared/types/wallet.ts, matching the rest of the schema.
 */

/** One attempt to buy a pack for baht. Only the payment provider's webhook marks it paid (monetization T5). */
export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => user.id).notNull(),
  packId: varchar('pack_id', { length: 16 }).notNull(), // PackId
  amountSatang: integer('amount_satang').notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('THB'),
  unitsBase: integer('units_base').notNull(),
  unitsBonus: integer('units_bonus').notNull(),
  status: varchar('status', { length: 16 }).notNull().default('pending'), // OrderStatus
  provider: varchar('provider', { length: 16 }).notNull(), // 'stripe' | 'manual'
  providerRef: text('provider_ref').unique(), // the provider's payment id; null until a charge exists
  // One-flow purchase: the compatibility row to unlock once this order is paid and credited. Null for a plain top-up.
  unlockRef: text('unlock_ref'),
  paidAt: timestamp('paid_at'),
  refundedAt: timestamp('refunded_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdx: index('orders_user_idx').on(table.userId, table.createdAt),
}));

/**
 * Append-only: a row is never updated or deleted. Balance = SUM(delta).
 *
 * The partial unique indexes are the guarantees, not code:
 * - order credit: a replayed webhook can't credit an order twice;
 * - welcome: one welcome gift per account, ever;
 * - spend: one charge per (user, product, thing), e.g. per compatibility row;
 * - refund of a spend: at most one per spend.
 */
export const walletLedger = pgTable('wallet_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => user.id).notNull(),
  delta: integer('delta').notNull(),
  kind: varchar('kind', { length: 16 }).notNull(), // LedgerKind
  orderId: uuid('order_id').references(() => orders.id),
  productId: varchar('product_id', { length: 32 }), // ProductId, on spend and its refund
  refId: text('ref_id'), // what was bought, e.g. the compatibility row id
  note: text('note'),
  expiresAt: timestamp('expires_at'), // bonus rows only
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdx: index('wallet_ledger_user_idx').on(table.userId, table.createdAt),
  orderCreditIdx: uniqueIndex('wallet_ledger_order_credit_idx')
    .on(table.orderId, table.kind)
    .where(sql`kind in ('purchase', 'bonus')`),
  welcomeIdx: uniqueIndex('wallet_ledger_welcome_idx').on(table.userId).where(sql`kind = 'welcome'`),
  spendIdx: uniqueIndex('wallet_ledger_spend_idx')
    .on(table.userId, table.productId, table.refId)
    .where(sql`kind = 'spend'`),
  spendRefundIdx: uniqueIndex('wallet_ledger_spend_refund_idx')
    .on(table.userId, table.productId, table.refId)
    .where(sql`kind = 'refund' and ref_id is not null`),
}));
