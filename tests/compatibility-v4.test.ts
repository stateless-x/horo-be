import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { overrideFlags } from '../src/lib/feature-flags';
import {
  COMPATIBILITY_DEV_FIXTURES,
  type CompatibilityV4Content,
  type CompatibilityV4Stored,
  shapeCompatibilityView,
  shareCompatibilityV4,
  V4InsightPlanSchema,
  V4_HINT_MAX,
  type MbtiType,
  type RelationshipType,
  type V4SectionKey,
} from '../lib/shared';
import { bestMonth, ELEMENT_CONTROLLING, ELEMENT_PRODUCING, relationshipCalendar } from '../lib/astrology';
import { parseCompatibilityContent } from '../src/lib/compatibility-content';

/** A current row carrying `stored`, as the read path sees it. */
const currentRow = (stored: unknown) => ({ id: 'row-t', analysis: JSON.stringify(stored), contentVersion: 4 });
import {
  calculateCompatibilityCharts,
  generateCompatibilityV4,
  generateCompatibilityV4Detail,
  generateCompatibilityV4Stored,
} from '../src/lib/compatibility-generation';
import { GenerationSingleFlight } from '../src/lib/generation-singleflight';
import {
  historyItem,
  readingResponse,
  shareResponse,
  unlockReading,
  type CompatibilityRow,
  type UnlockStore,
} from '../src/systems/compatibility/reading';
import { elementsNamed, foreignElementWords } from '../src/lib/compatibility-text';
import { ELEMENT_IMAGE } from '../src/lib/prompts';
import { relationshipChapterTitles, relationshipPromptProfile } from '../src/lib/prompts/relationship-profile';
import { PRODUCT_PRICES } from '../src/lib/pricing';
import { InsufficientBalance, createWallet, wallet, type WalletTx } from '../src/lib/wallet';
import { INSUFFICIENT_BALANCE } from '../lib/shared/types/wallet';
import { eq } from 'drizzle-orm';
import { createDbClient, orders, user, walletLedger } from '../lib/db';
import { isLocalDatabaseUrl } from '../src/lib/dev-regenerate';
import { fulfilPaidOrder } from '../src/lib/order-fulfilment';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const fixture = COMPATIBILITY_DEV_FIXTURES.find((f) => f.id === 'romantic-both-mbti')!;
const input = {
  reader: { birthDate: new Date(fixture.reader.birthDate), birthHour: fixture.reader.birthHour, gender: fixture.reader.gender, mbtiType: fixture.reader.mbti as MbtiType },
  partner: { name: fixture.partner.name, birthDate: new Date(fixture.partner.birthDate), mbtiType: fixture.partner.mbti as MbtiType },
  relationshipType: fixture.relationshipType,
  now: new Date('2026-09-27T05:00:00Z'),
};
const name = fixture.partner.name;

/** Thai filler of about `words` words that names the partner, so the quality checks pass. */
const prose = (words: number, lead = '') =>
  (lead + `${name}กับคุณคุยกันได้ดีเมื่อบอกความต้องการให้ชัด `.repeat(Math.ceil(words / 9))).trim();
const chapter = (extra = '') => ({ summary: prose(12), pullQuote: prose(4), detail: prose(160, extra), move: prose(12) });

const INSIGHTS = {
  insights: [
    { text: prose(10), basis: ['dayBranch'], chapter: 'attraction' },
    { text: prose(10), basis: ['partnerMbti'], chapter: 'partner' },
    { text: prose(10), basis: ['readerMbti'], chapter: 'you' },
    { text: prose(10), basis: ['element'], chapter: 'communication' },
    { text: prose(10), basis: ['yearBranch'], chapter: 'friction' },
    { text: prose(10), basis: ['month1'], chapter: 'future' },
  ],
};

function sections(overrides: Partial<Record<V4SectionKey, unknown>> = {}): Record<V4SectionKey, unknown> {
  return {
    cover: {
      // Reader metal, partner fire: the verdict names the pair's elements.
      verdict: `ไฟของ${name}หลอมทองของคุณ ดึงกันด้วยความต่างที่ต้องคุยให้ชัด`,
      lockedHints: [
        { text: `ทำไม${name}ถึงเงียบเมื่อแผนเปลี่ยนกะทันหัน`, chapter: 'partner' },
        { text: 'สิ่งที่คุณเก็บไว้คนเดียวจนเรื่องเล็กกลายเป็นเรื่องใหญ่', chapter: 'you' },
        { text: `ประโยคไหนที่ทำให้${name}ฟังคุณจนจบ`, chapter: 'communication' },
      ],
    },
    overview: {
      story: prose(80),
      dimensionLines: { chemistry: prose(8), communication: prose(8), trust: prose(8), rhythm: prose(8) },
    },
    attraction: chapter('นักษัตรวันเกิดของทั้งสองคนประสานกัน '),
    partner: chapter(),
    you: chapter(),
    communication: { ...chapter(), pairs: [0, 1, 2].map(() => ({ do: prose(6), avoid: prose(6) })), lines: [prose(6), prose(6), prose(6)] },
    friction: { ...chapter(), scenarios: [0, 1].map(() => ({ scenario: prose(8, 'ถ้า'), repair: prose(8) })) },
    future: {
      ...chapter(),
      goSignals: [prose(5), prose(5)],
      slowSignals: [prose(5), prose(5)],
      nextStep: { month: '2026-10', step: prose(10) },
    },
    calendar: ['2026-10', '2026-11', '2026-12'].map((month) => ({ month, text: prose(8) })),
    plan: [1, 3, 6].map((day) => ({ day, action: prose(6), conversationStarter: prose(6), watchFor: prose(6) })),
    ...overrides,
  };
}

const reply = (value: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { status: 200 });

/**
 * Answers each DeepSeek call with the plan, or with exactly the sections that
 * call's shape asks for, taken from `source` (which may vary per call).
 */
function mockModel(
  source: (sectionKeys: V4SectionKey[], messages: string[]) => Record<V4SectionKey, unknown>,
  options: { plan?: unknown; onPrompt?: (prompt: string) => void } = {},
) {
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    const prompt = body.messages[1].content;
    options.onPrompt?.(prompt);
    if (prompt.includes('{ "insights"')) return reply(options.plan ?? INSIGHTS);
    const all = sections();
    const keys = (Object.keys(all) as V4SectionKey[]).filter((key) => prompt.includes(`  "${key}": `));
    const chosen = source(keys, body.messages.map((m) => m.content));
    return reply(Object.fromEntries(keys.map((key) => [key, chosen[key]])));
  }) as unknown as typeof fetch;
}

