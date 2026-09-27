---
type: SPEC
status: active — ledger, wallet routes and the ดวงคู่ spend built on feat/monetization-prep, not merged; payment (Stripe PromptPay) not built (2026-09-27)
scope: มู currency: pricing, orders, the append-only ledger, spend/refund/credit rules, wallet routes
last_reviewed: 2026-09-27
owner: backend
decision_log: ~/product-decisions/horo/2026-09-27-monetize.md ("Credit-model run")
---

# มู wallet

Horo sells one-time unlocks in one closed-loop unit, **มู**, pegged **1 มู = ฿1** and always shown with
the baht beside it. When this doc and the code disagree, the code wins; fix this doc in the same commit.

**Name.** The owner renamed the unit from ละอองดาว to มู on 2026-09-27. The code uses neutral names (`wallet_ledger`,
`units_base`, `insufficient_balance`), so a future rename touches copy only. In copy, มู stands after a number
("49 มู (฿49)") or in "เติมมู". Elsewhere, write ยอด, so มู never reads as the verb. The copy lives in
`horo-fe/src/features/wallet/wallet-copy.ts`.

| Where | What |
|---|---|
| `src/lib/pricing.ts` | The only place prices live: products, packs, welcome gift, cap, bonus TTL |
| `lib/db/schema/wallet.ts` | `orders`, `wallet_ledger` and their indexes (additive) |
| `src/lib/wallet.ts` | `createWallet(db)`: balance, welcome, spend, refund, orders, credit, adjust, ledger |
| `src/lib/entitlements.ts` | `assertCanUnlock`: the ดวงคู่ unlock seam that spends |
| `src/routes/wallet.ts` | `/api/wallet` routes and the dev-only grant |
| `lib/shared/types/wallet.ts` | IDs and response shapes shared with horo-fe (`bun run sync:types`) |
| `tests/wallet.test.ts` | Pricing, 402 mapping, dev-grant guards; the ledger block needs a local Postgres |

## Prices and rules

- Products (มู, VAT-inclusive): `compat_unlock` 49, `month_pass` 29, `year_reading` 99, `wallpaper` 39.
  Only `compat_unlock` is spendable (`SpendableProductId`).
- Packs: `p49` ฿49 → 49 · `p99` ฿99 → 99 + 10 bonus · `p199` ฿199 → 199 + 30 bonus.
- Welcome gift: 49 once per account, on the first wallet touch (`GET /api/wallet` or an unlock).
- Closed loop: never cashed out, never transferred between users, never spent outside Horo. Balance cap 2,000.
- Base units never expire. Bonus rows carry `expires_at` = purchase + 180 days.

## Ledger invariants

`wallet_ledger` is append-only: the app never updates or deletes a row. Balance = `SUM(delta)`. A correction is a
new row.

Every write that depends on the balance runs in one transaction holding
`pg_advisory_xact_lock(hashtext(user_id))`, re-reads the balance, and only then inserts. So concurrent calls for one
user are serialized, and the balance never goes below 0 or above the cap.

Partial unique indexes back the idempotency, independent of the lock:

| Index | Guarantees |
|---|---|
| `(order_id, kind) WHERE kind in ('purchase','bonus')` | a replayed webhook can't credit an order twice |
| `(user_id) WHERE kind = 'welcome'` | one welcome gift per account, ever |
| `(user_id, product_id, ref_id) WHERE kind = 'spend'` | one charge per thing (e.g. per compatibility row) |
| `(user_id, product_id, ref_id) WHERE kind = 'refund' AND ref_id IS NOT NULL` | at most one refund per spend |

## Operations

- `spend(user, product, refId)`: charges once per (user, product, refId). A repeat call returns `charged: false` and
  costs nothing. Below the price it throws `InsufficientBalance { balance, price }`.
- `refundSpend(user, product, refId, note)`: a `+price` row of kind `refund`, at most once. **Refund is terminal:** a
  later `spend` on that thing throws `SpendRefunded`. The spend index allows one spend per thing, and treating a refunded
  spend as paid would give a free unlock with the credit back.
- `createOrder(user, packId)`: a `pending` order (`provider = 'stripe'`). Throws `BalanceCapExceeded` if the pack would
  pass the cap.
- `creditOrder(orderId)`: only for `status = 'paid'` (else `OrderNotPaid`). Writes a `purchase` row, plus a `bonus` row
  with `expires_at` when the pack has bonus. Idempotent. A credit past the cap throws `BalanceCapExceeded`. The order
  is paid, so it then needs a manual refund (T13).
- `adjust(user, delta, note)`: `admin_adjust`, never below 0 or above the cap.

## The ดวงคู่ unlock

`assertCanUnlock(userId, rowId)`:
1. Lock off, or `COMPAT_UNLOCK_FREE=1` (dev): ok, with no wallet access.
2. Otherwise `ensureWelcome`, then `spend(userId, 'compat_unlock', rowId)`.
3. `InsufficientBalance` becomes `{ ok: false, body: { error: INSUFFICIENT_BALANCE, balance, price } }`, which the unlock route sends as the 402 body. Any other error is
   thrown.

The unlock route charges **before** it generates the detail (`src/systems/compatibility/reading.ts`). A failed
generation does not refund. The spend is keyed to the row, so a retry is never charged a second time. That covers a
transient failure. A failure that repeats on every attempt leaves the user paid with no report. Example: a partner
name with digits ("มูหนึ่ง2242") failed the detail's number check on every retry, 2026-09-27. That case needs a manual
`refundSpend` (T13). The long-term
fix is to insert the spend in the same transaction as the detail patch, after generation.

## Routes

All routes need a session.

| Route | Returns |
|---|---|
| `GET /api/wallet` | grants the welcome gift, then `{ balance, cap, packs, prices, ledger }` (the newest 20 rows) |
| `POST /api/wallet/checkout { packId }` | `{ orderId, status: 'pending', payment: 'unavailable', message }`; 409 `balance_cap` |
| `GET /api/wallet/orders/:id` | the owner's order status; 404 otherwise |
| `POST /api/wallet/dev/grant { delta, note }` | dev only; see below |

`POST /api/wallet/checkout` is a seam: `startPayment(order)` in `src/routes/wallet.ts` returns `unavailable` until T5.

`POST /api/wallet/dev/grant` is mounted only outside production. Each request checks, in order:
1. production → 404;
2. a non-local `DATABASE_URL` → 403;
3. no session → 401;
4. an invalid body → 400.

It writes an `admin_adjust` row noted `dev: …`.

## Deferred

- **Stripe PromptPay (T5):** the charge in `startPayment`, the webhook that marks an order `paid` and calls
  `creditOrder` in the same transaction, and order expiry.
- **Bonus expiry (later ticket):** `expires_at` is stored but not enforced. No `expire` rows are written, and the balance
  counts bonus rows past expiry. When it lands, spend bonus first (decision log).
- **Admin page (T13):** grants, refunds and outstanding balance in horo-admin. Refund UX for a refunded spend
  (`SpendRefunded`).
- **Legal:** confirmation of the single-purpose e-money bucket is a launch gate.

## Testing

```bash
bun test                                   # no DB: the ledger block is skipped
WALLET_TEST_DATABASE_URL="postgresql://dev:$(docker exec local-postgres printenv POSTGRES_PASSWORD)@localhost:5432/horo_dev" \
  bun test tests/wallet.test.ts            # needs the schema pushed to that local DB
```

The ledger block refuses any database that is not on this machine. It warms the connection pool first, so concurrent
calls really overlap. With a cold pool, a missing lock goes unnoticed.
