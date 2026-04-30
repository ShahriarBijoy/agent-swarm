'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  generateJourneys,
  type Journey,
} from '@/lib/dashboard/germany-journeys';
import type { FleetVehicle } from './trips-on-road';

const SEGMENT_ORDER: FleetVehicle['segment'][] = [
  'sedan',
  'suv',
  'van',
  'truck',
];

// Hex tints (MapLibre rejects oklch() in paint expressions). Picked to feel
// distinct on the warm cream basemap without falling into category-reflex
// cliches (dashboard-blue / safety-orange).
export const SEGMENT_PALETTE: Record<
  FleetVehicle['segment'],
  { tint: string; ink: string; label: string }
> = {
  sedan: { tint: '#3a6ee0', ink: '#1f3f8a', label: 'Sedan' },
  suv:   { tint: '#d68a26', ink: '#7d4c08', label: 'SUV'   },
  van:   { tint: '#1f9a83', ink: '#0d4e43', label: 'Van'   },
  truck: { tint: '#8a3ec0', ink: '#4a1d68', label: 'Truck' },
};

const ArcsCanvas = dynamic(
  () => import('./trips-on-road-arcs').then((m) => m.ArcsCanvas),
  { ssr: false, loading: () => <ArcsSkeleton /> },
);

function ArcsSkeleton() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-[var(--color-ink)]">
      <div className="flex gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-white/30 animate-pulse" />
        <span className="h-1.5 w-1.5 rounded-full bg-white/30 animate-pulse [animation-delay:120ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-white/30 animate-pulse [animation-delay:240ms]" />
      </div>
    </div>
  );
}

export function TripsOnRoad({ data }: { data: FleetVehicle[] }) {
  const [hovered, setHovered] = useState<Journey | null>(null);

  const journeys = useMemo<Journey[]>(
    () =>
      data.flatMap((v) =>
        generateJourneys({
          vehicleId: v.id,
          vehiclePlate: v.plate,
          segment: v.segment,
        }),
      ),
    [data],
  );

  const counts = useMemo(() => {
    const map: Record<FleetVehicle['segment'], number> = {
      sedan: 0,
      suv: 0,
      van: 0,
      truck: 0,
    };
    for (const j of journeys) map[j.segment] += 1;
    return map;
  }, [journeys]);

  const fleetCount = data.length;
  const totalArcs = journeys.length;

  return (
    <div className="relative flex h-full min-h-[420px] flex-col overflow-hidden bg-[var(--color-ink-soft)] text-white">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 pb-3 pt-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">
            Trips · last 5 per vehicle
          </p>
          <h2 className="mt-1 flex items-baseline gap-3 text-[28px] font-semibold leading-none tracking-tight text-white">
            <span className="tabular-nums">{totalArcs}</span>
            <span className="text-[12px] font-normal tracking-normal text-white/55">
              routes across {fleetCount} vehicles · Germany
            </span>
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {SEGMENT_ORDER.map((s) => {
            const meta = SEGMENT_PALETTE[s];
            return (
              <span
                key={s}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/65 tabular-nums"
              >
                <span
                  aria-hidden
                  className="h-1.5 w-3 rounded-full"
                  style={{ backgroundColor: meta.tint }}
                />
                {meta.label} · {counts[s]}
              </span>
            );
          })}
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <ArcsCanvas
          journeys={journeys}
          hoveredId={hovered?.id ?? null}
          onHover={setHovered}
          palette={SEGMENT_PALETTE}
        />
        <HoverCard hovered={hovered} />
      </div>
    </div>
  );
}

function HoverCard({ hovered }: { hovered: Journey | null }) {
  if (!hovered) {
    return (
      <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2 rounded-[10px] border border-white/10 bg-[var(--color-ink)]/70 px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.18em] text-white/55 backdrop-blur">
        <span>hover a route to inspect</span>
        <span>scroll to zoom · Germany · DE</span>
      </div>
    );
  }
  const meta = SEGMENT_PALETTE[hovered.segment];
  return (
    <div
      className="pointer-events-none absolute bottom-3 left-3 right-3 flex items-center gap-3 rounded-[10px] border bg-[var(--color-ink)]/85 px-3 py-2 backdrop-blur"
      style={{ borderColor: meta.tint }}
    >
      <span
        aria-hidden
        className="h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: meta.tint }}
      />
      <div className="flex flex-1 items-baseline gap-2 truncate text-[12px] text-white">
        <span className="font-mono tracking-tight tabular-nums">
          {hovered.vehiclePlate}
        </span>
        <span
          className="font-mono text-[10px] uppercase tracking-[0.18em]"
          style={{ color: meta.tint }}
        >
          {meta.label}
        </span>
        <span className="truncate font-medium tracking-tight">
          {hovered.from.name} → {hovered.to.name}
        </span>
      </div>
      <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-white/45 tabular-nums">
        leg {hovered.legIndex + 1}/5
      </span>
    </div>
  );
}
