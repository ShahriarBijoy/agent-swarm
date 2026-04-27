// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { AgentNode } from '@/components/dashboard/canvas/agent-node';

describe('<AgentNode />', () => {
  it('renders agent name + state pill', () => {
    const { getByText } = render(
      <AgentNode
        data={{ agentName: 'fleet-analyst', state: 'active', toolNames: ['Recall', 'Bash'] }}
        compact={false}
      />,
    );
    expect(getByText('fleet-analyst')).toBeTruthy();
    expect(getByText(/running/i)).toBeTruthy();
  });
  it('shows red border + gate body when state=hitl', () => {
    const { container, getByText } = render(
      <AgentNode
        data={{
          agentName: 'billing',
          state: 'hitl',
          toolNames: ['Recall', 'Write'],
          gate: { gateId: 'g-1', toolName: 'Write', proposedInput: { file_path: 'invoices/X.json' } },
        }}
        compact={false}
      />,
    );
    expect(getByText(/invoices\/X\.json/)).toBeTruthy();
    expect((container.firstChild as HTMLElement).className).toMatch(/border-\[var\(--color-red\)\]/);
  });
});
