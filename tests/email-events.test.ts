import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createHmac } from 'crypto';
import { config } from '../src/config';
import { verifyResendWebhook } from '../src/lib/resend-webhook';

/**
 * Guards the two properties the webhook ingestion depends on:
 *
 *   1. A request must carry a genuine svix signature before its payload is
 *      trusted at all — a forged or tampered request must be rejected with no
 *      side effects, never "verified" by accident.
 *   2. The unique index on (provider_id, event_type) — the ONLY thing
 *      standing between a Resend redelivery (or an overlapping backfill run)
 *      and a duplicate row. If that index is dropped or its columns change,
 *      onConflictDoNothing() silently stops deduping.
 *
 * The signature fixtures below build the expected signature independently
 * (raw base64 key -> HMAC -> base64), not by calling verifyResendWebhook's own
 * internals, so a bug that breaks both signing and verification the same way
 * cannot pass these tests by accident.
 */

const TEST_SECRET = 'whsec_dGVzdC1zZWNyZXQta2V5LWZvci11bml0LXRlc3Rz'; // base64("test-secret-key-for-unit-tests")

/** Signs a payload exactly the way Resend's svix sender does, independent of the code under test. */
function sign(secret: string, svixId: string, svixTimestamp: string, body: string): string {
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  const signedContent = `${svixId}.${svixTimestamp}.${body}`;
  const signature = createHmac('sha256', key).update(signedContent).digest('base64');
  return `v1,${signature}`;
}

describe('email_events dedup index', () => {
  test('unique index covers exactly (provider_id, event_type)', () => {
    // Asserted against the schema SOURCE, matching tests/email-campaign.test.ts's
    // approach for email_sends: invoking drizzle's extra-config builder mutates
    // its internal index state and throws on a second call, so reading the file
    // is both safer and a truer check of what is actually shipped. This is a
    // schema-declaration test, not a live-insert test — it does not touch a
    // database, so it cannot prove a real insert dedupes, only that the
    // declared index still covers the right columns.
    const source = readFileSync(join(import.meta.dir, '../lib/db/schema/email.ts'), 'utf-8');
    const match = source.match(/uniqueIndex\('email_events_provider_event_idx'\)\.on\(([^)]*)\)/);

    expect(match).not.toBeNull();

    const columns = match![1].split(',').map((c) => c.trim()).filter(Boolean);
    expect(columns).toEqual(['table.providerId', 'table.eventType']);
  });

  test('the webhook route and the backfill script both upsert with onConflictDoNothing on that index', () => {
    // Two ingestion paths write this table (webhook + backfill). Both must use
    // the SAME conflict target, or one path could silently stop deduping
    // against the other.
    const webhookSource = readFileSync(join(import.meta.dir, '../src/routes/resend-webhook.ts'), 'utf-8');
    const backfillSource = readFileSync(join(import.meta.dir, '../scripts/sync-email-events.ts'), 'utf-8');

    for (const source of [webhookSource, backfillSource]) {
      expect(source).toMatch(/onConflictDoNothing\(\{\s*target:\s*\[emailEvents\.providerId,\s*emailEvents\.eventType\]\s*\}\)/);
    }
  });
});

