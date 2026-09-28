import { sql, type SQL } from 'drizzle-orm';
import { compatibility } from '../../../lib/db';

/**
 * History rows after a cursor: older, or the same time with a smaller id.
 * The cursor values are bound as text and cast in SQL. A raw `sql` template does not type
 * its parameters, and postgres-js serializes untyped ones as strings, so a Date here threw
 * before the query ran and every page after the first returned 500.
 */
export function historyCursorBefore(cursor: { createdAt: string; id: string }): SQL {
  return sql`(${compatibility.createdAt}, ${compatibility.id}) < (${cursor.createdAt}::timestamp, ${cursor.id}::uuid)`;
}
