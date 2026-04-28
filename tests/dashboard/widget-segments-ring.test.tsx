// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemorySegmentsRing } from '@/components/dashboard/widgets/memory-segments-ring';

describe('<MemorySegmentsRing />', () => {
  it('renders the leading segment as bold text', () => {
    const data = {
      segments: [
        { id: 'identity', count: 8, avgImportance: 0.78 },
        { id: 'knowledge', count: 22, avgImportance: 0.64 },
      ],
    };
    const { getByText } = render(<MemorySegmentsRing data={data} />);
    expect(getByText(/identity stable/i)).toBeTruthy();
  });
});
