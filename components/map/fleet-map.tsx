'use client';

import { useEffect, useMemo, useState } from 'react';
import { Map as MapCanvas, MapRoute } from '@/components/ui/map';
import { VehicleMarker } from './vehicle-marker';
import { FleetStatusBar, SEGMENT_TINT, type VehicleSegment, type VehicleStatus, type StatusCounts } from './fleet-status-bar';
import { FleetRail, type VehicleRow } from './fleet-rail';
import { VehicleDetail, type ActiveTrip } from './vehicle-detail';

type TripRow = {
  trip: {
    id: string;
    vehicleId: string;
    polyline: Array<[number, number]>;
    status: string;
    distanceKm: string;
    actualStartAt: string | null;
    scheduledEndAt: string;
  };
  vehicle: VehicleRow | null;
  customer: { name: string; email: string } | null;
};

const ALL_DEPOTS: Array<VehicleRow['depot']> = ['fleet-east', 'fleet-central', 'fleet-west'];

export function FleetMap() {
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [segmentFilter, setSegmentFilter] = useState<VehicleSegment | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [v, t] = await Promise.all([
          fetch('/api/vehicles').then((r) => r.json()),
          fetch('/api/trips?status=in-route').then((r) => r.json()),
        ]);
        if (cancelled) return;
        setVehicles(v.vehicles ?? []);
        setTrips(t.trips ?? []);
      } catch {
        // network blip — next tick will retry
      }
    };
    tick();
    const id = setInterval(tick, 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const filtered = useMemo(
    () =>
      segmentFilter == null
        ? vehicles
        : vehicles.filter((v) => v.segment === segmentFilter),
    [vehicles, segmentFilter],
  );

  const counts: StatusCounts = useMemo(() => {
    const byStatus: Record<VehicleStatus, number> = {
      available: 0,
      'in-use': 0,
      maintenance: 0,
    };
    const bySegment: Record<VehicleSegment, number> = {
      sedan: 0,
      suv: 0,
      van: 0,
      truck: 0,
    };
    const depotCounts = new Map<string, number>();
    for (const v of vehicles) {
      byStatus[v.status] = (byStatus[v.status] ?? 0) + 1;
      bySegment[v.segment] = (bySegment[v.segment] ?? 0) + 1;
      depotCounts.set(v.depot, (depotCounts.get(v.depot) ?? 0) + 1);
    }
    return {
      total: vehicles.length,
      byStatus,
      bySegment,
      byDepot: ALL_DEPOTS.map((d) => ({ depot: d, count: depotCounts.get(d) ?? 0 })),
    };
  }, [vehicles]);

  const selected = useMemo(
    () => vehicles.find((v) => v.id === selectedId) ?? null,
    [vehicles, selectedId],
  );

  const selectedTrip = useMemo<ActiveTrip | undefined>(() => {
    if (!selected) return undefined;
    const row = trips.find((t) => t.trip.vehicleId === selected.id);
    if (!row) return undefined;
    return {
      id: row.trip.id,
      distanceKm: row.trip.distanceKm,
      actualStartAt: row.trip.actualStartAt,
      scheduledEndAt: row.trip.scheduledEndAt,
      customerName: row.customer?.name ?? null,
    };
  }, [selected, trips]);

  return (
    <div className="grid h-[calc(100vh-4rem)] grid-cols-1 md:grid-cols-[1fr_360px]">
      <div className="relative">
        <MapCanvas
          className="h-full w-full"
          center={[10.4, 51.1]}
          zoom={5.6}
          maxZoom={11}
          minZoom={4.5}
          maxBounds={[
            [3.5, 46.5],
            [16.5, 56.5],
          ]}
        >
          {filtered.map((v) => (
            <VehicleMarker
              key={v.id}
              vehicle={v}
              selected={v.id === selectedId}
              onClick={() => setSelectedId(v.id)}
              activeTrip={trips.find((t) => t.trip.vehicleId === v.id)?.trip}
            />
          ))}
          {filtered
            .map((v) => trips.find((t) => t.trip.vehicleId === v.id))
            .filter((t): t is TripRow => t != null)
            .map((t) => {
              const veh = vehicles.find((x) => x.id === t.trip.vehicleId);
              const tint = veh ? SEGMENT_TINT[veh.segment] : '#FA692E';
              return (
                <MapRoute
                  key={t.trip.id}
                  coordinates={t.trip.polyline.map(([lat, lng]) => [lng, lat])}
                  color={tint}
                  width={selectedId === t.trip.vehicleId ? 4 : 2.5}
                  opacity={selectedId === t.trip.vehicleId ? 0.95 : 0.55}
                />
              );
            })}
        </MapCanvas>
        <FleetStatusBar
          counts={counts}
          segmentFilter={segmentFilter}
          onSegmentFilter={setSegmentFilter}
        />
      </div>

      {selected ? (
        <VehicleDetail
          vehicle={selected}
          activeTrip={selectedTrip}
          onBack={() => setSelectedId(null)}
        />
      ) : (
        <FleetRail
          vehicles={filtered}
          selectedId={selectedId}
          onSelect={(v) => setSelectedId(v.id)}
        />
      )}
    </div>
  );
}
