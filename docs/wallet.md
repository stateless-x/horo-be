---
type: SPEC
status: active — ledger, wallet routes and the ดวงคู่ spend built on feat/monetization-prep, not merged; ledger actors and the history route built, product passes, the history page and admin writes planned (2026-09-29); payment seam with a fake provider, order state machine, payment_events and the ฿399 pack built, the Stripe adapter not built (I2, 2026-09-29)
scope: มู currency: pricing, orders and payments, the append-only ledger, spend/refund/credit rules, wallet routes
last_reviewed: 2026-09-29
owner: backend
decision_log: ~/product-decisions/horo/2026-09-27-monetize.md ("Credit-model run"); product passes: ~/product-decisions/horo/2026-09-29-monetize.md
---

# มู wallet

Horo sells one-time unlocks in one closed-loop unit, **มู**, pegged **1 มู = ฿1** and always shown with
the baht beside it. When this doc and the code disagree, the code wins; fix this doc in the same commit.

**Name.** The owner renamed the unit from ละอองดาว to มู on 2026-09-27. The code uses neutral names (`wallet_ledger`,
`units_base`, `insufficient_balance`), so a future rename touches copy only. In copy, มู stands after a number
("49 มู (฿49)") or in "เติมมู". Elsewhere, write ยอด, so มู never reads as the verb. The copy lives in
`horo-fe/src/features/wallet/wallet-copy.ts`.

**Code name `moo`** (owner decision 2026-09-29). New identifiers, files and docs name the unit `moo` (`amountMoo`,
`MooPack`). Existing names (`units_base`, `wallet`) stay until something else touches them. Thai copy stays "มู".

| Where | What |
|---|---|
| `src/lib/pricing.ts` | The only place prices live: products, packs, welcome gift, cap, bonus TTL |
| `lib/db/schema/wallet.ts` | `orders`, `wallet_ledger`, `payment_events` and their indexes (additive) |
| `src/lib/wallet.ts` | `createWallet(db)`: balance, welcome, canAfford, hasPaid, spendWithin/spend, refundSpend, createOrder/getOrder, the order state machine (markPaidWithin/markPaid, markFailedWithin, attachCharge, expireStale, expireSuperseded, markNeedsReviewWithin), creditOrder, adjust, history/ledger (partner names and purchase baht joined); `LedgerActor`, `insertLedger`, `ledgerBy` |
| `src/lib/payments/gateway.ts` | `PaymentGateway`: the provider seam (`startCharge`, `lookupCharge`, `cancelCharge`) |
| `src/lib/payments/index.ts` | `selectGateway`, `paymentGateway`: the one place the adapter is chosen (`PAYMENT_PROVIDER`) |
| `src/lib/payments/fake.ts`, `stripe.ts` | The fake provider (dev, tests; `simulate`) and the Stripe stub (I3) |
| `src/lib/payments/events.ts` | `handleProviderEvent`: every provider notification, recorded then applied |
| `src/lib/payments/checkout.ts` | `startCheckout`, `refreshOrder` (missed-webhook recovery), `expireStaleOrders` |
| `src/lib/entitlements.ts` | `checkUnlock` + `chargeUnlockWithin`: the ดวงคู่ unlock seam, charged with delivery |
| `src/lib/order-fulfilment.ts` | `fulfilPaidOrder`: credit a paid order, then unlock its `unlock_ref` (one-flow purchase) |
| `src/systems/compatibility/unlock.ts` | `dbUnlockStore`, `unlockForUser`: the atomic unlock the route and fulfilment share |
| `src/routes/wallet.ts` | `/api/wallet` routes and the dev-only grant and pay |
| `lib/shared/types/wallet.ts` | IDs and response shapes shared with horo-fe (`bun run sync:types`) |
| `tests/wallet.test.ts` | Pricing, 402 mapping, dev-grant and history guards, actor mapping, disabled routes, gateway selection, the fake; the ledger block (actors, adjust refusals, history paging, the order state machine, payment_events, recovery, checkout, dev pay) needs a local Postgres |
| `tests/compatibility-v4.test.ts` | The unlock route order; the one-flow purchase on a local Postgres |

