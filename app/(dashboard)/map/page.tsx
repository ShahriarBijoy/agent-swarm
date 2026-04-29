'use client';

import dynamic from 'next/dynamic';

const FleetMap = dynamic(
  () => import('@/components/map/fleet-map').then((m) => m.FleetMap),
  { ssr: false },
);

export default function MapPage() {
  return (
    <div className="-mx-6 -mt-6 -mb-10">
      <FleetMap />
    </div>
  );
}
