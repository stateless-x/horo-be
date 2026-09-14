import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { listCampaignIds, listCampaigns, loadCampaign, renderBody, toHtml, toText } from '../src/lib/campaigns';
import { config } from '../src/config';
import { getAccountSentToday, isRetryableStatus, sendEmail, signUnsubscribeToken, verifyUnsubscribeToken } from '../src/lib/email';
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
  // `bun test` does not load .env.local, so BETTER_AUTH_SECRET is absent here
  // unless the test sets it. Signing without one is an error (it would produce
  // links that verify always rejects), so these set a known value rather than
  // inheriting whatever the shell happens to have.
  const REAL_SECRET = process.env.BETTER_AUTH_SECRET;
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = 'test-unsubscribe-secret';
  });
  afterEach(() => {
    if (REAL_SECRET === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = REAL_SECRET;
  });

  test('signing without a secret throws rather than making a dead link', () => {
    // The bug this guards: sign() used to happily sign with an empty secret
    // while verify() rejected it, so every unsubscribe link was born invalid.
    delete process.env.BETTER_AUTH_SECRET;
    expect(() => signUnsubscribeToken('user-abc')).toThrow(/BETTER_AUTH_SECRET/);
  });

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

/**
 * Account-wide quota accounting.
 *
 * The Resend quota is per ACCOUNT, so other sites on the same key spend it and
 * our own email_sends rows cannot see them. getAccountSentToday asks the
 * provider instead. The rule that matters: an unreadable answer must return
 * `known: false`, never 0 — reporting "nobody sent anything" when we simply
 * could not look is what would spend the other sites' quota.
 */
describe('account-wide quota', () => {
  const dayStart = new Date('2026-09-14T17:00:00Z'); // 2026-09-15 00:00 Bangkok

  // getAccountSentToday short-circuits to `known: false` without an API key, so
  // the key is set here rather than inherited from the shell — otherwise these
  // pass locally and fail in CI, where no email env is configured.
  const withFetch = async (
    stub: (url: string) => Response | Promise<Response>,
    run: () => Promise<void>,
  ) => {
    const real = globalThis.fetch;
    const realKey = config.email.resendApiKey;
    config.email.resendApiKey = 'test-key';
    globalThis.fetch = ((input: any) =>
      Promise.resolve(stub(typeof input === 'string' ? input : input.toString()))) as any;
    try {
      await run();
    } finally {
      globalThis.fetch = real;
      config.email.resendApiKey = realKey;
    }
  };

  const page = (rows: { id: string; created_at: string }[]) =>
    new Response(JSON.stringify({ data: rows }), { status: 200 });

  test('counts only messages sent since the Bangkok day start', async () => {
    await withFetch(
      () =>
        page([
          { id: 'e3', created_at: '2026-09-15T03:00:00Z' }, // today
          { id: 'e2', created_at: '2026-09-14T18:00:00Z' }, // today
          { id: 'e1', created_at: '2026-09-14T10:00:00Z' }, // yesterday — stops here
        ]),
      async () => {
        const usage = await getAccountSentToday(dayStart);
        expect(usage.known).toBe(true);
        expect(usage.known && usage.sentToday).toBe(2);
      },
    );
  });

  test('counts other sites mail, not just ours', async () => {
    // Every row counts regardless of which site sent it — that is the point.
    await withFetch(
      () =>
        page(
          Array.from({ length: 12 }, (_, i) => ({
            id: `e${i}`,
            created_at: '2026-09-15T02:00:00Z',
          })),
        ),
      async () => {
        const usage = await getAccountSentToday(dayStart);
        expect(usage.known && usage.sentToday).toBe(12);
      },
    );
  });

  test('an empty account reads as zero, not unknown', async () => {
    await withFetch(
      () => page([]),
      async () => {
        const usage = await getAccountSentToday(dayStart);
        expect(usage.known).toBe(true);
        expect(usage.known && usage.sentToday).toBe(0);
      },
    );
  });

  test('an API error is unknown, never zero', async () => {
    // The critical case: treating a failed lookup as 0 would hand the whole
    // cap to this campaign and break the other sites' mail.
    await withFetch(
      () => new Response('nope', { status: 500 }),
      async () => {
        const usage = await getAccountSentToday(dayStart);
        expect(usage.known).toBe(false);
      },
    );
  });

  test('a network throw is unknown, never zero', async () => {
    await withFetch(
      () => {
        throw new Error('ECONNRESET');
      },
      async () => {
        const usage = await getAccountSentToday(dayStart);
        expect(usage.known).toBe(false);
      },
    );
  });

  test('malformed json is unknown, never zero', async () => {
    await withFetch(
      () => new Response('<html>', { status: 200 }),
      async () => {
        const usage = await getAccountSentToday(dayStart);
        expect(usage.known).toBe(false);
      },
    );
  });
});

/**
 * Recipient privacy: one email, one addressee.
 *
 * A campaign goes to real people who did not consent to having their address
 * shown to anyone else. Leaking the list would be a privacy breach (and a PDPA
 * problem), and the kind of mistake that is invisible in code review — a `to`
 * that quietly accepts an array, or a cc/bcc added "for convenience", would do
 * it. These assert the shape of what actually reaches Resend.
 */
describe('recipient privacy', () => {
  const withCapturedBody = async (run: () => Promise<void>): Promise<any> => {
    const real = globalThis.fetch;
    const realKey = config.email.resendApiKey;
    const realFrom = config.email.from;
    let captured: any = null;
    config.email.resendApiKey = 'test-key';
    config.email.from = 'Test <horo@mail.pooh.fyi>';
    globalThis.fetch = (async (_input: any, init: any) => {
      captured = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 });
    }) as any;
    try {
      await run();
    } finally {
      globalThis.fetch = real;
      config.email.resendApiKey = realKey;
      config.email.from = realFrom;
    }
    return captured;
  };

  test('sends to exactly one address, never a list', async () => {
    const body = await withCapturedBody(async () => {
      await sendEmail({ to: 'one@example.com', subject: 's', html: '<p>h</p>', text: 't' });
    });
    expect(body.to).toEqual(['one@example.com']);
    expect(body.to.length).toBe(1);
  });

  test('never sets cc or bcc', async () => {
    // bcc would hide addresses from recipients but still hand the whole list
    // to the provider on one message; cc would expose it outright.
    const body = await withCapturedBody(async () => {
      await sendEmail({ to: 'one@example.com', subject: 's', html: '<p>h</p>', text: 't' });
    });
    expect(body.cc).toBeUndefined();
    expect(body.bcc).toBeUndefined();
  });

  test('no other recipient address appears anywhere in the payload', async () => {
    // The rendered body is personalised, so a templating mistake could paste
    // another user's address into the message itself.
    const body = await withCapturedBody(async () => {
      await sendEmail({
        to: 'one@example.com',
        subject: 's',
        html: toHtml(renderBody('สวัสดี {{name}}', { name: 'ภู' })),
        text: toText(renderBody('สวัสดี {{name}}', { name: 'ภู' })),
      });
    });
    const serialised = JSON.stringify(body);
    expect(serialised).toContain('one@example.com');
    // Any second address would have to come from somewhere it should not.
    const addresses = serialised.match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? [];
    const recipientsOnly = addresses.filter((a) => a !== 'horo@mail.pooh.fyi');
    expect(new Set(recipientsOnly)).toEqual(new Set(['one@example.com']));
  });
});

