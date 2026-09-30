---
type: DECISION
status: active — synchronous response budget (2026-09-08), v4 live budget and locked mode (2026-09-27)
scope: the compatibility POST and unlock responses: timeouts, the v4 model budget, teaser-first locked mode
last_reviewed: 2026-09-27
owner: backend
supersedes: []
superseded_by: null
---

# Compatibility response and reading voice

## Decision (2026-09-08)

The first compatibility POST generates a reading before sending any response.
Subsequent identical requests can read the saved result. The installed Elysia
Bun adapter defaults to a 30 second idle timeout, while the frontend aborts
POST requests after 45 seconds. Compatibility allows 60 seconds per model call,
two transport retries and one validation repair: up to 243 seconds including
backoff. The earlier limits can close a successful first generation before the
browser receives it.

Options considered:

1. Preserve the synchronous endpoint and align timeout budgets. Small change,
   no client contract or database migration, but holds a connection while waiting.
2. Introduce a persisted job endpoint and polling. Handles proxy limits and
   reconnects better, but needs a new job lifecycle and recovery semantics.

Selected option 1 for the existing compact compatibility response. The server
idle budget is 255 seconds, Bun's maximum finite value. This applies to all
connections through the existing server configuration, including older deployed
Bun versions without a per-request timeout API. The frontend compatibility call
uses 270 seconds, leaving time for the server response and database operations.
Other frontend POST requests keep their existing timeout. No automatic client
retry is added, avoiding duplicate generation or quota consumption.

The request/response schema and saved readings remain compatible. Rollback is
reverting the server configuration and frontend timeout changes together; there
is no data migration. Production proxy behavior and an actual live model call
still need deployment verification.

## Six-category voice

The chart template now specifies short conversational paragraphs, a recognizable
everyday opening and one practical action. Relevant chart details support the
story instead of appearing as a technical inventory in each category. The
structured system prompt follows the same rule. JSON fields, scores and period
rules are unchanged. Existing saved readings retain their original text; the
new instructions apply when a reading is generated next.

## Verification

The HTTP regression opens a real local Elysia server and waits 46 seconds before
returning its first response, crossing both earlier timeout windows. It uses
synthetic content and does not call a model or write production data.
The unchanged server configuration was also reproduced separately: the socket
closed after 32,013 ms while waiting for the same 46 second response. With the
new configuration, `bun run build` passed all 122 tests and bundled the API.

The backend type check has existing Elysia generic and HTTPHeaders errors,
reproduced from the unchanged HEAD in a temporary directory with the same locked
dependencies. No unrelated type repair is included.

## v4 live budget (2026-09-27)

The POST route now writes the content v4 report: one insight-plan call, then
the cover call and three detail calls in parallel (`generateCompatibilityV4Stored`;
the split is `V4_TEASER_SECTIONS` and `V4_DETAIL_SPLIT` in `src/lib/llm.ts`). The old per-call
arithmetic no longer holds. With one repair and two transport retries, a single
validated call can reach 4 × 60 s + 3 s = 243 s, and the plan runs before the
sections, so about 486 s. Capping repairs alone cannot fit that under the
timeouts, so the route passes a deadline (`COMPATIBILITY_V4_LIVE_BUDGET` in
`src/lib/compatibility-generation.ts`). Timeouts are unchanged.

| Rule | Value |
|---|---|
| Repairs per call (plan and each section call) | 1 (the dev tools keep 2) |
| Deadline for every model call | request start (T0) + 220 s |
| Plan call deadline | its start + 75 s, capped by the above |
| Per-call timeout | min(60 s, time left to the deadline) |
| No call or retry starts with less than | 15 s left |

Worst case, by construction:

- **Before the model:** session, cached profile, existing-row check and rate limit. They count against the same T0 deadline, so they take no extra time.
- **Model:** every call is aborted by T0 + 220 s. Retry backoff happens before a call whose timeout is recomputed from the deadline, so it adds nothing.
- **After the model:** assembly, the DB insert and the Redis cache write take under 1 s typically. Allow 5 s.
- **Total:** at most about 225 s. That is under 240 s, the 250 s the single-flight lets a second identical request wait, the 255 s server idle, and the 270 s client timeout.

When the deadline arrives:

- **Rule failure** (schema or a hard pair check): the reading fails with a 500 and the page asks the user to try again. The daily check is already counted; the rate-limit behavior is unchanged.
- **During a quality repair:** the valid reply from before the repair is kept, and its issues are logged as quality flags. A quality flag never fails a reading.

Measured with `scripts/prototype-compat-v3/run.ts --live` (5 fixtures × 2, real DeepSeek, 2026-09-27):
- **Result:** 10/10 passed.
- **Wall time:** 15.6 to 25.1 s, typically about 21 s.
- **Slowest single call:** 12.2 s.

A first run failed 2/10 in the plan call: the plan left a chapter without an insight, and the one repair got back the same plan. The repair message only said "every chapter needs one". The plan schema now names the missing chapter.

The public share link (`GET /compatibility/share/:token`) returns only the free fields for a v4 row: names, elements, score, archetype, verdict and dimension numbers. It never returns `analysis`. v2 share responses are unchanged: they still return the stored reading.

