#!/usr/bin/env bun
/**
 * Compatibility v3 measurement harness.
 *
 * Runs the real generation library (src/lib/compatibility-generation.ts, the
 * same code the dev generator tool calls) on the synthetic fixtures in
 * COMPATIBILITY_DEV_FIXTURES, for v2 and v3, and records per call: wall time,
 * model calls, output tokens, finish reason, whether the first reply passed
 * the schema, per-field lengths, and automated safety/style flags. It never
 * touches the database or Redis; run it with unroutable DATABASE_URL and
 * REDIS_URL so an accidental import fails loudly:
 *
 *   DATABASE_URL=postgres://none@127.0.0.1:1/none REDIS_URL=redis://127.0.0.1:1 \
 *     bun scripts/prototype-compat-v3/run.ts --runs 3 --out <dir> [--only v2,v3]
 *   ... run.ts --out <dir> --print-prompt <fixture id>   # the assembled v3 prompt, no API call
 *
 * results.json goes to --out, never into the repo; render.ts turns it into the
 * side-by-side sample file. The v3.0 to v3.2 prompt iterations in the first
 * sample file were measured with this script's earlier, self-contained
 * version (commit ce3f931).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../../src/config';
import {
  COMPATIBILITY_DEV_FIXTURES,
  CompatibilityV3GeneratedSchema,
  foreignTokenIn,
  type MbtiType,
} from '../../lib/shared';
import {
  buildCompatibilityPromptFor,
  calculateCompatibilityCharts,
  generateCompatibilityV2,
  generateCompatibilityV3,
  generateCompatibilityV4,
} from '../../src/lib/compatibility-generation';
import { thaiWordCount } from '../../src/lib/compatibility-text';

type Fixture = (typeof COMPATIBILITY_DEV_FIXTURES)[number];

function inputOf(f: Fixture) {
  return {
    reader: {
      birthDate: new Date(f.reader.birthDate),
      birthHour: f.reader.birthHour,
      gender: f.reader.gender,
      mbtiType: (f.reader.mbti ?? null) as MbtiType | null,
    },
    partner: {
      name: f.partner.name,
      birthDate: new Date(f.partner.birthDate),
      mbtiType: (f.partner.mbti ?? null) as MbtiType | null,
    },
    relationshipType: f.relationshipType,
  };
}

// ---------------------------------------------------------------- measurement

interface Attempt {
  ms: number;
  status: number;
  promptTokens?: number;
  completionTokens?: number;
  finishReason?: string;
  /** The model's JSON text, kept so a failed first reply can be diagnosed. */
  text?: string;
  error?: string;
}
let attemptLog: Attempt[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes('api.deepseek.com')) return realFetch(input, init);
  const t0 = performance.now();
  try {
    const res = await realFetch(input, init);
    const body = await res.clone().text();
    const attempt: Attempt = { ms: Math.round(performance.now() - t0), status: res.status };
    try {
      const data = JSON.parse(body) as {
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
      };
      attempt.promptTokens = data.usage?.prompt_tokens;
      attempt.completionTokens = data.usage?.completion_tokens;
      attempt.finishReason = data.choices?.[0]?.finish_reason;
      attempt.text = data.choices?.[0]?.message?.content;
    } catch {
      attempt.error = 'non-JSON body';
    }
    attemptLog.push(attempt);
    return res;
  } catch (error) {
    attemptLog.push({ ms: Math.round(performance.now() - t0), status: 0, error: String(error) });
    throw error;
  }
}) as typeof fetch;

function firstReplyIssue(attempt: Attempt | undefined): string | undefined {
  if (!attempt?.text) return attempt?.error;
  try {
    const result = CompatibilityV3GeneratedSchema.safeParse(JSON.parse(attempt.text));
    return result.success ? undefined : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  } catch {
    return 'invalid JSON';
  }
}

const graphemes = new Intl.Segmenter('th', { granularity: 'grapheme' });
const words = new Intl.Segmenter('th', { granularity: 'word' });

/** Every string leaf with its path, for per-field length calibration. */
function leaves(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  }
  return [];
}

const prose = (content: unknown) =>
  leaves(content).filter(([p]) => !p.endsWith('.section') && !p.includes('timing.basis') && p !== 'scoreExplanation');

function wordTrigrams(text: string): Set<string> {
  const toks = [...words.segment(text)].filter((w) => w.isWordLike).map((w) => w.segment);
  const out = new Set<string>();
  for (let i = 0; i + 2 < toks.length; i++) out.add(toks.slice(i, i + 3).join('|'));
  return out;
}

const ROMANCE = /แฟน|คนรัก|โรแมนติก|เดท|หวานใจ|ความรัก|จีบ/;
const PRONOUN_JAO = /เจ้า(?!ของ|หน้าที่|นาย|ภาพ|วัน|บ้าน)/;
const DETAIL_KEYS = ['dynamic', 'understandingPartner', 'yourSide', 'communication', 'friction', 'timing', 'longTerm'];

