import type { WidgetDef } from '../widget-registry';
import { db } from '@/db/client';
import { trips, vehicles, customers } from '@/db/schema/domain';
import { eq } from 'drizzle-orm';

type ActiveTrip = {
  tripId: string;
  customerName: string;
  plate: string;
  distanceKm: string;
  progress: number;
};

async function loadTripsOnRoad(): Promise<ActiveTrip[]> {
  const rows = await db
    .select({
      tripId: trips.id,
      customerName: customers.name,
      plate: vehicles.plate,
      distanceKm: trips.distanceKm,
      actualStartAt: trips.actualStartAt,
      scheduledEndAt: trips.scheduledEndAt,
    })
    .from(trips)
    .leftJoin(vehicles, eq(trips.vehicleId, vehicles.id))
    .leftJoin(customers, eq(trips.customerId, customers.id))
    .where(eq(trips.status, 'in-route'))
    .limit(5);

  const now = Date.now();
  return rows.map((r) => {
    const start = r.actualStartAt ? r.actualStartAt.getTime() : now;
    const end = r.scheduledEndAt.getTime();
    const total = Math.max(1, end - start);
    const progress = Math.max(0, Math.min(1, (now - start) / total));
    return {
      tripId: r.tripId,
      customerName: r.customerName ?? 'Unknown',
      plate: r.plate ?? '—',
      distanceKm: r.distanceKm,
      progress,
    };
  });
}

export function TripsOnRoad({ data }: { data: ActiveTrip[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <div className="text-[30px] font-semibold leading-none tabular-nums">0</div>
        <div className="mt-1.5 text-[12px] text-[var(--color-muted)]">trips on road</div>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="text-[30px] font-semibold leading-none tabular-nums">{data.length}</div>
      <div className="mt-1.5 text-[12px] text-[var(--color-muted)]">
        {data.length === 1 ? 'trip on road' : 'trips on road'}
      </div>
      <div className="mt-3 space-y-2">
        {data.map((t) => (
          <div
            key={t.tripId}
            className="flex items-center gap-2 rounded-[8px] border border-[var(--color-border)] p-2"
          >
            <div className="flex-1 truncate">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
                {t.plate}
              </div>
              <div className="text-[11px] leading-tight">{t.customerName}</div>
            </div>
            <div className="flex w-16 flex-col items-end gap-0.5">
              <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all"
                  style={{ width: `${Math.round(t.progress * 100)}%` }}
                />
              </div>
              <span className="font-mono text-[9px] text-[var(--color-muted)]">
                {Math.round(Number(t.distanceKm))} km
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const tripsOnRoadDef: WidgetDef<ActiveTrip[]> = {
  id: 'trips-on-road',
  name: 'Trips on road',
  gridArea: 'trips',
  refreshMs: 3000,
  load: loadTripsOnRoad,
  Component: TripsOnRoad,
};
