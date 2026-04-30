'use client';

import { MapMarker, MarkerContent } from '@/components/ui/map';
import { cn } from '@/lib/utils';
import { SEGMENT_TINT, type VehicleSegment, type VehicleStatus } from './fleet-status-bar';

// Depot anchors. Stored homeLat/homeLng can drift from these (test fixtures
// historically used Boston coords); the map positions vehicles relative to
// their depot so markers always plot inside Germany regardless of seed state.
const DEPOT_ANCHOR: Record<string, { lat: number; lng: number }> = {
  'fleet-east': { lat: 52.52, lng: 13.405 }, // Berlin
  'fleet-central': { lat: 48.137, lng: 11.576 }, // Munich
  'fleet-west': { lat: 50.938, lng: 6.96 }, // Cologne
};

const GERMANY_LAT = [46.5, 56.5] as const;
const GERMANY_LNG = [3.5, 16.5] as const;

function inGermany(lat: number, lng: number): boolean {
  return (
    lat >= GERMANY_LAT[0] &&
    lat <= GERMANY_LAT[1] &&
    lng >= GERMANY_LNG[0] &&
    lng <= GERMANY_LNG[1]
  );
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable jitter in [-1, 1] keyed off the vehicle id. */
function jitter(id: string, salt: number): number {
  const h = hashStr(`${id}:${salt}`);
  return (h / 0xffffffff) * 2 - 1;
}

function depotPosition(vehicle: {
  id: string;
  depot: string;
}): [number, number] {
  const anchor = DEPOT_ANCHOR[vehicle.depot];
  if (!anchor) return [51.1, 10.4];
  // Spread vehicles around their depot in a ~25 km cloud so markers don't
  // stack on top of each other when many vehicles share a city.
  return [
    anchor.lat + jitter(vehicle.id, 1) * 0.18,
    anchor.lng + jitter(vehicle.id, 2) * 0.28,
  ];
}

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
    depot: string;
  };
  activeTrip?: {
    polyline: Array<[number, number]>;
    actualStartAt: string | null;
    scheduledEndAt: string;
  };
  selected: boolean;
  onClick: () => void;
}) {
  // For stationary vehicles always use the depot-jittered position. The seed
  // sets every vehicle's home{Lat,Lng} to the depot anchor exactly, so reading
  // those would stack ~14 markers on 3 points — only ~7 dots survive overdraw.
  // depotPosition spreads them in a ~25 km cloud keyed off the vehicle id.
  const [lat, lng] = activeTrip?.polyline?.length
    ? interpolate(activeTrip.polyline, computeProgress(activeTrip))
    : depotPosition(vehicle);

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

export { DEPOT_ANCHOR, depotPosition, inGermany };
