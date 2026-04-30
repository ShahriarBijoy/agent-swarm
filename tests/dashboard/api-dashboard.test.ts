import { describe, expect, it, vi } from 'vitest';

// Phase 11 — /api/dashboard now session-gates before validating params.
// Mock auth.api.getSession so these tests still exercise the 400 branches
// they were written for; a separate test below covers the 401 path.
vi.mock('@/lib/auth/server', () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({
        user: { id: 'u', email: 'a@b.c' },
        session: { id: 's' },
      })),
    },
  },
}));

import { GET } from '@/app/api/dashboard/route';
import { auth } from '@/lib/auth/server';

describe('/api/dashboard', () => {
  it('returns 400 for missing widget param', async () => {
    const req = new Request('http://x/api/dashboard');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
  it('returns 400 for unknown widget id', async () => {
    const req = new Request('http://x/api/dashboard?widget=lol');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
  it('returns 401 when no session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValueOnce(
      null as unknown as Awaited<ReturnType<typeof auth.api.getSession>>,
    );
    const req = new Request('http://x/api/dashboard?widget=greeting');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });
});
