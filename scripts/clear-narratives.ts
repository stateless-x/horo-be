#!/usr/bin/env bun
/**
 * Clear all chart_narratives so users regenerate with the full monthlyHighlights schema.
 * Run once after deploying the gemini.ts + shared type fixes.
 */
import { db } from '../src/lib/db';
import { chartNarratives } from '../lib/db/schema/readings';
import { sql } from 'drizzle-orm';

const [{ count }] = await db.select({ count: sql<number>`COUNT(*)` }).from(chartNarratives);
console.log(`Found ${count} narratives to clear.`);

await db.delete(chartNarratives);
console.log('✅ All chart_narratives cleared. Users will regenerate on next visit.');

process.exit(0);
