import { Elysia } from 'elysia';
import { z } from 'zod';
import { config } from '../config';
import { validateSessionFromRequest } from '../lib/session';
import { isLocalDatabaseUrl } from '../lib/dev-regenerate';
import { BALANCE_CAP, PACKS, PRODUCT_PRICES } from '../lib/pricing';
import { BalanceCapExceeded, InsufficientBalance, wallet as appWallet, type Wallet } from '../lib/wallet';
import {
  CheckoutRequestSchema,
  type CheckoutResponse,
  type OrderStatusResponse,
  type PackId,
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
        const order = await wallet.createOrder(session.userId, parsed.data.packId);
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

/**
 * Dev and test only: add or remove มู on the signed-in user. Mounted from
 * index.ts only outside production, and re-checked here per request in the
 * same order as the dev regenerate routes: production 404, then 403 unless
 * DATABASE_URL is this machine (the local .env.local is the production
 * database), then session 401, then body 400.
 */
export function walletDevRoutes(wallet: Wallet = appWallet) {
  return new Elysia({ prefix: '/api/wallet/dev' }).post('/grant', async ({ request, body, set }) => {
    if (config.env === 'production') return new Response('Not found', { status: 404 });
    if (!isLocalDatabaseUrl(config.database.url)) {
      set.status = 403;
      return { error: 'Refused: DATABASE_URL is not a local database' };
    }
    const session = await validateSessionFromRequest(request);
    if (!session) {
      set.status = 401;
      return { error: 'Not authenticated' };
    }
    const parsed = DevGrantSchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return { error: 'Invalid request', detail: parsed.error.message };
    }
    try {
      return await wallet.adjust(session.userId, parsed.data.delta, `dev: ${parsed.data.note}`);
    } catch (error) {
      if (error instanceof BalanceCapExceeded || error instanceof InsufficientBalance) {
        set.status = 409;
        return { error: error.message };
      }
      throw error;
    }
  });
}
