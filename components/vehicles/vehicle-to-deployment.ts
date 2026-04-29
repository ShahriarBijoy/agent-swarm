import type { DeploymentData, DeploymentStep } from '@/components/ui/deployment-card';

type Vehicle = {
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
  imageSlug: string;
  depot: string;
  dailyRateUsd: string;
  lastServicedAt: Date | null;
};

type ActiveTrip = {
  id: string;
  distanceKm: string;
  actualStartAt: Date | null;
  scheduledEndAt: Date;
};

export function vehicleToDeploymentData(args: {
  vehicle: Vehicle;
  activeTrip?: ActiveTrip;
  destinationLabel?: string;
  now?: Date;
}): DeploymentData {
  const { vehicle, activeTrip, destinationLabel = 'destination' } = args;
  const now = args.now ?? new Date();
  const status =
    vehicle.status === 'available'
      ? 'Ready'
      : vehicle.status === 'in-use'
        ? 'Building'
        : 'Error';

  const lastActive = vehicle.lastServicedAt
    ? `serviced ${Math.max(0, Math.round((now.getTime() - vehicle.lastServicedAt.getTime()) / 86_400_000))}d ago`
    : 'service unknown';

  const idleMessage = `Idle in depot · $${Math.round(Number(vehicle.dailyRateUsd))}/day`;
  const inUseMessage = activeTrip
    ? `Group of ${vehicle.seats} → ${destinationLabel}, ${Math.round(Number(activeTrip.distanceKm))}km`
    : idleMessage;

  const commitMessage = vehicle.status === 'in-use' ? inUseMessage : idleMessage;
  const commitHash = activeTrip ? activeTrip.id.slice(0, 7) : vehicle.id.slice(0, 7);
  const domains =
    vehicle.status === 'in-use' && activeTrip
      ? [`trip-${activeTrip.id.slice(0, 8)}.in-route`]
      : vehicle.status === 'maintenance'
        ? ['service.bay-1']
        : [`${vehicle.depot}.idle`];

  const steps = makeSteps({ vehicle, activeTrip, now });

  return {
    id: vehicle.plate,
    environment: vehicle.segment.toUpperCase(),
    status,
    createdTime: `${vehicle.year} · ${vehicle.odometerKm.toLocaleString()} km`,
    createdBy: { name: `${vehicle.make} ${vehicle.model}`, avatar: '' },
    duration: `${vehicle.rangeKm} km · ${vehicle.seats}p`,
    lastActive,
    domains,
    branch: vehicle.depot,
    commitMessage,
    commitHash,
    steps,
    imagePreviewUrl: `/vehicles/${vehicle.imageSlug}.png`,
    imageAlt: `${vehicle.make} ${vehicle.model} ${vehicle.year}`,
  };
}

function makeSteps(args: {
  vehicle: Vehicle;
  activeTrip?: ActiveTrip;
  now: Date;
}): DeploymentStep[] {
  const empty: DeploymentStep = {
    id: '',
    label: '',
    status: 'pending',
    progress: 0,
    duration: '—',
  };
  const labels = ['Pickup', 'In-route', 'Drop-off', 'Return'];
  if (args.vehicle.status === 'maintenance') {
    return [
      { ...empty, id: 'pickup', label: labels[0], status: 'error', duration: 'service' },
      { ...empty, id: 'inroute', label: labels[1] },
      { ...empty, id: 'dropoff', label: labels[2] },
      { ...empty, id: 'return', label: labels[3] },
    ];
  }
  if (args.vehicle.status !== 'in-use' || !args.activeTrip || !args.activeTrip.actualStartAt) {
    return labels.map((label, i) => ({ ...empty, id: `s${i}`, label }));
  }
  const startMs = args.activeTrip.actualStartAt.getTime();
  const endMs = args.activeTrip.scheduledEndAt.getTime();
  const elapsedMs = args.now.getTime() - startMs;
  const totalMs = Math.max(1, endMs - startMs);
  const progress = Math.max(0, Math.min(1, elapsedMs / totalMs));
  return [
    { id: 'pickup', label: 'Pickup', status: 'success', progress: 1, duration: '' },
    {
      id: 'inroute',
      label: 'In-route',
      status: progress >= 1 ? 'success' : 'loading',
      progress,
      duration: `${Math.round(progress * 100)}%`,
    },
    { id: 'dropoff', label: 'Drop-off', status: 'pending', progress: 0, duration: '—' },
    { id: 'return', label: 'Return', status: 'pending', progress: 0, duration: '—' },
  ];
}
