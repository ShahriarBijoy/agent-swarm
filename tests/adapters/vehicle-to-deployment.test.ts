import { describe, it, expect } from 'vitest';
import { vehicleToDeploymentData } from '@/components/vehicles/vehicle-to-deployment';

const SEDAN = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  plate: 'AR-S-2401',
  make: 'Honda',
  model: 'Accord',
  year: 2024,
  segment: 'sedan' as const,
  seats: 5,
  rangeKm: 650,
  odometerKm: 6_910,
  status: 'available' as const,
  homeLat: 42.36,
  homeLng: -71.06,
  depot: 'fleet-east',
  imageSlug: 'honda-accord',
  dailyRateUsd: '95.00',
  perKmRateUsd: '0.2800',
  lastServicedAt: new Date('2026-04-23T00:00:00Z'),
  createdAt: new Date(),
};

describe('vehicleToDeploymentData', () => {
  it('maps an available sedan', () => {
    const data = vehicleToDeploymentData({
      vehicle: SEDAN,
      now: new Date('2026-04-28T00:00:00Z'),
    });
    expect(data.id).toBe('AR-S-2401');
    expect(data.environment).toBe('SEDAN');
    expect(data.status).toBe('Ready');
    expect(data.createdBy.name).toBe('Honda Accord');
    expect(data.createdTime).toBe('2024 · 6,910 km');
    expect(data.duration).toBe('650 km · 5p');
    expect(data.lastActive).toBe('serviced 5d ago');
    expect(data.commitMessage).toBe('Idle in depot · $95/day');
    expect(data.commitHash).toBe(SEDAN.id.slice(0, 7));
    expect(data.imagePreviewUrl).toBe('/vehicles/honda-accord.png');
    expect(data.steps).toHaveLength(4);
    expect(data.steps.every((s) => s.status === 'pending')).toBe(true);
  });

  it('maps an in-use vehicle with active trip', () => {
    const data = vehicleToDeploymentData({
      vehicle: { ...SEDAN, status: 'in-use' },
      activeTrip: {
        id: 'd4f1e2a8-1234-4abc-8def-1234567890ab',
        distanceKm: '612',
        actualStartAt: new Date('2026-04-28T08:00:00Z'),
        scheduledEndAt: new Date('2026-04-28T20:00:00Z'),
      },
      destinationLabel: 'Cape Cod',
      now: new Date('2026-04-28T13:00:00Z'),
    });
    expect(data.status).toBe('Building');
    expect(data.commitMessage).toBe('Group of 5 → Cape Cod, 612km');
    expect(data.commitHash).toBe('d4f1e2a');
    expect(data.steps[1].status).toBe('loading');
    expect(data.steps[1].progress).toBeGreaterThan(0);
    expect(data.steps[1].progress).toBeLessThan(1);
  });

  it('maps maintenance status to Error', () => {
    const data = vehicleToDeploymentData({
      vehicle: { ...SEDAN, status: 'maintenance' },
    });
    expect(data.status).toBe('Error');
    expect(data.steps[0].status).toBe('error');
  });
});
