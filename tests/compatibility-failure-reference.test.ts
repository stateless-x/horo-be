import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as session from '../src/lib/session';
import * as shared from '../src/systems/shared';
import * as unlock from '../src/systems/compatibility/unlock';
import { compatibilityRoutes } from '../src/systems/compatibility/routes';

/**
 * A 500 on the ดวงคู่ check or unlock carries a short `reference`, and the
 * same id is logged on one `[compat] failure` line so support can find it.
 * No database: the session is spied and the first step past it throws.
 */
const ROW = '11111111-1111-4111-8111-111111111111';
const spies: { mockRestore: () => void }[] = [];

afterEach(() => {
  while (spies.length) spies.pop()!.mockRestore();
});

function signedIn() {
  spies.push(spyOn(session, 'validateSessionFromRequest').mockResolvedValue({
    userId: 'u-failure-reference',
    email: 'u@failure.test',
    expiresAt: new Date(Date.now() + 3_600_000),
  }));
}

/** Captures console.error lines (and keeps them out of the test output). */
function capturedErrors() {
  const lines: string[] = [];
  spies.push(spyOn(console, 'error').mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' '))));
  return lines;
}

async function post(path: string, body: unknown) {
  return compatibilityRoutes.handle(
    new Request(`http://localhost/api/fortune${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

function expectLoggedOnce(lines: string[], reference: string, cause: string) {
  const logged = lines.filter((line) => line.startsWith('[compat] failure '));
  expect(logged).toEqual([`[compat] failure reference=${reference} cause=${cause}`]);
}

describe('compatibility 500 bodies carry a logged reference', () => {
  test('the check (teaser): { error, reference }, and the log line has the same id', async () => {
    signedIn();
    spies.push(spyOn(shared, 'getCachedProfile').mockRejectedValue(new Error('connection reset\nsecond line')));
    const lines = capturedErrors();

    const response = await post('/compatibility', {
      partnerName: 'ต้น',
      partnerBirthDate: '1995-03-04T00:00:00.000Z',
      relationshipType: 'talking',
    });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string; reference: string };
    expect(body.error).toBeString();
    expect(body.reference).toMatch(/^[0-9a-f]{8}$/);
    expectLoggedOnce(lines, body.reference, 'Error: connection reset');
    expect(lines.join('\n')).not.toContain('ต้น');
  });

  test('the unlock: { error, reference }, and the log line has the same id', async () => {
    signedIn();
    spies.push(spyOn(unlock, 'unlockForUser').mockRejectedValue(new TypeError('model timed out')));
    const lines = capturedErrors();

    const response = await post(`/compatibility/${ROW}/unlock`, {});
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string; reference: string };
    expect(body.reference).toMatch(/^[0-9a-f]{8}$/);
    expectLoggedOnce(lines, body.reference, 'TypeError: model timed out');
  });

  test('each failure gets its own reference', async () => {
    signedIn();
    spies.push(spyOn(unlock, 'unlockForUser').mockRejectedValue(new Error('boom')));
    capturedErrors();

    const first = (await (await post(`/compatibility/${ROW}/unlock`, {})).json()) as { reference: string };
    const second = (await (await post(`/compatibility/${ROW}/unlock`, {})).json()) as { reference: string };
    expect(first.reference).not.toBe(second.reference);
  });
});
