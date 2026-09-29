import { Elysia } from 'elysia';
import { z } from 'zod';
import { config } from '../config';
import { validateSessionFromRequest } from '../lib/session';
import { isLocalDatabaseUrl } from '../lib/dev-regenerate';
import { BALANCE_CAP, PACKS, PRODUCT_PRICES, bonusPercent } from '../lib/pricing';
import { BalanceCapExceeded, InsufficientBalance, wallet as appWallet, type Wallet } from '../lib/wallet';
import { checkRateLimit, RATE_LIMITS } from '../lib/rate-limit';
import { paymentGateway } from '../lib/payments';
import type { PaymentGateway } from '../lib/payments/gateway';
import type { FakeGateway } from '../lib/payments/fake';
import { handleProviderEvent } from '../lib/payments/events';
import { refreshOrder, startCheckout } from '../lib/payments/checkout';
import {
  CheckoutRequestSchema,
  HISTORY_KINDS,
  type CheckoutResponse,
  type HistoryKind,
  type OrderStatusResponse,
  type PackId,
  type WalletHistoryResponse,
  type WalletResponse,
} from '../../lib/shared/types/wallet';

/**
 * มู wallet routes (docs/wallet.md). Session required on every route.
 * Checkout starts a PromptPay charge through the payment gateway
 * (src/lib/payments); only the provider changes an order's state.
 */

const HistoryQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  kind: z.enum(Object.keys(HISTORY_KINDS) as [HistoryKind, ...HistoryKind[]]).optional(),
});

export function walletRoutes(wallet: Wallet = appWallet, gateway: PaymentGateway = paymentGateway, handle = handleProviderEvent) {
  return new Elysia({ prefix: '/api/wallet' })
    .get('/', async ({ request, set }) => {
      // Nothing is sellable while ดวงคู่ locked mode is off: no wallet, no welcome gift.
      if (!config.compat.lockEnabled) return { enabled: false } satisfies WalletResponse;
      const session = await validateSessionFromRequest(request);
      if (!session) {
        set.status = 401;
        return { error: 'Not authenticated' };
      }
      // The first wallet touch grants the welcome gift, so the balance shown is the one an unlock will see.
      await wallet.ensureWelcome(session.userId);
      const [balance, ledger] = await Promise.all([wallet.balance(session.userId), wallet.ledger(session.userId, 20)]);
      return {
        enabled: true,
        balance,
        cap: BALANCE_CAP,
        packs: Object.values(PACKS).map((pack) => ({ ...pack, bonusPercent: bonusPercent(pack) })),
        prices: PRODUCT_PRICES,
        ledger,
      } satisfies WalletResponse;
    })
    .get('/history', async ({ request, query, set }) => {
      if (!config.compat.lockEnabled) {
        set.status = 404;
        return { error: 'Wallet not enabled' };
      }
      const session = await validateSessionFromRequest(request);
      if (!session) {
        set.status = 401;
        return { error: 'Not authenticated' };
      }
      // `?cursor=` (an empty param) means absent, so a client can always send all three.
      const present = Object.fromEntries(Object.entries(query).filter(([, value]) => value !== ''));
      const parsed = HistoryQuerySchema.safeParse(present);
      if (!parsed.success) {
        set.status = 400;
        return { error: 'Invalid request', detail: parsed.error.message };
      }
      // The user comes only from the session, never from the query.
      return (await wallet.history(session.userId, parsed.data)) satisfies WalletHistoryResponse;
    })
    .post('/checkout', async ({ request, body, set }) => {
      if (!config.compat.lockEnabled) {
        set.status = 404;
        return { error: 'Wallet not enabled' };
      }
      const session = await validateSessionFromRequest(request);
      if (!session) {
        set.status = 401;
        return { error: 'Not authenticated' };
      }
      const parsed = CheckoutRequestSchema.safeParse(body);
      if (!parsed.success) {
        set.status = 400;
        return { error: 'Invalid request', detail: parsed.error.message };
      }
      try {
        const order = await startCheckout(
          { userId: session.userId, email: session.email, packId: parsed.data.packId, unlockRef: parsed.data.unlockRef },
          { wallet, gateway },
        );
        return {
          orderId: order.id,
          status: 'pending',
          payment: 'qr',
          qr: { data: order.qrData!, pngUrl: order.qrPngUrl },
          expiresAt: order.expiresAt!.toISOString(),
          amountBaht: order.amountSatang / 100,
        } satisfies CheckoutResponse;
      } catch (error) {
        if (error instanceof BalanceCapExceeded) {
          set.status = 409;
          return { error: 'balance_cap', balance: error.balance, cap: error.cap };
        }
        throw error;
      }
    })
    .get('/orders/:id', async ({ request, params, query, set }) => {
      const session = await validateSessionFromRequest(request);
      if (!session) {
        set.status = 401;
        return { error: 'Not authenticated' };
      }
      if (!z.string().uuid().safeParse(params.id).success) {
        set.status = 404;
        return { error: 'Order not found' };
      }
      // `?verify=1` asks the provider now (a missed webhook); at most once per 5 s per user.
      const verify = query.verify === '1';
      if (verify) {
        const limit = await checkRateLimit(session.userId, RATE_LIMITS.orderVerify);
        if (limit.limited) {
          set.status = 429;
          return { error: 'Too many requests', retryAfter: Math.ceil((limit.resetAt - Date.now()) / 1000) };
        }
      }
      const order = await refreshOrder(session.userId, params.id, { verify }, { wallet, gateway, handle });
      if (!order) {
        set.status = 404;
        return { error: 'Order not found' };
      }
      return {
        orderId: order.id,
        packId: order.packId as PackId,
        status: order.status as OrderStatusResponse['status'],
        amountSatang: order.amountSatang,
        units: order.unitsBase + order.unitsBonus,
        createdAt: order.createdAt.toISOString(),
        paidAt: order.paidAt?.toISOString() ?? null,
        expiresAt: order.expiresAt?.toISOString() ?? null,
        balance: await wallet.balance(session.userId),
      } satisfies OrderStatusResponse;
    });
}

