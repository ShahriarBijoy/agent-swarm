import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '@/db/client';
import { customers, invoices, trips, vehicles } from '@/db/schema/domain';
import {
  checkVehicleHealth,
  computeRoute,
  getTripStatus,
  queryCustomerHistory,
  queryVehicles,
  quoteRental,
  proposeRental,
  chargeInvoice,
} from '@/db/queries/domain';
import { eq } from 'drizzle-orm';

// ─── Shared seed helper ─────────────────────────────────────────────────────
// Idempotent: upserts the two canonical test vehicles so every describe block
// can call this from its own beforeAll without relying on execution order.

async function ensureSeedVehicles() {
  const seed = [
    {
      plate: 'TST-S-001',
      make: 'Honda',
      model: 'Accord',
      year: 2024,
      segment: 'sedan' as const,
      seats: 5,
      rangeKm: 650,
      homeLat: 42.36,
      homeLng: -71.06,
      depot: 'fleet-east',
      imageSlug: 'honda-accord',
      dailyRateUsd: '95.00',
      perKmRateUsd: '0.2800',
      status: 'available' as const,
    },
    {
      plate: 'TST-X-001',
      make: 'Honda',
      model: 'CR-V',
      year: 2024,
      segment: 'suv' as const,
      seats: 5,
      rangeKm: 720,
      homeLat: 42.36,
      homeLng: -71.06,
      depot: 'fleet-east',
      imageSlug: 'honda-cr-v',
      dailyRateUsd: '115.00',
      perKmRateUsd: '0.3400',
      status: 'in-use' as const,
    },
  ] as const;

  for (const v of seed) {
    await db
      .insert(vehicles)
      .values(v)
      .onConflictDoUpdate({
        target: vehicles.plate,
        set: { status: v.status, segment: v.segment, seats: v.seats, rangeKm: v.rangeKm },
      });
  }
}

// ─── queryVehicles ──────────────────────────────────────────────────────────

describe('queryVehicles', () => {
  beforeAll(async () => {
    // Delete in FK order: invoices → trips → customers → vehicles
    await db.delete(invoices);
    await db.delete(trips);
    await db.delete(customers);
    await db.delete(vehicles);

    // Re-seed via the shared helper (idempotent upsert)
    await ensureSeedVehicles();
  });

  it('filters by status', async () => {
    const rows = await queryVehicles({ status: 'available' });
    expect(rows.map((v) => v.plate)).toEqual(['TST-S-001']);
  });

  it('filters by segment', async () => {
    const rows = await queryVehicles({ segment: 'suv' });
    expect(rows.map((v) => v.plate)).toEqual(['TST-X-001']);
  });

  it('filters by seats_min', async () => {
    const rows = await queryVehicles({ seats_min: 5 });
    expect(rows).toHaveLength(2);
  });

  it('filters by range_min_km', async () => {
    const rows = await queryVehicles({ range_min_km: 700 });
    expect(rows.map((v) => v.plate)).toEqual(['TST-X-001']);
  });
});

// ─── checkVehicleHealth ─────────────────────────────────────────────────────