**Contents.**
- Built: Prices and rules · Ledger invariants (with actors) · Operations · The ดวงคู่ unlock · One-flow purchase · Payments · Routes.
- Planned: Product passes (T15) · The rest of the audit trail: history page, admin views, admin writes (T16).
- Deferred · Testing.

## Prices and rules

- Products (มู, VAT-inclusive): `compat_unlock` 49, `month_pass` 29, `year_reading` 99, `wallpaper` 39.
  Only `compat_unlock` is spendable (`SpendableProductId`).
- Packs (`PACKS`; the chip shows `bonusPercent` = ⌊bonus ÷ base × 100⌋):

  | Pack | Price | Base | Bonus | Credited | Chip |
  |---|---|---|---|---|---|
  | `p49` | ฿49 | 49 | 0 | 49 | none |
  | `p99` | ฿99 | 99 | 10 | 109 | 10% |
  | `p199` | ฿199 | 199 | 30 | 229 | 15% |
  | `p399` | ฿399 | 399 | 80 | 479 | 20% |
- Welcome gift: 49 once per account, on the first wallet touch while ดวงคู่ locked mode is on (`GET /api/wallet` or an
  unlock). **Not sellable, not shown:** with the lock off there is no gift, `GET /api/wallet` returns
  `{ enabled: false }`, and the frontend shows no wallet (owner decision, 2026-09-27). One flag gates both:
  `COMPAT_LOCK_ENABLED`.
- Closed loop: never cashed out, never transferred between users, never spent outside Horo. Balance cap 2,000.
- Base units never expire. Bonus rows carry `expires_at` = purchase + 180 days.

## Ledger invariants

`wallet_ledger` is append-only: the app never updates or deletes a row. Balance = `SUM(delta)`. A correction is a
new row.

**Every row records who caused it** (owner request 2026-09-29):

```
actor_type   varchar(8) not null  'user' | 'system' | 'admin' | 'dev'   (ACTOR_TYPES)
actor_id     text                 user.id for 'user'; admin."user".id for 'admin'; null for 'system'/'dev'
actor_label  text                 snapshot at write time: the admin's email, 'stripe:<event id>', or 'dev: …'
```

- Every insert goes through `insertLedger(writer, rows, actor: LedgerActor)` in `src/lib/wallet.ts`, and the
  `not null` column makes a raw insert without an actor a type error too.
- **No foreign key to `admin."user"`.** horo-be doesn't own that schema, and `drizzle-kit push` here must never touch
  it. `actor_label` keeps the email readable even if the admin is later removed or renamed.
- Users never see `actor_id` or `actor_label`. `LedgerEntry.by` is all they get: `user` → `you`, `system` and `dev` →
  `horo`, `admin` → `team` (`ledgerBy`).
- **Rollout.** `wallet_ledger` has never been pushed to production, so the column went in as `not null` before merge.
  Local rows were backfilled from their kind: `admin_adjust` noted `dev…` → `dev` (label = note), `spend` → `user`
  (id = user_id), everything else → `system`. After production has rows, any further column must be nullable or have
  a default. See CLAUDE.md, destructive changes.

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

Actor per operation: `ensureWelcome` → `system`; `spendWithin`/`spend` → the spending user; the rest take the actor
from their caller.

- `spendWithin(tx, user, product, refId)`: charges once per (user, product, refId) inside the caller's transaction,
  under the advisory lock. A repeat call returns `charged: false` and costs nothing. Below the price it throws
  `InsufficientBalance { balance, price }`. `spend(...)` is the same in a transaction of its own.
- `canAfford(user, price)`: a read-only pre-check with no lock. `spendWithin` re-checks under the lock.
- `refundSpend(user, product, refId, note, actor)`: `actor` is `system` (automatic) or `admin` (T13). A `+price` row of kind `refund`, at most once. **Refund is terminal:** a
  later `spend` on that thing throws `SpendRefunded`. The spend index allows one spend per thing, and treating a refunded
  spend as paid would give a free unlock with the credit back.
- `createOrder(user, packId, unlockRef?)`: a `pending` order. Throws `BalanceCapExceeded` if the pack would pass the
  cap. `attachCharge` then sets `provider` to the gateway's and stores the charge (Payments).
