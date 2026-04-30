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
    const { container } = render(<Greeting data={FIXTURE_GREETING} />);
    // The headline is a multi-text-node h2 (it nests an italic span); use a
    // direct querySelector + textContent assertion so testing-library's
    // ancestor-walk doesn't flag the body/div wrappers as duplicate matches.
    const h2 = container.querySelector('h2');
    expect(h2?.textContent).toContain('Hi Shahriar,');
  });
});
