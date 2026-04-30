import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

// Phase 11 — Short-lived HMAC token for `EventSource` requests.
//
// `EventSource` is a GET-only API that cannot send custom headers and won't
// follow redirects, so the SSE stream route can't reuse the Better Auth
// session cookie the way the rest of the app does. Instead, when the page
// server-renders, we mint a token bound to the (taskId, userId, exp) tuple
// and the client appends it as `?token=` on the EventSource URL. The route
// handler verifies via `verifySseToken` before opening the stream.
//
// Threat model: a leaked token grants read-only access to that one task's
// SSE for ≤ 60 s + 5 s clock skew. It cannot post events, approve gates, or
// read other tasks (taskId is in the signed payload).

const DEFAULT_TTL_SEC = 60;
const DEFAULT_SKEW_SEC = 5;

type Claims = {
  /** task id this token is bound to */
  tid: string;
  /** user id that minted it (audit-only) */
  uid: string;
  /** unix-seconds expiry */
  exp: number;
};

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function fromB64url(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

function hmac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signSseToken(args: {
  taskId: string;
  userId: string;
  ttlSec?: number;
  /** override `Date.now()` for tests */
  now?: number;
}): string {
  const ttl = args.ttlSec ?? DEFAULT_TTL_SEC;
  const nowMs = args.now ?? Date.now();
  const claims: Claims = {
    tid: args.taskId,
    uid: args.userId,
    exp: Math.floor(nowMs / 1000) + ttl,
  };
  const payload = JSON.stringify(claims);
  const sig = hmac(payload, env.SSE_TOKEN_SECRET);
  return `${b64url(payload)}.${sig}`;
}

export function verifySseToken(
  token: string | null | undefined,
  args: {
    taskId: string;
    /** override `Date.now()` for tests */
    now?: number;
    /** override skew tolerance for tests */
    skewSec?: number;
  },
): { userId: string } | null {
  if (!token) return null;

  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const p64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  let payload: string;
  try {
    payload = fromB64url(p64).toString('utf8');
  } catch {
    return null;
  }

  // Constant-time signature compare.
  const expected = hmac(payload, env.SSE_TOKEN_SECRET);
  const sigBuf = fromB64url(sig);
  const expectedBuf = fromB64url(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

  let claims: Claims;
  try {
    claims = JSON.parse(payload) as Claims;
  } catch {
    return null;
  }

  if (typeof claims.tid !== 'string' || claims.tid !== args.taskId) return null;
  if (typeof claims.uid !== 'string') return null;
  if (typeof claims.exp !== 'number') return null;

  const nowSec = Math.floor((args.now ?? Date.now()) / 1000);
  const skew = args.skewSec ?? DEFAULT_SKEW_SEC;
  if (claims.exp + skew < nowSec) return null;

  return { userId: claims.uid };
}
