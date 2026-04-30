import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { TimelineEventRenderer } from '@/components/timeline/TimelineEventRenderer';
import type { TimelineEvent } from '@/components/timeline/types';

function ev(
  type: TimelineEvent['type'],
  payload: Record<string, unknown>,
  seq = 0,
  id = 1,
): TimelineEvent {
  return {
    id,
    seq,
    type,
    payload,
    createdAt: '2026-04-24T10:00:00.000Z',
  };
}

describe('phase-06 TimelineEventRenderer', () => {
  it('renders user_message with the prompt text', () => {
    const html = renderToString(
      <TimelineEventRenderer
        event={ev('user_message', {
          message: { content: 'Check the fleet.' },
        })}
      />,
    );
    expect(html).toContain('Check the fleet.');
    expect(html).toContain('user');
  });

  it('renders assistant_turn with text blocks', () => {
    const html = renderToString(
      <TimelineEventRenderer
        event={ev('assistant_turn', {
          message: {
            content: [{ type: 'text', text: 'I will delegate to fleet-analyst.' }],
          },
        })}
      />,
    );
    expect(html).toContain('I will delegate to fleet-analyst.');
    expect(html).toContain('assistant');
  });

  it('renders tool_call with tool_name + input preview', () => {
    const html = renderToString(
      <TimelineEventRenderer
        event={ev('tool_call', {
          tool_name: 'mcp__memory__recall',
          tool_use_id: 'tu_123',
          input: { query: 'fleet service intervals' },
        })}
      />,
    );
    expect(html).toContain('mcp__memory__recall');
    expect(html).toContain('tool_call');
    expect(html).toContain('fleet service intervals');
  });

  it('renders tool_result (success) with content preview', () => {
    const html = renderToString(
      <TimelineEventRenderer
        event={ev('tool_result', {
          tool_use_id: 'tu_123',
          is_error: false,
          content: [{ type: 'text', text: 'Service interval is 5000 miles.' }],
        })}
      />,
    );
    expect(html).toContain('5000 miles');
    expect(html).toContain('tu_123');
    expect(html).not.toContain('error');
  });

  it('renders tool_result (error) with the error badge', () => {
    const html = renderToString(
      <TimelineEventRenderer
        event={ev('tool_result', {
          tool_use_id: 'tu_err',
          is_error: true,
          content: 'oh no',
        })}
      />,
    );
    expect(html).toContain('Error');
    expect(html).toContain('oh no');
  });

  it('renders compact_boundary with the trigger', () => {
    const html = renderToString(
      <TimelineEventRenderer
        event={ev('compact_boundary', {
          compact_metadata: { trigger: 'token_limit' },
        })}
      />,
    );
    expect(html).toContain('compact');
    expect(html).toContain('token_limit');
  });

  it('renders run_result (success) with cost + turns + result text', () => {
    const html = renderToString(
      <TimelineEventRenderer
        event={ev('run_result', {
          subtype: 'success',
          total_cost_usd: 0.0187,
          num_turns: 4,
          duration_ms: 23000,
          result: 'Morning dispatch priorities: ...',
        })}
      />,
    );
    expect(html).toContain('success');
    expect(html).toContain('$0.0187');
    expect(html).toContain('turns=4');
    expect(html).toContain('Morning dispatch priorities');
  });

  it('renders run_result (error) with errors list', () => {
    const html = renderToString(
      <TimelineEventRenderer
        event={ev('run_result', {
          subtype: 'error',
          total_cost_usd: 0.01,
          num_turns: 2,
          duration_ms: 5000,
          errors: ['budget exceeded', 'aborted'],
        })}
      />,
    );
    expect(html).toContain('error');
    expect(html).toContain('budget exceeded');
    expect(html).toContain('aborted');
  });

  it('renders approval_request:opened with awaiting badge + tool name + reason', () => {
    const html = renderToString(
      <TimelineEventRenderer
        event={ev('approval_request', {
          subtype: 'opened',
          gate_id: 'gate-aaaa-1111',
          tool_name: 'Bash',
          proposed_input: { command: 'rm -rf /tmp/x' },
          reason: 'Non-whitelisted Bash: rm -rf /tmp/x',
        })}
      />,
    );
    expect(html).toContain('Awaiting Approval');
    expect(html).toContain('Bash');
    expect(html).toContain('Non-whitelisted Bash');
    expect(html).toContain('gate-aaaa-1111');
  });

  it('renders approval_request:resolved (approved) with the decision badge', () => {
    const html = renderToString(
      <TimelineEventRenderer
        event={ev('approval_request', {
          subtype: 'resolved',
          gate_id: 'gate-aaaa-1111',
          decision: 'approved',
        })}
      />,
    );
    expect(html).toContain('approved');
    expect(html).toContain('gate-aaaa-1111');
  });

  it('renders approval_request:resolved (denied) with the reviewer reason', () => {
    const html = renderToString(
      <TimelineEventRenderer
        event={ev('approval_request', {
          subtype: 'resolved',
          gate_id: 'gate-aaaa-1111',
          decision: 'denied',
          reason: 'too risky',
        })}
      />,
    );
    expect(html).toContain('denied');
    expect(html).toContain('too risky');
  });

  it('renders approval_request:resolved (modified) with modified_input details', () => {
    const html = renderToString(
      <TimelineEventRenderer
        event={ev('approval_request', {
          subtype: 'resolved',
          gate_id: 'gate-aaaa-1111',
          decision: 'modified',
          modified_input: { command: 'rm -rf /tmp/safe_only' },
        })}
      />,
    );
    expect(html).toContain('modified');
    expect(html).toContain('safe_only');
  });

  it('returns null when an approval_request payload lacks a known subtype', () => {
    const html = renderToString(
      <TimelineEventRenderer
        event={ev('approval_request', { gate_id: 'x' })}
      />,
    );
    expect(html).toBe('');
  });

  it('returns null for an unknown event type (forward-compat)', () => {
    const html = renderToString(
      <TimelineEventRenderer
        event={
          // @ts-expect-error — forcing an unknown type to cover default branch
          ev('unknown_type_added_later', {})
        }
      />,
    );
    expect(html).toBe('');
  });
});
