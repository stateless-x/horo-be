import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { inArray, sql } from 'drizzle-orm';
import { config } from '../src/config';
import { assertCanUnlock } from '../src/lib/entitlements';
import { isLocalDatabaseUrl } from '../src/lib/dev-regenerate';
import { BALANCE_CAP, PACKS, PRODUCT_PRICES, WELCOME_GIFT, packAmountSatang } from '../src/lib/pricing';
import {
  BalanceCapExceeded,
  InsufficientBalance,
  OrderNotPaid,
  SpendRefunded,
  createWallet,
  type Wallet,
} from '../src/lib/wallet';
import { walletDevRoutes } from '../src/routes/wallet';
import { createDbClient, orders, walletLedger, user, type DbClient } from '../lib/db';

/**
 * The มู ledger (docs/wallet.md).
 *
 * The first block needs no database. The second runs against a real local
 * Postgres, because its guarantees live in advisory locks and partial unique
 * indexes. `bun test` has no DATABASE_URL, so it runs only when
 * WALLET_TEST_DATABASE_URL names a local database with the schema pushed:
 *
 *   WALLET_TEST_DATABASE_URL="postgresql://dev:<pw>@localhost:5432/horo_dev" bun test tests/wallet.test.ts
 */

describe('pricing', () => {
  test('packs: 49 → 49, 99 → 109, 199 → 229; bonus on the bigger packs only', () => {
    expect(Object.values(PACKS).map((pack) => [pack.priceBaht, pack.base + pack.bonus])).toEqual([
      [49, 49],
      [99, 109],
      [199, 229],
    ]);
    for (const pack of Object.values(PACKS)) {
      expect(pack.base).toBe(pack.priceBaht); // 1 มู = ฿1 for the base units
      expect(packAmountSatang(pack)).toBe(pack.priceBaht * 100);
    }
  });

  test('the welcome gift is exactly one ดวงคู่ unlock', () => {
    expect(WELCOME_GIFT).toBe(PRODUCT_PRICES.compat_unlock);
    expect(PRODUCT_PRICES.compat_unlock).toBe(49);
  });
});

describe('assertCanUnlock', () => {
  const REAL = config.compat;
  afterEach(() => {
    config.compat = REAL;
  });

  const walletThat = (spend: Wallet['spend']) => ({ ensureWelcome: async () => {}, spend });

  test('insufficient balance becomes the 402 shape with balance and price', async () => {
    config.compat = { lockEnabled: true, unlockFree: false };
    const decision = await assertCanUnlock(
      'u1',
      'row1',
      walletThat(async () => {
        throw new InsufficientBalance(12, 49);
      }),
    );
    expect(decision).toEqual({ ok: false, body: { error: 'insufficient_balance', balance: 12, price: 49 } });
  });

  test('any other wallet failure is thrown, not turned into a refusal', async () => {
    config.compat = { lockEnabled: true, unlockFree: false };
    const broken = walletThat(async () => {
      throw new Error('connection reset');
    });
    await expect(assertCanUnlock('u1', 'row1', broken)).rejects.toThrow('connection reset');
  });

  test('lock off or COMPAT_UNLOCK_FREE never touches the wallet', async () => {
    const untouchable = walletThat(async () => {
      throw new Error('wallet touched');
    });
    config.compat = { lockEnabled: false, unlockFree: false };
    expect(await assertCanUnlock('u1', 'row1', untouchable)).toEqual({ ok: true });
    config.compat = { lockEnabled: true, unlockFree: true };
    expect(await assertCanUnlock('u1', 'row1', untouchable)).toEqual({ ok: true });
  });
});

describe('POST /api/wallet/dev/grant guards', () => {
  const REAL_ENV = config.env;
  const REAL_DB = config.database.url;
  afterEach(() => {
    config.env = REAL_ENV;
    config.database.url = REAL_DB;
  });

  const grant = () =>
    walletDevRoutes().handle(
      new Request('http://localhost/api/wallet/dev/grant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ delta: 100, note: 'test' }),
      }),
    );

  test('refused with 404 in production, even on a local database', async () => {
    config.env = 'production';
    config.database.url = 'postgresql://dev:pw@localhost:5432/horo_dev';
    expect((await grant()).status).toBe(404);
  });

  test('refused with 403 on a database that is not this machine', async () => {
    config.env = 'development';
    config.database.url = 'postgresql://user:pw@db.railway.internal:5432/railway';
    expect((await grant()).status).toBe(403);
  });
});

