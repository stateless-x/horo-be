/**
 * Spacing around a person's supplied name in Thai text. Shared by the
 * backend (generated readings) and the frontend (copy templates); no zod, so
 * the page bundle can import it directly.
 */

const LATIN_OR_DIGIT = /[A-Za-z0-9]/;
const THAI = '\\u0E00-\\u0E7F';
/** Spaces a line can hold; a line break is left alone. */
const INLINE_SPACE = '[ \\t\\u00A0]*';

/**
 * `text` with exactly one space between `name` and Thai text on either side,
 * when the name has Latin letters or digits: "ของIceที่" -> "ของ Ice ที่",
 * "แต่ Mindเปิด" -> "แต่ Mind เปิด". Next to punctuation, a line start or end,
 * or other Latin text nothing changes. A Thai-script name is returned as is,
 * because Thai runs have no spaces inside them. Safe to apply twice.
 */
export function spaceLatinName(text: string, name: string): string {
  const trimmed = name.trim();
  if (!LATIN_OR_DIGIT.test(trimmed)) return text;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Not inside a longer Latin word or number: a partner called A is not the A in ATM.
  // A captured edge instead of a lookbehind, which Safari before 16.4 cannot parse.
  const whole = `${escaped}(?![A-Za-z0-9])`;
  return text
    .replace(new RegExp(`([${THAI}])${INLINE_SPACE}(${whole})`, 'g'), '$1 $2')
    .replace(new RegExp(`(^|[^A-Za-z0-9])(${whole})${INLINE_SPACE}(?=[${THAI}])`, 'g'), '$1$2 ');
}

/** `text` with both people's names spaced (spaceLatinName); a missing name is skipped. */
export function spaceLatinNames(text: string, names: ReadonlyArray<string | null | undefined>): string {
  return names.reduce<string>((out, name) => (name ? spaceLatinName(out, name) : out), text);
}
