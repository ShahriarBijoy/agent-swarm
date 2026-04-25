import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import { auditPreToolUse, safeShort } from '@/lib/agent/hooks';

function preToolUse(overrides: Partial<PreToolUseHookInput> = {}): PreToolUseHookInput {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 'sess-1',
    transcript_path: '/tmp/t.jsonl',
    cwd: '/tmp',
    tool_name: 'Read',
    tool_input: { file_path: '/tmp/a' },
    tool_use_id: 'toolu_1',
    ...overrides,
  };
}

describe('auditPreToolUse', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it('returns an empty object so the SDK falls through to canUseTool (no permissionDecision)', async () => {
    const out = await auditPreToolUse(
      preToolUse(),
      'toolu_1',
      { signal: new AbortController().signal } as unknown as Parameters<typeof auditPreToolUse>[2],
    );
    expect(out).toEqual({});
  });

  it('logs the tool name to stderr', async () => {
    await auditPreToolUse(
      preToolUse({ tool_name: 'mcp__memory__recall' }),
      'toolu_1',
      { signal: new AbortController().signal } as unknown as Parameters<typeof auditPreToolUse>[2],
    );
    const logged = errSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
    expect(logged).toContain('tool=mcp__memory__recall');
  });

  it('labels subagent calls as `subagent <type>` and orchestrator calls as `orchestrator`', async () => {
    await auditPreToolUse(
      preToolUse({ agent_id: 'a1', agent_type: 'fleet-analyst' }),
      'toolu_1',
      { signal: new AbortController().signal } as unknown as Parameters<typeof auditPreToolUse>[2],
    );
    await auditPreToolUse(
      preToolUse(),
      'toolu_2',
      { signal: new AbortController().signal } as unknown as Parameters<typeof auditPreToolUse>[2],
    );
    const calls = errSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(calls[0]).toContain('[audit] subagent fleet-analyst');
    expect(calls[1]).toContain('[audit] orchestrator');
  });

  it('truncates long tool_input payloads in the stderr preview', async () => {
    const bigArray = new Array(1536).fill(0.12345);
    await auditPreToolUse(
      preToolUse({ tool_input: { embedding: bigArray } }),
      'toolu_1',
      { signal: new AbortController().signal } as unknown as Parameters<typeof auditPreToolUse>[2],
    );
    const logged = String(errSpy.mock.calls[0]?.[0] ?? '');
    // The preview portion after `input=` must be bounded.
    const preview = logged.split('input=')[1] ?? '';
    expect(preview.length).toBeLessThan(260); // 200 + truncation suffix overhead
    expect(preview).toContain('…(+');
  });

  it('does not throw on null tool_input or missing tool_use_id', async () => {
    await expect(
      auditPreToolUse(
        preToolUse({ tool_input: null, tool_use_id: undefined as unknown as string }),
        undefined,
        { signal: new AbortController().signal } as unknown as Parameters<typeof auditPreToolUse>[2],
      ),
    ).resolves.toBeDefined();
  });
});

describe('safeShort', () => {
  it('returns strings shorter than the limit unchanged', () => {
    expect(safeShort('hello')).toBe('hello');
  });

  it('truncates long strings with a char-count suffix', () => {
    const s = 'x'.repeat(500);
    const out = safeShort(s, 100);
    expect(out.startsWith('x'.repeat(100))).toBe(true);
    expect(out).toContain('…(+400)');
  });

  it('serializes objects via JSON.stringify', () => {
    expect(safeShort({ a: 1 })).toBe('{"a":1}');
  });

  it('falls back to String() on JSON errors (circular refs)', () => {
    const circ: { self?: unknown } = {};
    circ.self = circ;
    expect(safeShort(circ)).toContain('[object Object]');
  });
});
