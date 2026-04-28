// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CleanupLastNight } from '@/components/dashboard/widgets/cleanup-last-night';

describe('<CleanupLastNight />', () => {
  it('shows three stat tiles: promoted, pruned, contested', () => {
    const { getByText } = render(
      <CleanupLastNight data={{ runStartedAt: new Date(), promoted: 12, pruned: 4, contested: 1 }} />,
    );
    expect(getByText('12')).toBeTruthy();
    expect(getByText('4')).toBeTruthy();
    expect(getByText('1')).toBeTruthy();
  });
  it('renders an empty state when data is null', () => {
    const { getByText } = render(<CleanupLastNight data={null} />);
    expect(getByText(/no cleanup runs yet/i)).toBeTruthy();
  });
});
