// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { BentoCell } from '@/components/dashboard/bento-cell';

describe('phase-10 BentoCell', () => {
  it('renders cell key in ALL CAPS mono', () => {
    const { getByText } = render(
      <BentoCell name="Awaiting approvals" gridArea="hitl">
        <div>body</div>
      </BentoCell>,
    );
    const key = getByText(/Awaiting approvals/i);
    expect(key.className).toMatch(/font-mono/);
    expect(key.textContent?.toUpperCase()).toBe(key.textContent);
  });

  it('applies the gridArea inline style', () => {
    const { container } = render(
      <BentoCell name="X" gridArea="lime"><span /></BentoCell>,
    );
    const style = (container.firstChild as HTMLElement).style;
    expect(style.gridArea).toBe('lime');
  });
});