- `creditOrder(orderId, actor)`: the purchase and bonus rows carry `actor`, whoever confirmed the payment:
  `{ type: 'system', label: '<provider>:<event id>' }` from a webhook, `'<provider>:<providerRef>'` from a lookup
  (Payments). Only for `status = 'paid'` (else `OrderNotPaid`). Writes a `purchase` row, plus a `bonus` row
  with `expires_at` when the pack has bonus. Idempotent. A credit past the cap throws `BalanceCapExceeded`;
  `handleProviderEvent` then flags the paid order `needs_review` for the admin page.
- `adjust(user, delta, note, actor)`: `admin_adjust`, never below 0 or above the cap. Throws `InvalidAdjustment`
  when `note` (the reason) is empty after trim or the actor is not `admin` or `dev`.
- `history(user, { limit, cursor?, kind? })`: one page, newest first, keyset on `(created_at, id)`. `cursor` is the
  last row's id; SQL reads that row's `created_at`, so rows sharing a microsecond are never skipped, and another
  user's id matches nothing. Purchase rows carry `amountBaht` from their order. `ledger(user, limit)` is its first page.

## The ดวงคู่ unlock

The unlock pays atomically with delivery. The seam is in `src/lib/entitlements.ts`:

1. **`checkUnlock(userId, rowId)`**, before generating.
   - Lock off, or `COMPAT_UNLOCK_FREE=1` (dev): ok, with no wallet access.
   - Row already paid for (`hasPaid`): ok, see below.
   - Otherwise it runs `ensureWelcome`, then `canAfford(userId, 49)`. This is a read-only pre-check and takes no lock.
   - Short → `{ ok: false, body: { error: INSUFFICIENT_BALANCE, balance, price } }`, sent as the 402 body.
2. **Generate the detail.** A failure here costs nothing, because nothing has been charged.
3. **One transaction: `chargeUnlockWithin(tx, userId, rowId)` + patch the detail.**
   - `chargeUnlockWithin` calls `wallet.spendWithin(tx, …)`. That takes the per-user advisory lock inside the caller's
     transaction, re-checks the balance, and charges once per row.
   - If the balance dropped since step 1, it returns the same 402 body, and the caller rolls back instead of saving.
   - If the patch fails, the charge rolls back with it. `tests/wallet.test.ts` covers this rollback.

**The route follows this order** (`unlockReading` in `src/systems/compatibility/reading.ts`, 2026-09-27). A failed generation charges nothing. A spend made elsewhere during generation turns the charge into a 402, and the detail is discarded. `assertCanUnlock` is deleted.

**A row already paid for** skips the balance pre-check. `checkUnlock` asks `wallet.hasPaid(user, 'compat_unlock', rowId)` first. This covers a row devtools relocked after it was paid, and a retry after a failed patch. The charge then finds the existing spend and costs nothing.

## One-flow purchase

When the balance is short of the price, the door does not ask for a top-up and then a second tap:
1. The primary button reads "เปิดคำตอบทั้งหมด · 49 มู (฿49)" (`unlockLabel`, `horo-fe/src/features/compatibility/report/report-door.tsx`, checked 2026-09-29). A baht-first label ("… · ฿49") for users short of the price is proposed but not decided (decision log 2026-09-29). It posts `POST /api/wallet/checkout { packId, unlockRef: rowId }`, using the
   cheapest pack that covers the shortfall (`smallestPackCovering`, `horo-fe/src/features/wallet/wallet-copy.ts`).
2. The order stores `unlock_ref`, an additive column on `orders`.
3. Once paid, `fulfilPaidOrder(orderId, actor)` runs `creditOrder`, then `unlockForUser(order.user, unlock_ref)`. That is the
   same atomic unlock the route runs, owner-only and charged once per row. `fulfilPaidOrder(orderId, actor)` passes
   the actor to `creditOrder`.
4. A replayed webhook credits nothing and charges nothing. The row is already unlocked.

"ซื้อแพ็กคุ้มกว่า" under the button opens the pack sheet. At or above the price the door still spends:
"ใช้ 49 มู ปลดล็อก (มี N มู)".

