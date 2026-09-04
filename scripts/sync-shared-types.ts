#!/usr/bin/env bun

/**
 * Sync Script: Copy shared types from horo-be to horo-fe
 *
 * horo-be/lib/shared/types/ is the source of truth for types shared between
 * the backend and frontend. This script copies every file in that directory
 * to horo-fe's lib-packages/shared/types/, prepending a generated-file header.
 *
 * Usage:
 *   bun run scripts/sync-shared-types.ts          # sync (overwrite FE copies)
 *   bun run scripts/sync-shared-types.ts --check   # verify FE copies are in sync (CI)
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const HEADER =
  '// GENERATED from horo-be/lib/shared/types — do not edit. Run `bun run sync:types` in horo-be.\n';

const SOURCE_DIR = join(import.meta.dir, '../lib/shared/types');
const TARGET_DIR = join(import.meta.dir, '../../horo-fe/src/lib-packages/shared/types');

function main() {
  const checkOnly = process.argv.includes('--check');

  if (!existsSync(TARGET_DIR)) {
    console.error(`Target directory not found: ${TARGET_DIR}`);
    process.exit(1);
  }

  const files = readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.ts'));
  const outOfSync: string[] = [];

  for (const file of files) {
    const sourcePath = join(SOURCE_DIR, file);
    const targetPath = join(TARGET_DIR, file);
    const expectedContent = HEADER + readFileSync(sourcePath, 'utf-8');

    if (checkOnly) {
      const actualContent = existsSync(targetPath) ? readFileSync(targetPath, 'utf-8') : null;
      if (actualContent !== expectedContent) {
        outOfSync.push(file);
      }
      continue;
    }

    writeFileSync(targetPath, expectedContent);
    console.log(`Synced ${file}`);
  }

  if (checkOnly) {
    if (outOfSync.length > 0) {
      console.error('Out of sync with horo-be/lib/shared/types:');
      for (const file of outOfSync) {
        console.error(`  - ${file}`);
      }
      console.error('\nRun `bun run sync:types` in horo-be to fix.');
      process.exit(1);
    }
    console.log('FE shared types are in sync.');
  }
}

main();
