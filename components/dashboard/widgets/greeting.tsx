// components/dashboard/widgets/greeting.tsx
import type { GreetingSnapshot } from '@/lib/dashboard/queries';
import type { WidgetDef } from '../widget-registry';
import { getGreetingSnapshot } from '@/lib/dashboard/queries';

export function Greeting({ data }: { data: GreetingSnapshot }) {
  const operatorName = process.env.OPERATOR_NAME ?? 'Operator';
  const max = Math.max(...data.months.map((m) => m.count), 1);
  const fmt = new Intl.NumberFormat('en-US');
  const cost = data.monthCostUsd;
  const delta = data.totalThisMonth - data.totalLastMonth;

  return (
    <div className="flex h-full flex-col gap-6">
      <h2 className="text-[28px] font-medium leading-[1.1] tracking-tight">
        Hi {operatorName},{' '}
        <span className="font-serif-italic">here&apos;s</span> what&apos;s
        <br />happening in your swarm.
      </h2>

      <div>
        <div className="mb-1.5 flex h-14 items-end gap-1.5">
          {data.months.map((m, i) => {
            const isNow = i === data.months.length - 1;
            const h = `${(m.count / max) * 100}%`;
            return (
              <div
                key={m.label}
                data-month={m.label}
                className={`flex-1 rounded ${
                  isNow ? 'bg-[var(--color-lime)]' : 'bg-black/[.06]'
                }`}
                style={{ height: h }}
              />
            );
          })}
        </div>
        <div className="flex gap-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--color-muted-2)]">
          {data.months.map((m) => (
            <span key={m.label} className="flex-1 text-center">{m.label}</span>
          ))}
        </div>
      </div>

      <p className="text-[14px] leading-[1.5] text-[var(--color-muted)]">
        This month your swarm has run{' '}
        <strong className="font-medium text-[var(--color-ink)]">{fmt.format(data.totalThisMonth)} tasks</strong> across 11 agents — that&apos;s{' '}
        <strong className="font-medium text-[var(--color-ink)]">
          {delta >= 0 ? `${fmt.format(delta)} more` : `${fmt.format(-delta)} fewer`}
        </strong>{' '}
        than last month.
      </p>

      <div className="mt-auto">
        <div className="text-[36px] font-semibold leading-none tracking-tight tabular-nums">
          $&nbsp;{cost.toFixed(2)}
        </div>
        <div className="mt-1 text-[12px] text-[var(--color-muted)]">
          total agent cost this month
        </div>
      </div>
    </div>
  );
}

export const greetingDef: WidgetDef<GreetingSnapshot> = {
  id: 'greeting',
  name: 'Greeting',
  gridArea: 'greet',
  refreshMs: 3000,
  load: getGreetingSnapshot,
  Component: Greeting,
};