describe('generateCompatibilityV4', () => {
  test('merges the computed facts with the written sections', async () => {
    mockModel(() => sections());
    let calls = 0;
    const result = await generateCompatibilityV4({ ...input, onModelCall: () => calls++ });
    const { content } = result;

    expect(calls).toBe(5); // the plan, then the cover and three detail calls
    expect(content.contentVersion).toBe(4);
    expect(content.generatedOn).toBe('2026-09-27');
    expect(content.dimensions.map((d) => d.key)).toEqual(['chemistry', 'communication', 'trust', 'rhythm']);
    expect(content.chapters.map((c) => c.key)).toEqual(['attraction', 'partner', 'you', 'communication', 'friction', 'future']);
    expect(content.chapters[1].title).toBe(`ตัวตนของ${name}ในความสัมพันธ์นี้`);
    expect(content.calendar.map((m) => m.month)).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(result.qualityFlags).toEqual([]);
    // Computed, not written: the cover's people, the attraction basis, the reading time.
    // MBTI steers the prose but is never part of what a client can receive.
    expect(content.people.reader).toEqual({ element: 'metal', yinYang: expect.any(String) });
    expect(JSON.stringify(content)).not.toContain(fixture.reader.mbti);
    expect(JSON.stringify(content)).not.toContain(fixture.partner.mbti);
    expect(content.people.partner.element).toBe('fire');
    expect(content.palace.reader.naksat).toBeString();
    // Nine parts (overview, six chapters, calendar, plan), at least a minute each.
    expect(content.readingMinutes).toBeGreaterThanOrEqual(9);
  });

  test('the model never sets a month label; a wrong month key costs a repair naming it', async () => {
    const wrong = sections({ calendar: ['2026-09', '2026-11', '2026-12'].map((month) => ({ month, text: prose(8) })) });
    const calendarCalls: string[][] = [];
    mockModel((keys, messages) => {
      if (!keys.includes('calendar')) return sections();
      calendarCalls.push(messages);
      return calendarCalls.length === 1 ? wrong : sections();
    });

    const { content } = await generateCompatibilityV4(input);
    expect(calendarCalls).toHaveLength(2);
    expect(calendarCalls[1].at(-1)).toContain('calendar.0.month: must be 2026-10');
    expect(content.calendar[0].month).toBe('2026-10');
  });

  test('an element neither person has is a failure in the core fields and a flag elsewhere', async () => {
    // Reader metal, partner fire: water is neither.
    mockModel(() => sections({ attraction: chapter('ธาตุน้ำของคุณกับนักษัตรวันเกิดของทั้งสองคน ') }));
    await expect(generateCompatibilityV4(input)).rejects.toThrow('Names element น้ำ');

    mockModel(() => sections({ you: chapter('ธาตุน้ำในตัวคุณทำให้ใจเย็น ') }));
    const result = await generateCompatibilityV4(input);
    expect(result.qualityFlags.some((flag) => flag.startsWith('you.detail: Names element น้ำ'))).toBe(true);
  });
});

describe('v4 prompt facts', () => {
  test('asks the plan to offer relationship care, not a dated checklist', async () => {
    const prompts: string[] = [];
    mockModel(() => sections(), { onPrompt: (prompt) => prompts.push(prompt) });

    await generateCompatibilityV4(input);

    const allPrompts = prompts.join('\n');
    expect(allPrompts).toContain('แม่หมอที่รับฟังเก่งและเข้าใจความสัมพันธ์');
    expect(allPrompts).toContain('3 โมเมนต์เล็ก ๆ ตามเป้าหมาย การดูแลความใกล้ชิด ความไว้ใจ และขอบเขตของทั้งคู่');
    expect(allPrompts).toContain('ห้ามอ้างถึงวัน กำหนดเวลา หรือเดดไลน์');
    expect(allPrompts).toContain('ไม่อ้างว่าเป็นการบำบัด');
  });

  test('adapts every report section to the relationship type without changing the shared contract', async () => {
    const expected: Record<RelationshipType, string[]> = {
      romantic: ['ความสัมพันธ์ของคนรักหรือคู่ครอง', 'ความใกล้ชิด ความไว้ใจ และขอบเขตของทั้งคู่'],
      talking: ['ช่วงกำลังทำความรู้จักกันของคนคุย', 'ไม่เร่งสถานะหรือกดดันคำตอบ'],
      friend: ['มิตรภาพของทั้งสองคน', 'ไม่บังคับให้มิตรภาพกลับไปเหมือนเดิมทันที'],
      boss: ['ลูกน้องกับหัวหน้า', 'นิยามว่างานเสร็จคืออะไร'],
      coworker: ['ระหว่างเพื่อนร่วมงาน', 'เจ้าของงาน จุดส่งมอบ กำหนดเวลา'],
      family: ['ความสัมพันธ์ของคนในครอบครัว', 'ไม่ใช้อำนาจ อายุ หรือบุญคุณกดอีกฝ่าย'],
    };

    for (const relationshipType of Object.keys(expected) as RelationshipType[]) {
      const prompts: string[] = [];
      mockModel(() => sections(), { onPrompt: (prompt) => prompts.push(prompt) });
      await generateCompatibilityV4({ ...input, relationshipType });
      const allPrompts = prompts.join('\n');
      for (const phrase of expected[relationshipType]) expect(allPrompts).toContain(phrase);
      expect(allPrompts).toContain(relationshipPromptProfile(relationshipType).futureTitle);
      expect(allPrompts).toContain('"plan"');
    }

    for (const relationshipType of ['boss', 'coworker'] as const) {
      const profile = relationshipPromptProfile(relationshipType);
      expect(profile.attractionGoal).toContain('ห้ามใช้ภาษาเชิงโรแมนติก');
      expect(profile.planGoal).not.toContain('ใกล้ชิด');
    }

    expect(relationshipChapterTitles('boss', 'เมย์')).toEqual({
      attraction: 'จุดที่สไตล์งานส่งเสริมกัน',
      partner: 'สไตล์การทำงานของเมย์',
      you: 'สไตล์การทำงานของคุณ',
      communication: 'คุยงานให้เข้าใจตรงกัน',
      friction: 'จุดติดขัดและวิธีเคลียร์งาน',
      future: 'โตไปด้วยกันในงาน',
    });
  });

  test('uses personality signals privately, without exposing a type label to the model', async () => {
    const prompts: string[] = [];
    const readerName = 'ฟ้า';
    mockModel(() => sections(), { onPrompt: (prompt) => prompts.push(prompt) });

    await generateCompatibilityV4({ ...input, reader: { ...input.reader, name: readerName } });

    const allPrompts = prompts.join('\n');
    expect(allPrompts).toContain('คุณเป็นคนที่มักจะ');
    expect(allPrompts).toContain(`${name}เป็นคนที่มักจะ`);
    expect(allPrompts).not.toContain(readerName);
    expect(allPrompts).not.toContain(fixture.reader.mbti);
    expect(allPrompts).not.toContain(fixture.partner.mbti);
    expect(allPrompts).not.toContain('MBTI');
  });

  test('addresses the reader as คุณ while retaining the target name in every relationship context', async () => {
    const readerName = 'ชื่อเล่นแปลกมาก';
    for (const relationshipType of ['romantic', 'talking', 'friend', 'boss', 'coworker', 'family'] as const) {
      const prompts: string[] = [];
      mockModel(() => sections(), { onPrompt: (prompt) => prompts.push(prompt) });

      await generateCompatibilityV4({ ...input, relationshipType, reader: { ...input.reader, name: readerName } });

      const allPrompts = prompts.join('\n');
      expect(allPrompts).toContain('เรียกผู้อ่านว่า “คุณ” เท่านั้น');
      expect(allPrompts).toContain(name);
      expect(allPrompts).not.toContain(readerName);
    }
  });

  test('uses astrology alone when neither person supplied personality data', async () => {
    const prompts: string[] = [];
    const astrologyOnlyPlan = {
      insights: [
        { text: prose(10), basis: ['dayBranch'], chapter: 'attraction' },
        { text: prose(10), basis: ['partnerThaiDay'], chapter: 'partner' },
        { text: prose(10), basis: ['readerThaiDay'], chapter: 'you' },
        { text: prose(10), basis: ['element'], chapter: 'communication' },
        { text: prose(10), basis: ['yearBranch'], chapter: 'friction' },
        { text: prose(10), basis: ['month1'], chapter: 'future' },
      ],
    };
    mockModel(() => sections(), { plan: astrologyOnlyPlan, onPrompt: (prompt) => prompts.push(prompt) });

    await generateCompatibilityV4({
      ...input,
      reader: { ...input.reader, mbtiType: null },
      partner: { ...input.partner, mbtiType: null },
    });

    const allPrompts = prompts.join('\n');
    expect(allPrompts).not.toContain(`ข้อมูลแนวโน้มพฤติกรรมส่วนตัวของคุณ ใช้หลังฉากเท่านั้น`);
    expect(allPrompts).not.toContain(`ข้อมูลแนวโน้มพฤติกรรมส่วนตัวของ${name} ใช้หลังฉากเท่านั้น`);
    expect(allPrompts).not.toContain('readerMbti');
    expect(allPrompts).not.toContain('partnerMbti');
  });

  test('a neutral palace reads as open, and the element image leads; dimension levels carry no number', async () => {
    // The fixture pair has a neutral spouse palace and year branch; partner fire controls reader metal.
    const prompts: string[] = [];
    mockModel((_keys, messages) => {
      prompts.push(messages[1]);
      return sections();
    });
    await generateCompatibilityV4(input);
    const facts = prompts[0];
    expect(facts).not.toContain('ไม่มีแรง');
    expect(facts).toContain('ตำแหน่งคู่ในดวง (นักษัตรวันเกิดของทั้งสองคน): เปิดทางให้กัน');
    expect(facts).toMatch(/1\. ธาตุ: ธาตุของต้นข่มธาตุของคุณ ภาพของคู่นี้คือ ไฟหลอมทอง/);
    expect(facts).toContain('chemistry เคมี: ระดับ');
    expect(facts).not.toMatch(/chemistry เคมี \d/);
  });

  test('every element pair has an image that names only its own elements', () => {
    const elements = ['wood', 'fire', 'earth', 'metal', 'water'] as const;
    for (const from of elements) {
      for (const to of elements) {
        if (from !== to && ELEMENT_PRODUCING[from] !== to && ELEMENT_CONTROLLING[from] !== to) continue;
        const image = ELEMENT_IMAGE[`${from}-${to}`];
        expect(image).toBeString();
        expect(foreignElementWords(image, [from, to])).toEqual([]);
        expect(elementsNamed(image).sort()).toEqual([...new Set([from, to])].sort());
      }
    }
    expect(Object.keys(ELEMENT_IMAGE)).toHaveLength(15);
  });
});

