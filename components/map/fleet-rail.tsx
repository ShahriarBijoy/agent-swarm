'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { DEPOT_LABELS, SEGMENT_TINT, type VehicleSegment, type VehicleStatus } from './fleet-status-bar';

type VehicleRow = {
  id: string;
  plate: string;
  make: string;
  model: string;
  year: number;
  segment: VehicleSegment;
  seats: number;
  rangeKm: number;
  odometerKm: number;
  status: VehicleStatus;
  homeLat: number;
  homeLng: number;
  depot: string;
  imageSlug: string;
  dailyRateUsd: string;
  perKmRateUsd: string;
  lastServicedAt: string | null;
  createdAt: string;
};

const STATUS_DOT: Record<VehicleStatus, string> = {
  available: 'bg-emerald-500',
  'in-use': 'bg-amber-500 animate-pulse',
  maintenance: 'bg-rose-500',
};

const STATUS_LABEL: Record<VehicleStatus, string> = {
  available: 'ready',
  'in-use': 'in route',
  maintenance: 'service',
};

export function FleetRail({
  vehicles,
  selectedId,
  onSelect,
}: {
  vehicles: VehicleRow[];
  selectedId: string | null;
  onSelect: (v: VehicleRow) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, VehicleRow[]>();
    for (const v of vehicles) {
      const list = map.get(v.depot) ?? [];
      list.push(v);
      map.set(v.depot, list);
    }
    return Array.from(map.entries()).map(([depot, rows]) => ({
      depot,
      rows: rows.sort((a, b) => a.plate.localeCompare(b.plate)),
    }));
  }, [vehicles]);

  return (
    <aside className="relative flex h-full flex-col overflow-hidden border-l border-[var(--color-line)] bg-[var(--color-surface-warm)]">
      <header className="flex items-baseline justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-2)]">
            Fleet roster
          </p>
          <h2 className="mt-1 text-[18px] font-semibold tracking-tight text-[var(--color-ink)]">
            {vehicles.length} vehicles
          </h2>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted-2)]">
          live · 5s
        </span>
      </header>

      <div className="flex-1 overflow-y-auto">
        {grouped.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-[var(--color-muted)]">
            No vehicles match this filter.
          </div>
        ) : (
          grouped.map(({ depot, rows }) => (
            <section key={depot} className="border-b border-[var(--color-line)] last:border-b-0">
              <div className="sticky top-0 z-[1] flex items-center justify-between bg-[var(--color-surface-warm)]/95 px-5 py-2 backdrop-blur">
                <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
                  {DEPOT_LABELS[depot] ?? depot}
                </span>
                <span className="font-mono text-[10px] tabular-nums text-[var(--color-muted-2)]">
                  {rows.length}
                </span>
              </div>
              <ul className="divide-y divide-[var(--color-line)]">
                {rows.map((v) => {
                  const active = v.id === selectedId;
                  return (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(v)}
                        aria-pressed={active}
                        className={cn(
                          'flex w-full items-center gap-3 px-5 py-3 text-left transition-colors',
                          active
                            ? 'bg-[var(--color-ink)] text-white'
                            : 'hover:bg-black/5',
                        )}
                      >
                        <span
                          aria-hidden
                          className="h-7 w-1 rounded-full"
                          style={{ backgroundColor: SEGMENT_TINT[v.segment] }}
                        />
                        <span className="flex flex-1 flex-col gap-0.5">
                          <span className="flex items-baseline gap-2">
                            <span
                              className={cn(
                                'font-mono text-[12px] tracking-tight tabular-nums',
                                active ? 'text-white' : 'text-[var(--color-ink)]',
                              )}
                            >
                              {v.plate}
                            </span>
                            <span
                              className={cn(
                                'font-mono text-[10px] uppercase tracking-[0.16em]',
                                active ? 'text-white/55' : 'text-[var(--color-muted-2)]',
                              )}
                            >
                              {v.segment}
                            </span>
                          </span>
                          <span
                            className={cn(
                              'truncate text-[12.5px]',
                              active ? 'text-white/85' : 'text-[var(--color-muted)]',
                            )}
                          >
                            {v.make} {v.model}
                          </span>
                        </span>
                        <span className="flex flex-col items-end gap-1">
                          <span className="flex items-center gap-1.5">
                            <span
                              aria-hidden
                              className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[v.status])}
                            />
                            <span
                              className={cn(
                                'font-mono text-[10px] uppercase tracking-[0.14em]',
                                active ? 'text-white/70' : 'text-[var(--color-muted)]',
                              )}
                            >
                              {STATUS_LABEL[v.status]}
                            </span>
                          </span>
                          <span
                            className={cn(
                              'font-mono text-[10.5px] tabular-nums',
                              active ? 'text-white/60' : 'text-[var(--color-muted-2)]',
                            )}
                          >
                            {(v.odometerKm / 1000).toFixed(1)}k km
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>

      <footer className="border-t border-[var(--color-line)] bg-[var(--color-surface-warm)] px-5 py-3 text-[10.5px] font-mono uppercase tracking-[0.18em] text-[var(--color-muted-2)]">
        click marker or row to inspect
      </footer>
    </aside>
  );
}

export type { VehicleRow };
