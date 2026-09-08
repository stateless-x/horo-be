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
  nextSteps: {
    action: ' เย็นวันศุกร์ ลองชวนมินคุยเรื่องเวลาที่ทั้งคู่สะดวกสื่อสาร ',
    conversationStarter: 'ช่วงนี้เราอยากคุยกันให้ลงตัวขึ้น มินสะดวกคุยช่วงไหนบ้าง',
    watchFor: 'มินบอกช่วงเวลาที่สะดวกหรือเสนอทางเลือกอื่นที่ชัดเจน',
  },
};

const savedV2Fixture = {
  contentVersion: 2 as const,
  scoreExplanation: structuredFixture.scoreExplanation,
  verdict: structuredFixture.verdict,
  chemistry: structuredFixture.chemistry,
  caution: structuredFixture.caution,
  advice: structuredFixture.advice,
};

describe('compatibility v2 content', () => {
  test('accepts the compact structured contract', () => {
    expect(CompatibilityStructuredContentSchema.parse(structuredFixture)).toEqual({
      ...structuredFixture,
      nextSteps: {
        ...structuredFixture.nextSteps,
        action: structuredFixture.nextSteps.action.trim(),
      },
    });
  });

  test('parses saved v2 with and without next steps and leaves legacy markdown untouched', () => {
    expect(parseCompatibilityContent(JSON.stringify(structuredFixture))?.nextSteps?.action).toBe(
      structuredFixture.nextSteps.action.trim(),
    );
    expect(parseCompatibilityContent(JSON.stringify(savedV2Fixture))).toEqual(savedV2Fixture);
    expect(parseCompatibilityContent('## ภาพรวม\nคำทำนายแบบเดิม')).toBeNull();
  });

  test('prompt locks the deterministic score and separates guidance from concrete next steps', () => {
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
    expect(prompt).toContain('`nextSteps`');
    expect(prompt).toContain('ไม่เกิน 180 ตัวอักษร');
    expect(prompt).toContain('ไม่เกิน 220 ตัวอักษร');
    expect(prompt).toContain('ห้ามทวนการลงมือทำ');
    expect(prompt).toContain('ห้ามแต่งเหตุการณ์ในอดีต');
    expect(prompt).not.toContain('## ภาพรวมความสัมพันธ์');
  });
});
