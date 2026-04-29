'use client';

import { useMemo } from 'react';
import {
  Map as MapCanvas,
  MapRoute,
  MapMarker,
  MarkerContent,
  MarkerLabel,
} from '@/components/ui/map';
import { GERMANY_CITIES, type Journey } from '@/lib/dashboard/germany-journeys';
import {
  pairKey,
  synthRoute,
  type RoutePolyline,
} from '@/lib/dashboard/osrm-routes';

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
  const routes = useMemo<Map<string, RoutePolyline>>(() => {
    const m = new Map<string, RoutePolyline>();
    for (const j of journeys) {
      const k = pairKey(j.from, j.to);
      if (!m.has(k)) m.set(k, synthRoute(j.from, j.to));
    }
    return m;
  }, [journeys]);

  return (
    <MapCanvas
      className="h-full w-full"
      theme="dark"
      // Centered roughly between Frankfurt and Leipzig — keeps Hamburg ↔ Munich
      // both visible on widget-sized viewports.
      center={[10.4, 51.0]}
      zoom={5.2}
      minZoom={4.5}
      maxZoom={9}
      maxBounds={[
        [3.5, 46.5],
        [16.5, 56.5],
      ]}
      attributionControl={false}
      dragRotate={false}
      pitchWithRotate={false}
      doubleClickZoom={true}
      scrollZoom={true}
      keyboard={true}
    >
      <CityDots />
      {journeys.map((j) => {
        const key = pairKey(j.from, j.to);
        const coords = routes.get(key);
        if (!coords) return null;
        const meta = palette[j.segment];
        const isHovered = hoveredId === j.id;
        const dimmed = hoveredId != null && !isHovered;
        return (
          <MapRoute
            key={j.id}
            id={j.id}
            coordinates={coords}
            color={meta.tint}
            width={isHovered ? 4 : 2}
            opacity={dimmed ? 0.18 : isHovered ? 1 : 0.78}
            onMouseEnter={() => onHover(j)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onHover(j)}
          />
        );
      })}
    </MapCanvas>
  );
}

function CityDots() {
  return (
    <>
      {GERMANY_CITIES.map((city) => (
        <MapMarker key={city.code} latitude={city.lat} longitude={city.lng}>
          <MarkerContent>
            <span
              aria-hidden
              className="block h-1.5 w-1.5 rounded-full bg-white/85 ring-2 ring-[var(--color-ink-soft)]/85"
            />
          </MarkerContent>
          <MarkerLabel className="rounded-sm bg-[var(--color-ink-soft)]/75 px-1 text-[9px] font-medium text-white/85 backdrop-blur">
            {city.name}
          </MarkerLabel>
        </MapMarker>
      ))}
    </>
  );
}
