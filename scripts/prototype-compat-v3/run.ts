#!/usr/bin/env bun
/**
 * Compatibility v3 prototype: one prompt, one generation, two views.
 *
 * Throwaway measurement harness, not production code. It builds the v3 prompt
 * from the real v2 prompt assembly (buildCompatibilityPrompt) and the real
 * deterministic scoring (calculateCompatibility), calls DeepSeek, and compares
 * against the unchanged v2 generation (generateStructuredCompatibilityReading)
 * on the same synthetic fixtures. It never touches the database or Redis; run
 * it with unroutable DATABASE_URL / REDIS_URL so an accidental import fails:
 *
 *   DATABASE_URL=postgres://none@127.0.0.1:1/none REDIS_URL=redis://127.0.0.1:1 \
 *     bun scripts/prototype-compat-v3/run.ts --runs 3 --out <dir> [--only v2,v3] [--prompt v3.0|v3.2]
 *   ... run.ts --out <dir> --print-prompt <fixture id>   # show the assembled v3 prompt, no API call
 *
 * results.json goes to --out, never into the repo; render.ts turns it into the
 * side-by-side sample file. instructions-v3.0.md is the first draft, kept so
 * the recorded v3.0 numbers stay reproducible; instructions.md is v3.2.
 * The English-word guard in V3Schema is what v3.1/v3.2 were measured with; it
 * does not catch CJK leaks (see the samples file), which production must.
 */
import { z } from 'zod';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../../src/config';
import { buildCompatibilityPrompt, SYSTEM_PROMPT } from '../../src/lib/prompts';
import { renderPrompt } from '../../src/lib/prompts/render';
import { generateStructuredCompatibilityReading } from '../../src/lib/llm';
import { calculateBazi, calculateThaiAstrology, calculateCompatibility, buildTraitChips } from '../../lib/astrology';
import {
  TOKEN_LIMITS,
  getMbtiInfo,
  getMbtiCognitiveFunctions,
  type RelationshipType,
} from '../../lib/shared';
import instructionsMd from './instructions.md' with { type: 'text' };
import instructionsV30Md from './instructions-v3.0.md' with { type: 'text' };

// ---------------------------------------------------------------- fixtures

interface Fixture {
  id: string;
  relationshipType: RelationshipType;
  reader: { birthDate: string; birthHour?: number; gender: 'male' | 'female'; mbti: string | null };
  partner: { name: string; birthDate: string; mbti: string | null };
}

/** Synthetic people only. No real user data. */
const FIXTURES: Fixture[] = [
  {
    id: 'romantic-both-mbti',
    relationshipType: 'romantic',
    reader: { birthDate: '1996-03-14', birthHour: 8, gender: 'female', mbti: 'INFP' },
    partner: { name: 'ต้น', birthDate: '1993-11-02', mbti: 'ESTJ' },
  },
  {
    id: 'talking-reader-mbti-only',
    relationshipType: 'talking',
    reader: { birthDate: '1999-06-05', birthHour: 21, gender: 'male', mbti: 'ENFP' },
    partner: { name: 'มายด์', birthDate: '1998-07-21', mbti: null },
  },
  {
    id: 'friend-no-mbti',
    relationshipType: 'friend',
    reader: { birthDate: '1994-12-18', gender: 'female', mbti: null },
    partner: { name: 'บีม', birthDate: '1995-01-09', mbti: null },
  },
  {
    id: 'boss-both-mbti',
    relationshipType: 'boss',
    reader: { birthDate: '1997-09-27', birthHour: 14, gender: 'female', mbti: 'ISFJ' },
    partner: { name: 'คุณวิภา', birthDate: '1980-05-30', mbti: 'ENTJ' },
  },
  {
    id: 'family-partner-mbti-only',
    relationshipType: 'family',
    reader: { birthDate: '1992-02-11', gender: 'male', mbti: null },
    partner: { name: 'แม่', birthDate: '1965-09-12', mbti: 'ISTJ' },
  },
];

// ---------------------------------------------------------------- v3 draft schema

