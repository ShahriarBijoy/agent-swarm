// @vitest-environment jsdom
// tests/dashboard/widget-all-agents.test.tsx
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { AllAgents } from '@/components/dashboard/widgets/all-agents';
import { FIXTURE_ALL_AGENTS } from '@/lib/dashboard/fixtures';
import { TooltipProvider } from '@/components/ui/tooltip';

// AllAgents nests Radix Tooltips for per-agent bars; the dashboard layout
// supplies <TooltipProvider /> at runtime, so tests must do the same or
// Radix throws "Tooltip must be used within TooltipProvider".
function renderWithProvider(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe('<AllAgents />', () => {
  it('renders avg cost and avg p95 latency stat blocks', () => {
    const { getByText } = renderWithProvider(<AllAgents data={FIXTURE_ALL_AGENTS} />);
    expect(getByText(/\$\s*0\.34/)).toBeTruthy();
    expect(getByText(/2\.4/)).toBeTruthy();
  });
  it('renders one bar per perAgentCost row', () => {
    const { container } = renderWithProvider(<AllAgents data={FIXTURE_ALL_AGENTS} />);
    const bars = container.querySelectorAll('[data-bar="agent-cost"]');
    expect(bars.length).toBe(FIXTURE_ALL_AGENTS.perAgentCost.length);
  });
});
