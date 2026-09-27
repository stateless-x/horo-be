import { afterEach, describe, expect, test } from 'bun:test';
import {
  COMPATIBILITY_DEV_FIXTURES,
  CompatibilityV3GeneratedSchema,
  foreignTokenIn,
  shapeCompatibilityView,
  type CompatibilityV3Content,
  type MbtiType,
} from '../lib/shared';
import {
  buildCompatibilityPromptFor,
  calculateCompatibilityCharts,
  generateCompatibilityV3,
  readerGender,
} from '../src/lib/compatibility-generation';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Thai filler of an exact length, so bounds are exercised without real prose. */
const th = (length: number, lead = '') => (lead + 'คู่นี้คุยกันได้ดีเมื่อบอกความต้องการให้ชัด '.repeat(40)).slice(0, length).trim();

const generated = {
  detail: {
    dynamic: th(400),
    understandingPartner: th(300),
    yourSide: th(250),
    communication: [0, 1, 2].map(() => ({ do: th(80), avoid: th(60) })),
    friction: [0, 1].map(() => ({ scenario: th(80, 'ถ้า'), repair: th(90) })),
    timing: { advice: th(250), basis: ['p1ThaiDay', 'p2Planet'] },
    longTerm: th(250),
    nextSteps: { action: th(100), conversationStarter: th(100), watchFor: th(100) },
  },
  teaser: {
    verdict: th(80),
    hook: th(120),
    lockedHints: [
      { text: th(50), section: 'understandingPartner' },
      { text: th(50), section: 'yourSide' },
      { text: th(50), section: 'friction' },
    ],
  },
};

