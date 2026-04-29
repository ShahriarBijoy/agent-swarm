import { and, eq, gte, sql } from 'drizzle-orm';
import { db, dbPool } from '@/db/client';
import { customers, invoices, trips, vehicles } from '@/db/schema/domain';

export type QueryVehiclesArgs = {
  status?: 'available' | 'in-use' | 'maintenance';
  segment?: 'sedan' | 'suv' | 'van' | 'truck';
  seats_min?: number;
  range_min_km?: number;
};

export async function queryVehicles(args: QueryVehiclesArgs) {
  const filters = [];
  if (args.status) filters.push(eq(vehicles.status, args.status));
  if (args.segment) filters.push(eq(vehicles.segment, args.segment));
  if (args.seats_min !== undefined) filters.push(gte(vehicles.seats, args.seats_min));
  if (args.range_min_km !== undefined) filters.push(gte(vehicles.rangeKm, args.range_min_km));
  return db
    .select()
    .from(vehicles)
    .where(filters.length ? and(...filters) : undefined);
}

export async function checkVehicleHealth(vehicleId: string) {
  const [row] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
  if (!row) return { ok: false, flags: ['unknown_vehicle'] };
  const flags: string[] = [];
  if (row.status === 'maintenance') flags.push('in_maintenance');
  if (row.lastServicedAt) {
    const days = (Date.now() - row.lastServicedAt.getTime()) / 86_400_000;
    if (days > 90) flags.push('overdue_service');
  }
  return {
    ok: flags.length === 0,
    last_serviced_at: row.lastServicedAt,
    odometer_km: row.odometerKm,
    flags,
  };
}

export async function getTripStatus(args: { trip_id?: string; customer_email?: string }) {
  let trip;
  if (args.trip_id) {
    [trip] = await db.select().from(trips).where(eq(trips.id, args.trip_id));
  } else if (args.customer_email) {
    const [cust] = await db.select().from(customers).where(eq(customers.email, args.customer_email));
    if (!cust) return null;
    [trip] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.customerId, cust.id), sql`${trips.status} IN ('confirmed','in-route')`))
      .limit(1);
  }
  if (!trip) return null;
  const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, trip.vehicleId));
  const [customer] = await db.select().from(customers).where(eq(customers.id, trip.customerId));
  return { trip, vehicle, customer };
}

export async function queryCustomerHistory(args: { email?: string; customer_id?: string }) {
  let customer;
  if (args.customer_id) {
    [customer] = await db.select().from(customers).where(eq(customers.id, args.customer_id));
  } else if (args.email) {
    [customer] = await db.select().from(customers).where(eq(customers.email, args.email));
  }
  if (!customer) return null;
  const tripRows = await db.select().from(trips).where(eq(trips.customerId, customer.id));
  const totalSpend = tripRows.reduce((sum, t) => sum + Number(t.totalCostUsd), 0);
  return { customer, trips: tripRows, total_spend_usd: totalSpend };
}

const KM_PER_DEG = 111;
const ROAD_FACTOR = 1.25;

export function computeRoute(args: {
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
}): { distance_km: number; eta_minutes: number; polyline: Array<[number, number]> } {
  const dLat = args.dropoff.lat - args.pickup.lat;
  const dLng = args.dropoff.lng - args.pickup.lng;
  const haversineKm = Math.sqrt(dLat * dLat + dLng * dLng) * KM_PER_DEG;
  const distance_km = Math.round(haversineKm * ROAD_FACTOR * 10) / 10;
  const eta_minutes = Math.round((distance_km / 60) * 60); // assume 60 km/h
  const polyline: Array<[number, number]> = Array.from({ length: 32 }, (_, i) => {
    const t = i / 31;
    return [args.pickup.lat + dLat * t, args.pickup.lng + dLng * t];
  });
  return { distance_km, eta_minutes, polyline };
}

export function quoteRental(args: {
  vehicle: { dailyRateUsd: string; perKmRateUsd: string };
  distance_km: number;
  days: number;
}) {
  const base = Number(args.vehicle.dailyRateUsd) * args.days;
  const perKm = Number(args.vehicle.perKmRateUsd) * args.distance_km;
  const insurance = base * 0.08;
  const subtotal = base + perKm + insurance;
  const service_fee = subtotal * 0.085;
  const total = subtotal + service_fee;
  return {
    base_usd: round2(base),
    per_km_usd: round2(perKm),
    insurance_usd: round2(insurance),
    service_fee_usd: round2(service_fee),
    total_usd: round2(total),
    breakdown: [
      `Base ${args.days}d × $${args.vehicle.dailyRateUsd}/day = $${round2(base)}`,
      `Distance ${args.distance_km} km × $${args.vehicle.perKmRateUsd}/km = $${round2(perKm)}`,
      `Insurance (8%) = $${round2(insurance)}`,
      `Service fee (8.5%) = $${round2(service_fee)}`,
    ],
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function proposeRental(args: {
  customer_id: string;
  vehicle_id: string;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  scheduled_start_at: Date;
  scheduled_end_at: Date;
  distance_km: number;
  total_usd: number;
  tax_usd: number;
  polyline: Array<[number, number]>;
  task_id?: string;
}) {
  return dbPool.transaction(async (tx) => {
    const [trip] = await tx
      .insert(trips)
      .values({
        customerId: args.customer_id,
        vehicleId: args.vehicle_id,
        status: 'confirmed',
        pickupLat: args.pickup.lat,
        pickupLng: args.pickup.lng,
        dropoffLat: args.dropoff.lat,
        dropoffLng: args.dropoff.lng,
        scheduledStartAt: args.scheduled_start_at,
        scheduledEndAt: args.scheduled_end_at,
        distanceKm: args.distance_km.toString(),
        totalCostUsd: args.total_usd.toString(),
        polyline: args.polyline,
        ...(args.task_id ? { taskId: args.task_id } : {}),
      })
      .returning();
    const dueAt = new Date(args.scheduled_start_at);
    dueAt.setDate(dueAt.getDate() - 1);
    const [invoice] = await tx
      .insert(invoices)
      .values({
        tripId: trip!.id,
        customerId: args.customer_id,
        amountUsd: (args.total_usd - args.tax_usd).toString(),
        taxUsd: args.tax_usd.toString(),
        totalUsd: args.total_usd.toString(),
        status: 'draft',
        dueAt,
      })
      .returning();
    await tx
      .update(vehicles)
      .set({ status: 'in-use' })
      .where(eq(vehicles.id, args.vehicle_id));
    return { trip: trip!, invoice: invoice! };
  });
}

export async function chargeInvoice(args: { invoice_id: string }) {
  const [invoice] = await db
    .update(invoices)
    .set({ status: 'paid', paidAt: new Date() })
    .where(eq(invoices.id, args.invoice_id))
    .returning();
  if (!invoice) throw new Error(`invoice ${args.invoice_id} not found`);
  return { invoice };
}

