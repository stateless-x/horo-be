import { describe, expect, test } from 'bun:test';
import { calculateBazi, calculateThaiAstrology, calculateCompatibility } from '../lib/astrology';
import type { RelationshipType } from '../lib/shared';
import { buildCompatibilityPrompt } from '../src/lib/prompts';

function buildPrompt(
  partnerMbti?: string | null,
  userMbti: string | null = 'INTP',
  relationshipType: RelationshipType = 'romantic',
) {
  const userBirthDate = new Date(Date.UTC(1994, 10, 26));
  const partnerBirthDate = new Date(Date.UTC(2001, 5, 15));
  const userBazi = calculateBazi(userBirthDate, 2, 'male');
  const partnerBazi = calculateBazi(partnerBirthDate);
  const score = calculateCompatibility(userBazi, partnerBazi);

  return buildCompatibilityPrompt(
    {
      name: 'เจ้า',
      birthDate: userBirthDate,
      baziChart: userBazi,
      thaiAstrology: calculateThaiAstrology(userBirthDate),
      mbtiType: userMbti,
    },
    {
      name: 'มานี',
      birthDate: partnerBirthDate,
      baziChart: partnerBazi,
      thaiAstrology: calculateThaiAstrology(partnerBirthDate),
      mbtiType: partnerMbti,
    },
    relationshipType,
    {
      score: score.score,
      scoreExplanation: score.overallAnalysis,
      strengths: score.strengths,
      challenges: score.challenges,
    },
  );
}

describe('compatibility prompt partner MBTI', () => {
  test('includes the partner MBTI line and blend instruction when provided', () => {
    const prompt = buildPrompt('ENFP');

    expect(prompt).toContain('MBTI: ENFP');
    expect(prompt).toContain('ผสมบุคลิกภาพ MBTI ของ มานี เข้ากับการวิเคราะห์อย่างกลมกลืน');
  });

  test('omits the partner MBTI line when absent', () => {
    const prompt = buildPrompt(null);

    expect(prompt).not.toContain('MBTI: ');
    expect(prompt).not.toContain('ผสมบุคลิกภาพ MBTI ของ');
  });

  test('includes the partner MBTI line when the user has no MBTI', () => {
    const prompt = buildPrompt('ENFP', null);

    expect(prompt).toContain('MBTI: ENFP');
    expect(prompt).not.toContain('กฎพิเศษสำหรับการใช้ข้อมูล MBTI');
  });
});

describe('compatibility prompt relationship focus', () => {
  test.each([
    ['romantic', ['ความคาดหวังร่วมกัน', 'ซ่อมแซมบทสนทนา']],
    ['talking', ['จังหวะการคุย', 'โดยไม่เร่งสถานะ']],
    ['friend', ['เช็กอินอย่างเป็นธรรมชาติ', 'เสนอเวลาอื่นได้']],
    ['boss', ['ลำดับความสำคัญ', 'ขอบเขตแบบมืออาชีพ']],
    ['coworker', ['เจ้าของงาน', 'จุดส่งมอบ']],
    ['family', ['ความคาดหวังที่ต่างกัน', 'ขอบเขตด้วยถ้อยคำที่เคารพกัน']],
  ] as const)('focuses %s advice on its real interaction', (relationshipType, expectedPhrases) => {
    const prompt = buildPrompt(null, 'INTP', relationshipType);

    for (const phrase of expectedPhrases) {
      expect(prompt).toContain(phrase);
    }
  });
});
