import { describe, it, expect } from 'vitest';
import { trips, vehicles, customers } from '@/db/schema/domain';

describe('GET /api/trips schema shape', () => {
  it('trips table has required columns for join', () => {
    expect(trips.vehicleId).toBeDefined();
    expect(trips.customerId).toBeDefined();
    expect(trips.status).toBeDefined();
    expect(trips.polyline).toBeDefined();
  });

  it('vehicles table has columns the response needs', () => {
    expect(vehicles.plate).toBeDefined();
    expect(vehicles.make).toBeDefined();
    expect(vehicles.homeLat).toBeDefined();
  });

  it('customers table has name + email', () => {
    expect(customers.name).toBeDefined();
    expect(customers.email).toBeDefined();
  });
});
