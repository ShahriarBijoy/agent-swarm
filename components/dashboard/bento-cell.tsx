// components/dashboard/bento-cell.tsx
import Link from 'next/link';
import type { ReactNode } from 'react';

export type BentoCellProps = {
  /** Display name surfaced in the cell key bar (uppercased automatically). */
  name: string;
  /** CSS grid-area name from the bento layout. */
  gridArea: string;
  /** Surface variant — controls bg, border, and key/open colors. */
  variant?: 'default' | 'warm' | 'lime' | 'black';
  /** Hide the trailing ↗ icon (used by hero cells without a deep link). */
  hideOpen?: boolean;
  /**
   * Where the ↗ icon (and the whole-cell hover affordance) navigates to.
   * Provided per-cell from `app/(dashboard)/page.tsx` so each tile points
   * at its own list page (e.g. all-agents → /agents).
   */
  openHref?: string;
  children: ReactNode;
};

const VARIANT: Record<NonNullable<BentoCellProps['variant']>, string> = {
  default: 'bg-[var(--color-surface)] border-[var(--color-line)]',
  warm:    'bg-[var(--color-surface-warm)] border-[var(--color-line)]',
  lime:    'bg-[var(--color-lime)] border-[var(--color-lime-deep)]',
  black:   'bg-[var(--color-ink)] border-[var(--color-ink)] text-[var(--color-surface)]',
};

const HOVER: Record<NonNullable<BentoCellProps['variant']>, string> = {
  default: 'hover:border-[var(--color-line-strong)]',
  warm:    'hover:border-[var(--color-line-strong)]',
  lime:    'hover:border-black/35',
  black:   'hover:border-white/40',
};

export function BentoCell({
  name,
  gridArea,
  variant = 'default',
  hideOpen,
  openHref,
  children,
}: BentoCellProps) {
  const v = VARIANT[variant];
  const hoverable = openHref != null;
  const hoverClass = hoverable ? HOVER[variant] : '';

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

  // Render the ↗ control as a Link iff we have a destination. Always renders
  // visually; only navigates when href is set, so the cell-key bar layout stays
  // identical with or without a link target.
  const openIcon = !hideOpen ? (
    openHref ? (
      <Link
        href={openHref}
        aria-label={`Open ${name}`}
        className={`grid h-[22px] w-[22px] place-items-center rounded-full border ${openBorder} text-[12px] ${openColor} transition-colors hover:bg-black/5`}
      >
        ↗
      </Link>
    ) : (
      <span
        aria-hidden
        className={`grid h-[22px] w-[22px] place-items-center rounded-full border ${openBorder} text-[12px] ${openColor}`}
      >
        ↗
      </span>
    )
  ) : null;

  return (
    <div
      style={{ gridArea }}
      className={`relative flex min-h-0 flex-col rounded-[16px] border p-[22px] transition-colors ${v} ${hoverClass}`}
    >
      <div className={`mb-[10px] flex items-center justify-between font-mono text-[9.5px] uppercase tracking-[0.22em] ${labelColor}`}>
        <span className="font-mono">{name.toUpperCase()}</span>
        {openIcon}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
