import { createHash } from 'node:crypto';
import type {
  LoadingLinesResponse,
  LoadingSurface,
  SponsoredLine,
} from '../shared/types/loading-lines';

export type { LoadingLinesResponse, LoadingSurface, SponsoredLine };

/**
 * Copy shown while a loading screen waits on the LLM.
 *
 * This is static content shipped with the code, deliberately not a database
 * table: it is identical for every user, changes only when someone edits this
 * file, and must be readable before auth resolves. Editing a line here changes
 * CONTENT_VERSION, which is how the frontend knows to drop its cached copy.
 */

const TODAY_LINES: readonly string[] = [
  'วันนี้จะดีหรือแย่ ยังไงก็ผ่านไปได้เหมือนกันนั่นแหละ',
  'บางวันใจมันหนักโดยไม่มีเหตุผล นั่นไม่ใช่ความผิดของคุณนะ',
  'บางวันก็แค่เหนื่อย ไม่ต้องมีเหตุผลก็ได้',
  'วันที่ใจไม่นิ่ง ไม่ต้องรีบตัดสินใจอะไรก็ได้นะ',
  'เช็กดวงก่อนออกจากบ้าน เหมือนเช็กใจตัวเองว่าวันนี้พร้อมแค่ไหน',
  'ไม่มีใครดีได้ทุกวัน ดวงก็เหมือนกัน',
  'วันที่อะไรก็ติดขัด บางทีจักรวาลแค่บอกว่าพักหน่อยเถอะ',
  'เรื่องที่คิดวนอยู่ตอนนี้ ไม่ใช่คุณคนเดียวที่เป็นนะ',
  'คิดมากไม่ได้แปลว่าอ่อนแอ แปลว่าคุณใส่ใจมากกว่าคนอื่น',
  'วันนี้ทำเท่าที่ไหว ก็ถือว่าทำดีแล้วนะ',
  'ที่ผ่านมาคุณทำดีมาตลอด ภูมิใจในตัวเองบ้างนะ',
  'บางเรื่องไม่ได้อยากได้ทางออกหรอก แค่อยากให้ใครสักคนรู้',
  'ดวงบอกให้ระวัง ก็แค่ระวัง ไม่ต้องกลัว',
  'ก่อนนอนคืนนี้ นึกถึงเรื่องที่คุณทำได้ดีวันนี้สักเรื่อง เล็กแค่ไหนก็นับ',
];

const FORTUNE_LINES: readonly string[] = [
  'คนมาดูดวง บางคนมาหาคำตอบ บางคนแค่สงสัย ทั้งสองแบบมาถูกที่แล้ว',
  'หลายคนมาหาเราเพราะไม่รู้จะเล่าให้ใครฟัง เราฟังได้หมดนะ',
  'คนที่มาดูดวง ส่วนใหญ่คือคนที่ใส่ใจชีวิตตัวเอง นั่นเป็นเรื่องดีนะ',
  'บางทีที่มาถามเรื่องดวง จริง ๆ อยากได้กำลังใจมากกว่าคำตอบ เราให้ได้ทั้งสองอย่าง',
  'คุณเดินมาถึงตรงนี้ได้ด้วยตัวเอง แค่นั้นก็เก่งมากแล้ว',
  'ดวงบอกแนวโน้ม ไม่ใช่คำตัดสิน สุดท้ายคุณเลือกเองอยู่ดี',
  'ถ้าคำทำนายไม่ตรงใจ ไม่ต้องเชื่อทั้งหมดก็ได้ คุณรู้จักตัวเองดีกว่าเรา',
  'เดือนที่ดวงไม่ดี ไม่ต้องหยุดทุกอย่างหรอก แค่เดินช้าลง มองให้ชัดขึ้น',
  'คำเตือนในดวงไม่ใช่คำสาปนะ มันเหมือนเพื่อนกระซิบว่า เดี๋ยวระวังตรงนี้หน่อย',
  'เรื่องหนักที่สุดในชีวิต คุณผ่านมาได้เองทุกที นั่นแหละคือความเก่งของคุณ',
  'เราไม่ได้มาตัดสินคุณ แค่มาช่วยมองให้ชัดขึ้นเท่านั้นเอง',
  'ธาตุที่ขาดในดวง ไม่ใช่จุดอ่อน แต่เป็นเรื่องที่คุณจะได้เรียนรู้ไปทั้งชีวิต',
  'คนธาตุเดียวกันดวงก็ไม่เหมือนกัน เพราะไม่มีใครเหมือนคุณทั้งหมดหรอก',
  'เสาวันคือตัวคุณ เสาปีคือครอบครัวที่คุณโตมา',
  'คุณมักดูเข้มแข็งในสายตาคนอื่น จนไม่มีใครรู้ว่าคุณก็อยากมีคนให้พิงบ้าง',
  'MBTI ไม่ได้บอกว่าคุณเก่งอะไร แค่บอกว่าคุณถนัดใช้ใจแบบไหน',
  'จุดอ่อนของคนเรา มักเป็นด้านกลับของจุดแข็ง คนละเอียดเลยมักคิดมาก',
  'คุณอาจไม่ได้อยากสำเร็จแบบที่คนอื่นนิยาม แค่อยากให้สิ่งที่ทำมันมีความหมาย นั่นไม่ผิดเลย',
  'เรื่องที่กลุ้มอยู่ตอนนี้ ปีหน้าอาจกลายเป็นเรื่องเล่าขำ ๆ ก็ได้นะ',
  'บางเรื่องต้องใช้เวลา ไม่ใช่ต้องพยายามให้มากขึ้น',
  'จังหวะยังไม่มา ไม่ได้แปลว่าคุณทำไม่ดีพอ คุณทำมาดีตลอดต่างหาก',
];