const DETAIL_SECTIONS = [
  'dynamic',
  'understandingPartner',
  'yourSide',
  'communication',
  'friction',
  'timing',
  'longTerm',
] as const;
const TIMING_BASIS = ['p1ThaiDay', 'p1Planet', 'p1Element', 'p2ThaiDay', 'p2Planet', 'p2Element'] as const;

/** Draft bounds, deliberately loose; the run reports measured lengths to calibrate them. */
const s = (min: number, max: number) => z.string().trim().min(min).max(max);
/** Any Latin word other than an MBTI code. DeepSeek leaks stray English tokens into long Thai output. */
const LATIN_WORD = /[A-Za-z]{2,}/g;
const isAllowedLatin = (word: string) => /^[IE][NS][TF][JP]$/.test(word) || word === 'MBTI';
function latinWords(value: unknown): string[] {
  return leaves(value)
    .filter(([path]) => !path.endsWith('.section') && !path.includes('timing.basis'))
    .flatMap(([, v]) => v.match(LATIN_WORD) ?? [])
    .filter((w) => !isAllowedLatin(w));
}

const V3Schema = z.object({
  detail: z.object({
    dynamic: s(80, 1000),
    understandingPartner: s(80, 900),
    yourSide: s(80, 900),
    communication: z.array(z.object({ do: s(10, 260), avoid: s(10, 260) })).length(3),
    friction: z
      .array(z.object({ scenario: s(10, 320).refine((v) => v.startsWith('ถ้า'), 'scenario must start with ถ้า'), repair: s(10, 360) }))
      .length(2),
    timing: z.object({ advice: s(40, 500), basis: z.array(z.enum(TIMING_BASIS)).min(1) }),
    longTerm: s(60, 700),
    nextSteps: z.object({ action: s(1, 180), conversationStarter: s(1, 220), watchFor: s(1, 180) }),
  }),
  teaser: z.object({
    verdict: s(10, 180),
    hook: s(30, 400),
    lockedHints: z
      .array(z.object({ text: s(10, 200), section: z.enum(DETAIL_SECTIONS) }))
      .length(3)
      .refine((hints) => new Set(hints.map((h) => h.section)).size === 3, 'hints must target 3 different sections'),
  }),
}).superRefine((value, ctx) => {
  const stray = latinWords(value);
  if (stray.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `English words in Thai prose: ${stray.join(', ')}` });
});
type V3Content = z.infer<typeof V3Schema>;

/** The whole point of the one-generation design: both views read the same stored object. */
function project(content: V3Content, view: 'teaser' | 'full') {
  return view === 'teaser' ? { teaser: content.teaser } : content;
}

const V3_SHAPE = `
Return valid JSON matching exactly this shape (all fields required, write "detail" before "teaser"):
{
  "detail": {
    "dynamic": string,
    "understandingPartner": string,
    "yourSide": string,
    "communication": [ { "do": string, "avoid": string } ],   // exactly 3 items
    "friction": [ { "scenario": string, "repair": string } ], // exactly 2 items, scenario starts with "ถ้า"
    "timing": { "advice": string, "basis": [string] },        // basis values from: ${TIMING_BASIS.join(', ')}
    "longTerm": string,
    "nextSteps": { "action": string, "conversationStarter": string, "watchFor": string }
  },
  "teaser": {
    "verdict": string,
    "hook": string,
    "lockedHints": [ { "text": string, "section": string } ] // exactly 3 items, section values from: ${DETAIL_SECTIONS.join(', ')}, all different
  }
}
Length limits: nextSteps.action 1 to 180 characters, conversationStarter 1 to 220 characters, watchFor 1 to 180 characters.
Do not include the score, markdown, comments, or any text outside this JSON object.`;

// ---------------------------------------------------------------- prompt assembly

