import { Elysia } from 'elysia';
import { z } from 'zod';
import { config } from '../config';
import { validateSessionFromRequest } from '../lib/session';
import { isLocalDatabaseUrl } from '../lib/dev-regenerate';
import { BALANCE_CAP, PACKS, PRODUCT_PRICES } from '../lib/pricing';
import { BalanceCapExceeded, InsufficientBalance, wallet as appWallet, type Wallet } from '../lib/wallet';
import { fulfilPaidOrder } from '../lib/order-fulfilment';
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
 * Payment is not wired yet: checkout records a pending order and says so.
 */

type Order = NonNullable<Awaited<ReturnType<Wallet['getOrder']>>>;

/**
 * Seam for the PromptPay charge (monetization T5): creates the provider charge
 * for a pending order and returns what the client needs to pay. Until the
 * provider exists there is nothing to start.
 */
async function startPayment(_order: Order): Promise<Pick<CheckoutResponse, 'payment' | 'message'>> {
  return { payment: 'unavailable', message: 'ยังเติมมูไม่ได้ตอนนี้ ระบบจ่ายเงินด้วย PromptPay กำลังจะเปิด' };
}

const HistoryQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  kind: z.enum(Object.keys(HISTORY_KINDS) as [HistoryKind, ...HistoryKind[]]).optional(),
});

export function walletRoutes(wallet: Wallet = appWallet) {
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
        packs: Object.values(PACKS),
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
        const order = await wallet.createOrder(session.userId, parsed.data.packId, parsed.data.unlockRef);
        return { orderId: order.id, status: 'pending', ...(await startPayment(order)) } satisfies CheckoutResponse;
      } catch (error) {
        if (error instanceof BalanceCapExceeded) {
          set.status = 409;
          return { error: 'balance_cap', balance: error.balance, cap: error.cap };
        }
        throw error;
      }
    })
    .get('/orders/:id', async ({ request, params, set }) => {
      const session = await validateSessionFromRequest(request);
      if (!session) {
        set.status = 401;
        return { error: 'Not authenticated' };
      }
      if (!z.string().uuid().safeParse(params.id).success) {
        set.status = 404;
        return { error: 'Order not found' };
      }
      const order = await wallet.getOrder(session.userId, params.id);
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
      } satisfies OrderStatusResponse;
    });
}

const DevGrantSchema = z.object({
  delta: z.number().int().refine((delta) => delta !== 0, 'delta must not be 0'),
  note: z.string().min(1).max(200),
});

const DevPaySchema = z.object({ orderId: z.string().uuid() });

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
 * - pay: stand-in for the T5 webhook. Marks the user's pending order paid and
 *   fulfils it, so the one-flow purchase (credit, then unlock unlock_ref) runs
 *   end to end before a payment provider exists.
 */
export function walletDevRoutes(wallet: Wallet = appWallet, fulfil = fulfilPaidOrder) {
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
      const order = await wallet.getOrder(guard.userId, guard.input.orderId);
      if (!order) {
        set.status = 404;
        return { error: 'Order not found' };
      }
      await wallet.markPaid(order.id);
      try {
        return await fulfil(order.id, { type: 'dev', label: `dev: pay ${order.id}` });
      } catch (error) {
        if (error instanceof BalanceCapExceeded) {
          set.status = 409;
          return { error: error.message };
        }
        throw error;
      }
    });
}
