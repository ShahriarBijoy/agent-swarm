'use client';
import type { ActiveRunSnapshot } from '@/lib/dashboard/queries';
import { AgentCanvas } from '../canvas/agent-canvas';

const STATUS_LABEL: Record<string, string> = {
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  awaiting_approval: 'Awaiting approval',
  queued: 'Queued',
  in_progress: 'Stalled',
};

const STATUS_TONE: Record<string, string> = {
  done:              'bg-[var(--color-ink)] text-[var(--color-surface)]',
  failed:            'bg-[var(--color-red)] text-white',
  cancelled:         'bg-[var(--color-muted-2)] text-[var(--color-surface)]',
  awaiting_approval: 'bg-[var(--color-lime)] text-[var(--color-ink)]',
  queued:            'bg-[var(--color-bg-2)] text-[var(--color-ink)]',
  in_progress:       'bg-[var(--color-muted-2)] text-[var(--color-surface)]',
};

export function MiniCanvas({ data }: { data: ActiveRunSnapshot | null }) {
  if (!data) {
    return (
      <div className="grid h-full place-items-center font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted-2)]">
        No swarm runs yet
      </div>
    );
  }
  const heading = data.isLive ? 'Active swarm run' : 'Last swarm run';
  const tone = STATUS_TONE[data.run.status] ?? STATUS_TONE.done!;
  const label = STATUS_LABEL[data.run.status] ?? data.run.status;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3.5 flex items-start justify-between">
        <div>
          <h3 className="text-[17px] font-medium tracking-tight">
            {heading} · {data.task.id.slice(0, 8)}
          </h3>
          <div className="mt-1 font-mono text-[11px] text-[var(--color-muted)]">
            {data.task.prompt.slice(0, 80)}
          </div>
        </div>
        {data.isLive ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-lime)] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--color-ink)]">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-ink)]" />
            Live
          </span>
        ) : (
          <span
            className={`inline-flex items-center rounded-full px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] ${tone}`}
          >
            {label}
          </span>
        )}
      </div>
      <AgentCanvas events={data.events as never} mode="mini" />
    </div>
  );
}
