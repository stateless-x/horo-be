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
 * Markdown-ish body to HTML: paragraphs, **bold**, [links](url). Deliberately
 * tiny — campaign copy is plain prose, and a full markdown dep would be more
 * surface than the job needs.
 */
export function toHtml(body: string, unsubscribeLink?: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const paragraphs = body
    .split(/\n\s*\n/)
    .map((block) => {
      const html = escape(block.trim())
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
        .replace(/\n/g, '<br>');
      return `<p style="margin:0 0 16px">${html}</p>`;
    })
    .join('\n');

  const footer = unsubscribeLink
    ? `\n<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0">
<p style="margin:0;font-size:12px;color:#888">
  ไม่อยากรับอีเมลนี้อีก? <a href="${unsubscribeLink}" style="color:#888">ยกเลิกการรับอีเมล</a>
</p>`
    : '';

  return `<div style="font-family:-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.7;color:#222;max-width:560px">
${paragraphs}${footer}
</div>`;
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
