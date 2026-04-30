'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth/require-session';

// Phase 11.5 — Server action that posts to /api/tasks. Now conversation-aware:
//   - Empty `conversationId` → create a fresh conversation, redirect to it.
//   - Present `conversationId` → append a follow-up turn to the same thread.
//
// Auth and cookie-forward identical to phase 11 (server-side fetch doesn't
// inherit cookies, so we copy the `cookie` header through). The route handler
// is the source of truth for conversation ownership and busy-state checks;
// we just translate its responses into UX outcomes.

export async function createScenarioTask(formData: FormData) {
  const session = await requireSession();
  const prompt = String(formData.get('prompt') ?? '').trim();
  if (!prompt) return;

  const conversationIdRaw = String(formData.get('conversationId') ?? '').trim();
  const conversationId = conversationIdRaw.length > 0 ? conversationIdRaw : undefined;

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
        customer_email: session.user.email,
        ...(conversationId ? { conversationId } : {}),
      }),
    },
  );
  const body = await res.json().catch(() => ({}));

  // Surface conversation_busy as a friendly redirect back to the active
  // conversation rather than throwing — the UI can poll the latest task and
  // the user sees the previous reply finish.
  if (res.status === 409 && body.error === 'conversation_busy' && conversationId) {
    revalidatePath(`/chat/${conversationId}`);
    redirect(`/chat/${conversationId}`);
  }

  if (!res.ok || typeof body.taskId !== 'string') {
    const detail =
      typeof body.message === 'string'
        ? body.message
        : typeof body.error === 'string'
          ? body.error
          : `task creation failed (${res.status})`;
    throw new Error(detail);
  }

  const targetConversationId =
    typeof body.conversationId === 'string'
      ? body.conversationId
      : conversationId;

  if (targetConversationId) {
    revalidatePath('/chat');
    revalidatePath(`/chat/${targetConversationId}`);
    redirect(`/chat/${targetConversationId}`);
  }

  // Defensive fallback: no conversation came back (shouldn't happen on
  // scenario flow), drop the user on the per-task view.
  redirect(`/tasks/${body.taskId}`);
}