function charts(f: Fixture) {
  const readerDate = new Date(f.reader.birthDate);
  const partnerDate = new Date(f.partner.birthDate);
  const readerBazi = calculateBazi(readerDate, f.reader.birthHour, f.reader.gender);
  const readerThai = calculateThaiAstrology(readerDate);
  // Mirrors the route: partner has no hour and a fixed gender.
  const partnerBazi = calculateBazi(partnerDate, undefined, 'female');
  const partnerThai = calculateThaiAstrology(partnerDate);
  const score = calculateCompatibility(readerBazi, partnerBazi);
  return { readerDate, partnerDate, readerBazi, readerThai, partnerBazi, partnerThai, score };
}

function buildV2Prompt(f: Fixture) {
  const c = charts(f);
  const prompt = buildCompatibilityPrompt(
    { name: 'เจ้า', birthDate: c.readerDate, baziChart: c.readerBazi, thaiAstrology: c.readerThai, mbtiType: f.reader.mbti },
    { name: f.partner.name, birthDate: c.partnerDate, baziChart: c.partnerBazi, thaiAstrology: c.partnerThai, mbtiType: f.partner.mbti },
    f.relationshipType,
    {
      score: c.score.score,
      scoreExplanation: c.score.overallAnalysis,
      strengths: c.score.strengths,
      challenges: c.score.challenges,
    },
  );
  return { prompt, c };
}

/** Data the v2 template does not carry but v3's sections need. */
function extraDataBlock(f: Fixture, c: ReturnType<typeof charts>): string {
  const lines = [
    'ข้อมูลเสริม (ใช้ประกอบการวิเคราะห์ ไม่ต้องทวน):',
    `- บุคลิกตามวันเกิดไทยของคุณ: ${c.readerThai.personality}`,
    `- บุคลิกตามวันเกิดไทยของ ${f.partner.name}: ${c.partnerThai.personality}`,
  ];
  if (PROMPT_VERSION !== 'v3.0') {
    // Same Thai labels and one-line traits the onboarding chips show (buildTraitChips).
    const chipLine = (chips: ReturnType<typeof buildTraitChips>) =>
      chips.filter((chip) => chip.system !== 'mbti').map((chip) => `${chip.label} (${chip.trait})`).join(' ');
    lines.push(
      `- ชื่อภาษาไทยที่ต้องใช้: คุณ ${chipLine(buildTraitChips(c.readerThai.day, c.readerBazi.element, null))} ดาว${c.readerThai.planet.replace(/^ดวง/, '').replace(/ \(.*\)$/, '')}`,
      `- ชื่อภาษาไทยที่ต้องใช้: ${f.partner.name} ${chipLine(buildTraitChips(c.partnerThai.day, c.partnerBazi.element, null))} ดาว${c.partnerThai.planet.replace(/^ดวง/, '').replace(/ \(.*\)$/, '')}`,
      `- ผู้ถามเป็น${f.reader.gender === 'female' ? 'ผู้หญิง' : 'ผู้ชาย'} ใน conversationStarter ให้ใช้สรรพนามและคำลงท้ายให้ตรงเพศ`,
    );
  }
  if (f.partner.mbti) {
    const info = getMbtiInfo(f.partner.mbti);
    const cog = getMbtiCognitiveFunctions(f.partner.mbti);
    if (!info || !cog) throw new Error(`Unknown MBTI ${f.partner.mbti}`);
    lines.push(
      PROMPT_VERSION === 'v3.0'
        ? `- แนวโน้มตาม MBTI ของ ${f.partner.name} (${info.code} ${info.nameTh}) เป็นแนวโน้มเท่านั้น ไม่ใช่ข้อสรุปตัวตน:`
        : `- แนวโน้มตาม MBTI ของ ${f.partner.name} (${info.code} ${info.nameTh}):`,
      // Thai gloss only: the bare function codes (Si, Te) leaked into prose in v3.1.
      `  ฟังก์ชันหลัก ${PROMPT_VERSION === 'v3.0' ? cog.dominantFunction : thaiGloss(cog.dominantFunction)} ฟังก์ชันเสริม ${PROMPT_VERSION === 'v3.0' ? cog.auxiliaryFunction : thaiGloss(cog.auxiliaryFunction)}`,
      `  จุดเด่นที่มักเห็น: ${cog.strengths}`,
      `  จุดที่มักสะดุด: ${cog.weaknesses}`,
    );
  }
  const missing = [
    !f.reader.mbti ? 'คุณ' : null,
    !f.partner.mbti ? f.partner.name : null,
  ].filter(Boolean);
  if (missing.length > 0) lines.push(`- ไม่มีข้อมูล MBTI ของ: ${missing.join(' และ ')} ห้ามเดา`);
  return lines.join('\n');
}

