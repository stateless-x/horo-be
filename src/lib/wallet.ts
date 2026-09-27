import { and, desc, eq, sql } from 'drizzle-orm';
import { db as appDb } from './db';
import { orders, walletLedger, type DbClient } from '../../lib/db';
import type { LedgerEntry, LedgerKind, PackId, ProductId } from '../../lib/shared/types/wallet';
import {
  BALANCE_CAP,
  BONUS_TTL_DAYS,
  CURRENCY,
  PACKS,
  PRODUCT_PRICES,
  WELCOME_GIFT,
  packAmountSatang,
  type SpendableProductId,
} from './pricing';

/**
 * The มู ledger (docs/wallet.md). Balance = SUM(delta) over an
 * append-only table. Every write that depends on the balance runs in one
 * transaction holding a per-user advisory lock, so two taps at once are
 * serialized and the balance never goes negative or over the cap. The partial
 * unique indexes in lib/db/schema/wallet.ts make every credit and spend
 * idempotent even without the lock.
 */

/** A spend needs more than the balance holds. The unlock route answers 402. */
export class InsufficientBalance extends Error {
  constructor(
    readonly balance: number,
    readonly price: number,
  ) {
    super(`Insufficient balance: balance ${balance}, price ${price}`);
  }
}

/** A credit would take the balance above BALANCE_CAP. */
export class BalanceCapExceeded extends Error {
  constructor(
    readonly balance: number,
    readonly credit: number,
    readonly cap: number = BALANCE_CAP,
  ) {
    super(`Balance cap: balance ${balance} + ${credit} > ${cap}`);
  }
}

/**
 * This thing was bought and the spend refunded. The spend index allows one
 * spend per thing, so it can't be charged again; what to offer is T13's call.
 */
export class SpendRefunded extends Error {
  constructor(
    readonly productId: ProductId,
    readonly refId: string,
  ) {
    super(`Spend on ${productId}/${refId} was refunded`);
  }
}

/** creditOrder on an order the provider has not marked paid. */
export class OrderNotPaid extends Error {
  constructor(
    readonly orderId: string,
    readonly status: string,
  ) {
    super(`Order ${orderId} is ${status}, not paid`);
  }
}

type Tx = Parameters<Parameters<DbClient['transaction']>[0]>[0];
type Reader = DbClient | Tx;

async function sumBalance(reader: Reader, userId: string): Promise<number> {
  const [row] = await reader
    .select({ balance: sql<number>`coalesce(sum(${walletLedger.delta}), 0)::int` })
    .from(walletLedger)
    .where(eq(walletLedger.userId, userId));
  return row.balance;
}

/** Serializes every balance-dependent write for one user until the transaction ends. */
async function lockUser(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
}

