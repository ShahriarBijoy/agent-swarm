// components/dashboard/kanban/kanban-column.tsx
import type { TaskWithGate, KanbanColumn as Col } from '@/lib/dashboard/queries';
import { TaskCard } from './task-card';

const TITLES: Record<Col, string> = {
  queued: 'Queued',
  in_progress: 'In progress',
  awaiting_approval: 'Awaiting approval',
  done: 'Done',
  failed: 'Failed',
};

export function KanbanColumn({ status, tasks }: { status: Col; tasks: TaskWithGate[] }) {
  return (
    <div className="rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface-warm)] p-4">
      <div className="mb-3 flex items-center justify-between font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--color-muted-2)]">
        <span>{TITLES[status]}</span>
        <span>{tasks.length}</span>
      </div>
      <div className="flex flex-col gap-2.5">
        {tasks.map((t) => <TaskCard key={t.id} task={t} />)}
        {tasks.length === 0 && (
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">— empty —</div>
        )}
      </div>
    </div>
  );
}