describe('v4 headline rules', () => {
  const withVerdict = (verdict: string) => sections({ cover: { ...(sections().cover as object), verdict } });
  const SILENT = `ดวงของคุณกับ${name}ไม่มีแรงดึงหรือแรงปะทะจากฟ้า แต่ไฟของ${name}กับทองของคุณต้องคุยให้ชัด`;
  const UNANCHORED = `${name}กับคุณดึงกันด้วยความต่างที่ต้องคุยให้ชัด`;

  /** Answers the cover call with `replies` in turn (the last one repeats); the other calls get valid sections. */
  function coverReplies(replies: Array<Record<V4SectionKey, unknown>>) {
    const calls: string[][] = [];
    mockModel((keys, messages) => {
      if (!keys.includes('cover')) return sections();
      calls.push(messages);
      return replies[Math.min(calls.length, replies.length) - 1];
    });
    return calls;
  }

  test('a silent-chart verdict is repaired, and fails the reading if it stays', async () => {
    const calls = coverReplies([withVerdict(SILENT), sections()]);
    const { content } = await generateCompatibilityV4(input);
    expect(calls[1].at(-1)).toContain('ไม่มีแรงดึง" says the chart is silent');
    expect(content.cover.verdict).toBe((sections().cover as { verdict: string }).verdict);

    coverReplies([withVerdict(SILENT)]);
    await expect(generateCompatibilityV4(input)).rejects.toThrow('says the chart is silent');
  });

  test('a dimension line with a number is repaired, and fails the reading if it stays', async () => {
    const overview = sections().overview as { story: string; dimensionLines: Record<string, string> };
    const bad = sections({
      overview: { ...overview, dimensionLines: { ...overview.dimensionLines, chemistry: `เคมีอยู่ที่ 57 จาก 100 ${prose(8)}` } },
    });
    const calls: string[][] = [];
    mockModel((keys, messages) => {
      if (!keys.includes('overview')) return sections();
      calls.push(messages);
      return calls.length === 1 ? bad : sections();
    });
    await generateCompatibilityV4(input);
    expect(calls[1].at(-1)).toContain('overview.dimensionLines.chemistry: has a number');

    mockModel(() => bad);
    await expect(generateCompatibilityV4(input)).rejects.toThrow('has a number');
  });

  test('a personality framework label is repaired before readers can see it', async () => {
    const cover = sections().cover as { verdict: string };
    const bad = sections({ cover: { ...cover, verdict: `${cover.verdict} ซึ่งสะท้อนจากเอ็มบีทีไอ` } });
    const calls = coverReplies([bad, sections()]);

    await generateCompatibilityV4(input);

    expect(calls).toHaveLength(2);
    expect(calls[1].at(-1)).toContain('exposes a private personality framework');
  });

  test('a known typo is corrected without a repair turn', async () => {
    mockModel(() => sections({ attraction: chapter('ช่วยกันเขียงลำดับ นักษัตรวันเกิดของทั้งสองคนประสานกัน ') }));
    let calls = 0;
    const { content } = await generateCompatibilityV4({ ...input, onModelCall: () => calls++ });
    expect(calls).toBe(5);
    expect(content.chapters[0].detail).toContain('ช่วยกันเรียงลำดับ');
  });

  test('a verdict with no concrete from the chart gets the quality repair', async () => {
    const calls = coverReplies([withVerdict(UNANCHORED), sections()]);
    const result = await generateCompatibilityV4(input);
    expect(calls).toHaveLength(2);
    expect(calls[1].at(-1)).toContain('cover.verdict: fits any pair');
    expect(result.qualityFlags).toEqual([]);
  });

  test('when the quality repair breaks a rule and the repairs run out, the valid reply before it is kept and flagged', async () => {
    const calls = coverReplies([withVerdict(UNANCHORED), withVerdict(SILENT)]);
    const result = await generateCompatibilityV4(input);
    expect(calls).toHaveLength(3);
    expect(result.content.cover.verdict).toBe(UNANCHORED);
    expect(result.qualityFlags.some((flag) => flag.startsWith('cover.verdict: fits any pair'))).toBe(true);
  });
});

