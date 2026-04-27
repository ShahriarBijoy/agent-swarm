import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/dashboard/route';

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
});
