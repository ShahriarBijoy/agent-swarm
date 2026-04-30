'use client';

import { useMemo } from 'react';
import {
  NativeMarquee,
  SideFadeGradients,
  type NativeMarqueeItem,
} from '@/components/ui/native-marquee';

type CustomerRow = {
  name: string;
  email: string;
  spendUsd: number;
  invoiceCount: number;
};

function formatUsdShort(n: number): string {
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

// Map customer rows to marquee items styled for the cream editorial surface.
// The icon slot holds the rank counter, the label carries the name, the
// spend, and an invoice count. Two rows running in opposite directions give
// the operator a calm, scanning rhythm without competing with the table.
export function TopCustomersMarquee({ rows }: { rows: CustomerRow[] }) {
  const items = useMemo<NativeMarqueeItem[]>(
    () =>
      rows.map((c, idx) => ({
        id: c.email,
        icon: (
          <span
            aria-hidden
            className="grid h-5 w-5 place-items-center rounded-full bg-[var(--color-ink)] font-mono text-[9.5px] tabular-nums text-[var(--color-lime)]"
          >
            {String(idx + 1).padStart(2, '0')}
          </span>
        ),
        label: (
          <span className="flex items-center gap-3">
            <span className="text-[13px] font-medium tracking-tight text-[var(--color-ink)]">
              {c.name}
            </span>
            <span className="h-3 w-px bg-[var(--color-line-strong)]" aria-hidden />
            <span className="font-mono text-[12px] font-semibold tabular-nums tracking-tight text-[var(--color-ink)]">
              {formatUsdShort(c.spendUsd)}
            </span>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
              {c.invoiceCount} inv
            </span>
          </span>
        ),
      })),
    [rows],
  );

  if (items.length === 0) return null;

  // Reverse the second pass so the bottom row scrolls the opposite way. The
  // wrapper sets a CSS var so SideFadeGradients picks up the cream surface
  // instead of falling through to the default zinc background token.
  return (
    <section
      className="relative flex flex-col gap-2.5 [--background:var(--color-bg)]"
    >
      <div className="flex items-baseline justify-between gap-4 px-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
          Top customers · lifetime
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
          {rows.length} ranked
        </p>
      </div>
      <div className="relative flex flex-col gap-2 overflow-hidden py-1">
        <SideFadeGradients />
        <NativeMarquee
          items={items}
          gap={10}
          speed={6}
          pauseOnHover
          pauseOnTouch
          itemClassName="border-[var(--color-line)] bg-[var(--color-surface)]/80 hover:bg-[var(--color-surface)] hover:border-[var(--color-line-strong)] py-2.5 px-4 rounded-full"
        />
        <NativeMarquee
          items={items}
          gap={10}
          speed={4}
          reverse
          pauseOnHover
          pauseOnTouch
          itemClassName="border-[var(--color-line)] bg-[var(--color-surface)]/60 hover:bg-[var(--color-surface)] hover:border-[var(--color-line-strong)] py-2.5 px-4 rounded-full"
        />
      </div>
    </section>
  );
}
