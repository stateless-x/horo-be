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

/**
 * Resolved from the process working directory, NOT from import.meta.dir.
 *
 * The build bundles src/ into dist/index.js, so import.meta.dir is `<root>/src/lib`
 * in development but `<root>/dist` in production — and a fixed '../../' hop
 * lands on `/content/campaigns` (filesystem root) once bundled, instead of
 * `/app/content/campaigns`. That silently returned an empty campaign list in
 * production while working perfectly on a dev machine.
 *
 * Both `bun run dev` and `bun dist/index.js` run from the package root, so
 * cwd is the stable anchor. CAMPAIGN_DIR overrides it when a caller needs to
 * run from elsewhere.
 */
const CAMPAIGN_DIR = process.env.CAMPAIGN_DIR || join(process.cwd(), 'content/campaigns');

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
 * Deliberately plain: paragraphs, bold, and links. No banner, no buttons, no
 * panels — the copy is a personal note and reads as one.
 *
 *   **bold**            -> <strong>
 *   [label](url)        -> an underlined link in the brand colour
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

export function toHtml(body: string, unsubscribeLink?: string): string {
  const blocks = body.split(/\n\s*\n/).map((raw) => {
    const block = raw.trim();
    if (!block) return '';

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
          <td style="padding:32px 32px 8px;font-family:${FONT}">
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
    // Legacy [[label](url)] button syntax, kept only so an older campaign file
    // never shows raw brackets to a reader. New copy uses a plain link.
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
