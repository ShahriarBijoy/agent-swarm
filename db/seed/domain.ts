/**
 * Domain seed — populates vehicles, customers, trips, invoices.
 *
 * Run with:  pnpm seed:domain
 *
 * Destructive: wipes invoices → trips → customers → vehicles first.
 * Do NOT run while phase-10.5 tests are in flight — the tests own their own
 * upsert fixtures keyed by unique plates / emails.
 */

import { db } from '@/db/client';
import { vehicles, customers, trips, invoices } from '@/db/schema/domain';
import { computeRoute, quoteRental } from '@/db/queries/domain';

// ---------------------------------------------------------------------------
// Depot coordinates
// ---------------------------------------------------------------------------
const DEPOTS = {
  'fleet-east': { lat: 52.52, lng: 13.405 }, // Berlin
  'fleet-central': { lat: 48.137, lng: 11.576 }, // Munich
  'fleet-west': { lat: 50.938, lng: 6.96 }, // Cologne
} as const;

type DepotKey = keyof typeof DEPOTS;

// ---------------------------------------------------------------------------
// Fleet — 19 vehicles
// ---------------------------------------------------------------------------
const FLEET: Array<{
  plate: string;
  make: string;
  model: string;
  year: number;
  segment: 'truck' | 'sedan' | 'van' | 'suv';
  seats: number;
  rangeKm: number;
  dailyRateUsd: string;
  perKmRateUsd: string;
  imageSlug: string;
  depot: DepotKey;
  status: 'available' | 'in-use' | 'maintenance';
}> = [
  // --- trucks ---
  {
    plate: 'AR-T-2301',
    make: 'Ford',
    model: 'F-150',
    year: 2023,
    segment: 'truck',
    seats: 5,
    rangeKm: 800,
    dailyRateUsd: '185.00',
    perKmRateUsd: '0.5500',
    imageSlug: 'ford-f-150',
    depot: 'fleet-east',
    status: 'available',
  },
  {
    plate: 'AR-T-2402',
    make: 'Toyota',
    model: 'Tacoma',
    year: 2024,
    segment: 'truck',
    seats: 5,
    rangeKm: 700,
    dailyRateUsd: '165.00',
    perKmRateUsd: '0.5000',
    imageSlug: 'toyota-tacoma',
    depot: 'fleet-central',
    status: 'in-use',
  },
  {
    plate: 'AR-T-2203',
    make: 'Chevrolet',
    model: 'Silverado',
    year: 2022,
    segment: 'truck',
    seats: 6,
    rangeKm: 850,
    dailyRateUsd: '195.00',
    perKmRateUsd: '0.5800',
    imageSlug: 'chevrolet-silverado',
    depot: 'fleet-west',
    status: 'available',
  },
  // --- sedans ---
  {
    plate: 'AR-S-2401',
    make: 'Honda',
    model: 'Accord',
    year: 2024,
    segment: 'sedan',
    seats: 5,
    rangeKm: 650,
    dailyRateUsd: '95.00',
    perKmRateUsd: '0.2800',
    imageSlug: 'honda-accord',
    depot: 'fleet-east',
    status: 'available',
  },
  {
    plate: 'AR-S-2302',
    make: 'Toyota',
    model: 'Camry',
    year: 2023,
    segment: 'sedan',
    seats: 5,
    rangeKm: 700,
    dailyRateUsd: '98.00',
    perKmRateUsd: '0.3000',
    imageSlug: 'toyota-camry',
    depot: 'fleet-east',
    status: 'in-use',
  },
  {
    plate: 'AR-S-2403',
    make: 'Tesla',
    model: 'Model 3',
    year: 2024,
    segment: 'sedan',
    seats: 5,
    rangeKm: 580,
    dailyRateUsd: '145.00',
    perKmRateUsd: '0.1800',
    imageSlug: 'tesla-model-3',
    depot: 'fleet-central',
    status: 'available',
  },
  {
    plate: 'AR-S-2304',
    make: 'Hyundai',
    model: 'Sonata',
    year: 2023,
    segment: 'sedan',
    seats: 5,
    rangeKm: 620,
    dailyRateUsd: '89.00',
    perKmRateUsd: '0.2700',
    imageSlug: 'hyundai-sonata',
    depot: 'fleet-west',
    status: 'maintenance',
  },
  {
    plate: 'AR-S-2205',
    make: 'BMW',
    model: '3-Series',
    year: 2022,
    segment: 'sedan',
    seats: 5,
    rangeKm: 600,
    dailyRateUsd: '165.00',
    perKmRateUsd: '0.4200',
    imageSlug: 'bmw-3-series',
    depot: 'fleet-east',
    status: 'available',
  },
  // --- vans ---
  {
    plate: 'AR-V-2401',
    make: 'Toyota',
    model: 'Sienna',
    year: 2024,
    segment: 'van',
    seats: 8,
    rangeKm: 550,
    dailyRateUsd: '145.00',
    perKmRateUsd: '0.4200',
    imageSlug: 'toyota-sienna',
    depot: 'fleet-east',
    status: 'in-use',
  },
  {
    plate: 'AR-V-2302',
    make: 'Honda',
    model: 'Odyssey',
    year: 2023,
    segment: 'van',
    seats: 8,
    rangeKm: 580,
    dailyRateUsd: '135.00',
    perKmRateUsd: '0.4000',
    imageSlug: 'honda-odyssey',
    depot: 'fleet-central',
    status: 'available',
  },
  {
    plate: 'AR-V-2403',
    make: 'Ford',
    model: 'Transit',
    year: 2024,
    segment: 'van',
    seats: 12,
    rangeKm: 520,
    dailyRateUsd: '175.00',
    perKmRateUsd: '0.5000',
    imageSlug: 'ford-transit',
    depot: 'fleet-west',
    status: 'available',
  },
  {
    plate: 'AR-V-2304',
    make: 'Mercedes',
    model: 'Sprinter',
    year: 2023,
    segment: 'van',
    seats: 15,
    rangeKm: 600,
    dailyRateUsd: '215.00',
    perKmRateUsd: '0.6200',
    imageSlug: 'mercedes-sprinter',
    depot: 'fleet-central',
    status: 'available',
  },
  // --- suvs ---
  {
    plate: 'AR-X-2401',
    make: 'Honda',
    model: 'CR-V',
    year: 2024,
    segment: 'suv',
    seats: 5,
    rangeKm: 720,
    dailyRateUsd: '115.00',
    perKmRateUsd: '0.3400',
    imageSlug: 'honda-cr-v',
    depot: 'fleet-east',
    status: 'in-use',
  },
  {
    plate: 'AR-X-2402',
    make: 'Toyota',
    model: 'RAV4',
    year: 2024,
    segment: 'suv',
    seats: 5,
    rangeKm: 750,
    dailyRateUsd: '118.00',
    perKmRateUsd: '0.3500',
    imageSlug: 'toyota-rav-4',
    depot: 'fleet-east',
    status: 'available',
  },
  {
    plate: 'AR-X-2403',
    make: 'Tesla',
    model: 'Model Y',
    year: 2024,
    segment: 'suv',
    seats: 5,
    rangeKm: 630,
    dailyRateUsd: '158.00',
    perKmRateUsd: '0.2000',
    imageSlug: 'tesla-model-y',
    depot: 'fleet-central',
    status: 'available',
  },
  {
    plate: 'AR-X-2304',
    make: 'Ford',
    model: 'Explorer',
    year: 2023,
    segment: 'suv',
    seats: 7,
    rangeKm: 680,
    dailyRateUsd: '135.00',
    perKmRateUsd: '0.4000',
    imageSlug: 'ford-explorer',
    depot: 'fleet-central',
    status: 'maintenance',
  },
  {
    plate: 'AR-X-2405',
    make: 'Toyota',
    model: 'Highlander',
    year: 2024,
    segment: 'suv',
    seats: 7,
    rangeKm: 700,
    dailyRateUsd: '145.00',
    perKmRateUsd: '0.4200',
    imageSlug: 'toyota-highlander',
    depot: 'fleet-west',
    status: 'available',
  },
  {
    plate: 'AR-X-2206',
    make: 'BMW',
    model: 'X5',
    year: 2022,
    segment: 'suv',
    seats: 5,
    rangeKm: 620,
    dailyRateUsd: '215.00',
    perKmRateUsd: '0.5500',
    imageSlug: 'bmw-x5',
    depot: 'fleet-east',
    status: 'available',
  },
  {
    plate: 'AR-X-2307',
    make: 'Range Rover',
    model: 'Range Rover',
    year: 2023,
    segment: 'suv',
    seats: 5,
    rangeKm: 650,
    dailyRateUsd: '245.00',
    perKmRateUsd: '0.6200',
    imageSlug: 'range-rover',
    depot: 'fleet-west',
    status: 'available',
  },
];

