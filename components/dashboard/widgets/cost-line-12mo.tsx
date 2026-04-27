// components/dashboard/widgets/cost-line-12mo.tsx
'use client';
import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';
import type { CostLineSnapshot } from '@/lib/dashboard/queries';
import type { WidgetDef } from '../widget-registry';
import { getCostLine12Mo } from '@/lib/dashboard/queries';

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

export function CostLine12Mo({ data }: { data: CostLineSnapshot }) {
  const avgDaily = data.days.length
    ? data.days.reduce((s, d) => s + d.total, 0) / data.days.length
    : 0;
  const series = data.days.map((d) => ({
    label: d.date.toISOString().slice(0, 10),
    total: d.total,
    opus: d.opusOnly,
  }));
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--color-muted-2)]">
            Your swarm cost · this year
          </div>
          <h3 className="mt-1 text-[17px] font-medium tracking-tight">Daily token spend, 12-month rolling</h3>
        </div>
      </div>
      <div data-chart-host className="h-[140px] w-full">
        <Resp width="100%" height="100%">
          <Line data={series} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" hide />
            <YAxis hide />
            <Tooltip />
            <LineSeries type="monotone" dataKey="total" stroke="#0a0a0a" strokeWidth={2} dot={false} />
            <LineSeries type="monotone" dataKey="opus"  stroke="#d4ff3f" strokeWidth={2} strokeDasharray="3 4" dot={false} />
          </Line>
        </Resp>
      </div>
      <div className="mt-3.5 grid grid-cols-2 gap-4 border-t border-[var(--color-line)] pt-3">
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">Avg daily spend</div>
          <div className="text-[21px] font-semibold tracking-tight tabular-nums">$ {avgDaily.toFixed(2)}</div>
        </div>
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">Days tracked</div>
          <div className="text-[21px] font-semibold tracking-tight tabular-nums">{data.days.length}</div>
        </div>
      </div>
    </div>
  );
}

export const costLine12MoDef: WidgetDef<CostLineSnapshot> = {
  id: 'cost-line-12mo',
  name: 'Your swarm cost · this year',
  gridArea: 'cost',
  refreshMs: 30000,
  load: getCostLine12Mo,
  Component: CostLine12Mo,
};
