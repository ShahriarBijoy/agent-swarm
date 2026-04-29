'use client';

import { useEffect, useState } from 'react';
import { Map, MapRoute } from '@/components/ui/map';
import { VehicleMarker } from './vehicle-marker';
import { VehicleCard } from '@/components/vehicles/vehicle-card';

type VehicleRow = {
  id: string;
  plate: string;
  make: string;
  model: string;
  year: number;
  segment: 'sedan' | 'suv' | 'van' | 'truck';
  seats: number;
  rangeKm: number;
  odometerKm: number;
  status: 'available' | 'in-use' | 'maintenance';
  homeLat: number;
  homeLng: number;
  depot: string;
  imageSlug: string;
  dailyRateUsd: string;
  perKmRateUsd: string;
  lastServicedAt: string | null;
  createdAt: string;
};

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

export function FleetMap() {
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [selected, setSelected] = useState<VehicleRow | null>(null);

  useEffect(() => {
    const tick = async () => {
      const [v, t] = await Promise.all([
        fetch('/api/vehicles').then((r) => r.json()),
        fetch('/api/trips?status=in-route').then((r) => r.json()),
      ]);
      setVehicles(v.vehicles);
      setTrips(t.trips);
    };
    tick();
    const id = setInterval(tick, 5_000);
    return () => clearInterval(id);
  }, []);

  const selectedTrip = selected
    ? trips.find((t) => t.trip.vehicleId === selected.id)
    : undefined;

  return (
    <div className="grid h-[calc(100vh-4rem)] grid-cols-1 md:grid-cols-[1fr_360px]">
      <Map
        className="h-full w-full"
        center={[10.4, 51.1]}
        zoom={6}
      >
        {vehicles.map((v) => (
          <VehicleMarker
            key={v.id}
            vehicle={v}
            onClick={() => setSelected(v)}
            activeTrip={
              trips.find((t) => t.trip.vehicleId === v.id)?.trip
            }
          />
        ))}
        {trips.map((t) => (
          <MapRoute
            key={t.trip.id}
            coordinates={t.trip.polyline.map(([lat, lng]) => [lng, lat])}
            color="#FA692E"
            width={3}
          />
        ))}
      </Map>
      <aside className="overflow-y-auto border-l border-neutral-200 p-4 dark:border-[#1F1F21]">
        {selected ? (
          <VehicleCard
            vehicle={{
              ...selected,
              lastServicedAt: selected.lastServicedAt
                ? new Date(selected.lastServicedAt)
                : null,
            }}
            activeTrip={
              selectedTrip
                ? {
                    id: selectedTrip.trip.id,
                    distanceKm: selectedTrip.trip.distanceKm,
                    actualStartAt: selectedTrip.trip.actualStartAt
                      ? new Date(selectedTrip.trip.actualStartAt)
                      : null,
                    scheduledEndAt: new Date(
                      selectedTrip.trip.scheduledEndAt,
                    ),
                  }
                : undefined
            }
            destinationLabel={selectedTrip?.customer?.name}
          />
        ) : (
          <div className="text-sm text-neutral-500">
            Click a marker to inspect.
          </div>
        )}
      </aside>
    </div>
  );
}