// ---------------------------------------------------------------------------
// 25 customers — first three are the scenario fixtures (Ana Khan, Ben Reyes, Cleo Park)
// ---------------------------------------------------------------------------
const CUSTOMER_NAMES: Array<[string, string]> = [
  ['Ana', 'Khan'],
  ['Ben', 'Reyes'],
  ['Cleo', 'Park'],
  ['Dani', 'Santos'],
  ['Evan', 'White'],
  ['Fern', 'Moore'],
  ['Gabe', 'Torres'],
  ['Hana', 'Yamamoto'],
  ['Ivan', 'Petrov'],
  ['Jade', 'Wilson'],
  ['Kai', 'Nakamura'],
  ['Luna', 'Garcia'],
  ['Marco', 'Rossi'],
  ['Nora', 'Chen'],
  ['Omar', 'Hassan'],
  ['Priya', 'Patel'],
  ['Quinn', 'Brown'],
  ['Rosa', 'Diaz'],
  ['Sam', 'Lee'],
  ['Tara', 'Miller'],
  ['Umar', 'Ali'],
  ['Vera', 'Novak'],
  ['Will', 'Thompson'],
  ['Xena', 'Scott'],
  ['Yuki', 'Tanaka'],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stable pseudo-random float from a numeric seed. Not crypto-safe. */
function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

/** Pick an item from an array using a seeded position. */
function pick<T>(arr: readonly T[], seed: number): T {
  return arr[Math.floor(seededRandom(seed) * arr.length)] as T;
}

/** Return a date that is `daysAgo` days before now, plus `secondsOffset` seconds. */
function daysAgo(days: number, secondsOffset = 0): Date {
  const now = new Date();
  return new Date(now.getTime() - days * 86_400_000 + secondsOffset * 1000);
}

/** Generate a jittered coordinate near a depot (within 0.5 deg). */
function nearDepot(
  depot: DepotKey,
  latJitter: number,
  lngJitter: number,
): { lat: number; lng: number } {
  const base = DEPOTS[depot];
  return {
    lat: base.lat + latJitter,
    lng: base.lng + lngJitter,
  };
}

// The set of distances to pick from, per spec.
const DISTANCES_KM = [120, 240, 384, 612, 850] as const;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function seed(): Promise<void> {
  console.log('=== Auto-ride domain seed ===\n');

  // ------------------------------------------------------------------
  // Step 1: destructive wipe (FK order: invoices → trips → customers → vehicles)
  // ------------------------------------------------------------------
  console.log('Deleting existing domain rows...');
  await db.delete(invoices);
  await db.delete(trips);
  await db.delete(customers);
  await db.delete(vehicles);
  console.log('  cleared.\n');

  // ------------------------------------------------------------------
  // Step 2: Insert 19 vehicles
  // ------------------------------------------------------------------
  console.log('Inserting 19 vehicles...');
  const insertedVehicles = await db
    .insert(vehicles)
    .values(
      FLEET.map((v, i) => {
        const depot = DEPOTS[v.depot];
        // Scatter odometer based on seed — 5 000–95 000 km range
        const odometer = Math.round(5000 + seededRandom(i * 7 + 3) * 90000);
        // Last serviced: 10–120 days ago
        const servicedDaysAgo = Math.round(10 + seededRandom(i * 13 + 5) * 110);
        return {
          plate: v.plate,
          make: v.make,
          model: v.model,
          year: v.year,
          segment: v.segment,
          seats: v.seats,
          rangeKm: v.rangeKm,
          odometerKm: odometer,
          status: v.status,
          homeLat: depot.lat,
          homeLng: depot.lng,
          depot: v.depot,
          imageSlug: v.imageSlug,
          dailyRateUsd: v.dailyRateUsd,
          perKmRateUsd: v.perKmRateUsd,
          lastServicedAt: daysAgo(servicedDaysAgo),
        };
      }),
    )
    .returning();

  console.log(`  inserted ${insertedVehicles.length} vehicles.\n`);

  // Build plate → vehicle row map
  const vehicleByPlate = new Map(insertedVehicles.map((v) => [v.plate, v]));

  // ------------------------------------------------------------------
  // Step 3: Insert 25 customers
  // ------------------------------------------------------------------
  console.log('Inserting 25 customers...');
  const insertedCustomers = await db
    .insert(customers)
    .values(
      CUSTOMER_NAMES.map(([first, last]) => ({
        name: `${first} ${last}`,
        email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
        phone: `+1-555-${String(Math.floor(1000 + seededRandom(first.length + last.length) * 9000))}`,
      })),
    )
    .returning();

  console.log(`  inserted ${insertedCustomers.length} customers.\n`);

  // ------------------------------------------------------------------
  // Step 4: 4 live in-route trips for the 4 in-use vehicles
  // ------------------------------------------------------------------
  const IN_USE_PLATES = ['AR-T-2402', 'AR-S-2302', 'AR-V-2401', 'AR-X-2401'];
  // Pair each in-use vehicle to a customer (first 4)
  const liveTrips: typeof trips.$inferInsert[] = [];

  for (let i = 0; i < IN_USE_PLATES.length; i++) {
    const plate = IN_USE_PLATES[i] as string;
    const vehicle = vehicleByPlate.get(plate);
    if (!vehicle) throw new Error(`In-use vehicle not found: ${plate}`);
    const customer = insertedCustomers[i % insertedCustomers.length]!;
    const depot = vehicle.depot as DepotKey;
    const depotCoords = DEPOTS[depot];

    // Destination: spread across the map so eta >> startedHoursAgo (progress < 1 on first load).
    // jitterDeg = 2.5–4.0 deg → ~280–440 km haversine → road-factor 1.25 → eta ~5.8–9.2 h.
    // startedHoursAgo is only 1–4 h, so progress stays clearly mid-trip.
    // Alternating sign spreads polylines in different compass directions.
    const jitterDeg = 2.5 + 0.5 * i;
    const sign = i % 2 === 0 ? 1 : -1;
    const pickup = { lat: depotCoords.lat, lng: depotCoords.lng };
    const dropoffLat = depotCoords.lat + sign * jitterDeg * 0.6;
    const dropoffLng = depotCoords.lng + sign * jitterDeg;
    const dropoff = { lat: dropoffLat, lng: dropoffLng };

    const route = computeRoute({ pickup, dropoff });
    const startedHoursAgo = 1 + i;
    console.log(`  live trip i=${i}: distance_km=${route.distance_km.toFixed(1)}, eta_minutes=${route.eta_minutes.toFixed(1)}, eta_h=${(route.eta_minutes / 60).toFixed(2)}, startedHoursAgo=${startedHoursAgo} → progress≈${((startedHoursAgo * 60) / route.eta_minutes * 100).toFixed(1)}%`);
    const daysCount = 1;
    const quote = quoteRental({
      vehicle: {
        dailyRateUsd: vehicle.dailyRateUsd as string,
        perKmRateUsd: vehicle.perKmRateUsd as string,
      },
      distance_km: route.distance_km,
      days: daysCount,
    });

    // Started 1–4 hours ago
    const actualStart = new Date(Date.now() - startedHoursAgo * 3_600_000);
    const scheduledStart = new Date(actualStart.getTime() - 15 * 60_000);
    const scheduledEnd = new Date(scheduledStart.getTime() + (route.eta_minutes + 30) * 60_000);

    liveTrips.push({
      customerId: customer.id,
      vehicleId: vehicle.id,
      status: 'in-route',
      pickupLat: pickup.lat,
      pickupLng: pickup.lng,
      dropoffLat: dropoff.lat,
      dropoffLng: dropoff.lng,
      scheduledStartAt: scheduledStart,
      scheduledEndAt: scheduledEnd,
      actualStartAt: actualStart,
      actualEndAt: null,
      distanceKm: String(route.distance_km),
      totalCostUsd: String(quote.total_usd),
      polyline: route.polyline,
    });
  }

  console.log('Inserting 4 live in-route trips...');
  const insertedLiveTrips = await db.insert(trips).values(liveTrips).returning();
  console.log(`  inserted ${insertedLiveTrips.length} in-route trips.\n`);

  // ------------------------------------------------------------------
  // Step 5: ~95 historical completed trips (3-5 per customer)
  // ------------------------------------------------------------------
  console.log('Inserting historical trips + invoices...');

  // Deterministic counts per customer: alternate 3,4,5 to reach ~95 total
  // 25 customers × 3.8 avg = 95
  const tripCountsPattern = [4, 4, 4, 3, 5, 4, 4, 3, 4, 5, 3, 4, 4, 5, 4, 3, 4, 5, 4, 3, 4, 4, 5, 3, 4];

  const historicalTripInserts: typeof trips.$inferInsert[] = [];
  // We'll collect invoice inserts after trips are saved
  const tripInvoiceMap: Array<{ tripIdx: number; custId: string; amountUsd: string; taxUsd: string; totalUsd: string; dueAt: Date; paidAt: Date }> = [];

  for (let ci = 0; ci < insertedCustomers.length; ci++) {
    const customer = insertedCustomers[ci]!;
    const tripCount = tripCountsPattern[ci] ?? 4;
    const allVehicleIds = insertedVehicles.map((v) => v.id);

    for (let ti = 0; ti < tripCount; ti++) {
      const tripSeed = ci * 100 + ti;

      // Pick a random vehicle (any segment — historical)
      const vehicleId = pick(allVehicleIds, tripSeed + 1);
      const vehicle = insertedVehicles.find((v) => v.id === vehicleId)!;
      const depot = vehicle.depot as DepotKey;
      const depotCoords = DEPOTS[depot];

      // Pickup/dropoff near the depot
      const latJitter = (seededRandom(tripSeed + 17) - 0.5) * 1.0; // ±0.5 deg
      const lngJitter = (seededRandom(tripSeed + 23) - 0.5) * 1.0;
      const pickup = nearDepot(depot, latJitter, lngJitter);
      const dropoff = nearDepot(
        depot,
        latJitter + (seededRandom(tripSeed + 37) - 0.5) * 0.8,
        lngJitter + (seededRandom(tripSeed + 41) - 0.5) * 0.8,
      );

      // Deterministic distance from the allowed set
      const distKm = pick(DISTANCES_KM, tripSeed + 5);

      const route = computeRoute({ pickup, dropoff });
      const daysCount = Math.ceil(distKm / 400) + 1; // 1-3 days depending on distance
      const quote = quoteRental({
        vehicle: {
          dailyRateUsd: vehicle.dailyRateUsd as string,
          perKmRateUsd: vehicle.perKmRateUsd as string,
        },
        distance_km: distKm,
        days: daysCount,
      });

      // Scheduled within past 90 days; completed
      const startDaysBack = 5 + Math.floor(seededRandom(tripSeed + 61) * 85);
      const scheduledStart = daysAgo(startDaysBack, 0);
      const actualStart = daysAgo(startDaysBack, -600 + Math.floor(seededRandom(tripSeed + 71) * 1200)); // ±10 min
      const durationMs = (distKm / 60) * 3_600_000; // km ÷ 60 km/h
      const actualEnd = new Date(actualStart.getTime() + durationMs);
      const scheduledEnd = new Date(actualEnd.getTime() + 30 * 60_000);

      const taxUsd = Math.round(quote.total_usd * 0.08 * 100) / 100;
      const amountUsd = Math.round((quote.total_usd - taxUsd) * 100) / 100;
      const paidAt = new Date(actualEnd.getTime() + 2 * 3_600_000); // paid 2h after drop-off
      const dueAt = new Date(scheduledStart.getTime() - 86_400_000); // due day before

      historicalTripInserts.push({
        customerId: customer.id,
        vehicleId,
        status: 'completed',
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        dropoffLat: dropoff.lat,
        dropoffLng: dropoff.lng,
        scheduledStartAt: scheduledStart,
        scheduledEndAt: scheduledEnd,
        actualStartAt: actualStart,
        actualEndAt: actualEnd,
        distanceKm: String(distKm),
        totalCostUsd: String(quote.total_usd),
        polyline: route.polyline,
      });

      tripInvoiceMap.push({
        tripIdx: historicalTripInserts.length - 1,
        custId: customer.id,
        amountUsd: String(amountUsd),
        taxUsd: String(taxUsd),
        totalUsd: String(quote.total_usd),
        dueAt,
        paidAt,
      });
    }
  }

  const insertedHistoricalTrips = await db
    .insert(trips)
    .values(historicalTripInserts)
    .returning();

  console.log(`  inserted ${insertedHistoricalTrips.length} completed trips.`);

  // ------------------------------------------------------------------
  // Step 6: Invoices for historical trips (all paid)
  // ------------------------------------------------------------------
  const historicalInvoiceInserts: typeof invoices.$inferInsert[] = tripInvoiceMap.map((inv) => {
    const trip = insertedHistoricalTrips[inv.tripIdx];
    if (!trip) throw new Error(`trip index ${inv.tripIdx} not found after insert`);
    return {
      tripId: trip.id,
      customerId: inv.custId,
      amountUsd: inv.amountUsd,
      taxUsd: inv.taxUsd,
      totalUsd: inv.totalUsd,
      status: 'paid' as const,
      dueAt: inv.dueAt,
      paidAt: inv.paidAt,
    };
  });

  const insertedHistoricalInvoices = await db
    .insert(invoices)
    .values(historicalInvoiceInserts)
    .returning();

  console.log(`  inserted ${insertedHistoricalInvoices.length} paid invoices.\n`);

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  const statusCounts = insertedVehicles.reduce<Record<string, number>>((acc, v) => {
    acc[v.status] = (acc[v.status] ?? 0) + 1;
    return acc;
  }, {});

  console.log('=== Seed complete ===');
  console.log(`  Vehicles : ${insertedVehicles.length}  (${Object.entries(statusCounts).map(([s, n]) => `${n} ${s}`).join(', ')})`);
  console.log(`  Customers: ${insertedCustomers.length}`);
  console.log(`  Trips    : ${insertedLiveTrips.length} in-route + ${insertedHistoricalTrips.length} completed = ${insertedLiveTrips.length + insertedHistoricalTrips.length} total`);
  console.log(`  Invoices : ${insertedHistoricalInvoices.length} paid`);
}

seed().then(
  () => {
    console.log('\nDone.');
    process.exit(0);
  },
  (err: unknown) => {
    console.error('\nSeed failed:', err);
    process.exit(1);
  },
);