function deepSeekResponse(content: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fixtureInput(id: string) {
  const fixture = COMPATIBILITY_DEV_FIXTURES.find((f) => f.id === id);
  if (!fixture) throw new Error(`no fixture ${id}`);
  return {
    reader: {
      birthDate: new Date(fixture.reader.birthDate),
      birthHour: fixture.reader.birthHour,
      gender: fixture.reader.gender,
      mbtiType: (fixture.reader.mbti ?? null) as MbtiType | null,
    },
    partner: {
      name: fixture.partner.name,
      birthDate: new Date(fixture.partner.birthDate),
      mbtiType: (fixture.partner.mbti ?? null) as MbtiType | null,
    },
    relationshipType: fixture.relationshipType,
  };
}

function v3Prompt(id: string) {
  const input = fixtureInput(id);
  const charts = calculateCompatibilityCharts(input.reader, input.partner);
  return buildCompatibilityPromptFor('v3', input.reader, input.partner, input.relationshipType, charts);
}

describe('foreign token guard', () => {
  test.each(['boulevard', 'enquanto', 'Complement', 'ding', '补齐', '你们两个'])('rejects %s', (token) => {
    expect(foreignTokenIn(`คุณกับต้น${token}ได้ดี`)).toBe(token);
  });

  test('allows Thai prose with MBTI codes, digits and plain punctuation', () => {
    expect(foreignTokenIn('แนวโน้มแบบ ENTJ และ MBTI ของคุณ ISFJ ใช้เวลา 15 นาที (ลองดู) ได้ไหม?')).toBeNull();
  });

  test('a lookalike of an MBTI code inside a word is still rejected', () => {
    expect(foreignTokenIn('ESTJs')).toBe('ESTJs');
  });
});

describe('v3 schema', () => {
  test('accepts a complete reading', () => {
    expect(CompatibilityV3GeneratedSchema.safeParse(generated).success).toBe(true);
  });

  test('rejects hints that point at the same section twice', () => {
    const repeated = {
      ...generated,
      teaser: {
        ...generated.teaser,
        lockedHints: generated.teaser.lockedHints.map((hint) => ({ ...hint, section: 'dynamic' })),
      },
    };
    expect(CompatibilityV3GeneratedSchema.safeParse(repeated).success).toBe(false);
  });

  test('rejects a friction scenario that does not start with ถ้า', () => {
    const bad = structuredClone(generated);
    bad.detail.friction[0].scenario = th(80);
    expect(CompatibilityV3GeneratedSchema.safeParse(bad).success).toBe(false);
  });
});

describe('shapeCompatibilityView', () => {
  const content: CompatibilityV3Content = {
    contentVersion: 3,
    scoreExplanation: 'ความเข้ากันได้ดี',
    ...(generated as unknown as Pick<CompatibilityV3Content, 'detail' | 'teaser'>),
  };

  test('the teaser view carries no detail text at all', () => {
    const shaped = shapeCompatibilityView(content, 'teaser');
    expect(shaped.detail).toBeUndefined();
    expect(JSON.stringify(shaped)).not.toContain(content.detail.dynamic);
    expect(shaped.teaser).toEqual(content.teaser);
  });

  test('the full view is the stored content', () => {
    expect(shapeCompatibilityView(content, 'full')).toEqual(content);
  });
});

describe('v3 prompt', () => {
  test('keeps the shared data block and rules, swaps the task list', () => {
    const prompt = v3Prompt('boss-both-mbti');
    expect(prompt).toContain('ข้อมูลจากระบบคำนวณ');
    expect(prompt).toContain('รูปแบบ:');
    expect(prompt).toContain('`lockedHints`');
    expect(prompt).not.toContain('`chemistry`');
  });

  test('gives only Thai names, keeps Bazi and Thai astrology apart, and states the reader gender', () => {
    const prompt = v3Prompt('boss-both-mbti');
    expect(prompt).toContain('ปาจื้อ: เจ้าวันน้ำหยาง ธาตุน้ำ');
    expect(prompt).toContain('โหราศาสตร์ไทย: เกิดวันเสาร์ ดาวเสาร์');
    expect(prompt).toContain('โหราศาสตร์ไทย: เกิดวันศุกร์ ดาวศุกร์');
    expect(prompt).toContain('ห้ามบอกว่าธาตุมาจากดาวหรือวันเกิด');
    expect(prompt).toContain('ผู้ถามเป็นผู้หญิง');
    // The raw codes the model used to echo: day masters, elements, weekdays, planets' English names.
    expect(prompt).not.toMatch(/\b(ren|gui|water|saturday|friday|Saturn|Venus)\b/);
    expect(prompt).not.toMatch(/\b(Si|Se|Ni|Ne|Ti|Te|Fi|Fe) \(/);
    expect(prompt).toContain('แนวโน้มตาม MBTI ของ คุณวิภา (ENTJ');
    expect(prompt).not.toMatch(/ฟังก์ชันหลัก [A-Z][a-z] /);
    expect(prompt).not.toContain('ไม่มีข้อมูล MBTI ของ');
  });

  test('names whoever has no MBTI and never invents a partner block', () => {
    const prompt = v3Prompt('friend-no-mbti');
    expect(prompt).toContain('ไม่มีข้อมูล MBTI ของ: คุณ และ บีม ห้ามเดา');
    expect(prompt).not.toContain('แนวโน้มตาม MBTI ของ');
  });
});

describe('generateCompatibilityV3', () => {
  test('stores contentVersion 3 with the deterministic score line', async () => {
    globalThis.fetch = (async () => deepSeekResponse(generated)) as unknown as typeof fetch;
    let calls = 0;
    const result = await generateCompatibilityV3({ ...fixtureInput('romantic-both-mbti'), onModelCall: () => calls++ });

    expect(result.content.contentVersion).toBe(3);
    expect(result.content.scoreExplanation).toBe(result.charts.score.overallAnalysis);
    expect(calls).toBe(1);
  });

  test('a leaked foreign token costs exactly one repair call', async () => {
    const leaked = structuredClone(generated);
    leaked.teaser.hook = th(120, 'enquanto ');
    const replies = [leaked, generated];
    const bodies: string[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return deepSeekResponse(replies.shift());
    }) as unknown as typeof fetch;
    let calls = 0;

    const result = await generateCompatibilityV3({ ...fixtureInput('family-partner-mbti-only'), onModelCall: () => calls++ });

    expect(calls).toBe(2);
    expect(result.content.teaser.hook).toBe(generated.teaser.hook);
    // The repair is a follow-up turn: the model's own reply, then what failed.
    const repair = JSON.parse(bodies[1]) as { messages: Array<{ role: string; content: string }> };
    expect(repair.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(repair.messages[2].content).toContain('enquanto');
    expect(repair.messages[3].content).toContain('teaser.hook');
    expect(repair.messages[3].content).toContain('complete corrected JSON');
  });
});

describe('reader gender', () => {
  test('an unknown gender asks for neutral wording', () => {
    const input = fixtureInput('friend-no-mbti');
    const reader = { ...input.reader, gender: readerGender('other') };
    const charts = calculateCompatibilityCharts(reader, input.partner);
    const prompt = buildCompatibilityPromptFor('v3', reader, input.partner, input.relationshipType, charts);
    expect(reader.gender).toBeNull();
    expect(prompt).toContain('ไม่ทราบเพศของผู้ถาม');
  });

  test('v2 gets the gender line too', () => {
    const input = fixtureInput('talking-reader-mbti-only');
    const charts = calculateCompatibilityCharts(input.reader, input.partner);
    const prompt = buildCompatibilityPromptFor('v2', input.reader, input.partner, input.relationshipType, charts);
    expect(prompt).toContain('ผู้ถามเป็นผู้ชาย');
  });
});

describe('pair check', () => {
  test('an element the pair does not have in the verdict costs one repair turn that names it', async () => {
    // talking-reader-mbti-only: both people are earth.
    const wrong = structuredClone(generated);
    wrong.teaser.verdict = 'คู่นี้เป็นดินที่มั่นคงเจอกับไฟที่ลุกไว ถ้าจับจังหวะให้ดีจะอบอุ่น แต่ถ้าเร่งจะร้อนเกินไป';
    const replies = [wrong, generated];
    const bodies: string[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return deepSeekResponse(replies.shift());
    }) as unknown as typeof fetch;

    const result = await generateCompatibilityV3(fixtureInput('talking-reader-mbti-only'));

    expect(bodies).toHaveLength(2);
    const repair = JSON.parse(bodies[1]) as { messages: Array<{ content: string }> };
    expect(repair.messages[3].content).toContain('teaser.verdict');
    expect(repair.messages[3].content).toContain('ไฟ');
    expect(result.content.teaser.verdict).toBe(generated.teaser.verdict);
  });

  test('a hint with astrology terms is rejected by the schema', () => {
    const jargon = structuredClone(generated);
    jargon.teaser.lockedHints[0].text = th(50, 'ทำไมความต่างของธาตุทองกับธาตุไฟ');
    expect(CompatibilityV3GeneratedSchema.safeParse(jargon).success).toBe(false);
  });

  test('a hint may not point at timing', () => {
    const timing = structuredClone(generated);
    timing.teaser.lockedHints[2].section = 'timing';
    expect(CompatibilityV3GeneratedSchema.safeParse(timing).success).toBe(false);
  });
});
