import { sql, type SQL } from 'drizzle-orm';
import { compatibility } from '../../../lib/db';

/**
 * History rows after a cursor: older, or the same time with a smaller id.
 * The cursor values are bound as text and cast in SQL. A raw `sql` template does not type
 * its parameters, and postgres-js serializes untyped ones as strings, so a Date here threw
 * before the query ran and every page after the first returned 500.
 *
 * Known limit: `created_at` is `timestamp` (microsecond precision in Postgres), but the
 * cursor is built from a JS `Date.toISOString()` (millisecond precision — JS `Date` cannot
 * hold sub-millisecond time at all, so this loses precision before it even reaches this
 * function). Two rows for the same user inserted within the same millisecond can tie at the
 * cursor boundary even though the DB itself ordered them by their true (sub-ms-distinct)
 * time, which could duplicate or skip one row across a page boundary. Not fixed here: it
 * needs the cursor to carry a microsecond-precision value end to end (e.g. select
 * created_at as text instead of as a JS Date), which is a bigger change than this endpoint's
 * contract. For one person's own compatibility history the exposure is a same-account,
 * same-millisecond write, which does not happen from the current single-request flow.
 */
export function historyCursorBefore(cursor: { createdAt: string; id: string }): SQL {
  return sql`(${compatibility.createdAt}, ${compatibility.id}) < (${cursor.createdAt}::timestamp, ${cursor.id}::uuid)`;
}
