// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { KanbanBoard } from '@/components/dashboard/kanban/kanban-board';
import type { KanbanColumn, TaskWithGate } from '@/lib/dashboard/queries';

afterEach(() => cleanup());

const fakeTask = (overrides: Partial<TaskWithGate> = {}): TaskWithGate => ({
  id: 'task-1',
  prompt: 'Audit AWS spend',
  status: 'queued',
  createdAt: new Date('2026-04-20T12:00:00Z'),
  agentCount: 3,
  costUsd: 1.23,
  hasOpenGate: false,
  ...overrides,
});

const emptyBoard = (): Record<KanbanColumn, TaskWithGate[]> => ({
  queued: [],
  in_progress: [],
  awaiting_approval: [],
  done: [],
  failed: [],
});

describe('<KanbanBoard />', () => {
  it('renders all five column titles', () => {
    const { getByText } = render(<KanbanBoard board={emptyBoard()} />);
    expect(getByText(/queued/i)).toBeTruthy();
    expect(getByText(/in progress/i)).toBeTruthy();
    expect(getByText(/awaiting approval/i)).toBeTruthy();
    expect(getByText(/done/i)).toBeTruthy();
    expect(getByText(/failed/i)).toBeTruthy();
  });

  it('places a task with an open gate in the awaiting-approval column', () => {
    const board = emptyBoard();
    board.awaiting_approval.push(
      fakeTask({ id: 'gate-1', prompt: 'Approve cost ceiling raise', hasOpenGate: true }),
    );
    const { getByText } = render(<KanbanBoard board={board} />);
    expect(getByText('Approve cost ceiling raise')).toBeTruthy();
  });
});
