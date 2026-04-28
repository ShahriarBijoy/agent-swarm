// components/dashboard/widgets/all-agents.tsx
import type { AllAgentsSnapshot } from '@/lib/dashboard/queries';
import type { WidgetDef } from '../widget-registry';
import { getAllAgentsSnapshot } from '@/lib/dashboard/queries';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function StatBlock({
  cap, num, suffix, delta, perAgent, barTag, formatValue,
}: {
  cap: string; num: string; suffix?: string; delta: string;
  perAgent: { agent: string; value: number }[];
  barTag: string;
  formatValue: (v: number) => string;
}) {
  const max = Math.max(...perAgent.map((r) => r.value), 1);
  return (
    <div className="grid grid-cols-[1fr_1.6fr] items-start gap-6 border-b border-dashed border-[var(--color-line-strong)] pb-4 last:border-b-0 last:pb-0">
      <div>
        <div className="mb-1 text-[13px] text-[var(--color-muted)]">{cap}</div>
        <div className="text-[30px] font-semibold leading-none tracking-tight tabular-nums">
          {num}{suffix && <span className="ml-0.5 text-[14px] text-[var(--color-muted)]">{suffix}</span>}
        </div>
        <div className="mt-1.5 text-[12px] text-[var(--color-muted)]">{delta}</div>
      </div>
      <div>
        <div className="grid h-12 items-end gap-[5px]" style={{ gridTemplateColumns: `repeat(${perAgent.length}, 1fr)` }}>
          {perAgent.map((r, i) => {
            const h = `${(r.value / max) * 100}%`;
            const tone = i === 0 ? 'bg-[var(--color-lime)]' : (i === 1 ? 'bg-[var(--color-ink)]' : 'bg-black/10');
            return (
              <Tooltip key={r.agent}>
                <TooltipTrigger asChild>
                  <div
                    data-bar={barTag}
                    className={`rounded-sm ${tone}`}
                    style={{ height: h }}
                  />
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={4}>
                  <span className="font-medium">{r.agent}</span>
                  <span className="font-mono tabular-nums opacity-75">
                    {formatValue(r.value)}
                  </span>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        <div className="mt-1.5 grid font-mono text-[9px] uppercase tracking-[0.05em] text-[var(--color-muted-2)]"
             style={{ gridTemplateColumns: `repeat(${perAgent.length}, 1fr)` }}>
          {perAgent.map((r) => (<span key={r.agent} className="text-center">{r.agent.slice(0, 3)}</span>))}
        </div>
      </div>
    </div>
  );
}

export function AllAgents({ data }: { data: AllAgentsSnapshot }) {
  return (
    <div className="flex flex-col gap-4">
      <StatBlock
        cap="Avg cost / task"
        num={`$ ${data.avgCostPerTask.toFixed(2)}`}
        delta={`${data.perAgentCost.length} agents tracked`}
        perAgent={data.perAgentCost.map((r) => ({ agent: r.agent, value: r.cost }))}
        barTag="agent-cost"
        formatValue={(v) => `$${v.toFixed(2)}`}
      />
      <StatBlock
        cap="Avg p95 latency"
        num={(data.avgP95LatencyMs / 1000).toFixed(1)}
        suffix="s"
        delta={data.perAgentP95[0] ? `${data.perAgentP95[0].agent} slowest` : 'no data'}
        perAgent={data.perAgentP95.map((r) => ({ agent: r.agent, value: r.ms }))}
        barTag="agent-p95"
        formatValue={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`}
      />
    </div>
  );
}

export const allAgentsDef: WidgetDef<AllAgentsSnapshot> = {
  id: 'all-agents',
  name: 'All agents',
  gridArea: 'workers',
  refreshMs: 3000,
  load: getAllAgentsSnapshot,
  Component: AllAgents,
};
