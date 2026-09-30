import { describe, expect, test } from 'bun:test';
import {
  birthDataInventory,
  chartSilence,
  elementCreditedToPlanet,
  elementsNamed,
  escapeRegExp,
  fixKnownTypos,
  foreignElementWords,
  guessesPartnerView,
  hintJargon,
  mapStrings,
  maskName,
  maskNames,
  mixesPronouns,
  NAME_MARK,
  READER_MARK,
  stockLine,
  thaiWordCount,
  tightenNameSpacing,
  wrongGenderWords,
} from '../src/lib/compatibility-text';
import { spaceLatinName, spaceLatinNames } from '../lib/shared';

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

describe('maskName', () => {
  test('a partner called ดาว is not the word ดาว; a planet after the name still is', () => {
    expect(hintJargon(maskName('ทำไมดาวถึงเงียบเมื่อแผนเปลี่ยน', 'ดาว'))).toBeNull();
    expect(hintJargon(maskName('ดาวใจเงียบไปทั้งวันหลังคุณพูดประโยคนั้น', 'ดาวใจ'))).toBeNull();
    expect(hintJargon(maskName('ดาวอังคารทำให้ดาวใจร้อน', 'ดาว'))).toBe('ดาว');
    expect(hintJargon(maskName('ทำไมดวงดาวถึงพาดาวมาเจอคุณ', 'ดาว'))).toBe('ดาว');
    expect(hintJargon(maskName('ทำไมดาวถึงเงียบ ธาตุของเขาบอกอะไร', 'ดาว'))).toBe('ธาตุ');
  });

  test('a partner named after an element is not that element; ธาตุ before the name still is', () => {
    expect(foreignElementWords(maskName('น้ำกับคุณคุยกันได้ดี', 'น้ำ'), ['earth'])).toEqual([]);
    expect(foreignElementWords(maskName('ไฟชวนคุณออกไปเดินเล่น', 'ไฟ'), ['earth'])).toEqual([]);
    expect(foreignElementWords(maskName('ทองรอคุณอยู่ที่ร้าน', 'ทอง'), ['water'])).toEqual([]);
    expect(foreignElementWords(maskName('ไฟมีธาตุไฟในตัว', 'ไฟ'), ['earth'])).toEqual(['ไฟ']);
  });

  test('a partner named ดาว is not an element credited to a planet or a birth-data run', () => {
    expect(elementCreditedToPlanet(maskName('ไฟของดาวทำให้บ้านอุ่น', 'ดาว'))).toBeNull();
    expect(birthDataInventory(maskName('เจ้าวันไฟ ธาตุไฟ ของดาว', 'ดาว'))).toBeNull();
  });

  test('names with regex characters become literal patterns', () => {
    for (const name of ['บีม (ตัวจริง)', 'A+', 'น้อง*', '(บีม', '+1', 'a?b']) {
      const pattern = new RegExp(escapeRegExp(name));
      expect(pattern.test(`คุยกับ${name}แล้ว`)).toBe(true);
      expect(maskName(`คุยกับ${name}แล้ว`, name)).toBe('คุยกับ(ชื่อ)แล้ว');
      expect(guessesPartnerView(`${name}มองว่าคุณเงียบ`, name)).toBe(`${name}มองว่า`);
    }
    expect(new RegExp(escapeRegExp('A+')).test('AA')).toBe(false);
  });

  test('a name with regex characters is matched literally', () => {
    expect(maskName('a.b กับคุณ', 'a.b')).toBe('(ชื่อ) กับคุณ');
    expect(maskName('axb กับคุณ', 'a.b')).toBe('axb กับคุณ');
  });
});