describe('checkVehicleHealth', () => {
  beforeAll(async () => {
    await ensureSeedVehicles();
  });

  it('returns ok for an available vehicle with no lastServicedAt', async () => {
    const [vehicle] = await queryVehicles({ status: 'available' });
    const result = await checkVehicleHealth(vehicle!.id);
    expect(result.ok).toBe(true);
    expect(result.flags).toEqual([]);
  });

  it('flags maintenance status', async () => {
    // Upsert to tolerate re-runs (plate is unique)
    const [row] = await db
      .insert(vehicles)
      .values({
        plate: 'TST-M-001',
        make: 'Ford',
        model: 'Transit',
        year: 2022,
        segment: 'van',
        seats: 8,
        rangeKm: 500,
        homeLat: 42.36,
        homeLng: -71.06,
        depot: 'fleet-west',
        imageSlug: 'ford-transit',
        dailyRateUsd: '130.00',
        perKmRateUsd: '0.3500',
        status: 'maintenance',
      })
      .onConflictDoUpdate({
        target: vehicles.plate,
        set: { status: 'maintenance' },
      })
      .returning();
    const result = await checkVehicleHealth(row!.id);
    expect(result.ok).toBe(false);
    expect(result.flags).toContain('in_maintenance');
  });

  it('flags overdue service (>90 days)', async () => {
    const overdueDate = new Date(Date.now() - 91 * 86_400_000); // 91 days ago
    const [row] = await db
      .insert(vehicles)
      .values({
        plate: 'TST-O-001',
        make: 'Toyota',
        model: 'Camry',
        year: 2021,
        segment: 'sedan',
        seats: 5,
        rangeKm: 600,
        homeLat: 42.36,
        homeLng: -71.06,
        depot: 'fleet-east',
        imageSlug: 'toyota-camry',
        dailyRateUsd: '90.00',
        perKmRateUsd: '0.2500',
        status: 'available',
        lastServicedAt: overdueDate,
      })
      .onConflictDoUpdate({
        target: vehicles.plate,
        set: { status: 'available', lastServicedAt: overdueDate },
      })
      .returning();
    const result = await checkVehicleHealth(row!.id);
    expect(result.ok).toBe(false);
    expect(result.flags).toContain('overdue_service');
  });

  it('returns flags=["unknown_vehicle"] for an unknown id', async () => {
    const result = await checkVehicleHealth('00000000-0000-0000-0000-000000000000');
    expect(result.ok).toBe(false);
    expect(result.flags).toEqual(['unknown_vehicle']);
  });
});

// ─── getTripStatus ──────────────────────────────────────────────────────────

describe('getTripStatus', () => {
  let customerId: string;
  let vehicleId: string;
  let tripId: string;

  beforeAll(async () => {
    await ensureSeedVehicles();

    // Pick the available vehicle
    const [v] = await queryVehicles({ status: 'available' });
    vehicleId = v!.id;

    // Upsert customer to tolerate re-runs (email is unique)
    const [cust] = await db
      .insert(customers)
      .values({ name: 'Trip Tester', email: 'triptester@example.com' })
      .onConflictDoUpdate({ target: customers.email, set: { name: 'Trip Tester' } })
      .returning();
    customerId = cust!.id;

    // Remove existing trips for this customer so the FK + re-run is clean
    await db.delete(trips).where(eq(trips.customerId, customerId));

    const now = new Date();
    const later = new Date(now.getTime() + 3_600_000);

    const [trip] = await db
      .insert(trips)
      .values({
        customerId,
        vehicleId,
        status: 'confirmed',
        pickupLat: 42.36,
        pickupLng: -71.06,
        dropoffLat: 42.40,
        dropoffLng: -71.10,
        scheduledStartAt: now,
        scheduledEndAt: later,
        distanceKm: '12.50',
        totalCostUsd: '175.00',
        polyline: [[42.36, -71.06], [42.40, -71.10]],
      })
      .returning();
    tripId = trip!.id;
  });

  it('returns null for unknown trip id', async () => {
    const result = await getTripStatus({ trip_id: '00000000-0000-0000-0000-000000000000' });
    expect(result).toBeNull();
  });

  it('returns trip+vehicle+customer for a known trip id', async () => {
    const result = await getTripStatus({ trip_id: tripId });
    expect(result).not.toBeNull();
    if (!result) throw new Error('result should not be null');
    expect(result.trip.id).toBe(tripId);
    expect(result.vehicle!.id).toBe(vehicleId);
    expect(result.customer!.id).toBe(customerId);
  });

  it('returns the active trip when given customer_email', async () => {
    const result = await getTripStatus({ customer_email: 'triptester@example.com' });
    expect(result).not.toBeNull();
    expect(result!.trip.id).toBe(tripId);
  });

  it('returns null for a customer_email with no active trips', async () => {
    await db
      .insert(customers)
      .values({ name: 'No Trips', email: 'notrips@example.com' })
      .onConflictDoNothing();
    const result = await getTripStatus({ customer_email: 'notrips@example.com' });
    expect(result).toBeNull();
  });
});

