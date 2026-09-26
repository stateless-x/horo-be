import { describe, expect, test } from 'bun:test';
import { calculateBazi, calculateThaiAstrology, buildTraitChips } from '../lib/astrology';
import { buildTeaserPrompt } from '../src/lib/prompts';

describe('teaser v2 prompt', () => {
  test('mentions neither "MBTI" nor any 4-letter type code when mbtiType is null', () => {
    const birthDate = new Date(Date.UTC(1994, 10, 26));
    const bazi = calculateBazi(birthDate, 2, 'male');
    const thaiAstrology = calculateThaiAstrology(birthDate);
    const chips = buildTraitChips(thaiAstrology.day, bazi.element, null);

    const prompt = buildTeaserPrompt(
      'Purin',
      birthDate,
      bazi,
      thaiAstrology,
      null,
      'finance',
      38,
      chips,
    );

    expect(prompt).not.toContain('MBTI');
    // No 4-letter uppercase type code (e.g. INTP, ESFJ) anywhere in the prompt.
    expect(prompt).not.toMatch(/\b(I|E)(S|N)(T|F)(J|P)\b/);
    expect(prompt).not.toContain('{{');
  });

  test('includes the MBTI code, name, and chip trait when a valid mbtiType is given', () => {
    const birthDate = new Date(Date.UTC(1994, 10, 26));
    const bazi = calculateBazi(birthDate, 2, 'male');
    const thaiAstrology = calculateThaiAstrology(birthDate);
    const chips = buildTraitChips(thaiAstrology.day, bazi.element, 'INTP');

    const prompt = buildTeaserPrompt(
      'Purin',
      birthDate,
      bazi,
      thaiAstrology,
      'INTP',
      'career',
      75,
      chips,
    );

    expect(prompt).toContain('INTP');
    expect(prompt).toContain('MBTI');
    expect(prompt).not.toContain('{{');
  });

  test('includes the focus area label and a score band, and the deterministic trait chips', () => {
    const birthDate = new Date(Date.UTC(1994, 10, 26));
    const bazi = calculateBazi(birthDate, 2, 'male');
    const thaiAstrology = calculateThaiAstrology(birthDate);
    const chips = buildTraitChips(thaiAstrology.day, bazi.element, null);

    const prompt = buildTeaserPrompt('Purin', birthDate, bazi, thaiAstrology, null, 'love', 82, chips);

    expect(prompt).toContain('ความรัก');
    expect(prompt).toContain('ดีมาก'); // score 82 -> high band
    expect(prompt).toContain(chips[0].trait);
    expect(prompt).toContain(chips[1].trait);
  });

  test('instructs threeWay to never start with the user\'s name', () => {
    const birthDate = new Date(Date.UTC(1994, 10, 26));
    const bazi = calculateBazi(birthDate, 2, 'male');
    const thaiAstrology = calculateThaiAstrology(birthDate);
    const chips = buildTraitChips(thaiAstrology.day, bazi.element, null);

    const prompt = buildTeaserPrompt('Purin', birthDate, bazi, thaiAstrology, null, 'health', 50, chips);

    expect(prompt).toContain('ห้ามขึ้นต้นประโยคด้วยชื่อ');
  });

  test('never uses "บาซี" to describe the system itself — only names it in the explicit ban rule', () => {
    const birthDate = new Date(Date.UTC(1994, 10, 26));
    const bazi = calculateBazi(birthDate, 2, 'male');
    const thaiAstrology = calculateThaiAstrology(birthDate);
    const banRule = 'เรียกโหราศาสตร์จีนว่า ปาจื้อ เท่านั้น ห้ามใช้คำว่า บาซี';

    for (const mbtiType of [null, 'INTP'] as const) {
      const chips = buildTraitChips(thaiAstrology.day, bazi.element, mbtiType);
      const prompt = buildTeaserPrompt('Purin', birthDate, bazi, thaiAstrology, mbtiType, 'career', 60, chips);

      expect(prompt).toContain('ปาจื้อ');
      expect(prompt).toContain(banRule);
      // The only occurrence of the literal word "บาซี" is inside the ban rule
      // itself (which must name it to forbid it) — removing that one instance
      // must leave zero remaining.
      expect(prompt.replace(banRule, '')).not.toContain('บาซี');
    }
  });

  test('names the correct number of systems in the threeWay instruction: two without MBTI, three with it', () => {
    const birthDate = new Date(Date.UTC(1994, 10, 26));
    const bazi = calculateBazi(birthDate, 2, 'male');
    const thaiAstrology = calculateThaiAstrology(birthDate);

    const withoutMbti = buildTeaserPrompt(
      'Purin', birthDate, bazi, thaiAstrology, null, 'career', 60,
      buildTraitChips(thaiAstrology.day, bazi.element, null),
    );
    expect(withoutMbti).toContain('ทั้งสองระบบ (โหราศาสตร์ไทย และปาจื้อ)');
    expect(withoutMbti).not.toContain('ทั้งสามระบบ');

    const withMbti = buildTeaserPrompt(
      'Purin', birthDate, bazi, thaiAstrology, 'INTP', 'career', 60,
      buildTraitChips(thaiAstrology.day, bazi.element, 'INTP'),
    );
    expect(withMbti).toContain('ทั้งสามระบบ (โหราศาสตร์ไทย ปาจื้อ และ MBTI)');
    expect(withMbti).not.toContain('ทั้งสองระบบ (โหราศาสตร์ไทย และปาจื้อ)');
  });

  test('bans gendered sentence-final particles, so the voice stays neutral regardless of the reader\'s gender', () => {
    const birthDate = new Date(Date.UTC(1994, 10, 26));
    const bazi = calculateBazi(birthDate, 2, 'male');
    const thaiAstrology = calculateThaiAstrology(birthDate);
    const chips = buildTraitChips(thaiAstrology.day, bazi.element, null);

    const prompt = buildTeaserPrompt('Purin', birthDate, bazi, thaiAstrology, null, 'career', 60, chips);

    expect(prompt).toContain('ห้ามใช้คำลงท้าย ครับ ค่ะ คะ นะคะ และห้ามเรียกชื่อตามด้วยครับหรือค่ะ');
  });

  test('asks for threeWay as one short, single-breath sentence capped around 15 words', () => {
    const birthDate = new Date(Date.UTC(1994, 10, 26));
    const bazi = calculateBazi(birthDate, 2, 'male');
    const thaiAstrology = calculateThaiAstrology(birthDate);
    const chips = buildTraitChips(thaiAstrology.day, bazi.element, null);

    const prompt = buildTeaserPrompt('Purin', birthDate, bazi, thaiAstrology, null, 'career', 60, chips);

    expect(prompt).toContain('ประโยคสั้นหนึ่งประโยค ไม่เกินประมาณ 15 คำ อ่านจบในหนึ่งลมหายใจ');
  });
});
