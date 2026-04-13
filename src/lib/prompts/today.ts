/**
 * LLM Prompt for Today's Daily Reading
 *
 * Dedicated prompt for /dashboard/today - a focused daily fortune
 * with MBTI integration, lucky attributes, warnings, and suggestions.
 *
 * Uses the same mystical Thai narrator voice as all other prompts.
 */

import type { BaziChart, ThaiAstrology } from "../../../lib/shared";
import type { DailyPillar, ElementHarmony, DailyTheme, BranchClash } from "../../../lib/astrology/daily";
import { buildMbtiContext } from "../prompts";

export interface DailyFortuneContext {
  todayPillar: DailyPillar;
  elementHarmony: ElementHarmony;
  dailyTheme: DailyTheme;
  branchClash: BranchClash;
}

/**
 * Build the prompt for today's enhanced daily reading.
 *
 * Combines Chinese Bazi + Thai astrology + MBTI (if available)
 * to generate a personalized daily fortune with:
 * - Overall reading, category scores, lucky attributes
 * - Warnings and actionable suggestions
 * - Dos/donts for the day
 *
 * @param natalThaiAstrology - Thai astrology derived from user's birth date (natal planet, personality)
 * @param todayThaiAstrology - Thai astrology derived from today's date (today's color, lucky number, direction)
 * @param dailyContext - Today's Bazi pillar, element harmony, theme, and clash data
 */