// ─── queryCustomerHistory ───────────────────────────────────────────────────

describe('queryCustomerHistory', () => {
  let histCustomerId: string;

  beforeAll(async () => {
    await ensureSeedVehicles();

    const [v] = await queryVehicles({ status: 'available' });

    const [cust] = await db
      .insert(customers)
      .values({ name: 'History User', email: 'histuser@example.com' })
      .onConflictDoUpdate({ target: customers.email, set: { name: 'History User' } })
      .returning();
    histCustomerId = cust!.id;

    // Clear existing trips to keep counts deterministic on re-run
    await db.delete(trips).where(eq(trips.customerId, histCustomerId));

    const now = new Date();
    const later = new Date(now.getTime() + 3_600_000);

    await db.insert(trips).values([
      {
        customerId: histCustomerId,
        vehicleId: v!.id,
        status: 'completed',
        pickupLat: 42.36,
        pickupLng: -71.06,
        dropoffLat: 42.40,
        dropoffLng: -71.10,
        scheduledStartAt: now,
        scheduledEndAt: later,
        distanceKm: '10.00',
        totalCostUsd: '100.00',
        polyline: [[42.36, -71.06], [42.40, -71.10]],
      },
      {
        customerId: histCustomerId,
        vehicleId: v!.id,
        status: 'completed',
        pickupLat: 42.40,
        pickupLng: -71.10,
        dropoffLat: 42.36,
        dropoffLng: -71.06,
        scheduledStartAt: later,
        scheduledEndAt: new Date(later.getTime() + 3_600_000),
        distanceKm: '10.00',
        totalCostUsd: '150.00',
        polyline: [[42.40, -71.10], [42.36, -71.06]],
      },
    ]);
  });

  it('returns null when neither id nor email matches', async () => {
    const result = await queryCustomerHistory({ email: 'nobody@example.com' });
    expect(result).toBeNull();
  });

  it('aggregates total spend across multiple trips', async () => {
    const result = await queryCustomerHistory({ customer_id: histCustomerId });
    expect(result).not.toBeNull();
    expect(result!.trips).toHaveLength(2);
    expect(result!.total_spend_usd).toBeCloseTo(250, 2);
  });

  it('returns empty trips array and 0 spend for a new customer with no trips', async () => {
    const [cust] = await db
      .insert(customers)
      .values({ name: 'Fresh Customer', email: 'fresh@example.com' })
      .onConflictDoUpdate({ target: customers.email, set: { name: 'Fresh Customer' } })
      .returning();
    // Remove any trips from prior runs
    await db.delete(trips).where(eq(trips.customerId, cust!.id));
    const result = await queryCustomerHistory({ customer_id: cust!.id });
    expect(result).not.toBeNull();
    expect(result!.trips).toHaveLength(0);
    expect(result!.total_spend_usd).toBe(0);
  });
});

// ─── computeRoute ───────────────────────────────────────────────────────────

