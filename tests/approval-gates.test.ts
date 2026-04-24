import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';

const url = process.env.DATABASE_URL_UNPOOLED;
const skipSuite = url ? describe : describe.skip;

skipSuite('phase-07 approval-gates queries', () => {
  const rawSql = postgres(url!, { max: 1, idle_timeout: 2 });
  const TEST_MARK = 'phase-07-gates-test';

  async function deleteTestRows() {
    // approval_gates is FK'd by run_id (cascade) and task_id (no cascade);
    // delete via task metadata so we sweep both axes safely.
    const rows = await rawSql<Array<{ id: string }>>`
      SELECT id FROM tasks WHERE metadata->>'test_id' = ${TEST_MARK}
    `;
    if (rows.length === 0) return;
    const ids = rows.map((r) => r.id);
    await rawSql`DELETE FROM approval_gates WHERE task_id = ANY(${ids})`;
    await rawSql`DELETE FROM task_events WHERE task_id = ANY(${ids})`;
    await rawSql`DELETE FROM tasks WHERE id = ANY(${ids})`;
  }

  beforeEach(deleteTestRows);
  afterAll(async () => {
    await deleteTestRows();
    await rawSql.end();
  });

  async function seedRun(): Promise<{ taskId: string; runId: string }> {
    const [task] = await rawSql<Array<{ id: string }>>`
      INSERT INTO tasks (prompt, status, metadata)
      VALUES ('gate-test', 'in_progress', ${rawSql.json({ test_id: TEST_MARK })})
      RETURNING id
    `;
    const [run] = await rawSql<Array<{ id: string }>>`
      INSERT INTO task_runs (task_id, attempt, status)
      VALUES (${task!.id}, 1, 'in_progress')
      RETURNING id
    `;
    return { taskId: task!.id, runId: run!.id };
  }

  function newGateId(): string {
    return crypto.randomUUID();
  }

  describe('openGate', () => {
    it('inserts a pending gate with proposed input as jsonb', async () => {
      const { openGate } = await import('@/db/queries/approval-gates');
      const { taskId, runId } = await seedRun();
      const id = newGateId();
      await openGate({
        id,
        runId,
        taskId,
        toolName: 'Bash',
        proposedInput: { command: 'rm -rf /tmp/x' },
      });

      const [row] = await rawSql<
        Array<{
          status: string;
          tool_name: string;
          proposed_input: { command: string };
        }>
      >`SELECT status, tool_name, proposed_input FROM approval_gates WHERE id = ${id}`;
      expect(row!.status).toBe('pending');
      expect(row!.tool_name).toBe('Bash');
      expect(row!.proposed_input).toEqual({ command: 'rm -rf /tmp/x' });
    });

    it('is idempotent on the same gate id (Inngest replay safety)', async () => {
      const { openGate, getGateById } = await import(
        '@/db/queries/approval-gates'
      );
      const { taskId, runId } = await seedRun();
      const id = newGateId();
      await openGate({
        id,
        runId,
        taskId,
        toolName: 'Bash',
        proposedInput: { command: 'ls' },
      });
      // Second call with the same id but different toolName must NOT overwrite.
      await openGate({
        id,
        runId,
        taskId,
        toolName: 'Write',
        proposedInput: { foo: 'bar' },
      });
      const gate = await getGateById(id);
      expect(gate!.toolName).toBe('Bash');
      expect(gate!.proposedInput).toEqual({ command: 'ls' });
    });
  });

  describe('resolveGate', () => {
    it('approves a pending gate and stamps resolvedAt', async () => {
      const { openGate, resolveGate, getGateById } = await import(
        '@/db/queries/approval-gates'
      );
      const { taskId, runId } = await seedRun();
      const id = newGateId();
      await openGate({
        id,
        runId,
        taskId,
        toolName: 'Bash',
        proposedInput: { command: 'rm' },
      });
      const result = await resolveGate({
        id,
        status: 'approved',
        reviewerId: 'tester',
      });
      expect(result.ok).toBe(true);
      const gate = await getGateById(id);
      expect(gate!.status).toBe('approved');
      expect(gate!.reviewerId).toBe('tester');
      expect(gate!.resolvedAt).not.toBeNull();
      expect(gate!.timedOutAt).toBeNull();
    });

    it('persists modified resolutionInput when status=modified', async () => {
      const { openGate, resolveGate, getGateById } = await import(
        '@/db/queries/approval-gates'
      );
      const { taskId, runId } = await seedRun();
      const id = newGateId();
      await openGate({
        id,
        runId,
        taskId,
        toolName: 'Bash',
        proposedInput: { command: 'rm -rf /tmp/x' },
      });
      const result = await resolveGate({
        id,
        status: 'modified',
        resolutionInput: { command: 'rm -rf /tmp/x_safe' },
        reviewerNote: 'narrowed scope',
      });
      expect(result.ok).toBe(true);
      const gate = await getGateById(id);
      expect(gate!.status).toBe('modified');
      expect(gate!.resolutionInput).toEqual({ command: 'rm -rf /tmp/x_safe' });
      expect(gate!.reviewerNote).toBe('narrowed scope');
    });

    it('persists reviewerNote on deny', async () => {
      const { openGate, resolveGate, getGateById } = await import(
        '@/db/queries/approval-gates'
      );
      const { taskId, runId } = await seedRun();
      const id = newGateId();
      await openGate({
        id,
        runId,
        taskId,
        toolName: 'Bash',
        proposedInput: { command: 'rm' },
      });
      const result = await resolveGate({
        id,
        status: 'denied',
        reviewerNote: 'too risky',
      });
      expect(result.ok).toBe(true);
      const gate = await getGateById(id);
      expect(gate!.status).toBe('denied');
      expect(gate!.reviewerNote).toBe('too risky');
      expect(gate!.resolutionInput).toBeNull();
    });

    it('refuses to resolve an already-resolved gate', async () => {
      const { openGate, resolveGate } = await import(
        '@/db/queries/approval-gates'
      );
      const { taskId, runId } = await seedRun();
      const id = newGateId();
      await openGate({
        id,
        runId,
        taskId,
        toolName: 'Bash',
        proposedInput: {},
      });
      await resolveGate({ id, status: 'approved' });
      const second = await resolveGate({ id, status: 'denied' });
      expect(second.ok).toBe(false);
      if (!second.ok && second.reason === 'already_resolved') {
        expect(second.status).toBe('approved');
      } else {
        throw new Error('expected already_resolved branch');
      }
    });

    it('returns not_found for an unknown gate id', async () => {
      const { resolveGate } = await import('@/db/queries/approval-gates');
      const result = await resolveGate({
        id: '00000000-0000-4000-8000-000000000000',
        status: 'approved',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('not_found');
      }
    });

    it('throws if status=modified but resolutionInput is undefined', async () => {
      const { resolveGate } = await import('@/db/queries/approval-gates');
      await expect(
        resolveGate({
          id: '00000000-0000-4000-8000-000000000000',
          status: 'modified',
        }),
      ).rejects.toThrow(/resolutionInput/);
    });
  });

  describe('expireGate', () => {
    it('flips a pending gate to timed_out and stamps timedOutAt', async () => {
      const { openGate, expireGate, getGateById } = await import(
        '@/db/queries/approval-gates'
      );
      const { taskId, runId } = await seedRun();
      const id = newGateId();
      await openGate({
        id,
        runId,
        taskId,
        toolName: 'Bash',
        proposedInput: {},
      });
      const result = await expireGate(id);
      expect(result.ok).toBe(true);
      const gate = await getGateById(id);
      expect(gate!.status).toBe('timed_out');
      expect(gate!.timedOutAt).not.toBeNull();
      expect(gate!.resolvedAt).toBeNull();
    });

    it('refuses to expire an already-resolved gate', async () => {
      const { openGate, resolveGate, expireGate } = await import(
        '@/db/queries/approval-gates'
      );
      const { taskId, runId } = await seedRun();
      const id = newGateId();
      await openGate({
        id,
        runId,
        taskId,
        toolName: 'Bash',
        proposedInput: {},
      });
      await resolveGate({ id, status: 'approved' });
      const result = await expireGate(id);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('already_resolved');
      }
    });
  });

  describe('listPendingForTask', () => {
    it('returns only pending gates for the task, oldest first', async () => {
      const { openGate, resolveGate, listPendingForTask } = await import(
        '@/db/queries/approval-gates'
      );
      const { taskId, runId } = await seedRun();
      const id1 = newGateId();
      const id2 = newGateId();
      const id3 = newGateId();

      await openGate({
        id: id1,
        runId,
        taskId,
        toolName: 'Bash',
        proposedInput: { command: 'first' },
      });
      // small spacing so created_at differs
      await new Promise((r) => setTimeout(r, 10));
      await openGate({
        id: id2,
        runId,
        taskId,
        toolName: 'Write',
        proposedInput: { file_path: 'src/x.ts' },
      });
      await new Promise((r) => setTimeout(r, 10));
      await openGate({
        id: id3,
        runId,
        taskId,
        toolName: 'Bash',
        proposedInput: { command: 'third' },
      });
      // resolve id2 → should drop out of the list.
      await resolveGate({ id: id2, status: 'approved' });

      const pending = await listPendingForTask(taskId);
      const ids = pending.map((g) => g.id);
      expect(ids).toEqual([id1, id3]);
      expect(pending[0]!.toolName).toBe('Bash');
    });
  });

  describe('markTaskAwaitingApproval / markTaskResumed', () => {
    it('round-trips in_progress ↔ awaiting_approval', async () => {
      const { markTaskAwaitingApproval, markTaskResumed } = await import(
        '@/db/queries/approval-gates'
      );
      const { taskId } = await seedRun(); // seedRun sets task.status = 'in_progress'

      await markTaskAwaitingApproval(taskId);
      const [a] = await rawSql<
        Array<{ status: string }>
      >`SELECT status FROM tasks WHERE id = ${taskId}`;
      expect(a!.status).toBe('awaiting_approval');

      await markTaskResumed(taskId);
      const [b] = await rawSql<
        Array<{ status: string }>
      >`SELECT status FROM tasks WHERE id = ${taskId}`;
      expect(b!.status).toBe('in_progress');
    });

    it('refuses to flip a terminal task', async () => {
      const { markTaskAwaitingApproval } = await import(
        '@/db/queries/approval-gates'
      );
      const { taskId } = await seedRun();
      await rawSql`UPDATE tasks SET status = 'done' WHERE id = ${taskId}`;
      await markTaskAwaitingApproval(taskId);
      const [row] = await rawSql<
        Array<{ status: string }>
      >`SELECT status FROM tasks WHERE id = ${taskId}`;
      expect(row!.status).toBe('done'); // unchanged
    });
  });
});
