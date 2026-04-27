// components/dashboard/canvas/canvas-scrubber.tsx
'use client';
import { ChangeEvent } from 'react';

export type ScrubEvent = { kind: 'tool' | 'gate'; t: Date };

export type CanvasScrubberProps = {
  startedAt: Date;
  endedAt: Date | null;
  events: ScrubEvent[];
  /** epoch ms cursor; null = live mode (follow new events) */
  cursor: number | null;
  onCursorChange: (next: number | null) => void;
};

export function CanvasScrubber({ startedAt, endedAt, events, cursor, onCursorChange }: CanvasScrubberProps) {
  const start = startedAt.getTime();
  const end = (endedAt ?? new Date()).getTime();
  const span = Math.max(1, end - start);

  function handleSlide(e: ChangeEvent<HTMLInputElement>) {
    const v = Number(e.currentTarget.value);
    onCursorChange(v >= span ? null : start + v);
  }

  return (
    <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-5 border-t border-[var(--color-line)] px-7 py-4">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-2)]">
        Replay
      </span>
      <div className="relative h-7">
        <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-[var(--color-line-strong)]" />
        {events.map((ev, i) => {
          const left = ((ev.t.getTime() - start) / span) * 100;
          const cls = ev.kind === 'gate'
            ? 'bg-[var(--color-red)]'
            : 'bg-[var(--color-ink)]';
          return (
            <div
              key={i}
              data-tick={ev.kind}
              className={`absolute top-1/2 h-3 w-px -translate-y-1/2 ${cls}`}
              style={{ left: `${left}%` }}
            />
          );
        })}
        <input
          type="range"
          min={0}
          max={span}
          value={cursor == null ? span : cursor - start}
          onChange={handleSlide}
          className="absolute inset-0 w-full opacity-0"
        />
      </div>
      <span className="font-mono text-[11px] tabular-nums text-[var(--color-muted)]">
        {cursor == null ? 'live' : new Date(cursor).toLocaleTimeString()}
      </span>
      <button
        onClick={() => onCursorChange(null)}
        className="rounded-[2px] border border-[var(--color-line-strong)] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]"
      >
        Live
      </button>
    </div>
  );
}
