import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { lintCampaign } from '../src/lib/campaign-lint';

/**
 * Campaign content editing: the lint rules, the lock rule, and id-shape
 * validation for duplicate. Follows tests/internal-campaigns.test.ts — no
 * real database. The lint module is pure so it is tested directly; the lock
 * rule and id-shape check are tested as the same pure predicates the routes
 * in src/routes/internal-campaigns.ts apply, since exercising the routes
 * themselves would require a live Postgres connection.
 */

describe('campaign-lint: required fields', () => {
  test('empty subject is an error', () => {
    const result = lintCampaign('', 'some body');
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'empty-subject')).toBe(true);
  });

  test('whitespace-only subject is an error', () => {
    const result = lintCampaign('   ', 'some body');
    expect(result.errors.some((e) => e.code === 'empty-subject')).toBe(true);
  });

  test('empty body is an error', () => {
    const result = lintCampaign('a subject', '');
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'empty-body')).toBe(true);
  });

  test('valid subject and body produce no required-field errors', () => {
    const result = lintCampaign('a subject', 'a body');
    expect(result.errors.some((e) => e.code === 'empty-subject')).toBe(false);
    expect(result.errors.some((e) => e.code === 'empty-body')).toBe(false);
  });
});

describe('campaign-lint: unbalanced bold', () => {
  test('an odd number of ** markers is an error', () => {
    const result = lintCampaign('s', 'this is **bold text with no close');
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'unbalanced-bold')).toBe(true);
  });

  test('an even number of ** markers is fine', () => {
    const result = lintCampaign('s', 'this is **bold** and **also bold**');
    expect(result.errors.some((e) => e.code === 'unbalanced-bold')).toBe(false);
  });

  test('no ** markers at all is fine', () => {
    const result = lintCampaign('s', 'plain text only');
    expect(result.errors.some((e) => e.code === 'unbalanced-bold')).toBe(false);
  });
});

describe('campaign-lint: malformed links', () => {
  test('a well-formed link produces no link errors', () => {
    const result = lintCampaign('s', 'go to [สายมู.com](https://xn--y3cbx6azb.com/login) now');
    expect(result.errors.filter((e) => e.code.startsWith('link-'))).toHaveLength(0);
  });

  test('spaces inside the parens are an error', () => {
    const result = lintCampaign('s', 'go to [label]( https://example.com ) now');
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'link-malformed')).toBe(true);
  });

  test('a non-url target is an error', () => {
    const result = lintCampaign('s', 'go to [label](notaurl) now');
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'link-malformed')).toBe(true);
  });

  test('an unclosed [label]( is an error', () => {
    const result = lintCampaign('s', 'go to [label](https://example.com and never closes');
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'link-unclosed')).toBe(true);
  });

  test('a bare ftp:// target is an error — only http(s) is linked', () => {
    const result = lintCampaign('s', 'go to [label](ftp://example.com) now');
    expect(result.errors.some((e) => e.code === 'link-malformed')).toBe(true);
  });
});

