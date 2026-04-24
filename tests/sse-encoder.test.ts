import { describe, expect, it } from 'vitest';
import {
  formatHeartbeat,
  formatTaskEvent,
  formatTerminal,
} from '@/lib/sse/encode';
import type { TaskEventRow } from '@/db/queries/task-api';

function fixtureRow(overrides: Partial<TaskEventRow> = {}): TaskEventRow {
  return {
    id: 42n,
    seq: 3,
    type: 'tool_call',
    payload: { tool_name: 'recall', input: { query: 'fleet' } },
    createdAt: new Date('2026-04-24T10:20:30.000Z'),
    ...overrides,
  };
}

describe('phase-06 SSE encode', () => {
  describe('formatTaskEvent', () => {
    it('emits id + event name + data in SSE format', () => {
      const out = formatTaskEvent(fixtureRow());
      const lines = out.split('\n');
      expect(lines[0]).toBe('id: 42');
      expect(lines[1]).toBe('event: task_event');
      expect(lines[2]!.startsWith('data: ')).toBe(true);
      // SSE block terminator: blank line
      expect(lines[3]).toBe('');
      expect(lines[4]).toBe('');
    });

    it('serializes bigint id as number in the JSON payload', () => {
      const out = formatTaskEvent(fixtureRow({ id: 99n }));
      const dataLine = out.split('\n')[2]!;
      const json = JSON.parse(dataLine.replace(/^data: /, ''));
      expect(json.id).toBe(99);
      expect(typeof json.id).toBe('number');
    });

    it('preserves payload structure through JSON round-trip', () => {
      const out = formatTaskEvent(
        fixtureRow({
          type: 'tool_result',
          payload: {
            tool_use_id: 'tu_123',
            is_error: false,
            content: [{ type: 'text', text: 'result' }],
          },
        }),
      );
      const json = JSON.parse(out.split('\n')[2]!.replace(/^data: /, ''));
      expect(json.payload).toEqual({
        tool_use_id: 'tu_123',
        is_error: false,
        content: [{ type: 'text', text: 'result' }],
      });
    });

    it('formats createdAt as an ISO string', () => {
      const out = formatTaskEvent(fixtureRow());
      const json = JSON.parse(out.split('\n')[2]!.replace(/^data: /, ''));
      expect(json.createdAt).toBe('2026-04-24T10:20:30.000Z');
    });

    it('always ends with a double newline (SSE block terminator)', () => {
      const out = formatTaskEvent(fixtureRow());
      expect(out.endsWith('\n\n')).toBe(true);
    });
  });

  describe('formatTerminal', () => {
    it('emits event: done with the status in the payload', () => {
      const out = formatTerminal({
        status: 'done',
        totalCostUsd: 0.0187,
        numTurns: 4,
      });
      const lines = out.split('\n');
      expect(lines[0]).toBe('event: done');
      const json = JSON.parse(lines[1]!.replace(/^data: /, ''));
      expect(json).toEqual({
        status: 'done',
        totalCostUsd: 0.0187,
        numTurns: 4,
      });
    });

    it('works with minimal payload (status only)', () => {
      const out = formatTerminal({ status: 'failed' });
      expect(out).toContain('event: done');
      expect(out).toContain('"status":"failed"');
    });

    it('ends with blank line separator', () => {
      const out = formatTerminal({ status: 'cancelled' });
      expect(out.endsWith('\n\n')).toBe(true);
    });
  });

  describe('formatHeartbeat', () => {
    it('is a comment-only SSE record (starts with ":")', () => {
      const out = formatHeartbeat();
      expect(out.startsWith(':')).toBe(true);
    });

    it('ends with blank line separator', () => {
      const out = formatHeartbeat();
      expect(out.endsWith('\n\n')).toBe(true);
    });
  });
});
