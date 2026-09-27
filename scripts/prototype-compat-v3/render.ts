#!/usr/bin/env bun
/**
 * Renders run.ts's results.json into a side-by-side markdown sample file:
 * latency and pass rates, length calibration, and per fixture the v2 output
 * next to the v3 teaser view and full view of the SAME stored v3 object.
 *
 *   bun scripts/prototype-compat-v3/render.ts --out out.md [--audit audit.md] [--show v3.2] results.json...
 *
 * Several results files merge into one report (v2 and each v3 prompt version
 * ran separately). --show picks the v3 version rendered per fixture; the
 * table and length calibration cover every version. audit.md (optional) holds
 * hand-written audits keyed by "## <fixture id>" headings.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { calculateBazi, calculateThaiAstrology, calculateCompatibility } from '../../lib/astrology';

type Json = Record<string, any>;
const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const [value] = argv.splice(i, 2).slice(1);
  return value;
};
const outPath = opt('--out');
const auditPath = opt('--audit');
const SHOW = opt('--show') ?? 'v3.2';
if (!outPath || argv.length === 0) throw new Error('usage: render.ts --out out.md [--audit a.md] [--show v3.2] results.json...');
let fixtures: Json[] = [];
const records: Json[] = [];
for (const path of argv) {
  const data = JSON.parse(readFileSync(path, 'utf8')) as { fixtures: Json[]; records: Json[] };
  fixtures = data.fixtures;
  // The first v3 run predates prompt versioning and was labelled v3-single.
  for (const r of data.records) records.push({ ...r, arch: r.arch === 'v3-single' ? 'v3.0' : r.arch });
}
const ARCHS = [...new Set(records.map((r) => r.arch))].sort();
const isV3 = (arch: string) => arch.startsWith('v3');

const audits = new Map<string, string>();
if (auditPath && existsSync(auditPath)) {
  const text = readFileSync(auditPath, 'utf8');
  for (const block of text.split(/^## /m).slice(1)) {
    const [head, ...rest] = block.split('\n');
    audits.set(head.trim(), rest.join('\n').trim());
  }
}

const pct = (xs: number[], p: number) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const median = (xs: number[]) => pct(xs, 50);
const sec = (ms: number) => (ms / 1000).toFixed(1);

const out: string[] = [];
const w = (line = '') => out.push(line);

w('# Compatibility v3 prototype samples');
w();
w(`Generated ${new Date().toISOString()} by \`horo-be/scripts/prototype-compat-v3/run.ts\` + \`render.ts\`.`);
w('All people are synthetic fixtures. No database, no real user data. Model: DeepSeek `deepseek-chat`, JSON mode, temperature 0.7, same system prompt as production.');
w('v2 = the unchanged production `generateStructuredCompatibilityReading`. v3 = one prompt, one call; the teaser view and the full view are two projections of the same stored JSON object.');
w('v3.0 = first draft prompt; v3.1 and v3.2 = prompt fixes for defects found in v3.0 (see "Prompt iterations"). v3.1 and v3.2 also reject English words in Thai prose at schema level, so those runs count a leak as a first-try failure followed by a repair call.');
w();

const preamble = audits.get('_preamble');
if (preamble) {
  w(preamble);
  w();
}

// ---- latency
w('## Latency and pass rate');
w();
w('| arch | calls | first-try schema pass | final pass | wall p50 | wall max | out tokens p50 | out tokens max | finish=length |');
w('|---|---|---|---|---|---|---|---|---|');
for (const arch of ARCHS) {
  const rs = records.filter((r) => r.arch === arch);
  if (rs.length === 0) continue;
  const ms = rs.map((r) => r.totalMs);
  const toks = rs.flatMap((r) => r.attempts.map((a: Json) => a.completionTokens ?? 0));
  const truncated = rs.flatMap((r) => r.attempts).filter((a: Json) => a.finishReason === 'length').length;
  w(
    `| ${arch} | ${rs.length} | ${rs.filter((r) => r.firstTryPass).length}/${rs.length} | ${rs.filter((r) => r.finalPass).length}/${rs.length} | ` +
      `${sec(median(ms))}s | ${sec(Math.max(...ms))}s | ${median(toks)} | ${Math.max(...toks)} | ${truncated} |`,
  );
}
w();

// ---- length calibration (v3 only, per field path with array indices collapsed)
const v3 = records.filter((r) => isV3(r.arch) && r.finalPass && r.lengths);
if (v3.length) {
  w('## v3 field lengths (for zod calibration)');
  w();
  w(`\`.length\` counts UTF-16 units (Thai marks inflate it); graphemes are what a reader sees. Across all ${v3.length} passing v3 runs (every prompt version).`);
  w();
  w('| field | len min | len p50 | len max | graphemes max |');
  w('|---|---|---|---|---|');
  const byField = new Map<string, { len: number[]; g: number[] }>();
  for (const r of v3) {
    for (const [path, v] of Object.entries(r.lengths as Record<string, { len: number; graphemes: number }>)) {
      const key = path.replace(/\[\d+\]/g, '[]');
      const entry = byField.get(key) ?? { len: [], g: [] };
      entry.len.push(v.len);
      entry.g.push(v.graphemes);
      byField.set(key, entry);
    }
  }
  for (const [key, v] of byField) {
    w(`| ${key} | ${Math.min(...v.len)} | ${median(v.len)} | ${Math.max(...v.len)} | ${Math.max(...v.g)} |`);
  }
  const totals = v3.map((r) => Object.values(r.lengths as Record<string, { len: number }>).reduce((a, b) => a + b.len, 0));
  w();
  w(`Total v3 text per reading: ${Math.min(...totals)} to ${Math.max(...totals)} UTF-16 units.`);
  w();
}

// ---- per fixture
const SECTION_TITLES: Record<string, string> = {
  dynamic: 'ภาพรวมของคู่นี้ (dynamic)',
  understandingPartner: 'เข้าใจอีกฝ่าย (understandingPartner)',
  yourSide: 'มุมของคุณ (yourSide)',
  communication: 'การคุยกัน (communication)',
  friction: 'จุดที่อาจเสียดทาน (friction)',
  timing: 'จังหวะเวลา (timing)',
  longTerm: 'ระยะยาว (longTerm)',
};

function teaserView(c: Json) {
  w('**Teaser view** (`view: \'teaser\'`)');
  w();
  w(`> **${c.teaser.verdict}**`);
  w('>');
  w(`> ${c.teaser.hook}`);
  w('>');
  for (const h of c.teaser.lockedHints) w(`> - [ล็อก] ${h.text} _(→ ${h.section})_`);
  w();
}

function fullView(c: Json) {
  w('**Full view** (`view: \'full\'`: the teaser above plus)');
  w();
  const d = c.detail;
  w(`- **${SECTION_TITLES.dynamic}**: ${d.dynamic}`);
  w(`- **${SECTION_TITLES.understandingPartner}**: ${d.understandingPartner}`);
  w(`- **${SECTION_TITLES.yourSide}**: ${d.yourSide}`);
  w(`- **${SECTION_TITLES.communication}**:`);
  d.communication.forEach((x: Json, i: number) => w(`  ${i + 1}. ทำ: ${x.do}<br>เลี่ยง: ${x.avoid}`));
  w(`- **${SECTION_TITLES.friction}**:`);
  d.friction.forEach((x: Json, i: number) => w(`  ${i + 1}. ${x.scenario}<br>ซ่อม: ${x.repair}`));
  w(`- **${SECTION_TITLES.timing}**: ${d.timing.advice} _(basis: ${d.timing.basis.join(', ')})_`);
  w(`- **${SECTION_TITLES.longTerm}**: ${d.longTerm}`);
  w(`- **nextSteps**: action: ${d.nextSteps.action}<br>conversationStarter: ${d.nextSteps.conversationStarter}<br>watchFor: ${d.nextSteps.watchFor}`);
  w();
}

function v2View(c: Json) {
  w('**v2 (current production)**');
  w();
  w(`- **verdict**: ${c.verdict}`);
  w(`- **chemistry**: ${c.chemistry}`);
  w(`- **caution**: ${c.caution}`);
  w(`- **advice**: ${c.advice}`);
  w(`- **nextSteps**: action: ${c.nextSteps.action}<br>conversationStarter: ${c.nextSteps.conversationStarter}<br>watchFor: ${c.nextSteps.watchFor}`);
  w();
}

for (const f of fixtures) {
  const readerDate = new Date(f.reader.birthDate);
  const partnerDate = new Date(f.partner.birthDate);
  const rb = calculateBazi(readerDate, f.reader.birthHour, f.reader.gender);
  const pb = calculateBazi(partnerDate, undefined, 'female');
  const rt = calculateThaiAstrology(readerDate);
  const pt = calculateThaiAstrology(partnerDate);
  const score = calculateCompatibility(rb, pb).score;

  w(`## ${f.id}`);
  w();
  w(`Relationship: **${f.relationshipType}** · score ${score}`);
  w();
  w('| | element / day master | Thai day / planet | MBTI |');
  w('|---|---|---|---|');
  w(`| คุณ (reader) | ${rb.element} / ${rb.dayMaster} | ${rt.day} / ${rt.planet} | ${f.reader.mbti ?? '(none)'} |`);
  w(`| ${f.partner.name} | ${pb.element} / ${pb.dayMaster} | ${pt.day} / ${pt.planet} | ${f.partner.mbti ?? '(none)'} |`);
  w();

  const rs = records.filter((r) => r.fixture === f.id);
  const runLine = rs
    .map((r) => `${r.arch} r${r.run}: ${sec(r.totalMs)}s ${r.firstTryPass ? 'pass' : r.finalPass ? 'pass after repair' : 'FAIL'}${r.checks?.flags?.length ? ` flags=[${r.checks.flags.join('; ')}]` : ''}`)
    .join(' · ');
  w(`<sub>${runLine}</sub>`);
  w();

  const v2 = rs.find((r) => r.arch === 'v2' && r.run === 1 && r.content);
  const v3r = rs.find((r) => r.arch === SHOW && r.run === 1 && r.content && r.finalPass);
  if (v2) v2View(v2.content);
  if (v3r) {
    w(`<sub>v3 sample below: prompt ${SHOW}, run 1</sub>`);
    w();
    teaserView(v3r.content);
    fullView(v3r.content);
  }
  const audit = audits.get(f.id);
  if (audit) {
    w('**Self-audit (coder)**');
    w();
    w(audit);
    w();
  }
  w('---');
  w();
}

writeFileSync(outPath, out.join('\n'));
console.log(`wrote ${outPath}`);
