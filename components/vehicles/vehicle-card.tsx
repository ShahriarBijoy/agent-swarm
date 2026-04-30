'use client';

import { DeploymentCard } from '@/components/ui/deployment-card';
import { vehicleToDeploymentData } from './vehicle-to-deployment';

type Props = Parameters<typeof vehicleToDeploymentData>[0];

export function VehicleCard(props: Props) {
  const data = vehicleToDeploymentData(props);
  return <DeploymentCard data={data} />;
}
