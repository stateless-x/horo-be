import { afterEach, describe, expect, test } from 'bun:test';
import { generateTeaserReading } from '../src/lib/llm';

const originalFetch = globalThis.fetch;

const USER_NAME = 'Purin';

// Lengths chosen to match what real DeepSeek output measures in JS .length
// (Thai vowel/tone marks each count as their own UTF-16 code unit): accepted
// threeWay ran ~54-62, reading ~145-159 — comfortably inside the schema's
// min(10)/max(120) and min(60)/max(320) bounds.
const validContent = {
  threeWay: 'คุณเป็นคนที่ยึดเป้าหมายมั่นและลุยแก้ปัญหาตรงหน้าโดยไม่ลังเล',
  reading:
    'วันนี้เรื่องการเงินต้องใส่ใจเป็นพิเศษ ลองทบทวนรายจ่ายที่ไม่จำเป็นก่อนตัดสินใจซื้อของใหญ่ แล้วมาดูกันว่าทั้งเดือนนี้จะเป็นอย่างไรต่อ',
};

function deepSeekResponse(content: unknown): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('generateTeaserReading validation', () => {
  test('accepts a realistic first response with one fetch', async () => {
    const requests: RequestInit[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return deepSeekResponse(validContent);
    }) as typeof fetch;

    const result = await generateTeaserReading('เขียนคำทำนาย', USER_NAME);

    expect(result).toEqual(validContent);
    expect(requests).toHaveLength(1);
  });

  test('accepts reading well past the old 170-char cap, since Thai tone/vowel marks inflate .length', async () => {
    // 200 Thai characters is a realistic DeepSeek output for "about 2
    // sentences, not too long" — the old max(170) rejected this even though
    // it reads as a normal-length reply.
    const longerReading = {
      threeWay: validContent.threeWay,
      reading: 'วันนี้เรื่องการเงินของคุณต้องใส่ใจเป็นพิเศษกว่าปกติเล็กน้อย '
        + 'ลองทบทวนรายจ่ายที่ไม่จำเป็นก่อนตัดสินใจซื้อของชิ้นใหญ่ในช่วงนี้ '
        + 'แล้วมาดูกันว่าทั้งเดือนนี้ดวงของคุณจะพลิกไปทางไหนต่อ',
    };
    expect(longerReading.reading.length).toBeGreaterThan(170);

    globalThis.fetch = (async () => deepSeekResponse(longerReading)) as typeof fetch;

    const result = await generateTeaserReading('เขียนคำทำนาย', USER_NAME);
    expect(result).toEqual(longerReading);
  });

  test('rejects a reading below the 60-char floor after one failed retry', async () => {
    const tooShort = { threeWay: validContent.threeWay, reading: 'สั้นไป' };
    globalThis.fetch = (async () => deepSeekResponse(tooShort)) as typeof fetch;

    await expect(generateTeaserReading('เขียนคำทำนาย', USER_NAME)).rejects.toThrow();
  });

  test('rejects a threeWay past the 120-char cap (a mobile hero line that would wrap ~5 lines) after one failed retry', async () => {
    // Observed real output before the ~15-word prompt guidance ran up to 132
    // characters — this is exactly the class of reply the tightened max(120)
    // must now reject rather than accept as before.
    const tooLongThreeWay = {
      threeWay: 'คุณเป็นคนที่มองเห็นรายละเอียดเล็กๆ ที่คนอื่นมองข้ามไป และเมื่อผสมกับความมุ่งมั่นที่ไม่ยอมแพ้ง่ายๆ ทำให้คุณมักจะไปถึงเป้าหมายที่วางไว้ได้เสมอไม่ว่าจะยากแค่ไหนก็ตาม',
      reading: validContent.reading,
    };
    expect(tooLongThreeWay.threeWay.length).toBeGreaterThan(120);

    globalThis.fetch = (async () => deepSeekResponse(tooLongThreeWay)) as typeof fetch;

    await expect(generateTeaserReading('เขียนคำทำนาย', USER_NAME)).rejects.toThrow();
  });

  test('retries once on invalid JSON, then succeeds', async () => {
    const requests: RequestInit[] = [];
    const responses: unknown[] = ['not json', JSON.stringify(validContent)];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      const next = responses.shift();
      return new Response(JSON.stringify({
        choices: [{ message: { content: next } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    const result = await generateTeaserReading('เขียนคำทำนาย', USER_NAME);
    expect(result).toEqual(validContent);
    expect(requests).toHaveLength(2);
  });

  test('rejects after one failed repair without making a third request', async () => {
    const requests: RequestInit[] = [];
    const tooShort = { threeWay: validContent.threeWay, reading: 'สั้นไป' };
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return deepSeekResponse(tooShort);
    }) as typeof fetch;

    await expect(generateTeaserReading('เขียนคำทำนาย', USER_NAME)).rejects.toThrow();
    expect(requests).toHaveLength(2);
  });

  test('rejects threeWay that starts with the user\'s name, even though it otherwise validates', async () => {
    const startsWithName = { ...validContent, threeWay: `${USER_NAME}เป็นคนที่ยึดเป้าหมายมั่น` };
    globalThis.fetch = (async () => deepSeekResponse(startsWithName)) as typeof fetch;

    await expect(generateTeaserReading('เขียนคำทำนาย', USER_NAME))
      .rejects.toThrow("threeWay started with the user's name");
  });
});
