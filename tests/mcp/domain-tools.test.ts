import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '@/db/client';
import { customers, invoices, trips, vehicles } from '@/db/schema/domain';
import { eq } from 'drizzle-orm';
import {
  domainMcpServer,
  DOMAIN_TOOLS,
  QUERY_VEHICLES_FQN,
  COMPUTE_ROUTE_FQN,
  QUOTE_RENTAL_FQN,
  CHECK_VEHICLE_HEALTH_FQN,
  GET_TRIP_STATUS_FQN,
  QUERY_CUSTOMER_HISTORY_FQN,
  PROPOSE_RENTAL_FQN,
  CHARGE_INVOICE_FQN,
  queryVehiclesTool,
  computeRouteTool,
  quoteRentalTool,
  checkVehicleHealthTool,
  getTripStatusTool,
  queryCustomerHistoryTool,
  proposeRentalTool,
  chargeInvoiceTool,
} from '@/lib/mcp/domain';

// ─── Shared fixture state ────────────────────────────────────────────────────

let sedanId: string;
let suvId: string;
let customerId: string;
let activeTripId: string;
let draftInvoiceId: string;

async function ensureFixtures() {
  // Seed two canonical test vehicles (idempotent by plate)
  const [sedan] = await db
    .insert(vehicles)
    .values({
      plate: 'MCP-S-001',
      make: 'Honda',
      model: 'Accord',
      year: 2024,
      segment: 'sedan',
      seats: 5,
      rangeKm: 650,
      homeLat: 42.36,
      homeLng: -71.06,
      depot: 'fleet-east',
      imageSlug: 'honda-accord',
      dailyRateUsd: '95.00',
      perKmRateUsd: '0.28',
      status: 'available',
    })
    .onConflictDoUpdate({
      target: vehicles.plate,
      set: { status: 'available', segment: 'sedan', seats: 5, rangeKm: 650 },
    })
    .returning();
  sedanId = sedan!.id;

  const [suv] = await db
    .insert(vehicles)
    .values({
      plate: 'MCP-X-001',
      make: 'Honda',
      model: 'CR-V',
      year: 2024,
      segment: 'suv',
      seats: 5,
      rangeKm: 720,
      homeLat: 42.36,
      homeLng: -71.06,
      depot: 'fleet-east',
      imageSlug: 'honda-cr-v',
      dailyRateUsd: '115.00',
      perKmRateUsd: '0.34',
      status: 'in-use',
    })
    .onConflictDoUpdate({
      target: vehicles.plate,
      set: { status: 'in-use', segment: 'suv', seats: 5, rangeKm: 720 },
    })
    .returning();
  suvId = suv!.id;

  // Seed a customer
  const [cust] = await db
    .insert(customers)
    .values({ name: 'MCP Test User', email: 'mcp-test@example.com' })
    .onConflictDoUpdate({ target: customers.email, set: { name: 'MCP Test User' } })
    .returning();
  customerId = cust!.id;

  // Clean prior trips/invoices for this customer to keep state predictable
  const prior = await db.select().from(trips).where(eq(trips.customerId, customerId));
  for (const t of prior) {
    await db.delete(invoices).where(eq(invoices.tripId, t.id));
  }
  await db.delete(trips).where(eq(trips.customerId, customerId));

  // Insert one active trip for getTripStatus / queryCustomerHistory
  const now = new Date();
  const later = new Date(now.getTime() + 3_600_000);
  const [trip] = await db
    .insert(trips)
    .values({
      customerId,
      vehicleId: suvId,
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
  activeTripId = trip!.id;

  // Insert a draft invoice for chargeInvoice test
  const dueAt = new Date(now.getTime() - 86_400_000);
  const [inv] = await db
    .insert(invoices)
    .values({
      tripId: activeTripId,
      customerId,
      amountUsd: '152.64',
      taxUsd: '22.36',
      totalUsd: '175.00',
      status: 'draft',
      dueAt,
    })
    .returning();
  draftInvoiceId = inv!.id;
}

// ─── Server-level tests ──────────────────────────────────────────────────────

describe('domain MCP server', () => {
  it('exposes 8 tools via DOMAIN_TOOLS', () => {
    expect(DOMAIN_TOOLS).toHaveLength(8);
  });

  it('domainMcpServer is defined (createSdkMcpServer returns an object)', () => {
    expect(domainMcpServer).toBeDefined();
  });

  it('FQN constants match the SDK convention mcp__<server>__<tool>', () => {
    expect(QUERY_VEHICLES_FQN).toBe('mcp__auto-ride-domain__query_vehicles');
    expect(COMPUTE_ROUTE_FQN).toBe('mcp__auto-ride-domain__compute_route');
    expect(QUOTE_RENTAL_FQN).toBe('mcp__auto-ride-domain__quote_rental');
    expect(CHECK_VEHICLE_HEALTH_FQN).toBe('mcp__auto-ride-domain__check_vehicle_health');
    expect(GET_TRIP_STATUS_FQN).toBe('mcp__auto-ride-domain__get_trip_status');
    expect(QUERY_CUSTOMER_HISTORY_FQN).toBe('mcp__auto-ride-domain__query_customer_history');
    expect(PROPOSE_RENTAL_FQN).toBe('mcp__auto-ride-domain__propose_rental');
    expect(CHARGE_INVOICE_FQN).toBe('mcp__auto-ride-domain__charge_invoice');
  });

  it('all tool names match their FQN suffix', () => {
    expect(queryVehiclesTool.name).toBe('query_vehicles');
    expect(computeRouteTool.name).toBe('compute_route');
    expect(quoteRentalTool.name).toBe('quote_rental');
    expect(checkVehicleHealthTool.name).toBe('check_vehicle_health');
    expect(getTripStatusTool.name).toBe('get_trip_status');
    expect(queryCustomerHistoryTool.name).toBe('query_customer_history');
    expect(proposeRentalTool.name).toBe('propose_rental');
    expect(chargeInvoiceTool.name).toBe('charge_invoice');
  });

  it('READ_DOMAIN_TOOL_FQNS has 6 entries, WRITE_DOMAIN_TOOL_FQNS has 2', async () => {
    const { READ_DOMAIN_TOOL_FQNS, WRITE_DOMAIN_TOOL_FQNS } = await import('@/lib/mcp/domain');
    expect(READ_DOMAIN_TOOL_FQNS).toHaveLength(6);
    expect(WRITE_DOMAIN_TOOL_FQNS).toHaveLength(2);
  });
});

// ─── query_vehicles ──────────────────────────────────────────────────────────

describe('queryVehiclesTool handler', () => {
  beforeAll(async () => {
    await ensureFixtures();
  });

  it('returns JSON array with status filter', async () => {
    const result = await queryVehiclesTool.handler(
      { status: 'available', segment: undefined, seats_min: undefined, range_min_km: undefined },
      undefined,
    );
    expect(result.isError).toBeFalsy();
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected text content');
    const rows = JSON.parse(first.text) as Array<{ plate: string; status: string }>;
    expect(rows.some((v) => v.plate === 'MCP-S-001')).toBe(true);
    expect(rows.every((v) => v.status === 'available')).toBe(true);
  });

  it('returns JSON array with segment filter', async () => {
    const result = await queryVehiclesTool.handler(
      { status: undefined, segment: 'suv', seats_min: undefined, range_min_km: undefined },
      undefined,
    );
    expect(result.isError).toBeFalsy();
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected text content');
    const rows = JSON.parse(first.text) as Array<{ plate: string }>;
    expect(rows.some((v) => v.plate === 'MCP-X-001')).toBe(true);
  });

  it('returns empty array when no vehicles match', async () => {
    const result = await queryVehiclesTool.handler(
      { segment: 'truck', status: 'available', seats_min: undefined, range_min_km: undefined },
      undefined,
    );
    expect(result.isError).toBeFalsy();
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected text content');
    const rows = JSON.parse(first.text);
    expect(Array.isArray(rows)).toBe(true);
  });
});

// ─── compute_route ───────────────────────────────────────────────────────────

describe('computeRouteTool handler', () => {
  it('returns distance_km, eta_minutes, and 32-point polyline', async () => {
    const result = await computeRouteTool.handler(
      { pickup: { lat: 42.36, lng: -71.06 }, dropoff: { lat: 42.40, lng: -71.10 } },
      undefined,
    );
    expect(result.isError).toBeFalsy();
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected text content');
    const body = JSON.parse(first.text) as { distance_km: number; eta_minutes: number; polyline: unknown[] };
    expect(typeof body.distance_km).toBe('number');
    expect(typeof body.eta_minutes).toBe('number');
    expect(body.polyline).toHaveLength(32);
  });

  it('returns 0 distance for identical pickup and dropoff', async () => {
    const result = await computeRouteTool.handler(
      { pickup: { lat: 42.36, lng: -71.06 }, dropoff: { lat: 42.36, lng: -71.06 } },
      undefined,
    );
    expect(result.isError).toBeFalsy();
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected text content');
    const body = JSON.parse(first.text) as { distance_km: number };
    expect(body.distance_km).toBe(0);
  });
});

// ─── quote_rental ────────────────────────────────────────────────────────────

describe('quoteRentalTool handler', () => {
  beforeAll(async () => {
    await ensureFixtures();
  });

  it('returns a quote with total_usd, breakdown, and fee fields', async () => {
    const result = await quoteRentalTool.handler(
      { vehicle_id: sedanId, distance_km: 100, days: 2 },
      undefined,
    );
    expect(result.isError).toBeFalsy();
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected text content');
    const body = JSON.parse(first.text) as {
      total_usd: number;
      base_usd: number;
      per_km_usd: number;
      insurance_usd: number;
      service_fee_usd: number;
      breakdown: string[];
    };
    expect(typeof body.total_usd).toBe('number');
    expect(body.total_usd).toBeGreaterThan(0);
    expect(body.breakdown).toHaveLength(4);
  });

  it('returns isError for an unknown vehicle_id', async () => {
    const result = await quoteRentalTool.handler(
      { vehicle_id: '00000000-0000-0000-0000-000000000000', distance_km: 50, days: 1 },
      undefined,
    );
    expect(result.isError).toBe(true);
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected text content');
    expect(first.text).toMatch(/unknown vehicle/);
  });
});

// ─── check_vehicle_health ────────────────────────────────────────────────────

describe('checkVehicleHealthTool handler', () => {
  beforeAll(async () => {
    await ensureFixtures();
  });

  it('returns ok:true and empty flags for a healthy available vehicle', async () => {
    const result = await checkVehicleHealthTool.handler({ vehicle_id: sedanId }, undefined);
    expect(result.isError).toBeFalsy();
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected text content');
    const body = JSON.parse(first.text) as { ok: boolean; flags: string[] };
    expect(body.ok).toBe(true);
    expect(body.flags).toEqual([]);
  });

  it('returns ok:false with unknown_vehicle flag for a bad id', async () => {
    const result = await checkVehicleHealthTool.handler(
      { vehicle_id: '00000000-0000-0000-0000-000000000000' },
      undefined,
    );
    expect(result.isError).toBeFalsy();
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected text content');
    const body = JSON.parse(first.text) as { ok: boolean; flags: string[] };
    expect(body.ok).toBe(false);
    expect(body.flags).toContain('unknown_vehicle');
  });
});

// ─── get_trip_status ─────────────────────────────────────────────────────────

describe('getTripStatusTool handler', () => {
  beforeAll(async () => {
    await ensureFixtures();
  });

  it('returns trip + vehicle + customer for a known trip_id', async () => {
    const result = await getTripStatusTool.handler(
      { trip_id: activeTripId, customer_email: undefined },
      undefined,
    );
    expect(result.isError).toBeFalsy();
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected text content');
    const body = JSON.parse(first.text) as { trip: { id: string }; vehicle: unknown; customer: unknown };
    expect(body.trip.id).toBe(activeTripId);
    expect(body.vehicle).not.toBeNull();
    expect(body.customer).not.toBeNull();
  });

  it('returns null (JSON) for an unknown trip_id', async () => {
    const result = await getTripStatusTool.handler(
      { trip_id: '00000000-0000-0000-0000-000000000000', customer_email: undefined },
      undefined,
    );
    expect(result.isError).toBeFalsy();
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected text content');
    expect(JSON.parse(first.text)).toBeNull();
  });

  it('returns the trip for a known customer_email', async () => {
    const result = await getTripStatusTool.handler(
      { customer_email: 'mcp-test@example.com', trip_id: undefined },
      undefined,
    );
    expect(result.isError).toBeFalsy();
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected text content');
    const body = JSON.parse(first.text) as { trip: { id: string } } | null;
    expect(body).not.toBeNull();
    expect(body!.trip.id).toBe(activeTripId);
  });
});

// ─── query_customer_history ──────────────────────────────────────────────────

describe('queryCustomerHistoryTool handler', () => {
  beforeAll(async () => {
    await ensureFixtures();
  });

  it('returns customer + trips + total_spend_usd for a known email', async () => {
    const result = await queryCustomerHistoryTool.handler(
      { email: 'mcp-test@example.com', customer_id: undefined },
      undefined,
    );
    expect(result.isError).toBeFalsy();
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected text content');
    const body = JSON.parse(first.text) as {
      customer: { id: string };
      trips: unknown[];
      total_spend_usd: number;
    };
    expect(body.customer.id).toBe(customerId);
    expect(body.trips.length).toBeGreaterThanOrEqual(1);
    expect(typeof body.total_spend_usd).toBe('number');
  });

  it('returns null for an unknown email', async () => {
    const result = await queryCustomerHistoryTool.handler(
      { email: 'nobody@example.com', customer_id: undefined },
      undefined,
    );
    expect(result.isError).toBeFalsy();
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected text content');
    expect(JSON.parse(first.text)).toBeNull();
  });
});

// ─── propose_rental ──────────────────────────────────────────────────────────

describe('proposeRentalTool handler', () => {
  let proposeCustomerId: string;
  let proposeVehicleId: string;

  const PICKUP = { lat: 42.36, lng: -71.06 };
  const DROPOFF = { lat: 41.66, lng: -70.27 };
  const START_ISO = '2026-06-01T10:00:00Z';
  const END_ISO = '2026-06-03T18:00:00Z';
  const POLYLINE: Array<[number, number]> = [[42.36, -71.06], [41.66, -70.27]];

  beforeAll(async () => {
    await ensureFixtures();

    // Dedicate a fresh customer so propose tests don't interfere with other suites
    const [cust] = await db
      .insert(customers)
      .values({ name: 'Propose MCP', email: 'propose-mcp@example.com' })
      .onConflictDoUpdate({ target: customers.email, set: { name: 'Propose MCP' } })
      .returning();
    proposeCustomerId = cust!.id;

    // Clean prior trips
    const prior = await db.select().from(trips).where(eq(trips.customerId, proposeCustomerId));
    for (const t of prior) {
      await db.delete(invoices).where(eq(invoices.tripId, t.id));
    }
    await db.delete(trips).where(eq(trips.customerId, proposeCustomerId));

    // Ensure the sedan is available
    proposeVehicleId = sedanId;
    await db.update(vehicles).set({ status: 'available' }).where(eq(vehicles.id, proposeVehicleId));
  });

  it('creates a confirmed trip + draft invoice and returns both', async () => {
    const result = await proposeRentalTool.handler(
      {
        customer_id: proposeCustomerId,
        vehicle_id: proposeVehicleId,
        pickup: PICKUP,
        dropoff: DROPOFF,
        scheduled_start_at: START_ISO,
        scheduled_end_at: END_ISO,
        distance_km: 612,
        total_usd: 284.5,
        tax_usd: 22.36,
        polyline: POLYLINE,
        task_id: undefined,
      },
      undefined,
    );
    expect(result.isError).toBeFalsy();
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected text content');
    const body = JSON.parse(first.text) as {
      trip: { status: string };
      invoice: { status: string };
    };
    expect(body.trip.status).toBe('confirmed');
    expect(body.invoice.status).toBe('draft');
  });

  it('returns isError (via thrown error from query) when vehicle not available', async () => {
    // Vehicle is now 'in-use' after the previous test — a second propose should fail.
    // The handler catches the error and returns isError: true.
    const result = await proposeRentalTool.handler(
      {
        customer_id: proposeCustomerId,
        vehicle_id: proposeVehicleId,
        pickup: PICKUP,
        dropoff: DROPOFF,
        scheduled_start_at: START_ISO,
        scheduled_end_at: END_ISO,
        distance_km: 612,
        total_usd: 284.5,
        tax_usd: 22.36,
        polyline: POLYLINE,
        task_id: undefined,
      },
      undefined,
    );
    expect(result.isError).toBe(true);
    const errFirst = result.content[0];
    if (errFirst?.type !== 'text') throw new Error('expected text content');
    expect(errFirst.text).toMatch(/propose_rental failed.*not available/);
  });
});

// ─── charge_invoice ──────────────────────────────────────────────────────────

describe('chargeInvoiceTool handler', () => {
  beforeAll(async () => {
    await ensureFixtures();
  });

  it('marks the invoice paid and returns it', async () => {
    const result = await chargeInvoiceTool.handler(
      { invoice_id: draftInvoiceId },
      undefined,
    );
    expect(result.isError).toBeFalsy();
    const first = result.content[0];
    if (first?.type !== 'text') throw new Error('expected text content');
    const body = JSON.parse(first.text) as { invoice: { status: string; paidAt: string | null } };
    expect(body.invoice.status).toBe('paid');
    expect(body.invoice.paidAt).not.toBeNull();
  });

  it('returns isError for an unknown invoice_id', async () => {
    const result = await chargeInvoiceTool.handler(
      { invoice_id: '00000000-0000-0000-0000-000000000000' },
      undefined,
    );
    expect(result.isError).toBe(true);
    const errFirst = result.content[0];
    if (errFirst?.type !== 'text') throw new Error('expected text content');
    expect(errFirst.text).toMatch(
      /charge_invoice failed.*invoice 00000000-0000-0000-0000-000000000000 not found/,
    );
  });
});

// ─── annotations ─────────────────────────────────────────────────────────────

describe('tool annotations', () => {
  function annotations(t: unknown): Record<string, unknown> {
    const maybe = t as { annotations?: Record<string, unknown>; _annotations?: Record<string, unknown> };
    return maybe.annotations ?? maybe._annotations ?? {};
  }

  it('read-only tools have readOnlyHint:true', () => {
    for (const t of [queryVehiclesTool, computeRouteTool, quoteRentalTool, checkVehicleHealthTool, getTripStatusTool, queryCustomerHistoryTool]) {
      expect(annotations(t).readOnlyHint).toBe(true);
    }
  });

  it('write tools have readOnlyHint:false', () => {
    for (const t of [proposeRentalTool, chargeInvoiceTool]) {
      expect(annotations(t).readOnlyHint).toBe(false);
    }
  });
});
