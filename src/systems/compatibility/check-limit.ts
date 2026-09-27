import { decrementRateLimit, RATE_LIMITS } from '../../lib/rate-limit';

/**
 * Runs a new ดวงคู่ check whose hourly and daily counters were already
 * taken by checkRateLimit, and gives both back if it throws: a failed
 * generation (or a failed save) must not cost the reader one of their five
 * checks a day. The error is rethrown for the route to answer.
 */
export async function refundChecksOnFailure<T>(userId: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    await Promise.all([
      decrementRateLimit(userId, RATE_LIMITS.compatibility),
      decrementRateLimit(userId, RATE_LIMITS.compatibilityDaily),
    ]);
    throw error;
  }
}
