import type { Element } from '../../lib/shared';

/**
 * Deterministic checks and clean-ups for generated compatibility prose,
 * applied to what the model returns before anything is stored or shown.
 */

/** Every word the model uses for each Bazi element. Metal is ทอง in the product, โลหะ in common speech. */
const ELEMENT_WORDS: Record<Element, readonly string[]> = {
  wood: ['ไม้'],
  fire: ['ไฟ'],
  earth: ['ดิน'],
  metal: ['ทอง', 'โลหะ'],
  water: ['น้ำ'],
};
const ALL_ELEMENT_WORDS = new Set(Object.values(ELEMENT_WORDS).flat());

/**
 * Everyday compounds the Thai word segmenter splits, where the element word
 * is not an element: น้ำ|เสียง (tone of voice), น้ำ|ใจ (kindness), ไฟ|ฟ้า.
 */
const NOT_AN_ELEMENT_BEFORE: Record<string, readonly string[]> = {
  น้ำ: ['เสียง', 'ใจ', 'หนัก', 'ตา', 'คำ', 'มือ'],
  ไฟ: ['ฟ้า', 'แรง'],
  ไม้: ['บรรทัด'],
};

/**
 * Words before that make it not an element: หมดไฟ (burnt out), มีไฟ (keen),
 * ติดดิน (down to earth), ตามน้ำ (go with the flow), ผลไม้ (fruit). The last
 * three came up as false flags in the v4 samples.
 */
const NOT_AN_ELEMENT_AFTER: Record<string, readonly string[]> = {
  ไฟ: ['หมด', 'มี'],
  ดิน: ['ติด'],
  น้ำ: ['ตาม'],
  ไม้: ['ผล'],
};

const thaiWords = new Intl.Segmenter('th', { granularity: 'word' });

/**
 * Element words in `text` that belong to neither person, e.g. "ไฟ" for a pair
 * who are both earth. Matching is on whole Thai words (ICU segmentation), so
 * เดิน is never ดิน, and the compounds and idioms listed above are skipped. A third element is never
 * allowed: the prompt gives the model only the two people's elements and no
 * generating or controlling cycle to reason with.
 */
export function foreignElementWords(text: string, allowed: readonly Element[]): string[] {
  const permitted = new Set(allowed.flatMap((element) => ELEMENT_WORDS[element]));
  const words = [...thaiWords.segment(text)].map((part) => part.segment.replace(/^ธาตุ/, ''));
  const found = words.filter(
    (word, index) =>
      ALL_ELEMENT_WORDS.has(word) &&
      !permitted.has(word) &&
      !(NOT_AN_ELEMENT_BEFORE[word] ?? []).includes(words[index + 1] ?? '') &&
      !(NOT_AN_ELEMENT_AFTER[word] ?? []).includes(words[index - 1] ?? ''),
  );
  return [...new Set(found)];
}

/**
 * "ไฟจากดาวอังคาร", "ดินของดาวอาทิตย์": an element credited to a Thai planet.
 * Elements come from Bazi and planets from Thai astrology; mixing them is a
 * factual error even when the element itself is right.
 */
export function elementCreditedToPlanet(text: string): string | null {
  const match = text.match(/(?:ธาตุ)?(?:ไม้|ไฟ|ดิน|ทอง|โลหะ|น้ำ)\s*(?:ที่\S{0,12}\s*)?(?:จาก|ของ)\s*ดาว\S*/);
  return match ? match[0] : null;
}

/** Words that bind to the following noun, so a space after them before the name is an artifact. */
const BINDING_WORDS = ['ของ', 'กับ', 'ให้', 'ว่า', 'ถึง', 'ต่อ', 'จาก', 'แก่', 'ใน', 'ชวน', 'ถาม', 'บอก'];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Removes the stray spaces the model puts around the partner's name inside a
 * Thai clause ("ให้ มายด์ เห็น" -> "ให้มายด์เห็น", "ของ คุณวิภาและ" ->
 * "ของคุณวิภาและ"). A space before the name is kept unless the word before it
 * binds to the name, because in Thai that space can be a real clause break
 * ("...ได้ไว มายด์มัก...").
 */
