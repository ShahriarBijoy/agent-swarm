'use client';

import { MapMarker, MarkerContent } from '@/components/ui/map';
import { cn } from '@/lib/utils';
import { SEGMENT_TINT, type VehicleSegment, type VehicleStatus } from './fleet-status-bar';

export function VehicleMarker({
  vehicle,
  activeTrip,
  selected,
  onClick,
}: {
  vehicle: {
    id: string;
    plate: string;
    segment: VehicleSegment;
    status: VehicleStatus;
    homeLat: number;
    homeLng: number;
  };
  activeTrip?: {
    polyline: Array<[number, number]>;
    actualStartAt: string | null;
    scheduledEndAt: string;
  };
  selected: boolean;
  onClick: () => void;
}) {
  const [lat, lng] = activeTrip?.polyline
    ? interpolate(activeTrip.polyline, computeProgress(activeTrip))
    : [vehicle.homeLat, vehicle.homeLng];

  const tint = SEGMENT_TINT[vehicle.segment];
  const moving = vehicle.status === 'in-use';
  const broken = vehicle.status === 'maintenance';

  return (
    <MapMarker latitude={lat} longitude={lng} onClick={onClick}>
      <MarkerContent>
        <button
          type="button"
          aria-label={`${vehicle.plate} · ${vehicle.status}`}
          className={cn(
            'relative grid place-items-center transition-transform',
            selected ? 'scale-125' : 'hover:scale-110',
          )}
        >
          {moving ? (
            <span
              aria-hidden
              className="absolute h-5 w-5 rounded-full opacity-60 animate-ping"
              style={{ backgroundColor: tint }}
            />
          ) : null}
          <span
            className={cn(
              'relative h-3.5 w-3.5 rounded-full border-2 border-white shadow-[0_1px_4px_rgba(0,0,0,0.4)]',
              broken && 'ring-2 ring-rose-400/60',
              selected && 'ring-2 ring-[var(--color-ink)] ring-offset-1 ring-offset-white',
            )}
            style={{ backgroundColor: tint }}
          />
        </button>
      </MarkerContent>
    </MapMarker>
  );
}

function computeProgress(trip: {
  actualStartAt: string | null;
  scheduledEndAt: string;
}) {
  if (!trip.actualStartAt) return 0;
  const start = new Date(trip.actualStartAt).getTime();
  const end = new Date(trip.scheduledEndAt).getTime();
  return Math.max(0, Math.min(1, (Date.now() - start) / Math.max(1, end - start)));
}

function interpolate(
  polyline: Array<[number, number]>,
  t: number,
): [number, number] {
  if (polyline.length === 0) return [0, 0];
  const idx = Math.min(
    polyline.length - 1,
    Math.floor(t * (polyline.length - 1)),
  );
  return polyline[idx] ?? polyline[0] ?? [0, 0];
}