/** 'Si (ความทรงจำเชิงประสบการณ์)' -> 'ความทรงจำเชิงประสบการณ์' */
function thaiGloss(fn: string): string {
  const m = fn.match(/\((.+)\)/);
  if (!m) throw new Error(`Unexpected cognitive function label: ${fn}`);
  return m[1];
}

function spliceOnce(haystack: string, marker: string): number {
  const first = haystack.indexOf(marker);
  if (first === -1 || haystack.indexOf(marker, first + 1) !== -1) {
    throw new Error(`Marker "${marker}" must appear exactly once in the v2 prompt`);
  }
  return first;
}

/**
 * v3 prompt = v2 prompt with only its numbered instruction block swapped.
 * Everything before "คำสั่ง:" (persona, both people's data, MBTI guidance,
 * relationship focus, deterministic score) and everything from "รูปแบบ:" on
 * (every safety and style rule) is reused verbatim.
 */
function buildV3Prompt(f: Fixture) {
  const { prompt: v2, c } = buildV2Prompt(f);
  const start = spliceOnce(v2, 'คำสั่ง:');
  const end = spliceOnce(v2, 'รูปแบบ:');
  const instructions = renderPrompt(PROMPT_VERSION === 'v3.0' ? instructionsV30Md : instructionsMd, { p2Name: f.partner.name }).trimEnd();
  const prompt = `${v2.slice(0, start)}${extraDataBlock(f, c)}\n\n${instructions}\n\n${v2.slice(end)}\n${V3_SHAPE}`;
  return { prompt, c };
}

// ---------------------------------------------------------------- measurement

interface Attempt {
  ms: number;
  status: number;
  promptTokens?: number;
  completionTokens?: number;
  finishReason?: string;
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
        choices?: Array<{ finish_reason?: string }>;
      };
      attempt.promptTokens = data.usage?.prompt_tokens;
      attempt.completionTokens = data.usage?.completion_tokens;
      attempt.finishReason = data.choices?.[0]?.finish_reason;
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

/** v3 transport, same request body as production callDeepSeek; timeout is a measurement ceiling, not a budget. */
async function callV3(prompt: string, maxTokens: number, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.deepseek.apiKey}` },
      body: JSON.stringify({
        model: config.deepseek.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`DeepSeek ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error('Empty response');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

const graphemes = new Intl.Segmenter('th', { granularity: 'grapheme' });
const words = new Intl.Segmenter('th', { granularity: 'word' });
const graphemeCount = (v: string) => [...graphemes.segment(v)].length;

/** Every string leaf with its path, for per-field length calibration. */
function leaves(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  }
  return [];
}

function wordTrigrams(text: string): Set<string> {
  const toks = [...words.segment(text)].filter((w) => w.isWordLike).map((w) => w.segment);
  const out = new Set<string>();
  for (let i = 0; i + 2 < toks.length; i++) out.add(toks.slice(i, i + 3).join('|'));
  return out;
}

const ROMANCE = /แฟน|คนรัก|โรแมนติก|เดท|หวานใจ|ความรัก|จีบ/;
const PRONOUN_JAO = /เจ้า(?!ของ|หน้าที่|นาย|ภาพ|วัน|บ้าน)/;

interface Checks {
  flags: string[];
  maxSectionOverlap: number;
}

