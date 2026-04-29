import { Frame, FramePanel } from '@/components/reui/frame';
import {
  getBillingKpis,
  getInvoiceRows,
  getTopCustomers,
} from '@/lib/dashboard/billing-queries';
import { BillingTable } from './billing-table';

export const dynamic = 'force-dynamic';

export default async function BillingPage() {
  const [rows, kpis, top] = await Promise.all([
    getInvoiceRows(200),
    getBillingKpis(),
    getTopCustomers(8),
  ]);

  const totalInvoices = rows.length;
  const distinctCustomers = new Set(rows.map((r) => r.customerEmail)).size;

  return (
    <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-7 px-2 pt-2 pb-12">
      <header className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-6">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--color-muted)]">
              Auto-ride · Accounts receivable
            </p>
            <h1 className="mt-1 text-[34px] font-semibold leading-none tracking-tight text-[var(--color-ink)]">
              Billing
            </h1>
          </div>
          <p className="hidden max-w-[340px] text-right font-serif-italic text-[14px] leading-snug text-[var(--color-muted)] md:block">
            Outstanding invoices, paid receipts, and customer spend rolled up
            across the German fleet.
          </p>
        </div>
        <KpiRibbon
          outstandingUsd={kpis.outstandingUsd}
          paidThisMonthUsd={kpis.paidThisMonthUsd}
          openCount={kpis.openCount}
          pendingCount={kpis.pendingCount}
          draftCount={kpis.draftCount}
          overdueCount={kpis.overdueCount}
          paidCount={kpis.paidCount}
          totalInvoices={totalInvoices}
          distinctCustomers={distinctCustomers}
        />
      </header>

      <Frame
        spacing="default"
        className="bg-[var(--color-surface-warm)]/60 [--frame-panel-bg:var(--color-surface)] [--frame-panel-border-color:var(--color-line)] [--frame-border-color:var(--color-line)]"
      >
        <FramePanel className="p-5">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
                Invoice ledger
              </p>
              <h2 className="mt-0.5 text-[15px] font-semibold tracking-tight text-[var(--color-ink)]">
                Recent activity
              </h2>
            </div>
            <p className="hidden font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--color-muted)] sm:block">
              Sort columns · stack filters · export coming next
            </p>
          </div>
          <BillingTable rows={rows} />
        </FramePanel>
      </Frame>

      <TopCustomersRail rows={top} />
    </main>
  );
}

type KpiRibbonProps = {
  outstandingUsd: number;
  paidThisMonthUsd: number;
  openCount: number;
  pendingCount: number;
  draftCount: number;
  overdueCount: number;
  paidCount: number;
  totalInvoices: number;
  distinctCustomers: number;
};

// Ribbon style: 4 numbers in a row separated by hairline dividers, no card walls.
// The first cell uses the lime accent because outstanding is the value an
// operator most often wants to act on. The rest stay restrained.
function KpiRibbon({
  outstandingUsd,
  paidThisMonthUsd,
  openCount,
  pendingCount,
  draftCount,
  overdueCount,
  paidCount,
  totalInvoices,
  distinctCustomers,
}: KpiRibbonProps) {
  const openSub = (() => {
    const parts: string[] = [];
    if (pendingCount > 0) parts.push(`${pendingCount} pending`);
    if (draftCount > 0) parts.push(`${draftCount} draft`);
    if (parts.length === 0) parts.push('all clear');
    return parts.join(', ');
  })();
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-[var(--color-line)] bg-[var(--color-line)] sm:grid-cols-4">
      <KpiCell
        label="Outstanding"
        value={formatBigUsd(outstandingUsd)}
        sub={openCount > 0 ? `${openCount} open: ${openSub}` : 'all clear'}
        accent="lime"
      />
      <KpiCell
        label="Paid this month"
        value={formatBigUsd(paidThisMonthUsd)}
        sub={`${paidCount} settled total`}
      />
      <KpiCell
        label="Overdue"
        value={String(overdueCount)}
        sub={overdueCount > 0 ? 'past due, follow up' : 'on track'}
        accent={overdueCount > 0 ? 'red' : undefined}
      />
      <KpiCell
        label="Coverage"
        value={String(totalInvoices)}
        sub={`${distinctCustomers} customers`}
      />
    </div>
  );
}

function KpiCell({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: 'lime' | 'red';
}) {
  return (
    <div className="relative flex flex-col justify-between gap-3 bg-[var(--color-surface)] px-5 pt-4 pb-3.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
        {label}
      </p>
      <div className="space-y-1">
        <div
          className="text-[28px] font-semibold leading-none tracking-tight tabular-nums"
          style={{
            color:
              accent === 'lime'
                ? 'var(--color-ink)'
                : accent === 'red'
                  ? 'var(--color-red)'
                  : 'var(--color-ink)',
          }}
        >
          {value}
        </div>
        <p className="font-mono text-[10.5px] tracking-tight text-[var(--color-muted)]">
          {sub}
        </p>
      </div>
      {accent === 'lime' && (
        <span
          aria-hidden
          className="absolute bottom-0 left-0 h-0.5 w-12 rounded-r-full bg-[var(--color-lime)]"
        />
      )}
    </div>
  );
}

function formatBigUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function TopCustomersRail({
  rows,
}: {
  rows: Array<{ name: string; email: string; spendUsd: number; invoiceCount: number }>;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
          Top customers · lifetime
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-muted)]">
          {rows.length} of many
        </p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {rows.map((c, idx) => (
          <article
            key={c.email}
            className="group flex min-w-[210px] shrink-0 flex-col gap-2.5 rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface)]/65 px-3.5 py-3 transition-colors hover:bg-[var(--color-surface)]"
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[10px] tabular-nums text-[var(--color-muted-2)]">
                {String(idx + 1).padStart(2, '0')}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-muted)]">
                {c.invoiceCount} inv
              </span>
            </div>
            <div className="space-y-0.5">
              <div className="truncate text-[13px] font-medium tracking-tight text-[var(--color-ink)]">
                {c.name}
              </div>
              <div className="truncate font-mono text-[10.5px] text-[var(--color-muted)]">
                {c.email}
              </div>
            </div>
            <div className="flex items-baseline justify-between gap-2 border-t border-dashed border-[var(--color-line)] pt-2">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-[var(--color-muted)]">
                Spend
              </span>
              <span className="font-mono text-[13px] font-semibold tabular-nums tracking-tight text-[var(--color-ink)]">
                {c.spendUsd.toLocaleString('en-US', {
                  style: 'currency',
                  currency: 'USD',
                  maximumFractionDigits: 0,
                })}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