## Locked mode (2026-09-27)

Locked mode writes only the free teaser when the user checks a pair, and writes the paid detail when they unlock it. The model cost of the detail is only spent on unlocks.

| | Flag off (default) | `COMPAT_LOCK_ENABLED=1` |
|---|---|---|
| `POST /api/fortune/compatibility` | plan, then cover ∥ 3 detail calls; stores the detail | plan, then cover; stores `detail: null` |
| Response | `locked: false`, full report | `locked: true`, teaser view |
| `POST /compatibility/:id/unlock` | free (`assertCanUnlock` is ok) | spends 49 มู once per row; 402 `{ error: 'insufficient_balance', balance, price }` below that; free with `COMPAT_UNLOCK_FREE=1` (dev) |

The flags are read once at startup (`config.compat` in `src/config.ts`), and only the exact value `1` turns them on.

**Paid with delivery.** With the lock on, `checkUnlock` in `src/lib/entitlements.ts` checks whether the reader may unlock from the มู wallet (`docs/wallet.md`). It does not debit first. The detail generates before one transaction runs `chargeUnlockWithin` and patches the detail on the same row.

This is the automatic protection for a failed generation: no spend row is written, so there is no balance to refund. If the database patch fails, the same transaction rolls back the spend. A retry after either failure remains safe. The spend is keyed to the row, so a delivered report is never charged twice.

The one-flow top-up path is implemented separately in `docs/wallet.md`; production payment enablement remains governed by its provider configuration and launch checks.

### Stored shape

The `analysis` column holds `CompatibilityV4StoredSchema` (`lib/shared/types/compatibility.ts`). There is no schema change.

```
{ contentVersion: 4,
  plan:   { insights: [...] },              // the insight plan both parts are written from
  inputs: { reader: { birthDate, birthHour, gender, mbti },
            partner: { birthDate, mbti } },  // the charts the teaser was computed from
  teaser: { generatedOn, archetype, people, dimensions, cover },
  detail: null | { palace, readingMinutes, overview, chapters, calendar, plan },
  detailGeneratedAt?: ISO }
```

- **`inputs`** is one field beyond the shape first decided. A reader can edit their birth date, hour, gender or MBTI after the check, and the detail must describe the same charts the teaser shows.
- **`plan`** is paid substance. The teaser's hints point at it.
- **Locked means `detail === null`,** whatever the flag says. A row written while the lock was on stays locked after the flag goes off; unlocking it is then free.
- **Older rows.** Rows written before locked mode store the flat `CompatibilityV4Content`. Only dev databases have them, since v4 never shipped flat. They parse as full and are never locked. v1 and v2 rows are unchanged.

### What leaves the server

All four reading responses are built in `src/systems/compatibility/reading.ts`:
- **POST** (new row, existing row, and the double-submit path) and **GET `/compatibility/:id`** go through `readingResponse`.
- **The unlock** also goes through `readingResponse`.
- **The share link** goes through `shareResponse`.
- **History** goes through `historyItem`.

Rules for a v4 row:
- **No `analysis` field.** The stored JSON carries the plan and the input snapshot.
- **`structuredContent` comes from `shapeCompatibilityView`,** the teaser view when locked. The teaser view has no overview, chapters, calendar, week plan, palace, insights or inputs.
- **The share link returns the free fields only,** locked or not.
- **History returns no reading text,** and it has no `locked` field. It does carry `lockEnabled`, the flag rather than any row's state, so the wait screen can say what a new check writes: about 10 s for the teaser alone, 20 to 30 s and six chapters for the full report.

A locked teaser has no detail to count its reading time from. The door shows `V4_LOCKED_READING_MINUTES` (11), an estimate: six written reports measured 9 to 12 minutes, median 11. After the unlock, the report's own minutes replace it.

### Unlock flow

`unlockReading` in `src/systems/compatibility/reading.ts` runs these steps:
1. Session, then profile.
2. Load the row. 404 unless the session's profile owns it.
3. If the row is not a locked v4 report, return it as it is. That makes the call idempotent: no model call and no wallet access.
4. `checkUnlock(userId, rowId)` (`src/lib/entitlements.ts`) is read-only apart from the welcome gift. A row already paid for skips the balance check, for example a row devtools relocked or a retry after a failed patch. Otherwise, if the balance is short, the route answers 402 with `InsufficientBalanceBody` (`lib/shared/types/wallet.ts`) before any model call.
5. Take the single-flight lock `generationKey('compatibility', 'unlock', rowId)`. A second tap, or a second process, waits for the first and gets the same result. A 402 is replayed for 1 s, a 200 for 60 s.
6. Inside the lock, re-read the row, since another process may have finished. Then `generateCompatibilityV4Detail(stored, …)` runs the three detail calls from `stored.plan`.
   - `now` is the teaser's `generatedOn`, so the calendar months and the week plan match the plan's month insights.
   - The charts come from `stored.inputs`.
   - If generation throws, nothing has been charged. The route answers 500.
