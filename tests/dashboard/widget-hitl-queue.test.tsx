// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { HitlQueue } from '@/components/dashboard/widgets/hitl-queue';

const FX = [
  { id: 'g-1', toolName: 'Write', proposedInput: { file_path: 'invoices/INV-1042.json' }, taskPrompt: 'Re-bill T-998', createdAt: new Date(), status: 'pending' as const },
];

// vitest config has `globals: false`, so RTL doesn't auto-register cleanup.
// Both `it` blocks render the same widget with the same file_path, so without
// per-test cleanup `getByText(/invoices/...)` finds two matches.
afterEach(cleanup);

describe('<HitlQueue />', () => {
  it('renders the count', () => {
    const { getByText } = render(<HitlQueue data={FX as never} />);
    expect(getByText('1')).toBeTruthy();
  });
  it('shows the proposed file_path on the first card', () => {
    const { getByText } = render(<HitlQueue data={FX as never} />);
    expect(getByText(/invoices\/INV-1042\.json/)).toBeTruthy();
  });
});
