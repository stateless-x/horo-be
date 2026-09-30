import { describe, expect, test } from 'bun:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { historyCursorBefore } from '../src/systems/compatibility/history-cursor';

describe('compatibility history cursor', () => {
  test('binds the cursor as cast text, never a Date postgres-js cannot serialize', () => {
    const cursor = { createdAt: '2026-09-27T11:18:23.620Z', id: '0df3830e-1e3b-44dd-b3e1-28f8d383b396' };
    const query = new PgDialect().sqlToQuery(historyCursorBefore(cursor));

    expect(query.sql).toBe('("compatibility"."created_at", "compatibility"."id") < ($1::timestamp, $2::uuid)');
    expect(query.params).toEqual([cursor.createdAt, cursor.id]);
    expect(query.params.some((param) => param instanceof Date)).toBe(false);
  });
});
