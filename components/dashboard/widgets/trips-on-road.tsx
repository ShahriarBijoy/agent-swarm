// Server module: holds the widget def and the SQL loader. The client view
// (with MapLibre / MapArc) lives in trips-on-road-view.tsx so the registry's
// `load` function survives the RSC client-reference boundary.
import type { WidgetDef } from '../widget-registry';
import { db } from '@/db/client';
import { vehicles } from '@/db/schema/domain';
import { asc } from 'drizzle-orm';
import { TripsOnRoad } from './trips-on-road-view';

export type FleetVehicle = {
  id: string;
  plate: string;
  segment: 'sedan' | 'suv' | 'van' | 'truck';
};

async function loadFleet(): Promise<FleetVehicle[]> {
  const rows = await db
    .select({
      id: vehicles.id,
      plate: vehicles.plate,
      segment: vehicles.segment,
    })
    .from(vehicles)
    .orderBy(asc(vehicles.plate));
  return rows;
}

export { TripsOnRoad };

export const tripsOnRoadDef: WidgetDef<FleetVehicle[]> = {
  id: 'trips-on-road',
  name: 'Trips · last 5 per vehicle',
  gridArea: 'trips',
  refreshMs: 60_000,
  load: loadFleet,
  Component: TripsOnRoad,
  // Map fills the panel edge-to-edge; the inner rounded clip keeps it tidy.
  panelClassName: 'p-0',
};
