import { config } from 'dotenv';
import { vi } from 'vitest';

config({ path: '.env.local' });

// Bridge `jest` -> `vi` so @testing-library/react's `waitFor` can detect
// vitest fake timers and drive its internal poller via `jest.advanceTimersByTime`.
// Without this, `waitFor` falls back to real-timer mode and hangs whenever a
// test calls `vi.useFakeTimers()` (because `setInterval` is itself faked).
// See: node_modules/@testing-library/react/dist/pure.js#jestFakeTimersAreEnabled
// (typeof jest !== 'undefined' && hasOwn(setTimeout, 'clock'))
(globalThis as { jest?: unknown }).jest ??= vi;