const COMPATIBILITY_LINES: readonly string[] = [
  'คนมาดูดวงคู่ มักมีใครสักคนอยู่ในใจแล้ว จะขำ ๆ หรือจริงจังก็ตาม',
  'เช็กดวงกับเพื่อนสนิทก็สนุกดีนะ ไม่ต้องเป็นเรื่องรักเสมอไป',
  'ธาตุต่างกันไม่ได้แปลว่าไปด้วยกันไม่ได้ บางคู่ต่างกันแล้วเติมกันพอดีเลย',
  'เเรากันได้ดีไม่ได้แปลว่าไม่ทะเลาะ แค่แปลว่าทะเลาะแล้วกลับมาคุยกันได้',
  'ถ้าคุณพยายามเพื่อความสัมพันธ์นี้มาตลอด คุณทำส่วนของคุณดีแล้วนะ',
  'บางทีที่อยากรู้ว่าเเรากันไหม จริง ๆ แค่อยากรู้ว่าเขายังสนใจอยู่หรือเปล่า',
  'คู่ที่ไปกันได้นาน มักรู้ว่าอีกฝ่ายต่างจากตัวเองตรงไหน แล้วไม่พยายามเปลี่ยน',
  'คะแนนไม่ได้ตัดสินความสัมพันธ์หรอก คนสองคนต่างหากที่ตัดสิน',
  'ไม่ว่าผลจะออกมายังไง คุณก็คู่ควรกับคนที่เเราใจคุณอยู่ดี',
  'คนที่รู้สึกเยอะ มักรักได้ลึกกว่าคนอื่น แต่ก็เจ็บได้ลึกกว่าด้วย ทั้งสองอย่างคือของขวัญ',
];

const SPONSORED_LINES: readonly SponsoredLine[] = [
  {
    text: 'ดูแลสัตว์เลี้ยงให้ดียิ่งขึ้นกว่าเดิม',
    label: 'pawjai.co',
    url: 'https://pawjai.co',
    iosUrl: 'https://apps.apple.com/th/app/pawjai/id6751916255?l=th',
    sponsor: 'pawjai',
  },
  {
    text: 'สุขภาพสัตว์เลี้ยงดี คนในบ้านก็อุ่นใจ',
    label: 'pawjai.co',
    url: 'https://pawjai.co',
    iosUrl: 'https://apps.apple.com/th/app/pawjai/id6751916255?l=th',
    sponsor: 'pawjai',
  },
  {
    text: 'แอปที่ช่วยให้คุณเเราใจสัตว์เลี้ยงมากขึ้น',
    label: 'pawjai.co',
    url: 'https://pawjai.co',
    iosUrl: 'https://apps.apple.com/th/app/pawjai/id6751916255?l=th',
    sponsor: 'pawjai',
  },
  {
    text: 'รับทำเว็บและระบบสำหรับธุรกิจ SME',
    label: 'pooh.fyi',
    url: 'https://pooh.fyi',
    sponsor: 'pooh',
  },
  {
    text: 'เว็บสายมูที่คุณใช้อยู่ ทำโดย',
    label: 'pooh.fyi',
    url: 'https://pooh.fyi',
    sponsor: 'pooh',
  },
  {
    text: 'อยากมีเว็บหรือระบบเป็นของตัวเอง',
    label: 'pooh.fyi',
    url: 'https://pooh.fyi',
    sponsor: 'pooh',
  },
  {
    text: 'เว็บไซต์ทำให้ลูกค้าเห็นคุณได้มากขึ้น',
    label: 'pooh.fyi',
    url: 'https://pooh.fyi',
    sponsor: 'pooh',
  },
];

const LINES_BY_SURFACE: Record<LoadingSurface, readonly string[]> = {
  today: TODAY_LINES,
  fortune: FORTUNE_LINES,
  compatibility: COMPATIBILITY_LINES,
};

export const LOADING_SURFACES: readonly LoadingSurface[] = ['today', 'fortune', 'compatibility'];

export function isLoadingSurface(value: string): value is LoadingSurface {
  return (LOADING_SURFACES as readonly string[]).includes(value);
}

/**
 * Short content hash over every line in this module. Computed once at module
 * load so the route never pays for it per request.
 */
export const CONTENT_VERSION: string = createHash('sha256')
  .update(
    JSON.stringify({
      today: TODAY_LINES,
      fortune: FORTUNE_LINES,
      compatibility: COMPATIBILITY_LINES,
      sponsored: SPONSORED_LINES,
    })
  )
  .digest('hex')
  .slice(0, 8);

/** Lines plus sponsored slots for one surface. Same payload for every user. */
export function getLoadingLines(surface: LoadingSurface): LoadingLinesResponse {
  return {
    lines: [...LINES_BY_SURFACE[surface]],
    sponsored: SPONSORED_LINES.map((line) => ({ ...line })),
    version: CONTENT_VERSION,
  };
}
