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
import { TimelineStream } from './timeline-stream';

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

export default async function TaskPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const task = await getTaskById(id);
  if (!task) notFound();

  const rows = await getEventsSince({ taskId: id, afterId: 0n, limit: 500 });
  const initialEvents = serializeEvents(rows);
  const initialTerminal = terminalFromTask(task);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <nav className="text-xs">
        <Link
          href="/tasks"
          className="text-muted-foreground hover:text-foreground"
        >
          ← all tasks
        </Link>
      </nav>

      <header className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="font-heading text-lg font-medium">Task</h1>
          <span
            data-status={task.status}
            className="rounded bg-muted px-2 py-0.5 font-mono text-xs uppercase tracking-wide"
          >
            {task.status}
          </span>
        </div>
        <p className="text-sm whitespace-pre-wrap">{task.prompt}</p>
        <p className="font-mono text-xs text-muted-foreground">{task.id}</p>
      </header>

      <TimelineStream
        taskId={task.id}
        initialEvents={initialEvents}
        initialTerminal={initialTerminal}
      />
    </main>
  );
}
