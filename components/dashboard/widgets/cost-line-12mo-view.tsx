'use client';
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import type { CostLineSnapshot } from '@/lib/dashboard/queries';

// Recharts is bulky — keep it out of the home bundle until the cell mounts.
// Casts to `ComponentType<any>` are required because Recharts 2.x components
// declare `defaultProps` with widened `string` types that don't match the
// stricter prop union `next/dynamic` infers from the module type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Line = dynamic(() => import('recharts').then((m) => m.LineChart as ComponentType<any>), { ssr: false });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LineSeries = dynamic(() => import('recharts').then((m) => m.Line as ComponentType<any>), { ssr: false });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Resp = dynamic(() => import('recharts').then((m) => m.ResponsiveContainer as ComponentType<any>), { ssr: false });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const XAxis = dynamic(() => import('recharts').then((m) => m.XAxis as ComponentType<any>), { ssr: false });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const YAxis = dynamic(() => import('recharts').then((m) => m.YAxis as ComponentType<any>), { ssr: false });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Tooltip = dynamic(() => import('recharts').then((m) => m.Tooltip as ComponentType<any>), { ssr: false });

// Recharts injects {active, payload, label} at runtime — the lib doesn't
// export a public type for tooltip content props, so describe what we read.
type TooltipPayload = {
  active?: boolean;
  label?: string;
  payload?: { dataKey: string; value: number; color?: string }[];
};

const SERIES_LABEL: Record<string, string> = {
  total: 'Total',
  opus:  'Opus',
};

// Mirrors the visual of `components/ui/tooltip.tsx`'s TooltipContent
// (rounded-2xl bg-foreground text-background px-3 py-1.5 text-xs) so the
// Recharts hover panel reads as the same component as the rest of the app.
function ChartTooltip({ active, payload, label }: TooltipPayload) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="z-50 inline-flex flex-col gap-1 rounded-2xl bg-foreground px-3 py-2 text-xs text-background shadow-lg">
      {label && (
        <div className="font-mono text-[10px] tracking-[0.05em] opacity-70">{label}</div>
      )}
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: p.color ?? 'currentColor' }}
            />
            <span>{SERIES_LABEL[p.dataKey] ?? p.dataKey}</span>
          </span>
          <span className="font-mono tabular-nums">${Number(p.value).toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

export function CostLine12Mo({ data }: { data: CostLineSnapshot }) {
  const series = data.days.map((d) => ({
    label: d.date.toISOString().slice(0, 10),
    total: d.total,
    opus: d.opusOnly,
  }));
  return (
    <div className="flex h-full flex-col">
      <h3 className="mb-3 text-[17px] font-medium tracking-tight">Daily $ spend, 12-month rolling</h3>
      <div data-chart-host className="h-[140px] w-full flex-1">
        <Resp width="100%" height="100%">
          <Line data={series} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" hide />
            <YAxis hide />
            <Tooltip
              cursor={{ stroke: 'rgba(10,10,10,0.18)', strokeDasharray: '3 3' }}
              content={<ChartTooltip />}
              allowEscapeViewBox={{ x: true, y: false }}
              wrapperStyle={{ zIndex: 50, pointerEvents: 'none' }}
            />
            <LineSeries type="monotone" dataKey="total" stroke="#0a0a0a" strokeWidth={2} dot={false} />
            <LineSeries type="monotone" dataKey="opus"  stroke="#d4ff3f" strokeWidth={2} strokeDasharray="3 4" dot={false} />
          </Line>
        </Resp>
      </div>
    </div>
  );
}

export function CostLine12MoFooter({ data }: { data: CostLineSnapshot }) {
  const avgDaily = data.days.length
    ? data.days.reduce((s, d) => s + d.total, 0) / data.days.length
    : 0;
  return (
    <>
      <div>
        <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">
          Avg daily spend
        </div>
        <div className="text-[16px] font-semibold tracking-tight tabular-nums">
          $ {avgDaily.toFixed(2)}
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">
          Days tracked
        </div>
        <div className="text-[16px] font-semibold tracking-tight tabular-nums">
          {data.days.length}
        </div>
      </div>
    </>
  );
}