describe('partner names that are ordinary words', () => {
  /** The fixture's replies with the partner called `partner` everywhere. */
  const renamed = (partner: string) => JSON.parse(JSON.stringify(sections()).replaceAll(name, partner)) as Record<V4SectionKey, unknown>;
  const named = (partner: string) => ({ ...input, partner: { ...input.partner, name: partner } });

  // Reader metal, partner fire: น้ำ is neither person's element, and ดาว was read as a planet in every hint.
  for (const partner of ['ดาว', 'ดาวใจ', 'น้ำ', 'ไฟ', 'ทอง']) {
    test(`${partner}: the full report and the locked teaser pass with no repair`, async () => {
      mockModel(() => renamed(partner));
      let calls = 0;
      const full = await generateCompatibilityV4({ ...named(partner), onModelCall: () => calls++ });
      expect(calls).toBe(5);
      expect(full.qualityFlags).toEqual([]);

      const { stored } = await generateCompatibilityV4Stored({ ...named(partner), withDetail: false });
      expect(stored.teaser.cover.lockedHints[0].text).toContain(partner);
      // The read path parses the stored row with the same schema.
      expect(parseCompatibilityContent(currentRow(stored)).contentVersion).toBe(4);
    });
  }

  // Names with regex characters. A balanced one built a wrong pattern in the detail stage's
  // quality check (every move and plan action flagged as not naming the partner); an
  // unbalanced one threw in the first section call, the free cover stage, and failed the check.
  test('บีม (ตัวจริง): the detail checks match the name literally', async () => {
    mockModel(() => renamed('บีม (ตัวจริง)'));
    let calls = 0;
    const full = await generateCompatibilityV4({ ...named('บีม (ตัวจริง)'), onModelCall: () => calls++ });
    expect(full.qualityFlags).toEqual([]);
    expect(calls).toBe(5);
  });

  test('(บีม: the free cover stage does not throw', async () => {
    mockModel(() => renamed('(บีม'));
    let calls = 0;
    const { stored } = await generateCompatibilityV4Stored({ ...named('(บีม'), withDetail: false, onModelCall: () => calls++ });
    expect(calls).toBe(2); // the plan and the cover, no repair
    expect(stored.teaser.cover.verdict).toContain('(บีม');
  });

  // Latin letters, symbols and digits: every rule reads the reply with the name masked once.
  // มูหนึ่ง2242 failed the dimension lines' no-digits rule on every retry (local row 29cc29e2).
  for (const partner of ['Mind', 'A+', 'น้อง*', 'มูหนึ่ง2242']) {
    test(`${partner}: cover and detail pass with no repair, and the stored row parses back`, async () => {
      mockModel(() => renamed(partner));
      let calls = 0;
      const full = await generateCompatibilityV4({ ...named(partner), onModelCall: () => calls++ });
      expect(calls).toBe(5);
      expect(full.qualityFlags).toEqual([]);

      const { stored } = await generateCompatibilityV4Stored({ ...named(partner), withDetail: true });
      const parsed = parseCompatibilityContent(currentRow(stored));
      expect(parsed.contentVersion).toBe(4);
      expect(JSON.stringify(parsed)).toContain(JSON.stringify(partner).slice(1, -1));
    });
  }

  test('Mind: a real foreign word in prose still gets the repair, which names it', async () => {
    const good = renamed('Mind');
    const cover = good.cover as { verdict: string };
    const coverCalls: string[][] = [];
    mockModel((keys, messages) => {
      if (!keys.includes('cover')) return good;
      coverCalls.push(messages);
      return coverCalls.length === 1 ? { ...good, cover: { ...cover, verdict: `${cover.verdict} naturally` } } : good;
    });
    await generateCompatibilityV4({ ...named('Mind') });
    expect(coverCalls).toHaveLength(2);
    expect(coverCalls[1].at(-1)).toContain('cover.verdict: Non-Thai text in prose: "naturally"');
  });

  test('ดาว: a real jargon hint gets the repair, which names it', async () => {
    const good = renamed('ดาว');
    const cover = good.cover as { verdict: string; lockedHints: Array<{ text: string; chapter: string }> };
    const jargon = { ...cover, lockedHints: [{ ...cover.lockedHints[0], text: 'ทำไมธาตุดินของดาวถึงเงียบเมื่อแผนเปลี่ยน' }, ...cover.lockedHints.slice(1)] };
    const coverCalls: string[][] = [];
    mockModel((keys, messages) => {
      if (!keys.includes('cover')) return good;
      coverCalls.push(messages);
      return coverCalls.length === 1 ? { ...good, cover: jargon } : good;
    });
    const { stored } = await generateCompatibilityV4Stored({ ...named('ดาว'), withDetail: false });
    expect(coverCalls).toHaveLength(2);
    expect(coverCalls[1].at(-1)).toContain('"ธาตุ" is an astrology or MBTI term');
    expect(stored.teaser.cover.lockedHints[0].text).toBe(cover.lockedHints[0].text);
  });

  test('ดาว: a planet in a hint is still jargon, and fails the reading if it stays', async () => {
    const cover = renamed('ดาว').cover as { verdict: string; lockedHints: Array<{ text: string; chapter: string }> };
    const planet = { ...cover, lockedHints: [{ ...cover.lockedHints[0], text: 'ทำไมดาวอังคารทำให้ดาวเงียบเมื่อแผนเปลี่ยน' }, ...cover.lockedHints.slice(1)] };
    mockModel(() => ({ ...renamed('ดาว'), cover: planet }));
    await expect(generateCompatibilityV4Stored({ ...named('ดาว'), withDetail: false })).rejects.toThrow(
      'is an astrology or MBTI term',
    );
  });
});

describe('reader names that are ordinary words, English or digits', () => {
  type Cover = { verdict: string; lockedHints: Array<{ text: string; chapter: string }> };
  type Overview = { story: string; dimensionLines: Record<string, string> };
  /**
   * The fixture's replies naming the reader where a check would read the name
   * as a word: the verdict (Mind is English), the "you" hint (ดาว is jargon in
   * a hint) and a dimension line (มู2242 has a number).
   */
  const namingReader = (reader: string): Record<V4SectionKey, unknown> => {
    const all = sections();
    const cover = all.cover as Cover;
    const overview = all.overview as Overview;
    return {
      ...all,
      cover: {
        verdict: `${reader}กับ${cover.verdict}`,
        lockedHints: cover.lockedHints.map((hint) =>
          hint.chapter === 'you' ? { ...hint, text: `ทำไม${reader}ถึงเก็บเรื่องเล็กไว้คนเดียวจนกลายเป็นเรื่องใหญ่` } : hint,
        ),
      },
      overview: { ...overview, dimensionLines: { ...overview.dimensionLines, chemistry: `${reader}กับ${overview.dimensionLines.chemistry}` } },
    };
  };
  const readerCalled = (reader?: string) => ({ ...input, reader: { ...input.reader, name: reader } });

  for (const [reader, rule] of [
    ['ดาว', 'is an astrology or MBTI term'],
    ['Mind', 'Non-Thai text in prose'],
    ['มู2242', 'has a number'],
  ] as const) {
    test(`${reader}: the report passes with no repair, teaser now and detail on unlock too`, async () => {
      mockModel(() => namingReader(reader));
      let calls = 0;
      const full = await generateCompatibilityV4({ ...readerCalled(reader), onModelCall: () => calls++ });
      expect(calls).toBe(5);
      expect(full.qualityFlags).toEqual([]);

      const { stored } = await generateCompatibilityV4Stored({ ...readerCalled(reader), withDetail: false });
      expect(stored.inputs.reader.name).toBe(reader);
      calls = 0;
      await generateCompatibilityV4Detail(stored, { partner: { name }, relationshipType: fixture.relationshipType, onModelCall: () => calls++ });
      expect(calls).toBe(3);
    });

    test(`${reader}: the same text without a supplied reader name still fails (${rule})`, async () => {
      mockModel(() => namingReader(reader));
      await expect(generateCompatibilityV4({ ...readerCalled(undefined), maxRepairs: 1 })).rejects.toThrow(rule);
    });
  }
});