The checkout answers with a QR (Payments). `fulfilPaidOrder` runs only from `handleProviderEvent`. To try the flow
locally, pay the fake charge with `POST /api/wallet/dev/pay { orderId }`.

## Payments

**State changes come from the provider: its webhook, or Horo asking it (`lookupCharge`). A client never changes
state; `?verify=1` only triggers the ask.**

### The gateway seam

`PaymentGateway` (`src/lib/payments/gateway.ts`) is all Horo knows of a provider:
- `startCharge(order, { email })` → `{ providerRef, qr: { data, imagePngUrl, imageSvgUrl }, expiresAt }`. Idempotent
  per order: the order id is the provider's idempotency key.
- `lookupCharge(providerRef)` → `{ status: pending | succeeded | failed | canceled, amountSatang, currency }`, the
  currency in ISO upper case.
- `cancelCharge(providerRef)`: idempotent; canceling a canceled charge is a no-op. A charge that already succeeded
  can't be canceled, so the adapter throws and the webhook pays it.

`selectGateway` (`src/lib/payments/index.ts`) picks the adapter from `PAYMENT_PROVIDER` = `fake` | `stripe`. The default
is `fake` outside production and `stripe` in production, where `fake` throws. `src/index.ts` imports it first, so a
production deploy with `fake` never starts. The Stripe adapter is a stub that throws "not implemented (I3)". I3 adds
that one adapter file plus a webhook route that calls `handleProviderEvent` and nothing else.

The fake (`fake.ts`) keeps charges in memory: `providerRef` is `fake_<orderId>`, the QR data `fake:<orderId>`.
`simulate(providerRef, 'succeeded' | 'failed')` settles a charge and returns the webhook event
(`fake_evt_<providerRef>_<outcome>`). It accepts a canceled charge too, which models a payment that landed just before
the cancel. A restart empties the map. Canceling an unknown charge is then a no-op, but looking it up throws.

**QR TTL.** `QR_TTL_MINUTES = 15` (`src/lib/pricing.ts`). The adapter sets `expiresAt` = start + 15 min. It is Horo's
own timer, because Stripe's PromptPay QR has no expiry of its own. A scan after it still pays (below).

**Customer text.** `describeOrder(order)` in `src/lib/pricing.ts` gives "Horo เติม ฿99 (109 มู)" for the provider's
payment description (I3).

### Order states

`pending` → `failed` | `expired` | `paid`; `failed` → `paid`; `expired` → `paid`. `paid` and `refunded` are terminal.

Each transition runs in one transaction with the order row locked (`SELECT … FOR UPDATE`).
- **→ paid** (`markPaidWithin`) from `pending`, `failed` or `expired`, once the provider confirms the amount. A late
  scan after Horo's timer, or a success after a failure, must still credit. From `paid` it is a no-op
  (`{ marked: false }`). From `refunded` it throws `IllegalOrderTransition`.
- **pending → failed** (`markFailedWithin`) on a failed or canceled charge. Other states are left alone. A failure
  never touches a paid order.
- **pending → expired** (`expireStale`, `expireSuperseded`): only `pending` rows are selected, so a paid order never
  expires. The charge is canceled first, inside the transaction. A webhook for that order waits on the row lock, then
  finds `expired`, which may still be paid.

Expiry is lazy. There is no cron: `GET /api/wallet/orders/:id` expires that one order when it is past `expires_at`.
`expireStaleOrders(now)` (`checkout.ts`) does the same for every stale order, for a future sweep.

**A new QR for the same row.** A checkout with an `unlockRef` first expires the user's pending orders for that row,
canceling each charge. A late payment on the old order still credits its pack.

### payment_events

Every provider notification is recorded before it changes anything:

```
payment_events  id uuid pk · provider varchar(16) · event_ref text · order_id uuid → orders (null: no match)
                kind varchar(32) · payload jsonb · payload_hash text (sha256) · received_at
                unique (provider, event_ref)
```

