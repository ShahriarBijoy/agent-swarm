'use client';

import { MapMarker, MarkerContent } from '@/components/ui/map';

const COLOR = {
  available: '#22c55e',
  'in-use': '#f59e0b',
  maintenance: '#ef4444',
} as const;

export function VehicleMarker({
  vehicle,
  activeTrip,
  onClick,
}: {
  vehicle: {
    id: string;
    plate: string;
    status: 'available' | 'in-use' | 'maintenance';
    homeLat: number;
    homeLng: number;
  };
  activeTrip?: {
    polyline: Array<[number, number]>;
    actualStartAt: string | null;
    scheduledEndAt: string;
  };
  onClick: () => void;
}) {
  const [lat, lng] =
    activeTrip?.polyline
      ? interpolate(activeTrip.polyline, computeProgress(activeTrip))
      : [vehicle.homeLat, vehicle.homeLng];
  return (
    <MapMarker latitude={lat} longitude={lng} onClick={onClick}>
      <MarkerContent>
        <button
          aria-label={`${vehicle.plate} ${vehicle.status}`}
          className="h-3 w-3 rounded-full border-2 border-white shadow"
          style={{
            backgroundColor: COLOR[vehicle.status],
          }}
        />
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
  return polyline[idx];
}
