// components/dashboard/widgets/memory-segments-ring.tsx
import type { SegmentSnapshot } from '@/lib/dashboard/queries';
import type { WidgetDef } from '../widget-registry';
import { getMemorySegmentsSnapshot } from '@/lib/dashboard/queries';

export function MemorySegmentsRing({ data }: { data: SegmentSnapshot }) {
  const top = data.segments[0];
  const others = data.segments.slice(1, 3);
  const pct = top ? Math.round(top.avgImportance * 100) : 0;
  const ringDeg = (pct / 100) * 360;

  return (
    <div className="mt-3.5 flex items-center gap-3.5">
      <div
        className="relative grid h-[54px] w-[54px] place-items-center rounded-full"
        style={{ background: `conic-gradient(var(--color-ink) 0 ${ringDeg}deg, rgba(10,10,10,0.08) ${ringDeg}deg 360deg)` }}
      >
        <div className="absolute inset-1.5 rounded-full bg-[var(--color-surface)]" />
        <span className="relative text-[14px] font-semibold tabular-nums">{pct}%</span>
      </div>
      <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
        <strong className="block text-[13px] text-[var(--color-ink)] normal-case tracking-normal font-medium">
          {top ? `${top.id} stable` : 'no segments'}
        </strong>
        {others.map((o, i) => (
          <span key={o.id}>{i > 0 ? ' · ' : ''}{o.id} {Math.round(o.avgImportance * 100)}%</span>
        ))}
      </div>
    </div>
  );
}

export const memorySegmentsRingDef: WidgetDef<SegmentSnapshot> = {
  id: 'memory-segments-ring',
  name: 'Memory segments',
  gridArea: 'refl',
  refreshMs: 30000,
  load: getMemorySegmentsSnapshot,
  Component: MemorySegmentsRing,
};
