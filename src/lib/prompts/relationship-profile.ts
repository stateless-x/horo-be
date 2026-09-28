import type { RelationshipType, V4ChapterKey } from '../../../lib/shared';

import focusTalkingMd from './md/compatibility-focus/talking.md' with { type: 'text' };
import focusRomanticMd from './md/compatibility-focus/romantic.md' with { type: 'text' };
import focusBossMd from './md/compatibility-focus/boss.md' with { type: 'text' };
import focusCoworkerMd from './md/compatibility-focus/coworker.md' with { type: 'text' };
import focusFriendMd from './md/compatibility-focus/friend.md' with { type: 'text' };
import focusFamilyMd from './md/compatibility-focus/family.md' with { type: 'text' };

/**
 * Adapts one stable compatibility-report contract to the purpose and boundaries
 * of each relationship context. The JSON shape and astrology facts stay shared;
 * only the reader-facing interpretation goals vary.
 */
export interface RelationshipPromptProfile {
  focusBlock: string;
  relationshipFrame: string;
  attractionGoal: string;
  partnerGoal: string;
  readerGoal: string;
  communicationGoal: string;
  repairGoal: string;
  calendarGoal: string;
  planGoal: string;
  careGoal: string;
  attractionTitle: string;
  partnerTitle: string;
  readerTitle: string;
  communicationTitle: string;
  frictionTitle: string;
  futureTitle: string;
  nextStepKind: string;
}