const DevGrantSchema = z.object({
  delta: z.number().int().refine((delta) => delta !== 0, 'delta must not be 0'),
  note: z.string().min(1).max(200),
});

const DevPaySchema = z.object({
  orderId: z.string().uuid(),
  outcome: z.enum(['succeeded', 'failed']).optional(), // default: succeeded
});

type Set = { status?: number | string };

/**
 * The dev guards, in the same order as the dev regenerate routes: production
 * 404, then 403 unless DATABASE_URL is this machine (the local .env.local is
 * the production database), then session 401, then body 400. Returns the
 * refusal to send, or the user and the parsed body.
 */
async function devGuard<T>(schema: z.ZodType<T>, request: Request, body: unknown, set: Set) {
  if (config.env === 'production') return { refusal: new Response('Not found', { status: 404 }) };
  if (!isLocalDatabaseUrl(config.database.url)) {
    set.status = 403;
    return { refusal: { error: 'Refused: DATABASE_URL is not a local database' } };
  }
  const session = await validateSessionFromRequest(request);
  if (!session) {
    set.status = 401;
    return { refusal: { error: 'Not authenticated' } };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    set.status = 400;
    return { refusal: { error: 'Invalid request', detail: parsed.error.message } };
  }
  return { userId: session.userId, input: parsed.data };
}

/**
 * Dev and test only, mounted from index.ts only outside production and
 * re-checked per request (devGuard).
 * - grant: add or remove มู on the signed-in user.
 * - pay: the customer paying (or failing to) on the fake provider. It settles
 *   the fake charge, then sends the provider's event through
 *   handleProviderEvent, the path the real webhook takes: record, transition,
 *   credit, unlock unlock_ref.
 */
export function walletDevRoutes(wallet: Wallet = appWallet, gateway: PaymentGateway = paymentGateway, handle = handleProviderEvent) {
  return new Elysia({ prefix: '/api/wallet/dev' })
    .post('/grant', async ({ request, body, set }) => {
      const guard = await devGuard(DevGrantSchema, request, body, set);
      if ('refusal' in guard) return guard.refusal;
      try {
        const note = `dev: ${guard.input.note}`;
        return await wallet.adjust(guard.userId, guard.input.delta, note, { type: 'dev', label: note });
      } catch (error) {
        if (error instanceof BalanceCapExceeded || error instanceof InsufficientBalance) {
          set.status = 409;
          return { error: error.message };
        }
        throw error;
      }
    })
    .post('/pay', async ({ request, body, set }) => {
      const guard = await devGuard(DevPaySchema, request, body, set);
      if ('refusal' in guard) return guard.refusal;
      if (gateway.provider !== 'fake') {
        set.status = 409;
        return { error: `dev pay needs PAYMENT_PROVIDER=fake, not ${gateway.provider}` };
      }
      const order = await wallet.getOrder(guard.userId, guard.input.orderId);
      if (!order) {
        set.status = 404;
        return { error: 'Order not found' };
      }
      if (order.provider !== 'fake' || !order.providerRef) {
        set.status = 409;
        return { error: 'Order has no fake charge' };
      }
      const { eventRef, state } = (gateway as FakeGateway).simulate(order.providerRef, guard.input.outcome ?? 'succeeded');
      return handle({ provider: 'fake', eventRef, providerRef: order.providerRef, state, source: 'webhook' });
    });
}
