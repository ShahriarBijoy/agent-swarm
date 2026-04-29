// components/dashboard/bento-grid.tsx
import type { ReactNode } from 'react';

// Trips-on-road is the new visual hero — a 3×3 fleet-arcs canvas anchoring
// the upper-left of the dashboard. Mini-canvas keeps a 2×2 spot to its right
// for the live swarm run; smaller stat tiles sit beneath. Cost-line spans the
// bottom row so the chart still has room to breathe.
const TEMPLATE_AREAS = [
  '"greet  greet   workers workers workers"',
  '"trips  trips   trips   canvas  canvas "',
  '"trips  trips   trips   canvas  canvas "',
  '"trips  trips   trips   hitl    lime   "',
  '"cost   cost    cost    cleanup lime   "',
  '"cost   cost    cost    refl    black  "',
].join(' ');

export function BentoGrid({ children }: { children: ReactNode }) {
  return (
    <div
      className="grid gap-[14px]"
      style={{
        gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
        gridTemplateAreas: TEMPLATE_AREAS,
        gridAutoRows: 'minmax(180px, auto)',
      }}
    >
      {children}
    </div>
  );
}
