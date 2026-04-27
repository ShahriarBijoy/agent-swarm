// components/dashboard/bento-grid.tsx
import { ReactNode } from 'react';

const TEMPLATE_AREAS = [
  '"greet greet workers workers workers"',
  '"canvas canvas canvas hitl   lime  "',
  '"canvas canvas canvas cleanup lime  "',
  '"cost   cost   cost   refl    black "',
].join(' ');

export function BentoGrid({ children }: { children: ReactNode }) {
  return (
    <div
      className="grid gap-[14px]"
      style={{
        gridTemplateColumns: 'repeat(5, 1fr)',
        gridTemplateAreas: TEMPLATE_AREAS,
      }}
    >
      {children}
    </div>
  );
}
