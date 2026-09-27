import { describe, expect, test } from 'bun:test';
import { calculateBazi, calculateThaiAstrology, calculateCompatibility } from '../lib/astrology';
import { COMPATIBILITY_DEV_FIXTURES } from '../lib/shared';
import { buildCompatibilityPrompt } from '../src/lib/prompts';

/**
 * Locks the production v2 compatibility prompt byte for byte.
 *
 * compatibility.md was split into shared pieces so v3 can reuse the data block
 * and the rules without a forked copy. This snapshot was recorded from the
 * unsplit template; if it changes, the v2 prompt that production sends changed.
 * Each fixture must contain exactly two dates, so the mask cannot hide a
 * template change.
 */
describe('v2 compatibility prompt', () => {
  for (const fixture of COMPATIBILITY_DEV_FIXTURES) {
    test(`${fixture.id} renders exactly as before`, () => {
      const readerDate = new Date(fixture.reader.birthDate);
      const partnerDate = new Date(fixture.partner.birthDate);
      const readerBazi = calculateBazi(readerDate, fixture.reader.birthHour, fixture.reader.gender);
      const partnerBazi = calculateBazi(partnerDate, undefined, 'female');
      const score = calculateCompatibility(readerBazi, partnerBazi);
      const prompt = buildCompatibilityPrompt(
        {
          name: 'เจ้า',
          birthDate: readerDate,
          baziChart: readerBazi,
          thaiAstrology: calculateThaiAstrology(readerDate),
          mbtiType: fixture.reader.mbti ?? null,
        },
        {
          name: fixture.partner.name,
          birthDate: partnerDate,
          baziChart: partnerBazi,
          thaiAstrology: calculateThaiAstrology(partnerDate),
          mbtiType: fixture.partner.mbti ?? null,
        },
        fixture.relationshipType,
        {
          score: score.score,
          scoreExplanation: score.overallAnalysis,
          strengths: score.strengths,
          challenges: score.challenges,
        },
      );
      // Birth dates go through toLocaleDateString('th-TH'), which depends on the
      // runtime's ICU data; the split did not touch them, so they are masked to
      // keep this test from failing on a Bun upgrade in the Railway image.
      expect(prompt.match(/\d{1,2}\/\d{1,2}\/\d{4}/g)).toHaveLength(2);
      expect(prompt.replace(/\d{1,2}\/\d{1,2}\/\d{4}/g, '<date>')).toMatchSnapshot();
    });
  }
});
