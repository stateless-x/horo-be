/**
 * LLM Prompt for Today's Daily Reading
 *
 * Dedicated prompt for /dashboard/today - a focused daily fortune
 * with MBTI integration, lucky attributes, warnings, and suggestions.
 *
 * Uses the same mystical Thai narrator voice as all other prompts.
 */

import type { BaziChart, ThaiAstrology } from "../../../lib/shared";
import { buildMbtiContext } from "../prompts";

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
 */
export function buildTodayPrompt(
  name: string,
  birthDate: Date,
  today: Date,
  baziChart: BaziChart,
  natalThaiAstrology: ThaiAstrology,
  mbtiType?: string | null,
  todayThaiAstrology?: ThaiAstrology,
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

  return `ข้อมูลผู้ขอดวง:
ชื่อ: ${name}
วันเกิด: ${birthDateStr}
วันที่ดูดวง: ${todayStr}

โหราศาสตร์จีน (Bazi) — ดวงชะตาแต่กำเนิด:
- องค์ประกอบหลัก: ${baziChart.element}
- เจ้าวัน: ${baziChart.dayMaster}
- เสาสี่ที่: ${baziChart.yearPillar.stem}${baziChart.yearPillar.branch} (ปี), ${baziChart.monthPillar.stem}${baziChart.monthPillar.branch} (เดือน), ${baziChart.dayPillar.stem}${baziChart.dayPillar.branch} (วัน)${baziChart.hourPillar ? `, ${baziChart.hourPillar.stem}${baziChart.hourPillar.branch} (ชั่วโมง)` : ""}

โหราศาสตร์ไทย — ดวงชะตาแต่กำเนิด (วันเกิดของเจ้า):
- วันเกิด: ${natalThaiAstrology.day}
- ดาวประจำตัว: ${natalThaiAstrology.planet}
- บุคลิกภาพ: ${natalThaiAstrology.personality}

โหราศาสตร์ไทย — พลังของวันนี้ (${todayStr}):
- วันนี้: ${daily.day}
- ดาวแห่งวันนี้: ${daily.planet}
- สีมงคลของวันนี้: ${daily.color}
- ทิศมงคลของวันนี้: ${daily.luckyDirection}
- เลขมงคลของวันนี้: ${daily.luckyNumber}
${mbtiContext}

คำสั่ง:
เขียนคำทำนายประจำวันแบบเต็มในรูปแบบ JSON ที่มีโครงสร้างดังนี้:

1. overallReading: คำทำนายภาพรวมวันนี้ 4-6 ประโยค วิเคราะห์ดวงของวันนี้จากมุมมองทั้งสองระบบ บอกว่าวันนี้เหมาะกับการทำอะไร${mbtiType ? ` ผสมผสานลักษณะบุคลิกภาพของเจ้าเข้ากับดวงชะตาวันนี้อย่างกลมกลืน` : ''}

2. categories: 4 หมวด ได้แก่:
   a. career (การงาน & อาชีพ): reading 2-3 ประโยค, score 1-5, tip คำแนะนำสั้น 1 ประโยค${mbtiType ? ` (ปรับคำแนะนำให้เหมาะกับรูปแบบการทำงานของบุคลิกภาพเจ้า)` : ''}
   b. love (ความรัก & ความสัมพันธ์): reading 2-3 ประโยค, score 1-5, tip คำแนะนำสั้น 1 ประโยค${mbtiType ? ` (ปรับให้เหมาะกับรูปแบบความสัมพันธ์ของเจ้า)` : ''}
   c. finance (การเงิน & โชคลาภ): reading 2-3 ประโยค, score 1-5, tip คำแนะนำสั้น 1 ประโยค${mbtiType ? ` (ปรับให้เหมาะกับรูปแบบการตัดสินใจทางการเงินของเจ้า)` : ''}
   d. health (สุขภาพ & พลังงาน): reading 2-3 ประโยค, score 1-5, tip คำแนะนำสั้น 1 ประโยค${mbtiType ? ` (ปรับให้เหมาะกับจุดอ่อนด้านสุขภาพตามบุคลิกภาพ)` : ''}

3. luckyNumbers: เลขมงคลประจำวันนี้ 3 เลข (array of numbers) ที่เกี่ยวข้องกับดวงชะตาของเจ้า

4. luckyColor: สีมงคลประจำวันนี้ 1 สี (ภาษาไทย) ที่เจ้าควรใส่หรือพกติดตัว

5. luckyMoment: ช่วงเวลามงคลของวันนี้ (เช่น "ช่วงเช้า 06.00-09.00 น.")

6. warnings: 2-3 คำเตือนสำหรับวันนี้ สิ่งที่เจ้าต้องระวังเป็นพิเศษ อ้างอิงจากดวงชะตา${mbtiType ? ` และจุดอ่อนของบุคลิกภาพเจ้า เช่น ถ้าเจ้ามักคิดมาก ให้เตือนเรื่องนี้เชื่อมกับดวงวันนี้` : ''}

7. suggestions: 3-4 คำแนะนำที่ปฏิบัติได้จริงสำหรับวันนี้ เจาะจงและเป็นรูปธรรม${mbtiType ? ` ปรับให้เหมาะกับบุคลิกภาพและจุดแข็งของเจ้า เช่น:
   - ถ้าเจ้าชอบวิเคราะห์ (T): แนะนำให้ใช้ทักษะวิเคราะห์ในจังหวะที่ดวงเสริม
   - ถ้าเจ้าชอบสังคม (E): แนะนำกิจกรรมเจอคนในช่วงเวลามงคล
   - ถ้าเจ้าเก็บตัว (I): แนะนำวิธีเสริมดวงที่เหมาะกับคนเก็บตัว
   - ให้คำแนะนำที่เจ้าทำได้จริงในชีวิตประจำวัน` : ' อ้างอิงจากดวงชะตาและธาตุของเจ้า'}

8. dos: 3 สิ่งที่ควรทำวันนี้ (เจาะจง อ้างอิงข้อมูลดวง)
9. donts: 3 สิ่งที่ควรหลีกเลี่ยงวันนี้ (เจาะจง)

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
