import { auth } from './auth';

/**
 * Session Validation Helper
 *
 * Uses Better Auth's built-in session validation API
 * instead of manually querying the database.
 */

export interface ValidatedSession {
  userId: string;
  expiresAt: Date;
}

/**
 * Validate session from request using Better Auth's API
 *
 * This is the recommended approach as Better Auth handles:
 * - Cookie parsing
 * - Session token validation
 * - Expiration checking
 * - Cookie cache validation
 *
 * Returns user ID if session is valid, null otherwise
 */
export async function validateSessionFromRequest(request: Request): Promise<ValidatedSession | null> {
  try {
    // Convert Request headers to Headers object for Better Auth
    const headers = new Headers(request.headers);

    // Log cookie header for debugging
    const cookieHeader = headers.get('cookie');
    console.log('[Session] Cookie header present:', !!cookieHeader);
    if (cookieHeader) {
      // Log cookie names (not values for security)
      const cookieNames = cookieHeader.split(';').map(c => c.trim().split('=')[0]);
      console.log('[Session] Cookie names:', cookieNames);
    }

    // Use Better Auth's built-in session validation
    // Returns { user: {...}, session: {...} } or null
    const result = await auth.api.getSession({
      headers,
    });

    console.log('[Session] Better Auth result:', {
      hasResult: !!result,
      hasUser: !!result?.user,
      hasSession: !!result?.session,
      userId: result?.user?.id,
    });

    // Better Auth returns null or undefined if session is invalid
    if (!result || !result.user || !result.session) {
      console.log('[Session] No valid session found');
      return null;
    }

    // Better Auth's session structure: { user: {...}, session: {...} }
    console.log('[Session] Validated user:', result.user.id);
    return {
      userId: result.user.id,
      expiresAt: result.session.expiresAt,
    };
  } catch (error) {
    console.error('[Session] Validation error:', error);
    return null;
  }
}
