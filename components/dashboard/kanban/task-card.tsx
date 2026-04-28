// components/dashboard/kanban/task-card.tsx
import Link from 'next/link';
import type { TaskWithGate } from '@/lib/dashboard/queries';

export function TaskCard({ task }: { task: TaskWithGate }) {
  return (
    <Link
      href={`/tasks/${task.id}`}
      className="block rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface)] p-3.5 transition hover:border-[var(--color-line-strong)]"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="line-clamp-2 text-[13px] leading-snug">{task.prompt}</div>
        {task.hasOpenGate && (
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[var(--color-red)]" />
        )}
      </div>
      <div className="flex justify-between font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">
        <span>{task.agentCount} agents</span>
        <span>${task.costUsd.toFixed(2)}</span>
      </div>
    </Link>
  );
}
