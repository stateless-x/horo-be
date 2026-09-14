import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { user } from '../../lib/db/schema';
import { verifyUnsubscribeToken } from '../lib/email';

/**
 * One-click unsubscribe for campaign email.
 *
 * Deliberately unauthenticated: someone opting out of mail must not be forced
 * to log in first. The HMAC in the token is the authorisation — it proves the
 * link came from an email we sent, so a recipient cannot opt out anyone else
 * by editing the id in the URL.
 *
 * Both verbs exist and do the same thing:
 *   GET  — the recipient clicked the link in the footer.
 *   POST — RFC 8058 one-click, fired by Gmail/Outlook's own Unsubscribe
 *          button. Without this, those clients hide the native control and
 *          more people reach for "Report spam" instead, which is what
 *          actually damages sending reputation.
 *
 * Sets user.emailOptOut, which scripts/send-campaign.ts excludes. It does not
 * affect transactional mail (login, password reset).
 */

const page = (title: string, message: string) => `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="font-family:-apple-system,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#faf9f7;color:#222">
  <div style="max-width:420px;padding:32px;text-align:center">
    <h1 style="font-size:20px;margin:0 0 12px">${title}</h1>
    <p style="font-size:15px;line-height:1.7;color:#555;margin:0">${message}</p>
  </div>
</body></html>`;

// `set` is Elysia's context setter; its `headers` type is Elysia-internal
// (HTTPHeaders allows string[] for set-cookie), so it is inferred from the
// handler rather than hand-declared.
async function optOut(token: string, set: { status?: number | string; headers: Record<string, any> }) {
  set.headers['Content-Type'] = 'text/html; charset=utf-8';

  const userId = verifyUnsubscribeToken(token);
  if (!userId) {
    set.status = 400;
    return page('ลิงก์ไม่ถูกต้อง', 'ลิงก์ยกเลิกการรับอีเมลนี้ไม่ถูกต้องหรือหมดอายุแล้ว หากต้องการยกเลิก ตอบกลับอีเมลได้เลยครับ');
  }

  await db.update(user).set({ emailOptOut: true }).where(eq(user.id, userId));

  return page(
    'ยกเลิกการรับอีเมลแล้ว',
    'เราจะไม่ส่งอีเมลแนะนำฟีเจอร์ถึงคุณอีก ขอบคุณที่เคยแวะมาใช้งานสายมู.com นะครับ (シ_ _)シ',
  );
}

export const unsubscribeRoutes = new Elysia({ prefix: '/email' })
  .get('/unsubscribe/:token', ({ params, set }) => optOut(params.token, set))
  .post('/unsubscribe/:token', ({ params, set }) => optOut(params.token, set));