export function tightenNameSpacing(text: string, name: string): string {
  const escaped = escapeRegExp(name);
  // A spaced-out name followed by Thai: the space after it is never a clause break.
  let out = text.replace(new RegExp(`(\\s)${escaped} +(?=[\\u0E00-\\u0E7F])`, 'g'), `$1${name}`);
  out = out.replace(new RegExp(`(${BINDING_WORDS.join('|')}) +${escaped}`, 'g'), `$1${name}`);
  return out;
}

/** Applies `fn` to every string in a JSON-shaped value, keeping its shape. */
export function mapStrings<T>(value: T, fn: (text: string) => string): T {
  if (typeof value === 'string') return fn(value) as T;
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, fn)])) as T;
  }
  return value;
}

/** Thai words in `text` (ICU segmentation), for the report's depth floor. */
export function thaiWordCount(text: string): number {
  return [...thaiWords.segment(text)].filter((part) => part.isWordLike).length;
}

/**
 * First-person words and polite particles that belong to the other gender,
 * e.g. หนู in a male reader's report. When the gender is unknown every
 * gendered word is wrong. Matched on whole words, so คะแนน is not คะ.
 */
export function wrongGenderWords(text: string, gender: 'male' | 'female' | null): string[] {
  const male = ['ผม', 'ครับ'];
  const female = ['ดิฉัน', 'หนู', 'ค่ะ', 'คะ'];
  const wrong = new Set(gender === 'male' ? female : gender === 'female' ? male : [...male, ...female]);
  return [...new Set([...thaiWords.segment(text)].map((part) => part.segment).filter((word) => wrong.has(word)))];
}

/** One spoken line that mixes เรา with หนู or ดิฉัน reads unnatural. */
export function mixesPronouns(line: string): boolean {
  const words = new Set([...thaiWords.segment(line)].map((part) => part.segment));
  return words.has('เรา') && (words.has('หนู') || words.has('ดิฉัน'));
}

/**
 * A birth-data inventory: three or more kinds of chart data (day master,
 * element, weekday, planet) inside 80 characters, as in "เจ้าวันไฟหยิน
 * ธาตุไฟ เกิดวันอังคาร ดาวอังคาร". Returns the offending stretch.
 */
export function birthDataInventory(text: string): string | null {
  const markers = [/เจ้าวัน/g, /ธาตุ/g, /เกิดวัน/g, /ดาว/g];
  const hits = markers.flatMap((marker, kind) => [...text.matchAll(marker)].map((m) => ({ kind, at: m.index ?? 0 })));
  hits.sort((x, y) => x.at - y.at);
  for (const start of hits) {
    const kinds = new Set(hits.filter((h) => h.at >= start.at && h.at < start.at + 80).map((h) => h.kind));
    if (kinds.size >= 3) return text.slice(start.at, start.at + 80);
  }
  return null;
}

/**
 * The partner "reading" or "interpreting" the reader: a guess at their view,
 * e.g. "มายด์อาจอ่านว่าคุณไม่จริงจัง", "เธอมองว่าความเงียบคือ...".
 */
export function guessesPartnerView(text: string, partnerName: string): string | null {
  const subject = `(?:${escapeRegExp(partnerName)}|เขา|เธอ|ท่าน)`;
  const match = text.match(new RegExp(`${subject}\\s*(?:อาจ|มัก|จะ|ก็)?\\s*(?:อ่าน|ตีความ|มองว่า|คิดว่า)`));
  return match ? match[0] : null;
}

/**
 * Stock advice the samples kept producing for every pair. A hit means the
 * line is not about this pair. Evidence-based and short on purpose.
 */
const STOCK_LINES: RegExp[] = [/เหนื่อยหรือหิว/, /สัปดาห์ละครั้ง/, /คำถามปลายเปิด/, /ฟัง(?:ให้|จน)จบก่อน/];

export function stockLine(text: string): string | null {
  for (const pattern of STOCK_LINES) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

/** Every string in a JSON-shaped value with its dotted path, e.g. ['friction.scenarios.0.repair', '...']. */
export function stringLeaves(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((item, index) => stringLeaves(item, path ? `${path}.${index}` : `${index}`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => stringLeaves(item, path ? `${path}.${key}` : key));
  }
  return [];
}
