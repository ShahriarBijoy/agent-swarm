// components/dashboard/bento-cell.tsx
import { ReactNode } from 'react';

export type BentoCellProps = {
  /** Display name surfaced in the cell key bar (uppercased automatically). */
  name: string;
  /** CSS grid-area name from the bento layout. */
  gridArea: string;
  /** Surface variant — controls bg, border, and key/open colors. */
  variant?: 'default' | 'warm' | 'lime' | 'black';
  /** Hide the trailing ↗ icon (used by the lime/black hero cells). */
  hideOpen?: boolean;
  children: ReactNode;
};

const VARIANT: Record<NonNullable<BentoCellProps['variant']>, string> = {
  default: 'bg-[var(--color-surface)] border-[var(--color-line)]',
  warm:    'bg-[var(--color-surface-warm)] border-[var(--color-line)]',
  lime:    'bg-[var(--color-lime)] border-[var(--color-lime-deep)]',
  black:   'bg-[var(--color-ink)] border-[var(--color-ink)] text-[var(--color-surface)]',
};

export function BentoCell({ name, gridArea, variant = 'default', hideOpen, children }: BentoCellProps) {
  const v = VARIANT[variant];
  const labelColor =
    variant === 'lime' ? 'text-black/55' :
    variant === 'black' ? 'text-white/45' :
    'text-[var(--color-muted-2)]';
  const openBorder =
    variant === 'lime' ? 'border-black/25' :
    variant === 'black' ? 'border-white/30' :
    'border-[var(--color-line-strong)]';
  const openColor =
    variant === 'lime' ? 'text-black/70' :
    variant === 'black' ? 'text-white/70' :
    'text-[var(--color-muted)]';

  return (
    <div
      style={{ gridArea }}
      className={`relative overflow-hidden rounded-[16px] border p-[22px] ${v}`}
    >
      <div className={`mb-[10px] flex items-center justify-between font-mono text-[9.5px] uppercase tracking-[0.22em] ${labelColor}`}>
        <span className="font-mono">{name.toUpperCase()}</span>
        {!hideOpen && (
          <span className={`grid h-[22px] w-[22px] place-items-center rounded-full border ${openBorder} text-[12px] ${openColor}`}>↗</span>
        )}
      </div>
      {children}
    </div>
  );
}
