import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getEventsSince,
  getTaskById,
  type TaskEventRow,
  type TaskRow,
} from '@/db/queries/task-api';
import {
  listPendingForTask,
  type GateSummary,
} from '@/db/queries/approval-gates';
import type {
  TerminalSummary,
  TimelineEvent,
  TimelineEventType,
} from '@/components/timeline/types';
import { ApprovalBar } from './approval-bar';
import { CanvasView } from './canvas-view';
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

function serializeGate(g: GateSummary): GateSummary {
  // The page passes server-fetched gates to a client component; createdAt
  // serializes as Date which Next handles, but we explicitly clone to a
  // plain object to avoid leaking drizzle row internals.
  return {
    id: g.id,
    runId: g.runId,
    taskId: g.taskId,
    toolName: g.toolName,
    proposedInput: g.proposedInput,
    status: g.status,
    createdAt: g.createdAt,
  };
}

export default async function TaskPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const { view: viewParam } = await searchParams;
  const view = viewParam === 'stream' ? 'stream' : 'canvas';
  const task = await getTaskById(id);
  if (!task) notFound();

  const [rows, pendingGatesRaw] = await Promise.all([
    getEventsSince({ taskId: id, afterId: 0n, limit: 500 }),
    listPendingForTask(id),
  ]);
  const initialEvents = serializeEvents(rows);
  const initialTerminal = terminalFromTask(task);
  const initialGates = pendingGatesRaw.map(serializeGate);

  // Derive run timing window from the events list to avoid an extra query.
  // For non-terminal tasks `endedAt` stays null so the scrubber treats the
  // current wall clock as "now" and the canvas-view streams live.
  const startedAt = (rows[0]?.createdAt ?? new Date()).toISOString();
  const endedAt =
    initialTerminal && rows.length > 0
      ? rows[rows.length - 1]!.createdAt.toISOString()
      : null;

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

      <ApprovalBar taskId={task.id} initialGates={initialGates} />

      <div className="mb-3 flex gap-2">
        <Link
          href={`?view=canvas`}
          className={`rounded-full px-3 py-1.5 text-[12px] ${
            view === 'canvas'
              ? 'bg-[var(--color-ink)] text-[var(--color-surface)]'
              : 'border border-[var(--color-line-strong)]'
          }`}
        >
          Canvas
        </Link>
        <Link
          href={`?view=stream`}
          className={`rounded-full px-3 py-1.5 text-[12px] ${
            view === 'stream'
              ? 'bg-[var(--color-ink)] text-[var(--color-surface)]'
              : 'border border-[var(--color-line-strong)]'
          }`}
        >
          Stream
        </Link>
      </div>

      {view === 'canvas' ? (
        <CanvasView
          initialEvents={initialEvents}
          startedAt={startedAt}
          endedAt={endedAt}
          taskId={task.id}
        />
      ) : (
        <TimelineStream
          taskId={task.id}
          initialEvents={initialEvents}
          initialTerminal={initialTerminal}
        />
      )}
    </main>
  );
}
