// tests/dashboard/queries-kanban.test.ts
import { describe, expect, it } from 'vitest';
import { deriveKanbanColumn } from '@/lib/dashboard/queries';

describe('deriveKanbanColumn', () => {
  it.each([
    ['queued', false, 'queued'],
    ['queued', true, 'queued'], // gates only matter while in_progress
    ['in_progress', false, 'in_progress'],
    ['in_progress', true, 'awaiting_approval'],
    ['done', false, 'done'],
    ['done', true, 'done'],
    ['failed', false, 'failed'],
    ['failed', true, 'failed'],
    ['cancelled', false, 'failed'], // collapse cancelled into the failed column
    ['awaiting_approval', false, 'awaiting_approval'],
    ['awaiting_approval', true, 'awaiting_approval'], // gate-open redundant once status is already awaiting_approval
  ] as const)('status=%s gateOpen=%s -> %s', (status, gateOpen, expected) => {
    expect(deriveKanbanColumn(status, gateOpen)).toBe(expected);
  });
});
