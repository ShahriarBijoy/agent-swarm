import { describe, expect, it, vi, beforeEach } from 'vitest';
import { signSseToken } from '@/lib/auth/sse-token';

// Phase 11 — Auth gate for /api/tasks/[id]/stream.
//
// We don't drive a full polling loop here — that's covered by the existing
// integration tests for the stream route. This file just verifies that bad
// tokens get a 401 before any DB work happens. We mock task-api so we can
// catch whether the route ever tried to read events.

const getEventsSinceMock = vi.fn();
const getTaskByIdMock = vi.fn();

vi.mock('@/db/queries/task-api', () => ({
  getEventsSince: (args: unknown) => getEventsSinceMock(args),
  getTaskById: (id: string) => getTaskByIdMock(id),
}));

import { GET } from '@/app/api/tasks/[id]/stream/route';

const TASK_ID = '00000000-0000-0000-0000-000000000000';
const OTHER_TASK_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = 'user-1';

function fakeReq(url: string): Request {
  return new Request(url, { method: 'GET' });
}

describe('GET /api/tasks/[id]/stream — auth gate', () => {
  beforeEach(() => {
    getEventsSinceMock.mockReset();
    getTaskByIdMock.mockReset();
  });

  it('401s when no token query param', async () => {
    const res = await GET(
      fakeReq(`http://localhost/api/tasks/${TASK_ID}/stream`),
      { params: Promise.resolve({ id: TASK_ID }) },
    );
    expect(res.status).toBe(401);
    expect(getEventsSinceMock).not.toHaveBeenCalled();
    expect(getTaskByIdMock).not.toHaveBeenCalled();
  });

  it('401s when token is bogus', async () => {
    const res = await GET(
      fakeReq(`http://localhost/api/tasks/${TASK_ID}/stream?token=BOGUS`),
      { params: Promise.resolve({ id: TASK_ID }) },
    );
    expect(res.status).toBe(401);
  });

  it('401s when token was minted for a different task', async () => {
    const otherToken = signSseToken({
      taskId: OTHER_TASK_ID,
      userId: USER_ID,
    });
    const res = await GET(
      fakeReq(
        `http://localhost/api/tasks/${TASK_ID}/stream?token=${encodeURIComponent(
          otherToken,
        )}`,
      ),
      { params: Promise.resolve({ id: TASK_ID }) },
    );
    expect(res.status).toBe(401);
  });

  it('401s when token expired', async () => {
    const expired = signSseToken({
      taskId: TASK_ID,
      userId: USER_ID,
      ttlSec: 1,
      now: Date.now() - 60_000, // minted a minute ago, ttl 1s
    });
    const res = await GET(
      fakeReq(
        `http://localhost/api/tasks/${TASK_ID}/stream?token=${encodeURIComponent(
          expired,
        )}`,
      ),
      { params: Promise.resolve({ id: TASK_ID }) },
    );
    expect(res.status).toBe(401);
  });

  it('opens the stream (200 + text/event-stream) with a valid token', async () => {
    // Make the polling loop terminate quickly: report a terminal task with
    // no events so the route closes after one iteration.
    getEventsSinceMock.mockResolvedValue([]);
    getTaskByIdMock.mockResolvedValue({ id: TASK_ID, status: 'done' });

    const token = signSseToken({ taskId: TASK_ID, userId: USER_ID });
    const res = await GET(
      fakeReq(
        `http://localhost/api/tasks/${TASK_ID}/stream?token=${encodeURIComponent(
          token,
        )}`,
      ),
      { params: Promise.resolve({ id: TASK_ID }) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/text\/event-stream/);
    // Drain the stream so the test doesn't leak the underlying poll loop.
    if (res.body) await res.body.cancel();
  });
});
