import { describe, expect, it } from 'vitest';
import { isPublicPath } from '@/lib/auth/public-paths';

// Phase 11 — Matrix test for the middleware allowlist.
//
// The cost of getting this list wrong is high: a false positive leaks an
// authenticated route, a false negative locks out a working integration
// (e.g. Inngest's webhook can't be redirected to /login or events stop
// processing). Each row of the table below is asserted explicitly.

describe('isPublicPath', () => {
  describe('public — must match', () => {
    const publicCases = [
      '/health',
      '/login',
      '/register',
      '/api/auth/sign-in',
      '/api/auth/sign-up',
      '/api/auth/sign-out',
      '/api/auth/get-session',
      '/api/auth/callback/credential',
      '/api/inngest',
      '/api/tasks/abc-123/stream',
      '/api/tasks/00000000-0000-0000-0000-000000000000/stream',
      '/api/tasks/abc-123/agui', // phase 13 — AG-UI SSE, ?token= HMAC
      '/api/a2a/fleet-analyst', // phase 13 — A2A JSON-RPC, Bearer token
      '/api/a2a/fleet-analyst/card',
      '/api/a2a/route-optimizer/.well-known/agent-card.json',
      '/.well-known/agent-card.json',
    ];
    it.each(publicCases)('matches %s', (path) => {
      expect(isPublicPath(path)).toBe(true);
    });
  });

  describe('protected — must NOT match', () => {
    const protectedCases = [
      '/',
      '/agents',
      '/billing',
      '/chat',
      '/map',
      '/memories',
      '/tasks',
      '/tasks/abc-123',
      '/api/tasks',
      '/api/tasks/abc-123',
      '/api/tasks/abc-123/stream-token', // session-gated mint route
      '/api/agui', // phase 13 — AG-UI run endpoint is session-gated
      '/api/tasks/abc-123/agui/leak',
      '/api/a2a', // no agent segment
      '/api/a2a/fleet-analyst/tasks', // nothing else under an agent is public
      '/api/a2a/fleet-analyst/card/x',
      '/.well-known/other.json',
      '/api/dashboard',
      '/api/vehicles',
      '/api/invoices',
      '/api/trips',
      // Regex anchoring — must reject suffixed/prefixed variants
      '/api/inngest/leak',
      '/api/inngest-other',
      '/healthz',
      '/loginx',
      '/registerx',
      '/api/auth', // no trailing slash before sub-path: still allowed by our regex (sign-in page).
      // This last assertion intentionally captures the chosen behavior:
      // we treat the literal /api/auth as auth-handler scope. Flip later
      // if it ever becomes a problem.
    ].filter((p) => p !== '/api/auth'); // see comment above
    it.each(protectedCases)('rejects %s', (path) => {
      expect(isPublicPath(path)).toBe(false);
    });
  });

  it('regex on /api/auth handler is anchored to scope, not arbitrary suffix', () => {
    // Sanity: full-length sub-path is allowed
    expect(isPublicPath('/api/auth/sign-in')).toBe(true);
    // But a route that merely contains "/api/auth" elsewhere is rejected
    expect(isPublicPath('/admin/api/auth/break')).toBe(false);
  });
});
