import { BE_OFFSET, THAI_MONTHS_FULL } from '../constants/thai-time';

/**
 * Converts Gregorian year to Buddhist Era year
 */
export function toBuddhistYear(gregorianYear: number): number {
  return gregorianYear + BE_OFFSET;
}

/**
 * Converts Buddhist Era year to Gregorian year
 */
export function toGregorianYear(buddhistYear: number): number {
  return buddhistYear - BE_OFFSET;
}

/**
 * Formats a date to Thai Buddhist Era format
 * @param date - ISO date string or Date object
 * @returns Formatted date string like "25 ก.พ. 2569"
 */
export function formatThaiDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  // Use UTC methods since birth dates are stored as UTC midnight
  const day = d.getUTCDate();
  const month = d.getUTCMonth();
  const year = toBuddhistYear(d.getUTCFullYear());

  const THAI_MONTHS = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ];

  return `${day} ${THAI_MONTHS[month]} ${year}`;
}

/**
 * Gets the current date in Bangkok timezone (UTC+7)
 */
export function getBangkokDate(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
}

/**
 * Gets today's date string in YYYY-MM-DD format, Bangkok timezone.
 * Use this for daily reading cache keys and DB lookups to ensure
 * the "day" matches what Thai users see on their calendar.
 */
export function getTodayBangkokString(): string {
  const d = getBangkokDate();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Gets the current year in Bangkok timezone.
 */
export function getBangkokYear(): number {
  return getBangkokDate().getFullYear();
}

/**
 * Gets the year of a given date in Bangkok timezone.
 */
export function getYearInBangkok(date: Date): number {
  return new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })).getFullYear();
}

/**
 * Gets the current year-month string (YYYY-MM) in Bangkok timezone.
 * Use for monthly cache boundary checks.
 */
export function getBangkokYearMonth(): string {
  const d = getBangkokDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Gets the year-month string (YYYY-MM) of a given date in Bangkok timezone.
 */
export function getYearMonthInBangkok(date: Date): string {
  const d = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Checks if it's a new day in Bangkok timezone
 */
export function isMidnightBangkok(): boolean {
  const bangkokDate = getBangkokDate();
  return bangkokDate.getHours() === 0 && bangkokDate.getMinutes() === 0;
}

/**
 * The month a chart narrative is written for.
 *
 * A chart regenerates when the Bangkok-time month rolls over, so the month has
 * to travel with the narrative: the model is told which month to write about,
 * and the stored response records it. Without this the frontend can only guess
 * the period from the clock, which is wrong for any chart read after its month.
 *
 * yearMonth is the Gregorian regeneration key and matches getBangkokYearMonth.
 */
export function getReadingPeriod(date: Date = getBangkokDate()): {
  yearMonth: string;
  monthTh: string;
  yearBe: number;
} {
  const monthIndex = date.getMonth();
  const year = date.getFullYear();

  return {
    yearMonth: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
    monthTh: THAI_MONTHS_FULL[monthIndex],
    yearBe: toBuddhistYear(year),
  };
}