describe('Latin names in the stored text', () => {
  test('a Latin partner and reader are spaced from the Thai around them; a Thai partner is not', async () => {
    const replies = (partner: string) =>
      JSON.parse(JSON.stringify(sections()).replaceAll(name, partner).replaceAll('หลอมทองของคุณ', 'หลอมทองของMind')) as Record<V4SectionKey, unknown>;
    mockModel(() => replies('Ice'));
    const iceInput = { ...input, reader: { ...input.reader, name: 'Mind' }, partner: { ...input.partner, name: 'Ice' } };
    const { content } = await generateCompatibilityV4(iceInput);
    expect(content.cover.verdict).toBe('ไฟของ Ice หลอมทองของ Mind ดึงกันด้วยความต่างที่ต้องคุยให้ชัด');
    expect(content.chapters.find((c) => c.key === 'partner')?.title).toBe('ตัวตนของ Ice ในความสัมพันธ์นี้');
    expect(JSON.stringify(content)).not.toMatch(/[\u0E00-\u0E7F](?:Ice|Mind)|(?:Ice|Mind)[\u0E00-\u0E7F]/);

    mockModel(() => replies('ต้น'));
    const thai = await generateCompatibilityV4({ ...iceInput, partner: { ...input.partner, name: 'ต้น' } });
    expect(thai.content.cover.verdict).toBe('ไฟของต้นหลอมทองของ Mind ดึงกันด้วยความต่างที่ต้องคุยให้ชัด');
  });
});

describe('locked hint length', () => {
  const cover = sections().cover as { verdict: string; lockedHints: Array<{ text: string; chapter: string }> };
  const long = `${cover.lockedHints[0].text} ${'แล้วคุณก็เลือกเงียบต่อไปอีกหลายวันโดยไม่ได้ถามอะไรเลย '.repeat(4)}`.trim();
  const short = `ทำไม${name}ถึงเงียบทุกครั้งที่แผนของคุณเปลี่ยนกะทันหัน`;

  /** The cover call answers with one hint over the cap; the hint rewrite call answers with `rewrite`. */
  function model(rewrite: unknown) {
    const calls = { cover: [] as string[][], rewrite: [] as string[] };
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      const prompt = body.messages[1].content;
      if (prompt.includes('{ "insights"')) return reply(INSIGHTS);
      if (prompt.includes('{ "texts"')) {
        calls.rewrite.push(prompt);
        return reply(rewrite);
      }
      calls.cover.push(body.messages.map((m) => m.content));
      return reply({ cover: { ...cover, lockedHints: [{ ...cover.lockedHints[0], text: long }, ...cover.lockedHints.slice(1)] } });
    }) as unknown as typeof fetch;
    return calls;
  }

  test('a hint over the cap is rewritten alone; the cover gets no whole repair', async () => {
    expect(long.length).toBeGreaterThan(V4_HINT_MAX);
    const calls = model({ texts: [short] });
    const { stored } = await generateCompatibilityV4Stored({ ...input, withDetail: false });
    expect(calls.cover).toHaveLength(1);
    expect(calls.rewrite).toHaveLength(1);
    expect(calls.rewrite[0]).toContain(long);
    expect(stored.teaser.cover.lockedHints[0].text).toBe(short);
    expect(stored.teaser.cover.lockedHints[1]).toEqual(cover.lockedHints[1]);
  });

  test('a rewrite still over the cap falls back to the whole repair, and the cap holds', async () => {
    const calls = model({ texts: [long] });
    await expect(generateCompatibilityV4Stored({ ...input, withDetail: false, maxRepairs: 1 })).rejects.toThrow('at most 170');
    expect(calls.rewrite).toHaveLength(1);
    expect(calls.cover).toHaveLength(2);
  });
});

describe('v4 insight plan', () => {
  test('a plan that misses a chapter is told which one', () => {
    const missingFuture = { insights: INSIGHTS.insights.map((i) => (i.chapter === 'future' ? { ...i, chapter: 'you' } : i)) };
    const result = V4InsightPlanSchema.safeParse(missingFuture);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain('add one for future');
  });
});

describe('v4 live budget', () => {
  test('no model call starts without enough time left before the deadline', async () => {
    let calls = 0;
    mockModel(() => sections());
    await expect(generateCompatibilityV4({ ...input, deadlineAt: Date.now() + 5_000, onModelCall: () => calls++ })).rejects.toThrow(
      'ran out of time',
    );
    expect(calls).toBe(0);
  });

  test('a quality repair cut off by the deadline keeps the valid reply before it, flagged', async () => {
    const unanchored = `${name}กับคุณดึงกันด้วยความต่างที่ต้องคุยให้ชัด`;
    let coverCalls = 0;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      const prompt = body.messages[1].content;
      if (prompt.includes('{ "insights"')) return reply(INSIGHTS);
      const all = sections();
      const keys = (Object.keys(all) as V4SectionKey[]).filter((key) => prompt.includes(`  "${key}": `));
      if (keys.includes('cover') && ++coverCalls === 2) throw new Error('The operation was aborted.');
      const chosen = keys.includes('cover') ? sections({ cover: { ...(all.cover as object), verdict: unanchored } }) : all;
      return reply(Object.fromEntries(keys.map((key) => [key, chosen[key]])));
    }) as unknown as typeof fetch;

    const result = await generateCompatibilityV4({ ...input, maxRepairs: 1, deadlineAt: Date.now() + 120_000 });
    expect(coverCalls).toBe(2);
    expect(result.content.cover.verdict).toBe(unanchored);
    expect(result.qualityFlags.some((flag) => flag.startsWith('cover.verdict: fits any pair'))).toBe(true);
  });
});

describe('shapeCompatibilityView for v4', () => {
  test('the teaser carries the cover and the score bars and no paid text', async () => {
    mockModel(() => sections());
    const { content, stored } = await generateCompatibilityV4(input);
    const teaser = shapeCompatibilityView(stored, 'teaser');
    expect(Object.keys(teaser).sort()).toEqual(['archetype', 'contentVersion', 'cover', 'dimensions', 'generatedOn', 'people', 'readingMinutes']);
    expect(teaser.dimensions[0]).toEqual({ key: 'chemistry', label: 'เคมี', score: content.dimensions[0].score });

    const json = JSON.stringify(teaser);
    expect(json).not.toContain(content.overview.story);
    expect(json).not.toContain(content.overview.dimensionLines.trust);
    for (const chapterContent of content.chapters) expect(json).not.toContain(chapterContent.detail);
    expect(json).not.toContain('"calendar"');
    expect(json).not.toContain('"plan"');
    expect(json).not.toContain('"insights"');
    expect(json).not.toContain('"basis"');
    expect(json).not.toContain('"palace"');
    expect(json).not.toContain('"pullQuote"');
    expect(json).not.toContain('"mbti"');
  });

  test('the share view is the free cover and the score numbers, nothing paid', async () => {
    mockModel(() => sections());
    const { content } = await generateCompatibilityV4(input);
    const share = shareCompatibilityV4(content);
    expect(Object.keys(share).sort()).toEqual(['archetype', 'contentVersion', 'dimensions', 'people', 'verdict']);
    const json = JSON.stringify(share);
    expect(json).not.toContain('"mbti"');
    for (const chapterContent of content.chapters) {
      expect(json).not.toContain(chapterContent.detail);
      expect(json).not.toContain(chapterContent.summary);
    }
    for (const hint of content.cover.lockedHints) expect(json).not.toContain(hint.text);
    expect(json).not.toContain(content.overview.story);
    expect(json).not.toContain(content.calendar[0].text);
    expect(json).not.toContain(content.plan[0].action);
  });

  test('a stored report parses back to the same stored form', async () => {
    mockModel(() => sections());
    const { stored } = await generateCompatibilityV4(input);
    expect(parseCompatibilityContent(currentRow(stored))).toEqual(stored);
  });

  test('the full view is the report without the plan or the input snapshot', async () => {
    mockModel(() => sections());
    const { content, stored } = await generateCompatibilityV4(input);
    const full = shapeCompatibilityView(stored, 'full');
    expect(full).toEqual(content);
    const json = JSON.stringify(full);
    for (const key of ['"insights"', '"inputs"', '"mbti"', '"basis"']) expect(json).not.toContain(key);
  });

  test('a legacy row (no content_version) never parses as a report', () => {
    expect(() => parseCompatibilityContent({ id: 'legacy', analysis: '## ภาพรวม\nคำทำนายแบบเดิม', contentVersion: null })).toThrow('legacy row');
  });
});

