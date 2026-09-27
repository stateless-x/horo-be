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
  ไฟ: ['ฟ้า'],
  ไม้: ['บรรทัด'],
};

const thaiWords = new Intl.Segmenter('th', { granularity: 'word' });

/**
 * Element words in `text` that belong to neither person, e.g. "ไฟ" for a pair
 * who are both earth. Matching is on whole Thai words (ICU segmentation), so
 * เดิน is never ดิน, and the compounds listed above are skipped. A third element is never
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
      !(NOT_AN_ELEMENT_BEFORE[word] ?? []).includes(words[index + 1] ?? ''),
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
