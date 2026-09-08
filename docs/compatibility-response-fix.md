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
