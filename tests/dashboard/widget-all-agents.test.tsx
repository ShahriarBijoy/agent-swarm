// @vitest-environment jsdom
// tests/dashboard/widget-all-agents.test.tsx
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { AllAgents } from '@/components/dashboard/widgets/all-agents';
import { FIXTURE_ALL_AGENTS } from '@/lib/dashboard/fixtures';

describe('<AllAgents />', () => {
  it('renders avg cost and avg p95 latency stat blocks', () => {
    const { getByText } = render(<AllAgents data={FIXTURE_ALL_AGENTS} />);
    expect(getByText(/\$\s*0\.34/)).toBeTruthy();
    expect(getByText(/2\.4/)).toBeTruthy();
  });
  it('renders one bar per perAgentCost row', () => {
    const { container } = render(<AllAgents data={FIXTURE_ALL_AGENTS} />);
    const bars = container.querySelectorAll('[data-bar="agent-cost"]');
    expect(bars.length).toBe(FIXTURE_ALL_AGENTS.perAgentCost.length);
  });
});
