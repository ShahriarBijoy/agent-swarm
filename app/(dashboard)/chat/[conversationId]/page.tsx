import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getConversationById,
  getLatestTaskInConversation,
  listTasksForConversation,
} from '@/db/queries/conversations';
import { getEventsSince, type TaskEventRow } from '@/db/queries/task-api';
import { requireSession } from '@/lib/auth/require-session';
import { signSseToken } from '@/lib/auth/sse-token';
import type {
  TimelineEvent,
  TimelineEventType,
} from '@/components/timeline/types';
import { ChatComposer } from '../chat-composer';
import { createScenarioTask } from '../actions';
import { ConversationView, type TurnInput } from './conversation-view';

export const dynamic = 'force-dynamic';

const ACTIVE_STATUSES = new Set([
  'queued',
  'in_progress',
  'awaiting_approval',
]);

function serializeEvents(rows: TaskEventRow[]): TimelineEvent[] {
  return rows.map((r) => ({
    id: Number(r.id),
    seq: r.seq,
    type: r.type as TimelineEventType,
    payload: r.payload,
    createdAt: r.createdAt.toISOString(),
  }));
}

export default async function ChatConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const session = await requireSession();
  const conversation = await getConversationById(conversationId);
  if (!conversation) notFound();
  if (conversation.userId !== session.user.id) notFound();

  const tasks = await listTasksForConversation(conversationId);
  const latest = await getLatestTaskInConversation(conversationId);

  // Fetch events for every turn in parallel. Conversations are bounded by
  // the per-user usage pattern (small N), so we keep this simple instead of
  // paginating; if a thread ever grows past, say, 50 turns we'd add a load-
  // older window — but that's not the v1 problem.
  const turnEvents = await Promise.all(
    tasks.map((t) => getEventsSince({ taskId: t.id, afterId: 0n, limit: 500 })),
  );

  const turns: TurnInput[] = tasks.map((t, i) => ({
    taskId: t.id,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    storedPrompt: t.prompt,
    initialEvents: serializeEvents(turnEvents[i] ?? []),
  }));

  const isLatestRunning =
    latest !== null && ACTIVE_STATUSES.has(latest.status);

  // Mint an SSE token only for the live tail. If nothing is running, no
  // EventSource is opened at all and the page is fully static.
  const sseToken =
    isLatestRunning && latest
      ? signSseToken({ taskId: latest.id, userId: session.user.id })
      : null;

  return (
    <div className="flex h-[calc(100vh-7.5rem)] flex-col gap-3">
      <header className="flex items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-medium tracking-tight">
            {conversation.title ?? 'Untitled chat'}
          </h1>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{conversation.customerEmail}</span>
            {' · '}
            {tasks.length} {tasks.length === 1 ? 'turn' : 'turns'}
          </p>
        </div>
        {latest && (
          <Link
            href={`/tasks/${latest.id}`}
            className="rounded-full border border-[var(--color-line-strong)] px-3 py-1.5 text-[11px] font-medium text-[var(--color-muted)] hover:bg-black/5 hover:text-[var(--color-ink)]"
          >
            ops view →
          </Link>
        )}
      </header>

      <ConversationView
        turns={turns}
        liveTaskId={isLatestRunning && latest ? latest.id : null}
        sseToken={sseToken}
      />

      <div className="px-1">
        <ChatComposer
          defaultEmail={session.user.email}
          conversationId={conversationId}
          action={createScenarioTask}
          disabled={isLatestRunning}
          {...(isLatestRunning ? { disabledReason: 'reply in flight…' } : {})}
          placeholder={
            isLatestRunning
              ? 'wait for the current reply to finish…'
              : 'continue the conversation…'
          }
        />
      </div>
    </div>
  );
}