function autoChecks(f: Fixture, score: number, content: unknown, isV3: boolean): Checks {
  const flags: string[] = [];
  const strings = leaves(content).filter(([p]) => !p.endsWith('.section') && !p.includes('timing.basis'));
  const all = strings.map(([, v]) => v).join('\n');
  if (/\p{Extended_Pictographic}/u.test(all)) flags.push('emoji');
  if (/[—–]/.test(all)) flags.push('em/en dash');
  if (/[฀-๿]\s?-\s?[฀-๿]|\s-\s/.test(all)) flags.push('hyphen in prose');
  if (PRONOUN_JAO.test(all)) flags.push('เจ้า pronoun');
  if (new RegExp(`(?<!\\d)${score}(?!\\d)`).test(all)) flags.push(`score ${score} repeated`);
  if (/toxic|ท็อกซิก|นอกใจ/i.test(all)) flags.push('banned label');
  if (!all.includes(f.partner.name)) flags.push('partner name missing');
  const known = new Set([f.reader.mbti, f.partner.mbti].filter(Boolean));
  const codes = [...all.matchAll(/(?<![A-Z])[IE][NS][TF][JP](?![A-Z])/g)].map((m) => m[0]);
  const guessed = codes.filter((code) => !known.has(code));
  if (guessed.length) flags.push(`MBTI not in input: ${[...new Set(guessed)].join(',')}`);
  const stray = latinWords(content);
  if (stray.length) flags.push(`English words: ${[...new Set(stray)].join(',')}`);
  if (/ไม่ใช่ข้อสรุป|ไม่ใช่คำยืนยัน|เป็นแนวโน้มจากข้อมูล/.test(all)) flags.push('parroted tendency disclaimer');
  if (all.includes(` ${f.partner.name} `)) flags.push('spaces around partner name');
  if (/มักต้องการตอนเครียด/.test(all)) flags.push('copied the hint example');
  if (f.reader.gender === 'female' && /ผม|ครับ/.test(all)) flags.push('male pronoun for a female reader');
  if (f.partner.name.startsWith('คุณ') && all.includes(`พี่${f.partner.name.slice(3)}`)) flags.push('partner name changed');
  if (/คะแนน/.test(all)) flags.push('mentions the score');
  if (!['romantic', 'talking'].includes(f.relationshipType) && ROMANCE.test(all)) {
    flags.push(`romance wording in ${f.relationshipType}: "${all.match(ROMANCE)?.[0]}"`);
  }

  let maxSectionOverlap = 0;
  if (isV3) {
    const detail = (content as V3Content).detail;
    const sections = DETAIL_SECTIONS.map((key) => leaves(detail[key]).map(([, v]) => v).join(' '));
    const grams = sections.map(wordTrigrams);
    for (let i = 0; i < grams.length; i++) {
      for (let j = i + 1; j < grams.length; j++) {
        const inter = [...grams[i]].filter((g) => grams[j].has(g)).length;
        const union = new Set([...grams[i], ...grams[j]]).size || 1;
        maxSectionOverlap = Math.max(maxSectionOverlap, inter / union);
      }
    }
  }
  return { flags, maxSectionOverlap: Math.round(maxSectionOverlap * 100) / 100 };
}

interface RunRecord {
  fixture: string;
  arch: 'v2' | 'v3.0' | 'v3.2';
  run: number;
  totalMs: number;
  attempts: Attempt[];
  firstTryPass: boolean;
  finalPass: boolean;
  firstTryError?: string;
  error?: string;
  content?: unknown;
  lengths?: Record<string, { len: number; graphemes: number }>;
  checks?: Checks;
}

function lengthsOf(content: unknown) {
  return Object.fromEntries(leaves(content).map(([p, v]) => [p, { len: v.length, graphemes: graphemeCount(v) }]));
}

async function runV2(f: Fixture, run: number): Promise<RunRecord> {
  const { prompt, c } = buildV2Prompt(f);
  attemptLog = [];
  const t0 = performance.now();
  try {
    const content = await generateStructuredCompatibilityReading(prompt, TOKEN_LIMITS[f.relationshipType]);
    const attempts = attemptLog;
    return {
      fixture: f.id, arch: 'v2', run, totalMs: Math.round(performance.now() - t0), attempts,
      firstTryPass: attempts.length === 1, finalPass: true, content,
      lengths: lengthsOf(content), checks: autoChecks(f, c.score.score, content, false),
    };
  } catch (error) {
    return {
      fixture: f.id, arch: 'v2', run, totalMs: Math.round(performance.now() - t0), attempts: attemptLog,
      firstTryPass: false, finalPass: false, error: String(error),
    };
  }
}

