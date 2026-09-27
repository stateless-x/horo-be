import { describe, expect, test } from 'bun:test';
import {
  elementCreditedToPlanet,
  foreignElementWords,
  mapStrings,
  tightenNameSpacing,
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
