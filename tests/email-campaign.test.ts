import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { listCampaignIds, listCampaigns, loadCampaign, renderBody, toHtml, toText } from '../src/lib/campaigns';
import { isRetryableStatus, signUnsubscribeToken, verifyUnsubscribeToken } from '../src/lib/email';
import { emailSends } from '../lib/db/schema';

/**
 * Guards the two properties the campaign sender depends on:
 *
 *   1. The unique index on (user_id, campaign_id) — the ONLY thing standing
 *      between a re-run and a user getting the same email twice. If that index
 *      is dropped or its columns change, onConflictDoNothing() silently stops
 *      deduping and every re-run mails everyone again.
 *   2. Unsubscribe tokens are unforgeable — otherwise anyone could opt out
 *      another user by editing the id in the URL.
 *
 * Content rendering is covered too, since the campaign body is Thai with a
 * punycode link and a mangled URL is invisible until a real recipient reports it.
 */

describe('email_sends dedup index', () => {
  test('unique index covers exactly (user_id, campaign_id)', () => {
    // Asserted against the schema SOURCE rather than drizzle's runtime objects:
    // invoking the extra-config builder mutates drizzle's internal index state
    // and throws on a second call, so reading the file is both safer and a
    // truer check that the shipped declaration says what we think.
    const source = readFileSync(join(import.meta.dir, '../lib/db/schema/email.ts'), 'utf-8');
    const match = source.match(/uniqueIndex\('email_sends_user_campaign_idx'\)\.on\(([^)]*)\)/);

    expect(match).not.toBeNull();

    const columns = match![1].split(',').map((c) => c.trim()).filter(Boolean);
    expect(columns).toEqual(['table.userId', 'table.campaignId']);
  });

  test('status defaults to pending so a row is claimed before it is sent', () => {
    // The claim-then-send order is what makes a crash skip a user rather than
    // double-send. A row that defaulted to 'sent' would invert that.
    expect((emailSends.status as any).default).toBe('pending');
  });
});

describe('unsubscribe tokens', () => {
  test('round-trips a valid token', () => {
    const token = signUnsubscribeToken('user-abc');
    expect(verifyUnsubscribeToken(token)).toBe('user-abc');
  });

  test('rejects a token signed for a different user', () => {
    const token = signUnsubscribeToken('user-abc');
    const forged = token.replace('user-abc', 'user-xyz');
    expect(verifyUnsubscribeToken(forged)).toBeNull();
  });

  test('rejects a tampered signature', () => {
    const token = signUnsubscribeToken('user-abc');
    const [id] = token.split('.');
    expect(verifyUnsubscribeToken(`${id}.deadbeef`)).toBeNull();
  });

  test('rejects a bare user id with no signature', () => {
    expect(verifyUnsubscribeToken('user-abc')).toBeNull();
  });

  test('preserves ids containing dots', () => {
    // Splits on the LAST dot, so an id with dots still round-trips.
    const token = signUnsubscribeToken('user.with.dots');
    expect(verifyUnsubscribeToken(token)).toBe('user.with.dots');
  });
});

describe('campaign rendering', () => {
  test('substitutes {{name}}', () => {
    expect(renderBody('สวัสดี {{name}} ครับ', { name: 'ภู' })).toBe('สวัสดี ภู ครับ');
  });

  test('keeps the Thai label but links the ascii punycode href', () => {
    // The whole point of the punycode form: readers see Thai, mail servers
    // and spam filters see plain ASCII.
    const html = toHtml('ลองที่ [สายมู.com/login](https://xn--y3cbx6azb.com/login)');
    expect(html).toContain('href="https://xn--y3cbx6azb.com/login"');
    expect(html).toContain('>สายมู.com/login</a>');
  });

  test('plain text collapses a self-referential idn link to one url', () => {
    // Printing "สายมู.com/login (https://xn--y3cbx6azb.com/login)" is the same
    // destination twice — noise in a text client.
    const text = toText('ลองที่ [สายมู.com/login](https://xn--y3cbx6azb.com/login)');
    expect(text).toBe('ลองที่ https://xn--y3cbx6azb.com/login');
  });

  test('plain text keeps label and url when they differ', () => {
    const text = toText('ดูที่ [ผลงานของผม](https://pooh.fyi)');
    expect(text).toBe('ดูที่ ผลงานของผม (https://pooh.fyi)');
  });

  test('escapes html in the body', () => {
    expect(toHtml('a < b & c')).toContain('a &lt; b &amp; c');
  });

  test('appends an unsubscribe link to both formats when given', () => {
    const link = 'https://api.example.com/email/unsubscribe/tok';
    expect(toHtml('สวัสดี', link)).toContain(link);
    expect(toText('สวัสดี', link)).toContain(link);
  });

  test('omits the unsubscribe footer when no link is given', () => {
    expect(toHtml('สวัสดี')).not.toContain('ยกเลิกการรับอีเมล');
    expect(toText('สวัสดี')).not.toContain('ยกเลิก');
  });
});

/**
 * Retry classification decides whether a failed recipient is released back into
 * the candidate pool or permanently recorded.
 *
 * Getting this backwards is costly both ways: treating a hard bounce as
 * retryable mails a dead address on every run (which is what destroys sending
 * reputation), while treating a transient blip as permanent silently drops a
 * real user who would have received the mail on a retry.
 *
 * Tests the classifier directly rather than driving sendEmail with a stubbed
 * fetch: sendEmail short-circuits on missing RESEND_API_KEY/EMAIL_FROM, so a
 * fetch-level test would pass locally and fail in CI purely on env.
 */
describe('failure retry classification', () => {
  test('5xx is retryable — provider-side and likely transient', () => {
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
  });

  test('429 is retryable — rate limited, not rejected', () => {
    expect(isRetryableStatus(429)).toBe(true);
  });

  test('422 is NOT retryable — a bad address stays bad', () => {
    expect(isRetryableStatus(422)).toBe(false);
  });

  test('403 is NOT retryable — unverified domain needs a config fix', () => {
    expect(isRetryableStatus(403)).toBe(false);
  });

  test('400 and 401 are NOT retryable — the request itself is wrong', () => {
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
  });
});

/**
 * The optional `name` in front-matter is a human label for listings. It must
 * stay cosmetic: the dedupe key is the campaign ID (the filename), so renaming
 * a campaign must never make already-mailed users eligible again.
 */
describe('campaign front-matter', () => {
  test('the shipped campaign parses and carries a name', () => {
    const c = loadCampaign('2026-09-15-relaunch');
    expect(c.id).toBe('2026-09-15-relaunch');
    expect(c.name).toBeTruthy();
    expect(c.subject).toContain('สายมู.com');
    expect(c.body.length).toBeGreaterThan(100);
  });

  test('name is optional — a file without one still loads', () => {
    const ids = listCampaignIds();
    expect(ids).toContain('2026-09-15-relaunch');
    // Parsing must not require `name`; only subject and body are mandatory.
    for (const id of ids) expect(() => loadCampaign(id)).not.toThrow();
  });

  test('listCampaigns pairs every id with its label', () => {
    const listed = listCampaigns();
    expect(listed.length).toBe(listCampaignIds().length);
    expect(listed.find((c) => c.id === '2026-09-15-relaunch')?.name).toBeTruthy();
  });

  test('the shipped campaign links punycode, never raw thai script', () => {
    // A Thai-script href is unreliable in mail clients; the label may be Thai
    // but the destination must be ASCII.
    const html = toHtml(loadCampaign('2026-09-15-relaunch').body);
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).toMatch(/^https:\/\/[\x00-\x7F]+$/);
  });
});
