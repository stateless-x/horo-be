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
  return [...new Set(elementWordsIn(text).filter((word) => !permitted.has(word)))];
}

/** Element words used as elements in `text`, bare or as ธาตุX, idioms skipped. */
function elementWordsIn(text: string): string[] {
  const words = [...thaiWords.segment(text)].map((part) => part.segment.replace(/^ธาตุ/, ''));
  return words.filter(
    (word, index) =>
      ALL_ELEMENT_WORDS.has(word) &&
      !(NOT_AN_ELEMENT_BEFORE[word] ?? []).includes(words[index + 1] ?? '') &&
      !(NOT_AN_ELEMENT_AFTER[word] ?? []).includes(words[index - 1] ?? ''),
  );
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

/** `value` as a literal RegExp source. Every pattern built from a person's name goes through it. */
export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Thai planet names that follow ดาว: ดาวอังคาร is the planet even when the partner is called ดาว. */
const PLANET_NAMES = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์', 'ราหู', 'เกตุ'];

/** Stands in for the partner's name while the vocabulary checks run. */
const NAME_MARK = '(ชื่อ)';

/**
 * `text` with the partner's name replaced by a neutral mark, so the vocabulary
 * checks never read a name as a word. Thai nicknames are often ordinary words:
 * ดาว (star, and the word for a planet), น้ำ, ไฟ, ทอง (element words). The
 * reader is never named in the prompt (they are เจ้า), so only the partner is.
 *
 * Left as they are: the name right after ธาตุ or ดวง, or right before a planet
 * name (ธาตุไฟ, ดวงดาว, ดาวอังคาร), which are the astrology words, not the
 * person. The limit: when the name is itself an element word, a bare slip of
 * that element ("ไฟ" alone for a pair without fire) reads as the name.
 */
export function maskName(text: string, name: string): string {
  const pattern = new RegExp(`(?<!ธาตุ|ดวง)${escapeRegExp(name)}(?!${PLANET_NAMES.join('|')})`, 'g');
  return text.replace(pattern, NAME_MARK);
}

/** Astrology vocabulary that turns a locked hint into a spec instead of a moment. */
const HINT_JARGON = /ธาตุ|ดาว|วันเกิด|ปาจื้อ|โหรา|เจ้าวัน|นักษัตร|MBTI|[IE][NS][TF][JP]/;

/** The astrology or MBTI term in a locked hint, or null. Run it on maskName's output. */
export function hintJargon(text: string): string | null {
  const match = text.match(HINT_JARGON);
  return match ? match[0] : null;
}

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

/**
 * A claim that the chart is silent or absent: "ไม่มีแรงดึงหรือแรงปะทะจากฟ้า",
 * "แรงดึงที่มาจากความต่าง ไม่ใช่จากดวง", "ไม่ใช่สิ่งที่ฟ้าลิขิต". It came from
 * the neutral spouse palace, described to the model as "no special force",
 * and it headlined 6 of 10 v4 verdicts. Every pattern was seen in the samples
 * or named by the PO. Not included: ไม่มีแรงต้าน and ไม่มีแรงบั่นทอน, which say
 * a negative force is absent rather than that the chart says nothing.
 */
const CHART_SILENCE: RegExp[] = [
  // ไม่มีแรงดึง, ไม่ได้สร้างแรงดึง, ไม่มีแรงพิเศษ, ไม่ได้ส่งแรงพิเศษ, ไม่มีแรงหนุน, ไม่มีแรงส่ง, ไม่มีแรงปะทะ
  /ไม่(?:ได้)?(?:มี|สร้าง|ให้|ส่ง)แรง(?:ดึง|ปะทะ|พิเศษ|หนุน|ส่ง)/,
  // ไม่ใช่จากดวง, ไม่ใช่โชคจากดวง, ไม่ได้มาจากแรงพิเศษของดวง, ไม่ได้มาจากจังหวะที่ฟ้าจัดให้ (not ฟ้าผ่า, love at first sight)
  /ไม่(?:ใช่|ได้)\S{0,30}?(?:จาก|เพราะ|ของ|ที่)(?:ดวง|ฟ้า(?!ผ่า))/,
  // ไม่ใช่คู่ที่ฟ้าเป็นใจ, ไม่ใช่สิ่งที่ฟ้าลิขิต, ไม่ใช่เรื่องโชคชะตา
  /ไม่ใช่\S{0,12}(?:ฟ้า(?:เป็นใจ|ลิขิต)|โชคชะตา|พรหมลิขิต)/,
  /จากฟ้า\S{0,12}ไม่มี/,
];

export function chartSilence(text: string): string | null {
  for (const pattern of CHART_SILENCE) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

/**
 * Misspellings the model produced in the samples, with the right spelling.
 * Evidence only; none is part of a valid word. Corrected in place rather than
 * repaired: กระทันหัน alone cost 4 repair turns in 10 reports.
 */
const KNOWN_TYPOS: Record<string, string> = {
  เขียงลำดับ: 'เรียงลำดับ',
  เลาไว้: 'เล่าไว้',
  ปล่าว: 'เปล่า',
  กระทันหัน: 'กะทันหัน',
  ครึ่งค้อน: 'ครึ่งค่อน',
};

/** `text` with every known typo corrected. */
export function fixKnownTypos(text: string): string {
  return Object.entries(KNOWN_TYPOS).reduce((out, [typo, correct]) => out.replaceAll(typo, correct), text);
}

/** The elements `text` names (whole words, idioms skipped), e.g. ['fire', 'metal'] for "ไฟหลอมทอง". */
export function elementsNamed(text: string): Element[] {
  const words = new Set(elementWordsIn(text));
  return (Object.keys(ELEMENT_WORDS) as Element[]).filter((element) => ELEMENT_WORDS[element].some((word) => words.has(word)));
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
