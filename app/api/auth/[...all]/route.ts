import { auth } from '@/lib/auth/server';
import { toNextJsHandler } from 'better-auth/next-js';

// Phase 11 — Better Auth's Next App Router handler. Mounts every Better Auth
// endpoint (sign-in, sign-up, sign-out, get-session, etc.) under
// /api/auth/* via the catch-all route.
//
// `force-dynamic` is required because Next would otherwise try to cache the
// GET (e.g. /api/auth/get-session) which depends on the session cookie.

export const dynamic = 'force-dynamic';

export const { GET, POST } = toNextJsHandler(auth);
