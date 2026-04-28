'use client';
import { Bar, BarChart, XAxis } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import type { AgentMetrics } from '@/lib/dashboard/queries';

const chartConfig = {
  tokens: { label: 'Tokens', color: 'var(--color-ink)' },
} satisfies ChartConfig;

export function AgentChartStrip({ metrics }: { metrics: AgentMetrics }) {
  const tokenSeries = metrics.dailyTokens.map((d) => ({
    label: d.date.toISOString().slice(5, 10),
    tokens: d.tokens,
  }));
  return (
    <div className="grid grid-cols-3 gap-3.5">
      <div className="rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <div className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--color-muted-2)]">p50 / p95 latency</div>
        <div className="text-[24px] font-semibold tracking-tight tabular-nums">
          {(metrics.p50LatencyMs / 1000).toFixed(2)}s <span className="text-[14px] text-[var(--color-muted)]">/ {(metrics.p95LatencyMs / 1000).toFixed(2)}s</span>
        </div>
      </div>
      <div className="rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <div className="mb-2 font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--color-muted-2)]">Daily tokens</div>
        <ChartContainer config={chartConfig} className="!aspect-auto h-[60px] w-full">
          <BarChart data={tokenSeries} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" hide />
            <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
            <Bar dataKey="tokens" fill="var(--color-tokens)" radius={2} />
          </BarChart>
        </ChartContainer>
      </div>
      <div className="rounded-[16px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <div className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.22em] text-[var(--color-muted-2)]">Success rate</div>
        <div className="text-[24px] font-semibold tracking-tight tabular-nums">{(metrics.successRate * 100).toFixed(0)}%</div>
      </div>
    </div>
  );
}
