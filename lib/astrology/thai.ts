import type { ThaiAstrology, ThaiDay } from '../shared';

/**
 * Thai astrology day data — keyed by Thai day name.
 * Color, planet, lucky number, and direction are the classical
 * Thai day-of-week associations used for both natal (birth day)
 * and daily (today) fortune readings.
 */
const DAY_DATA: Record<ThaiDay, Omit<ThaiAstrology, 'day'>> = {
  sunday: {
    color: 'แดง (Red)',
    planet: 'ดวงอาทิตย์ (Sun)',
    buddhaPosition: 'ปางประทานอภัย',
    personality: 'มีความเป็นผู้นำ มั่นใจ กล้าหาญ',
    luckyNumber: 9,
    luckyDirection: 'ทิศตะวันออก',
  },
  monday: {
    color: 'เหลือง (Yellow)',
    planet: 'ดวงจันทร์ (Moon)',
    buddhaPosition: 'ปางห้ามสมุทร',
    personality: 'อ่อนโยน เห็นอกเห็นใจ อารมณ์ไหวไว',
    luckyNumber: 2,
    luckyDirection: 'ทิศตะวันออก',
  },
  tuesday: {
    color: 'ชมพู (Pink)',
    planet: 'ดวงอังคาร (Mars)',
    buddhaPosition: 'ปางไสยาสน์',
    personality: 'กล้าหาญ ตรงไปตรงมา ชอบผจญภัย',
    luckyNumber: 8,
    luckyDirection: 'ทิศตะวันออกเฉียงเหนือ',
  },
  wednesday_day: {
    color: 'เขียว (Green)',
    planet: 'ดวงพุธ (Mercury)',
    buddhaPosition: 'ปางอุ้มบาตร',
    personality: 'ฉลาด คิดไว มีศิลปะในการสื่อสาร',
    luckyNumber: 5,
    luckyDirection: 'ทิศใต้',
  },
  wednesday_night: {
    color: 'เทา (Gray)',
    planet: 'ดวงราหู (Rahu)',
    buddhaPosition: 'ปางปฐมเทศนา',
    personality: 'ลึกลับ เฉียบคม มีสัญชาตญาณดี',
    luckyNumber: 4,
    luckyDirection: 'ทิศตะวันตก',
  },
  thursday: {
    color: 'ส้ม (Orange)',
    planet: 'ดวงพฤหัสบดี (Jupiter)',
    buddhaPosition: 'ปางสมาธิ',
    personality: 'มีปัญญา ใจกว้าง มีโชคลาภ',
    luckyNumber: 3,
    luckyDirection: 'ทิศตะวันตก',
  },
  friday: {
    color: 'ฟ้า (Blue)',
    planet: 'ดวงศุกร์ (Venus)',
    buddhaPosition: 'ปางรำพึง',
    personality: 'มีเสน่ห์ รักความงาม สร้างสรรค์',
    luckyNumber: 6,
    luckyDirection: 'ทิศเหนือ',
  },
  saturday: {
    color: 'ม่วง (Purple)',
    planet: 'ดวงเสาร์ (Saturn)',
    buddhaPosition: 'ปางนาคปรก',
    personality: 'มีวินัย รับผิดชอบ อดทน',
    luckyNumber: 7,
    luckyDirection: 'ทิศตะวันตกเฉียงใต้',
  },
};

function getThaiDay(date: Date, useUtc = true): ThaiDay {
  const dayOfWeek = useUtc ? date.getUTCDay() : date.getDay();
  const hour = useUtc ? date.getUTCHours() : date.getHours();

  if (dayOfWeek === 3) {
    return hour < 18 ? 'wednesday_day' : 'wednesday_night';
  }
  const days: ThaiDay[] = ['sunday', 'monday', 'tuesday', 'wednesday_day', 'thursday', 'friday', 'saturday'];
  return days[dayOfWeek];
}

/**
 * Calculate Thai astrology natal profile from birth date.
 * Returns the classical Thai day-of-week attributes for the user's birth day:
 * planet, color, lucky number, direction, Buddha posture, personality.
 * This is a fixed natal characteristic — it never changes.
 */
export function calculateThaiAstrology(birthDate: Date): ThaiAstrology {
  // Birth dates are stored as UTC midnight, so use UTC methods
  const thaiDay = getThaiDay(birthDate, true);
  return { day: thaiDay, ...DAY_DATA[thaiDay] };
}

/**
 * Calculate Thai astrology for today's date.
 * Returns the classical Thai day-of-week attributes for the current day:
 * today's color, lucky number, direction, and planet.
 * Used for daily lucky attributes — changes every day.
 *
 * @param today - current date in the user's timezone (e.g. Bangkok)
 */
export function calculateTodayThaiAstrology(today: Date): ThaiAstrology {
  // today is already localised (e.g. via getBangkokDate()), use local methods
  const thaiDay = getThaiDay(today, false);
  return { day: thaiDay, ...DAY_DATA[thaiDay] };
}

/**
 * Calculate life rhythm based on Thai astrology
 *
 * Thai astrology has concepts of favorable/unfavorable periods
 *
 * TODO: Implement life rhythm calculation
 */
export function calculateLifeRhythm(birthDate: Date, currentDate: Date): {
  phase: 'favorable' | 'neutral' | 'challenging';
  description: string;
} {
  // Mock implementation
  return {
    phase: 'favorable',
    description: 'ช่วงนี้เป็นช่วงที่เหมาะสำหรับการเริ่มต้นสิ่งใหม่',
  };
}