export function buildTodayPrompt(
  name: string,
  birthDate: Date,
  today: Date,
  baziChart: BaziChart,
  natalThaiAstrology: ThaiAstrology,
  mbtiType?: string | null,
  todayThaiAstrology?: ThaiAstrology,
  dailyContext?: DailyFortuneContext,
): string {
  const birthDateStr = birthDate.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const todayStr = today.toLocaleDateString("th-TH", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const mbtiContext = buildMbtiContext(mbtiType);

  // Today's lucky attributes: prefer today's day data, fall back to natal if not provided
  const daily = todayThaiAstrology ?? natalThaiAstrology;

  // Build today's Bazi context if provided
  const todayBaziSection = dailyContext ? `
โหราศาสตร์จีน (Bazi) — พลังของวันนี้:
- เสาวันนี้: ${dailyContext.todayPillar.stemChinese}${dailyContext.todayPillar.branchChinese} (${dailyContext.todayPillar.stem}-${dailyContext.todayPillar.branch})
- ธาตุของวันนี้: ${dailyContext.todayPillar.element}
- สัตว์ประจำวัน: ${dailyContext.todayPillar.animal}
- หยินหยาง: ${dailyContext.todayPillar.yinYang}

ความสัมพันธ์ธาตุวันนี้กับธาตุเจ้าชะตา:
- ธาตุเจ้า: ${dailyContext.elementHarmony.userElement} | ธาตุวันนี้: ${dailyContext.elementHarmony.todayElement}
- ความสัมพันธ์: ${dailyContext.elementHarmony.relationship}
- ระดับความเป็นมงคล: ${dailyContext.elementHarmony.favorability}
- ${dailyContext.elementHarmony.description}

ธีมของวันนี้: ${dailyContext.dailyTheme.theme}
${dailyContext.branchClash.hasClash ? `
คำเตือนการปะทะนักษัตร: ${dailyContext.branchClash.warning}` : ''}` : '';

  // Score guidance based on element harmony
  const scoreGuidance = dailyContext ? `
## กฎการให้คะแนนตามความสัมพันธ์ธาตุ (สำคัญมาก):
ระดับความเป็นมงคลของวันนี้: ${dailyContext.elementHarmony.favorability}
${dailyContext.elementHarmony.favorability === 'very_favorable' ? `- วันมงคลมาก: scores ส่วนใหญ่ควรอยู่ที่ 4-5 (อย่างน้อย 2 หมวดต้องได้ 5)` : ''}
${dailyContext.elementHarmony.favorability === 'favorable' ? `- วันดี: scores ส่วนใหญ่ควรอยู่ที่ 3-5 (อย่างน้อย 1 หมวดต้องได้ 4-5)` : ''}
${dailyContext.elementHarmony.favorability === 'neutral' ? `- วันปกติ: scores กระจายตั้งแต่ 2-4 (มีทั้งดีและต้องระวัง)` : ''}
${dailyContext.elementHarmony.favorability === 'challenging' ? `- วันท้าทาย: scores ส่วนใหญ่ควรอยู่ที่ 2-3 (อย่างน้อย 1 หมวดต้องได้ 1-2)` : ''}
- ห้ามให้ทุกหมวดได้ 3 เหมือนกัน — ต้องมีความหลากหลาย
- scores ต้องสะท้อนความสัมพันธ์ธาตุอย่างซื่อสัตย์` : '';

  return `ข้อมูลผู้ขอดวง:
ชื่อ: ${name}
วันเกิด: ${birthDateStr}
วันที่ดูดวง: ${todayStr}

โหราศาสตร์จีน (Bazi) — ดวงชะตาแต่กำเนิด:
- องค์ประกอบหลัก: ${baziChart.element}
- เจ้าวัน: ${baziChart.dayMaster}
- เสาสี่ที่: ${baziChart.yearPillar.stem}${baziChart.yearPillar.branch} (ปี), ${baziChart.monthPillar.stem}${baziChart.monthPillar.branch} (เดือน), ${baziChart.dayPillar.stem}${baziChart.dayPillar.branch} (วัน)${baziChart.hourPillar ? `, ${baziChart.hourPillar.stem}${baziChart.hourPillar.branch} (ชั่วโมง)` : ""}
${todayBaziSection}
โหราศาสตร์ไทย — ดวงชะตาแต่กำเนิด (วันเกิดของเจ้า):
- วันเกิด: ${natalThaiAstrology.day}
- ดาวประจำตัว: ${natalThaiAstrology.planet}
- บุคลิกภาพ: ${natalThaiAstrology.personality}

โหราศาสตร์ไทย — พลังของวันนี้ (${todayStr}):
- วันนี้: ${daily.day}
- ดาวแห่งวันนี้: ${daily.planet}
${mbtiContext}

คำสั่ง:
เขียนคำทำนายประจำวันแบบเต็มในรูปแบบ JSON ที่มีโครงสร้างดังนี้:
${scoreGuidance}

1. dailyTheme: ธีมหลักของวันนี้ 1 วลีสั้น (เช่น "วันแห่งการสื่อสาร", "วันระวังการเงิน")${dailyContext ? ` — อ้างอิงจาก: ${dailyContext.dailyTheme.theme}` : ''}

2. overallScore: คะแนนรวมของวันนี้ 1-5 (integer) — สะท้อนความสัมพันธ์ธาตุและดวงโดยรวม

3. overallReading: คำทำนายภาพรวมวันนี้ 4-6 ประโยค วิเคราะห์ดวงของวันนี้จากมุมมองทั้งสองระบบ บอกว่าวันนี้เหมาะกับการทำอะไร${mbtiType ? ` ผสมผสานลักษณะบุคลิกภาพของเจ้าเข้ากับดวงชะตาวันนี้อย่างกลมกลืน` : ''}${dailyContext ? ` — ต้องกล่าวถึงความสัมพันธ์ธาตุ (${dailyContext.elementHarmony.description})` : ''}

4. categories: 4 หมวด ได้แก่:
   a. career (การงาน & อาชีพ): reading 2-3 ประโยค, score 1-5, tip คำแนะนำสั้น 1 ประโยค${mbtiType ? ` (ปรับคำแนะนำให้เหมาะกับรูปแบบการทำงานของบุคลิกภาพเจ้า)` : ''}
   b. love (ความรัก & ความสัมพันธ์): reading 2-3 ประโยค, score 1-5, tip คำแนะนำสั้น 1 ประโยค${mbtiType ? ` (ปรับให้เหมาะกับรูปแบบความสัมพันธ์ของเจ้า)` : ''}
   c. finance (การเงิน & โชคลาภ): reading 2-3 ประโยค, score 1-5, tip คำแนะนำสั้น 1 ประโยค${mbtiType ? ` (ปรับให้เหมาะกับรูปแบบการตัดสินใจทางการเงินของเจ้า)` : ''}
   d. health (สุขภาพ & พลังงาน): reading 2-3 ประโยค, score 1-5, tip คำแนะนำสั้น 1 ประโยค${mbtiType ? ` (ปรับให้เหมาะกับจุดอ่อนด้านสุขภาพตามบุคลิกภาพ)` : ''}

5. luckyNumbers: เลขมงคล 3 เลข (array of numbers) — ต้องเป็นเลขที่เกี่ยวข้องกับดวงชะตาของเจ้าโดยเฉพาะ${dailyContext ? ` พิจารณาจาก:
   - เสาวันนี้ ${dailyContext.todayPillar.stemChinese}${dailyContext.todayPillar.branchChinese}
   - ธาตุของเจ้า (${dailyContext.elementHarmony.userElement}) และธาตุวันนี้ (${dailyContext.elementHarmony.todayElement})
   - ห้ามใช้เลขทั่วไปเหมือนกันทุกคน` : ''}

6. luckyColor: สีมงคลสำหรับเจ้าวันนี้ 1 สี (ภาษาไทย) — ต้องเป็นสีที่เสริมธาตุของเจ้า${dailyContext ? `:
   - ธาตุ${dailyContext.elementHarmony.userElement === 'wood' ? 'ไม้: เขียว, น้ำเงิน, ดำ' : dailyContext.elementHarmony.userElement === 'fire' ? 'ไฟ: แดง, ส้ม, ชมพู, เขียว' : dailyContext.elementHarmony.userElement === 'earth' ? 'ดิน: เหลือง, น้ำตาล, แดง, ส้ม' : dailyContext.elementHarmony.userElement === 'metal' ? 'ทอง: ขาว, ทอง, เงิน, เหลือง' : 'น้ำ: ดำ, น้ำเงิน, ขาว, เงิน'}
   - พิจารณาความสัมพันธ์ธาตุวันนี้ด้วย` : ' ที่เสริมธาตุของเจ้า'}

7. luckyDirection: ทิศมงคลสำหรับเจ้าวันนี้ (เช่น "ทิศตะวันออก", "ทิศใต้") — พิจารณาจากธาตุของเจ้าและธาตุวันนี้

8. luckyMoment: ช่วงเวลามงคลของวันนี้ (เช่น "ช่วงเช้า 06.00-09.00 น.") — พิจารณาจากธาตุและดวงชะตา

9. warnings: 2-3 คำเตือนสำหรับวันนี้ สิ่งที่เจ้าต้องระวังเป็นพิเศษ อ้างอิงจากดวงชะตา${dailyContext?.branchClash.hasClash ? ` — ต้องรวมคำเตือนเรื่องการปะทะนักษัตร: ${dailyContext.branchClash.warning}` : ''}${mbtiType ? ` และจุดอ่อนของบุคลิกภาพเจ้า เช่น ถ้าเจ้ามักคิดมาก ให้เตือนเรื่องนี้เชื่อมกับดวงวันนี้` : ''}

10. suggestions: 3-4 คำแนะนำที่ปฏิบัติได้จริงสำหรับวันนี้ เจาะจงและเป็นรูปธรรม${mbtiType ? ` ปรับให้เหมาะกับบุคลิกภาพและจุดแข็งของเจ้า เช่น:
   - ถ้าเจ้าชอบวิเคราะห์ (T): แนะนำให้ใช้ทักษะวิเคราะห์ในจังหวะที่ดวงเสริม
   - ถ้าเจ้าชอบสังคม (E): แนะนำกิจกรรมเจอคนในช่วงเวลามงคล
   - ถ้าเจ้าเก็บตัว (I): แนะนำวิธีเสริมดวงที่เหมาะกับคนเก็บตัว
   - ให้คำแนะนำที่เจ้าทำได้จริงในชีวิตประจำวัน` : ' อ้างอิงจากดวงชะตาและธาตุของเจ้า'}

11. dos: 3 สิ่งที่ควรทำวันนี้ (เจาะจง อ้างอิงข้อมูลดวง)
12. donts: 3 สิ่งที่ควรหลีกเลี่ยงวันนี้ (เจาะจง)

กฎสำคัญ:
- เขียนทุกอย่างเป็นภาษาไทยเท่านั้น
- ใช้คำสรรพนาม "เจ้า" เรียกผู้อ่าน ห้ามใช้ "คุณ"
- ภาษาลึกลับแต่กระชับ เข้าใจง่าย
- ห้ามใช้อิโมจิ
- ห้ามกล่าวถึง AI โมเดล หรือเทคโนโลยี
- ผสมผสานข้อมูลจากทั้งสองระบบเข้าด้วยกัน
- ต้องอ้างอิงธาตุ เสา และดาวของเจ้าในคำทำนาย
- สำคัญมาก: ห้ามแปลหรือเปลี่ยนชื่อ "${name}" ต้องใช้ชื่อนี้ตามที่ให้มาเท่านั้น${mbtiType ? `

## กฎสำหรับการใช้ข้อมูล MBTI:

1. ห้ามแยกหัวข้อ MBTI ออกมาต่างหาก ต้องผสมผสานเข้ากับคำทำนายธาตุและดาวอย่างกลมกลืน
2. ทำให้คำแนะนำเป็นรูปธรรม ไม่ใช่แค่บอกว่า "เจ้าเป็น ${mbtiType}" แต่ต้องให้คำแนะนำที่ปฏิบัติได้จริง
3. ในส่วน warnings: ต้องรวมคำเตือนเฉพาะบุคลิกภาพของเจ้าที่เชื่อมกับดวงวันนี้
4. ในส่วน suggestions: ต้องให้คำแนะนำที่เหมาะกับจุดแข็งและจุดอ่อนของบุคลิกภาพเจ้า
5. สำคัญที่สุด: ทำให้เจ้ารู้สึกว่าคำทำนายนี้เขียนเพื่อเจ้าโดยเฉพาะ` : ''}

ตอบเป็น JSON เท่านั้น ไม่ต้องใส่ markdown code block:`;
}
