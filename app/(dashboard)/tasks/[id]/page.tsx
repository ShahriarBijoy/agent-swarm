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
import {
  Frame,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import type {
  TerminalSummary,
  TimelineEvent,
  TimelineEventType,
} from '@/components/timeline/types';
import { ApprovalBar } from './approval-bar';
import { CanvasView } from './canvas-view';
import { TaskTabs, type TaskView } from './task-tabs';
import { TimelineStream } from './timeline-stream';
import { requireSession } from '@/lib/auth/require-session';
import { signSseToken } from '@/lib/auth/sse-token';

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
  const view: TaskView = viewParam === 'stream' ? 'stream' : 'canvas';
  const session = await requireSession();
  const task = await getTaskById(id);
  if (!task) notFound();

  // Mint a 60s SSE token for the EventSource clients on this page.
  // Each client refreshes via /api/tasks/[id]/stream-token on expiry.
  const sseToken = signSseToken({ taskId: task.id, userId: session.user.id });

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
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <nav className="text-xs">
        <Link
          href="/tasks"
          className="text-muted-foreground hover:text-foreground"
        >
          ← all tasks
        </Link>
      </nav>

      <Frame
        variant="ghost"
        spacing="sm"
        className="bg-[var(--color-bg-2)]/55"
      >
        <FrameHeader className="flex-row items-center justify-between">
          <FrameTitle className="font-mono text-[9.5px] font-medium uppercase tracking-[0.22em] text-[var(--color-muted-2)]">
            Task
          </FrameTitle>
          <span
            data-status={task.status}
            className="rounded-full bg-[var(--color-ink)] px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-surface)]"
          >
            {task.status}
          </span>
        </FrameHeader>
        <FramePanel className="flex flex-col gap-4 bg-[var(--color-surface-warm)] border-[var(--color-line)]">
          <header className="flex flex-col gap-2">
            <p className="text-sm whitespace-pre-wrap">{task.prompt}</p>
            <p className="font-mono text-xs text-muted-foreground">{task.id}</p>
          </header>

          <ApprovalBar
            taskId={task.id}
            sseToken={sseToken}
            initialGates={initialGates}
          />

          <TaskTabs
            initialView={view}
            canvasSlot={
              <CanvasView
                initialEvents={initialEvents}
                startedAt={startedAt}
                endedAt={endedAt}
                taskId={task.id}
                sseToken={sseToken}
              />
            }
            streamSlot={
              <TimelineStream
                taskId={task.id}
                sseToken={sseToken}
                initialEvents={initialEvents}
                initialTerminal={initialTerminal}
              />
            }
          />
        </FramePanel>
      </Frame>
    </main>
  );
}
