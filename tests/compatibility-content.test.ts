import { describe, expect, test } from 'bun:test';
import { calculateBazi, calculateThaiAstrology } from '../lib/astrology';
import { CompatibilityStructuredContentSchema } from '../lib/shared';
import { parseCompatibilityContent } from '../src/lib/compatibility-content';
import { buildCompatibilityPrompt } from '../src/lib/prompts';

const structuredFixture = {
  contentVersion: 2 as const,
  scoreExplanation: 'ความเข้ากันได้อยู่ในระดับดี มีทั้งจุดร่วมและพื้นที่ให้ปรับตัว',
  verdict: 'คู่นี้คุยกันติดง่าย แต่ต้องชัดเจนเรื่องความคาดหวัง',
  chemistry: 'พลังของทั้งคู่ช่วยเปิดมุมมองใหม่ให้กัน และมีจังหวะสนทนาที่เป็นธรรมชาติ',
  caution: 'อย่าปล่อยให้การเดาใจแทนที่การถามตรง ๆ เพราะความเงียบอาจถูกตีความผิด',
  advice: 'ลองบอกความต้องการหนึ่งเรื่องให้ชัด แล้วฟังคำตอบโดยไม่รีบสรุปแทนอีกฝ่าย',
};

describe('compatibility v2 content', () => {
  test('accepts the compact structured contract', () => {
    expect(CompatibilityStructuredContentSchema.parse(structuredFixture)).toEqual(structuredFixture);
  });

  test('parses v2 JSON and leaves legacy markdown untouched', () => {
    expect(parseCompatibilityContent(JSON.stringify(structuredFixture))).toEqual(structuredFixture);
    expect(parseCompatibilityContent('## ภาพรวม\nคำทำนายแบบเดิม')).toBeNull();
  });

  test('prompt locks the deterministic score and requests only four short fields', () => {
    const person1Date = new Date(Date.UTC(1994, 10, 26));
    const person2Date = new Date(Date.UTC(2001, 5, 15));
    const prompt = buildCompatibilityPrompt(
      {
        name: 'เจ้า',
        birthDate: person1Date,
        baziChart: calculateBazi(person1Date),
        thaiAstrology: calculateThaiAstrology(person1Date),
        mbtiType: 'INFP',
      },
      {
        name: 'มิน',
        birthDate: person2Date,
        baziChart: calculateBazi(person2Date),
        thaiAstrology: calculateThaiAstrology(person2Date),
      },
      'talking',
      {
        score: 68,
        scoreExplanation: 'ความเข้ากันได้อยู่ในระดับดี',
        strengths: ['คุยกันเข้าใจง่าย'],
        challenges: ['อย่าเดาใจแทนกัน'],
      },
    );

    expect(prompt).toContain('คะแนน: 68/100');
    expect(prompt).toContain('ห้ามเปลี่ยนคะแนน');
    expect(prompt).toContain('`verdict`');
    expect(prompt).toContain('`chemistry`');
    expect(prompt).toContain('`caution`');
    expect(prompt).toContain('`advice`');
    expect(prompt).toContain('ไม่เกิน 3 ประโยค');
    expect(prompt).not.toContain('## ภาพรวมความสัมพันธ์');
  });
});
