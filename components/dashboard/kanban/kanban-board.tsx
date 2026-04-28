// components/dashboard/kanban/kanban-board.tsx
import { KanbanColumn } from './kanban-column';
import type { KanbanColumn as Col, TaskWithGate } from '@/lib/dashboard/queries';

export function KanbanBoard({ board }: { board: Record<Col, TaskWithGate[]> }) {
  const cols: Col[] = ['queued', 'in_progress', 'awaiting_approval', 'done', 'failed'];
  return (
    <div className="grid grid-cols-5 gap-3.5">
      {cols.map((c) => <KanbanColumn key={c} status={c} tasks={board[c]} />)}
    </div>
  );
}
