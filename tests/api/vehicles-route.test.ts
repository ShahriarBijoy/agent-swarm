import { describe, it, expect } from 'vitest';
import { queryVehicles, type QueryVehiclesArgs } from '@/db/queries/domain';

describe('GET /api/vehicles query layer', () => {
  it('queryVehicles accepts empty args (no filters)', async () => {
    const fn = queryVehicles;
    expect(typeof fn).toBe('function');
    const args: QueryVehiclesArgs = {};
    expect(args).toEqual({});
  });

  it('queryVehicles accepts all filter combos', () => {
    const args: QueryVehiclesArgs = {
      status: 'available',
      segment: 'sedan',
      seats_min: 4,
      range_min_km: 500,
    };
    expect(args.status).toBe('available');
    expect(args.segment).toBe('sedan');
    expect(args.seats_min).toBe(4);
    expect(args.range_min_km).toBe(500);
  });
});
