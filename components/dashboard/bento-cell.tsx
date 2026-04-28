// components/dashboard/bento-cell.tsx
import Link from 'next/link';
import type { ReactNode } from 'react';

import {
  Frame,
  FrameFooter,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from '@/components/reui/frame';

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
  /**
   * Optional slot rendered inside <FrameFooter> beneath the panel. Most
   * widgets leave this empty and put everything in `children`. Widgets
   * with a natural summary row (e.g. cost-line-12mo's avg/days-tracked
   * pair) opt in via WidgetDef.Footer.
   */
  footer?: ReactNode;
  /**
   * Extra Tailwind classes merged onto the inner FramePanel. Use this when
   * a widget needs to override panel defaults — most importantly to drop
   * `overflow-hidden` so chart tooltips (Recharts, etc.) can render past
   * the panel's rounded clip.
   */
  panelClassName?: string;
  children: ReactNode;
};

// Outer Frame (the "tray") for default/warm — soft warm bg, no hard border
// (variant="ghost" removes the Frame's outer border). Lime and black are
// monolithic tiles, so their tray colour matches the panel below.
const OUTER: Record<NonNullable<BentoCellProps['variant']>, string> = {
  default: 'bg-[var(--color-bg-2)]/55',
  warm:    'bg-[var(--color-bg-2)]/80',
  lime:    'bg-[var(--color-lime)]',
  black:   'bg-[var(--color-ink)] text-[var(--color-surface)]',
};

const OUTER_HOVER: Record<NonNullable<BentoCellProps['variant']>, string> = {
  default: 'hover:bg-[var(--color-bg-2)]/80',
  warm:    'hover:bg-[var(--color-bg-2)]',
  lime:    'hover:bg-[var(--color-lime-deep)]',
  black:   'hover:bg-black',
};

// Inner FramePanel — pulls warm cream tones from the dashboard palette so
// the panel reads as part of the theme instead of a pure-white card sitting
// on top. Default uses --color-surface-warm (#f6f2ea, the explicit "warm
// surface" token), warm steps one notch deeper to --color-bg (#efece6) so
// the two variants stay distinguishable. Lime and black mirror the outer
// to keep their monolithic feel. The Frame primitive reads
// `--frame-panel-bg` / `--frame-panel-border-color` from CSS vars; direct
// bg-/border- classes win via twMerge source order.
const PANEL: Record<NonNullable<BentoCellProps['variant']>, string> = {
  default: 'bg-[var(--color-surface-warm)] border-[var(--color-line)]',
  warm:    'bg-[var(--color-bg)] border-[var(--color-line)]',
  lime:    'bg-[var(--color-lime)] border-transparent shadow-none',
  black:   'bg-[var(--color-ink)] border-transparent shadow-none',
};

export function BentoCell({
  name,
  gridArea,
  variant = 'default',
  hideOpen,
  openHref,
  footer,
  panelClassName,
  children,
}: BentoCellProps) {
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
  // visually; only navigates when href is set, so the cell-key bar layout
  // stays identical with or without a link target.
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

  const hoverable = openHref != null;

  return (
    <Frame
      variant="ghost"
      spacing="sm"
      style={{ gridArea }}
      className={`min-h-0 rounded-[18px] transition-colors ${OUTER[variant]} ${hoverable ? OUTER_HOVER[variant] : ''}`}
    >
      <FrameHeader className="flex-row items-center justify-between">
        <FrameTitle
          className={`font-mono text-[9.5px] font-medium uppercase tracking-[0.22em] ${labelColor}`}
        >
          {name.toUpperCase()}
        </FrameTitle>
        {openIcon}
      </FrameHeader>
      <FramePanel className={`min-h-0 flex-1 ${PANEL[variant]} ${panelClassName ?? ''}`}>
        {children}
      </FramePanel>
      {footer != null && (
        <FrameFooter className="flex-row items-center justify-between gap-4 px-3 py-2 text-[12px]">
          {footer}
        </FrameFooter>
      )}
    </Frame>
  );
}
