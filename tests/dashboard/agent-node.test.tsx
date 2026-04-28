// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import type { ReactNode } from 'react';
import { AgentNode } from '@/components/dashboard/canvas/agent-node';

afterEach(() => cleanup());

// `<AgentNode />` uses React Flow's `<Handle>` so an edge can attach to it.
// Handle reads from React Flow's zustand store via context, so the test must
// render inside a provider — same as runtime composition.
function withFlow(node: ReactNode) {
  return <ReactFlowProvider>{node}</ReactFlowProvider>;
}

describe('<AgentNode />', () => {
  it('renders agent name + state pill', () => {
    const { getByText } = render(
      withFlow(
        <AgentNode
          data={{ agentName: 'fleet-analyst', state: 'active', toolNames: ['Recall', 'Bash'] }}
          compact={false}
        />,
      ),
    );
    expect(getByText('fleet-analyst')).toBeTruthy();
    expect(getByText(/running/i)).toBeTruthy();
  });
  it('shows red border + gate body when state=hitl', () => {
    const { container, getByText } = render(
      withFlow(
        <AgentNode
          data={{
            agentName: 'billing',
            state: 'hitl',
            toolNames: ['Recall', 'Write'],
            gate: { gateId: 'g-1', toolName: 'Write', proposedInput: { file_path: 'invoices/X.json' } },
          }}
          compact={false}
        />,
      ),
    );
    expect(getByText(/invoices\/X\.json/)).toBeTruthy();
    // The visible AgentNode is the first non-provider child; Provider renders a
    // wrapping div. Find the AgentNode by its data-testid-free `relative` class.
    const agentNode = container.querySelector('div.relative.rounded-\\[10px\\]') as HTMLElement;
    expect(agentNode).toBeTruthy();
    expect(agentNode.className).toMatch(/border-\[var\(--color-red\)\]/);
  });
});
