'use client';

import { useMemo } from 'react';
import { Map, MapArc, MapMarker, MarkerContent, MarkerLabel } from '@/components/ui/map';
import { GERMANY_CITIES, type Journey } from '@/lib/dashboard/germany-journeys';

type Segment = Journey['segment'];

type SegmentMeta = { tint: string; ink: string; label: string };

export function ArcsCanvas({
  journeys,
  hoveredId,
  onHover,
  palette,
}: {
  journeys: Journey[];
  hoveredId: string | null;
  onHover: (j: Journey | null) => void;
  palette: Record<Segment, SegmentMeta>;
}) {
  const grouped = useMemo(() => {
    const map: Record<Segment, Journey[]> = {
      sedan: [],
      suv: [],
      van: [],
      truck: [],
    };
    for (const j of journeys) map[j.segment].push(j);
    return map;
  }, [journeys]);

  return (
    <Map
      className="h-full w-full"
      // Centered roughly between Frankfurt and Leipzig — keeps Hamburg ↔ Munich
      // both visible on widget-sized viewports.
      center={[10.4, 51.0]}
      zoom={5.2}
      minZoom={4.5}
      maxZoom={7.5}
      maxBounds={[
        [3.5, 46.5],
        [16.5, 56.5],
      ]}
      attributionControl={false}
      dragRotate={false}
      pitchWithRotate={false}
      touchZoomRotate={false}
      doubleClickZoom={false}
      scrollZoom={false}
      keyboard={false}
    >
      <CityDots />
      {(['sedan', 'suv', 'van', 'truck'] as const).map((segment) => {
        const meta = palette[segment];
        const data = grouped[segment].map((j) => ({
          id: j.id,
          from: [j.from.lng, j.from.lat] as [number, number],
          to: [j.to.lng, j.to.lat] as [number, number],
          journey: j,
        }));
        if (data.length === 0) return null;
        const dimmed = hoveredId != null;
        return (
          <MapArc
            key={segment}
            id={`fleet-${segment}`}
            data={data}
            curvature={curvatureFor(segment)}
            paint={{
              'line-color': meta.tint,
              'line-width': 1.8,
              'line-opacity': dimmed ? 0.18 : 0.78,
            }}
            hoverPaint={{
              'line-width': 3.6,
              'line-opacity': 1,
            }}
            onHover={(e) => {
              if (!e) {
                onHover(null);
                return;
              }
              const j = data.find((d) => d.id === e.arc.id)?.journey ?? null;
              onHover(j);
            }}
            onClick={(e) => {
              const j = data.find((d) => d.id === e.arc.id)?.journey;
              if (j) onHover(j);
            }}
          />
        );
      })}
    </Map>
  );
}

function curvatureFor(segment: Segment): number {
  switch (segment) {
    case 'sedan':
      return 0.18;
    case 'suv':
      return 0.26;
    case 'van':
      return -0.22;
    case 'truck':
      return -0.3;
  }
}

function CityDots() {
  return (
    <>
      {GERMANY_CITIES.map((c) => (
        <CityDot key={c.code} city={c} />
      ))}
    </>
  );
}

function CityDot({ city }: { city: (typeof GERMANY_CITIES)[number] }) {
  return (
    <MapMarker latitude={city.lat} longitude={city.lng}>
      <MarkerContent>
        <span
          aria-hidden
          className="block h-1.5 w-1.5 rounded-full bg-[var(--color-ink)]/55 ring-2 ring-white/95"
        />
      </MarkerContent>
      <MarkerLabel className="rounded-sm bg-white/80 px-1 text-[9px] font-medium text-[var(--color-ink)]/80 backdrop-blur">
        {city.name}
      </MarkerLabel>
    </MapMarker>
  );
}