describe('maskNames', () => {
  test("the reader's supplied name gets its own mark, so it never stands in for the partner", () => {
    const masked = maskNames({ verdict: 'ดาวกับMindคุยกันได้ดี' }, 'Mind', 'ดาว');
    expect(masked.verdict).toBe(`${READER_MARK}กับ${NAME_MARK}คุยกันได้ดี`);
  });

  test('ดาว, Mind, มู2242 as the reader: no check reads the name as a word', () => {
    const view = (reader: string, text: string) => maskNames(text, 'ต้น', reader);
    expect(hintJargon(view('ดาว', 'ทำไมดาวถึงเงียบเมื่อแผนเปลี่ยน'))).toBeNull();
    expect(view('Mind', 'Mindกับต้นคุยกันได้ดี')).not.toMatch(/[A-Za-z]/);
    expect(view('มู2242', 'มู2242กับต้นไว้ใจกันได้ดี')).not.toMatch(/[0-9]/);
  });

  test('no supplied reader name: คุณ is a pronoun and stays', () => {
    expect(maskNames('คุณกับต้นคุยกันได้ดี', 'ต้น', 'คุณ')).toBe(`คุณกับ${NAME_MARK}คุยกันได้ดี`);
    expect(maskNames('คุณกับต้นคุยกันได้ดี', 'ต้น', null)).toBe(`คุณกับ${NAME_MARK}คุยกันได้ดี`);
    expect(maskNames('คุณกับต้นคุยกันได้ดี', 'ต้น', '  ')).toBe(`คุณกับ${NAME_MARK}คุยกันได้ดี`);
  });

  test('one name inside the other is masked whole, whichever person has it', () => {
    expect(maskNames('ดาวใจกับดาวคุยกัน', 'ดาว', 'ดาวใจ')).toBe(`${READER_MARK}กับ${NAME_MARK}คุยกัน`);
    expect(maskNames('ดาวใจกับดาวคุยกัน', 'ดาวใจ', 'ดาว')).toBe(`${NAME_MARK}กับ${READER_MARK}คุยกัน`);
  });
});

describe('spaceLatinName', () => {
  test('a Latin name gets one space each side where it touches Thai', () => {
    expect(spaceLatinName('ฉบับเต็มของคุณกับIce', 'Ice')).toBe('ฉบับเต็มของคุณกับ Ice');
    expect(spaceLatinName('ของIceที่คุม', 'Ice')).toBe('ของ Ice ที่คุม');
    expect(spaceLatinName('แต่ Mindเปิด', 'Mind')).toBe('แต่ Mind เปิด');
    expect(spaceLatinName('ที่ Mindพูด', 'Mind')).toBe('ที่ Mind พูด');
    expect(spaceLatinName('Mindเปิดใจก่อน', 'Mind')).toBe('Mind เปิดใจก่อน');
    expect(spaceLatinName('คุยกับA+แล้ว', 'A+')).toBe('คุยกับ A+ แล้ว');
  });

  test('a name with digits counts, and extra spaces become one', () => {
    expect(spaceLatinName('ของมู2242ที่', 'มู2242')).toBe('ของ มู2242 ที่');
    expect(spaceLatinName('กับ   Ice   ที่', 'Ice')).toBe('กับ Ice ที่');
  });

  test('no space before punctuation or at a line start or end', () => {
    expect(spaceLatinName('Ice, คุณ', 'Ice')).toBe('Ice, คุณ');
    expect(spaceLatinName('คุยกับ(Ice)', 'Ice')).toBe('คุยกับ(Ice)');
    expect(spaceLatinName('ของIce\nที่คุม', 'Ice')).toBe('ของ Ice\nที่คุม');
    expect(spaceLatinName('Ice · ปลดล็อก', 'Ice')).toBe('Ice · ปลดล็อก');
  });

  test('Thai-script names keep today\'s spacing', () => {
    for (const name of ['บีม (ตัวจริง)', 'ดาว']) {
      expect(spaceLatinName(`คุยกับ${name}แล้ว`, name)).toBe(`คุยกับ${name}แล้ว`);
    }
  });

  test('only the whole name: a partner called A is not the A in ATM', () => {
    expect(spaceLatinName('ไปATMกับAแล้ว', 'A')).toBe('ไปATMกับ A แล้ว');
  });

  test('applying it twice changes nothing more, and both names are spaced', () => {
    const once = spaceLatinNames('แต่ Mindเปิดใจให้Iceก่อน', ['Ice', 'Mind']);
    expect(once).toBe('แต่ Mind เปิดใจให้ Ice ก่อน');
    expect(spaceLatinNames(once, ['Ice', 'Mind'])).toBe(once);
    expect(spaceLatinNames('ให้Iceก่อน', ['Ice', null, undefined])).toBe('ให้ Ice ก่อน');
  });
});
