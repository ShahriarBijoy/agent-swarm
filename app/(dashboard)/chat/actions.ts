'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { requireSession } from '@/lib/auth/require-session';

// Phase 11 — Server action that posts to /api/tasks.
//
// Two phase-11 changes:
//   1. requireSession() up front so an unauthenticated submit can't even
//      try to create a task (defense in depth — middleware already
//      redirects, but the action shouldn't depend on that).
//   2. Forward the session cookie on the internal fetch to /api/tasks.
//      Server-side fetch does NOT inherit incoming cookies by default;
//      we have to copy the `cookie` header through, otherwise the route
//      handler's auth.api.getSession() sees no session and returns 401.

export async function createScenarioTask(formData: FormData) {
  const session = await requireSession();
  const prompt = String(formData.get('prompt') ?? '').trim();
  if (!prompt) return;

  const cookie = (await headers()).get('cookie') ?? '';

  const res = await fetch(
    new URL(
      '/api/tasks',
      process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3100',
    ),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        kind: 'scenario',
        prompt,
        // The route handler overwrites this with session.user.email anyway,
        // but sending it keeps the existing body schema happy and gives
        // server logs a tidy "[scenario] customer_email=…" line.
        customer_email: session.user.email,
      }),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || typeof body.taskId !== 'string') {
    const detail =
      typeof body.message === 'string'
        ? body.message
        : typeof body.error === 'string'
          ? body.error
          : `task creation failed (${res.status})`;
    throw new Error(detail);
  }
  redirect(`/chat/${body.taskId}`);
}
