import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/db/client', () => ({
  ping: vi.fn(),
  checkExtension: vi.fn(),
}));

describe('GET /health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 and ok:true when db and vector are healthy', async () => {
    const client = await import('@/db/client');
    vi.mocked(client.ping).mockResolvedValue('up');
    vi.mocked(client.checkExtension).mockResolvedValue('installed');

    const { GET } = await import('../app/health/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      checks: { db: 'up', vector: 'installed' },
    });
    expect(body.version).toBeDefined();
    expect(body.ts).toBeDefined();
  });

  it('returns 503 and ok:false when db is down', async () => {
    const client = await import('@/db/client');
    vi.mocked(client.ping).mockResolvedValue('down');
    vi.mocked(client.checkExtension).mockResolvedValue('installed');

    const { GET } = await import('../app/health/route');
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.checks.db).toBe('down');
  });

  it('returns 503 when pgvector is missing', async () => {
    const client = await import('@/db/client');
    vi.mocked(client.ping).mockResolvedValue('up');
    vi.mocked(client.checkExtension).mockResolvedValue('missing');

    const { GET } = await import('../app/health/route');
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.checks.vector).toBe('missing');
  });
});