/**
 * Email HTML structure.
 *
 * Mail clients are not browsers: Outlook renders through Word and drops
 * <style> blocks, flex, and grid. These assert the portable shape — tables,
 * inline styles, and a button that is a padded table cell rather than a styled
 * <a> that would collapse.
 */
describe('email html structure', () => {
  const campaign = () => loadCampaign('2026-09-15-relaunch');

  test('the call to action is an underlined text link, not a button', () => {
    const html = toHtml(campaign().body);
    expect(html).toContain('text-decoration:underline');
    // No button chrome: a coloured cell would make it a button again.
    expect(html).not.toContain('bgcolor=');
  });

  test('the call to action keeps the punycode href with a Thai label', () => {
    const html = toHtml(campaign().body);
    expect(html).toMatch(/href="https:\/\/xn--y3cbx6azb\.com\/login"[^>]*>สายมู\.com</);
  });

  test('uses table layout with no <style> block or flex', () => {
    const html = toHtml(campaign().body);
    expect(html).toContain('<table');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('display:flex');
    expect(html).not.toContain('display:grid');
  });

  test('stays plain: no panels, banners, or button chrome', () => {
    // The copy is a personal note. Decoration would make it read as a
    // marketing blast, which is not what the words are doing.
    const html = toHtml(campaign().body);
    expect(html).not.toContain('border-left:3px solid');
    expect(html).not.toContain('bgcolor=');
    expect(html).toContain('ดูดวงคู่ที่ละเอียดขึ้น');
  });

  test('links the X handle', () => {
    const html = toHtml(campaign().body);
    expect(html).toContain('href="https://x.com/saintcattivo"');
    expect(html).toContain('@saintcattivo');
  });

  test('every link carries an explicit colour', () => {
    // An unstyled <a> is left to the client's default and can render as plain
    // body text, so a reader never sees it as clickable.
    const html = toHtml(campaign().body, 'https://example.com/u/1');
    const anchors = html.match(/<a\b[^>]*>/g) ?? [];
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) expect(a).toContain('color:');
  });

  test('plain text shows the url and no markup syntax', () => {
    const text = toText(campaign().body);
    expect(text).not.toContain('[[');
    expect(text).not.toContain('](');
    expect(text).toContain('https://xn--y3cbx6azb.com/login');
  });
});

/**
 * Deployment packaging.
 *
 * Campaign markdown is read from disk at runtime, not bundled into dist/. That
 * keeps "add a campaign" to a file drop — but it also means the runtime image
 * must actually contain content/. It did not, so production served an empty
 * campaign list while the file sat committed in git: the send UI had nothing
 * to offer and looked broken for reasons no log explained.
 */
describe('docker image includes campaign files', () => {
  const dockerfile = readFileSync(join(import.meta.dir, '../Dockerfile'), 'utf-8');

  test('the runtime stage copies content/', () => {
    expect(dockerfile).toMatch(/COPY --from=builder \/app\/content \.\/content/);
  });

  test('.dockerignore does not exclude content/', () => {
    const ignore = readFileSync(join(import.meta.dir, '../.dockerignore'), 'utf-8');
    const lines = ignore.split('\n').map((l) => l.trim());
    expect(lines).not.toContain('content');
    expect(lines).not.toContain('content/');
  });
});
