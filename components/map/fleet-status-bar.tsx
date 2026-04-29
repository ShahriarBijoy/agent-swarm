'use client';

import { cn } from '@/lib/utils';

type VehicleSegment = 'sedan' | 'suv' | 'van' | 'truck';
type VehicleStatus = 'available' | 'in-use' | 'maintenance';

export type StatusCounts = {
  total: number;
  byStatus: Record<VehicleStatus, number>;
  bySegment: Record<VehicleSegment, number>;
  byDepot: Array<{ depot: string; count: number }>;
};

const DEPOT_LABELS: Record<string, string> = {
  'fleet-east': 'Berlin · East',
  'fleet-central': 'Munich · Central',
  'fleet-west': 'Cologne · West',
};

const SEGMENT_ORDER: VehicleSegment[] = ['sedan', 'suv', 'van', 'truck'];

// Hex tints (kept hex so MapLibre paint expressions can consume the same
// constants without color-parsing fallout).
const SEGMENT_TINT: Record<VehicleSegment, string> = {
  sedan: '#3a6ee0',
  suv:   '#d68a26',
  van:   '#1f9a83',
  truck: '#8a3ec0',
};

export function FleetStatusBar({
  counts,
  segmentFilter,
  onSegmentFilter,
}: {
  counts: StatusCounts;
  segmentFilter: VehicleSegment | null;
  onSegmentFilter: (next: VehicleSegment | null) => void;
}) {
  return (
    <div className="pointer-events-none absolute left-4 top-4 z-10 flex flex-col gap-2">
      <div className="pointer-events-auto inline-flex items-stretch gap-px rounded-full bg-[var(--color-ink)] p-[3px] text-[10.5px] font-mono uppercase tracking-[0.18em] text-white shadow-[0_8px_24px_-8px_rgba(0,0,0,0.35)]">
        <span className="grid place-items-center px-3 text-[10px] text-white/60">
          Fleet · DE
        </span>
        <span className="grid place-items-center rounded-full bg-[var(--color-lime)] px-3 text-[11px] font-semibold tracking-tight text-black tabular-nums">
          {counts.total} vehicles
        </span>
        <span className="grid grid-cols-3 gap-px overflow-hidden rounded-full bg-white/10">
          <StatusPip
            label="Ready"
            count={counts.byStatus.available}
            tone="bg-emerald-400 text-black"
          />
          <StatusPip
            label="In-route"
            count={counts.byStatus['in-use']}
            tone="bg-amber-400 text-black"
          />
          <StatusPip
            label="Service"
            count={counts.byStatus.maintenance}
            tone="bg-rose-400 text-black"
          />
        </span>
      </div>

      <div className="pointer-events-auto inline-flex items-center gap-1 rounded-full bg-white/85 p-1 text-[11px] font-mono uppercase tracking-[0.18em] text-[var(--color-muted)] shadow-[0_8px_24px_-12px_rgba(0,0,0,0.35)] backdrop-blur">
        <button
          type="button"
          aria-pressed={segmentFilter === null}
          onClick={() => onSegmentFilter(null)}
          className={cn(
            'rounded-full px-3 py-1 transition-colors tabular-nums',
            segmentFilter === null
              ? 'bg-[var(--color-ink)] text-white'
              : 'hover:text-[var(--color-ink)]',
          )}
        >
          All · {counts.total}
        </button>
        {SEGMENT_ORDER.map((s) => {
          const active = segmentFilter === s;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={active}
              onClick={() => onSegmentFilter(active ? null : s)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors tabular-nums',
                active
                  ? 'bg-[var(--color-ink)] text-white'
                  : 'hover:text-[var(--color-ink)]',
              )}
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: SEGMENT_TINT[s] }}
              />
              {s} · {counts.bySegment[s] ?? 0}
            </button>
          );
        })}
      </div>

      <div className="pointer-events-auto inline-flex items-center gap-1 self-start rounded-full bg-white/85 p-1 text-[10.5px] font-mono uppercase tracking-[0.16em] text-[var(--color-muted)] shadow-[0_8px_24px_-12px_rgba(0,0,0,0.35)] backdrop-blur">
        {counts.byDepot.map((d) => (
          <span
            key={d.depot}
            className="rounded-full px-3 py-1 tabular-nums"
          >
            {DEPOT_LABELS[d.depot] ?? d.depot} · {d.count}
          </span>
        ))}
      </div>
    </div>
  );
}

function StatusPip({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: string;
}) {
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 px-3 text-[10.5px] tabular-nums',
        tone,
      )}
    >
      <span className="font-semibold tracking-tight">{count}</span>
      <span className="text-[9.5px] tracking-[0.18em] opacity-70">
        {label}
      </span>
    </span>
  );
}

export { SEGMENT_TINT, DEPOT_LABELS, SEGMENT_ORDER };
export type { VehicleSegment, VehicleStatus };
