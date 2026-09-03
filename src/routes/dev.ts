import { Elysia } from 'elysia';
import { auth } from '../lib/auth';
import { config } from '../config';

// Dev-only login bypass. Mounted from index.ts only when NODE_ENV !== 'production'
// (and double-guarded here). Visit http://localhost:3001/api/dev/login in the
// browser: it signs in a fixed local dev user (creating it on first use via
// better-auth's email/password flow), sets the session cookie, and redirects to
// the frontend. First visit lands on the birth-profile setup like a real new user.
const DEV_EMAIL = 'dev@saimu.local';
const DEV_PASSWORD = 'saimu-dev-only-4242';
const DEV_NAME = 'Dev หมอดู';

export const devRoutes = new Elysia({ prefix: '/api/dev' }).get('/login', async () => {
  if (config.env === 'production') {
    return new Response('Not found', { status: 404 });
  }

  const frontend = config.cors.allowedOrigins[0] ?? 'http://localhost:3000';

  const signIn = () =>
    auth.api.signInEmail({
      body: { email: DEV_EMAIL, password: DEV_PASSWORD },
      returnHeaders: true,
    });

  let result;
  try {
    result = await signIn();
  } catch {
    await auth.api.signUpEmail({
      body: { email: DEV_EMAIL, password: DEV_PASSWORD, name: DEV_NAME },
    });
    result = await signIn();
  }

  const headers = new Headers(result.headers);
  headers.set('Location', `${frontend}/dashboard`);
  return new Response(null, { status: 302, headers });
});
