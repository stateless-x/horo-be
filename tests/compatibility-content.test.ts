import { describe, expect, test } from 'bun:test';
import { CompatibilityStructuredContentSchema } from '../lib/shared';
import { parseCompatibilityContent } from '../src/lib/compatibility-content';

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
    const parsed = parseCompatibilityContent(JSON.stringify(structuredFixture));
    expect(parsed?.contentVersion).toBe(2);
    expect(parsed?.contentVersion === 2 ? parsed.nextSteps?.action : undefined).toBe(structuredFixture.nextSteps.action.trim());
    expect(parseCompatibilityContent(JSON.stringify(savedV2Fixture))).toEqual(savedV2Fixture);
    expect(parseCompatibilityContent('## ภาพรวม\nคำทำนายแบบเดิม')).toBeNull();
  });

});
