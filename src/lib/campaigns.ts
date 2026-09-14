import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Campaigns are markdown files in content/campaigns/, one per message:
 *
 *   content/campaigns/2026-09-15-welcome.md
 *   ---
 *   name: Welcome / ทักทายครั้งแรก        # optional label for listings
 *   subject: ทักทายจากสายมู
 *   ---
 *   สวัสดี {{name}}
 *
 * The filename (minus .md) is the campaignId and the unique key in
 * email_sends. Renaming a file after a send starts orphans its progress and
 * the new name re-sends to everyone — treat filenames as immutable once used.
 *
 * Read from disk at runtime rather than imported, so adding tomorrow's message
 * is dropping in a file — no rebuild, no redeploy.
 */

export interface Campaign {
  /** Filename minus .md — the dedupe key in email_sends. Immutable once sent. */
  id: string;
  /**
   * Optional human label for listings ("Relaunch announcement"). Purely
   * cosmetic: it is NOT stored per row and NOT part of the dedupe key, so it
   * can be reworded any time without affecting who has been sent what.
   */
  name?: string;
  subject: string;
  body: string;
}

const CAMPAIGN_DIR = join(import.meta.dir, '../../content/campaigns');

/** Minimal `key: value` front-matter; the body is everything after the fence. */
function parse(id: string, raw: string): Campaign {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`Campaign "${id}" has no front-matter block (expected --- subject: ... ---)`);
  }

  const [, frontMatter, body] = match;
  const field = (key: string) =>
    frontMatter
      .split('\n')
      .map((line) => line.match(new RegExp(`^${key}:\\s*(.+)$`)))
      .find(Boolean)?.[1]
      ?.trim();

  const subject = field('subject');
  const name = field('name');

  if (!subject) throw new Error(`Campaign "${id}" is missing a subject in its front-matter`);
  if (!body.trim()) throw new Error(`Campaign "${id}" has an empty body`);

  return { id, name, subject, body: body.trim() };
}

export function loadCampaign(id: string): Campaign {
  const path = join(CAMPAIGN_DIR, `${id}.md`);
  if (!existsSync(path)) throw new Error(`No campaign file at content/campaigns/${id}.md`);
  return parse(id, readFileSync(path, 'utf-8'));
}

/**
 * Campaign ids with their optional labels, for listings. Reads every file, so
 * prefer listCampaignIds() where only the ids are needed.
 */
export function listCampaigns(): Array<{ id: string; name?: string }> {
  return listCampaignIds().map((id) => {
    try {
      return { id, name: loadCampaign(id).name };
    } catch {
      // A malformed file must not break a listing — it surfaces on load.
      return { id };
    }
  });
}

/** Campaign ids, sorted. Date-prefixed names sort oldest-first. */
export function listCampaignIds(): string[] {
  if (!existsSync(CAMPAIGN_DIR)) return [];
  return readdirSync(CAMPAIGN_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''))
    .sort();
}

/**
 * Substitute {{name}}. Unknown placeholders are left as-is so a typo shows up
 * in the dry run instead of silently emptying part of the message.
 */
export function renderBody(body: string, vars: { name: string }): string {
  return body.replace(/\{\{name\}\}/g, vars.name);
}

/**
 * Markdown-ish body to HTML for email.
 *
 * Email is not the web: Outlook renders through Word, Gmail strips <style>
 * blocks and <head>, and float/flex/grid are unreliable. So this builds a
 * table-based layout with inline styles only — the boring, portable approach
 * every mail client has agreed on for twenty years.
 *
 * Three markup affordances beyond plain paragraphs, because the body is a
 * marketing email rather than a memo:
 *
 *   **bold**            -> <strong>
 *   [label](url)        -> a styled link
 *   [[label](url)]      -> a real button (the campaign's call to action)
 *   • item              -> a feature block, set apart from body copy
 *
 * The brand purple (#6B21A8) is taken from horo-fe/DESIGN.md so the mail looks
 * like the product it is advertising.
 */

const BRAND = '#6B21A8';
const INK = '#1C1226';
const INK_MUTED = '#645D78';
const EDGE = '#E9E4F0';
const SURFACE_SOFT = '#FAF9FD';

/** Thai needs a stack that degrades well; Outlook falls back to the generic. */
const FONT =
  "'Noto Sans Thai','Segoe UI',-apple-system,BlinkMacSystemFont,Tahoma,sans-serif";

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Inline formatting shared by every block type. */
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, `<strong style="color:${INK};font-weight:600">$1</strong>`)
    // An unstyled <a> is left to each client's default, and some render it as
    // plain body text — the link then does not look clickable at all.
    .replace(
      /\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g,
      `<a href="$2" style="color:${BRAND};text-decoration:underline">$1</a>`,
    );
}

/**
 * A bulletproof-ish button: a table with a padded, coloured cell. A styled <a>
 * alone collapses in Outlook, and the whole point of this element is that the
 * one action the email asks for is impossible to miss.
 */
