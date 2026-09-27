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
three section calls in parallel (`generateCompatibilityV4`). The old per-call
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
