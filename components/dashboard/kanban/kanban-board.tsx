// components/dashboard/kanban/kanban-board.tsx
'use client';
import { useState } from 'react';
import {
  Kanban,
  KanbanBoard as KBoard,
  KanbanColumn,
  KanbanColumnContent,
  KanbanItem,
  KanbanItemHandle,
  KanbanOverlay,
} from '@/components/reui/kanban';
import { ScrollArea } from '@/components/ui/scroll-area';
import { TaskCard } from './task-card';
import type { KanbanColumn as Col, TaskWithGate } from '@/lib/dashboard/queries';

const COLS: Col[] = ['queued', 'in_progress', 'awaiting_approval', 'done', 'failed'];
const TITLES: Record<Col, string> = {
  queued: 'Queued',
  in_progress: 'In progress',
  awaiting_approval: 'Awaiting approval',
  done: 'Done',
  failed: 'Failed',
};
const DOT: Record<Col, string> = {
  queued: 'bg-[var(--color-muted-2)]',
  in_progress: 'bg-[var(--color-ink)]',
  awaiting_approval: 'bg-[var(--color-red)]',
  done: 'bg-emerald-500',
  failed: 'bg-[var(--color-red)]',
};

export function KanbanBoard({ board }: { board: Record<Col, TaskWithGate[]> }) {
  // Local copy so drag-reorder is instant. Cross-column moves are visual only:
  // task status is owned by the orchestrator (HITL gate resolution, run
  // completion). A page refresh resets to server-of-record.
  const [state, setState] = useState(board);

  return (
    <Kanban<TaskWithGate>
      value={state}
      onValueChange={(next) => setState(next as Record<Col, TaskWithGate[]>)}
      getItemValue={(t) => t.id}
    >
      <KBoard className="grid grid-cols-5 gap-3.5 sm:grid-cols-5">
        {COLS.map((col) => {
          const tasks = state[col];
          return (
            <KanbanColumn
              key={col}
              value={col}
              className="flex h-[calc(100vh-200px)] min-h-[420px] flex-col overflow-hidden rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface-warm)] p-4"
            >
              <div className="mb-3 flex items-center justify-between font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--color-muted-2)]">
                <span className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${DOT[col]}`} />
                  {TITLES[col]}
                </span>
                <span>{tasks.length}</span>
              </div>
              <ScrollArea className="-mx-1 min-h-0 flex-1 px-1">
                <KanbanColumnContent value={col} className="flex flex-col gap-2.5 py-1">
                  {tasks.map((t) => (
                    <KanbanItem key={t.id} value={t.id} asChild>
                      <KanbanItemHandle asChild>
                        <div>
                          <TaskCard task={t} />
                        </div>
                      </KanbanItemHandle>
                    </KanbanItem>
                  ))}
                  {tasks.length === 0 && (
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">— empty —</div>
                  )}
                </KanbanColumnContent>
              </ScrollArea>
            </KanbanColumn>
          );
        })}
      </KBoard>
      <KanbanOverlay className="rounded-[12px] border-2 border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface)]/40" />
    </Kanban>
  );
}
