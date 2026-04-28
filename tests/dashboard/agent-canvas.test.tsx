// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { AgentCanvas } from '@/components/dashboard/canvas/agent-canvas';

// jsdom doesn't ship `ResizeObserver`, but ReactFlow grabs it during render
// to size the viewport. Same no-op stub as widget-cost-line uses for Recharts.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
const g = globalThis as unknown as { ResizeObserver?: unknown };
g.ResizeObserver ??= ResizeObserverStub;

// jsdom also lacks `DOMMatrixReadOnly`, which ReactFlow's zoom panel touches
// during initial layout. A no-op object is enough for the smoke test.
const g2 = globalThis as unknown as { DOMMatrixReadOnly?: unknown };
g2.DOMMatrixReadOnly ??= class {
  m22 = 1;
  constructor() {}
};

afterEach(() => cleanup());

describe('<AgentCanvas />', () => {
  it('renders an empty graph for empty events without throwing', () => {
    const { container } = render(<AgentCanvas events={[]} mode="mini" />);
    expect(container.querySelector('.react-flow')).toBeTruthy();
  });
});
