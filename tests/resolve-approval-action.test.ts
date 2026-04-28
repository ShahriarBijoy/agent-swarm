import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';

const url = process.env.DATABASE_URL_UNPOOLED;
const skipSuite = url ? describe : describe.skip;

// Stub Next's revalidatePath — we never want it to crash a test by
// trying to invalidate a real route cache.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// Stub Inngest — assert the dispatch happens but don't actually hit a broker.
vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: vi.fn().mockResolvedValue({ ids: ['ev1'] }) },
}));

skipSuite('phase-07 resolveApproval Server Action', () => {
  const rawSql = postgres(url!, { max: 1, idle_timeout: 2 });
  const TEST_MARK = 'phase-07-resolve-action-test';

  async function deleteTestRows() {
    const rows = await rawSql<Array<{ id: string }>>`
      SELECT id FROM tasks WHERE metadata->>'test_id' = ${TEST_MARK}
    `;
    if (rows.length === 0) return;
    const ids = rows.map((r) => r.id);
    await rawSql`DELETE FROM approval_gates WHERE task_id = ANY(${ids})`;
    await rawSql`DELETE FROM task_events WHERE task_id = ANY(${ids})`;
    await rawSql`DELETE FROM tasks WHERE id = ANY(${ids})`;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    await deleteTestRows();
  });
  afterAll(async () => {
    await deleteTestRows();
    await rawSql.end();
  });

  async function seedPendingGate(): Promise<{
    taskId: string;
    runId: string;
    gateId: string;
  }> {
    const [task] = await rawSql<Array<{ id: string }>>`
      INSERT INTO tasks (prompt, status, metadata)
      VALUES ('action-test', 'awaiting_approval', ${rawSql.json({ test_id: TEST_MARK })})
      RETURNING id
    `;
    const [run] = await rawSql<Array<{ id: string }>>`
      INSERT INTO task_runs (task_id, attempt, status)
      VALUES (${task!.id}, 1, 'in_progress')
      RETURNING id
    `;
    const gateId = crypto.randomUUID();
    await rawSql`
      INSERT INTO approval_gates (id, run_id, task_id, tool_name, proposed_input, status)
      VALUES (${gateId}, ${run!.id}, ${task!.id}, 'Bash', ${rawSql.json({ command: 'rm' })}, 'pending')
    `;
    return { taskId: task!.id, runId: run!.id, gateId };
  }

  function makeForm(fields: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  }

  it('approves: updates gate, appends resolved event, sends Inngest event', async () => {
    const { gateId, taskId, runId } = await seedPendingGate();

    const { resolveApproval } = await import('@/app/(dashboard)/tasks/[id]/actions');
    const result = await resolveApproval(
      makeForm({ gateId, decision: 'approve' }),
    );
    expect(result).toEqual({ ok: true, gateId, status: 'approved' });

    const [gate] = await rawSql<
      Array<{ status: string; reviewer_id: string }>
    >`SELECT status, reviewer_id FROM approval_gates WHERE id = ${gateId}`;
    expect(gate!.status).toBe('approved');
    expect(gate!.reviewer_id).toBe('local-dev');

    const events = await rawSql<
      Array<{ payload: { subtype: string; gate_id: string; decision: string } }>
    >`
      SELECT payload FROM task_events
      WHERE run_id = ${runId} AND type = 'approval_request'
      ORDER BY id ASC
    `;
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      subtype: 'resolved',
      gate_id: gateId,
      decision: 'approved',
    });

    const { inngest } = await import('@/lib/inngest/client');
    expect(vi.mocked(inngest.send)).toHaveBeenCalledOnce();
    expect(vi.mocked(inngest.send).mock.calls[0]![0]).toEqual({
      name: 'auto-ride/approval.decided',
      data: {
        gateId,
        approved: true,
        reason: null,
        modifiedInput: null,
      },
    });

    expect(taskId).toBe(taskId); // (silence unused-var)
  });

  it('modifies: persists resolutionInput and surfaces it in the Inngest payload', async () => {
    const { gateId } = await seedPendingGate();
    const modifiedInput = { command: 'rm -rf /tmp/safe_only' };

    const { resolveApproval } = await import('@/app/(dashboard)/tasks/[id]/actions');
    const result = await resolveApproval(
      makeForm({
        gateId,
        decision: 'modify',
        modifiedInput: JSON.stringify(modifiedInput),
        reason: 'narrowed scope',
      }),
    );
    expect(result).toEqual({ ok: true, gateId, status: 'modified' });

    const [gate] = await rawSql<
      Array<{
        status: string;
        resolution_input: { command: string };
        reviewer_note: string;
      }>
    >`SELECT status, resolution_input, reviewer_note FROM approval_gates WHERE id = ${gateId}`;
    expect(gate!.status).toBe('modified');
    expect(gate!.resolution_input).toEqual(modifiedInput);
    expect(gate!.reviewer_note).toBe('narrowed scope');

    const { inngest } = await import('@/lib/inngest/client');
    expect(vi.mocked(inngest.send).mock.calls[0]![0]).toMatchObject({
      data: { approved: true, modifiedInput },
    });
  });

  it('denies: persists reviewer note, Inngest payload approved=false', async () => {
    const { gateId } = await seedPendingGate();

    const { resolveApproval } = await import('@/app/(dashboard)/tasks/[id]/actions');
    const result = await resolveApproval(
      makeForm({ gateId, decision: 'deny', reason: 'too risky' }),
    );
    expect(result).toEqual({ ok: true, gateId, status: 'denied' });

    const [gate] = await rawSql<
      Array<{ status: string; reviewer_note: string }>
    >`SELECT status, reviewer_note FROM approval_gates WHERE id = ${gateId}`;
    expect(gate!.status).toBe('denied');
    expect(gate!.reviewer_note).toBe('too risky');

    const { inngest } = await import('@/lib/inngest/client');
    expect(vi.mocked(inngest.send).mock.calls[0]![0]).toMatchObject({
      data: { approved: false, reason: 'too risky' },
    });
  });

  it('rejects invalid body (missing gateId)', async () => {
    const { resolveApproval } = await import('@/app/(dashboard)/tasks/[id]/actions');
    const result = await resolveApproval(makeForm({ decision: 'approve' }));
    expect(result.ok).toBe(false);
    if (!result.ok && result.error === 'invalid_body') {
      expect(result.issues.length).toBeGreaterThan(0);
    } else {
      throw new Error('expected invalid_body branch');
    }
    const { inngest } = await import('@/lib/inngest/client');
    expect(vi.mocked(inngest.send)).not.toHaveBeenCalled();
  });

  it('rejects modify without modifiedInput', async () => {
    const { gateId } = await seedPendingGate();
    const { resolveApproval } = await import('@/app/(dashboard)/tasks/[id]/actions');
    const result = await resolveApproval(
      makeForm({ gateId, decision: 'modify' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('invalid_modified_input');
    }
  });

  it('rejects modify with malformed JSON', async () => {
    const { gateId } = await seedPendingGate();
    const { resolveApproval } = await import('@/app/(dashboard)/tasks/[id]/actions');
    const result = await resolveApproval(
      makeForm({
        gateId,
        decision: 'modify',
        modifiedInput: '{not json',
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('invalid_modified_input');
    }
  });

  it('rejects unknown gate id', async () => {
    const { resolveApproval } = await import('@/app/(dashboard)/tasks/[id]/actions');
    const result = await resolveApproval(
      makeForm({
        gateId: '00000000-0000-4000-8000-000000000000',
        decision: 'approve',
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('gate_not_found');
    }
  });

  it('rejects already-resolved gate (no double-decide)', async () => {
    const { gateId } = await seedPendingGate();
    const { resolveApproval } = await import('@/app/(dashboard)/tasks/[id]/actions');
    await resolveApproval(makeForm({ gateId, decision: 'approve' }));
    const second = await resolveApproval(
      makeForm({ gateId, decision: 'deny', reason: 'changed mind' }),
    );
    expect(second.ok).toBe(false);
    if (!second.ok && second.error === 'gate_already_resolved') {
      expect(second.status).toBe('approved');
    } else {
      throw new Error('expected gate_already_resolved branch');
    }
  });

  it('returns ok=true even if inngest.send fails (gate row is source of truth)', async () => {
    const { gateId } = await seedPendingGate();
    const { inngest } = await import('@/lib/inngest/client');
    vi.mocked(inngest.send).mockRejectedValueOnce(new Error('broker-down'));

    const { resolveApproval } = await import('@/app/(dashboard)/tasks/[id]/actions');
    const result = await resolveApproval(
      makeForm({ gateId, decision: 'approve' }),
    );
    expect(result.ok).toBe(true);

    const [gate] = await rawSql<
      Array<{ status: string }>
    >`SELECT status FROM approval_gates WHERE id = ${gateId}`;
    expect(gate!.status).toBe('approved');
  });
});
