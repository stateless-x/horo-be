/**
 * How long a reading is allowed to take, in one place.
 *
 * These numbers were previously restated in four files — the LLM per-attempt
 * timeout, the client fetch timeout, and the loading screen's escape-hatch
 * delay — and they drifted. A change to the backend budget left the daily
 * screen offering "this is taking longer than usual" and a reload button 120
 * seconds into a request that was still healthy, where the reload discarded
 * the in-flight generation and spent another rate-limit token.
 *
 * Everything below derives from two facts, so moving one attempt budget moves
 * the client timeout and the escape hatch with it.
 */

/**
 * Bun caps `idleTimeout` at 255s and the server sets exactly that
 * (horo-be/src/lib/http-server-options.ts). Nothing can outlive the socket, so
 * this is the hard ceiling every budget below has to fit under: a ladder that
 * exceeds it cannot deliver its last attempt, and a client that waits past it
 * is waiting on a socket the server has already closed.
 */
export const SOCKET_CEILING_MS = 255_000;

/** Backoff before retry N, matching `1000 * (attempt + 1)` in llm.ts. */
const RETRY_BACKOFF_MS = 1_000 + 2_000;

/** Attempts one generation gets: the initial call plus `maxRetries` (2). */
const ATTEMPTS = 3;

/**
 * Total wall time a generation may consume, worst case: every attempt burning
 * its full budget, plus the backoff between them.
 */
function ladderMs(perAttemptMs: number): number {
  return perAttemptMs * ATTEMPTS + RETRY_BACKOFF_MS;
}

export interface GenerationBudget {
  /** Per-attempt LLM timeout, passed to callDeepSeek. */
  readonly perAttemptMs: number;
  /** Worst-case total for the whole retry ladder. */
  readonly ladderMs: number;
  /**
   * How long the browser waits. Sits just past the socket ceiling so the server
   * is always the thing that gives up: aborting earlier kills requests the
   * server is still working on and surfaces a timeout for a reading that would
   * have arrived.
   */
  readonly clientTimeoutMs: number;
  /**
   * When the loading screen may offer to start over. Strictly after the client
   * has actually given up — before that, "try again" throws away a healthy
   * request and costs the user another rate-limit token.
   */
  readonly escapeHatchMs: number;
}

function budget(perAttemptMs: number): GenerationBudget {
  const clientTimeoutMs = SOCKET_CEILING_MS + 5_000;
  return {
    perAttemptMs,
    ladderMs: ladderMs(perAttemptMs),
    clientTimeoutMs,
    // 5s past the client timeout: by then the request has definitively failed,
    // so retrying is the genuinely correct offer rather than a destructive one.
    escapeHatchMs: clientTimeoutMs + 5_000,
  };
}

/**
 * The daily reading. Compact output (~3k tokens), so 80s per attempt keeps the
 * whole ladder at 243s — inside the ceiling, with room for all three attempts
 * to actually be delivered.
 */
export const DAILY_BUDGET = budget(80_000);

/**
 * The full birth chart. Larger output (3-5k tokens) at DeepSeek's ~25-60 tok/s,
 * so it would like more room per attempt than daily — but three attempts have
 * to fit one socket, which caps any per-attempt budget here at 83s. It used to
 * ask for 180s, putting the ladder at 543s: attempt 2 landed past the ceiling
 * and attempt 3 could never be delivered at all, so the retries were unservable
 * rather than merely slow.
 *
 * 80s rather than the maximum 83s, to match daily and keep a margin under the
 * ceiling. A chart that genuinely needs more than 80s of model time cannot be
 * delivered on one request no matter what this says — that case needs async
 * generation, not a bigger number.
 */
export const CHART_BUDGET = budget(80_000);

/** Every budget, for tests that assert the invariants hold across all of them. */
export const ALL_BUDGETS = {
  daily: DAILY_BUDGET,
  chart: CHART_BUDGET,
} as const;
