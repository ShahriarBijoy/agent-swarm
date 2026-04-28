import { getKanbanBoard } from '@/lib/dashboard/queries';
import { KanbanBoard } from '@/components/dashboard/kanban/kanban-board';
import { CreateTaskDialog } from './create-task-dialog';

export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  const board = await getKanbanBoard();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[24px] font-medium tracking-tight">Tasks</h1>
        <CreateTaskDialog />
      </div>
      <KanbanBoard board={board} />
    </div>
  );
}
