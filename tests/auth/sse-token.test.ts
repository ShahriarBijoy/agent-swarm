import { describe, expect, it } from 'vitest';
import { signSseToken, verifySseToken } from '@/lib/auth/sse-token';

// Phase 11 — Verify the hand-rolled HMAC token (no JWT lib).
// All tests pin `now` so they don't drift across machines.

const T0 = 1_700_000_000_000; // arbitrary fixed millis
const TASK = 'task-abc';
const USER = 'user-xyz';

describe('signSseToken / verifySseToken', () => {
  it('round-trips a freshly minted token', () => {
    const token = signSseToken({ taskId: TASK, userId: USER, now: T0 });
    const claims = verifySseToken(token, { taskId: TASK, now: T0 });
    expect(claims).toEqual({ userId: USER });
  });

  it('rejects when token is null / empty', () => {
    expect(verifySseToken(null, { taskId: TASK, now: T0 })).toBeNull();
    expect(verifySseToken('', { taskId: TASK, now: T0 })).toBeNull();
    expect(verifySseToken(undefined, { taskId: TASK, now: T0 })).toBeNull();
  });

  it('rejects when payload is tampered', () => {
    const token = signSseToken({ taskId: TASK, userId: USER, now: T0 });
    // Decode payload, swap user id, re-encode (sig stays the same — should fail).
    const [p64, sig] = token.split('.');
    const payload = JSON.parse(Buffer.from(p64!, 'base64url').toString());
    payload.uid = 'attacker';
    const tampered = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`;
    expect(verifySseToken(tampered, { taskId: TASK, now: T0 })).toBeNull();
  });

  it('rejects when signature is tampered', () => {
    const token = signSseToken({ taskId: TASK, userId: USER, now: T0 });
    const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    expect(verifySseToken(flipped, { taskId: TASK, now: T0 })).toBeNull();
  });

  it('rejects when bound to a different taskId', () => {
    const token = signSseToken({ taskId: TASK, userId: USER, now: T0 });
    expect(
      verifySseToken(token, { taskId: 'other-task', now: T0 }),
    ).toBeNull();
  });

  it('rejects when expired beyond skew', () => {
    const token = signSseToken({
      taskId: TASK,
      userId: USER,
      ttlSec: 60,
      now: T0,
    });
    // 60s + 5s skew = 65s window; advance 70s.
    const later = T0 + 70_000;
    expect(verifySseToken(token, { taskId: TASK, now: later })).toBeNull();
  });

  it('accepts inside skew tolerance', () => {
    const token = signSseToken({
      taskId: TASK,
      userId: USER,
      ttlSec: 60,
      now: T0,
    });
    // Just past expiry (62s) but within 5s skew.
    const later = T0 + 62_000;
    const claims = verifySseToken(token, { taskId: TASK, now: later });
    expect(claims).toEqual({ userId: USER });
  });

  it('rejects malformed token (no dot, only dot, etc.)', () => {
    for (const bad of ['abc', '.abc', 'abc.', '...']) {
      expect(verifySseToken(bad, { taskId: TASK, now: T0 })).toBeNull();
    }
  });
});
