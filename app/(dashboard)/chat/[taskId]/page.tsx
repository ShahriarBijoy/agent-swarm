import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getEventsSince,
  getTaskById,
  type TaskEventRow,
  type TaskRow,
} from '@/db/queries/task-api';
import type {
  TerminalSummary,
  TimelineEvent,
  TimelineEventType,
} from '@/components/timeline/types';
import { requireSession } from '@/lib/auth/require-session';
import { signSseToken } from '@/lib/auth/sse-token';

import { ChatThread } from './chat-thread';

export const dynamic = 'force-dynamic';

function serializeEvents(rows: TaskEventRow[]): TimelineEvent[] {
  return rows.map((r) => ({
    id: Number(r.id),
    seq: r.seq,
    type: r.type as TimelineEventType,
    payload: r.payload,
    createdAt: r.createdAt.toISOString(),
  }));
}

function terminalFromTask(task: TaskRow): TerminalSummary | null {
  if (
    task.status === 'done' ||
    task.status === 'failed' ||
    task.status === 'cancelled'
  ) {
    return { status: task.status };
  }
  return null;
}

// The /api/tasks scenario route prefixes the prompt with a `[scenario] …`
// marker that's purely for internal logs/orchestrator routing. Strip it for
// the customer-facing chat surface so the bubble shows what they typed.
function stripScenarioPrefix(prompt: string): string {
  return prompt.replace(/^\[scenario\][^\n]*\n+/, '').trim();
}

export default async function ChatThreadPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  const session = await requireSession();
  const task = await getTaskById(taskId);
  if (!task) notFound();

  const sseToken = signSseToken({ taskId: task.id, userId: session.user.id });
  const rows = await getEventsSince({ taskId, afterId: 0n, limit: 500 });
  const initialEvents = serializeEvents(rows);
  const initialTerminal = terminalFromTask(task);
  const initialPrompt = stripScenarioPrefix(task.prompt);

  return (
    <main className="mx-auto flex h-[calc(100vh-7rem)] w-full max-w-3xl flex-col gap-3 px-4 py-4">
      <header className="flex items-center justify-between">
        <Link
          href="/chat"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← new conversation
        </Link>
        <Link
          href={`/tasks/${task.id}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          operator view →
        </Link>
      </header>
      <ChatThread
        taskId={task.id}
        sseToken={sseToken}
        initialEvents={initialEvents}
        initialTerminal={initialTerminal}
        initialPrompt={initialPrompt}
      />
    </main>
  );
}
