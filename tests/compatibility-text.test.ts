import { describe, expect, test } from 'bun:test';
import {
  birthDataInventory,
  elementCreditedToPlanet,
  foreignElementWords,
  guessesPartnerView,
  mapStrings,
  mixesPronouns,
  stockLine,
  thaiWordCount,
  tightenNameSpacing,
  wrongGenderWords,
} from '../src/lib/compatibility-text';

describe('foreignElementWords', () => {
  test('catches the free verdict that gave an all-earth pair fire', () => {
    const verdict = 'คู่นี้เป็นดินที่มั่นคงเจอกับไฟที่ลุกไว ถ้าจับจังหวะให้ดีจะอบอุ่น แต่ถ้าเร่งจะร้อนเกินไป';
    expect(foreignElementWords(verdict, ['earth', 'earth'])).toEqual(['ไฟ']);
  });

  test("accepts the pair's own elements, bare or as ธาตุX", () => {
    expect(foreignElementWords('ไฟหลอมทองให้อ่อนตัว ธาตุทองของคุณกับธาตุไฟของต้น', ['metal', 'fire'])).toEqual([]);
    expect(foreignElementWords('ธาตุโลหะของคุณ', ['metal', 'fire'])).toEqual([]);
  });

  test('does not read everyday words as elements', () => {
    expect(foreignElementWords('คุณเดินไปหาเขาด้วยน้ำเสียงนุ่ม และมีน้ำใจ', ['earth'])).toEqual([]);
  });

  test('catches a third element named with ธาตุ', () => {
    expect(foreignElementWords('ธาตุน้ำช่วยให้เย็นลง', ['fire', 'earth'])).toEqual(['น้ำ']);
  });
});

describe('elementCreditedToPlanet', () => {
  test('flags an element credited to a Thai planet', () => {
    expect(elementCreditedToPlanet('คู่นี้มีไฟจากดาวอังคารและดินจากดาวอาทิตย์')).toContain('ไฟจากดาวอังคาร');
    expect(elementCreditedToPlanet('คุณเป็นไฟที่ลุกโชนจากดาวอังคาร')).not.toBeNull();
  });

  test('leaves the two systems side by side alone', () => {
    expect(elementCreditedToPlanet('ธาตุน้ำของคุณกับดาวศุกร์ของเธอ')).toBeNull();
  });
});

describe('tightenNameSpacing', () => {
  test('removes the spaces the model puts around a name inside a clause', () => {
    expect(tightenNameSpacing('ทำให้ มายด์ เห็นว่าคุณจริงจัง', 'มายด์')).toBe('ทำให้มายด์เห็นว่าคุณจริงจัง');
    expect(tightenNameSpacing('วันเกิดไทยของ คุณวิภาและดาวศุกร์', 'คุณวิภา')).toBe('วันเกิดไทยของคุณวิภาและดาวศุกร์');
  });

  test('keeps a clause break before the name', () => {
    expect(tightenNameSpacing('เข้าใจกันไว มายด์ มักต้องการความชัดเจน', 'มายด์')).toBe('เข้าใจกันไว มายด์มักต้องการความชัดเจน');
  });

  test('leaves already tight text unchanged', () => {
    const text = 'คุณกับต้นคุยกันได้ดี ต้นมักลงมือทำก่อน';
    expect(tightenNameSpacing(text, 'ต้น')).toBe(text);
  });
});

describe('mapStrings', () => {
  test('maps every string and keeps the shape', () => {
    expect(mapStrings({ a: 'x', b: ['y', { c: 'z' }], n: 1 }, (text) => text.toUpperCase())).toEqual({
      a: 'X',
      b: ['Y', { c: 'Z' }],
      n: 1,
    });
  });
});

describe('v4 prose checks', () => {
  test('idioms around element words are not elements', () => {
    expect(foreignElementWords('ช่วงนี้คุณหมดไฟกับงาน แต่เป็นคนติดดิน และเป็นเด็กไฟแรง', ['water'])).toEqual([]);
    // From the v4 samples: everyday words, not elements.
    expect(foreignElementWords('คุณมีไฟในการเข้าหาคน อยากคุยจริงหรือแค่ตามน้ำ', ['earth', 'metal'])).toEqual([]);
    expect(foreignElementWords('แม่พร้อมของว่างหรือผลไม้หนึ่งจาน', ['fire', 'earth'])).toEqual([]);
  });

  test('gendered words must match the reader; คะแนน is not คะ', () => {
    expect(wrongGenderWords('หนูเข้าใจว่าแม่ห่วง', 'male')).toEqual(['หนู']);
    expect(wrongGenderWords('ผมขอคุยหน่อยครับ', 'female')).toEqual(['ผม', 'ครับ']);
    expect(wrongGenderWords('คะแนนด้านนี้ของคุณดี', null)).toEqual([]);
  });

  test('a line that mixes เรา with หนู is flagged', () => {
    expect(mixesPronouns('เรามีเรื่องหนึ่งที่หนูเก็บไว้')).toBe(true);
    expect(mixesPronouns('เราอยากคุยเรื่องนี้')).toBe(false);
  });

  test('a birth-data inventory is caught, a single data point is not', () => {
    expect(birthDataInventory('ต้นเป็นเจ้าวันไฟหยิน ธาตุไฟ เกิดวันอังคาร ดาวอังคาร จึงมักเดินหน้าเร็ว')).not.toBeNull();
    expect(birthDataInventory('ธาตุไฟของต้นกับธาตุทองของคุณหนุนกัน')).toBeNull();
  });

  test('a guess at how the partner reads the reader is caught; the reader reading the partner is not', () => {
    expect(guessesPartnerView('เพราะต้นอาจอ่านว่าคุณไม่แคร์', 'ต้น')).toBe('ต้นอาจอ่าน');
    expect(guessesPartnerView('เธอมองว่าความเงียบคือความเสี่ยง', 'คุณวิภา')).toBe('เธอมองว่า');
    expect(guessesPartnerView('คุณมักตีความความเงียบของบีมผิด', 'บีม')).toBeNull();
  });

  test('stock advice from the samples is caught', () => {
    expect(stockLine('อย่าคุยตอนเหนื่อยหรือหิว')).toBe('เหนื่อยหรือหิว');
    expect(stockLine('ลองคุยสรุปสัปดาห์ละครั้ง')).toBe('สัปดาห์ละครั้ง');
    expect(stockLine('ส่งข้อความหาต้นก่อนประชุมวันพฤหัส')).toBeNull();
  });

  test('thaiWordCount counts words, not characters', () => {
    expect(thaiWordCount('คุณกับต้นคุยกันได้ดี')).toBeLessThan(10);
  });
});