describe('resend webhook signature verification', () => {
  const REAL_SECRET = config.email.webhookSecret;
  const setSecret = (value: string) => {
    config.email.webhookSecret = value;
  };
  const restoreSecret = () => {
    config.email.webhookSecret = REAL_SECRET;
  };

  test('accepts a correctly-signed payload', () => {
    setSecret(TEST_SECRET);
    try {
      const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'abc123' } });
      const svixId = 'msg_test1';
      const svixTimestamp = String(Math.floor(Date.now() / 1000));
      const svixSignature = sign(TEST_SECRET, svixId, svixTimestamp, body);

      const result = verifyResendWebhook(body, { svixId, svixTimestamp, svixSignature });
      expect(result.ok).toBe(true);
    } finally {
      restoreSecret();
    }
  });

  test('accepts when the header carries multiple space-separated signatures (key rotation) and only one matches', () => {
    setSecret(TEST_SECRET);
    try {
      const body = JSON.stringify({ type: 'email.bounced', data: { email_id: 'abc123' } });
      const svixId = 'msg_test2';
      const svixTimestamp = String(Math.floor(Date.now() / 1000));
      const real = sign(TEST_SECRET, svixId, svixTimestamp, body);
      const bogus = 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

      const result = verifyResendWebhook(body, { svixId, svixTimestamp, svixSignature: `${bogus} ${real}` });
      expect(result.ok).toBe(true);
    } finally {
      restoreSecret();
    }
  });

  test('rejects a tampered body even with a valid-looking signature', () => {
    setSecret(TEST_SECRET);
    try {
      const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'abc123' } });
      const svixId = 'msg_test3';
      const svixTimestamp = String(Math.floor(Date.now() / 1000));
      const svixSignature = sign(TEST_SECRET, svixId, svixTimestamp, body);

      const tamperedBody = JSON.stringify({ type: 'email.delivered', data: { email_id: 'someone-elses-id' } });
      const result = verifyResendWebhook(tamperedBody, { svixId, svixTimestamp, svixSignature });
      expect(result.ok).toBe(false);
    } finally {
      restoreSecret();
    }
  });

  test('rejects an unsigned request (no svix headers)', () => {
    setSecret(TEST_SECRET);
    try {
      const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'abc123' } });
      const result = verifyResendWebhook(body, {});
      expect(result.ok).toBe(false);
    } finally {
      restoreSecret();
    }
  });

  test('rejects a signature signed with the wrong secret', () => {
    setSecret(TEST_SECRET);
    try {
      const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'abc123' } });
      const svixId = 'msg_test4';
      const svixTimestamp = String(Math.floor(Date.now() / 1000));
      const svixSignature = sign('whsec_d3Jvbmctc2VjcmV0LWtleS1mb3ItdGVzdHM=', svixId, svixTimestamp, body);

      const result = verifyResendWebhook(body, { svixId, svixTimestamp, svixSignature });
      expect(result.ok).toBe(false);
    } finally {
      restoreSecret();
    }
  });

  test('rejects a stale timestamp outside the tolerance window (replay protection)', () => {
    setSecret(TEST_SECRET);
    try {
      const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'abc123' } });
      const svixId = 'msg_test5';
      const staleTimestamp = String(Math.floor(Date.now() / 1000) - 60 * 60); // 1 hour old
      const svixSignature = sign(TEST_SECRET, svixId, staleTimestamp, body);

      const result = verifyResendWebhook(body, { svixId, svixTimestamp: staleTimestamp, svixSignature });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toMatch(/tolerance/);
    } finally {
      restoreSecret();
    }
  });

  test('refuses to verify when RESEND_WEBHOOK_SECRET is not configured', () => {
    setSecret('');
    try {
      const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'abc123' } });
      const result = verifyResendWebhook(body, {
        svixId: 'msg_test6',
        svixTimestamp: String(Math.floor(Date.now() / 1000)),
        svixSignature: 'v1,irrelevant',
      });
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toMatch(/RESEND_WEBHOOK_SECRET/);
    } finally {
      restoreSecret();
    }
  });
});

/**
 * Unknown email_id handling (transactional mail, or any send this project
 * didn't originate) must be a graceful no-owner insert, never an error that
 * could make Resend's webhook retry forever. Asserted against the route
 * source rather than a live DB call — see the file-level comment on why this
 * suite has no DB fixtures (same constraint as tests/email-campaign.test.ts).
 */
describe('unknown email_id handling', () => {
  const source = readFileSync(join(import.meta.dir, '../src/routes/resend-webhook.ts'), 'utf-8');

  test('an unmatched provider id is still recorded, with null userId/campaignId, not rejected', () => {
    expect(source).toContain('match?.userId ?? null');
    expect(source).toContain('match?.campaignId ?? null');
  });

  test('the route returns 200/ok for an unmatched id rather than an error status', () => {
    // The insert always runs (no early return/throw between the lookup and
    // the insert), and the final response is the same `{ ok: true }` for
    // matched and unmatched sends alike.
    expect(source).not.toMatch(/if\s*\(!match\)[\s\S]{0,80}set\.status/);
  });
});
