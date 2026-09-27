import { describe, expect, test } from 'bun:test';
import {
  birthDataInventory,
  chartSilence,
  elementCreditedToPlanet,
  elementsNamed,
  fixKnownTypos,
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

  test('a claim that the chart is silent is caught, in every form the samples used', () => {
    // Verbatim from the v4 samples and the PO audit.
    const silent = [
      'ดวงของคุณกับมายด์ไม่มีแรงดึงหรือแรงต้านจากฟ้า',
      'ดวงนี้ไม่มีแรงดึงหรือแรงปะทะจากฟ้า',
      'คู่นี้ไม่มีแรงดึงหรือแรงปะทะจากดวงเป็นพิเศษ ความสัมพันธ์นี้ไม่ใช่สิ่งที่ฟ้าลิขิตไว้',
      'แรงดึงที่มาจากความต่าง ไม่ใช่จากดวง',
      'เคมีกลาง ๆ เพราะตำแหน่งคู่ในดวงและธาตุของทั้งสองคนไม่มีแรงดึงพิเศษ',
      'ดวงคู่นี้ไม่ใช่คู่ที่ฟ้าเป็นใจง่าย ๆ',
      'เพราะตำแหน่งคู่ในดวงและธาตุของทั้งสองไม่ได้ส่งแรงพิเศษให้กันหรือขัดกันรุนแรง',
      'ตำแหน่งคู่ในดวงของนักษัตรวันเกิดทั้งสองคนไม่ได้สร้างแรงดึงหรือแรงปะทะพิเศษ',
      'เมื่อตำแหน่งคู่ในดวงไม่มีแรงพิเศษ',
      'ประกอบกับธาตุที่เหมือนกันและตำแหน่งคู่ในดวงที่ไม่มีแรงหนุน',
      'แต่ก็ไม่มีแรงส่งเป็นพิเศษ',
      'สิ่งที่ทำให้ความสัมพันธ์นี้ไปรอดจึงไม่ใช่โชคจากดวง',
      'นี่แปลว่าความดึงดูดระหว่างคุณกับต้นไม่ได้มาจากดวงเป็นตัวนำ',
      'ความดึงดูดของคู่นี้ไม่ได้มาจากแรงพิเศษของดวง',
      'ความสัมพันธ์นี้จึงไม่ได้ถูกผลักให้เดินเร็วหรือช้าจากดวง',
      'ความอบอุ่นระหว่างคุณกับบีมไม่ได้มาจากจังหวะที่ฟ้าจัดให้',
      'ทุกอย่างจึงขึ้นอยู่กับวิธีที่คุณสองคนตกลงกันเอง ไม่ใช่โชคชะตาที่กำหนดไว้',
      'ดวงคู่นี้จึงเป็นบทเรียน ไม่ใช่เรื่องโชคชะตาที่จะลงเอยเอง',
    ];
    for (const text of silent) expect(chartSilence(text)).not.toBeNull();
    // A negative force that is absent, the open palace, and ฟ้าผ่า (love at first sight) are fine.
    const fine = [
      'ความไว้ใจดีเพราะตำแหน่งคู่ในดวงไม่มีแรงบั่นทอนและไม่มีแรงต้าน',
      'นักษัตรวันเกิดเปิดทางให้กัน ความสัมพันธ์ไม่ถูกบังคับ เลือกสร้างเองได้',
      'จุดเริ่มต้นของคู่นี้ไม่ได้มาจากแรงดึงแบบฟ้าผ่า',
      'ไฟของต้นหลอมทองของคุณให้คมขึ้น',
    ];
    for (const text of fine) expect(chartSilence(text)).toBeNull();
  });

  test('known typos from the samples are corrected, and correct text is untouched', () => {
    expect(fixKnownTypos('ช่วยกันเขียงลำดับว่าอะไรสำคัญ')).toBe('ช่วยกันเรียงลำดับว่าอะไรสำคัญ');
    expect(fixKnownTypos('รายละเอียดที่คุณเคยเลาไว้ ปล่าวเลย')).toBe('รายละเอียดที่คุณเคยเล่าไว้ เปล่าเลย');
    expect(fixKnownTypos('แผนเปลี่ยนกระทันหัน เงียบได้ครึ่งค้อนวัน')).toBe('แผนเปลี่ยนกะทันหัน เงียบได้ครึ่งค่อนวัน');
    const correct = 'ช่วยกันเรียงลำดับเมื่อแผนเปลี่ยนกะทันหัน เรื่องที่เล่าไว้ เปล่าเลย ครึ่งค่อนวัน จำได้เลา ๆ';
    expect(fixKnownTypos(correct)).toBe(correct);
  });

  test('elementsNamed reads whole words and skips idioms', () => {
    expect(elementsNamed('ไฟของต้นหลอมทองของคุณ')).toEqual(['fire', 'metal']);
    expect(elementsNamed('คุณเดินหน้าเร็วและมีไฟในการทำงาน')).toEqual([]);
  });

  test('thaiWordCount counts words, not characters', () => {
    expect(thaiWordCount('คุณกับต้นคุยกันได้ดี')).toBeLessThan(10);
  });
});