`handleProviderEvent({ provider, eventRef, providerRef, state, source })` (`events.ts`):
1. Finds the order by (provider, provider_ref). With no match it records `unknown_order` and stops.
2. Checks a succeeded charge against the order. Another currency, or less than `amount_satang`, records
   `amount_mismatch` and throws `PaymentAmountMismatch`, and nothing is credited. More records `excess_payment` (the
   payload holds both amounts), pays the order and credits the pack only. The excess is left for an admin (I2b). The
   webhook never calls `adjust`. Excess rows are per event, so credit the excess per `order_id`, not per row.
3. One transaction: lock the order, insert the event, apply the transition. A duplicate (provider, event_ref)
   inserts nothing and changes no order: this is the webhook idempotency guarantee. `IllegalOrderTransition` rolls
   the transaction back, records `illegal_transition` (event ref `<eventRef>:illegal_transition`) and rethrows.
4. After commit, a paid order runs `fulfilPaidOrder` with actor `system`. The label is `<provider>:<eventRef>` from a
   webhook and `<provider>:<providerRef>` from a lookup, which has no event id. This also runs on a duplicate of a
   paid order. Fulfilment is idempotent, so a provider retry after a failed fulfilment finishes it and never credits
   twice.
5. A credit refused by the cap records `credit_failed_cap` (the payload holds balance, credit, cap). The order stays
   `paid`, `orders.needs_review` is set true, and the admin page lists it.

The order row is locked before the insert on purpose. The event's foreign key takes a share lock on the order, and two
events for one order (a webhook and a lookup) would otherwise deadlock on the `FOR UPDATE` that follows.

Reversals (a refund of a paid order) will carry a `corrects` reference to the row they reverse (T17, Accounting and
audit).

### Missed-webhook recovery

`GET /api/wallet/orders/:id` (`refreshOrder`) asks the provider (`lookupCharge`) in two cases:
- the client sends `?verify=1`, and the order is `pending`, `expired` or `failed`;
- the order is `pending` and past `expires_at`. It asks before expiring, so a missed webhook still pays.

A non-pending answer goes through `handleProviderEvent` with event ref `lookup:<providerRef>:<status>` and
`source: 'lookup'`. `?verify=1` is limited to 1 per 5 s per user (`RATE_LIMITS.orderVerify`); a second ask gets 429.

## Routes

All routes need a session.

