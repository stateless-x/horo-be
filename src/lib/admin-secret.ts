import { timingSafeEqual } from 'crypto';
import { config } from '../config';

/**
 * horo-admin's proof on /internal/* routes: the shared ADMIN_API_SECRET in the
 * `x-admin-secret` header, compared in constant time so it cannot be guessed a
 * byte at a time. horo-admin checks the human's access before it calls.
 */
export function adminSecretMatches(provided: string | null | undefined): boolean {
  const expected = config.adminApi.secret;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
