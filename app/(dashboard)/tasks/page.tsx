import { getKanbanBoard } from '@/lib/dashboard/queries';
import { KanbanBoard } from '@/components/dashboard/kanban/kanban-board';
import { CreateTaskForm } from './create-form';

export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  const board = await getKanbanBoard();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[24px] font-medium tracking-tight">Tasks</h1>
        <details className="relative">
          <summary className="cursor-pointer rounded-full border border-[var(--color-line-strong)] px-3.5 py-1.5 text-[13px] font-medium">+ New task</summary>
          <div className="absolute right-0 top-full mt-2 w-[460px] rounded-[12px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow">
            <CreateTaskForm />
          </div>
        </details>
      </div>
      <KanbanBoard board={board} />
    </div>
  );
}