7. One transaction (`saveDetailPaid`): `chargeUnlockWithin(tx, userId, rowId)` charges 49 มู once per row, then `analysis` is patched on the same row.
   - If the balance dropped meanwhile, the charge refuses. The detail is discarded and the answer is 402, with nothing charged or written.
   - If the patch fails, the charge rolls back with it.
   - After the commit, drop the `compat:{userId}:{id}` cache entry and return the full report.

The frontend updates its `['compatibility', id]` query with the response and plays the reveal in place.

### Locked hints and partner names

The hints must not use astrology or MBTI terms (ธาตุ, ดาว, วันเกิด, นักษัตร, MBTI codes and so on), and they are prompted to name the partner. A partner is often called ดาว. So the rule is checked at generation, in the v4 pair check (`hintJargon` in `src/lib/compatibility-text.ts`), not in the shared schema, which cannot know the name. Each version's check (the v4 pair and quality checks and the plan check, v3's pair check, v2's foreign-word rule) masks the partner's name once, at its entry (`maskNames`). Every rule then reads only that masked copy; rules that need the name look for the mark. So partners called น้ำ, ไฟ, ทอง, หนู, Mind or มูหนึ่ง2242 are not flagged, and ดาวอังคาร, ดวงดาว and ธาตุไฟ are still caught. The Thai-only prose rule moved out of the schema the same way. Month keys are still checked on the reply itself. Until 2026-09-27 the rule sat in the schema, and every check for a partner called ดาว returned 500.

### Locked hint length

A hint may be up to `V4_HINT_MAX` (170) characters. 243 distinct passing hints from the ten v4 sample result sets (2026-09-27) measured 63 to 145 characters: median 101, p90 127, p95 130. The cap is about 1.3 × p95. The old 150 was set before hints named the partner and a situation. On 2026-09-27 a live check for "Mind" failed because a hint ran past it twice. The cover prompt now states the cap.

When the only failures in a cover reply are hints over the cap, the cover does not spend its one whole-reply repair on them. A small call (`rewriteV4Hints`) rewrites just those hints, aiming at 130 characters. It gets the plan's insights for each hint's chapter. The patched cover is validated again by the same schema and pair check, so the cap still holds. If the rewrite fails or is still too long, the whole-reply repair runs as before.

### A failed check costs no daily check

The route takes the hourly and daily counts before it generates. If generation or the save throws, `refundChecksOnFailure` (`src/systems/compatibility/check-limit.ts`) gives both counts back, so a 500 does not cost one of the five daily checks. The unlock has no rate limit.

### Latency and deadline

Both stages use the v4 live budget above: one repair per call, and every model call ends by request start + 220 s.
- **Check:** the plan's 75 s cap still applies, so the POST fits as before.
- **Unlock:** there is no plan call. Its worst case is three detail calls under the same 220 s deadline, plus the DB patch, so at most about 225 s. That fits the single-flight's 250 s wait, the 255 s server idle and the 270 s client timeout, which the unlock call also uses.

Measured on 2026-09-27 with the five dev fixtures, real DeepSeek and the live budget, each fixture run once through both stages:

| Stage | Runs | Wall time | Typical |
|---|---|---|---|
| Teaser (plan + cover) | 5/5 passed | 5.8 to 9.4 s | about 6.7 s |
| Detail (3 calls in parallel) | 5/5 passed | 12.4 to 17.6 s | about 15 s |

A cover-only call takes 1.7 to 3.8 s after the plan.

Three unlocks on the local stack the same day took 16.5, 18.5 and 32.6 s end to end. The 32.6 s one needed a repair on the overview, attraction, future and calendar call, which wrote about 3,400 tokens twice. So "ราว 20 วินาที" on the button is the typical case, not the worst case.

### Verification

- `bun test tests/compatibility-v4.test.ts` covers locked mode:
  - the teaser stage stores no detail;
  - teaser plus a later detail equals the report written in one go;
  - the detail's months follow `generatedOn`;
  - locked responses carry no paid string on the reading, share and history routes;
  - unlock is owner-only, answers 402 `insufficient_balance` at a balance of 0, is idempotent, and writes once under two concurrent taps;
  - a failed detail generation leaves the wallet balance and spend ledger untouched;
  - a row whose detail exists opens without touching the wallet (the wallet is stubbed; `tests/wallet.test.ts` covers the ledger itself);
  - partners called ดาว, ดาวใจ, น้ำ, ไฟ and ทอง pass without a repair, and a real jargon hint is still repaired or rejected.
- To try the lock again on one row without a new check, use the devtools ดวงคู่ tab. ล็อกใหม่ (`POST /api/dev/relock/compatibility`, local database only) sets the row's `detail` back to null. ปลดล็อก calls the real unlock route. Both open `/dashboard/compatibility?id=<rowId>`. A relocked row that was already paid for is not charged again. Once the route pre-checks with `checkUnlock`, a balance of 0 gets a 402 for it first (see `docs/wallet.md`).
- To run locally, start the backend with `COMPAT_LOCK_ENABLED=1 COMPAT_UNLOCK_FREE=1`. Never set `COMPAT_UNLOCK_FREE` in production.
