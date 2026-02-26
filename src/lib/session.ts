import { db } from './db';
import { session } from '../../lib/db/schema';
import { eq, and, gt } from 'drizzle-orm';

/**
 * Session Validation Helper
 *
 * Provides utilities for validating Better Auth sessions
 * and extracting user IDs from session tokens.
 */

export interface ValidatedSession {
  userId: string;
  expiresAt: Date;
}

/**
 * Extract session token from cookie header
 */
export function extractSessionToken(cookieHeader: string): string | null {
  const sessionToken = cookieHeader
    .split(';')
    .find(cookie => cookie.trim().startsWith('better-auth.session_token='))
    ?.split('=')[1];

  return sessionToken || null;
}

/**
 * Validate session token and get user ID
 * Returns null if session is invalid or expired
 */
export async function validateSession(sessionToken: string): Promise<ValidatedSession | null> {
  try {
    const [sessionRecord] = await db
      .select({
        userId: session.userId,
        expiresAt: session.expiresAt,
      })
      .from(session)
      .where(
        and(
          eq(session.id, sessionToken),
          gt(session.expiresAt, new Date()) // Check if session is not expired
        )
      )
      .limit(1);

    if (!sessionRecord) {
      return null;
    }

    return {
      userId: sessionRecord.userId,
      expiresAt: sessionRecord.expiresAt,
    };
  } catch (error) {
    console.error('[Session] Validation error:', error);
    return null;
  }
}

/**
 * Validate session from request headers
 * Convenience function that extracts and validates in one step
 */
export async function validateSessionFromRequest(request: Request): Promise<ValidatedSession | null> {
  const cookieHeader = request.headers.get('cookie') || '';
  const sessionToken = extractSessionToken(cookieHeader);

  if (!sessionToken) {
    return null;
  }

  return validateSession(sessionToken);
}
