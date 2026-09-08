import { afterEach, describe, expect, test } from 'bun:test';
import { generateStructuredCompatibilityReading } from '../src/lib/llm';

const originalFetch = globalThis.fetch;

const validGeneratedContent = {
  verdict: 'คุยกันได้ดีเมื่อบอกความต้องการให้ชัด',
  chemistry: 'ทั้งคู่ช่วยกันมองเรื่องเดิมจากคนละมุม',
  caution: 'ถ้ารีบสรุปจากความเงียบ อาจทำให้บทสนทนาติดขัด',
  advice: 'ใช้คำถามที่ตอบได้ตรง ๆ เพื่อให้ต่างฝ่ายมีพื้นที่บอกความต้องการ',
  nextSteps: {
    action: 'เย็นวันศุกร์ ชวนคุยเรื่องช่วงเวลาที่สะดวกติดต่อกัน',
    conversationStarter: 'เราอยากคุยกันให้ลงตัวขึ้น เธอสะดวกคุยช่วงไหนบ้าง',
    watchFor: 'อีกฝ่ายบอกช่วงเวลาที่สะดวกหรือเสนอทางเลือกอื่นที่ชัดเจน',
  },
};

function deepSeekResponse(content: unknown): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('compatibility generation validation', () => {
  test('returns a valid first response with one fetch and the requested token limit', async () => {
    const requests: RequestInit[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return deepSeekResponse(validGeneratedContent);
    }) as typeof fetch;

    const result = await generateStructuredCompatibilityReading('วิเคราะห์ความสัมพันธ์', 432);

    expect(result).toEqual(validGeneratedContent);
    expect(requests).toHaveLength(1);
    const requestBody = JSON.parse(String(requests[0]?.body)) as { max_tokens: number };
    expect(requestBody.max_tokens).toBe(432);
  });

  test.each([
    ['missing next steps', { ...validGeneratedContent, nextSteps: undefined }],
    ['partial next steps', {
      ...validGeneratedContent,
      nextSteps: {
        action: validGeneratedContent.nextSteps.action,
        conversationStarter: validGeneratedContent.nextSteps.conversationStarter,
      },
    }],
    ['overlong next step', {
      ...validGeneratedContent,
      nextSteps: { ...validGeneratedContent.nextSteps, action: 'ก'.repeat(181) },
    }],
  ])('repairs %s once before returning complete content', async (_label, invalidContent) => {
    const requests: RequestInit[] = [];
    const responses = [invalidContent, validGeneratedContent];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return deepSeekResponse(responses.shift());
    }) as typeof fetch;

    const result = await generateStructuredCompatibilityReading('วิเคราะห์ความสัมพันธ์', 300);

    expect(result).toEqual(validGeneratedContent);
    expect(requests).toHaveLength(2);
    const repairedRequest = JSON.parse(String(requests[1]?.body)) as {
      messages: Array<{ content: string }>;
    };
    expect(repairedRequest.messages[1]?.content).toContain('complete nextSteps object');
  });

  test('rejects after one failed repair without making another request', async () => {
    const requests: RequestInit[] = [];
    const invalidContent = { ...validGeneratedContent, nextSteps: undefined };
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return deepSeekResponse(invalidContent);
    }) as typeof fetch;

    await expect(generateStructuredCompatibilityReading('วิเคราะห์ความสัมพันธ์', 300))
      .rejects.toThrow('Invalid compatibility JSON');
    expect(requests).toHaveLength(2);
  });
});
