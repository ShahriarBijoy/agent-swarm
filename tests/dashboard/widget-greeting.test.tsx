// @vitest-environment jsdom
// tests/dashboard/widget-greeting.test.tsx
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Greeting } from '@/components/dashboard/widgets/greeting';
import { FIXTURE_GREETING } from '@/lib/dashboard/fixtures';

describe('<Greeting />', () => {
  it('renders italic-serif "here\'s" inside the headline', () => {
    const { getByText } = render(<Greeting data={FIXTURE_GREETING} />);
    const ital = getByText(/here's/i);
    expect(ital.className).toMatch(/font-serif-italic/);
  });

  it('highlights the latest month bar in lime', () => {
    const { container } = render(<Greeting data={FIXTURE_GREETING} />);
    const limeBar = container.querySelector('[data-month="oct"]');
    expect(limeBar?.className).toMatch(/bg-\[var\(--color-lime\)\]/);
  });

  it('formats totalThisMonth with thousands separator', () => {
    const { getByText } = render(<Greeting data={{ ...FIXTURE_GREETING, totalThisMonth: 12345 }} />);
    expect(getByText(/12,345/)).toBeTruthy();
  });

  it('renders the operator name from process.env.OPERATOR_NAME', () => {
    process.env.OPERATOR_NAME = 'Shahriar';
    const { getByText } = render(<Greeting data={FIXTURE_GREETING} />);
    // Match across the multi-text-node headline by scoping to the <h2> tag —
    // textContent on ancestors (<body>, wrapper <div>s) also contains the
    // substring, so getByText would otherwise see multiple matches.
    expect(
      getByText(
        (_, node) =>
          node?.tagName === 'H2' &&
          (node?.textContent?.includes('Hi Shahriar,') ?? false),
      ),
    ).toBeTruthy();
  });
});
