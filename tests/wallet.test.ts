import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { and, asc, eq, inArray, like, or, sql } from 'drizzle-orm';
import { config } from '../src/config';
import { chargeUnlockWithin, checkUnlock } from '../src/lib/entitlements';
import { isLocalDatabaseUrl } from '../src/lib/dev-regenerate';
import { BALANCE_CAP, PACKS, PRODUCT_PRICES, QR_TTL_MINUTES, WELCOME_GIFT, bonusPercent, describeOrder, packAmountSatang } from '../src/lib/pricing';
import {
  BalanceCapExceeded,
  IllegalOrderTransition,
  InsufficientBalance,
  InvalidAdjustment,
  OrderNotPaid,
  SpendRefunded,
  createWallet,
  ledgerBy,
  type Wallet,
} from '../src/lib/wallet';
import { walletDevRoutes, walletRoutes } from '../src/routes/wallet';
import * as session from '../src/lib/session';
import { fulfilPaidOrder } from '../src/lib/order-fulfilment';
import { selectGateway } from '../src/lib/payments';
import { createFakeGateway, type FakeGateway } from '../src/lib/payments/fake';
import { PaymentAmountMismatch, handleProviderEvent, type EventDeps, type ProviderEvent } from '../src/lib/payments/events';
import { expireStaleOrders, refreshOrder, startCheckout, type CheckoutDeps } from '../src/lib/payments/checkout';
import { birthProfiles, compatibility, createDbClient, orders, paymentEvents, walletLedger, user, type DbClient } from '../lib/db';

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
  test('packs: 49 → 49, 99 → 109, 199 → 229, 399 → 479; bonus on the bigger packs only', () => {
    expect(Object.values(PACKS).map((pack) => [pack.priceBaht, pack.base + pack.bonus])).toEqual([
      [49, 49],
      [99, 109],
      [199, 229],
      [399, 479],
    ]);
    for (const pack of Object.values(PACKS)) {
      expect(pack.base).toBe(pack.priceBaht); // 1 มู = ฿1 for the base units
      expect(packAmountSatang(pack)).toBe(pack.priceBaht * 100);
    }
  });

  test('bonusPercent is the bonus over the base, floored: 0, 10, 15, 20', () => {
    // 10/99, 30/199 and 80/399 are each a little over the whole percent.
    expect(Object.values(PACKS).map(bonusPercent)).toEqual([0, 10, 15, 20]);
  });

  test('every pack fits under the balance cap from an empty wallet', () => {
    for (const pack of Object.values(PACKS)) expect(pack.base + pack.bonus).toBeLessThanOrEqual(BALANCE_CAP);
  });

  test('describeOrder names the baht and the มู credited', () => {
    expect(describeOrder({ amountSatang: packAmountSatang(PACKS.p99), unitsBase: 99, unitsBonus: 10 })).toBe('Horo เติม ฿99 (109 มู)');
    expect(describeOrder({ amountSatang: 39_900, unitsBase: 399, unitsBonus: 80 })).toBe('Horo เติม ฿399 (479 มู)');
  });

  test('the welcome gift is exactly one ดวงคู่ unlock', () => {
    expect(WELCOME_GIFT).toBe(PRODUCT_PRICES.compat_unlock);
    expect(PRODUCT_PRICES.compat_unlock).toBe(49);
  });
});

describe('unlock seam (entitlements)', () => {
  const REAL = config.compat;
  afterEach(() => {
    config.compat = REAL;
  });

  const walletThat = (spend: Wallet['spend']) => ({
    ensureWelcome: async () => {},
    spendWithin: ((_tx: unknown, ...args: Parameters<Wallet['spend']>) => spend(...args)) as Wallet['spendWithin'],
    canAfford: async () => {
      throw new Error('canAfford not expected');
    },
    hasPaid: async () => {
      throw new Error('hasPaid not expected');
    },
  });
  const tx = {} as Parameters<Wallet['spendWithin']>[0];

  test('lock off or COMPAT_UNLOCK_FREE never touches the wallet', async () => {
    const untouchable = walletThat(async () => {
      throw new Error('wallet touched');
    });
    config.compat = { lockEnabled: false, unlockFree: false };
    expect(await checkUnlock('u1', 'row1', untouchable)).toEqual({ ok: true });
    expect(await chargeUnlockWithin(tx, 'u1', 'row1', untouchable)).toEqual({ ok: true });
    config.compat = { lockEnabled: true, unlockFree: true };
    expect(await checkUnlock('u1', 'row1', untouchable)).toEqual({ ok: true });
    expect(await chargeUnlockWithin(tx, 'u1', 'row1', untouchable)).toEqual({ ok: true });
  });

  test('checkUnlock grants the welcome gift, then only reads the balance', async () => {
    config.compat = { lockEnabled: true, unlockFree: false };
    const calls: string[] = [];
    const reader = (balance: number, paid = false) => ({
      ensureWelcome: async () => void calls.push('welcome'),
      canAfford: async (_userId: string, price: number) => (calls.push('canAfford'), { ok: balance >= price, balance, price }),
      hasPaid: async () => (calls.push('hasPaid'), paid),
      spendWithin: async () => {
        throw new Error('checkUnlock must not spend');
      },
    });
    expect(await checkUnlock('u1', 'row1', reader(49))).toEqual({ ok: true });
    expect(await checkUnlock('u1', 'row1', reader(10))).toEqual({ ok: false, body: { error: 'insufficient_balance', balance: 10, price: 49 } });
    expect(calls).toEqual(['hasPaid', 'welcome', 'canAfford', 'hasPaid', 'welcome', 'canAfford']);
  });

  test('checkUnlock skips the balance for a row already paid for', async () => {
    config.compat = { lockEnabled: true, unlockFree: false };
    const calls: string[] = [];
    const paidAtZero = {
      ensureWelcome: async () => void calls.push('welcome'),
      canAfford: async (_userId: string, price: number) => (calls.push('canAfford'), { ok: false, balance: 0, price }),
      hasPaid: async () => (calls.push('hasPaid'), true),
      spendWithin: async () => {
        throw new Error('checkUnlock must not spend');
      },
    };
    expect(await checkUnlock('u1', 'row1', paidAtZero)).toEqual({ ok: true });
    expect(calls).toEqual(['hasPaid']);
  });

  test('chargeUnlockWithin maps a short balance to the 402 body and throws anything else', async () => {
    config.compat = { lockEnabled: true, unlockFree: false };
    const short = walletThat(async () => {
      throw new InsufficientBalance(0, 49);
    });
    expect(await chargeUnlockWithin(tx, 'u1', 'row1', short)).toEqual({
      ok: false,
      body: { error: 'insufficient_balance', balance: 0, price: 49 },
    });
    const broken = walletThat(async () => {
      throw new Error('connection reset');
    });
    await expect(chargeUnlockWithin(tx, 'u1', 'row1', broken)).rejects.toThrow('connection reset');
  });
});