// ---------------------------------------------------------------- locked mode

/** The mock model's replies for a teaser written on `now`: its calendar months and next-step month. */
function sectionsFor(now: Date) {
  const charts = calculateCompatibilityCharts(input.reader, input.partner);
  const calendar = relationshipCalendar(charts.readerBazi, charts.partnerBazi, now);
  const future = sections().future as Record<string, unknown>;
  return sections({
    calendar: calendar.map(({ month }) => ({ month, text: prose(8) })),
    future: { ...future, nextStep: { month: bestMonth(calendar).month, step: prose(10) } },
  });
}

/** Counts every model call, whatever asks for it. */
function countingModel(source: () => Record<V4SectionKey, unknown> = () => sections()) {
  const counter = { calls: 0 };
  mockModel(source);
  const mocked = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    counter.calls += 1;
    return mocked(url, init);
  }) as unknown as typeof fetch;
  return counter;
}

const PROFILE_ID = 'profile-1';
function row(analysis: string): CompatibilityRow {
  return {
    id: 'row-1',
    profileAId: PROFILE_ID,
    partnerName: name,
    partnerBirthDate: fixture.partner.birthDate.slice(0, 10),
    relationshipType: fixture.relationshipType,
    score: 61,
    elementHarmony: 60,
    branchHarmony: 62,
    analysis,
    contentVersion: 4,
    strengths: '[]',
    challenges: '[]',
    userElement: 'metal',
    userDayMaster: 'geng',
    partnerElement: 'fire',
    partnerDayMaster: 'bing',
    shareToken: 'share-1',
    createdAt: new Date('2026-09-27T05:00:00Z'),
  };
}

/**
 * The unlock's store in memory. saveDetailPaid stands in for the route's
 * transaction: a fresh token is the `tx` the charge gets, and the row is
 * written only after the charge went through, recorded with that token.
 */
function memoryStore(initial: CompatibilityRow) {
  const state = { row: initial, saves: 0, savedInTx: [] as unknown[] };
  const store: UnlockStore = {
    load: async (id) => (id === state.row.id ? state.row : null),
    saveDetailPaid: async (_id, analysis, charge) => {
      const tx = {} as WalletTx;
      const decision = await charge(tx);
      if (!decision.ok) return decision;
      state.saves += 1;
      state.savedInTx.push(tx);
      state.row = { ...state.row, analysis };
      return { ok: true, row: state.row };
    },
  };
  return { state, store };
}

/** Every paid string of a full report, and the input snapshot, none of which a locked response may carry. */
function paidStrings(content: CompatibilityV4Content, stored: CompatibilityV4Stored): string[] {
  return [
    content.overview.story,
    ...Object.values(content.overview.dimensionLines),
    ...content.chapters.flatMap((c) => [c.summary, c.pullQuote, c.detail, c.move]),
    ...content.calendar.map((m) => m.text),
    ...content.plan.map((p) => p.action),
    ...stored.plan.insights.map((i) => i.text),
    stored.inputs.reader.birthDate,
    '"palace"',
    '"insights"',
    '"inputs"',
  ];
}

const unlockArgs = (store: ReturnType<typeof memoryStore>['store'], flight = new GenerationSingleFlight(null)) => ({
  userId: 'user-1',
  profileId: PROFILE_ID,
  id: 'row-1',
  requestStartedAt: Date.now(),
  store,
  flight,
});

