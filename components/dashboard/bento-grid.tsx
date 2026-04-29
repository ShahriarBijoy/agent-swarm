// components/dashboard/bento-grid.tsx
import type { ReactNode } from 'react';

const TEMPLATE_AREAS = [
  '"greet greet workers workers workers"',
  '"canvas canvas canvas hitl   lime  "',
  '"canvas canvas canvas cleanup lime  "',
  '"cost   cost   cost   refl    black "',
  '"trips  trips  trips  trips   trips "',
].join(' ');

export function BentoGrid({ children }: { children: ReactNode }) {
  return (
    <div
      className="grid gap-[14px]"
      style={{
        gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
        gridTemplateAreas: TEMPLATE_AREAS,
        gridAutoRows: 'minmax(220px, auto)',
      }}
    >
      {children}
    </div>
  );
}
