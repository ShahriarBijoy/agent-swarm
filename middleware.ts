import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { isPublicPath } from '@/lib/auth/public-paths';

// Phase 11 — Root middleware. Redirects unauthenticated visitors to /login
// for any non-public path.
//
// We deliberately do NOT call `auth.api.getSession()` here. Next middleware
// runs on the Edge runtime, which can't load the Neon Postgres driver.
// Instead we check for the *presence* of a Better Auth session cookie via
// `getSessionCookie()` (which knows about the `better-auth.session_token`
// + `__Secure-` variants and dot/dash separators).
//
// Cookie-presence is a coarse gate: a stale or expired cookie still passes
// here. The (dashboard) layout calls `requireSession()` per-render, which
// hits the database and re-redirects to /login if the cookie's session row
// is gone. That's the real auth boundary.

export function middleware(req: NextRequest) {
  if (isPublicPath(req.nextUrl.pathname)) return NextResponse.next();

  const sessionToken = getSessionCookie(req);
  if (!sessionToken) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(
      req.nextUrl.pathname + req.nextUrl.search,
    )}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// Skip Next internals and static assets — they don't need session checks
// and the cookie-parse cost is non-trivial on every chunk request.
export const config = {
  matcher: ['/((?!_next/|favicon\\.ico).*)'],
};