describe('computeRoute', () => {
  it('returns 0 distance for identical pickup and dropoff', () => {
    const result = computeRoute({
      pickup: { lat: 42.36, lng: -71.06 },
      dropoff: { lat: 42.36, lng: -71.06 },
    });
    expect(result.distance_km).toBe(0);
    expect(result.eta_minutes).toBe(0);
  });

  it('returns a 32-point polyline', () => {
    const result = computeRoute({
      pickup: { lat: 42.36, lng: -71.06 },
      dropoff: { lat: 42.40, lng: -71.10 },
    });
    expect(result.polyline).toHaveLength(32);
  });

  it('applies the 1.25 road factor to haversine distance', () => {
    // 1 degree lat ≈ 111 km → haversine = sqrt(1^2 + 0^2) * 111 = 111
    // road factor → 111 * 1.25 = 138.75 → round to 1 decimal → 138.8
    const result = computeRoute({
      pickup: { lat: 0, lng: 0 },
      dropoff: { lat: 1, lng: 0 },
    });
    expect(result.distance_km).toBeCloseTo(138.8, 0);
  });

  it('first and last polyline points match pickup and dropoff', () => {
    const pickup = { lat: 42.36, lng: -71.06 };
    const dropoff = { lat: 42.40, lng: -71.10 };
    const result = computeRoute({ pickup, dropoff });
    expect(result.polyline.at(0)).toEqual([pickup.lat, pickup.lng]);
    expect(result.polyline.at(31)).toEqual([dropoff.lat, dropoff.lng]);
  });

  it('eta_minutes equals distance_km rounded (60 km/h assumption)', () => {
    const result = computeRoute({
      pickup: { lat: 0, lng: 0 },
      dropoff: { lat: 1, lng: 0 },
    });
    expect(result.eta_minutes).toBe(Math.round(result.distance_km));
  });
});

// ─── quoteRental ────────────────────────────────────────────────────────────

describe('quoteRental', () => {
  const vehicle = { dailyRateUsd: '100.00', perKmRateUsd: '0.50' };

  it('quotes 0 days as base=0, distance still charged', () => {
    const result = quoteRental({ vehicle, distance_km: 100, days: 0 });
    expect(result.base_usd).toBe(0);
    expect(result.per_km_usd).toBe(50);
    // insurance = 0 * 0.08 = 0, subtotal = 50, service = 50*0.085 = 4.25
    expect(result.service_fee_usd).toBeCloseTo(4.25, 2);
    expect(result.total_usd).toBeCloseTo(54.25, 2);
  });

  it('rounds all dollar amounts to 2 decimal places', () => {
    // Use values that produce non-terminating decimals
    const quirky = { dailyRateUsd: '33.33', perKmRateUsd: '0.1111' };
    const result = quoteRental({ vehicle: quirky, distance_km: 7, days: 3 });
    const places = (n: number) => (n.toString().split('.')[1] ?? '').length;
    expect(places(result.base_usd)).toBeLessThanOrEqual(2);
    expect(places(result.per_km_usd)).toBeLessThanOrEqual(2);
    expect(places(result.insurance_usd)).toBeLessThanOrEqual(2);
    expect(places(result.service_fee_usd)).toBeLessThanOrEqual(2);
    expect(places(result.total_usd)).toBeLessThanOrEqual(2);
  });

  it('breakdown has 4 lines', () => {
    const result = quoteRental({ vehicle, distance_km: 50, days: 2 });
    expect(result.breakdown).toHaveLength(4);
  });

  it('total_usd equals base + per_km + insurance + service_fee', () => {
    const result = quoteRental({ vehicle, distance_km: 200, days: 3 });
    const expected = round2(
      result.base_usd + result.per_km_usd + result.insurance_usd + result.service_fee_usd,
    );
    expect(result.total_usd).toBe(expected);
  });
});

// ─── proposeRental ──────────────────────────────────────────────────────────