function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px">
  <tr>
    <td align="center" bgcolor="${BRAND}" style="border-radius:8px">
      <a href="${url}" style="display:inline-block;padding:14px 32px;font-family:${FONT};font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}

/**
 * A "• **title**\nbody" block, rendered as a bordered panel rather than another
 * paragraph. In the flat version these features read as more body copy and the
 * reader skims past the two things the email exists to announce.
 */
function featureBlock(lines: string[]): string {
  const items = lines
    .map((line) => {
      const [first, ...rest] = line.replace(/^•\s*/, '').split('\n');
      const body = rest.join(' ').trim();
      return `<tr>
    <td style="padding:14px 18px;border-left:3px solid ${BRAND};background:${SURFACE_SOFT}">
      <div style="font-size:15px;font-weight:600;color:${INK};line-height:1.5">${inline(first)}</div>
      ${body ? `<div style="margin-top:4px;font-size:14px;color:${INK_MUTED};line-height:1.65">${inline(body)}</div>` : ''}
    </td>
  </tr>
  <tr><td style="height:10px;line-height:10px;font-size:0">&nbsp;</td></tr>`;
    })
    .join('\n  ');

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 12px">
  ${items}
</table>`;
}

export function toHtml(body: string, unsubscribeLink?: string): string {
  const blocks = body.split(/\n\s*\n/).map((raw) => {
    const block = raw.trim();
    if (!block) return '';

    // [[label](url)] on its own line -> button
    const btn = block.match(/^\[\[(.+?)\]\((https?:\/\/[^\s)]+)\)\]$/);
    if (btn) return button(btn[1], btn[2]);

    // A run of "• ..." lines -> feature panels
    if (block.startsWith('•')) {
      const items = block.split(/\n(?=•)/).map((i) => i.trim()).filter(Boolean);
      return featureBlock(items);
    }

    return `<p style="margin:0 0 18px;font-size:15px;line-height:1.75;color:${INK}">${inline(block).replace(/\n/g, '<br>')}</p>`;
  });

  const footer = unsubscribeLink
    ? `<tr>
        <td style="padding:20px 32px 28px;border-top:1px solid ${EDGE}">
          <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${INK_MUTED}">
            คุณได้รับอีเมลนี้เพราะเคยสมัครใช้งานสายมู.com<br>
            <a href="${unsubscribeLink}" style="color:${INK_MUTED};text-decoration:underline">ยกเลิกการรับอีเมล</a>
          </p>
        </td>
      </tr>`
    : '';

  // Outer table + fixed 600px inner table: the layout every client renders the
  // same way. Percentage widths and max-width alone break in Outlook.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${SURFACE_SOFT};margin:0;padding:0">
  <tr>
    <td align="center" style="padding:24px 12px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:100%;background:#FFFFFF;border:1px solid ${EDGE};border-radius:16px">
        <tr>
          <td style="padding:28px 32px 4px">
            <div style="font-family:${FONT};font-size:18px;font-weight:700;color:${BRAND};letter-spacing:-0.01em">สายมู<span style="color:${INK_MUTED};font-weight:400">.com</span></div>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px 8px;font-family:${FONT}">
${blocks.filter(Boolean).join('\n')}
          </td>
        </tr>
        ${footer}
      </table>
    </td>
  </tr>
</table>`;
}

/**
 * Plain-text alternative. Every email sends both; text-only clients need it.
 *
 * `[สายมู.com/login](https://xn--y3cbx6azb.com/login)` renders as the label
 * followed by the URL — except when the label is just the punycode domain
 * spelled in Thai, where printing both reads as noise ("สายมู.com/login
 * (https://xn--y3cbx6azb.com/login)"). Links whose label matches the href's
 * punycode host collapse to the raw URL, which stays clickable everywhere and
 * is what a text client can actually follow.
 */
export function toText(body: string, unsubscribeLink?: string): string {
  const plain = body
    // A button is [[label](url)] in the source. Text clients get the bare URL
    // on its own line — the brackets are HTML-layout syntax, not something a
    // reader should ever see.
    .replace(/^\[\[(.+?)\]\((https?:\/\/[^\s)]+)\)\]$/gm, '$2')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) => {
      // Same destination spelled two ways → show the URL only.
      const labelHost = label.split('/')[0];
      try {
        // URL() punycodes an IDN hostname, so a Thai label normalises to the
        // same ASCII host as the href when they point at the same domain.
        const asciiLabelHost = new URL(`https://${labelHost}`).hostname;
        if (asciiLabelHost === new URL(url).hostname) return url;
      } catch {
        // Label isn't a hostname — fall through to "label (url)".
      }
      return `${label} (${url})`;
    });

  return unsubscribeLink
    ? `${plain}\n\n---\nไม่อยากรับอีเมลนี้อีก? ยกเลิกได้ที่: ${unsubscribeLink}`
    : plain;
}