describe('wallet routes while nothing is sellable', () => {
  const REAL = config.compat;
  afterEach(() => {
    config.compat = REAL;
  });

  test('with locked mode off, GET /api/wallet says disabled before any session or database work', async () => {
    config.compat = { lockEnabled: false, unlockFree: false };
    const response = await walletRoutes().handle(new Request('http://localhost/api/wallet/'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false });
  });

  test('with locked mode off, checkout is not available', async () => {
    config.compat = { lockEnabled: false, unlockFree: false };
    const response = await walletRoutes().handle(
      new Request('http://localhost/api/wallet/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ packId: 'p49' }),
      }),
    );
    expect(response.status).toBe(404);
  });
});

describe('GET /api/wallet/history guards', () => {
  const REAL = config.compat;
  afterEach(() => {
    config.compat = REAL;
  });

  const history = () => walletRoutes().handle(new Request('http://localhost/api/wallet/history?limit=5'));

  test('404 while locked mode is off, before any session work', async () => {
    config.compat = { lockEnabled: false, unlockFree: false };
    expect((await history()).status).toBe(404);
  });

  test('401 without a session', async () => {
    config.compat = { lockEnabled: true, unlockFree: false };
    expect((await history()).status).toBe(401);
  });
});

describe('ledger actor shown to the user', () => {
  test('user → you, system and dev → horo, admin → team', () => {
    expect(ledgerBy('user')).toBe('you');
    expect(ledgerBy('system')).toBe('horo');
    expect(ledgerBy('dev')).toBe('horo');
    expect(ledgerBy('admin')).toBe('team');
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

describe('payment gateway selection', () => {
  test('production refuses PAYMENT_PROVIDER=fake', () => {
    expect(() => selectGateway({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'fake' })).toThrow('refused in production');
  });

  test('production defaults to stripe; elsewhere the default is fake', () => {
    expect(selectGateway({ NODE_ENV: 'production' }).provider).toBe('stripe');
    expect(selectGateway({ NODE_ENV: 'development' }).provider).toBe('fake');
    expect(selectGateway({}).provider).toBe('fake');
    expect(selectGateway({ NODE_ENV: 'development', PAYMENT_PROVIDER: 'stripe' }).provider).toBe('stripe');
  });

  test('an unknown provider throws', () => {
    expect(() => selectGateway({ PAYMENT_PROVIDER: 'paypal' })).toThrow('Unknown PAYMENT_PROVIDER');
  });

  test('the stripe adapter is a stub until I3', async () => {
    const stripe = selectGateway({ NODE_ENV: 'production' });
    await expect(stripe.lookupCharge('pi_1')).rejects.toThrow('not implemented (I3)');
  });
});

describe('fake gateway', () => {
  const order = { id: 'o1', amountSatang: 4900, currency: 'THB' } as Parameters<FakeGateway['startCharge']>[0];

  test('startCharge is idempotent per order and expires QR_TTL_MINUTES from now', async () => {
    const at = new Date('2026-09-29T10:00:00Z');
    const fake = createFakeGateway(() => at);
    const first = await fake.startCharge(order, { email: null });
    expect(first).toEqual({
      providerRef: 'fake_o1',
      qr: { data: 'fake:o1', imagePngUrl: null, imageSvgUrl: null },
      expiresAt: new Date(at.getTime() + QR_TTL_MINUTES * 60_000),
    });
    expect(await fake.startCharge(order, { email: null })).toEqual(first);
    expect(await fake.lookupCharge('fake_o1')).toEqual({ status: 'pending', amountSatang: 4900, currency: 'THB' });
  });

  test('cancel is idempotent, and a payment can still land on a canceled charge', async () => {
    const fake = createFakeGateway();
    await fake.startCharge(order, { email: null });
    await fake.cancelCharge('fake_o1');
    await fake.cancelCharge('fake_o1');
    await fake.cancelCharge('fake_unknown');
    expect((await fake.lookupCharge('fake_o1')).status).toBe('canceled');
    expect(fake.simulate('fake_o1', 'succeeded')).toEqual({
      eventRef: 'fake_evt_fake_o1_succeeded',
      state: { status: 'succeeded', amountSatang: 4900, currency: 'THB' },
    });
    await expect(fake.cancelCharge('fake_o1')).rejects.toThrow('already succeeded');
  });
});

const TEST_DB_URL = process.env.WALLET_TEST_DATABASE_URL;

const DEV = { type: 'dev', label: 'dev: test' } as const;
const SYSTEM = { type: 'system' } as const;
/** Actor columns for a raw insert, so it reaches the unique index instead of failing NOT NULL. */
const RAW_ACTOR = { actorType: 'system' } as const;

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
    // Test cleanup only: the app never deletes ledger or payment event rows.
    const testOrders = db.select({ id: orders.id }).from(orders).where(inArray(orders.userId, userIds));
    await db.delete(paymentEvents).where(or(inArray(paymentEvents.orderId, testOrders), like(paymentEvents.eventRef, `${run}%`)));
    await db.delete(walletLedger).where(inArray(walletLedger.userId, userIds));
    await db.delete(orders).where(inArray(orders.userId, userIds));
    const profiles = await db.select({ id: birthProfiles.id }).from(birthProfiles).where(inArray(birthProfiles.userId, userIds));
    if (profiles.length > 0) {
      await db.delete(compatibility).where(inArray(compatibility.profileAId, profiles.map((profile) => profile.id)));
      await db.delete(birthProfiles).where(inArray(birthProfiles.userId, userIds));
    }
    await db.delete(user).where(inArray(user.id, userIds));
  });

  test('welcome is granted once across concurrent first touches', async () => {
    const userId = await newUser();
    await Promise.all(Array.from({ length: 6 }, () => wallet.ensureWelcome(userId)));
    await wallet.ensureWelcome(userId);
    expect(await wallet.balance(userId)).toBe(WELCOME_GIFT);
    expect(await rawInsertFails({ ...RAW_ACTOR, userId, delta: WELCOME_GIFT, kind: 'welcome' })).toBe('23505');
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
    await wallet.adjust(userId, 100, 'test funds', DEV);
    const [a, b] = await Promise.all([
      wallet.spend(userId, 'compat_unlock', 'row-same'),
      wallet.spend(userId, 'compat_unlock', 'row-same'),
    ]);
    expect([a.charged, b.charged].sort()).toEqual([false, true]);
    expect((await wallet.spend(userId, 'compat_unlock', 'row-same')).charged).toBe(false);
    expect(await wallet.balance(userId)).toBe(51);
    expect(
      await rawInsertFails({ ...RAW_ACTOR, userId, delta: -49, kind: 'spend', productId: 'compat_unlock', refId: 'row-same' }),
    ).toBe('23505');
  });

  test('spendWithin rolls back with the caller\'s transaction, and commits with it', async () => {
    const userId = await newUser();
    await wallet.ensureWelcome(userId);
    await expect(
      db.transaction(async (tx) => {
        const spent = await wallet.spendWithin(tx, userId, 'compat_unlock', 'row-tx');
        expect(spent).toEqual({ charged: true, balance: 0 });
        throw new Error('saving the detail failed');
      }),
    ).rejects.toThrow('saving the detail failed');
    expect(await wallet.balance(userId)).toBe(49);
    expect((await wallet.ledger(userId, 10)).map((row) => row.kind)).toEqual(['welcome']);

    await db.transaction((tx) => wallet.spendWithin(tx, userId, 'compat_unlock', 'row-tx'));
    expect(await wallet.balance(userId)).toBe(0);
  });

  test('canAfford reads the balance against a price', async () => {
    const userId = await newUser();
    expect(await wallet.canAfford(userId, 49)).toEqual({ ok: false, balance: 0, price: 49 });
    await wallet.ensureWelcome(userId);
    expect(await wallet.canAfford(userId, 49)).toEqual({ ok: true, balance: 49, price: 49 });
  });

  test('hasPaid: a spend on that row, not refunded', async () => {
    const userId = await newUser();
    await wallet.ensureWelcome(userId);
    expect(await wallet.hasPaid(userId, 'compat_unlock', 'row-p')).toBe(false);
    await wallet.spend(userId, 'compat_unlock', 'row-p');
    expect(await wallet.hasPaid(userId, 'compat_unlock', 'row-p')).toBe(true);
    expect(await wallet.hasPaid(userId, 'compat_unlock', 'row-other')).toBe(false);
    await wallet.refundSpend(userId, 'compat_unlock', 'row-p', 'test', SYSTEM);
    expect(await wallet.hasPaid(userId, 'compat_unlock', 'row-p')).toBe(false);
  });

  test('refundSpend restores the price once, and the refunded thing is never unlocked free', async () => {
    const userId = await newUser();
    await wallet.ensureWelcome(userId);
    await wallet.spend(userId, 'compat_unlock', 'row-r');
    expect(await wallet.balance(userId)).toBe(0);

    const [first, second] = await Promise.all([
      wallet.refundSpend(userId, 'compat_unlock', 'row-r', 'generation failed', SYSTEM),
      wallet.refundSpend(userId, 'compat_unlock', 'row-r', 'generation failed', SYSTEM),
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
    const results = await Promise.all([wallet.creditOrder(order.id, SYSTEM), wallet.creditOrder(order.id, SYSTEM)]);
    await wallet.creditOrder(order.id, SYSTEM);
    expect(results.filter((result) => result.credited)).toHaveLength(1);
    expect(await wallet.balance(userId)).toBe(109);

    const rows = await wallet.ledger(userId, 10);
    const bonus = rows.find((row) => row.kind === 'bonus');
    expect(rows.find((row) => row.kind === 'purchase')?.delta).toBe(99);
    expect(bonus?.delta).toBe(10);
    const days = (Date.parse(bonus!.expiresAt!) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(179.9);
    expect(days).toBeLessThan(180.1);
    expect(await rawInsertFails({ ...RAW_ACTOR, userId, delta: 99, kind: 'purchase', orderId: order.id })).toBe('23505');
  });

  test('creditOrder refuses an order that is not paid', async () => {
    const userId = await newUser();
    const order = await wallet.createOrder(userId, 'p49');
    expect(order.status).toBe('pending');
    await expect(wallet.creditOrder(order.id, SYSTEM)).rejects.toBeInstanceOf(OrderNotPaid);
    expect(await wallet.balance(userId)).toBe(0);
  });

  test('the balance cap is enforced at checkout and on credit', async () => {
    const userId = await newUser();
    await wallet.adjust(userId, BALANCE_CAP - 100, 'near the cap', DEV);
    // A pending p49 fits (1949 ≤ 2000); p199 (+229) would not.
    await expect(wallet.createOrder(userId, 'p199')).rejects.toBeInstanceOf(BalanceCapExceeded);
    const order = await paidOrder(userId, 'p49');
    await wallet.adjust(userId, 60, 'more', DEV);
    await expect(wallet.creditOrder(order.id, SYSTEM)).rejects.toBeInstanceOf(BalanceCapExceeded);
    await expect(wallet.adjust(userId, 100, 'over', DEV)).rejects.toBeInstanceOf(BalanceCapExceeded);
    expect(await wallet.balance(userId)).toBe(BALANCE_CAP - 40);
  });

  test('adjust never takes the balance below zero', async () => {
    const userId = await newUser();
    await expect(wallet.adjust(userId, -1, 'overdraw', DEV)).rejects.toBeInstanceOf(InsufficientBalance);
    expect(await wallet.balance(userId)).toBe(0);
  });

  test('a ดวงคู่ spend carries the partner name from one join; a deleted row falls back to none', async () => {
    const userId = await newUser();
    const [profile] = await db
      .insert(birthProfiles)
      .values({ userId, birthDate: new Date('1998-09-09T00:00:00Z'), gender: 'female' })
      .returning({ id: birthProfiles.id });
    const [pair] = await db
      .insert(compatibility)
      .values({ profileAId: profile.id, partnerName: 'ต้น', partnerBirthDate: '1997-01-01', relationshipType: 'romantic', score: 60, analysis: '{}' })
      .returning({ id: compatibility.id });
    await wallet.adjust(userId, 98, 'test funds', DEV);
    await wallet.spend(userId, 'compat_unlock', pair.id);
    await wallet.spend(userId, 'compat_unlock', crypto.randomUUID()); // a row that no longer exists
    const [gone, named] = await wallet.ledger(userId, 10);
    expect(named).toMatchObject({ kind: 'spend', refId: pair.id, refName: 'ต้น' });
    expect(gone).toMatchObject({ kind: 'spend', refName: null });
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
  /** The actor columns as stored, oldest first. */
  async function actorsOf(userId: string) {
    return db
      .select({ kind: walletLedger.kind, type: walletLedger.actorType, id: walletLedger.actorId, label: walletLedger.actorLabel })
      .from(walletLedger)
      .where(eq(walletLedger.userId, userId))
      .orderBy(asc(walletLedger.createdAt), asc(walletLedger.kind));
  }

  test('every insert path records its actor', async () => {
    const userId = await newUser();
    await wallet.ensureWelcome(userId); // system
    await wallet.spend(userId, 'compat_unlock', 'row-a'); // the spending user
    await wallet.refundSpend(userId, 'compat_unlock', 'row-a', 'generation failed', { type: 'admin', id: 'adm-1', email: 'a@team.test' });
    const order = await paidOrder(userId, 'p99');
    await wallet.creditOrder(order.id, { type: 'system', label: 'stripe:evt_1' });
    await wallet.adjust(userId, 5, 'dev: test', { type: 'dev', label: 'dev: test' });
    await wallet.adjust(userId, -5, 'goodwill undo', { type: 'admin', id: 'adm-2', email: 'b@team.test' });
    const rows = await actorsOf(userId);
    const byKind = Object.fromEntries(rows.map((row) => [`${row.kind}:${row.label ?? ''}`, [row.type, row.id, row.label]]));
    expect(byKind).toEqual({
      'welcome:': ['system', null, null],
      'spend:': ['user', userId, null],
      'refund:a@team.test': ['admin', 'adm-1', 'a@team.test'],
      'purchase:stripe:evt_1': ['system', null, 'stripe:evt_1'],
      'bonus:stripe:evt_1': ['system', null, 'stripe:evt_1'],
      'admin_adjust:dev: test': ['dev', null, 'dev: test'],
      'admin_adjust:b@team.test': ['admin', 'adm-2', 'b@team.test'],
    });
  });

  test('adjust refuses an empty note and a non-admin, non-dev actor, writing nothing', async () => {
    const userId = await newUser();
    const admin = { type: 'admin', id: 'adm-1', email: 'a@team.test' } as const;
    await expect(wallet.adjust(userId, 10, '   ', admin)).rejects.toBeInstanceOf(InvalidAdjustment);
    await expect(wallet.adjust(userId, 10, 'reason', { type: 'user', id: userId })).rejects.toBeInstanceOf(InvalidAdjustment);
    await expect(wallet.adjust(userId, 10, 'reason', { type: 'system' })).rejects.toBeInstanceOf(InvalidAdjustment);
    expect(await actorsOf(userId)).toEqual([]);
  });

  test('history pages without gaps or duplicates, across rows sharing one microsecond', async () => {
    const userId = await newUser();
    // Seven rows at one timestamp that is not millisecond-aligned, then three later ones.
    const tied = sql`'2026-01-01 00:00:00.123456'::timestamp`;
    await db.insert(walletLedger).values(
      Array.from({ length: 7 }, (_, index) => ({ ...RAW_ACTOR, userId, delta: 1, kind: 'admin_adjust', note: `tie ${index}`, createdAt: tied })),
    );
    await wallet.adjust(userId, 1, 'later 1', DEV);
    await wallet.adjust(userId, 1, 'later 2', DEV);
    await wallet.adjust(userId, 1, 'later 3', DEV);

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await wallet.history(userId, { limit: 3, cursor });
      seen.push(...page.entries.map((entry) => entry.id));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 10);
    const all = (await wallet.history(userId, { limit: 50 })).entries.map((entry) => entry.id);
    expect(all).toHaveLength(10);
    expect(seen).toEqual(all);
    expect(pages).toBe(4); // 3 + 3 + 3 + 1, and the last page says there is no next one
  });

  test('the kind filter returns only its group; a purchase carries its baht', async () => {
    const userId = await newUser();
    await wallet.ensureWelcome(userId);
    await wallet.spend(userId, 'compat_unlock', 'row-k');
    await wallet.creditOrder((await paidOrder(userId, 'p99')).id, SYSTEM);
    await wallet.adjust(userId, 1, 'dev: k', DEV);
    const kinds = async (kind: Parameters<Wallet['history']>[1]['kind']) =>
      (await wallet.history(userId, { limit: 50, kind })).entries.map((entry) => entry.kind).sort();
    expect(await kinds('topup')).toEqual(['bonus', 'purchase']);
    expect(await kinds('spend')).toEqual(['spend']);
    expect(await kinds('refund')).toEqual([]);
    expect(await kinds('adjust')).toEqual(['admin_adjust']);
    expect(await kinds('welcome')).toEqual(['welcome']);
    const topups = (await wallet.history(userId, { limit: 50, kind: 'topup' })).entries;
    expect(topups.find((entry) => entry.kind === 'purchase')).toMatchObject({ delta: 99, amountBaht: 99, by: 'horo' });
    expect(topups.find((entry) => entry.kind === 'bonus')?.amountBaht).toBeNull();
  });

  test('a user sees only their own rows, even with another user\'s row id as the cursor', async () => {
    const alice = await newUser();
    const bob = await newUser();
    await wallet.ensureWelcome(alice);
    await wallet.adjust(alice, 1, 'dev: a', DEV);
    await wallet.ensureWelcome(bob);
    const aliceRows = (await wallet.history(alice, { limit: 50 })).entries;
    const bobRows = (await wallet.history(bob, { limit: 50 })).entries;
    expect(aliceRows).toHaveLength(2);
    expect(bobRows).toHaveLength(1);
    expect(bobRows.some((entry) => aliceRows.some((row) => row.id === entry.id))).toBe(false);
    expect((await wallet.history(bob, { limit: 50, cursor: aliceRows[0].id })).entries).toEqual([]);
  });

  test('no history or ledger output carries an admin\'s id or email', async () => {
    const userId = await newUser();
    const adminId = `admin-secret-${run}`;
    const adminEmail = `boss-${run}@team.test`;
    await wallet.adjust(userId, 10, 'goodwill', { type: 'admin', id: adminId, email: adminEmail });
    const outputs = [await wallet.history(userId, { limit: 50 }), await wallet.ledger(userId, 20)];
    for (const output of outputs) {
      const json = JSON.stringify(output);
      expect(json).not.toContain(adminId);
      expect(json).not.toContain(adminEmail);
      expect(json).not.toContain('actorId');
      expect(json).not.toContain('actorLabel');
    }
    expect((await wallet.ledger(userId, 20))[0]).toMatchObject({ kind: 'admin_adjust', by: 'team', note: 'goodwill' });
  });

  // ---- Payments (docs/wallet.md, Payments): the gateway seam, the order state machine, payment_events.

  /** Unlocks the fulfilment asked for (one-flow orders only). */
  function paymentsFor(fake: FakeGateway) {
    const unlocks: string[] = [];
    const events: EventDeps = {
      db,
      wallet,
      fulfil: (orderId, actor) =>
        fulfilPaidOrder(orderId, actor, {
          wallet,
          unlock: async (_userId, rowId) => (unlocks.push(rowId), { status: 200 }),
        }),
    };
    const handle = (event: ProviderEvent) => handleProviderEvent(event, events);
    const checkout: CheckoutDeps = { wallet, gateway: fake, handle };
    return { unlocks, events, handle, checkout };
  }

  async function fakeOrder(fake: FakeGateway, userId: string, packId: keyof typeof PACKS = 'p49', unlockRef?: string) {
    return startCheckout({ userId, email: `${userId}@wallet.test`, packId, unlockRef }, { wallet, gateway: fake });
  }

  /** The fake's webhook for this order, as the provider would send it. */
  function webhook(fake: FakeGateway, providerRef: string, outcome: 'succeeded' | 'failed'): ProviderEvent {
    const { eventRef, state } = fake.simulate(providerRef, outcome);
    return { provider: 'fake', eventRef, providerRef, state, source: 'webhook' };
  }

  async function orderRow(orderId: string) {
    const [row] = await db.select().from(orders).where(eq(orders.id, orderId));
    return row;
  }

  async function eventsOf(orderId: string) {
    return db.select().from(paymentEvents).where(eq(paymentEvents.orderId, orderId)).orderBy(asc(paymentEvents.receivedAt));
  }

  async function creditRows(userId: string) {
    return db
      .select({ kind: walletLedger.kind, delta: walletLedger.delta, label: walletLedger.actorLabel })
      .from(walletLedger)
      .where(and(eq(walletLedger.userId, userId), inArray(walletLedger.kind, ['purchase', 'bonus', 'admin_adjust'])));
  }

  function signedInAs(userId: string) {
    return spyOn(session, 'validateSessionFromRequest').mockResolvedValue({
      userId,
      email: `${userId}@wallet.test`,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
  }

  test('checkout returns the fake QR and its expiry, and stores the charge on the order', async () => {
    const userId = await newUser();
    const fake = createFakeGateway();
    const { handle } = paymentsFor(fake);
    const REAL = config.compat;
    config.compat = { lockEnabled: true, unlockFree: false };
    const spy = signedInAs(userId);
    try {
      const before = Date.now();
      const response = await walletRoutes(wallet, fake, handle).handle(
        new Request('http://localhost/api/wallet/checkout', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ packId: 'p99' }),
        }),
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        status: 'pending',
        payment: 'qr',
        qr: { data: `fake:${body.orderId}`, pngUrl: null },
        amountBaht: 99,
      });
      const ttl = Date.parse(body.expiresAt) - before;
      expect(ttl).toBeGreaterThanOrEqual(QR_TTL_MINUTES * 60_000 - 1000);
      expect(ttl).toBeLessThanOrEqual(QR_TTL_MINUTES * 60_000 + 5000);
      expect(await orderRow(body.orderId)).toMatchObject({
        status: 'pending',
        provider: 'fake',
        providerRef: `fake_${body.orderId}`,
        qrData: `fake:${body.orderId}`,
      });

      const wallet404 = await walletRoutes(wallet, fake, handle).handle(new Request('http://localhost/api/wallet/'));
      const state = await wallet404.json();
      expect(state.packs.map((pack: { id: string; bonusPercent: number }) => [pack.id, pack.bonusPercent])).toEqual([
        ['p49', 0],
        ['p99', 10],
        ['p199', 15],
        ['p399', 20],
      ]);
    } finally {
      spy.mockRestore();
      config.compat = REAL;
    }
  });

  test('pending → paid credits once; concurrent and replayed duplicates are no-ops', async () => {
    const userId = await newUser();
    const fake = createFakeGateway();
    const { handle } = paymentsFor(fake);
    const order = await fakeOrder(fake, userId, 'p99');
    const event = webhook(fake, order.providerRef!, 'succeeded');
    const results = await Promise.all([handle(event), handle(event), handle(event)]);
    await handle(event);
    expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
    expect(await wallet.balance(userId)).toBe(109);
    expect((await orderRow(order.id)).status).toBe('paid');
    expect((await eventsOf(order.id)).map((row) => [row.kind, row.eventRef])).toEqual([['succeeded', event.eventRef]]);
    // The webhook path labels the credit with the provider's event id.
    expect((await creditRows(userId)).map((row) => row.label)).toEqual([`fake:${event.eventRef}`, `fake:${event.eventRef}`]);
  });

  test('pending → failed, then failed → paid when the provider confirms: credits exactly once', async () => {
    const userId = await newUser();
    const fake = createFakeGateway();
    const { handle } = paymentsFor(fake);
    const order = await fakeOrder(fake, userId);
    expect(await handle(webhook(fake, order.providerRef!, 'failed'))).toMatchObject({ outcome: 'failed' });
    expect((await orderRow(order.id)).failedAt).not.toBeNull();
    const paid = webhook(fake, order.providerRef!, 'succeeded');
    await Promise.all([handle(paid), handle(paid)]);
    expect((await orderRow(order.id)).status).toBe('paid');
    expect(await wallet.balance(userId)).toBe(49);
  });

  test('expiry cancels the charge; a late payment on the expired order still credits once', async () => {
    const userId = await newUser();
    const fake = createFakeGateway();
    const { handle, checkout } = paymentsFor(fake);
    const order = await fakeOrder(fake, userId);
    const early = new Date(order.expiresAt!.getTime() - 1000);
    expect(await expireStaleOrders(early, checkout)).not.toContain(order.id);
    const late = new Date(order.expiresAt!.getTime() + 1000);
    expect(await expireStaleOrders(late, checkout, order.id)).toEqual([order.id]);
    expect(await orderRow(order.id)).toMatchObject({ status: 'expired' });
    expect((await fake.lookupCharge(order.providerRef!)).status).toBe('canceled');

    // The scan landed before the cancel: the provider reports success anyway.
    await handle(webhook(fake, order.providerRef!, 'succeeded'));
    await handle(webhook(fake, order.providerRef!, 'succeeded'));
    expect((await orderRow(order.id)).status).toBe('paid');
    expect(await wallet.balance(userId)).toBe(49);
  });

  test('paid is terminal: it never expires or fails, and markPaid again is a no-op', async () => {
    const userId = await newUser();
    const fake = createFakeGateway();
    const { handle, checkout } = paymentsFor(fake);
    const order = await fakeOrder(fake, userId);
    await handle(webhook(fake, order.providerRef!, 'succeeded'));
    expect(await expireStaleOrders(new Date(Date.now() + 86_400_000), checkout, order.id)).toEqual([]);
    await handle({ provider: 'fake', eventRef: `${run}-late-fail`, providerRef: order.providerRef!, source: 'webhook', state: { status: 'failed', amountSatang: 4900, currency: 'THB' } });
    expect(await wallet.markPaid(order.id)).toEqual({ marked: false });
    expect(await orderRow(order.id)).toMatchObject({ status: 'paid', expiredAt: null, failedAt: null });
    expect(await wallet.balance(userId)).toBe(49);
  });

  test('refunded is terminal: a success event throws IllegalOrderTransition, is recorded, and credits nothing', async () => {
    const userId = await newUser();
    const fake = createFakeGateway();
    const { handle } = paymentsFor(fake);
    const order = await fakeOrder(fake, userId);
    await db.update(orders).set({ status: 'refunded', refundedAt: new Date() }).where(eq(orders.id, order.id));
    const event = webhook(fake, order.providerRef!, 'succeeded');
    await expect(handle(event)).rejects.toBeInstanceOf(IllegalOrderTransition);
    await expect(wallet.markPaid(order.id)).rejects.toBeInstanceOf(IllegalOrderTransition);
    expect((await eventsOf(order.id)).map((row) => row.kind)).toEqual(['illegal_transition']);
    expect((await orderRow(order.id)).status).toBe('refunded');
    expect(await wallet.balance(userId)).toBe(0);
  });

  test('a short amount or another currency never credits, and is recorded as amount_mismatch', async () => {
    const userId = await newUser();
    const fake = createFakeGateway();
    const { handle } = paymentsFor(fake);
    const order = await fakeOrder(fake, userId, 'p99');
    const base = { provider: 'fake', providerRef: order.providerRef!, source: 'webhook' } as const;
    await expect(
      handle({ ...base, eventRef: `${run}-short`, state: { status: 'succeeded', amountSatang: 4900, currency: 'THB' } }),
    ).rejects.toBeInstanceOf(PaymentAmountMismatch);
    await expect(
      handle({ ...base, eventRef: `${run}-usd`, state: { status: 'succeeded', amountSatang: 9900, currency: 'USD' } }),
    ).rejects.toBeInstanceOf(PaymentAmountMismatch);
    const recorded = await eventsOf(order.id);
    expect(recorded.map((row) => row.kind)).toEqual(['amount_mismatch', 'amount_mismatch']);
    expect(recorded[0].payload).toMatchObject({ amountSatang: 4900, expectedAmountSatang: 9900 });
    expect((await orderRow(order.id)).status).toBe('pending');
    expect(await wallet.balance(userId)).toBe(0);
  });

  test('an excess payment pays the order, credits only the pack, and leaves the excess recorded for an admin', async () => {
    const userId = await newUser();
    const fake = createFakeGateway();
    const { handle } = paymentsFor(fake);
    const order = await fakeOrder(fake, userId, 'p49');
    await handle({
      provider: 'fake',
      eventRef: `${run}-excess`,
      providerRef: order.providerRef!,
      source: 'webhook',
      state: { status: 'succeeded', amountSatang: 9800, currency: 'THB' },
    });
    expect((await orderRow(order.id)).status).toBe('paid');
    expect(await wallet.balance(userId)).toBe(49);
    expect((await creditRows(userId)).map((row) => row.kind)).toEqual(['purchase']); // no admin_adjust
    const [event] = await eventsOf(order.id);
    expect(event).toMatchObject({ kind: 'excess_payment', payload: { amountSatang: 9800, expectedAmountSatang: 4900 } });
  });

  test('a paid order the cap refuses to credit stays paid, is flagged needs_review, and is recorded', async () => {
    const userId = await newUser();
    const fake = createFakeGateway();
    const { handle } = paymentsFor(fake);
    await wallet.adjust(userId, BALANCE_CAP - 100, 'near the cap', DEV);
    const order = await fakeOrder(fake, userId, 'p49');
    await wallet.adjust(userId, 60, 'more', DEV);
    const event = webhook(fake, order.providerRef!, 'succeeded');
    expect(await handle(event)).toMatchObject({ outcome: 'paid', credited: false, needsReview: true });
    expect(await handle(event)).toMatchObject({ outcome: 'paid', duplicate: true, needsReview: true });
    expect(await orderRow(order.id)).toMatchObject({ status: 'paid', needsReview: true });
    expect((await creditRows(userId)).filter((row) => row.kind === 'purchase')).toHaveLength(0);
    expect((await eventsOf(order.id)).map((row) => row.kind)).toEqual(['succeeded', 'credit_failed_cap']);
    expect(await wallet.balance(userId)).toBe(BALANCE_CAP - 40);
  });

  test('an event for no known charge is recorded as unknown_order and changes nothing', async () => {
    const fake = createFakeGateway();
    const { handle } = paymentsFor(fake);
    const event: ProviderEvent = {
      provider: 'fake',
      eventRef: `${run}-unknown`,
      providerRef: `fake_${run}_nothing`,
      source: 'webhook',
      state: { status: 'succeeded', amountSatang: 4900, currency: 'THB' },
    };
    expect(await handle(event)).toEqual({ outcome: 'unknown_order', duplicate: false });
    expect(await handle(event)).toEqual({ outcome: 'unknown_order', duplicate: true });
  });

  test('missed webhook: GET /orders/:id?verify=1 asks the provider and credits, labelled with the charge id', async () => {
    const userId = await newUser();
    const fake = createFakeGateway();
    const { handle } = paymentsFor(fake);
    const order = await fakeOrder(fake, userId, 'p99');
    fake.simulate(order.providerRef!, 'succeeded'); // paid at the provider; the webhook never arrives
    const spy = signedInAs(userId);
    try {
      const get = (query: string) =>
        walletRoutes(wallet, fake, handle).handle(new Request(`http://localhost/api/wallet/orders/${order.id}${query}`));
      const response = await get('?verify=1');
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ orderId: order.id, status: 'paid', balance: 109, units: 109 });
      expect((await get('?verify=1')).status).toBe(429); // one provider lookup per 5 s
      expect(await (await get('')).json()).toMatchObject({ status: 'paid', balance: 109 });
    } finally {
      spy.mockRestore();
    }
    expect((await creditRows(userId)).map((row) => row.label)).toEqual([`fake:${order.providerRef}`, `fake:${order.providerRef}`]);
  });

  test('missed webhook after the QR ran out: the lazy check asks the provider before expiring', async () => {
    const userId = await newUser();
    const fake = createFakeGateway();
    const { checkout } = paymentsFor(fake);
    const paidLate = await fakeOrder(fake, userId);
    const unpaid = await fakeOrder(fake, userId);
    fake.simulate(paidLate.providerRef!, 'succeeded');
    const after = new Date(paidLate.expiresAt!.getTime() + 60_000);
    expect(await refreshOrder(userId, paidLate.id, { verify: false, now: after }, checkout)).toMatchObject({ status: 'paid' });
    expect(await refreshOrder(userId, unpaid.id, { verify: false, now: after }, checkout)).toMatchObject({ status: 'expired' });
    expect((await fake.lookupCharge(unpaid.providerRef!)).status).toBe('canceled');
    expect(await refreshOrder('someone-else', unpaid.id, { verify: true }, checkout)).toBeNull();
    expect(await wallet.balance(userId)).toBe(49);
  });

  test('a webhook and a lookup racing on one order credit once', async () => {
    const userId = await newUser();
    const fake = createFakeGateway();
    const { handle, checkout } = paymentsFor(fake);
    const order = await fakeOrder(fake, userId, 'p199');
    const event = webhook(fake, order.providerRef!, 'succeeded');
    const lookup = () => refreshOrder(userId, order.id, { verify: true }, checkout);
    await Promise.all([handle(event), lookup(), handle(event), lookup(), handle(event), lookup()]);
    expect(await wallet.balance(userId)).toBe(229);
  });

  test('a new QR for the same ดวงคู่ row cancels and expires the old order; a late payment on it still credits once', async () => {
    const userId = await newUser();
    const fake = createFakeGateway();
    const { handle, unlocks } = paymentsFor(fake);
    const first = await fakeOrder(fake, userId, 'p49', 'row-s');
    const other = await fakeOrder(fake, userId, 'p49', 'row-other');
    const second = await fakeOrder(fake, userId, 'p49', 'row-s');
    expect(await orderRow(first.id)).toMatchObject({ status: 'expired' });
    expect((await fake.lookupCharge(first.providerRef!)).status).toBe('canceled');
    expect((await orderRow(other.id)).status).toBe('pending');
    expect((await orderRow(second.id)).status).toBe('pending');

    await handle(webhook(fake, first.providerRef!, 'succeeded'));
    await handle(webhook(fake, first.providerRef!, 'succeeded'));
    expect((await orderRow(first.id)).status).toBe('paid');
    expect(await wallet.balance(userId)).toBe(49);
    expect(unlocks).toEqual(['row-s', 'row-s']); // the unlock itself charges a row once
  });

  test('dev pay settles the fake charge and goes through handleProviderEvent', async () => {
    const userId = await newUser();
    const fake = createFakeGateway();
    const { events } = paymentsFor(fake);
    const seen: ProviderEvent[] = [];
    const handle = (event: ProviderEvent) => (seen.push(event), handleProviderEvent(event, events));
    const paid = await fakeOrder(fake, userId, 'p99');
    const refused = await fakeOrder(fake, userId, 'p49');
    const REAL_ENV = config.env;
    const REAL_DB = config.database.url;
    config.env = 'development';
    config.database.url = TEST_DB_URL!;
    const spy = signedInAs(userId);
    try {
      const pay = (body: object) =>
        walletDevRoutes(wallet, fake, handle).handle(
          new Request('http://localhost/api/wallet/dev/pay', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }),
        );
      expect(await (await pay({ orderId: paid.id })).json()).toMatchObject({ outcome: 'paid', credited: true, balance: 109 });
      expect(await (await pay({ orderId: refused.id, outcome: 'failed' })).json()).toMatchObject({ outcome: 'failed' });
    } finally {
      spy.mockRestore();
      config.env = REAL_ENV;
      config.database.url = REAL_DB;
    }
    expect(seen.map((event) => [event.source, event.eventRef])).toEqual([
      ['webhook', `fake_evt_${paid.providerRef}_succeeded`],
      ['webhook', `fake_evt_${refused.providerRef}_failed`],
    ]);
    expect((await orderRow(refused.id)).status).toBe('failed');
    expect(await wallet.balance(userId)).toBe(109);
  });
});