const PROFILES: Record<RelationshipType, RelationshipPromptProfile> = {
  romantic: {
    focusBlock: focusRomanticMd.trimEnd(),
    relationshipFrame: 'ความสัมพันธ์ของคนรักหรือคู่ครอง',
    attractionGoal: 'อธิบายความใกล้ชิดและสิ่งที่ทำให้ทั้งสองคนเลือกกัน โดยไม่เหมารวมว่าแรงดึงดูดต้องเป็นเรื่องทางกาย',
    partnerGoal: 'อธิบายสิ่งที่อีกฝ่ายมักต้องการเมื่ออยู่ในความสัมพันธ์แบบคู่รัก',
    readerGoal: 'ช่วยให้ผู้อ่านเห็นรูปแบบที่ตัวเองทำซ้ำเมื่อรักและผูกพันกับใคร',
    communicationGoal: 'ช่วยให้คุยเรื่องความต้องการ ความคาดหวัง และความใกล้ชิดโดยไม่เอาชนะกัน',
    repairGoal: 'ช่วยให้กลับมาคุยหลังไม่เข้าใจกัน โดยไม่รีบตัดสินว่าใครผิด',
    calendarGoal: 'เลือกจังหวะคุยหรือขยับเรื่องสำคัญของความสัมพันธ์',
    planGoal: 'การดูแลความใกล้ชิด ความไว้ใจ และขอบเขตของทั้งคู่',
    careGoal: 'ช่วยให้ผู้อ่านดูแลความใกล้ชิด ความต้องการ และขอบเขตของความสัมพันธ์ได้อย่างปลอดภัยขึ้น',
    attractionTitle: 'แรงดึงดูด',
    partnerTitle: 'ตัวตนของ{name}ในความสัมพันธ์นี้',
    readerTitle: 'ตัวคุณในความสัมพันธ์นี้',
    communicationTitle: 'การสื่อสาร',
    frictionTitle: 'จุดเสียดทานและวิธีคืนดี',
    futureTitle: 'สิ่งที่ทำให้อยู่ยาว',
    nextStepKind: 'คุยเรื่องใหญ่ของความสัมพันธ์ เช่น อนาคตหรือการตัดสินใจร่วมกัน',
  },
  talking: {
    focusBlock: focusTalkingMd.trimEnd(),
    relationshipFrame: 'ช่วงกำลังทำความรู้จักกันของคนคุย',
    attractionGoal: 'อธิบายความสนใจและความสบายใจที่ทำให้ยังอยากรู้จักกันต่อ โดยไม่เรียกทั้งสองคนว่าแฟนหรือคู่รัก',
    partnerGoal: 'อธิบายจังหวะที่อีกฝ่ายมักเปิดใจ ตอบรับ และต้องการพื้นที่ระหว่างทำความรู้จักกัน',
    readerGoal: 'ช่วยให้ผู้อ่านเห็นว่าตัวเองมักเร่ง ชะลอ หรือคาดหวังอะไรในช่วงดูใจ',
    communicationGoal: 'ช่วยเช็กความสนใจและความสม่ำเสมอโดยไม่เร่งสถานะหรือกดดันคำตอบ',
    repairGoal: 'ช่วยคลี่ความไม่ชัดเจนหรือการคุยที่เริ่มตึง โดยไม่ตีความความเงียบแทนอีกฝ่าย',
    calendarGoal: 'เลือกจังหวะชวนคุย นัดเจอ หรือเช็กความชัดเจนแบบไม่กดดัน',
    planGoal: 'การรู้จักกันเพิ่มขึ้น การเห็นการตอบรับจริง และการรักษาความสบายใจของตัวเอง',
    careGoal: 'ช่วยให้ผู้อ่านดูจังหวะ ความสม่ำเสมอ และขอบเขตของช่วงทำความรู้จักกัน โดยไม่รีบผูกมัด',
    attractionTitle: 'จุดที่ทำให้อยากรู้จักกันต่อ',
    partnerTitle: 'จังหวะของ{name}ตอนกำลังดูใจ',
    readerTitle: 'ตัวคุณตอนกำลังดูใจ',
    communicationTitle: 'คุยให้รู้จักกันมากขึ้น',
    frictionTitle: 'ความไม่ชัดเจนและวิธีคลี่คลาย',
    futureTitle: 'สัญญาณว่าไปต่อได้และจังหวะขยับ',
    nextStepKind: 'ชวนออกไปเจอกันหรือคุยให้ชัดว่าเป็นอะไรกัน',
  },
  friend: {
    focusBlock: focusFriendMd.trimEnd(),
    relationshipFrame: 'มิตรภาพของทั้งสองคน',
    attractionGoal: 'อธิบายสิ่งที่ทำให้อยู่ด้วยกันแล้วสบายใจ ไว้ใจกัน หรืออยากรักษามิตรภาพนี้',
    partnerGoal: 'อธิบายว่าอีกฝ่ายมักเป็นเพื่อนแบบไหน แสดงความใส่ใจอย่างไร และต้องการพื้นที่เมื่อใด',
    readerGoal: 'ช่วยให้ผู้อ่านเห็นรูปแบบของตัวเองเรื่องความไว้ใจ ความสม่ำเสมอ และระยะห่างในมิตรภาพ',
    communicationGoal: 'ช่วยเช็กอินหรือคุยเรื่องค้างใจ โดยยังรักษาศักดิ์ศรีและความสบายใจของความเป็นเพื่อน',
    repairGoal: 'ช่วยซ่อมระยะห่างหรือความค้างใจ โดยไม่บังคับให้มิตรภาพกลับไปเหมือนเดิมทันที',
    calendarGoal: 'เลือกจังหวะเช็กอิน ชวนทำบางอย่าง หรือคุยเรื่องที่ค้างใจ',
    planGoal: 'การดูแลความไว้ใจ การตอบรับ และพื้นที่สบายใจในมิตรภาพ',
    careGoal: 'ช่วยให้ผู้อ่านดูแลความไว้ใจ ความสม่ำเสมอ และพื้นที่ของมิตรภาพอย่างไม่กดดันกัน',
    attractionTitle: 'สิ่งที่ทำให้เป็นเพื่อนกันได้ดี',
    partnerTitle: '{name}ในมิตรภาพนี้',
    readerTitle: 'ตัวคุณในมิตรภาพนี้',
    communicationTitle: 'คุยให้สบายใจกัน',
    frictionTitle: 'เรื่องค้างใจและวิธีกลับมาคุย',
    futureTitle: 'มิตรภาพระยะยาว',
    nextStepKind: 'ชวนทำแผนใหญ่ด้วยกันหรือคุยเรื่องที่ค้างใจ',
  },
  boss: {
    focusBlock: focusBossMd.trimEnd(),
    relationshipFrame: 'ความสัมพันธ์ในการทำงานระหว่างลูกน้องกับหัวหน้า โดยผู้อ่านเป็นลูกน้อง',
    attractionGoal: 'อธิบายจุดที่สไตล์การทำงานของทั้งสองคนส่งเสริมหรือดึงความสนใจจากกัน ห้ามใช้ภาษาเชิงโรแมนติก',
    partnerGoal: 'อธิบายว่าสไตล์ของหัวหน้ามักให้ความสำคัญกับอะไรเวลามอบหมาย ตัดสินใจ และให้ข้อเสนอแนะ',
    readerGoal: 'ช่วยให้ผู้อ่านเห็นรูปแบบการรับงาน ขอความชัดเจน และรักษาขอบเขตของตัวเอง',
    communicationGoal: 'ช่วยตกลงลำดับความสำคัญ เจ้าของงาน กำหนดส่ง และนิยามว่างานเสร็จคืออะไร',
    repairGoal: 'ช่วยคลี่ความตึงเรื่องงานอย่างเป็นมืออาชีพ แยกข้อเท็จจริงของงานออกจากการตัดสินตัวบุคคล',
    calendarGoal: 'เลือกจังหวะคุยเรื่องขอบเขต ภาระงาน ผลงาน หรือค่าตอบแทนอย่างมีข้อมูล',
    planGoal: 'การทำให้งานชัดขึ้น ลดงานตกหล่น และรักษาขอบเขตแบบมืออาชีพ',
    careGoal: 'ช่วยให้ผู้อ่านทำงานกับหัวหน้าได้ชัดเจนขึ้น รักษาขอบเขต และสังเกตการตอบสนองที่ตรวจสอบได้',
    attractionTitle: 'จุดที่สไตล์งานส่งเสริมกัน',
    partnerTitle: 'สไตล์การทำงานของ{name}',
    readerTitle: 'สไตล์การทำงานของคุณ',
    communicationTitle: 'คุยงานให้เข้าใจตรงกัน',
    frictionTitle: 'จุดติดขัดและวิธีเคลียร์งาน',
    futureTitle: 'โตไปด้วยกันในงาน',
    nextStepKind: 'ขอคุยเรื่องขอบเขตงานหรือเรื่องเงินเดือน',
  },
  coworker: {
    focusBlock: focusCoworkerMd.trimEnd(),
    relationshipFrame: 'ความสัมพันธ์ในการทำงานระหว่างเพื่อนร่วมงาน',
    attractionGoal: 'อธิบายจุดที่สไตล์การทำงานของทั้งสองคนต่อกันได้ดีหรือช่วยเสริมกัน ห้ามใช้ภาษาเชิงโรแมนติก',
    partnerGoal: 'อธิบายว่าสไตล์ของเพื่อนร่วมงานมักให้ความสำคัญกับอะไรเวลาแบ่งงาน ส่งต่องาน และตัดสินใจ',
    readerGoal: 'ช่วยให้ผู้อ่านเห็นรูปแบบของตัวเองเรื่องเจ้าของงาน การขอความช่วยเหลือ และการตามงาน',
    communicationGoal: 'ช่วยตกลงเจ้าของงาน จุดส่งมอบ กำหนดเวลา และสิ่งที่แต่ละคนต้องแจ้งให้อีกฝ่ายรู้',
    repairGoal: 'ช่วยคลี่งานที่ตกหล่นหรือความเข้าใจไม่ตรงกัน โดยกลับมาที่ข้อเท็จจริงและข้อตกลงร่วมกัน',
    calendarGoal: 'เลือกจังหวะตกลงบทบาท ขอความช่วยเหลือ หรือทบทวนการส่งต่องาน',
    planGoal: 'การทำให้ความรับผิดชอบและการส่งต่องานชัดขึ้น',
    careGoal: 'ช่วยให้ผู้อ่านทำงานร่วมกับอีกฝ่ายได้ชัดเจน ยุติธรรม และรักษาขอบเขตของแต่ละคน',
    attractionTitle: 'จุดที่สไตล์งานส่งเสริมกัน',
    partnerTitle: 'สไตล์การทำงานของ{name}',
    readerTitle: 'สไตล์การทำงานของคุณ',
    communicationTitle: 'คุยงานให้เข้าใจตรงกัน',
    frictionTitle: 'จุดติดขัดและวิธีเคลียร์งาน',
    futureTitle: 'โตไปด้วยกันในงาน',
    nextStepKind: 'ตกลงบทบาทหรือขอบเขตงานร่วมกัน',
  },
  family: {
    focusBlock: focusFamilyMd.trimEnd(),
    relationshipFrame: 'ความสัมพันธ์ของคนในครอบครัว',
    attractionGoal: 'อธิบายความผูกพัน ความคุ้นเคย และสิ่งที่ทำให้ยังอยากดูแลกัน ห้ามใช้ภาษาเชิงโรแมนติก',
    partnerGoal: 'อธิบายว่าอีกฝ่ายมักต้องการอะไรจากบ้าน การดูแลกัน และพื้นที่ส่วนตัว',
    readerGoal: 'ช่วยให้ผู้อ่านเห็นบทบาทที่ตัวเองมักรับ ความคาดหวังที่แบกไว้ และขอบเขตที่ต้องการ',
    communicationGoal: 'ช่วยบอกความต้องการและความคาดหวังในบ้านด้วยถ้อยคำที่เคารพกัน',
    repairGoal: 'ช่วยลดแรงปะทะและกลับมาคุยเรื่องเดียว โดยไม่ใช้อำนาจ อายุ หรือบุญคุณกดอีกฝ่าย',
    calendarGoal: 'เลือกจังหวะคุยเรื่องหน้าที่ เวลา การตัดสินใจส่วนตัว หรือขอบเขตในบ้าน',
    planGoal: 'การช่วยให้บ้านมีพื้นที่ปลอดภัย เคารพขอบเขต และฟังกันได้มากขึ้น',
    careGoal: 'ช่วยให้ผู้อ่านอยู่ร่วมกับครอบครัวอย่างเคารพกัน รักษาขอบเขต และไม่แบกหน้าที่เกินกำลัง',
    attractionTitle: 'สิ่งที่ผูกความสัมพันธ์นี้ไว้',
    partnerTitle: '{name}ในครอบครัวนี้',
    readerTitle: 'ตัวคุณในครอบครัวนี้',
    communicationTitle: 'คุยกันให้ใจเย็น',
    frictionTitle: 'แรงปะทะและวิธีกลับมาคุย',
    futureTitle: 'ขอบเขตที่รักษาความสัมพันธ์',
    nextStepKind: 'บอกขอบเขตที่คุณต้องการ',
  },
};

export function relationshipPromptProfile(type: RelationshipType): RelationshipPromptProfile {
  return PROFILES[type];
}

export function relationshipChapterTitles(type: RelationshipType, partnerName: string): Record<V4ChapterKey, string> {
  const profile = relationshipPromptProfile(type);
  return {
    attraction: profile.attractionTitle,
    partner: profile.partnerTitle.replace('{name}', partnerName),
    you: profile.readerTitle,
    communication: profile.communicationTitle,
    friction: profile.frictionTitle,
    future: profile.futureTitle,
  };
}
