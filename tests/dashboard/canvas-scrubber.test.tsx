// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { CanvasScrubber } from '@/components/dashboard/canvas/canvas-scrubber';

afterEach(() => cleanup());

describe('<CanvasScrubber />', () => {
  it('renders one tick per provided event timestamp', () => {
    const { container } = render(
      <CanvasScrubber
        startedAt={new Date('2026-04-27T00:00:00Z')}
        endedAt={new Date('2026-04-27T00:01:00Z')}
        events={[
          { kind: 'tool', t: new Date('2026-04-27T00:00:10Z') },
          { kind: 'gate', t: new Date('2026-04-27T00:00:30Z') },
          { kind: 'tool', t: new Date('2026-04-27T00:00:50Z') },
        ]}
        cursor={null}
        onCursorChange={() => {}}
      />,
    );
    expect(container.querySelectorAll('[data-tick]').length).toBe(3);
  });

  it('fires onCursorChange(null) when "live" button clicked', () => {
    const onCursor = vi.fn();
    const { getByText } = render(
      <CanvasScrubber
        startedAt={new Date()} endedAt={null}
        events={[]} cursor={123} onCursorChange={onCursor}
      />,
    );
    fireEvent.click(getByText(/live/i));
    expect(onCursor).toHaveBeenCalledWith(null);
  });
});
