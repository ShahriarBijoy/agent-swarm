// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryWritesLime } from '@/components/dashboard/widgets/memory-writes-lime';

describe('<MemoryWritesLime />', () => {
  it('renders the count formatted with comma', () => {
    const { getByText } = render(<MemoryWritesLime data={{ count: 1247, deltaVsYesterday: 184 }} />);
    expect(getByText('1,247')).toBeTruthy();
  });
  it('shows positive delta as "+N more than yesterday"', () => {
    const { getByText } = render(<MemoryWritesLime data={{ count: 100, deltaVsYesterday: 30 }} />);
    expect(getByText(/\+30 more than yesterday/i)).toBeTruthy();
  });
});