function autoChecks(f: Fixture, score: number, content: Record<string, unknown>) {
  const flags: string[] = [];
  const texts = prose(content).map(([, v]) => v);
  const all = texts.join('\n');
  const foreign = texts.map(foreignTokenIn).filter(Boolean);
  if (foreign.length) flags.push(`non-Thai: ${[...new Set(foreign)].join(',')}`);
  if (/[—–]/.test(all)) flags.push('em/en dash');
  if (PRONOUN_JAO.test(all)) flags.push('เจ้า pronoun');
  if (new RegExp(`(?<!\\d)${score}(?!\\d)`).test(all) || /คะแนน/.test(all)) flags.push('mentions the score');
  if (/toxic|ท็อกซิก|นอกใจ/i.test(all)) flags.push('banned label');
  if (!all.includes(f.partner.name)) flags.push('partner name missing');
  if (all.includes(` ${f.partner.name} `)) flags.push('spaces around partner name');
  if (/ไม่ใช่ข้อสรุป|ไม่ใช่คำยืนยัน/.test(all)) flags.push('parroted tendency disclaimer');
  if (f.reader.gender === 'female' && /ผม|ครับ/.test(all)) flags.push('male pronoun for a female reader');
  if (f.partner.name.startsWith('คุณ') && all.includes(`พี่${f.partner.name.slice(3)}`)) flags.push('partner name changed');
  if (!['romantic', 'talking'].includes(f.relationshipType) && ROMANCE.test(all)) {
    flags.push(`romance wording in ${f.relationshipType}: "${all.match(ROMANCE)?.[0]}"`);
  }

  let maxSectionOverlap = 0;
  const detail = content.detail as Record<string, unknown> | undefined;
  if (detail) {
    const grams = DETAIL_KEYS.map((key) => wordTrigrams(leaves(detail[key]).map(([, v]) => v).join(' ')));
    for (let i = 0; i < grams.length; i++) {
      for (let j = i + 1; j < grams.length; j++) {
        const inter = [...grams[i]].filter((g) => grams[j].has(g)).length;
        maxSectionOverlap = Math.max(maxSectionOverlap, inter / (new Set([...grams[i], ...grams[j]]).size || 1));
      }
    }
  }
  return { flags, maxSectionOverlap: Math.round(maxSectionOverlap * 100) / 100 };
}

async function runOnce(f: Fixture, arch: 'v2' | 'v3' | 'v4', run: number) {
  attemptLog = [];
  let modelCalls = 0;
  const t0 = performance.now();
  const generate = { v2: generateCompatibilityV2, v3: generateCompatibilityV3, v4: generateCompatibilityV4 }[arch];
  try {
    const result = await generate({ ...inputOf(f), onModelCall: () => modelCalls++ });
    const content = result.content as unknown as Record<string, unknown>;
    const v4 = 'qualityFlags' in result ? result : null;
    return {
      fixture: f.id, arch, run, totalMs: Math.round(performance.now() - t0), modelCalls,
      timings: result.timings,
      qualityFlags: v4?.qualityFlags,
      detailWords: v4?.content.chapters.map((c) => `${c.key}:${thaiWordCount(c.detail)}`),
      attempts: attemptLog.map(({ text: _text, ...a }) => a),
      firstTryPass: modelCalls === 1, finalPass: true,
      firstTryError: arch === 'v3' && modelCalls > 1 ? firstReplyIssue(attemptLog[0]) : undefined,
      content,
      lengths: Object.fromEntries(
        prose(content).map(([p, v]) => [p, { len: v.length, graphemes: [...graphemes.segment(v)].length }]),
      ),
      checks: autoChecks(f, result.charts.score.score, content),
    };
  } catch (error) {
    return {
      fixture: f.id, arch, run, totalMs: Math.round(performance.now() - t0), modelCalls,
      attempts: attemptLog.map(({ text: _text, ...a }) => a),
      firstTryPass: false, finalPass: false, firstTryError: firstReplyIssue(attemptLog[0]), error: String(error),
    };
  }
}

// ---------------------------------------------------------------- main

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const RUNS = Number(arg('--runs', '1'));
const OUT = arg('--out', '');
const ONLY = arg('--only', 'v2,v3').split(',') as Array<'v2' | 'v3' | 'v4'>;
if (!OUT) throw new Error('--out <dir> is required (outputs never go into the repo)');

const printId = arg('--print-prompt', '');
if (printId) {
  const f = COMPATIBILITY_DEV_FIXTURES.find((x) => x.id === printId);
  if (!f) throw new Error(`unknown fixture ${printId}`);
  const input = inputOf(f);
  const charts = calculateCompatibilityCharts(input.reader, input.partner);
  console.log(buildCompatibilityPromptFor('v3', input.reader, input.partner, input.relationshipType, charts));
  process.exit(0);
}
if (!config.deepseek.apiKey) throw new Error('DEEPSEEK_API_KEY is not set');
mkdirSync(OUT, { recursive: true });

const records: unknown[] = [];
for (let run = 1; run <= RUNS; run++) {
  for (const f of COMPATIBILITY_DEV_FIXTURES) {
    for (const arch of ONLY) {
      const rec = await runOnce(f, arch, run);
      records.push(rec);
      const tokens = rec.attempts.map((a) => a.completionTokens ?? '?').join('+');
      console.log(
        `[run ${run}] ${f.id.padEnd(26)} ${arch} ${String(rec.totalMs).padStart(6)}ms calls=${rec.modelCalls} ` +
          `out_tokens=${tokens} finish=${rec.attempts.map((a) => a.finishReason).join(',')} ` +
          `first=${rec.firstTryPass} final=${rec.finalPass}` +
          `${'timings' in rec && rec.timings ? ` timings=${JSON.stringify(rec.timings)}` : ''}` +
          `${'qualityFlags' in rec && rec.qualityFlags?.length ? ` quality=${rec.qualityFlags.length}` : ''}` +
          `${rec.error ? ` error=${rec.error.slice(0, 160)}` : ''}${rec.firstTryError ? ` firstErr=${rec.firstTryError.slice(0, 160)}` : ''}`,
      );
      writeFileSync(join(OUT, 'results.json'), JSON.stringify({ fixtures: COMPATIBILITY_DEV_FIXTURES, records }, null, 2));
    }
  }
}
console.log(`wrote ${join(OUT, 'results.json')}`);