const TEST_DB_URL = process.env.WALLET_TEST_DATABASE_URL;

describe.skipIf(!TEST_DB_URL)('ledger on a local Postgres', () => {
  let db: DbClient;
  let wallet: Wallet;
  const userIds: string[] = [];
  const run = crypto.randomUUID().slice(0, 8);

  async function newUser(): Promise<string> {
    const id = `wallet-test-${run}-${userIds.length}`;
    await db.insert(user).values({ id, name: 'wallet test', email: `${id}@wallet.test` });
    userIds.push(id);
    return id;
  }

  async function paidOrder(userId: string, packId: keyof typeof PACKS) {
    const order = await wallet.createOrder(userId, packId);
    await db.update(orders).set({ status: 'paid', paidAt: new Date() }).where(sql`${orders.id} = ${order.id}`);
    return order;
  }

  /** Raw insert, bypassing the wallet's checks, to prove the index alone refuses it. */
  async function rawInsertFails(row: typeof walletLedger.$inferInsert): Promise<string> {
    try {
      await db.insert(walletLedger).values(row);
      return 'inserted';
    } catch (error) {
      return (error as { code?: string }).code ?? String(error);
    }
  }

  beforeAll(async () => {
    if (!TEST_DB_URL || !isLocalDatabaseUrl(TEST_DB_URL)) {
      throw new Error('WALLET_TEST_DATABASE_URL must point at a database on this machine');
    }
    db = createDbClient(TEST_DB_URL);
    wallet = createWallet(db);
    // Open the pool's connections now. On a cold pool each transaction waits for its own
    // connect, so concurrent calls run one after another and a missing lock goes unnoticed.
    await Promise.all(Array.from({ length: 10 }, () => db.execute(sql`select pg_sleep(0.05)`)));
  });

  afterAll(async () => {
    if (!db || userIds.length === 0) return;
    // Test cleanup only: the app never deletes ledger rows.
    await db.delete(walletLedger).where(inArray(walletLedger.userId, userIds));
    await db.delete(orders).where(inArray(orders.userId, userIds));
    await db.delete(user).where(inArray(user.id, userIds));
  });

  test('welcome is granted once across concurrent first touches', async () => {
    const userId = await newUser();
    await Promise.all(Array.from({ length: 6 }, () => wallet.ensureWelcome(userId)));
    await wallet.ensureWelcome(userId);
    expect(await wallet.balance(userId)).toBe(WELCOME_GIFT);
    expect(await rawInsertFails({ userId, delta: WELCOME_GIFT, kind: 'welcome' })).toBe('23505');
  });

  test('concurrent spends on different rows: exactly one succeeds, the balance never goes negative', async () => {
    const userId = await newUser();
    await wallet.ensureWelcome(userId);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) => wallet.spend(userId, 'compat_unlock', `row-${index}`)),
    );
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(7);
    for (const { reason } of rejected) {
      expect(reason).toBeInstanceOf(InsufficientBalance);
      expect(reason).toMatchObject({ balance: 0, price: 49 });
    }
    expect(await wallet.balance(userId)).toBe(0);
  });

  test('two concurrent spends on the same row charge once, and a retry is free', async () => {
    const userId = await newUser();
    await wallet.adjust(userId, 100, 'test funds');
    const [a, b] = await Promise.all([
      wallet.spend(userId, 'compat_unlock', 'row-same'),
      wallet.spend(userId, 'compat_unlock', 'row-same'),
    ]);
    expect([a.charged, b.charged].sort()).toEqual([false, true]);
    expect((await wallet.spend(userId, 'compat_unlock', 'row-same')).charged).toBe(false);
    expect(await wallet.balance(userId)).toBe(51);
    expect(
      await rawInsertFails({ userId, delta: -49, kind: 'spend', productId: 'compat_unlock', refId: 'row-same' }),
    ).toBe('23505');
  });

  test('refundSpend restores the price once, and the refunded thing is never unlocked free', async () => {
    const userId = await newUser();
    await wallet.ensureWelcome(userId);
    await wallet.spend(userId, 'compat_unlock', 'row-r');
    expect(await wallet.balance(userId)).toBe(0);

    const [first, second] = await Promise.all([
      wallet.refundSpend(userId, 'compat_unlock', 'row-r', 'generation failed'),
      wallet.refundSpend(userId, 'compat_unlock', 'row-r', 'generation failed'),
    ]);
    expect([first.refunded, second.refunded].sort()).toEqual([false, true]);
    expect(await wallet.balance(userId)).toBe(49);

    // Spend → refund → spend must not end unlocked with 49 still in the balance.
    await expect(wallet.spend(userId, 'compat_unlock', 'row-r')).rejects.toBeInstanceOf(SpendRefunded);
    expect(await wallet.balance(userId)).toBe(49);
  });

  test('a replayed creditOrder credits once, with the bonus expiring in 180 days', async () => {
    const userId = await newUser();
    const order = await paidOrder(userId, 'p99');
    const results = await Promise.all([wallet.creditOrder(order.id), wallet.creditOrder(order.id)]);
    await wallet.creditOrder(order.id);
    expect(results.filter((result) => result.credited)).toHaveLength(1);
    expect(await wallet.balance(userId)).toBe(109);

    const rows = await wallet.ledger(userId, 10);
    const bonus = rows.find((row) => row.kind === 'bonus');
    expect(rows.find((row) => row.kind === 'purchase')?.delta).toBe(99);
    expect(bonus?.delta).toBe(10);
    const days = (Date.parse(bonus!.expiresAt!) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(179.9);
    expect(days).toBeLessThan(180.1);
    expect(await rawInsertFails({ userId, delta: 99, kind: 'purchase', orderId: order.id })).toBe('23505');
  });

  test('creditOrder refuses an order that is not paid', async () => {
    const userId = await newUser();
    const order = await wallet.createOrder(userId, 'p49');
    expect(order.status).toBe('pending');
    await expect(wallet.creditOrder(order.id)).rejects.toBeInstanceOf(OrderNotPaid);
    expect(await wallet.balance(userId)).toBe(0);
  });

  test('the balance cap is enforced at checkout and on credit', async () => {
    const userId = await newUser();
    await wallet.adjust(userId, BALANCE_CAP - 100, 'near the cap');
    // A pending p49 fits (1949 ≤ 2000); p199 (+229) would not.
    await expect(wallet.createOrder(userId, 'p199')).rejects.toBeInstanceOf(BalanceCapExceeded);
    const order = await paidOrder(userId, 'p49');
    await wallet.adjust(userId, 60, 'more');
    await expect(wallet.creditOrder(order.id)).rejects.toBeInstanceOf(BalanceCapExceeded);
    await expect(wallet.adjust(userId, 100, 'over')).rejects.toBeInstanceOf(BalanceCapExceeded);
    expect(await wallet.balance(userId)).toBe(BALANCE_CAP - 40);
  });

  test('adjust never takes the balance below zero', async () => {
    const userId = await newUser();
    await expect(wallet.adjust(userId, -1, 'overdraw')).rejects.toBeInstanceOf(InsufficientBalance);
    expect(await wallet.balance(userId)).toBe(0);
  });

  test('ledger lists the newest rows first', async () => {
    const userId = await newUser();
    await wallet.ensureWelcome(userId);
    await wallet.spend(userId, 'compat_unlock', 'row-l');
    const rows = await wallet.ledger(userId, 20);
    expect(rows.map((row) => [row.kind, row.delta])).toEqual([
      ['spend', -49],
      ['welcome', 49],
    ]);
    expect(rows[0]).toMatchObject({ productId: 'compat_unlock', refId: 'row-l' });
  });
});
