// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MiniCanvas } from '@/components/dashboard/widgets/mini-canvas';

describe('<MiniCanvas />', () => {
  it('renders empty state when data=null', () => {
    const { getByText } = render(<MiniCanvas data={null} />);
    expect(getByText(/no swarm runs yet/i)).toBeTruthy();
  });
});
