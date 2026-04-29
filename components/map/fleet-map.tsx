'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Map as MapCanvas, MapRoute } from '@/components/ui/map';
import {
  Frame,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';
import { VehicleCard } from '@/components/vehicles/vehicle-card';
import { VehicleMarker } from './vehicle-marker';
import {
  FleetStatusBar,
  SEGMENT_TINT,
  type VehicleSegment,
  type VehicleStatus,
  type StatusCounts,
} from './fleet-status-bar';
import { FleetRail, type VehicleRow } from './fleet-rail';

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

  const selectedTripRow = useMemo<TripRow | undefined>(
    () => (selected ? trips.find((t) => t.trip.vehicleId === selected.id) : undefined),
    [selected, trips],
  );

  return (
    <div
      className="grid h-[calc(100vh-7rem)] gap-[14px]"
      style={{ gridTemplateColumns: 'minmax(0,1fr) 420px' }}
    >
      <Frame
        variant="ghost"
        spacing="sm"
        className="min-h-0 rounded-[18px] bg-[var(--color-bg-2)]/55"
      >
        <FrameHeader className="flex-row items-center justify-between">
          <FrameTitle className="font-mono text-[9.5px] font-medium uppercase tracking-[0.22em] text-[var(--color-muted-2)]">
            FLEET MAP · DE
          </FrameTitle>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--color-muted-2)] tabular-nums">
            {filtered.length}/{vehicles.length} on map
          </span>
        </FrameHeader>
        <FramePanel className="relative min-h-0 flex-1 overflow-hidden border-[var(--color-line)] bg-[var(--color-surface-warm)] p-0">
          <MapCanvas
            className="h-full w-full"
            center={[10.4, 51.1]}
            zoom={5.4}
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
                    opacity={selectedId === t.trip.vehicleId ? 0.95 : 0.5}
                  />
                );
              })}
          </MapCanvas>
          <FleetStatusBar
            counts={counts}
            segmentFilter={segmentFilter}
            onSegmentFilter={setSegmentFilter}
          />
        </FramePanel>
      </Frame>

      <Frame
        variant="ghost"
        spacing="sm"
        className="min-h-0 rounded-[18px] bg-[var(--color-bg-2)]/55"
      >
        <FrameHeader className="flex-row items-center justify-between">
          <FrameTitle className="font-mono text-[9.5px] font-medium uppercase tracking-[0.22em] text-[var(--color-muted-2)]">
            {selected ? `VEHICLE · ${selected.plate}` : 'FLEET ROSTER'}
          </FrameTitle>
          {selected ? (
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--color-muted)] transition-colors hover:bg-black/5 hover:text-[var(--color-ink)]"
            >
              <ArrowLeft size={11} /> roster
            </button>
          ) : (
            <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--color-muted-2)] tabular-nums">
              live · 5s
            </span>
          )}
        </FrameHeader>
        <FramePanel className="min-h-0 flex-1 overflow-hidden border-[var(--color-line)] bg-[var(--color-surface-warm)] p-0">
          {selected ? (
            <div className="h-full overflow-y-auto px-3 py-4">
              <VehicleCard
                vehicle={{
                  ...selected,
                  lastServicedAt: selected.lastServicedAt
                    ? new Date(selected.lastServicedAt)
                    : null,
                }}
                activeTrip={
                  selectedTripRow
                    ? {
                        id: selectedTripRow.trip.id,
                        distanceKm: selectedTripRow.trip.distanceKm,
                        actualStartAt: selectedTripRow.trip.actualStartAt
                          ? new Date(selectedTripRow.trip.actualStartAt)
                          : null,
                        scheduledEndAt: new Date(
                          selectedTripRow.trip.scheduledEndAt,
                        ),
                      }
                    : undefined
                }
                destinationLabel={selectedTripRow?.customer?.name}
              />
            </div>
          ) : (
            <FleetRail
              vehicles={filtered}
              selectedId={selectedId}
              onSelect={(v) => setSelectedId(v.id)}
            />
          )}
        </FramePanel>
      </Frame>
    </div>
  );
}