function toEntry(row: typeof walletLedger.$inferSelect): LedgerEntry {
  return {
    id: row.id,
    delta: row.delta,
    kind: row.kind as LedgerKind,
    productId: row.productId as ProductId | null,
    refId: row.refId,
    note: row.note,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createWallet(db: DbClient) {
  const balance = (userId: string) => sumBalance(db, userId);

  /** Grants WELCOME_GIFT once per account; later calls and concurrent first touches insert nothing. */
  async function ensureWelcome(userId: string): Promise<void> {
    await db
      .insert(walletLedger)
      .values({ userId, delta: WELCOME_GIFT, kind: 'welcome', note: 'ของขวัญต้อนรับ' })
      .onConflictDoNothing();
  }

  /**
   * Charges the product's price once per (user, product, refId). A repeat call
   * for something already paid returns charged: false and costs nothing, so a
   * retry after a failed generation is free.
   */
  async function spend(userId: string, productId: SpendableProductId, refId: string) {
    const price = PRODUCT_PRICES[productId];
    return db.transaction(async (tx) => {
      await lockUser(tx, userId);
      const sameThing = and(
        eq(walletLedger.userId, userId),
        eq(walletLedger.productId, productId),
        eq(walletLedger.refId, refId),
      );
      const prior = await tx
        .select({ kind: walletLedger.kind })
        .from(walletLedger)
        .where(and(sameThing, sql`${walletLedger.kind} in ('spend', 'refund')`));
      if (prior.some((row) => row.kind === 'refund')) throw new SpendRefunded(productId, refId);

      const current = await sumBalance(tx, userId);
      if (prior.length > 0) return { charged: false as const, balance: current };
      if (current < price) throw new InsufficientBalance(current, price);

      await tx.insert(walletLedger).values({ userId, delta: -price, kind: 'spend', productId, refId });
      return { charged: true as const, balance: current - price };
    });
  }

  /**
   * Gives a spend's price back. At most once per spend; the thing can't be
   * charged again afterwards (see SpendRefunded).
   */
  async function refundSpend(userId: string, productId: SpendableProductId, refId: string, note: string) {
    return db.transaction(async (tx) => {
      await lockUser(tx, userId);
      const [spent] = await tx
        .select({ delta: walletLedger.delta })
        .from(walletLedger)
        .where(
          and(
            eq(walletLedger.userId, userId),
            eq(walletLedger.productId, productId),
            eq(walletLedger.refId, refId),
            eq(walletLedger.kind, 'spend'),
          ),
        );
      if (!spent) throw new Error(`No spend to refund for ${productId}/${refId}`);
      const inserted = await tx
        .insert(walletLedger)
        .values({ userId, delta: -spent.delta, kind: 'refund', productId, refId, note })
        .onConflictDoNothing()
        .returning({ id: walletLedger.id });
      return { refunded: inserted.length > 0, balance: await sumBalance(tx, userId) };
    });
  }

  /** Creates a pending order for a pack, refused if paying it would pass the cap. */
  async function createOrder(userId: string, packId: PackId) {
    const pack = PACKS[packId];
    const current = await balance(userId);
    if (current + pack.base + pack.bonus > BALANCE_CAP) throw new BalanceCapExceeded(current, pack.base + pack.bonus);
    const [order] = await db
      .insert(orders)
      .values({
        userId,
        packId,
        amountSatang: packAmountSatang(pack),
        currency: CURRENCY,
        unitsBase: pack.base,
        unitsBonus: pack.bonus,
        provider: 'stripe',
      })
      .returning();
    return order;
  }

  /** The order if it belongs to this user. */
  async function getOrder(userId: string, orderId: string) {
    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, userId)))
      .limit(1);
    return order ?? null;
  }

  /**
   * Credits a paid order's base and bonus. Idempotent: a replayed webhook
   * credits nothing the second time. A credit past the cap is refused, and the
   * paid order then needs a manual refund (T13).
   */
  async function creditOrder(orderId: string) {
    return db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (!order) throw new Error(`Order ${orderId} not found`);
      if (order.status !== 'paid') throw new OrderNotPaid(orderId, order.status);
      await lockUser(tx, order.userId);

      const [already] = await tx
        .select({ id: walletLedger.id })
        .from(walletLedger)
        .where(and(eq(walletLedger.orderId, orderId), eq(walletLedger.kind, 'purchase')))
        .limit(1);
      const current = await sumBalance(tx, order.userId);
      if (already) return { credited: false as const, balance: current };

      const credit = order.unitsBase + order.unitsBonus;
      if (current + credit > BALANCE_CAP) throw new BalanceCapExceeded(current, credit);

      const rows: (typeof walletLedger.$inferInsert)[] = [
        { userId: order.userId, delta: order.unitsBase, kind: 'purchase', orderId },
      ];
      if (order.unitsBonus > 0) {
        const expiresAt = new Date(Date.now() + BONUS_TTL_DAYS * 24 * 60 * 60 * 1000);
        rows.push({ userId: order.userId, delta: order.unitsBonus, kind: 'bonus', orderId, expiresAt });
      }
      await tx.insert(walletLedger).values(rows);
      return { credited: true as const, balance: current + credit };
    });
  }

  /** Admin or dev correction. Never takes the balance below 0 or above the cap. */
  async function adjust(userId: string, delta: number, note: string) {
    if (!Number.isInteger(delta) || delta === 0) throw new Error(`adjust needs a non-zero integer, got ${delta}`);
    return db.transaction(async (tx) => {
      await lockUser(tx, userId);
      const current = await sumBalance(tx, userId);
      if (current + delta > BALANCE_CAP) throw new BalanceCapExceeded(current, delta);
      if (current + delta < 0) throw new InsufficientBalance(current, -delta);
      await tx.insert(walletLedger).values({ userId, delta, kind: 'admin_adjust', note });
      return { balance: current + delta };
    });
  }

  /** The newest rows first. */
  async function ledger(userId: string, limit: number): Promise<LedgerEntry[]> {
    const rows = await db
      .select()
      .from(walletLedger)
      .where(eq(walletLedger.userId, userId))
      .orderBy(desc(walletLedger.createdAt), desc(walletLedger.id))
      .limit(limit);
    return rows.map(toEntry);
  }

  return { balance, ensureWelcome, spend, refundSpend, createOrder, getOrder, creditOrder, adjust, ledger };
}

export type Wallet = ReturnType<typeof createWallet>;

/** The wallet on the app database. */
export const wallet = createWallet(appDb);
