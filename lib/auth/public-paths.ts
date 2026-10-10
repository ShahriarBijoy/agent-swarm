// Phase 11 — Routes that bypass the session-cookie redirect in middleware.ts.
//
// IMPORTANT: this is the ONLY allowlist. Anything matching here skips the
// redirect to /login. Two of the entries are not "public" in the unauth
// sense — they have their own auth mechanism:
//   - /api/inngest        : signed by Inngest's signing key (not a session)
//   - /api/tasks/[id]/stream : auth'd via ?token= HMAC, see lib/auth/sse-token.ts
//   - /api/tasks/[id]/agui   : phase 13 AG-UI stream, same ?token= HMAC
// They appear here only because the middleware can't 302 an Inngest webhook
// or an EventSource (EventSource won't follow redirects, so it would treat
// the 302 body as a stream parse error).
//
// Static assets and Next internals are excluded by the middleware matcher
// in middleware.ts (negative-lookahead on `/_next/`, favicon), so we don't
// need to list those here.

export const publicPaths: readonly RegExp[] = [
  /^\/health$/,
  /^\/login$/,
  /^\/register$/,
  /^\/api\/auth(\/.*)?$/, // Better Auth handler + sub-paths
  /^\/api\/inngest$/, // Inngest webhook (signed)
  /^\/api\/tasks\/[^/]+\/stream$/, // SSE — auth via ?token= query param
  /^\/api\/tasks\/[^/]+\/agui$/, // Phase 13 AG-UI SSE — same ?token= HMAC
];

export function isPublicPath(pathname: string): boolean {
  return publicPaths.some((re) => re.test(pathname));
}