async function runV3(f: Fixture, run: number, maxTokens: number): Promise<RunRecord> {
  const { prompt, c } = buildV3Prompt(f);
  attemptLog = [];
  const t0 = performance.now();
  let effective = prompt;
  let firstTryError: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string;
    try {
      text = await callV3(effective, maxTokens, 120_000);
    } catch (error) {
      return {
        fixture: f.id, arch: PROMPT_VERSION, run, totalMs: Math.round(performance.now() - t0), attempts: attemptLog,
        firstTryPass: false, finalPass: false, firstTryError, error: String(error),
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      firstTryError ??= 'invalid JSON';
      effective = `${prompt}\n\nYour previous response was not valid JSON. Return only the complete JSON object.`;
      continue;
    }
    const result = V3Schema.safeParse(parsed);
    // Lengths are recorded even on schema failure: that is what calibrates the bounds.
    const lengths = lengthsOf(parsed);
    if (result.success) {
      return {
        fixture: f.id, arch: PROMPT_VERSION, run, totalMs: Math.round(performance.now() - t0), attempts: attemptLog,
        firstTryPass: attempt === 0, finalPass: true, firstTryError, content: result.data, lengths,
        checks: autoChecks(f, c.score.score, result.data, true),
      };
    }
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    if (attempt === 1) {
      return {
        fixture: f.id, arch: PROMPT_VERSION, run, totalMs: Math.round(performance.now() - t0), attempts: attemptLog,
        firstTryPass: false, finalPass: false, firstTryError, error: issues, content: parsed, lengths,
      };
    }
    firstTryError = issues;
    effective = `${prompt}\n\nYour previous response did not match the required fields or length limits (${issues}). Return all fields as valid JSON.`;
  }
  throw new Error('unreachable');
}

// ---------------------------------------------------------------- report

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const RUNS = Number(arg('--runs', '1'));
const OUT = arg('--out', '');
const ONLY = arg('--only', 'v2,v3').split(',');
const MAX_TOKENS = Number(arg('--max-tokens', '4000'));
const PROMPT_VERSION = arg('--prompt', 'v3.2') as 'v3.0' | 'v3.2';
if (!OUT) throw new Error('--out <dir> is required (outputs never go into the repo)');
if (!config.deepseek.apiKey) throw new Error('DEEPSEEK_API_KEY is not set');
if (arg('--print-prompt', '') !== '') {
  const f = FIXTURES.find((x) => x.id === arg('--print-prompt', ''));
  if (!f) throw new Error('unknown fixture');
  console.log(buildV3Prompt(f).prompt);
  process.exit(0);
}
mkdirSync(OUT, { recursive: true });

const records: RunRecord[] = [];
for (let run = 1; run <= RUNS; run++) {
  for (const f of FIXTURES) {
    for (const arch of ONLY) {
      const rec = arch === 'v2' ? await runV2(f, run) : await runV3(f, run, MAX_TOKENS);
      records.push(rec);
      const tokens = rec.attempts.map((a) => a.completionTokens ?? '?').join('+');
      console.log(
        `[run ${run}] ${f.id.padEnd(26)} ${rec.arch.padEnd(9)} ${String(rec.totalMs).padStart(6)}ms ` +
          `attempts=${rec.attempts.length} out_tokens=${tokens} finish=${rec.attempts.map((a) => a.finishReason).join(',')} ` +
          `first=${rec.firstTryPass} final=${rec.finalPass}${rec.error ? ` error=${rec.error.slice(0, 160)}` : ''}` +
          `${rec.firstTryError ? ` firstErr=${rec.firstTryError.slice(0, 160)}` : ''}`,
      );
      writeFileSync(join(OUT, 'results.json'), JSON.stringify({ fixtures: FIXTURES, records }, null, 2));
    }
  }
}
console.log(`wrote ${join(OUT, 'results.json')}`);

