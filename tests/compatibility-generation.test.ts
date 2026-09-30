import { afterEach, describe, expect, test } from 'bun:test';
import { generateCompatibilityV4Plan } from '../src/lib/llm';

/**
 * The generation loop every compatibility call shares (generateValidatedCompatibilityJson),
 * driven through the insight plan call, the smallest v4 shape.
 */

const originalFetch = globalThis.fetch;

const insight = (chapter: string, basis: string) => ({
  text: 'ทั้งคู่ช่วยกันมองเรื่องเดิมจากคนละมุมเมื่อบอกความต้องการให้ชัด',
  basis: [basis],
  chapter,
});

const validPlan = {
  insights: [
    insight('attraction', 'dayBranch'),
    insight('partner', 'partnerThaiDay'),
    insight('you', 'readerThaiDay'),
    insight('communication', 'element'),
    insight('friction', 'yearBranch'),
    insight('future', 'month1'),
  ],
};

/** Five insights: no chapter for future, which the schema names. */
const planMissingFuture = { insights: validPlan.insights.slice(0, 5) };

function deepSeekResponse(content: unknown): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/** Answers each model call with the next reply in `replies`, recording every request. */
function mockReplies(...replies: unknown[]): RequestInit[] {
  const requests: RequestInit[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init ?? {});
    return deepSeekResponse(replies.length > 1 ? replies.shift() : replies[0]);
  }) as typeof fetch;
  return requests;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('compatibility generation loop', () => {
  test('returns a valid first reply with one fetch and the plan token limit', async () => {
    const requests = mockReplies(validPlan);

    const result = await generateCompatibilityV4Plan('วางข้อสังเกตของคู่นี้', {});

    expect(result).toEqual({ data: validPlan, softIssues: [] });
    expect(requests).toHaveLength(1);
    const body = JSON.parse(String(requests[0]?.body)) as { max_tokens: number };
    expect(body.max_tokens).toBe(1500);
  });

  test('repairs an invalid reply once, as a follow-up turn that names the failed field', async () => {
    const requests = mockReplies(planMissingFuture, validPlan);

    const result = await generateCompatibilityV4Plan('วางข้อสังเกตของคู่นี้', {});

    expect(result.data).toEqual(validPlan);
    expect(requests).toHaveLength(2);
    const repair = JSON.parse(String(requests[1]?.body)) as { messages: Array<{ role: string; content: string }> };
    expect(repair.messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(repair.messages[3]?.content).toContain('insights');
    expect(repair.messages[3]?.content).toContain('add one for future');
  });

  test('rejects once the repairs run out, without another request', async () => {
    const requests = mockReplies(planMissingFuture);

    await expect(generateCompatibilityV4Plan('วางข้อสังเกตของคู่นี้', { maxRepairs: 1 }))
      .rejects.toThrow('Invalid compatibility JSON');
    expect(requests).toHaveLength(2);
  });

  test('a quality issue gets one repair and is returned as a soft issue if it stays', async () => {
    const requests = mockReplies(validPlan);

    const result = await generateCompatibilityV4Plan('วางข้อสังเกตของคู่นี้', { softCheck: () => ['insights.0.text: too generic'] });

    expect(result).toEqual({ data: validPlan, softIssues: ['insights.0.text: too generic'] });
    expect(requests).toHaveLength(2);
  });
});
