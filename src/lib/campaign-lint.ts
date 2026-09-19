/**
 * Static checks on a campaign's subject/body BEFORE it is saved or sent.
 *
 * Every one of these guards a failure mode the renderer in campaigns.ts will
 * NOT catch, because toHtml/toText/renderBody are deliberately permissive —
 * they render whatever text they are given rather than validating it (see
 * renderBody's own comment: "Unknown placeholders are left as-is so a typo
 * shows up in the dry run instead of silently emptying part of the message").
 * That is the right behaviour for a renderer used from a CLI with a human
 * reading the dry run before every send. It is the wrong safety net for an
 * admin UI that mails thousands of people on one click — this module is the
 * check that has to exist instead.
 *
 * Pure and dependency-free on purpose: no db, no fs, no network. That is what
 * makes it usable from both the /preview route (render + lint, save nothing)
 * and the /content PUT route (lint, then save only if there are no errors),
 * and what makes it unit-testable without a database.
 */

export type LintSeverity = 'error' | 'warning';

export interface LintIssue {
  severity: LintSeverity;
  /** Machine-readable so the admin UI can group/icon by kind, not just show text. */
  code: string;
  message: string;
}

export interface LintResult {
  issues: LintIssue[];
  errors: LintIssue[];
  warnings: LintIssue[];
  /** True when there are zero errors. Warnings never block a save. */
  ok: boolean;
}

/**
 * The only placeholder renderBody ever substitutes is the exact literal
 * `{{name}}` — no surrounding spaces, no case variation. Anything else inside
 * `{{ }}` ships to every recipient unchanged. A near-miss like `{{ name }}` is
 * never intentional copy (nobody wants literal curly braces in a marketing
 * email), so this is an ERROR, not a warning: catching it after a send helps
 * no one.
 */
function checkPlaceholders(body: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const matches = body.matchAll(/\{\{([^}]*)\}\}/g);

  for (const match of matches) {
    const inner = match[1];
    if (inner === 'name') continue; // the one placeholder renderBody actually substitutes

    const normalized = inner.trim().toLowerCase();
    if (normalized === 'name') {
      // Wrong spacing or casing of the one real placeholder — certainly a typo.
      issues.push({
        severity: 'error',
        code: 'placeholder-near-miss',
        message: `"{{${inner}}}" will NOT be substituted — only the exact "{{name}}" is. This ships literally to every recipient.`,
      });
    } else {
      // Some other token entirely. Could be deliberate (rare) or a typo for a
      // placeholder that doesn't exist yet — warn, don't block, matching
      // renderBody's own "let a typo show up rather than hide it" philosophy.
      issues.push({
        severity: 'warning',
        code: 'placeholder-unknown',
        message: `"{{${inner}}}" is not a known placeholder (only {{name}} is substituted) and will be sent as literal text.`,
      });
    }
  }

  return issues;
}

/** An odd number of `**` markers means one bold run never closes. */
function checkBold(body: string): LintIssue[] {
  const count = (body.match(/\*\*/g) ?? []).length;
  if (count % 2 !== 0) {
    return [
      {
        severity: 'error',
        code: 'unbalanced-bold',
        message: `Odd number of "**" markers (${count}) — a bold run never closes and literal asterisks will show in the email.`,
      },
    ];
  }
  return [];
}

/**
 * Malformed [label](url) links. The renderer's own link regex
 * (`/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g`) only ever matches a WELL-formed
 * link — a malformed one simply fails to match and prints as raw
 * "[label](...)" text instead of a link. That silent non-match is exactly
 * what this catches ahead of time.
 */
function checkLinks(body: string): LintIssue[] {
  const issues: LintIssue[] = [];

  // A `[label](` with no closing `)` before the next `[` or end of string.
  const unclosed = /\[([^\]]*)\]\((?![^)]*\))/g;
  for (const match of body.matchAll(unclosed)) {
    issues.push({
      severity: 'error',
      code: 'link-unclosed',
      message: `Link "[${match[1]}](" is never closed with ")" — will print as raw text instead of a link.`,
    });
  }

  // A well-closed [label](target) pair — check the target itself.
  const closed = /\[([^\]]*)\]\(([^)]*)\)/g;
  for (const match of body.matchAll(closed)) {
    const [, label, target] = match;
    if (/^\s|\s$/.test(target)) {
      issues.push({
        severity: 'error',
        code: 'link-malformed',
        message: `Link "[${label}](${target})" has leading/trailing spaces inside the parens — the renderer requires "(https://...)" with no spaces, so this will print as raw text.`,
      });
    } else if (!/^https?:\/\/[^\s)]+$/.test(target)) {
      issues.push({
        severity: 'error',
        code: 'link-malformed',
        message: `Link "[${label}](${target})" is not a valid http(s) URL — the renderer only links "https://" or "http://" targets, so this will print as raw text.`,
      });
    }
  }

  return issues;
}

/** Empty subject or body would ship a blank email — never a valid campaign. */
function checkRequired(subject: string, body: string): LintIssue[] {
  const issues: LintIssue[] = [];
  if (!subject.trim()) {
    issues.push({ severity: 'error', code: 'empty-subject', message: 'Subject is empty.' });
  }
  if (!body.trim()) {
    issues.push({ severity: 'error', code: 'empty-body', message: 'Body is empty.' });
  }
  return issues;
}

/** Runs every check and sorts issues into errors (block save) vs warnings (allow, show). */
export function lintCampaign(subject: string, body: string): LintResult {
  const issues: LintIssue[] = [
    ...checkRequired(subject, body),
    ...checkBold(body),
    ...checkLinks(body),
    ...checkPlaceholders(body),
  ];

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  return { issues, errors, warnings, ok: errors.length === 0 };
}