describe('locked mode (teaser-first)', () => {
  afterEach(() => {
    overrideFlags(null);
  });

  test('the teaser stage writes the plan and the cover only, and stores no detail', async () => {
    const counter = countingModel();
    const { stored } = await generateCompatibilityV4Stored({ ...input, withDetail: false });
    expect(counter.calls).toBe(2); // the plan, then the cover
    expect(stored.detail).toBeNull();
    expect(stored.teaser.cover.lockedHints).toHaveLength(3);
    expect(stored.inputs.partner.mbti).toBe(fixture.partner.mbti);
    const json = JSON.stringify(stored);
    for (const key of ['"overview"', '"chapters"', '"calendar"', '"palace"', '"readingMinutes"']) expect(json).not.toContain(key);
  });

  test('teaser now and detail on unlock add up to the report written in one go (flag off)', async () => {
    countingModel();
    const oneGo = (await generateCompatibilityV4(input)).content;
    const { stored } = await generateCompatibilityV4Stored({ ...input, withDetail: false });
    const counter = countingModel();
    const { detail } = await generateCompatibilityV4Detail(stored, { partner: { name }, relationshipType: fixture.relationshipType });
    expect(counter.calls).toBe(3); // the three detail calls, no plan and no cover
    const { stored: full } = await generateCompatibilityV4Stored({ ...input, withDetail: true });
    expect(full.detail).not.toBeNull();
    expect(parseCompatibilityContent(currentRow({ ...stored, detail }))).toEqual({ ...stored, detail });
    expect({ contentVersion: 4, ...stored.teaser, ...detail }).toEqual(oneGo);
  });

  test('the detail counts its months from the day the teaser was written, not from today', async () => {
    const may = new Date('2026-05-10T05:00:00Z');
    mockModel(() => sectionsFor(may));
    const { stored } = await generateCompatibilityV4Stored({ ...input, now: may, withDetail: false });
    expect(stored.teaser.generatedOn).toBe('2026-05-10');
    const { detail } = await generateCompatibilityV4Detail(stored, { partner: { name }, relationshipType: fixture.relationshipType });
    expect(detail.calendar.map((m) => m.month)).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  test('a locked row answers with the teaser and no paid text, on every route', async () => {
    countingModel();
    const { stored: full } = await generateCompatibilityV4Stored({ ...input, withDetail: true });
    const locked: CompatibilityV4Stored = { ...full, detail: null };
    const content = fullContent(full);
    const lockedRow = row(JSON.stringify(locked));

    const reading = readingResponse(lockedRow);
    expect(reading.locked).toBe(true);
    expect('analysis' in reading).toBe(false);
    expect(Object.keys(reading.structuredContent ?? {}).sort()).toEqual(['archetype', 'contentVersion', 'cover', 'dimensions', 'generatedOn', 'people', 'readingMinutes']);
    const responses = { reading, share: shareResponse(lockedRow), history: historyItem(lockedRow) };
    expect(responses.history.locked).toBe(true);
    expect('analysis' in responses.history).toBe(false);
    for (const [route, response] of Object.entries(responses)) {
      const json = JSON.stringify(response);
      for (const paid of paidStrings(content, full)) {
        if (json.includes(paid)) throw new Error(`${route} response carries paid text: ${paid.slice(0, 40)}`);
      }
    }
    for (const hint of full.teaser.cover.lockedHints) expect(JSON.stringify(responses.share)).not.toContain(hint.text);
  });

  test('an unlocked row answers with the full report and still no stored JSON', async () => {
    countingModel();
    const { stored } = await generateCompatibilityV4Stored({ ...input, withDetail: true });
    const reading = readingResponse(row(JSON.stringify(stored)));
    expect(reading.locked).toBe(false);
    expect(historyItem(row(JSON.stringify(stored))).locked).toBe(false);
    expect(reading.structuredContent).toEqual(fullContent(stored));
    const json = JSON.stringify(reading);
    expect('analysis' in reading).toBe(false);
    expect(json).not.toContain('"inputs"');
    expect(json).not.toContain(stored.inputs.reader.birthDate);
  });

  test('a row stored before names were spaced answers with a Latin name spaced, on every route', async () => {
    countingModel();
    const { stored } = await generateCompatibilityV4Stored({ ...input, withDetail: true });
    // As rows were written before: the Latin name run into the Thai around it.
    const legacy = { ...row(JSON.stringify(stored).replaceAll(name, 'Ice')), partnerName: 'Ice' };
    expect(legacy.analysis).toContain('ไฟของIceหลอม');
    const reading = readingResponse(legacy);
    const share = shareResponse(legacy);
    for (const response of [reading, share]) {
      const json = JSON.stringify(response.structuredContent);
      expect(json).toContain('ไฟของ Ice หลอม');
      expect(json).not.toMatch(/[\u0E00-\u0E7F]Ice|Ice[\u0E00-\u0E7F]/);
    }
  });

  test('unlock is owner-only and checks nothing else for a stranger', async () => {
    countingModel();
    const { stored } = await generateCompatibilityV4Stored({ ...input, withDetail: false });
    const { store, state } = memoryStore({ ...row(JSON.stringify(stored)), profileAId: 'someone-else' });
    const counter = countingModel();
    const result = await unlockReading(unlockArgs(store));
    expect(result.status).toBe(404);
    expect(JSON.stringify(result.body)).not.toContain(stored.teaser.cover.verdict);
    expect(counter.calls).toBe(0);
    expect(state.saves).toBe(0);
  });

  /**
   * A ledger in memory, swapped in on the shared `wallet` object, so these run
   * without a database (the real ledger is tested on Postgres in
   * tests/wallet.test.ts). spendWithin keeps the real rules: once per row,
   * refused below the price, and it records the transaction it charged in.
   */
  function fakeLedger(balance: number, paidRows: string[] = []) {
    const ledger = { balance, spends: paidRows.map((refId) => ({ refId, tx: null as unknown })) };
    const spies = [
      spyOn(wallet, 'ensureWelcome').mockImplementation(async () => {}),
      spyOn(wallet, 'hasPaid').mockImplementation(async (_userId, _productId, refId) => ledger.spends.some((s) => s.refId === refId)),
      spyOn(wallet, 'canAfford').mockImplementation(async (_userId, price) => ({ ok: ledger.balance >= price, balance: ledger.balance, price })),
      spyOn(wallet, 'spendWithin').mockImplementation(async (tx, _userId, productId, refId) => {
        const price = PRODUCT_PRICES[productId];
        if (ledger.spends.some((s) => s.refId === refId)) return { charged: false as const, balance: ledger.balance };
        if (ledger.balance < price) throw new InsufficientBalance(ledger.balance, price);
        ledger.balance -= price;
        ledger.spends.push({ refId, tx });
        return { charged: true as const, balance: ledger.balance };
      }),
      spyOn(wallet, 'spend').mockImplementation(async () => {
        throw new Error('the unlock charges inside its own transaction, never with spend()');
      }),
    ];
    return { ledger, spies, restore: () => spies.forEach((spy) => spy.mockRestore()) };
  }

  const locked = async () => {
    countingModel();
    const { stored } = await generateCompatibilityV4Stored({ ...input, withDetail: false });
    return memoryStore(row(JSON.stringify(stored)));
  };

  test.skipIf(!process.env.WALLET_TEST_DATABASE_URL)(
    'one-flow purchase: a paid order with unlock_ref credits, then unlocks that row with one spend (local Postgres)',
    async () => {
      const url = process.env.WALLET_TEST_DATABASE_URL!;
      if (!isLocalDatabaseUrl(url)) throw new Error('WALLET_TEST_DATABASE_URL must point at a database on this machine');
      overrideFlags({ compat_lock: true, compat_unlock_free: false });
      const db = createDbClient(url);
      const testWallet = createWallet(db);
      const userId = `one-flow-${crypto.randomUUID().slice(0, 8)}`;
      await db.insert(user).values({ id: userId, name: 'one flow', email: `${userId}@wallet.test` });
      try {
        // The welcome gift already went on another row: balance 0, so the door offered "ปลดล็อก ฿49".
        await testWallet.ensureWelcome(userId);
        await testWallet.spend(userId, 'compat_unlock', 'another-row');
        const order = await testWallet.createOrder(userId, 'p49', 'row-1');
        expect((await testWallet.markPaid(order.id)).marked).toBe(true);

        countingModel();
        const { stored } = await generateCompatibilityV4Stored({ ...input, withDetail: false });
        const state = { row: row(JSON.stringify(stored)) };
        const store: UnlockStore = {
          load: async (id) => (id === state.row.id ? state.row : null),
          // The route's transaction, on the real ledger: the charge and the detail commit together.
          saveDetailPaid: (_id, analysis, charge) =>
            db.transaction(async (tx) => {
              const decision = await charge(tx);
              if (!decision.ok) return decision;
              state.row = { ...state.row, analysis };
              return { ok: true as const, row: state.row };
            }),
        };
        const deps = {
          wallet: testWallet,
          unlock: (buyer: string, rowId: string) =>
            unlockReading({ ...unlockArgs(store), userId: buyer, id: rowId, wallet: testWallet }),
        };

        const counter = countingModel();
        expect(await fulfilPaidOrder(order.id, { type: 'system' }, deps)).toEqual({ credited: true, balance: 49, unlockStatus: 200 });
        expect(counter.calls).toBe(3);
        expect(readingResponse(state.row).locked).toBe(false);

        // A replayed webhook: no second credit, no second charge, no model call.
        expect(await fulfilPaidOrder(order.id, { type: 'system' }, deps)).toEqual({ credited: false, balance: 0, unlockStatus: 200 });
        expect(counter.calls).toBe(3);
        const rows = await testWallet.ledger(userId, 10);
        expect(rows.filter((entry) => entry.kind === 'spend' && entry.refId === 'row-1')).toHaveLength(1);
        expect(await testWallet.balance(userId)).toBe(0);
      } finally {
        await db.delete(walletLedger).where(eq(walletLedger.userId, userId));
        await db.delete(orders).where(eq(orders.userId, userId));
        await db.delete(user).where(eq(user.id, userId));
      }
    },
  );

  test('with locking on and a balance of 0, unlock answers 402 with the wallet contract before any model call', async () => {
    overrideFlags({ compat_lock: true, compat_unlock_free: false });
    const fake = fakeLedger(0);
    try {
      const { store, state } = await locked();
      const counter = countingModel();
      const result = await unlockReading(unlockArgs(store));
      expect(result).toEqual({ status: 402, body: { error: INSUFFICIENT_BALANCE, balance: 0, price: 49 } });
      expect(counter.calls).toBe(0);
      expect(state.saves).toBe(0);
      expect(fake.ledger.spends).toEqual([]);
    } finally {
      fake.restore();
    }
  });

  test('a row whose detail exists opens without touching the wallet, even at a balance of 0', async () => {
    overrideFlags({ compat_lock: true, compat_unlock_free: false });
    const fake = fakeLedger(0);
    try {
      countingModel();
      const { stored } = await generateCompatibilityV4Stored({ ...input, withDetail: true });
      const { store, state } = memoryStore(row(JSON.stringify(stored)));
      const counter = countingModel();
      const result = await unlockReading(unlockArgs(store));
      expect(result.status).toBe(200);
      if (result.status !== 200) throw new Error('unreachable');
      expect(result.body.locked).toBe(false);
      for (const spy of fake.spies) expect(spy).not.toHaveBeenCalled();
      expect(counter.calls).toBe(0);
      expect(state.saves).toBe(0);
    } finally {
      fake.restore();
    }
  });

  test('a paid unlock charges once, in the same transaction that writes the detail', async () => {
    overrideFlags({ compat_lock: true, compat_unlock_free: false });
    const fake = fakeLedger(49);
    try {
      const { store, state } = await locked();
      const result = await unlockReading(unlockArgs(store));
      expect(result.status).toBe(200);
      expect(fake.ledger.balance).toBe(0);
      expect(fake.ledger.spends).toHaveLength(1);
      expect(state.saves).toBe(1);
      expect(fake.ledger.spends[0].tx).toBe(state.savedInTx[0]);
    } finally {
      fake.restore();
    }
  });

  test('a generation that fails leaves the ledger untouched', async () => {
    overrideFlags({ compat_lock: true, compat_unlock_free: false });
    const fake = fakeLedger(49);
    try {
      const { store, state } = await locked();
      countingModel(() => ({ ...sections(), overview: { story: 'สั้นไป', dimensionLines: {} } }));
      await expect(unlockReading(unlockArgs(store))).rejects.toThrow('Invalid compatibility JSON');
      expect(fake.ledger.balance).toBe(49);
      expect(fake.ledger.spends).toEqual([]);
      expect(state.saves).toBe(0);
    } finally {
      fake.restore();
    }
  });

  test('a balance spent elsewhere during generation: 402, the detail discarded, one charge only', async () => {
    overrideFlags({ compat_lock: true, compat_unlock_free: false });
    const fake = fakeLedger(49);
    try {
      const { store, state } = await locked();
      // The same reader unlocks another row while this detail is being written.
      let spentElsewhere = false;
      countingModel(() => {
        if (!spentElsewhere) {
          spentElsewhere = true;
          fake.ledger.balance -= 49;
          fake.ledger.spends.push({ refId: 'row-2', tx: null });
        }
        return sections();
      });
      const result = await unlockReading(unlockArgs(store));
      expect(result).toEqual({ status: 402, body: { error: INSUFFICIENT_BALANCE, balance: 0, price: 49 } });
      expect(state.saves).toBe(0);
      expect(fake.ledger.spends.map((s) => s.refId)).toEqual(['row-2']);
      expect(fake.ledger.balance).toBe(0);
    } finally {
      fake.restore();
    }
  });

  test('two concurrent paid unlocks of one row charge once', async () => {
    overrideFlags({ compat_lock: true, compat_unlock_free: false });
    const fake = fakeLedger(98);
    try {
      const { store, state } = await locked();
      const flight = new GenerationSingleFlight(null);
      const [a, b] = await Promise.all([unlockReading(unlockArgs(store, flight)), unlockReading(unlockArgs(store, flight))]);
      expect(a.status).toBe(200);
      expect(b).toEqual(a);
      expect(fake.ledger.spends).toHaveLength(1);
      expect(fake.ledger.balance).toBe(49);
      expect(state.saves).toBe(1);
    } finally {
      fake.restore();
    }
  });

  test('a row already paid for (relocked, or a patch that failed) opens at a balance of 0 with no second charge', async () => {
    overrideFlags({ compat_lock: true, compat_unlock_free: false });
    const fake = fakeLedger(0, ['row-1']);
    try {
      const { store, state } = await locked();
      const result = await unlockReading(unlockArgs(store));
      expect(result.status).toBe(200);
      if (result.status !== 200) throw new Error('unreachable');
      expect(result.body.locked).toBe(false);
      expect(state.saves).toBe(1);
      expect(fake.ledger.spends).toHaveLength(1);
      expect(fake.ledger.balance).toBe(0);
    } finally {
      fake.restore();
    }
  });

  test('unlock writes the detail once and is idempotent after', async () => {
    overrideFlags({ compat_lock: true, compat_unlock_free: true });
    countingModel();
    const { stored } = await generateCompatibilityV4Stored({ ...input, withDetail: false });
    const { store, state } = memoryStore(row(JSON.stringify(stored)));

    const counter = countingModel();
    const first = await unlockReading(unlockArgs(store));
    expect(first.status).toBe(200);
    expect(counter.calls).toBe(3);
    expect(state.saves).toBe(1);
    if (first.status !== 200) throw new Error('unreachable');
    expect(first.body.locked).toBe(false);
    expect(first.body.structuredContent).toHaveProperty('overview');

    const second = await unlockReading(unlockArgs(store));
    expect(counter.calls).toBe(3);
    expect(state.saves).toBe(1);
    expect(second).toEqual(first);
  });

  test('two concurrent unlocks write the detail once', async () => {
    overrideFlags({ compat_lock: true, compat_unlock_free: true });
    countingModel();
    const { stored } = await generateCompatibilityV4Stored({ ...input, withDetail: false });
    const { store, state } = memoryStore(row(JSON.stringify(stored)));
    const flight = new GenerationSingleFlight(null);

    const counter = countingModel();
    const [a, b] = await Promise.all([unlockReading(unlockArgs(store, flight)), unlockReading(unlockArgs(store, flight))]);
    expect(counter.calls).toBe(3);
    expect(state.saves).toBe(1);
    expect(a.status).toBe(200);
    expect(b).toEqual(a);
  });

  test('a legacy row is not found: no model call, no charge, no write', async () => {
    const counter = countingModel();
    const { store, state } = memoryStore({ ...row('## ภาพรวม\nคำทำนายแบบเดิม'), contentVersion: null });
    const result = await unlockReading(unlockArgs(store));
    expect(result.status).toBe(404);
    expect(counter.calls).toBe(0);
    expect(state.saves).toBe(0);
  });
});

function fullContent(stored: CompatibilityV4Stored): CompatibilityV4Content {
  if (!stored.detail) throw new Error('needs the detail');
  return { contentVersion: 4, ...stored.teaser, ...stored.detail };
}
