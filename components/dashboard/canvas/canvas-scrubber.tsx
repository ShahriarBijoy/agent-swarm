// components/dashboard/canvas/canvas-scrubber.tsx
'use client';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

export type ScrubEvent = { kind: 'tool' | 'gate'; t: Date };

export type CanvasScrubberProps = {
  startedAt: Date;
  endedAt: Date | null;
  events: ScrubEvent[];
  /** epoch ms cursor; null = live mode (follow new events) */
  cursor: number | null;
  onCursorChange: (next: number | null) => void;
};

const REPLAY_DURATION_MS = 8000;

export function CanvasScrubber({ startedAt, endedAt, events, cursor, onCursorChange }: CanvasScrubberProps) {
  const start = startedAt.getTime();
  // For terminated tasks `endedAt` is the source of truth and renders identically
  // on server + client. For LIVE tasks we use the latest tick we know about for
  // SSR (deterministic, server-derived from props) and switch to wall-clock once
  // mounted — that's what fixes the React hydration mismatch warning that used
  // to come from `new Date()` running twice with different values.
  const lastTickMs = events.length ? events[events.length - 1]!.t.getTime() : start + 1;
  const [nowMs, setNowMs] = useState<number>(endedAt ? endedAt.getTime() : lastTickMs);
  useEffect(() => {
    if (endedAt) return;
    const tick = () => setNowMs(Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [endedAt]);

  const end = endedAt ? endedAt.getTime() : nowMs;
  const span = Math.max(1, end - start);

  const [playing, setPlaying] = useState(false);
  // Latest values for the rAF loop without re-firing the effect each frame.
  const cursorRef = useRef(cursor);
  cursorRef.current = cursor;
  const endRef = useRef(end);
  endRef.current = end;
  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;

  useEffect(() => {
    if (!playing) return;
    const t0 = performance.now();
    const fromMs = cursorRef.current ?? start;
    const toMs = endRef.current;
    let rafId = 0;

    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / REPLAY_DURATION_MS);
      if (p >= 1) {
        onCursorChangeRef.current(null);
        setPlaying(false);
        return;
      }
      onCursorChangeRef.current(Math.round(fromMs + (toMs - fromMs) * p));
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [playing, start]);

  function togglePlay() {
    if (playing) {
      setPlaying(false);
      return;
    }
    // Restart from the beginning when in live mode or sitting at the tail.
    const atTail = cursor == null || cursor >= end - 50;
    if (atTail) onCursorChange(start);
    setPlaying(true);
  }

  function handleSlide(e: ChangeEvent<HTMLInputElement>) {
    if (playing) setPlaying(false);
    const v = Number(e.currentTarget.value);
    onCursorChange(v >= span ? null : start + v);
  }

  // Bar animation: drive `transform: scaleX()` imperatively so the visual
  // motion runs on the compositor and survives the heavy React Flow re-render
  // cost during replay (otherwise the bar would only "tick" between paints).
  // The cursor state still updates 60×/s for the canvas content; the bar's
  // smooth fill is a CSS transition kicked off once at play-start.
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    if (!playing) return;
    const fromMs = cursorRef.current ?? start;
    const fromProgress = Math.max(0, Math.min(1, (fromMs - start) / span));
    el.style.transition = 'none';
    el.style.transform = `scaleX(${fromProgress})`;
    // Force layout flush so the next style change is interpolated, not snapped.
    void el.offsetHeight;
    el.style.transition = `transform ${REPLAY_DURATION_MS}ms linear`;
    el.style.transform = 'scaleX(1)';
  }, [playing, span, start]);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    if (playing) return;
    const progress = cursor == null ? 1 : Math.max(0, Math.min(1, (cursor - start) / span));
    el.style.transition = 'transform 100ms ease-out';
    el.style.transform = `scaleX(${progress})`;
  }, [cursor, playing, span, start]);

  return (
    <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-5 border-t border-[var(--color-line)] px-7 py-4">
      <button
        type="button"
        onClick={togglePlay}
        aria-label={playing ? 'Pause replay' : 'Replay timeline'}
        className="flex items-center gap-2 rounded-full border border-[var(--color-line-strong)] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-warm)] hover:text-[var(--color-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ink)]/20"
      >
        {playing ? <Pause className="size-3" /> : <Play className="size-3" />}
        <span>{playing ? 'Pause' : 'Replay'}</span>
      </button>
      <div className="relative h-7">
        <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-[var(--color-line-strong)]" />
        <div
          ref={barRef}
          className="pointer-events-none absolute left-0 top-1/2 h-[3px] w-full -translate-y-1/2 rounded-full bg-[var(--color-lime)] shadow-[0_0_8px_var(--color-lime)]"
          style={{ transformOrigin: 'left center' }}
        />
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