describe('proposeRental', () => {
  let proposeCustomerId: string;
  let proposeVehicleId: string;

  const PICKUP = { lat: 42.36, lng: -71.06 };
  const DROPOFF = { lat: 41.66, lng: -70.27 };
  const START = new Date('2026-05-02T10:00:00Z');
  const END = new Date('2026-05-04T18:00:00Z');

  beforeAll(async () => {
    // Ensure the standard seed vehicles exist and reset the available one to 'available'
    await ensureSeedVehicles();

    // Re-fetch the available vehicle (TST-S-001)
    const [v] = await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.plate, 'TST-S-001'));
    // Reset status in case a prior test run left it in-use
    await db.update(vehicles).set({ status: 'available' }).where(eq(vehicles.id, v!.id));
    proposeVehicleId = v!.id;

    // Upsert a customer dedicated to proposeRental tests
    const [cust] = await db
      .insert(customers)
      .values({ name: 'Rental Proposer', email: 'rental-proposer@example.com' })
      .onConflictDoUpdate({ target: customers.email, set: { name: 'Rental Proposer' } })
      .returning();
    proposeCustomerId = cust!.id;

    // Clean up any trips/invoices from prior runs for this customer
    const priorTrips = await db
      .select()
      .from(trips)
      .where(eq(trips.customerId, proposeCustomerId));
    for (const t of priorTrips) {
      await db.delete(invoices).where(eq(invoices.tripId, t.id));
    }
    await db.delete(trips).where(eq(trips.customerId, proposeCustomerId));
  });

  it('creates a trip + draft invoice atomically', async () => {
    const { trip, invoice } = await proposeRental({
      customer_id: proposeCustomerId,
      vehicle_id: proposeVehicleId,
      pickup: PICKUP,
      dropoff: DROPOFF,
      scheduled_start_at: START,
      scheduled_end_at: END,
      distance_km: 612,
      total_usd: 284.5,
      tax_usd: 22.36,
      polyline: [
        [PICKUP.lat, PICKUP.lng],
        [DROPOFF.lat, DROPOFF.lng],
      ],
    });
    expect(trip.status).toBe('confirmed');
    expect(invoice.status).toBe('draft');
    expect(invoice.tripId).toBe(trip.id);
    expect(invoice.customerId).toBe(proposeCustomerId);
  });

  it('flips vehicle status to in-use', async () => {
    // Reset vehicle so we can test the flip again (idempotent re-seed then re-run proposeRental)
    await db.update(vehicles).set({ status: 'available' }).where(eq(vehicles.id, proposeVehicleId));

    // Clean previous invoke trips/invoices for this customer so we start fresh
    const priorTrips = await db
      .select()
      .from(trips)
      .where(eq(trips.customerId, proposeCustomerId));
    for (const t of priorTrips) {
      await db.delete(invoices).where(eq(invoices.tripId, t.id));
    }
    await db.delete(trips).where(eq(trips.customerId, proposeCustomerId));

    await proposeRental({
      customer_id: proposeCustomerId,
      vehicle_id: proposeVehicleId,
      pickup: PICKUP,
      dropoff: DROPOFF,
      scheduled_start_at: START,
      scheduled_end_at: END,
      distance_km: 612,
      total_usd: 284.5,
      tax_usd: 22.36,
      polyline: [
        [PICKUP.lat, PICKUP.lng],
        [DROPOFF.lat, DROPOFF.lng],
      ],
    });

    const [updated] = await db.select().from(vehicles).where(eq(vehicles.id, proposeVehicleId));
    expect(updated!.status).toBe('in-use');
  });

  it('sets dueAt to one day before scheduled start', async () => {
    await db.update(vehicles).set({ status: 'available' }).where(eq(vehicles.id, proposeVehicleId));
    const priorTrips = await db
      .select()
      .from(trips)
      .where(eq(trips.customerId, proposeCustomerId));
    for (const t of priorTrips) {
      await db.delete(invoices).where(eq(invoices.tripId, t.id));
    }
    await db.delete(trips).where(eq(trips.customerId, proposeCustomerId));

    const { invoice } = await proposeRental({
      customer_id: proposeCustomerId,
      vehicle_id: proposeVehicleId,
      pickup: PICKUP,
      dropoff: DROPOFF,
      scheduled_start_at: START,
      scheduled_end_at: END,
      distance_km: 612,
      total_usd: 284.5,
      tax_usd: 22.36,
      polyline: [
        [PICKUP.lat, PICKUP.lng],
        [DROPOFF.lat, DROPOFF.lng],
      ],
    });

    const expectedDueAt = new Date(START);
    expectedDueAt.setDate(expectedDueAt.getDate() - 1);
    // Compare date portions only (DB may return slightly different ms)
    expect(invoice.dueAt.toISOString().slice(0, 10)).toBe(
      expectedDueAt.toISOString().slice(0, 10),
    );
  });

  it('omits taskId when not provided (trip.taskId === null)', async () => {
    await db.update(vehicles).set({ status: 'available' }).where(eq(vehicles.id, proposeVehicleId));
    const priorTrips = await db
      .select()
      .from(trips)
      .where(eq(trips.customerId, proposeCustomerId));
    for (const t of priorTrips) {
      await db.delete(invoices).where(eq(invoices.tripId, t.id));
    }
    await db.delete(trips).where(eq(trips.customerId, proposeCustomerId));

    const { trip } = await proposeRental({
      customer_id: proposeCustomerId,
      vehicle_id: proposeVehicleId,
      pickup: PICKUP,
      dropoff: DROPOFF,
      scheduled_start_at: START,
      scheduled_end_at: END,
      distance_km: 612,
      total_usd: 284.5,
      tax_usd: 22.36,
      polyline: [
        [PICKUP.lat, PICKUP.lng],
        [DROPOFF.lat, DROPOFF.lng],
      ],
      // no task_id
    });

    expect(trip.taskId).toBeNull();
  });
});