| Route | Returns |
|---|---|
| `GET /api/wallet` | lock off: `{ enabled: false }` (no session or DB work, no gift). Lock on: grants the welcome gift, then `{ enabled: true, balance, cap, packs, prices, ledger }` (the newest 20 rows; a ดวงคู่ spend or refund carries `refName`, the partner's name, from one left join on `ref_id`, or null once the reading is gone; each row carries `by` and `amountBaht`) |
| `GET /api/wallet/history?cursor=&limit=&kind=` | `{ entries: LedgerEntry[], nextCursor }`, the session user's rows only, newest first. `limit` 1–50 (default 20), `cursor` a row id, `kind` one of `topup` (purchase, bonus), `spend`, `refund`, `adjust` (admin_adjust), `welcome`. 400 on an invalid query, 404 while the lock is off |
| `POST /api/wallet/checkout { packId, unlockRef? }` | `{ orderId, status: 'pending', payment: 'qr', qr: { data, pngUrl }, expiresAt, amountBaht }`; 409 `balance_cap`; 404 while the lock is off. `CheckoutResponse` keeps a `payment: 'unavailable'` variant, which no code path returns today |
| `GET /api/wallet/orders/:id?verify=1` | the owner's order: `{ orderId, packId, status, amountSatang, units, createdAt, paidAt, expiresAt, balance }`, after lazy expiry and recovery (Payments); 429 on a second `verify` within 5 s; 404 when not the owner's |
| `POST /api/wallet/dev/grant { delta, note }` | dev only; see below |
| `POST /api/wallet/dev/pay { orderId, outcome? }` | dev only: settle the fake charge (`outcome` `succeeded`, the default, or `failed`), then run `handleProviderEvent` on its webhook event. 409 unless `PAYMENT_PROVIDER` is `fake` and the order has a fake charge |

Both dev routes are mounted only outside production (`devGuard`). Each request checks, in order:
1. production → 404;
2. a non-local `DATABASE_URL` → 403;
3. no session → 401;
4. an invalid body → 400.

The grant writes an `admin_adjust` row noted `dev: …`, actor `dev` with the same label. The pay route takes the
webhook path, so its credit is actor `system`, label `fake:fake_evt_…`.

## Product passes (planned, not built)

Owner decision 2026-09-29: a promo like "ดวงคู่ 3 คน ราคา 2" is sold as a **product pass**. It is bought with มู and
holds a count of uses for one product. Buying singles never adds up to a pass: three ฿49 unlocks are 147 มู.
Nothing in this section exists in code yet. When it is built, move the rules into the sections above.

**Proposed defaults. The owner has not confirmed these numbers yet.**

| Pass | Product | Uses | Price | Expires |
|---|---|---|---|---|
| `compat_pass_3` | `compat_unlock` | 3 | 98 มู | 180 days after purchase |

Only one pass type per product at a time.

**Scope.** A pass is the one allowed exception to "one unit". It is counted uses of one product, bought with มู only,
never sold for baht directly, never transferable, and never converted back to มู except by the refund below.
`product_passes` (a count of uses) is separate from the planned `entitlements` table (a time scope, month pass and
year reading, T9 and T10). Don't merge them.

### Tables (additive)

```
product_passes  id uuid pk · user_id · pass_id ('compat_pass_3') · product_id ('compat_unlock')
                uses_total int · spend_ledger_id (the −98 spend row) · expires_at · created_at

pass_uses       id uuid pk · pass_row_id → product_passes.id · user_id · product_id · ref_id · created_at
                unique (user_id, product_id, ref_id)
```

- Uses left = `uses_total − count(pass_uses)`. Nothing is ever updated.
- The unique index is on the thing unlocked, not on the pass. So one row can't be opened by two passes.
- Pass prices live in `src/lib/pricing.ts` beside `PRODUCT_PRICES` (e.g. `PASSES`). `ProductId` and
  `SpendableProductId` gain `compat_pass_3`, the product id the buy-pass spend carries.

### Buying a pass

In one transaction under the per-user advisory lock:
1. `spendWithin(tx, user, 'compat_pass_3', passRowId)`.
2. Insert the `product_passes` row.
3. If the buyer is at a locked door, insert the first `pass_uses` row for that row.

The existing spend index already makes the buy idempotent per pass row.

### Unlocking with a pass

Changes to `src/lib/entitlements.ts`:
- **`hasPaid`** also returns true when a `pass_uses` row exists for (user, product, ref). This stops a row opened by a
  pass from later being charged 49 มู, and the reverse.
- **`checkUnlock`** returns ok when the user holds a live pass for the product (not expired, not refunded, uses left).
  It checks this before `canAfford`.
- **`chargeUnlockWithin`**, under the same lock and in the caller's transaction, does this:
  - A live pass exists: insert a `pass_uses` row and charge 0 มู. When several passes are live, take the one that
    expires first.
  - Otherwise: `spendWithin` at the full price, as today.

  A failed generation or patch rolls the use back exactly as it rolls back a spend.

### One-flow purchase of a pass (open design point)

`orders` records `pack_id` and `unlock_ref`. Today `fulfilPaidOrder` always spends the single price on `unlock_ref`.
Buying "ชุด 3 คน" by QR from a short balance needs one more additive column saying what to buy after the credit
(e.g. `buy_product`). It also needs a fulfilment branch: credit the pack, buy the pass, then use it on `unlock_ref`.
This will be decided when the pass is built.

### Refunds (proposed; owner to confirm)

- **Baht orders** (pack purchases) follow T14: a full refund within 7 days, by PromptPay transfer.
- **A pass** is refunded on the มู side, unused uses only:
  - The amount is `floor(price ÷ uses_total) × unused`, so 32 มู per unused ดวงคู่ use.
  - It is written as one `refund` row on (`compat_pass_3`, passRowId). The existing refund index allows exactly one.
  - The refund closes the pass. Rows it already unlocked stay unlocked.
- `refundSpend` can't do this, because it writes the full price. The pass refund needs its own operation.
- Expired passes are not refunded. The expiry date is shown wherever the pass is shown.

### Routes and UI

- **`GET /api/wallet`** gains `passes: [{ id, passId, productId, usesLeft, expiresAt }]`. Pass uses never appear in
  `wallet_ledger`, so the wallet page needs this list. The buy-pass spend does appear in the ledger.
- **The door** offers "เปิดคนนี้ · 49 มู" and "ชุด 3 คน · 98 มู". With a live pass it offers
  "ใช้สิทธิ์ (เหลือ N คน)" instead.

### Keep or kill

If fewer than ~10% of ดวงคู่ purchases are passes after 30 orders, retire the pass and rely on the pack bonus.

## Audit trail: the rest (planned, not built)

Owner request 2026-09-29: every change to a balance must show what happened and who did it. The ledger actor columns,
`adjust`'s note and actor rule, and `GET /api/wallet/history` are built (Ledger invariants, Operations, Routes). Still
planned:

- **`product_passes`** gets the same three actor columns when passes are built. **Pass uses** (`pass_uses`) are always
  done by the user; their actor is `user_id`, already on the row.
- **Manual slip paid by an admin:** `creditOrder` with an `admin` actor, through the internal route below.
- **Orders** keep their status timestamps (`paid_at`, `refunded_at`). The ledger row written when an order is paid or
  refunded carries the actor, so "who marked this paid" is a ledger query, not a new order column.

### History views

- **Every user has two pages of their own** (owner request 2026-09-29), both behind the session and showing only that
  user's rows:
  - **Wallet page, `/dashboard/wallet`** (exists): the balance, live passes with uses left and expiry, the top-up packs,
    and the newest 5 history rows with a "ดูประวัติทั้งหมด" link.
  - **History page, `/dashboard/wallet/history`** (new): the full history, paginated, with a filter for เติมมู / ใช้มู /
    สิทธิ์ / ปรับยอด.
- **User history route:** built for `wallet_ledger` rows (Routes). Still planned: merging `pass_uses` into it once
  passes exist, and a newest-5 preview on `GET /api/wallet` (today it returns 20).
  - The page renders an admin row (`by: 'team'`) as "ปรับยอดโดยทีมงาน" plus the note. It never shows which admin.
- **Admin** (horo-admin, T13):
  - Per user: the same merged history, plus actor type, admin email and the order's provider id.
  - Admin action log: every row with `actor_type = 'admin'`, filterable by admin, date and kind.

### How horo-admin writes (decided 2026-09-29: a private horo-be route)

horo-admin shares the database but doesn't run horo-be code. **The owner chose (a):** every admin wallet write goes
through a private horo-be route, so the per-user advisory lock, the cap and the balance checks stay in one place.
horo-admin never inserts into `wallet_ledger`, `orders` or `product_passes` directly. Reading them for its pages is
fine.

- **Routes** (not mounted on the public API surface, server to server only):
  - `POST /internal/wallet/adjust { userId, delta, note, admin: { id, email } }`
  - `POST /internal/wallet/refund-spend { userId, productId, refId, note, admin }`
  - `POST /internal/wallet/refund-pass { passRowId, note, admin }`
  - `POST /internal/orders/mark-paid { orderId, note, admin }` (manual slip fallback)
- **Auth:** a shared secret header (`INTERNAL_API_SECRET`, in both Railway services), compared in constant time, and
  refused in production when the secret is unset. horo-admin checks the admin's role (`admin` / `super_admin`) before
  calling. horo-be trusts the `admin` block only behind the secret, and writes it as `actor_type = 'admin'`,
  `actor_id`, `actor_label`.
- **Every request needs a non-empty `note`.** Missing it returns 400.

## Accounting and audit (planned, not built)

Owner request 2026-09-29: an accountant must be able to audit moo without reading SQL, and correct mistakes
without editing history. The ledger is the book of record; this section defines the views over it.

### Rules

- **Nothing is edited or deleted.** A mistake is corrected by a new row that reverses it (`admin_adjust`
  with a negative delta, or a `refund`), with the acting admin, a reason, and a `corrects` reference to the row it
  reverses. A corrected row and its correction are shown together.
- **Every baht has a provider reference.** A paid order carries the Stripe PaymentIntent id (`provider_ref`) and the
  event that paid it (`payment_events`). An admin `mark-paid` carries the slip reference in its note.
- **Every moo row has one of four origins**, derived from `kind` and `actor_type`, and the reports always split
  them: `paid` (purchase), `promo` (bonus, welcome), `admin` (admin_adjust), `reversal` (refund, expire, negative
  admin_adjust).
- **Prices are VAT-inclusive.** 1 moo = ฿1 incl. 7% VAT, so VAT on any baht figure is `amount × 7 / 107`, computed
  in the report, never stored.
- **A month is closed by a snapshot**, not by freezing rows: `report_snapshots(month, computed_at, figures json)`.
  Re-running a closed month must reproduce the snapshot; a difference is an audit finding, shown as such.

### The monthly reconciliation

Five figures, each backed by one query, each drillable to rows:

| Figure | Source | Meaning |
|---|---|---|
| Cash in | `orders` paid this month, Σ `amount_satang`, by pack; count of orders and of first orders | must equal Stripe's gross for the same PaymentIntents |
| Moo issued | `wallet_ledger` this month, Σ positive delta split paid / promo / admin | paid issued = cash in, always (one test) |
| Moo spent | Σ negative `spend` delta, by product | usage; the deferred obligation consumed |
| Reversals | refunds, expirations, negative adjustments, by kind and admin | corrections and give-backs |
| Outstanding | Σ delta over all users at month end (= start + issued − spent − reversals) | the moo people still hold |

The identity `outstanding_end = outstanding_start + issued − spent − reversals` is asserted by the report. If it
doesn't hold, the report says so and lists the rows since the last snapshot.

Stripe fees and payout dates are not in Horo's tables; the report shows `provider_ref` per order so the accountant can
match Horo's cash-in against the Stripe payout report. Never copy fees into the ledger.

**Revenue recognition is the accountant's call**, not the app's. The report gives both views: cash basis (packs
paid this month) and usage basis (moo spent this month, paid-origin only). Which one the books use is decided with the
accountant before the first month closes [?].

### Exports and routes (horo-be, internal)

- `GET /internal/reports/monthly?month=YYYY-MM` → the five figures, by pack and product, plus the identity check.
- `GET /internal/reports/ledger.csv?from=&to=&kind=&actor=` → one row per ledger row: created_at, user_id (hashed for
  the accountant's copy, raw for admin), kind, origin, delta, product, ref, order_id, provider_ref, actor_type,
  actor_label, note, corrects. UTF-8 with BOM so Excel opens Thai text.
- `GET /internal/reports/orders.csv?from=&to=` → one row per order with status, amounts, provider_ref, event ids,
  needs_review.
- `POST /internal/reports/close { month, admin, note }` → writes the snapshot; refused if the identity check fails.

All behind `INTERNAL_API_SECRET`; horo-admin renders them and offers the CSV downloads.

### Admin page (horo-admin, T13)

- **Monthly close**: the five figures, identity status, "ปิดเดือน" button, and the diff against the snapshot once
  closed.
- **Needs review**: orders with `needs_review`, `payment_events` of kind `excess_payment`, `credit_failed_cap`,
  `amount_mismatch`, each with a one-click action that goes through an internal route and requires a note.
- **Admin log**: every row with `actor_type = 'admin'`, filterable by admin, kind, date; each shows its correction if
  any.
- **Per-user history**: the user's full ledger with origins and provider refs.

## Deferred

- **Stripe PromptPay (I3):** the adapter in `src/lib/payments/stripe.ts` (PaymentIntent with PromptPay, cancel in
  `requires_action`) and the webhook route that calls `handleProviderEvent`. The unlock inside fulfilment takes up to
  about 20 s of generation. If it fails, the credit stays and the door's own unlock (balance now ≥ price) finishes it.
  Whether the webhook answers first and fulfils in the background is I3's call.
- **Excess payments and cap failures (I2b):** the admin route that credits `excess_payment` and resolves
  `needs_review` orders.
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
