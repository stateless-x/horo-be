import { describe, expect, test } from 'bun:test';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dailyReadings } from '../lib/db/schema/readings';

describe('daily reading persistence', () => {
  test('allows only one reading per profile and Bangkok date', () => {
    const index = getTableConfig(dailyReadings).indexes.find(
      (candidate) => candidate.config.name === 'daily_readings_profile_date_idx',
    );

    expect(index?.config.unique).toBe(true);
  });

  test('production prepares existing rows before starting the API', () => {
    const root = join(import.meta.dir, '..');
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
    const prepareScript = readFileSync(
      join(root, 'scripts/ensure-daily-reading-uniqueness.ts'),
      'utf8',
    );

    expect(dockerfile).toContain('bun run scripts/ensure-daily-reading-uniqueness.ts &&');
    expect(prepareScript).toContain('ROW_NUMBER() OVER');
    expect(prepareScript).toContain('CREATE UNIQUE INDEX');
  });
});
