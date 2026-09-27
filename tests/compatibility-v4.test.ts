import { afterEach, describe, expect, test } from 'bun:test';
import {
  COMPATIBILITY_DEV_FIXTURES,
  shapeCompatibilityView,
  type MbtiType,
  type V4SectionKey,
} from '../lib/shared';
import { ELEMENT_CONTROLLING, ELEMENT_PRODUCING } from '../lib/astrology';
import { generateCompatibilityV4 } from '../src/lib/compatibility-generation';
import { elementsNamed, foreignElementWords } from '../src/lib/compatibility-text';
import { ELEMENT_IMAGE } from '../src/lib/prompts';

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
const chapter = (extra = '') => ({ summary: prose(12), detail: prose(160, extra), move: prose(12) });

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
function mockModel(source: (sectionKeys: V4SectionKey[], messages: string[]) => Record<V4SectionKey, unknown>) {
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    const prompt = body.messages[1].content;
    if (prompt.includes('{ "insights"')) return reply(INSIGHTS);
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

    expect(calls).toBe(4); // the plan, then three section calls
    expect(content.contentVersion).toBe(4);
    expect(content.generatedOn).toBe('2026-09-27');
    expect(content.dimensions.map((d) => d.key)).toEqual(['chemistry', 'communication', 'trust', 'rhythm']);
    expect(content.chapters.map((c) => c.key)).toEqual(['attraction', 'partner', 'you', 'communication', 'friction', 'future']);
    expect(content.chapters[1].title).toBe(`ตัวตนของ${name}ในความสัมพันธ์นี้`);
    expect(content.calendar.map((m) => m.month)).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(result.qualityFlags).toEqual([]);
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

  test('a known typo is corrected without a repair turn', async () => {
    mockModel(() => sections({ attraction: chapter('ช่วยกันเขียงลำดับ นักษัตรวันเกิดของทั้งสองคนประสานกัน ') }));
    let calls = 0;
    const { content } = await generateCompatibilityV4({ ...input, onModelCall: () => calls++ });
    expect(calls).toBe(4);
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

describe('shapeCompatibilityView for v4', () => {
  test('the teaser carries the cover and the score bars and no paid text', async () => {
    mockModel(() => sections());
    const { content } = await generateCompatibilityV4(input);
    const teaser = shapeCompatibilityView(content, 'teaser');
    expect(Object.keys(teaser).sort()).toEqual(['archetype', 'contentVersion', 'cover', 'dimensions', 'generatedOn']);
    expect(teaser.dimensions[0]).toEqual({ key: 'chemistry', label: 'เคมี', score: content.dimensions[0].score });

    const json = JSON.stringify(teaser);
    expect(json).not.toContain(content.overview.story);
    expect(json).not.toContain(content.overview.dimensionLines.trust);
    for (const chapterContent of content.chapters) expect(json).not.toContain(chapterContent.detail);
    expect(json).not.toContain('"calendar"');
    expect(json).not.toContain('"plan"');
    expect(json).not.toContain('"insights"');
    expect(json).not.toContain('"basis"');
  });

  test('the full view is the stored content', async () => {
    mockModel(() => sections());
    const { content } = await generateCompatibilityV4(input);
    expect(shapeCompatibilityView(content, 'full')).toEqual(content);
  });
});
