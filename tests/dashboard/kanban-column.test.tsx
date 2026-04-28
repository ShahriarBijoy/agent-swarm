// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { KanbanColumn } from '@/components/dashboard/kanban/kanban-column';
import type { TaskWithGate } from '@/lib/dashboard/queries';

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

describe('<KanbanColumn />', () => {
  it('renders the column title and an empty placeholder when there are no tasks', () => {
    const { getByText } = render(<KanbanColumn status="queued" tasks={[]} />);
    expect(getByText(/queued/i)).toBeTruthy();
    expect(getByText(/—\s*empty\s*—/i)).toBeTruthy();
  });

  it('renders the count badge and one card per task', () => {
    const tasks = [
      fakeTask({ id: 't1', prompt: 'Audit AWS spend' }),
      fakeTask({ id: 't2', prompt: 'Refactor auth gate' }),
    ];
    const { getByText } = render(<KanbanColumn status="in_progress" tasks={tasks} />);
    expect(getByText(/in progress/i)).toBeTruthy();
    expect(getByText('2')).toBeTruthy();
    expect(getByText('Audit AWS spend')).toBeTruthy();
    expect(getByText('Refactor auth gate')).toBeTruthy();
  });
});
