import { describe, expect, it, vi, beforeEach } from 'vitest';

// Phase 11 — POST /api/tasks must reject unauthenticated callers and use
// session.user.email as the customer identity (overwriting the body field).
//
// We mock the four collaborators (auth, db, createQueuedTask, startTask) so
// the test exercises only the route handler's auth + identity-derivation
// logic.

const getSessionMock = vi.fn();
const dbSelectFromWhereMock = vi.fn();
const dbInsertValuesMock = vi.fn();
const dbUpdateSetWhereMock = vi.fn();
const createQueuedTaskMock = vi.fn();
const startTaskMock = vi.fn();
const finalizeTaskMock = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  auth: {
    api: {
      getSession: (args: unknown) => getSessionMock(args),
    },
  },
}));

vi.mock('@/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (...args: unknown[]) => dbSelectFromWhereMock(...args),
      }),
    }),
    insert: () => ({
      values: (...args: unknown[]) => dbInsertValuesMock(...args),
    }),
    update: () => ({
      set: (vals: unknown) => ({
        where: (cond: unknown) => dbUpdateSetWhereMock(vals, cond),
      }),
    }),
  },
}));

vi.mock('@/db/queries/task-api', () => ({
  createQueuedTask: (args: unknown) => createQueuedTaskMock(args),
}));

vi.mock('@/db/queries/task-runtime', () => ({
  finalizeTask: (args: unknown) => finalizeTaskMock(args),
}));

vi.mock('@/lib/runner/start-task', () => ({
  startTask: (args: unknown) => startTaskMock(args),
}));

import { POST } from '@/app/api/tasks/route';

function jsonReq(body: unknown): Request {
  return new Request('http://localhost/api/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  getSessionMock.mockReset();
  dbSelectFromWhereMock.mockReset();
  dbInsertValuesMock.mockReset();
  dbUpdateSetWhereMock.mockReset();
  createQueuedTaskMock.mockReset();
  startTaskMock.mockReset();
  finalizeTaskMock.mockReset();
});

describe('POST /api/tasks — auth gate', () => {
  it('401s when no session', async () => {
    getSessionMock.mockResolvedValueOnce(null);
    const res = await POST(jsonReq({ kind: 'default', prompt: 'hi' }));
    expect(res.status).toBe(401);
    expect(createQueuedTaskMock).not.toHaveBeenCalled();
  });

  it('overrides body customer_email with session.user.email on scenario', async () => {
    getSessionMock.mockResolvedValueOnce({
      user: { id: 'u-1', email: 'real@op.io', name: 'Real Op' },
      session: { id: 's-1' },
    });
    // No existing customer → insert path.
    dbSelectFromWhereMock.mockResolvedValueOnce([]);
    dbInsertValuesMock.mockResolvedValueOnce(undefined);
    createQueuedTaskMock.mockResolvedValueOnce({
      id: 'task-1',
      createdAt: new Date(),
    });
    startTaskMock.mockResolvedValueOnce(undefined);

    const res = await POST(
      jsonReq({
        kind: 'scenario',
        prompt: 'rent something',
        // Attacker sets a different email — should be ignored.
        customer_email: 'attacker@evil.io',
      }),
    );

    expect(res.status).toBe(200);
    // Insert ran with the SESSION email, not the body's.
    expect(dbInsertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'real@op.io',
        userId: 'u-1',
      }),
    );
    // The prompt prefix uses the session email too.
    expect(createQueuedTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('customer_email=real@op.io'),
      }),
    );
  });

  it('lazy-links existing unlinked customer to the session user', async () => {
    getSessionMock.mockResolvedValueOnce({
      user: { id: 'u-2', email: 'existing@op.io', name: 'Existing' },
      session: { id: 's-2' },
    });
    // Existing customer with no userId.
    dbSelectFromWhereMock.mockResolvedValueOnce([
      { id: 'c-1', email: 'existing@op.io', userId: null },
    ]);
    dbUpdateSetWhereMock.mockResolvedValueOnce(undefined);
    createQueuedTaskMock.mockResolvedValueOnce({
      id: 'task-2',
      createdAt: new Date(),
    });
    startTaskMock.mockResolvedValueOnce(undefined);

    const res = await POST(
      jsonReq({ kind: 'scenario', prompt: 'check trip' }),
    );

    expect(res.status).toBe(200);
    expect(dbInsertValuesMock).not.toHaveBeenCalled();
    expect(dbUpdateSetWhereMock).toHaveBeenCalledWith(
      { userId: 'u-2' },
      expect.anything(),
    );
  });
});
