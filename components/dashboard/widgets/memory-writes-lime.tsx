// components/dashboard/widgets/memory-writes-lime.tsx
import type { MemoryWritesTodaySnapshot } from '@/lib/dashboard/queries';
import type { WidgetDef } from '../widget-registry';
import { getMemoryWritesToday } from '@/lib/dashboard/queries';

export function MemoryWritesLime({ data }: { data: MemoryWritesTodaySnapshot }) {
  const fmt = new Intl.NumberFormat('en-US');
  const sign = data.deltaVsYesterday > 0 ? '+' : '';
  return (
    <div className="flex h-full flex-col justify-between">
      <div>
        <h3 className="text-[17px] font-medium tracking-tight text-[var(--color-ink)]">Reinforced today</h3>
        <div className="mt-2 text-[44px] font-semibold leading-none tracking-tight tabular-nums text-[var(--color-ink)]">
          {fmt.format(data.count)}
        </div>
        <div className="mt-1.5 text-[12px] text-black/70">
          {sign}{fmt.format(data.deltaVsYesterday)} {data.deltaVsYesterday >= 0 ? 'more' : 'fewer'} than yesterday. Reflector is up.
        </div>
      </div>
      <div className="mt-3.5 grid h-9 w-9 place-items-center rounded-full bg-[var(--color-ink)] font-display text-[18px] text-[var(--color-lime)]">↗</div>
    </div>
  );
}

export const memoryWritesLimeDef: WidgetDef<MemoryWritesTodaySnapshot> = {
  id: 'memory-writes-lime',
  name: 'Memory writes',
  gridArea: 'lime',
  refreshMs: 30000,
  load: getMemoryWritesToday,
  Component: MemoryWritesLime,
};
