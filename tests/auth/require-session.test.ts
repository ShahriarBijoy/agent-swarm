import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock next/navigation BEFORE importing require-session, otherwise the real
// `redirect` would try to throw the Next-internal NEXT_REDIRECT error which
// the test runner can't satisfy without a Next request scope.
const redirectMock = vi.fn((url: string) => {
  // Real Next redirect throws — replicate that so callers can't proceed.
  throw new Error(`__redirect__:${url}`);
});

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));

const getSessionMock = vi.fn();
vi.mock('@/lib/auth/server', () => ({
  auth: {
    api: {
      getSession: (args: unknown) => getSessionMock(args),
    },
  },
}));

import {
  requireSession,
  getOptionalSession,
} from '@/lib/auth/require-session';

describe('requireSession', () => {
  beforeEach(() => {
    redirectMock.mockClear();
    getSessionMock.mockReset();
  });

  it('redirects to /login when no session', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    await expect(requireSession()).rejects.toThrow('__redirect__:/login');
    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it('returns session object when present', async () => {
    const fakeSession = {
      session: { id: 's1', userId: 'u1', token: 't1' },
      user: { id: 'u1', email: 'a@b.c', name: 'A' },
    };
    getSessionMock.mockResolvedValueOnce(fakeSession);
    await expect(requireSession()).resolves.toEqual(fakeSession);
    expect(redirectMock).not.toHaveBeenCalled();
  });
});

describe('getOptionalSession', () => {
  beforeEach(() => {
    redirectMock.mockClear();
    getSessionMock.mockReset();
  });

  it('returns null when no session', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    await expect(getOptionalSession()).resolves.toBeNull();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('returns session when present', async () => {
    const fakeSession = { session: { id: 's' }, user: { id: 'u' } };
    getSessionMock.mockResolvedValueOnce(fakeSession);
    await expect(getOptionalSession()).resolves.toEqual(fakeSession);
  });
});
