import { describe, expect, test } from 'bun:test';
import { ALL_BUDGETS, SOCKET_CEILING_MS } from '../lib/shared/types/generation-budget';
import { HTTP_SERVER_OPTIONS } from '../src/lib/http-server-options';

/**
 * The invariants whose absence let two real bugs ship.
 *
 * 1. A retry ladder longer than the socket cannot deliver its last attempt.
 *    Chart asked for 180s x 3 (543s) against a 255s socket, so attempts 2 and 3
 *    were unservable rather than slow.
 * 2. An escape hatch that fires before the client gives up offers "try again"
 *    during a healthy request — and that retry discards the in-flight
 *    generation and spends another rate-limit token. The daily hatch sat at
 *    140s while the client waited 260s.
 *
 * Both are pure arithmetic between numbers that used to live in four different
 * files. They are asserted here so a change to one budget cannot silently
 * invalidate the others.
 */

describe('generation budgets fit the socket', () => {
  test('the declared ceiling matches the server it describes', () => {
    // The ceiling is only meaningful if it tracks the value Bun is actually
    // given; a drift here would make every assertion below vacuous.
    expect(SOCKET_CEILING_MS).toBe(HTTP_SERVER_OPTIONS.idleTimeout * 1000);
  });

  for (const [name, budget] of Object.entries(ALL_BUDGETS)) {
    describe(name, () => {
      test('the whole retry ladder fits inside the socket', () => {
        expect(budget.ladderMs).toBeLessThan(SOCKET_CEILING_MS);
      });

      test('the client outwaits the socket, so the server gives up first', () => {
        expect(budget.clientTimeoutMs).toBeGreaterThan(SOCKET_CEILING_MS);
      });

      test('the escape hatch only appears once the request has truly failed', () => {
        expect(budget.escapeHatchMs).toBeGreaterThan(budget.clientTimeoutMs);
      });

      test('every attempt is individually deliverable', () => {
        // A single attempt longer than the ceiling could never return, which
        // would make the retry count a lie.
        expect(budget.perAttemptMs).toBeLessThan(SOCKET_CEILING_MS);
      });
    });
  }
});
