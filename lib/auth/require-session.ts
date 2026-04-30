import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth, type AuthSession } from './server';

// Phase 11 — Server-component / server-action guard.
//
// Use cases (read top-down for which fits):
//   1. Server component or server action that REQUIRES a user → requireSession()
//      Throws a Next redirect to /login if the cookie is missing or expired.
//   2. Server component that adapts UX based on session presence but is
//      otherwise public → getOptionalSession()
//
// Both functions read the request `cookies` via Next 15's async `headers()`
// helper. They are intentionally NOT cached: Better Auth's getSession is
// already memoized within a request via its own internal cache.

export async function requireSession(): Promise<AuthSession> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/login');
  return session;
}

export async function getOptionalSession(): Promise<AuthSession | null> {
  return auth.api.getSession({ headers: await headers() });
}