describe('campaign-lint: placeholder near-misses', () => {
  // renderBody in src/lib/campaigns.ts substitutes ONLY the exact literal
  // "{{name}}" — anything else inside {{ }} ships to every recipient as
  // literal text. A near-miss of the real placeholder is never intentional.
  test('extra spaces around name is an error', () => {
    const result = lintCampaign('s', 'สวัสดี {{ name }}');
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.code === 'placeholder-near-miss')).toBe(true);
  });

  test('wrong case Name is an error', () => {
    const result = lintCampaign('s', 'สวัสดี {{Name}}');
    expect(result.errors.some((e) => e.code === 'placeholder-near-miss')).toBe(true);
  });

  test('wrong case NAME is an error', () => {
    const result = lintCampaign('s', 'สวัสดี {{NAME}}');
    expect(result.errors.some((e) => e.code === 'placeholder-near-miss')).toBe(true);
  });

  test('wrong case and spacing {{ Name }} is an error', () => {
    const result = lintCampaign('s', 'สวัสดี {{ Name }}');
    expect(result.errors.some((e) => e.code === 'placeholder-near-miss')).toBe(true);
  });

  test('the exact literal {{name}} is not flagged at all', () => {
    const result = lintCampaign('s', 'สวัสดี {{name}} ครับ');
    expect(result.issues.filter((i) => i.code.startsWith('placeholder-'))).toHaveLength(0);
  });

  test('an unknown placeholder is a warning, not an error', () => {
    const result = lintCampaign('s', 'สวัสดี {{firstName}}');
    expect(result.ok).toBe(true); // warnings never block a save
    expect(result.warnings.some((w) => w.code === 'placeholder-unknown')).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('campaign-lint: errors vs warnings never mix up', () => {
  test('a clean campaign has zero issues and ok=true', () => {
    const result = lintCampaign('Subject line', 'Hello **{{name}}**, check out [our site](https://example.com).');
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('ok is false whenever there is at least one error, regardless of warnings', () => {
    const result = lintCampaign('', 'text with {{unknown}} placeholder');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
  });

  test('warnings alone never flip ok to false', () => {
    const result = lintCampaign('s', '{{foo}} and {{bar}}');
    expect(result.errors).toHaveLength(0);
    expect(result.warnings.length).toBe(2);
    expect(result.ok).toBe(true);
  });
});

/**
 * The lock rule itself: PUT /internal/campaigns/:id/content in
 * src/routes/internal-campaigns.ts refuses a subject/body change once
 * email_sends has ANY row for that campaign_id, with no status filter. This
 * mirrors planSend's own `alreadyHandled` query, which also has no status
 * filter — a 'pending' or 'failed' row permanently excludes that recipient
 * just as much as a 'sent' one does, so it must lock editing just as hard.
 *
 * Exercised here as the same boolean the route computes, since asserting it
 * through the actual HTTP route would need a live database.
 */
describe('campaign content lock rule', () => {
  function isLocked(sentCount: number): boolean {
    return sentCount > 0;
  }

  test('zero email_sends rows: not locked', () => {
    expect(isLocked(0)).toBe(false);
  });

  test('one row of any status: locked', () => {
    expect(isLocked(1)).toBe(true);
  });

  test('many rows: locked', () => {
    expect(isLocked(1000)).toBe(true);
  });

  test('the route counts email_sends with no status filter', () => {
    // Guards against a future edit narrowing sendCountFor() to
    // eq(status, 'sent') — that would silently unlock a campaign that still
    // has pending/failed rows permanently excluding those recipients.
    const source = readFileSync(join(import.meta.dir, '../src/routes/internal-campaigns.ts'), 'utf-8');
    const fn = source.match(/async function sendCountFor[\s\S]*?\n}/)?.[0];
    expect(fn).toBeTruthy();
    expect(fn).not.toMatch(/status/);
  });

  test('a name-only edit is exempt from the lock, matching campaigns.ts doc comment', () => {
    // name has always been documented as cosmetic and independently
    // reword-able; only a real subject/body change is refused once locked.
    const source = readFileSync(join(import.meta.dir, '../src/routes/internal-campaigns.ts'), 'utf-8');
    expect(source).toContain('changesLockedFields');
    expect(source).toMatch(/current\.subject !== body\.subject \|\| current\.body !== body\.body/);
  });
});

/**
 * Id-shape validation for POST /internal/campaigns/:id/duplicate. The new id
 * becomes a URL path segment and (once sent) an immutable dedup key, so it is
 * restricted to the same shape a filename-ish key should have.
 */
describe('duplicate: new id shape validation', () => {
  const ID_PATTERN = /^[a-z0-9-]{1,64}$/;

  test('accepts lowercase letters, digits, and hyphens', () => {
    expect(ID_PATTERN.test('2026-10-01-relaunch-v2')).toBe(true);
  });

  test('rejects uppercase letters', () => {
    expect(ID_PATTERN.test('Relaunch')).toBe(false);
  });

  test('rejects spaces', () => {
    expect(ID_PATTERN.test('my campaign')).toBe(false);
  });

  test('rejects underscores and other punctuation', () => {
    expect(ID_PATTERN.test('my_campaign')).toBe(false);
    expect(ID_PATTERN.test('my.campaign')).toBe(false);
    expect(ID_PATTERN.test('my/campaign')).toBe(false);
  });

  test('rejects an empty string', () => {
    expect(ID_PATTERN.test('')).toBe(false);
  });

  test('rejects a string over 64 characters — the varchar(64) column limit', () => {
    expect(ID_PATTERN.test('a'.repeat(65))).toBe(false);
    expect(ID_PATTERN.test('a'.repeat(64))).toBe(true);
  });

  test('the route validates against exactly this pattern', () => {
    const source = readFileSync(join(import.meta.dir, '../src/routes/internal-campaigns.ts'), 'utf-8');
    expect(source).toContain('/^[a-z0-9-]{1,64}$/');
  });

  test('the route checks the DB, disk files, AND email_sends before accepting a new id', () => {
    // Any one of these alone would miss a real collision: a disk file with no
    // DB row yet, or an email_sends row whose disk file was later deleted.
    const source = readFileSync(join(import.meta.dir, '../src/routes/internal-campaigns.ts'), 'utf-8');
    const fn = source.match(/\.post\(\s*'\/:id\/duplicate'[\s\S]*?\n {2}\)/)?.[0];
    expect(fn).toBeTruthy();
    expect(fn).toContain('listCampaignIds()');
    expect(fn).toContain('sendCountFor(newId)');
    expect(fn).toMatch(/campaigns\.id.*newId|newId.*campaigns\.id/s);
  });
});

/**
 * Schema declaration: the campaigns table shape the routes above depend on.
 * Asserted against source text rather than drizzle's runtime table object,
 * matching this suite's own pattern in tests/email-campaign.test.ts for the
 * same reason — invoking drizzle's extra-config builder twice throws, so
 * reading the file is both safer and a truer check of what ships.
 */
describe('campaigns table schema', () => {
  const source = readFileSync(join(import.meta.dir, '../lib/db/schema/email.ts'), 'utf-8');

  test('id is the primary key, varchar(64) — matching email_sends.campaignId', () => {
    expect(source).toMatch(/id:\s*varchar\('id',\s*\{\s*length:\s*64\s*\}\)\.primaryKey\(\)/);
  });

  test('subject and body are required (not nullable)', () => {
    const table = source.match(/export const campaigns = pgTable\('campaigns', \{[\s\S]*?\n\}\);/)?.[0];
    expect(table).toBeTruthy();
    expect(table).toMatch(/subject:\s*text\('subject'\)\.notNull\(\)/);
    expect(table).toMatch(/body:\s*text\('body'\)\.notNull\(\)/);
  });

  test('name is nullable — purely cosmetic, matching Campaign["name"]', () => {
    const table = source.match(/export const campaigns = pgTable\('campaigns', \{[\s\S]*?\n\}\);/)?.[0];
    expect(table).toMatch(/name:\s*text\('name'\),/); // no .notNull()
  });

  test('campaigns.id carries no foreign-key reference to or from email_sends', () => {
    // A FK here would make drizzle-kit push try to validate/create a
    // constraint against existing email_sends rows for disk-only campaigns
    // that predate this table — exactly the destructive-ish operation that
    // hangs a `push` run without --force in production. The dedup guarantee
    // and the lock rule are enforced in application code instead.
    const table = source.match(/export const campaigns = pgTable\('campaigns', \{[\s\S]*?\n\}\);/)?.[0];
    expect(table).not.toContain('.references(');
  });
});

/**
 * The regression the task explicitly warned about: a sync, disk-only loader
 * silently serving stale content while the database is the real source. The
 * sync loadCampaign()/listCampaigns() stay public only because
 * tests/email-campaign.test.ts asserts disk-loading behaviour directly (see
 * campaigns.ts's own doc comment) — no caller that decides what to actually
 * send or show an operator may use them.
 */
describe('every send-path caller uses the DB-first async loaders', () => {
  const sendPathFiles = [
    '../src/lib/campaign-sender.ts',
    '../src/routes/internal-campaigns.ts',
    '../scripts/send-campaign.ts',
  ];

  for (const file of sendPathFiles) {
    test(`${file} never calls the sync disk-only loadCampaign()/listCampaigns()`, () => {
      const source = readFileSync(join(import.meta.dir, file), 'utf-8');
      // \b word-boundary anchoring keeps this from matching
      // loadCampaignAsync(/listCampaignsAsync( — those are distinct
      // identifiers, not loadCampaign/listCampaigns with a suffix.
      expect(source).not.toMatch(/\bloadCampaign\(/);
      expect(source).not.toMatch(/\blistCampaigns\(/);
    });
  }

  test('internal-campaigns.ts duplicate route may still use listCampaignIds() — a distinct, disk-only-by-design collision check', () => {
    // /duplicate deliberately checks disk ids too (a seed file not yet
    // migrated is still "in use"), which is a different, narrower function
    // from the disk+DB listCampaigns().
    const source = readFileSync(join(import.meta.dir, '../src/routes/internal-campaigns.ts'), 'utf-8');
    expect(source).toContain('listCampaignIds()');
  });
});
