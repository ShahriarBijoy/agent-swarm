// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ActiveWorkersBlack } from '@/components/dashboard/widgets/active-workers-black';

describe('<ActiveWorkersBlack />', () => {
  it('shows count over total with a slash', () => {
    const { getByText } = render(<ActiveWorkersBlack data={{ activeAgentNames: ['a','b','c'], totalAgents: 11 }} />);
    expect(getByText(/3\s*\/\s*11/)).toBeTruthy();
  });
});
