// components/dashboard/bento-cell.tsx
import { ReactNode } from 'react';

export type BentoCellProps = {
  /** Display name surfaced in the cell key bar (uppercased automatically). */
  name: string;
  /** CSS grid-area name from the bento layout. */
  gridArea: string;
  /** Optional className extension (e.g. lime/black variants override). */
  className?: string;
  /** Hide the trailing ↗ icon (used by the lime/black hero cells). */
  hideOpen?: boolean;
  children: ReactNode;
};

export function BentoCell({ name, gridArea, className, hideOpen, children }: BentoCellProps) {
  return (
    <div
      style={{ gridArea }}
      className={`relative overflow-hidden rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface)] p-[22px] ${className ?? ''}`}
    >
      <div className="mb-[10px] flex items-center justify-between font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--color-muted-2)]">
        <span className="font-mono">{name.toUpperCase()}</span>
        {!hideOpen && (
          <span className="grid h-[22px] w-[22px] place-items-center rounded-full border border-[var(--color-line-strong)] text-[12px] text-[var(--color-muted)]">↗</span>
        )}
      </div>
      {children}
    </div>
  );
}