// ─── chargeInvoice ──────────────────────────────────────────────────────────

describe('chargeInvoice', () => {
  let chargeCustomerId: string;
  let chargeVehicleId: string;
  let draftInvoiceId: string;

  beforeAll(async () => {
    await ensureSeedVehicles();

    // Use the in-use SUV (TST-X-001) so we don't disturb availability tests
    const [v] = await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.plate, 'TST-X-001'));
    chargeVehicleId = v!.id;

    const [cust] = await db
      .insert(customers)
      .values({ name: 'Invoice Charger', email: 'invoice-charger@example.com' })
      .onConflictDoUpdate({ target: customers.email, set: { name: 'Invoice Charger' } })
      .returning();
    chargeCustomerId = cust!.id;

    // Clean up prior runs
    const priorTrips = await db
      .select()
      .from(trips)
      .where(eq(trips.customerId, chargeCustomerId));
    for (const t of priorTrips) {
      await db.delete(invoices).where(eq(invoices.tripId, t.id));
    }
    await db.delete(trips).where(eq(trips.customerId, chargeCustomerId));

    // Insert a trip + draft invoice
    const now = new Date();
    const later = new Date(now.getTime() + 3_600_000);
    const [trip] = await db
      .insert(trips)
      .values({
        customerId: chargeCustomerId,
        vehicleId: chargeVehicleId,
        status: 'confirmed',
        pickupLat: 42.36,
        pickupLng: -71.06,
        dropoffLat: 41.66,
        dropoffLng: -70.27,
        scheduledStartAt: now,
        scheduledEndAt: later,
        distanceKm: '612.00',
        totalCostUsd: '284.50',
        polyline: [
          [42.36, -71.06],
          [41.66, -70.27],
        ],
      })
      .returning();

    const dueAt = new Date(now);
    dueAt.setDate(dueAt.getDate() - 1);
    const [inv] = await db
      .insert(invoices)
      .values({
        tripId: trip!.id,
        customerId: chargeCustomerId,
        amountUsd: '262.14',
        taxUsd: '22.36',
        totalUsd: '284.50',
        status: 'draft',
        dueAt,
      })
      .returning();
    draftInvoiceId = inv!.id;
  });

  it('marks invoice paid and sets paidAt', async () => {
    const { invoice } = await chargeInvoice({ invoice_id: draftInvoiceId });
    expect(invoice.status).toBe('paid');
    expect(invoice.paidAt).toBeInstanceOf(Date);
  });

  it('throws on unknown invoice_id', async () => {
    await expect(
      chargeInvoice({ invoice_id: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow('invoice 00000000-0000-0000-0000-000000000000 not found');
  });
});

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
